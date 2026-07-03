from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import asyncio
import httpx
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from auth import hash_password, verify_password, create_access_token, decode_access_token
import rule_engine
import llm_service

# ---------------------------------------------------------------------------
mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("pa_copilot")

app = FastAPI(title="PA Copilot API")
api = APIRouter(prefix="/api")

SIGNUP_FREE_CREDITS = 5
SESSION_TTL_MINUTES = 30
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

# ---------------------------------------------------------------------------
# In-memory ephemeral PA request store (NO PHI ever persisted to DB)
# ---------------------------------------------------------------------------
PA_STORE: dict[str, dict] = {}


def _purge_expired():
    now = datetime.now(timezone.utc)
    expired = [rid for rid, rec in PA_STORE.items()
               if now - rec["created_at"] > timedelta(minutes=SESSION_TTL_MINUTES)]
    for rid in expired:
        PA_STORE.pop(rid, None)


async def _ttl_sweep():
    while True:
        await asyncio.sleep(60)
        try:
            _purge_expired()
        except Exception as e:
            logger.error(f"TTL sweep error: {e}")


def _get_record(request_id: str, user_id: str) -> dict:
    _purge_expired()
    rec = PA_STORE.get(request_id)
    if not rec or rec["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Request session not found or expired")
    return rec


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ProfileIn(BaseModel):
    name: Optional[str] = None
    npi: Optional[str] = None
    specialty: Optional[str] = None
    facility_name: Optional[str] = None
    facility_address: Optional[str] = None
    signature_data_url: Optional[str] = None


class CaptureIn(BaseModel):
    images: List[str] = Field(default_factory=list)  # base64 / data URLs


class DictateIn(BaseModel):
    transcript: str


class ConfirmIn(BaseModel):
    recommended_portal: Optional[str] = None
    portal_category: Optional[str] = None
    confirmed_codes: List[dict] = Field(default_factory=list)
    modifiers: List[str] = Field(default_factory=list)
    quantity_duration: Optional[str] = None
    place_of_service: Optional[str] = None
    urgent: bool = False
    urgency_justification: Optional[str] = None
    request_type: Optional[str] = "Initial"


class MockPurchaseIn(BaseModel):
    pack: str  # 'starter' | 'pro' | 'clinic'


def public_user(doc: dict) -> dict:
    return {
        "user_id": doc["user_id"],
        "email": doc["email"],
        "name": doc.get("name"),
        "npi": doc.get("npi"),
        "specialty": doc.get("specialty"),
        "facility_name": doc.get("facility_name"),
        "facility_address": doc.get("facility_address"),
        "signature_data_url": doc.get("signature_data_url"),
        "credits": doc.get("credits", 0),
        "auth_provider": doc.get("auth_provider", "password"),
    }


# ---------------------------------------------------------------------------
# Auth dependency (supports JWT access_token AND Emergent session_token)
# ---------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    # gather candidate tokens
    bearer = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        bearer = auth_header[7:]

    jwt_token = request.cookies.get("access_token") or bearer
    if jwt_token:
        payload = decode_access_token(jwt_token)
        if payload:
            doc = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0})
            if doc:
                return doc

    session_token = request.cookies.get("session_token") or bearer
    if session_token:
        sess = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
        if sess:
            exp = sess["expires_at"]
            if isinstance(exp, str):
                exp = datetime.fromisoformat(exp)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp >= datetime.now(timezone.utc):
                doc = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})
                if doc:
                    return doc

    raise HTTPException(status_code=401, detail="Not authenticated")


def set_jwt_cookie(response: Response, token: str):
    response.set_cookie("access_token", token, httponly=True, secure=True,
                        samesite="none", max_age=604800, path="/")


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------
@api.post("/auth/register")
async def register(body: RegisterIn, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="An account with this email already exists")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id, "email": email, "password_hash": hash_password(body.password),
        "name": body.name, "auth_provider": "password", "credits": SIGNUP_FREE_CREDITS,
        "npi": None, "specialty": None, "facility_name": None, "facility_address": None,
        "signature_data_url": None, "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await db.credit_transactions.insert_one({
        "user_id": user_id, "type": "signup_grant", "amount": SIGNUP_FREE_CREDITS,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = create_access_token(user_id, email)
    set_jwt_cookie(response, token)
    return {"user": public_user(doc), "token": token}


