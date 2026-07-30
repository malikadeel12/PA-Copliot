require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { adminClient } = require("./supabase");
const { requireAuth, publicUser, isEmailVerified } = require("./auth");
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
api.get("/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));
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

// Naive per-IP rate limiter for the anonymous /auth/check-email endpoint.
// Without this an attacker could enumerate which emails are registered by
// timing the response. 5 reqs/min per IP is more than enough for the intended
// use (signup form checking one email) and stops casual enumeration.
const _checkEmailHits = new Map();
function checkEmailRateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.ip || "unknown";
  const now = Date.now();
  const windowStart = now - 60_000;
  const hits = (_checkEmailHits.get(ip) || []).filter((t) => t > windowStart);
  if (hits.length >= 5) return res.status(429).json({ detail: "Too many checks. Please try again shortly." });
  hits.push(now);
  _checkEmailHits.set(ip, hits);
  // Drop stale entries so the map doesn't grow unbounded.
  if (_checkEmailHits.size > 5000) {
    for (const [k, v] of _checkEmailHits) if (!v.some((t) => t > windowStart)) _checkEmailHits.delete(k);
  }
  next();
}

// Anonymous existence check for a given email. Supabase's `signUp` is the
// authoritative source of truth but, with "Enable email confirmations" on,
// GoTrue silently swallows the duplicate signup and returns an obfuscated
// fake user (user exists, no session) to prevent enumeration. That breaks
// our own UI — we can't tell whether the verification email was actually
// sent or the user already has an account. This endpoint uses the admin
// API to look up the email up-front so the frontend can route correctly.
api.post("/auth/check-email", checkEmailRateLimit, wrap(async (req, res) => {
  const raw = req.body?.email;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ detail: "A valid email is required." });
  }
  // listUsers only supports pagination — page through and filter locally.
  // Per page of 1000 is large enough that a typical physician app will
  // fit in one round-trip; the loop handles the rare overflow case.
  let page = 1;
  const perPage = 1000;
  let match = null;
  while (page <= 20) {  // hard cap at 20 pages to avoid infinite pagination
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("listUsers failed:", error.message);
      return res.status(500).json({ detail: "Could not check email availability." });
    }
    const users = (data && data.users) || [];
    match = users.find((u) => (u.email || "").toLowerCase() === email);
    if (match) break;
    if (users.length < perPage) break;  // last page
    page += 1;
  }
  if (!match) {
    return res.json({ exists: false, email_confirmed_at: null });
  }
  res.json({
    exists: true,
    email_confirmed_at: match.email_confirmed_at || null,
    providers: (match.identities || []).map((i) => i.provider).filter(Boolean),
  });
}));

api.get("/auth/me", requireAuth, (req, res) => {
  const u = publicUser(req.user);
  u.email_verified = isEmailVerified(req.user);
  res.json(u);
});

