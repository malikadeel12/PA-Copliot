require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { adminClient } = require("./supabase");
const { requireAuth, requireAdmin, publicUser } = require("./auth");
const ruleEngine = require("./ruleEngine");
const llm = require("./llm");
const paStore = require("./paStore");

const CREDIT_PACKS = { starter: 10, pro: 30, clinic: 100 };
const DEMO_MODE = (process.env.DEMO_MODE || "").toLowerCase() === "true";

const app = express();
app.use(express.json({ limit: "25mb" }));

const corsOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const corsCheck = (origin, cb) => {
  // Allow same-origin / server-to-server (no Origin header), explicit allow-list,
  // any *.vercel.app deploy, and localhost dev.
  if (!origin) return cb(null, true);
  if (corsOrigins.includes(origin)) return cb(null, true);
  try {
    const host = new URL(origin).hostname;
    if (host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1") return cb(null, true);
  } catch (_e) { /* ignore */ }
  return cb(null, false);
};
app.use(cors({ origin: corsCheck, credentials: true }));
app.options("*", cors({ origin: corsCheck, credentials: true }));

const api = express.Router();
const uid = (p) => `${p}_${crypto.randomBytes(8).toString("hex")}`;
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ detail: "Internal server error" });
});

async function countRows(table, filter) {
  let q = adminClient.from(table).select("*", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter || {})) q = q.eq(k, v);
  const { count } = await q;
  return count || 0;
}

// ---------------------------------------------------------------------------
// Identity  (sign-up / sign-in / Google OAuth are handled client-side by supabase-js)
// ---------------------------------------------------------------------------
api.get("/auth/me", requireAuth, (req, res) => res.json(publicUser(req.user)));

api.put("/profile", requireAuth, wrap(async (req, res) => {
  const allowed = ["name", "npi", "specialty", "facility_name", "facility_address", "signature_data_url"];
  const updates = {};
  for (const k of allowed) if (req.body?.[k] != null) updates[k] = req.body[k];
  if (Object.keys(updates).length) {
    await adminClient.from("profiles").update(updates).eq("id", req.user.id);
  }
  const { data } = await adminClient.from("profiles").select("*").eq("id", req.user.id).single();
  res.json(publicUser(data));
}));

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
api.get("/stats", requireAuth, wrap(async (req, res) => {
  const id = req.user.id;
  const total_analyses = await countRows("usage_events", { user_id: id, event_type: "pa_request_completed" });
  const credits_used = await countRows("credit_transactions", { user_id: id, type: "consume" });
  const { data: purchases } = await adminClient.from("credit_transactions").select("amount").eq("user_id", id).eq("type", "purchase");
  const credits_purchased = (purchases || []).reduce((s, d) => s + (d.amount || 0), 0);
  const { data: last } = await adminClient.from("usage_events").select("created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(1);
  res.json({
    total_analyses, credits_used, credits_purchased,
    credits_balance: req.user.credits || 0, member_since: req.user.created_at,
    last_activity: last?.[0]?.created_at || null,
  });
}));

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
api.get("/admin/overview", requireAuth, requireAdmin, wrap(async (req, res) => {
  const total_users = await countRows("profiles", {});
  const total_admins = await countRows("profiles", { role: "admin" });
  const total_analyses = await countRows("usage_events", { event_type: "pa_request_completed" });
  const { data: purchases } = await adminClient.from("credit_transactions").select("amount").eq("type", "purchase");
  const total_credits_purchased = (purchases || []).reduce((s, d) => s + (d.amount || 0), 0);
  const { data: balances } = await adminClient.from("profiles").select("credits");
  const total_credits_outstanding = (balances || []).reduce((s, d) => s + (d.credits || 0), 0);
  const google_users = await countRows("profiles", { auth_provider: "google" });
  res.json({
    total_users, total_admins, total_physicians: total_users - total_admins,
    google_users, total_analyses, total_credits_purchased, total_credits_outstanding,
  });
}));

api.get("/admin/users", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { data: docs } = await adminClient.from("profiles").select("*").order("created_at", { ascending: false }).limit(500);
  const users = [];
  for (const d of docs || []) {
    const analyses = await countRows("usage_events", { user_id: d.id, event_type: "pa_request_completed" });
    users.push({
      user_id: d.id, email: d.email, name: d.name ?? null, role: d.role || "physician",
      auth_provider: d.auth_provider || "email", credits: d.credits || 0, analyses, created_at: d.created_at,
    });
  }
  res.json({ users });
}));

