const { authClient, adminClient } = require("./supabase");

const SIGNUP_FREE_CREDITS = 5;
const ADMIN_CREDITS = 100;

function isAdminEmail(email) {
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  return admin && (email || "").toLowerCase() === admin;
}

// Ensures a `profiles` row exists for the authenticated Supabase user.
// First login grants free credits; the configured ADMIN_EMAIL is promoted to admin.
async function ensureProfile(user) {
  const { data: existing } = await adminClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (existing) {
    if (isAdminEmail(user.email) && existing.role !== "admin") {
      const { data: up } = await adminClient
        .from("profiles").update({ role: "admin" }).eq("id", user.id).select("*").single();
      return up || existing;
    }
    return existing;
  }

  const admin = isAdminEmail(user.email);
  const meta = user.user_metadata || {};
  const insert = {
    id: user.id,
    email: user.email,
    name: meta.full_name || meta.name || null,
    signature_data_url: meta.avatar_url || null,
    role: admin ? "admin" : "physician",
    credits: admin ? ADMIN_CREDITS : SIGNUP_FREE_CREDITS,
    auth_provider: (user.app_metadata && user.app_metadata.provider) || "email",
  };
  const { data: created, error } = await adminClient
    .from("profiles").insert(insert).select("*").single();
  if (error) throw error;
  await adminClient.from("credit_transactions")
    .insert({ user_id: user.id, type: "signup_grant", amount: insert.credits });
  return created;
}

async function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ detail: "Not authenticated" });

  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ detail: "Invalid or expired token" });

  try {
    req.user = await ensureProfile(data.user);
  } catch (e) {
    console.error("ensureProfile failed:", e.message);
    return res.status(500).json({ detail: "Profile lookup failed" });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ detail: "Admin access required" });
  return next();
}

function publicUser(p) {
  return {
    user_id: p.id,
    email: p.email,
    name: p.name ?? null,
    npi: p.npi ?? null,
    specialty: p.specialty ?? null,
    facility_name: p.facility_name ?? null,
    facility_address: p.facility_address ?? null,
    signature_data_url: p.signature_data_url ?? null,
    credits: p.credits ?? 0,
    role: p.role ?? "physician",
    auth_provider: p.auth_provider ?? "supabase",
  };
}

module.exports = { SIGNUP_FREE_CREDITS, requireAuth, requireAdmin, publicUser };
