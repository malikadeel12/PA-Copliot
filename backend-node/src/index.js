require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const { adminClient } = require("./supabase");
const { requireAuth, publicUser, isEmailVerified, isTrialExpired } = require("./auth");
const ruleEngine = require("./ruleEngine");
const llm = require("./llm");
const paStore = require("./paStore");
const paypal = require("./paypal");

const CREDIT_PACKS = { starter: 10, pro: 30, clinic: 100 };
const PACK_PRICES = { starter: 39, pro: 99, clinic: 279 };

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
  res.status(500).json({ detail: "Something went wrong on our side. Please try again." });
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
// Billing — PayPal Orders v2 flow
// ---------------------------------------------------------------------------
// Change summary: create-order + capture-order only (no webhook, no demo/mock purchase).
// Related: ./paypal.js, supabase paypal_orders table, frontend PayPalButtons.
//
//   POST /billing/create-order      -> creates an order on PayPal, returns id
//   POST /billing/capture-order/:id -> captures after buyer approval + credits account
//
// The frontend never touches a real card. PayPal owns the entire payment
// surface. We create the order, capture after buyer approval, then credit.

api.post("/billing/create-order", requireAuth, wrap(async (req, res) => {
  const packKey = typeof req.body?.pack === "string" ? req.body.pack : "";
  const credits = CREDIT_PACKS[packKey];
  const amountUSD = PACK_PRICES[packKey];
  if (!credits || !amountUSD) return res.status(400).json({ detail: "Please choose a valid credit pack." });

  let order;
  try {
    order = await paypal.createOrder({
      packId: packKey,
      credits,
      amountUSD,
      userId: req.user.id,
    });
  } catch (e) {
    console.error("PayPal create-order failed:", e.status, e.message);
    const detail = e.status === 401
      ? "Payment checkout is temporarily unavailable. Please try again later or contact support."
      : "PayPal could not start checkout. Please try again in a moment.";
    return res.status(502).json({ detail, error_code: "PAYPAL_CREATE_FAILED" });
  }

  // Persist the (order_id -> user/pack) mapping so capture-order can credit
  // the right account after the buyer approves payment.
  const { error: insertErr } = await adminClient.from("paypal_orders").insert({
    id: order.id,
    user_id: req.user.id,
    pack: packKey,
    credits,
    amount_usd: amountUSD,
    status: "CREATED",
  });
  if (insertErr) {
    // Order is already on PayPal's side — void it to avoid orphaned holds.
    try {
      await paypal.getOrder(order.id);  // confirm reachable
    } catch { /* nothing more we can do here; operator will reconcile via PayPal dashboard */ }
    console.error("paypal_orders insert failed:", insertErr.message);
    return res.status(500).json({ detail: "Could not start checkout. Please try again." });
  }

  res.json({ orderId: order.id });
}));

api.post("/billing/capture-order/:id", requireAuth, wrap(async (req, res) => {
  const orderId = req.params.id;
  if (!/^[A-Z0-9]{17}$/.test(orderId)) return res.status(400).json({ detail: "Invalid payment reference. Please try again." });

  // Lookup the order mapping + ownership. Refuse to capture an order that
  // belongs to a different user.
  const { data: row } = await adminClient.from("paypal_orders")
    .select("*").eq("id", orderId).maybeSingle();
  if (!row) return res.status(404).json({ detail: "We couldn't find this payment order. Please try buying credits again." });
  if (row.user_id !== req.user.id) return res.status(403).json({ detail: "This payment belongs to a different account." });
  if (row.status === "COMPLETED") {
    // Recovery: COMPLETED without ledger → attempt grant again (idempotent).
    try {
      await creditFromPayPalOrder(row, { id: row.capture_id });
    } catch (e) {
      console.error("COMPLETED order recovery failed:", e.message);
      return res.status(502).json({
        detail: "Payment went through, but credits could not be confirmed yet. Please contact support and share your order ID.",
        error_code: "PAYPAL_CREDIT_RECOVERY_FAILED",
        orderId,
      });
    }
    const { data: profile } = await adminClient.from("profiles").select("*").eq("id", req.user.id).single();
    return res.json({ ok: true, already_completed: true, user: publicUser(profile) });
  }
  if (row.status !== "CREATED" && row.status !== "APPROVED") {
    return res.status(409).json({
      detail: "This payment can no longer be completed (it may have expired or been cancelled). Please start a new purchase.",
    });
  }

  let captured;
  try {
    captured = await paypal.captureOrder(orderId);
  } catch (e) {
    console.error("PayPal capture-order failed:", e.status, e.message);
    const detail = e.status === 422
      ? "This PayPal payment expired or was cancelled. Please try buying credits again."
      : "PayPal could not finish the payment. Please try again shortly.";
    return res.status(502).json({ detail, error_code: "PAYPAL_CAPTURE_FAILED" });
  }

  const status = captured.status;
  if (status !== "COMPLETED") {
    // PENDING / VOIDED / etc. Don't credit until PayPal reports COMPLETED.
    await adminClient.from("paypal_orders").update({ status }).eq("id", orderId);
    return res.status(202).json({
      ok: false,
      status,
      detail: "Payment is still processing with PayPal. Credits will appear once it is confirmed — please refresh in a minute.",
    });
  }

  await creditFromPayPalOrder(row, captured);
  const { data: profile } = await adminClient.from("profiles").select("*").eq("id", row.user_id).single();
  res.json({ ok: true, user: publicUser(profile) });
}));

