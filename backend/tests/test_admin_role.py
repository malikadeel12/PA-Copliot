"""Admin role separation tests (bug fix: admin vs physician must not see same screens)."""
import uuid
import requests
import pytest


# ---- helpers ----
def _register(base_url, email=None):
    email = email or f"test_{uuid.uuid4().hex[:8]}@pacopilot-tests.com"
    r = requests.post(f"{base_url}/api/auth/register",
                      json={"email": email, "password": "P@ssw0rd!", "name": "Phys User"},
                      timeout=20)
    assert r.status_code == 200, r.text
    return email, r.json()


# ---- role in auth responses ----
def test_register_returns_physician_role(base_url):
    _, data = _register(base_url)
    assert data["user"]["role"] == "physician"
    assert "token" in data


def test_login_admin_returns_admin_role(base_url, admin_client):
    me = admin_client.get(f"{base_url}/api/auth/me", timeout=15)
    assert me.status_code == 200
    body = me.json()
    assert body["role"] == "admin", f"admin user missing admin role: {body}"


def test_login_physician_returns_physician_role(base_url):
    email, _ = _register(base_url)
    r = requests.post(f"{base_url}/api/auth/login",
                      json={"email": email, "password": "P@ssw0rd!"}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "physician"
    # /me also returns role
    me = requests.get(f"{base_url}/api/auth/me",
                      headers={"Authorization": f"Bearer {body['token']}"}, timeout=15)
    assert me.status_code == 200
    assert me.json()["role"] == "physician"


# ---- 403 enforcement for non-admin ----
def test_physician_forbidden_admin_overview(base_url):
    _, data = _register(base_url)
    tok = data["token"]
    r = requests.get(f"{base_url}/api/admin/overview",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 403


def test_physician_forbidden_admin_users(base_url):
    _, data = _register(base_url)
    tok = data["token"]
    r = requests.get(f"{base_url}/api/admin/users",
                     headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert r.status_code == 403


def test_physician_forbidden_admin_grant_credits(base_url):
    _, data = _register(base_url)
    tok = data["token"]
    r = requests.post(f"{base_url}/api/admin/users/{data['user']['user_id']}/grant-credits",
                      headers={"Authorization": f"Bearer {tok}"},
                      json={"amount": 10}, timeout=15)
    assert r.status_code == 403


def test_admin_endpoints_require_auth(base_url):
    assert requests.get(f"{base_url}/api/admin/overview", timeout=15).status_code == 401
    assert requests.get(f"{base_url}/api/admin/users", timeout=15).status_code == 401


# ---- admin overview shape ----
def test_admin_overview_shape(base_url, admin_client):
    r = admin_client.get(f"{base_url}/api/admin/overview", timeout=15)
    assert r.status_code == 200
    d = r.json()
    expected = {"total_users", "total_admins", "total_physicians", "google_users",
                "total_analyses", "total_credits_purchased", "total_credits_outstanding"}
    missing = expected - set(d.keys())
    assert not missing, f"missing admin overview keys: {missing}"
    assert d["total_admins"] >= 1
    assert d["total_users"] >= d["total_admins"]
    for k in expected:
        assert isinstance(d[k], int), f"{k} should be int, got {type(d[k])}"


# ---- admin users list shape ----
def test_admin_users_list_shape(base_url, admin_client):
    r = admin_client.get(f"{base_url}/api/admin/users", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "users" in d and isinstance(d["users"], list)
    assert len(d["users"]) >= 1
    row = d["users"][0]
    for k in ("user_id", "email", "name", "role", "auth_provider", "credits",
              "analyses", "created_at"):
        assert k in row, f"missing key {k} in admin users row"
    # ensure an admin row exists
    admin_rows = [u for u in d["users"] if u["role"] == "admin"]
    assert len(admin_rows) >= 1


# ---- grant credits flow ----
def test_admin_grant_credits_increases_balance(base_url, admin_client):
    email, data = _register(base_url)
    uid = data["user"]["user_id"]
    tok = data["token"]
    # verify starting credits
    me = requests.get(f"{base_url}/api/auth/me",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15).json()
    before = me["credits"]

    r = admin_client.post(f"{base_url}/api/admin/users/{uid}/grant-credits",
                          json={"amount": 25}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["credits"] == before + 25

    # verify persisted (admin users list)
    lst = admin_client.get(f"{base_url}/api/admin/users", timeout=15).json()["users"]
    match = [u for u in lst if u["user_id"] == uid]
    assert match and match[0]["credits"] == before + 25


def test_admin_grant_credits_unknown_user(base_url, admin_client):
    r = admin_client.post(f"{base_url}/api/admin/users/nonexistent_uid/grant-credits",
                          json={"amount": 5}, timeout=15)
    assert r.status_code == 404