@api.post("/auth/login")
async def login(body: LoginIn, response: Response):
    email = body.email.lower()
    doc = await db.users.find_one({"email": email})
    if not doc or not doc.get("password_hash") or not verify_password(body.password, doc["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(doc["user_id"], email)
    set_jwt_cookie(response, token)
    return {"user": public_user(doc), "token": token}


@api.post("/auth/session")
async def emergent_session(request: Request, response: Response):
    """Exchange Emergent session_id for a stored session_token + user."""
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing X-Session-ID")
    async with httpx.AsyncClient(timeout=20) as hc:
        r = await hc.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": session_id})
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = r.json()
    email = data["email"].lower()
    doc = await db.users.find_one({"email": email})
    if not doc:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        doc = {
            "user_id": user_id, "email": email, "password_hash": None,
            "name": data.get("name"), "auth_provider": "google", "credits": SIGNUP_FREE_CREDITS,
            "npi": None, "specialty": None, "facility_name": None, "facility_address": None,
            "signature_data_url": data.get("picture"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(doc)
        await db.credit_transactions.insert_one({
            "user_id": user_id, "type": "signup_grant", "amount": SIGNUP_FREE_CREDITS,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    session_token = data["session_token"]
    await db.user_sessions.insert_one({
        "user_id": doc["user_id"], "session_token": session_token,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    response.set_cookie("session_token", session_token, httponly=True, secure=True,
                        samesite="none", max_age=604800, path="/")
    return {"user": public_user(doc)}


@api.post("/auth/logout")
async def logout(request: Request, response: Response):
    st = request.cookies.get("session_token")
    if st:
        await db.user_sessions.delete_many({"session_token": st})
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return public_user(user)


@api.put("/profile")
async def update_profile(body: ProfileIn, user: dict = Depends(get_current_user)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if updates:
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": updates})
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(doc)


# ---------------------------------------------------------------------------
# Billing (mock credits)
# ---------------------------------------------------------------------------
CREDIT_PACKS = {"starter": 10, "pro": 30, "clinic": 100}


@api.post("/billing/mock-purchase")
async def mock_purchase(body: MockPurchaseIn, user: dict = Depends(get_current_user)):
    amount = CREDIT_PACKS.get(body.pack)
    if not amount:
        raise HTTPException(status_code=400, detail="Unknown credit pack")
    await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"credits": amount}})
    await db.credit_transactions.insert_one({
        "user_id": user["user_id"], "type": "purchase", "amount": amount,
        "pack": body.pack, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return public_user(doc)


# ---------------------------------------------------------------------------
# PA request pipeline
# ---------------------------------------------------------------------------
@api.get("/reference")
async def reference():
    return {**rule_engine.reference_meta(), "portals": rule_engine.PAYER_PORTAL_MATRIX,
            "presets": rule_engine.get_presets()}


@api.post("/pa/capture")
async def pa_capture(body: CaptureIn, user: dict = Depends(get_current_user)):
    if not body.images:
        raise HTTPException(status_code=400, detail="No document images provided")
    try:
        extracted = await llm_service.extract_documents(body.images)
    except Exception as e:
        logger.error(f"OCR failed: {e}")
        raise HTTPException(status_code=502, detail="Document extraction failed. Please retry with clearer photos.")
    request_id = f"req_{uuid.uuid4().hex[:16]}"
    PA_STORE[request_id] = {
        "request_id": request_id, "user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc),
        "extracted_data": extracted, "dictation_transcript": None,
        "user_confirmations": None, "claude_result": None,
    }
    return {"request_id": request_id, "extracted_data": extracted}


@api.post("/pa/{request_id}/dictate")
async def pa_dictate(request_id: str, body: DictateIn, user: dict = Depends(get_current_user)):
    rec = _get_record(request_id, user["user_id"])
    rec["dictation_transcript"] = body.transcript
    return {"ok": True}


@api.get("/pa/{request_id}/grids")
async def pa_grids(request_id: str, user: dict = Depends(get_current_user)):
    rec = _get_record(request_id, user["user_id"])
    ex = rec["extracted_data"] or {}
    ins = ex.get("InsuranceInformation", {}) or {}
    diag = ex.get("DiagnosisInformation", {}) or {}
    icds = []
    if diag.get("PrimaryICD10Code"):
        icds.append(diag["PrimaryICD10Code"])
    icds += diag.get("AdditionalICD10Codes", []) or []
    return {
        "portal_match": rule_engine.match_portal(ins.get("PayerName"), ins.get("RxBIN")),
        "portals": rule_engine.PAYER_PORTAL_MATRIX,
        "crosswalk": rule_engine.crosswalk_for_icds(icds),
        "presets": rule_engine.get_presets(),
        "request_type": ins.get("RequestType") or "Initial",
    }


@api.post("/pa/{request_id}/confirm")
async def pa_confirm(request_id: str, body: ConfirmIn, user: dict = Depends(get_current_user)):
    rec = _get_record(request_id, user["user_id"])
    rec["user_confirmations"] = body.model_dump()
    return {"ok": True}


@api.post("/pa/{request_id}/generate")
async def pa_generate(request_id: str, user: dict = Depends(get_current_user)):
    rec = _get_record(request_id, user["user_id"])
    fresh = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if (fresh.get("credits", 0)) < 1:
        raise HTTPException(status_code=402, detail="Insufficient credits. Please purchase more to continue.")

    confirmations = rec.get("user_confirmations") or {}
    codes = [c.get("code") for c in confirmations.get("confirmed_codes", []) if c.get("code")]
    payload = {
        "extracted_data": rec.get("extracted_data"),
        "dictation_transcript": rec.get("dictation_transcript"),
        "user_confirmations": confirmations,
        "policy_context": rule_engine.policy_context_for(codes),
        "request_type": confirmations.get("request_type") or "Initial",
        "prescriber_profile": {
            "name": fresh.get("name"), "npi": fresh.get("npi"),
            "specialty": fresh.get("specialty"), "facility_name": fresh.get("facility_name"),
            "facility_address": fresh.get("facility_address"),
        },
    }
    try:
        result = await llm_service.run_reasoning(payload)
    except Exception as e:
        logger.error(f"Reasoning failed: {e}")
        raise HTTPException(status_code=502, detail="AI analysis failed. Please try again.")

    # decrement 1 credit only on successful generation
    await db.users.update_one({"user_id": user["user_id"]}, {"$inc": {"credits": -1}})
    await db.credit_transactions.insert_one({
        "user_id": user["user_id"], "type": "consume", "amount": -1,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.usage_events.insert_one({
        "user_id": user["user_id"], "event_type": "pa_request_completed",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    rec["claude_result"] = result
    doc = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"result": result, "credits": doc.get("credits", 0)}


@api.post("/pa/{request_id}/end")
async def pa_end(request_id: str, user: dict = Depends(get_current_user)):
    """Explicit session end / auto-purge."""
    rec = PA_STORE.get(request_id)
    if rec and rec["user_id"] == user["user_id"]:
        PA_STORE.pop(request_id, None)
    return {"purged": True}


@api.get("/")
async def root():
    return {"service": "PA Copilot API", "status": "ok"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token")
    # seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if admin_email and admin_pw:
        existing = await db.users.find_one({"email": admin_email})
        if not existing:
            await db.users.insert_one({
                "user_id": f"user_{uuid.uuid4().hex[:12]}", "email": admin_email,
                "password_hash": hash_password(admin_pw), "name": "Admin Physician",
                "auth_provider": "password", "credits": 100, "role": "admin",
                "npi": None, "specialty": None, "facility_name": None,
                "facility_address": None, "signature_data_url": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        elif not verify_password(admin_pw, existing.get("password_hash") or ""):
            await db.users.update_one({"email": admin_email},
                                      {"$set": {"password_hash": hash_password(admin_pw)}})
    asyncio.create_task(_ttl_sweep())


@app.on_event("shutdown")
async def shutdown():
    client.close()