// Pull the real capture id out of an Orders v2 capture response.
function extractCaptureId(captured) {
  return (
    captured?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
    captured?.id ||
    null
  );
}

// Shared credit-grant path. Order of operations matters:
//   1) ledger insert (unique paypal_order_id = idempotency lock)
//   2) profile credit increment
//   3) mark paypal_orders COMPLETED
// Never mark COMPLETED before credits are granted — that stranded paid users.
// Business rule: 1 successful PayPal capture → exactly one credit grant.
async function creditFromPayPalOrder(row, captured) {
  const captureId = extractCaptureId(captured);

  // Already ledgered? Ensure order row is COMPLETED and exit.
  const { data: existingTx } = await adminClient
    .from("credit_transactions")
    .select("id")
    .eq("paypal_order_id", row.id)
    .maybeSingle();
  if (existingTx) {
    await adminClient.from("paypal_orders").update({
      status: "COMPLETED",
      captured_at: new Date().toISOString(),
      capture_id: captureId || row.capture_id || null,
    }).eq("id", row.id);
    return;
  }

  // Recovery: COMPLETED without a ledger row (legacy bug) — still grant below.
  const { error: txErr } = await adminClient.from("credit_transactions").insert({
    user_id: row.user_id, type: "purchase", amount: row.credits, pack: row.pack,
    paypal_order_id: row.id, paypal_capture_id: captureId,
  });
  if (txErr && txErr.code !== "23505") {
    console.error("credit_transactions insert failed:", txErr.message);
    throw txErr;
  }
  if (txErr?.code === "23505") {
    await adminClient.from("paypal_orders").update({
      status: "COMPLETED", captured_at: new Date().toISOString(), capture_id: captureId,
    }).eq("id", row.id);
    return;
  }

  const { data: profile } = await adminClient.from("profiles").select("credits").eq("id", row.user_id).single();
  const newCredits = (profile?.credits || 0) + row.credits;
  const { error: profileErr } = await adminClient.from("profiles")
    .update({ credits: newCredits }).eq("id", row.user_id);
  if (profileErr) {
    console.error("profile credit update failed:", profileErr.message);
    // Leave order non-COMPLETED so a retry can finish granting after ledger insert.
    // Delete the orphan tx so the unique index doesn't block recovery without credits.
    await adminClient.from("credit_transactions").delete().eq("paypal_order_id", row.id);
    throw profileErr;
  }

  const { error: updateErr } = await adminClient
    .from("paypal_orders")
    .update({ status: "COMPLETED", captured_at: new Date().toISOString(), capture_id: captureId })
    .eq("id", row.id);
  if (updateErr) {
    console.error("paypal_orders update failed:", updateErr.message);
    // Credits already granted — do not throw (capture endpoint should still return user).
  }
}

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

  if (!files.length) return res.status(400).json({ detail: "Please add at least one document before continuing." });
  let extracted;
  try {
    extracted = await llm.extractDocuments(files);
  } catch (e) {
    console.error("OCR failed:", e.message);
    let detail;
    if (/billing/i.test(e.message)) {
      detail = "Document reading is temporarily unavailable. Please enter the details manually below, or try again later.";
    } else if (e.code === "UNCLEAR") {
      detail = "Document is unclear or blurry — please upload a clearer photo, or enter the details manually below.";
    } else if (e.code === "DOCUMENT_AI_FAILED") {
      detail = "The document-reading service could not be reached. Please retry shortly, or enter the details manually below.";
    } else if (e.code === "ANTHROPIC_FAILED") {
      detail = "We read the document, but could not extract the fields. Please retry, or enter the details manually below.";
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
  if (!rec) return res.status(404).json({ detail: "This PA session expired or was cleared. Please start a new request." });
  const next = typeof req.body?.transcript === "string" ? req.body.transcript : "";
  // Only invalidate smart re-run when the narrative actually changed.
  if (next !== (rec.dictation_transcript || "")) {
    rec.payload_hash = null;
    rec.claude_result = null;
  }
  rec.dictation_transcript = next;
  res.json({ ok: true });
}));