api.post("/admin/users/:userId/grant-credits", requireAuth, requireAdmin, wrap(async (req, res) => {
  const { userId } = req.params;
  const amount = parseInt(req.body?.amount, 10);
  if (!Number.isFinite(amount)) return res.status(422).json({ detail: "amount must be a number" });
  const { data: target } = await adminClient.from("profiles").select("credits").eq("id", userId).maybeSingle();
  if (!target) return res.status(404).json({ detail: "User not found" });
  const newCredits = (target.credits || 0) + amount;
  await adminClient.from("profiles").update({ credits: newCredits }).eq("id", userId);
  await adminClient.from("credit_transactions").insert({ user_id: userId, type: "admin_grant", amount, granted_by: req.user.id });
  res.json({ user_id: userId, credits: newCredits });
}));

// ---------------------------------------------------------------------------
// Billing (mock credits)
// ---------------------------------------------------------------------------
api.post("/billing/mock-purchase", requireAuth, wrap(async (req, res) => {
  const amount = CREDIT_PACKS[req.body?.pack];
  if (!amount) return res.status(400).json({ detail: "Unknown credit pack" });
  const newCredits = (req.user.credits || 0) + amount;
  await adminClient.from("profiles").update({ credits: newCredits }).eq("id", req.user.id);
  await adminClient.from("credit_transactions").insert({ user_id: req.user.id, type: "purchase", amount, pack: req.body.pack });
  const { data } = await adminClient.from("profiles").select("*").eq("id", req.user.id).single();
  res.json(publicUser(data));
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
    request_id: requestId, user_id: req.user.id, created_at: Date.now(),
    extracted_data: extracted, dictation_transcript: null, user_confirmations: null, claude_result: null,
  });
  res.json({ request_id: requestId, extracted_data: extracted });
}));

api.post("/pa/:id/dictate", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  rec.dictation_transcript = req.body?.transcript || "";
  res.json({ ok: true });
}));

api.get("/pa/:id/grids", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.id);
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
  const rec = paStore.get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  rec.user_confirmations = req.body || {};
  res.json({ ok: true });
}));

api.post("/pa/:id/generate", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ detail: "Request session not found or expired" });
  const { data: fresh } = await adminClient.from("profiles").select("*").eq("id", req.user.id).single();
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

  const newCredits = (fresh.credits || 0) - 1;
  await adminClient.from("profiles").update({ credits: newCredits }).eq("id", req.user.id);
  await adminClient.from("credit_transactions").insert({ user_id: req.user.id, type: "consume", amount: -1 });
  await adminClient.from("usage_events").insert({ user_id: req.user.id, event_type: "pa_request_completed" });
  rec.claude_result = result;
  res.json({ result, credits: newCredits });
}));

api.post("/pa/:id/end", requireAuth, wrap(async (req, res) => {
  paStore.remove(req.params.id, req.user.id);
  res.json({ purged: true });
}));

api.get("/", (req, res) => res.json({ service: "PA Copilot API (Node/Express + Supabase)", status: "ok" }));

app.use("/api", api);

paStore.startSweeper();
const port = parseInt(process.env.PORT || "8001", 10);
app.listen(port, "0.0.0.0", () => console.log(`PA Copilot (Node + Supabase) listening on :${port}`));
