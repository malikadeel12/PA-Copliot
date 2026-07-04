"""Backend API tests for PA Copilot Supabase migration (Node/Express backend)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://docs-first-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPABASE_URL = "https://bicmcenhsmapsduufopo.supabase.co"
ANON_KEY = "sb_publishable_QMv9fqDx3uF3zuAyxwQ4aA_o1Ye7PCL"

ADMIN_EMAIL = "dr.admin@pacopilot.health"
ADMIN_PASSWORD = "PaCopilot2026!"
PHYS_EMAIL = "physician@pacopilot-tests.com"
PHYS_PASSWORD = "Test1234!"


def _get_token(email: str, password: str) -> str:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": ANON_KEY, "Content-Type": "application/json"},
        json={"email": email, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"Supabase login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_token():
    return _get_token(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def phys_token():
    return _get_token(PHYS_EMAIL, PHYS_PASSWORD)


def h(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Public / unauth ----------
class TestPublic:
    def test_reference_public(self):
        r = requests.get(f"{API}/reference", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Should contain payer portals + presets
        assert isinstance(data, dict)
        # Loosely check keys exist
        keys = set(data.keys())
        assert any(k in keys for k in ["payerPortals", "payer_portals", "portals", "presets"])

    @pytest.mark.parametrize("path", ["/auth/me", "/stats"])
    def test_protected_no_token_returns_401(self, path):
        r = requests.get(f"{API}{path}", timeout=15)
        assert r.status_code == 401, f"{path} => {r.status_code}"

    def test_profile_put_no_token_returns_401(self):
        r = requests.put(f"{API}/profile", json={"full_name": "x"}, timeout=15)
        assert r.status_code == 401

    def test_invalid_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer garbage.token.value"}, timeout=15)
        assert r.status_code == 401


# ---------- Auth/me ----------
class TestAuthMe:
    def test_admin_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=h(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        # role & credits present
        # Accept nested or flat
        role = data.get("role") or (data.get("profile") or {}).get("role") or (data.get("user") or {}).get("role")
        credits = data.get("credits")
        if credits is None:
            credits = (data.get("profile") or {}).get("credits")
        assert role == "admin", f"expected admin role, got {role}; body={data}"
        assert isinstance(credits, int) and credits >= 1

    def test_physician_me(self, phys_token):
        r = requests.get(f"{API}/auth/me", headers=h(phys_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        role = data.get("role") or (data.get("profile") or {}).get("role") or (data.get("user") or {}).get("role")
        assert role == "physician", f"expected physician role, got {role}; body={data}"


# ---------- Role separation ----------
class TestRoleSeparation:
    def test_physician_admin_overview_forbidden(self, phys_token):
        r = requests.get(f"{API}/admin/overview", headers=h(phys_token), timeout=15)
        assert r.status_code == 403

    def test_physician_admin_users_forbidden(self, phys_token):
        r = requests.get(f"{API}/admin/users", headers=h(phys_token), timeout=15)
        assert r.status_code == 403

    def test_admin_overview_ok(self, admin_token):
        r = requests.get(f"{API}/admin/overview", headers=h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        # Expect some stats keys
        assert isinstance(d, dict) and len(d) > 0

    def test_admin_users_ok(self, admin_token):
        r = requests.get(f"{API}/admin/users", headers=h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        # List of users somewhere
        users = d if isinstance(d, list) else d.get("users") or d.get("data") or []
        assert len(users) >= 1


# ---------- Stats & profile ----------
class TestStatsProfile:
    def test_stats(self, phys_token):
        r = requests.get(f"{API}/stats", headers=h(phys_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), dict)

    def test_profile_update_persists(self, phys_token):
        payload = {
            "full_name": "Dr Test Physician",
            "npi": "1234567890",
            "specialty": "Cardiology",
            "clinic_name": "TEST Clinic",
        }
        r = requests.put(f"{API}/profile", headers=h(phys_token), json=payload, timeout=15)
        assert r.status_code in (200, 204), f"PUT profile => {r.status_code} {r.text}"

        # Verify persistence via /auth/me (which returns the profile)
        g = requests.get(f"{API}/auth/me", headers=h(phys_token), timeout=15)
        assert g.status_code == 200
        data = g.json()
        prof = data.get("profile") or data
        matched = 0
        for k, v in payload.items():
            if prof.get(k) == v:
                matched += 1
        assert matched >= 2, f"profile did not persist expected fields: {prof}"


# ---------- Billing / credits ----------
class TestBilling:
    def test_mock_purchase_increases_credits(self, phys_token):
        before = requests.get(f"{API}/auth/me", headers=h(phys_token), timeout=15).json()
        c_before = before.get("credits") or (before.get("profile") or {}).get("credits") or 0

        r = requests.post(
            f"{API}/billing/mock-purchase",
            headers=h(phys_token),
            json={"pack": "starter"},
            timeout=15,
        )
        assert r.status_code in (200, 201), f"mock-purchase => {r.status_code} {r.text}"

        after = requests.get(f"{API}/auth/me", headers=h(phys_token), timeout=15).json()
        c_after = after.get("credits") or (after.get("profile") or {}).get("credits") or 0
        assert c_after > c_before, f"credits did not increase: before={c_before} after={c_after}"


# ---------- Admin grant credits ----------
class TestAdminGrant:
    def test_admin_grant_credits(self, admin_token, phys_token):
        # Find physician user id from admin listing
        r = requests.get(f"{API}/admin/users", headers=h(admin_token), timeout=15)
        assert r.status_code == 200
        d = r.json()
        users = d if isinstance(d, list) else d.get("users") or d.get("data") or []
        target = None
        for u in users:
            if (u.get("email") or "").lower() == PHYS_EMAIL:
                target = u
                break
        assert target, "physician user not in admin listing"
        uid = target.get("id") or target.get("user_id")
        assert uid

        before = requests.get(f"{API}/auth/me", headers=h(phys_token), timeout=15).json()
        c_before = before.get("credits") or (before.get("profile") or {}).get("credits") or 0

        g = requests.post(
            f"{API}/admin/users/{uid}/grant-credits",
            headers=h(admin_token),
            json={"amount": 3},
            timeout=15,
        )
        assert g.status_code in (200, 201), f"grant-credits => {g.status_code} {g.text}"

        after = requests.get(f"{API}/auth/me", headers=h(phys_token), timeout=15).json()
        c_after = after.get("credits") or (after.get("profile") or {}).get("credits") or 0
        assert c_after >= c_before + 3, f"grant did not add 3: before={c_before} after={c_after}"