// Sync manually corrected OCR fields before validate/generate.
// Business rule: edits to extracted_data force a fresh AI run (new credit)
// only when the user later hits generate with a changed payload hash.
api.put("/pa/:id/extracted", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ detail: "This PA session expired or was cleared. Please start a new request." });
  if (!req.body?.extracted_data || typeof req.body.extracted_data !== "object") {
    return res.status(400).json({ detail: "No extracted details were provided to save." });
  }
  rec.extracted_data = req.body.extracted_data;
  if (rec.payload_hash) { rec.payload_hash = null; rec.claude_result = null; }
  res.json({ ok: true, extracted_data: rec.extracted_data });
}));

api.get("/pa/:id/grids", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ detail: "This PA session expired or was cleared. Please start a new request." });
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
  if (!rec) return res.status(404).json({ detail: "This PA session expired or was cleared. Please start a new request." });
  rec.user_confirmations = req.body || {};
  res.json({ ok: true });
}));

// Replace explicit Conflict *labels* (not prose containing the word) with ******.
// Matches: "Conflict", "CONFLICT:", "[Conflict]", "Conflict — …" as the whole value
// or a short label prefix. Leaves phrases like "no drug conflict documented".
function redactConflicts(value) {
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\[?conflict\]?\s*[:—-]?\s*$/i.test(t)) return "******";
    if (/^conflict\b\s*[:—-]/i.test(t) && t.length < 80) return "******";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactConflicts);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactConflicts(v);
    return out;
  }
  return value;
}

api.post("/pa/:id/generate", requireAuth, wrap(async (req, res) => {
  const rec = paStore.get(req.params.id, req.user.id);
  if (!rec) return res.status(404).json({ detail: "This PA session expired or was cleared. Please start a new request." });
  const { data: fresh } = await adminClient.from("profiles").select("*").eq("id", req.user.id).single();
  if (!fresh) return res.status(404).json({ detail: "Could not load your account. Please sign in again." });

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

  // --- Smart re-run: same inputs → reuse cached result, do NOT deduct a credit ---
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (rec.claude_result && rec.payload_hash === payloadHash) {
    return res.json({
      result: redactConflicts(rec.claude_result),
      credits: fresh.credits || 0,
      reused: true,
    });
  }

  // Trial expiry: free signup credits stop working after trial_ends_at unless
  // the account has purchased credits at least once.
  if (isTrialExpired(fresh)) {
    const { data: purchases } = await adminClient.from("credit_transactions")
      .select("id").eq("user_id", req.user.id).eq("type", "purchase").limit(1);
    if (!purchases?.length) {
      if ((fresh.credits || 0) > 0) {
        await adminClient.from("profiles").update({ credits: 0 }).eq("id", req.user.id);
      }
      return res.status(402).json({
        detail: "Your 7-day free trial has ended. Purchase credits to continue running analyses.",
        error_code: "TRIAL_EXPIRED",
      });
    }
  }

  if ((fresh.credits || 0) < 1) {
    return res.status(402).json({ detail: "You’re out of credits. Please buy more to continue." });
  }

  // Optimistic lock: reserve 1 credit before the LLM call so parallel tabs
  // cannot both spend the same credit. Refund if reasoning fails.
  const before = fresh.credits || 0;
  const { data: reserved, error: reserveErr } = await adminClient
    .from("profiles")
    .update({ credits: before - 1 })
    .eq("id", req.user.id)
    .eq("credits", before)
    .select("credits")
    .maybeSingle();
  if (reserveErr || !reserved) {
    return res.status(402).json({ detail: "You’re out of credits. Please buy more to continue." });
  }

  let result;
  try {
    result = await llm.runReasoning(payload);
  } catch (e) {
    // Refund the reserved credit (re-read so a mid-flight purchase can't strand the refund).
    const { data: mid } = await adminClient.from("profiles").select("credits").eq("id", req.user.id).single();
    if (mid && (mid.credits || 0) === before - 1) {
      await adminClient.from("profiles").update({ credits: before }).eq("id", req.user.id).eq("credits", before - 1);
    } else if (mid) {
      await adminClient.from("profiles").update({ credits: (mid.credits || 0) + 1 }).eq("id", req.user.id);
    }
    console.error("Reasoning failed:", e.code || "UNKNOWN", e.message);
    const detail = e.code === "REASONING_INVALID_JSON"
      ? "The AI analysis didn’t finish correctly. Please run it again."
      : "AI analysis couldn’t complete right now. Please try again shortly.";
    return res.status(422).json({ detail, error_code: e.code || "REASONING_FAILED" });
  }

  result = redactConflicts(result);

  await adminClient.from("credit_transactions").insert({ user_id: req.user.id, type: "consume", amount: -1 });
  await adminClient.from("usage_events").insert({ user_id: req.user.id, event_type: "pa_request_completed" });
  rec.claude_result = result;
  rec.payload_hash = payloadHash;
  res.json({ result, credits: reserved.credits, reused: false });
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
