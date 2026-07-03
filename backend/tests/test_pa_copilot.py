import uuid, time, requests, pytest


# -------- Auth: register, me, protection --------
def test_root_public(base_url):
    r = requests.get(f"{base_url}/api/", timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_protected_requires_auth(base_url):
    assert requests.get(f"{base_url}/api/auth/me", timeout=15).status_code == 401
    assert requests.put(f"{base_url}/api/profile", json={"name": "x"}, timeout=15).status_code == 401
    assert requests.post(f"{base_url}/api/pa/capture", json={"images": []}, timeout=15).status_code == 401


def test_reference_public(base_url):
    r = requests.get(f"{base_url}/api/reference", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "portals" in body and "presets" in body
    assert isinstance(body["portals"], (list, dict))


@pytest.fixture(scope="module")
def new_user(base_url):
    email = f"test_{uuid.uuid4().hex[:8]}@pacopilot-tests.com"
    pw = "Password123!"
    s = requests.Session()
    r = s.post(f"{base_url}/api/auth/register", json={
        "email": email, "password": pw, "name": "Test User"
    }, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["credits"] == 5
    assert data["user"]["email"] == email
    assert "token" in data
    s.headers.update({"Authorization": f"Bearer {data['token']}"})
    return {"session": s, "email": email, "password": pw, "token": data["token"], "user": data["user"]}


def test_register_duplicate(base_url, new_user):
    r = requests.post(f"{base_url}/api/auth/register", json={
        "email": new_user["email"], "password": "abc", "name": "X"
    }, timeout=15)
    assert r.status_code == 400


def test_login_and_me(base_url, new_user):
    r = requests.post(f"{base_url}/api/auth/login",
                      json={"email": new_user["email"], "password": new_user["password"]},
                      timeout=15)
    assert r.status_code == 200
    tok = r.json()["token"]
    me = requests.get(f"{base_url}/api/auth/me",
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    assert me.status_code == 200
    assert me.json()["email"] == new_user["email"]
    assert me.json()["credits"] >= 5


def test_login_bad_password(base_url, new_user):
    r = requests.post(f"{base_url}/api/auth/login",
                      json={"email": new_user["email"], "password": "wrong"},
                      timeout=15)
    assert r.status_code == 401


def test_profile_update(base_url, new_user):
    s = new_user["session"]
    r = s.put(f"{base_url}/api/profile", json={
        "name": "Dr. Test", "npi": "1112223333", "specialty": "Endocrinology",
        "facility_name": "Test Clinic", "facility_address": "1 Test Rd",
    }, timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d["name"] == "Dr. Test"
    assert d["npi"] == "1112223333"
    assert d["specialty"] == "Endocrinology"
    # verify persistence via /me
    me = s.get(f"{base_url}/api/auth/me", timeout=15).json()
    assert me["name"] == "Dr. Test"
    assert me["facility_name"] == "Test Clinic"


# -------- Billing --------
def test_mock_purchase_unknown_pack(base_url, new_user):
    r = new_user["session"].post(f"{base_url}/api/billing/mock-purchase",
                                 json={"pack": "xxx"}, timeout=15)
    assert r.status_code == 400


def test_mock_purchase_starter(base_url, new_user):
    s = new_user["session"]
    before = s.get(f"{base_url}/api/auth/me", timeout=15).json()["credits"]
    r = s.post(f"{base_url}/api/billing/mock-purchase", json={"pack": "starter"}, timeout=15)
    assert r.status_code == 200
    after = r.json()["credits"]
    assert after == before + 10


# -------- PA capture (real OCR) --------
@pytest.fixture(scope="module")
def captured_request(base_url, new_user, doc_images):
    s = new_user["session"]
    r = s.post(f"{base_url}/api/pa/capture", json={"images": doc_images}, timeout=120)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["request_id"].startswith("req_")
    ex = d["extracted_data"]
    assert isinstance(ex, dict)
    # Expect at least one of the required top-level keys
    keys = set(ex.keys())
    assert keys & {"PatientInformation", "InsuranceInformation", "DiagnosisInformation",
                   "OrderInformation", "PrescriberInformation"}, f"OCR keys: {keys}"
    return {"request_id": d["request_id"], "extracted": ex, "session": s}


def test_capture_empty_body(base_url, new_user):
    r = new_user["session"].post(f"{base_url}/api/pa/capture", json={"images": []}, timeout=15)
    assert r.status_code == 400


def test_dictate_and_grids(base_url, captured_request):
    s = captured_request["session"]
    rid = captured_request["request_id"]
    transcript = ("Patient with type 2 diabetes uncontrolled on metformin. "
                  "A1c 9.1. Requesting Ozempic 1mg weekly, standard urgency.")
    r = s.post(f"{base_url}/api/pa/{rid}/dictate", json={"transcript": transcript}, timeout=15)
    assert r.status_code == 200

    g = s.get(f"{base_url}/api/pa/{rid}/grids", timeout=15)
    assert g.status_code == 200
    gd = g.json()
    for k in ("portal_match", "portals", "crosswalk", "presets"):
        assert k in gd


def test_confirm(base_url, captured_request):
    s = captured_request["session"]
    rid = captured_request["request_id"]
    r = s.post(f"{base_url}/api/pa/{rid}/confirm", json={
        "recommended_portal": "CoverMyMeds",
        "confirmed_codes": [{"code": "J3490", "type": "CPT"}],
        "modifiers": [], "quantity_duration": "4 pens / 30 days",
        "place_of_service": "11", "urgent": False, "request_type": "Initial"
    }, timeout=15)
    assert r.status_code == 200


def test_generate_and_credit_decrement(base_url, captured_request):
    s = captured_request["session"]
    rid = captured_request["request_id"]
    before = s.get(f"{base_url}/api/auth/me", timeout=15).json()["credits"]
    r = s.post(f"{base_url}/api/pa/{rid}/generate", timeout=180)
    assert r.status_code == 200, r.text
    body = r.json()
    result = body["result"]
    for k in ("filled_form", "analysis", "suggestions", "cover_letter", "submission_info"):
        assert k in result, f"missing key {k}"
    an = result["analysis"]
    assert "approval_probability_pct" in an
    after = body["credits"]
    assert after == before - 1


def test_generate_insufficient_credits(base_url, doc_images):
    # register user, force credits to 0 by attempting many generates? easier: register and set via mongo? not available.
    # Instead: register new user with 5 credits, drain by 5 generates would be slow; skip actual drain,
    # use admin to purchase and then simulate via direct: not possible.
    # Simplest: use a fresh user with 0 credits path by driving generate 5 times is expensive.
    # We simulate by using a fresh capture then calling generate 6 times isn't reasonable.
    # So we just verify the 402 path when credits reach zero via a shortcut: try until 402 or up to 6 iters.
    import uuid, requests
    s = requests.Session()
    email = f"drain_{uuid.uuid4().hex[:8]}@pacopilot-tests.com"
    r = s.post(f"{base_url}/api/auth/register",
               json={"email": email, "password": "P@ssw0rd!", "name": "Drain"}, timeout=15)
    assert r.status_code == 200
    tok = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {tok}"})
    # Capture once
    cap = s.post(f"{base_url}/api/pa/capture",
                 json={"images": doc_images}, timeout=120)
    assert cap.status_code == 200
    rid = cap.json()["request_id"]
    # confirm minimally
    s.post(f"{base_url}/api/pa/{rid}/confirm", json={"confirmed_codes":[{"code":"J3490"}]}, timeout=15)
    saw_402 = False
    for i in range(6):
        me = s.get(f"{base_url}/api/auth/me", timeout=15).json()
        if me["credits"] == 0:
            g = s.post(f"{base_url}/api/pa/{rid}/generate", timeout=180)
            assert g.status_code == 402
            saw_402 = True
            break
        g = s.post(f"{base_url}/api/pa/{rid}/generate", timeout=180)
        if g.status_code == 402:
            saw_402 = True
            break
        assert g.status_code == 200, g.text
    assert saw_402, "Expected to see 402 after draining credits"


def test_end_purges(base_url, captured_request):
    s = captured_request["session"]
    rid = captured_request["request_id"]
    r = s.post(f"{base_url}/api/pa/{rid}/end", timeout=15)
    assert r.status_code == 200
    g = s.get(f"{base_url}/api/pa/{rid}/grids", timeout=15)
    assert g.status_code == 404


def test_admin_login_and_purchase(base_url, admin_client):
    r = admin_client.get(f"{base_url}/api/auth/me", timeout=15)
    assert r.status_code == 200
    before = r.json()["credits"]
    p = admin_client.post(f"{base_url}/api/billing/mock-purchase", json={"pack": "pro"}, timeout=15)
    assert p.status_code == 200
    assert p.json()["credits"] == before + 30
    p2 = admin_client.post(f"{base_url}/api/billing/mock-purchase", json={"pack": "clinic"}, timeout=15)
    assert p2.json()["credits"] == before + 30 + 100
