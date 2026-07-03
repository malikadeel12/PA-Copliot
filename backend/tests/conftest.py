import os, base64, io, pytest, requests
from PIL import Image, ImageDraw, ImageFont

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://docs-first-2.preview.emergentagent.com").rstrip("/")


def _make_doc_image(lines):
    img = Image.new("RGB", (900, 600), "white")
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    y = 30
    for ln in lines:
        d.text((30, y), ln, fill="black", font=font)
        y += 32
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def doc_images():
    return [
        _make_doc_image([
            "PATIENT IDENTIFICATION CARD",
            "Name: John Q. Sample",
            "DOB: 03/15/1970",
            "Sex: M",
            "MRN: 998877",
            "Address: 123 Main St, Boston MA",
            "Phone: 617-555-0123",
        ]),
        _make_doc_image([
            "BLUE CROSS BLUE SHIELD",
            "Member: John Q. Sample",
            "Member ID: XJK123456789",
            "Group #: 0055112",
            "RxBIN: 610014",
            "RxPCN: MEDDPRIME",
            "Plan: PPO",
        ]),
        _make_doc_image([
            "CLINICAL ORDER / PRIOR AUTHORIZATION",
            "Diagnosis: Type 2 Diabetes (E11.9)",
            "Requested Drug: Ozempic 1mg weekly",
            "CPT/HCPCS: J3490",
            "Prescriber: Dr. Jane Smith, NPI 1234567890",
            "Facility: Boston Endocrine Clinic",
            "Urgency: Standard",
        ]),
    ]


@pytest.fixture(scope="session")
def admin_client():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={
        "email": "dr.admin@pacopilot.health",
        "password": "PaCopilot2026!",
    }, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s
