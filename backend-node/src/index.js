require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const axios = require("axios");

const { connectDb, getDb } = require("./db");
const {
  SIGNUP_FREE_CREDITS, hashPassword, verifyPassword, createAccessToken,
  publicUser, setJwtCookie, cookieOptions, requireAuth, requireAdmin,
} = require("./auth");
const ruleEngine = require("./ruleEngine");
const llm = require("./llm");
const paStore = require("./paStore");

const EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data";
const CREDIT_PACKS = { starter: 10, pro: 30, clinic: 100 };

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

const corsOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : true, // reflect origin if none set
  credentials: true,
}));

const api = express.Router();
const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}_${crypto.randomBytes(8).toString("hex")}`;
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ detail: "Internal server error" });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
api.post("/auth/register", wrap(async (req, res) => {
  const db = getDb();
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(422).json({ detail: "email, password and name are required" });
  const em = email.toLowerCase();
  if (await db.collection("users").findOne({ email: em })) {
    return res.status(400).json({ detail: "An account with this email already exists" });
  }
  const userId = uid("user");
  const doc = {
    user_id: userId, email: em, password_hash: hashPassword(password), name,
    auth_provider: "password", credits: SIGNUP_FREE_CREDITS, role: "physician",
    npi: null, specialty: null, facility_name: null, facility_address: null,
    signature_data_url: null, created_at: nowIso(),
  };
  await db.collection("users").insertOne(doc);
  await db.collection("credit_transactions").insertOne({ user_id: userId, type: "signup_grant", amount: SIGNUP_FREE_CREDITS, created_at: nowIso() });
  const token = createAccessToken(userId, em);
  setJwtCookie(res, token);
  res.json({ user: publicUser(doc), token });
}));

api.post("/auth/login", wrap(async (req, res) => {
  const db = getDb();
  const { email, password } = req.body || {};
  const em = (email || "").toLowerCase();
  const doc = await db.collection("users").findOne({ email: em });
  if (!doc || !doc.password_hash || !verifyPassword(password || "", doc.password_hash)) {
    return res.status(401).json({ detail: "Invalid email or password" });
  }
  const token = createAccessToken(doc.user_id, em);
  setJwtCookie(res, token);
  res.json({ user: publicUser(doc), token });
}));

api.post("/auth/session", wrap(async (req, res) => {
  const db = getDb();
  const sessionId = req.headers["x-session-id"];
  if (!sessionId) return res.status(400).json({ detail: "Missing X-Session-ID" });
  let data;
  try {
    const r = await axios.get(EMERGENT_SESSION_URL, { headers: { "X-Session-ID": sessionId }, timeout: 20000 });
    data = r.data;
  } catch {
    return res.status(401).json({ detail: "Invalid session" });
  }
  const em = data.email.toLowerCase();
  let doc = await db.collection("users").findOne({ email: em });
  if (!doc) {
    const userId = uid("user");
    doc = {
      user_id: userId, email: em, password_hash: null, name: data.name || null,
      auth_provider: "google", credits: SIGNUP_FREE_CREDITS, role: "physician",
      npi: null, specialty: null, facility_name: null, facility_address: null,
      signature_data_url: data.picture || null, created_at: nowIso(),
    };
    await db.collection("users").insertOne(doc);
    await db.collection("credit_transactions").insertOne({ user_id: userId, type: "signup_grant", amount: SIGNUP_FREE_CREDITS, created_at: nowIso() });
  }
  const sessionToken = data.session_token;
  await db.collection("user_sessions").insertOne({
    user_id: doc.user_id, session_token: sessionToken,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), created_at: nowIso(),
  });
  res.cookie("session_token", sessionToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
  res.json({ user: publicUser(doc) });
}));

api.post("/auth/logout", wrap(async (req, res) => {
  const db = getDb();
  const st = req.cookies?.session_token;
  if (st) await db.collection("user_sessions").deleteMany({ session_token: st });
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("session_token", { path: "/" });
  res.json({ ok: true });
}));

api.get("/auth/me", requireAuth, (req, res) => res.json(publicUser(req.user)));

api.put("/profile", requireAuth, wrap(async (req, res) => {
  const db = getDb();
  const allowed = ["name", "npi", "specialty", "facility_name", "facility_address", "signature_data_url"];
  const updates = {};
  for (const k of allowed) if (req.body?.[k] != null) updates[k] = req.body[k];
  if (Object.keys(updates).length) await db.collection("users").updateOne({ user_id: req.user.user_id }, { $set: updates });
  const doc = await db.collection("users").findOne({ user_id: req.user.user_id }, { projection: { _id: 0 } });
  res.json(publicUser(doc));
}));

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
api.get("/stats", requireAuth, wrap(async (req, res) => {
  const db = getDb();
  const uidv = req.user.user_id;
  const total_analyses = await db.collection("usage_events").countDocuments({ user_id: uidv, event_type: "pa_request_completed" });
  const credits_used = await db.collection("credit_transactions").countDocuments({ user_id: uidv, type: "consume" });
  const purchases = await db.collection("credit_transactions").find({ user_id: uidv, type: "purchase" }, { projection: { _id: 0, amount: 1 } }).toArray();
  const credits_purchased = purchases.reduce((s, d) => s + (d.amount || 0), 0);
  const last = await db.collection("usage_events").find({ user_id: uidv }, { projection: { _id: 0, created_at: 1 } }).sort({ created_at: -1 }).limit(1).toArray();
  res.json({
    total_analyses, credits_used, credits_purchased,
    credits_balance: req.user.credits || 0, member_since: req.user.created_at,
    last_activity: last[0]?.created_at || null,
  });
}));

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
api.get("/admin/overview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const db = getDb();
  const total_users = await db.collection("users").countDocuments({});
  const total_admins = await db.collection("users").countDocuments({ role: "admin" });
  const total_analyses = await db.collection("usage_events").countDocuments({ event_type: "pa_request_completed" });
  const purchases = await db.collection("credit_transactions").find({ type: "purchase" }, { projection: { _id: 0, amount: 1 } }).toArray();
  const total_credits_purchased = purchases.reduce((s, d) => s + (d.amount || 0), 0);
  const balances = await db.collection("users").find({}, { projection: { _id: 0, credits: 1 } }).toArray();
  const total_credits_outstanding = balances.reduce((s, d) => s + (d.credits || 0), 0);
  const google_users = await db.collection("users").countDocuments({ auth_provider: "google" });
  res.json({
    total_users, total_admins, total_physicians: total_users - total_admins,
    google_users, total_analyses, total_credits_purchased, total_credits_outstanding,
  });
}));

api.get("/admin/users", requireAuth, requireAdmin, wrap(async (req, res) => {
  const db = getDb();
  const docs = await db.collection("users").find({}, { projection: { _id: 0, password_hash: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
  const users = [];
  for (const d of docs) {
    const analyses = await db.collection("usage_events").countDocuments({ user_id: d.user_id, event_type: "pa_request_completed" });
    users.push({
      user_id: d.user_id, email: d.email, name: d.name ?? null, role: d.role || "physician",
      auth_provider: d.auth_provider || "password", credits: d.credits || 0, analyses, created_at: d.created_at,
    });
  }
  res.json({ users });
}));

api.post("/admin/users/:userId/grant-credits", requireAuth, requireAdmin, wrap(async (req, res) => {
  const db = getDb();
  const { userId } = req.params;
  const amount = parseInt(req.body?.amount, 10);
  if (!Number.isFinite(amount)) return res.status(422).json({ detail: "amount must be a number" });
  const target = await db.collection("users").findOne({ user_id: userId });
  if (!target) return res.status(404).json({ detail: "User not found" });
  await db.collection("users").updateOne({ user_id: userId }, { $inc: { credits: amount } });
  await db.collection("credit_transactions").insertOne({ user_id: userId, type: "admin_grant", amount, granted_by: req.user.user_id, created_at: nowIso() });
  const doc = await db.collection("users").findOne({ user_id: userId }, { projection: { _id: 0 } });
  res.json({ user_id: userId, credits: doc.credits || 0 });
}));

// ---------------------------------------------------------------------------
// Billing (mock credits)
// ---------------------------------------------------------------------------
api.post("/billing/mock-purchase", requireAuth, wrap(async (req, res) => {
  const db = getDb();
  const amount = CREDIT_PACKS[req.body?.pack];
  if (!amount) return res.status(400).json({ detail: "Unknown credit pack" });
  await db.collection("users").updateOne({ user_id: req.user.user_id }, { $inc: { credits: amount } });
  await db.collection("credit_transactions").insertOne({ user_id: req.user.user_id, type: "purchase", amount, pack: req.body.pack, created_at: nowIso() });
  const doc = await db.collection("users").findOne({ user_id: req.user.user_id }, { projection: { _id: 0 } });
  res.json(publicUser(doc));
}));

// ---------------------------------------------------------------------------
// PA pipeline
// ---------------------------------------------------------------------------
api.get("/reference", wrap(async (req, res) => {
  res.json({ ...ruleEngine.referenceMeta(), portals: ruleEngine.PAYER_PORTAL_MATRIX, presets: ruleEngine.getPresets() });
}));

api.post("/pa/capture", requireAuth, wrap(async (req, res) => {
  const images = req.body?.images || [];
  if (!images.length) return res.status(400).json({ detail: "No document images provided" });
  let extracted;
  try {
    extracted = await llm.extractDocuments(images);
  } catch (e) {
    console.error("OCR failed:", e.message);
    return res.status(502).json({ detail: "Document extraction failed. Please retry with clearer photos." });
  }
  const requestId = uid("req");
  paStore.put(requestId, {
    request_id: requestId, user_id: req.user.user_id, created_at: Date.now(),
    extracted_data: extracted, dictation_transcript: null, user_confirmations: null, claude_result: null,
  });
  res.json({ request_id: requestId, extracted_data: extracted });
}));

api.post("/pa/:id/dictate", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.user_id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  rec.dictation_transcript = req.body?.transcript || "";
  res.json({ ok: true });
}));

api.get("/pa/:id/grids", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.user_id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  const ex = rec.extracted_data || {};
  const ins = ex.InsuranceInformation || {};
  const diag = ex.DiagnosisInformation || {};
  const icds = [];
  if (diag.PrimaryICD10Code) icds.push(diag.PrimaryICD10Code);
  for (const c of diag.AdditionalICD10Codes || []) icds.push(c);
  res.json({
    portal_match: ruleEngine.matchPortal(ins.PayerName),
    portals: ruleEngine.PAYER_PORTAL_MATRIX,
    crosswalk: ruleEngine.crosswalkForIcds(icds),
    presets: ruleEngine.getPresets(),
    request_type: ins.RequestType || "Initial",
  });
}));

api.post("/pa/:id/confirm", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.user_id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  rec.user_confirmations = req.body || {};
  res.json({ ok: true });
}));

api.post("/pa/:id/generate", requireAuth, wrap(async (req, res) => {
  const db = getDb();
  const rec = paStore.get(req.params.id, req.user.user_id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  const fresh = await db.collection("users").findOne({ user_id: req.user.user_id }, { projection: { _id: 0 } });
  if ((fresh.credits || 0) < 1) return res.status(402).json({ detail: "Insufficient credits. Please purchase more to continue." });

  const confirmations = rec.user_confirmations || {};
  const codes = (confirmations.confirmed_codes || []).map((c) => c.code).filter(Boolean);
  const payload = {
    extracted_data: rec.extracted_data,
    dictation_transcript: rec.dictation_transcript,
    user_confirmations: confirmations,
    policy_context: ruleEngine.policyContextFor(codes),
    request_type: confirmations.request_type || "Initial",
    prescriber_profile: {
      name: fresh.name, npi: fresh.npi, specialty: fresh.specialty,
      facility_name: fresh.facility_name, facility_address: fresh.facility_address,
    },
  };

  let result;
  try {
    result = await llm.runReasoning(payload);
  } catch (e) {
    console.error("Reasoning failed:", e.message);
    return res.status(502).json({ detail: "AI analysis failed. Please try again." });
  }

  await db.collection("users").updateOne({ user_id: req.user.user_id }, { $inc: { credits: -1 } });
  await db.collection("credit_transactions").insertOne({ user_id: req.user.user_id, type: "consume", amount: -1, created_at: nowIso() });
  await db.collection("usage_events").insertOne({ user_id: req.user.user_id, event_type: "pa_request_completed", created_at: nowIso() });
  rec.claude_result = result;
  const doc = await db.collection("users").findOne({ user_id: req.user.user_id }, { projection: { _id: 0 } });
  res.json({ result, credits: doc.credits || 0 });
}));

api.post("/pa/:id/end", requireAuth, wrap(async (req, res) => {
  paStore.remove(req.params.id, req.user.user_id);
  res.json({ purged: true });
}));

api.get("/", (req, res) => res.json({ service: "PA Copilot API (Node/Express)", status: "ok" }));

app.use("/api", api);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function seedAdmin() {
  const db = getDb();
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || "";
  if (!email || !pw) return;
  const existing = await db.collection("users").findOne({ email });
  if (!existing) {
    await db.collection("users").insertOne({
      user_id: uid("user"), email, password_hash: hashPassword(pw), name: "Admin Physician",
      auth_provider: "password", credits: 100, role: "admin",
      npi: null, specialty: null, facility_name: null, facility_address: null,
      signature_data_url: null, created_at: nowIso(),
    });
  } else if (!verifyPassword(pw, existing.password_hash || "")) {
    await db.collection("users").updateOne({ email }, { $set: { password_hash: hashPassword(pw) } });
  }
}

(async () => {
  await connectDb();
  await seedAdmin();
  paStore.startSweeper();
  const port = parseInt(process.env.PORT || "8001", 10);
  app.listen(port, "0.0.0.0", () => console.log(`PA Copilot (Node) listening on :${port}`));
})();