api.put("/profile", requireAuth, wrap(async (req, res) => {
  const allowed = ["name", "npi", "specialty", "facility_name", "facility_address", "signature_data_url"];
  const updates = {};
  for (const k of allowed) if (req.body?.[k] != null) updates[k] = req.body[k];
  if (Object.keys(updates).length) {
    await adminClient.from("profiles").update(updates).eq("id", req.user.id);
  }
  const { data } = await adminClient.from("profiles").select("*").eq("id", req.user.id).single();
  const u = publicUser(data);
  u.email_verified = isEmailVerified(req.user);
  res.json(u);
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
// Billing (mock credits)
// ---------------------------------------------------------------------------
api.post("/billing/mock-purchase", requireAuth, wrap(async (req, res) => {
  // Normalize pack to a string — an array body would otherwise index CREDIT_PACKS
  // with an array and silently produce undefined.
  const packKey = typeof req.body?.pack === "string" ? req.body.pack : "";
  const amount = CREDIT_PACKS[packKey];
  if (!amount) return res.status(400).json({ detail: "Unknown credit pack" });
  const newCredits = (req.user.credits || 0) + amount;
  await adminClient.from("profiles").update({ credits: newCredits }).eq("id", req.user.id);
  await adminClient.from("credit_transactions").insert({ user_id: req.user.id, type: "purchase", amount, pack: packKey });
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
  // Reject mutually-exclusive inputs up front so callers can't silently drop
  // a manual-data submission by also sending a files array (or vice versa).
  const hasFiles = Array.isArray(req.body?.files) || Array.isArray(req.body?.images);
  const hasManual = req.body?.manual_data && typeof req.body.manual_data === "object";
  if (hasFiles && hasManual) {
    return res.status(400).json({ detail: "Send either `files` (or legacy `images`) OR `manual_data`, not both." });
  }

  // Accept either:
  //   - legacy: { images: ["data:image/jpeg;base64,..."] }  (single file per slot)
  //   - new:    { files: [{ section, filename, mimeType, content }, ...] }  (multi-file/multi-format)
  const rawFiles = Array.isArray(req.body?.files) ? req.body.files : null;
  const files = rawFiles
    ? rawFiles
        .filter((f) => f && typeof f === "object" && f.content)
        .map((f, i) => ({
          section: f.section || null,
          filename: f.filename || `file-${i + 1}`,
          mimeType: f.mimeType || "application/octet-stream",
          content: f.content,
        }))
    : Array.isArray(req.body?.images)
    ? req.body.images.map((b64, i) => ({
        section: null,
        filename: `image-${i + 1}`,
        // Trust the data-URL header when available; fall back to jpeg.
        mimeType: (typeof b64 === "string" && b64.startsWith("data:"))
          ? (b64.match(/data:(.*?);base64/)?.[1] || "image/jpeg")
          : "image/jpeg",
        content: b64,
      }))
    : [];
  const manual = req.body?.manual_data;

  // Manual-entry path (fallback when OCR fails or the document is unclear).
  if (manual && typeof manual === "object") {
    const requestId = uid("req");
    paStore.put(requestId, {
      request_id: requestId, user_id: req.user.id, created_at: Date.now(),
      extracted_data: manual, dictation_transcript: null, user_confirmations: null, claude_result: null,
    });
    return res.json({ request_id: requestId, extracted_data: manual, manual: true });
  }

  if (!files.length) return res.status(400).json({ detail: "No document files provided" });
  let extracted;
  try {
    extracted = await llm.extractDocuments(files);
  } catch (e) {
    console.error("OCR failed:", e.message);
    let detail;
    if (/billing/i.test(e.message)) {
      detail = "Document OCR is not enabled yet: billing must be enabled on the Google Cloud project. You can enter the details manually below.";
    } else if (e.code === "UNCLEAR") {
      detail = "Document is unclear or blurry — please upload a clearer photo, or enter the details manually below.";
    } else if (e.code === "DOCUMENT_AI_FAILED") {
      detail = "The document-reading service could not be reached. Please retry shortly. If this continues, check the Google Document AI configuration.";
    } else if (e.code === "ANTHROPIC_FAILED") {
      detail = "OCR succeeded, but the AI extraction service failed. Check the Anthropic API key and model configuration.";
    } else {
      detail = "Couldn't read the document. Please retry with a clearer photo, or enter the details manually below.";
    }
    return res.status(422).json({ detail, allow_manual: true, error_code: e.code || "CAPTURE_FAILED" });
  }
  const requestId = uid("req");
  paStore.put(requestId, {
    request_id: requestId, user_id: req.user.id, created_at: Date.now(),
    extracted_data: extracted, dictation_transcript: null, user_confirmations: null, claude_result: null,
  });
  res.json({ request_id: requestId, extracted_data: extracted, file_count: files.length });
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
    console.error("Reasoning failed:", e.code || "UNKNOWN", e.message);
    const detail = e.code === "REASONING_INVALID_JSON"
      ? "The AI response was incomplete or malformed. Please run the analysis again."
      : "The AI analysis service could not complete the request. Please retry shortly.";
    return res.status(422).json({ detail, error_code: e.code || "REASONING_FAILED" });
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
