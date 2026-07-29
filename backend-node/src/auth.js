const { authClient, adminClient } = require("./supabase");

const SIGNUP_FREE_CREDITS = 10;
const ADMIN_CREDITS = 100;

// Mandatory prescriber onboarding — required fields before dashboard access.
const MANDATORY_FIELDS = ["name", "npi", "specialty", "facility_name", "facility_address"];

function isAdminEmail(email) {
  const admin = (process.env.ADMIN_EMAIL || "").toLowerCase();
  return admin && (email || "").toLowerCase() === admin;
}

function isProfileComplete(profile) {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  for (const f of MANDATORY_FIELDS) {
    const v = (profile[f] || "").toString().trim();
    if (!v) return false;
  }
  return true;
}

function providerFromUser(user) {
  return (user.app_metadata && user.app_metadata.provider) || "email";
}

function isEmailVerified(user) {
  if (!user) return false;
  if (providerFromUser(user) !== "email") return true;
  // Supabase sets `email_confirmed_at` when the user verifies their email.
  return Boolean(user.email_confirmed_at);
}

// Ensures a `profiles` row exists for the authenticated Supabase user.
// For non-Google signups, free credits are only granted once the email is
// verified (Supabase sets `email_confirmed_at` after the confirmation link).
// The configured ADMIN_EMAIL is always promoted to admin.
async function ensureProfile(user) {
  const { data: existing } = await adminClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (existing) {
    let next = existing;
    if (isAdminEmail(user.email) && existing.role !== "admin") {
      const { data: up } = await adminClient
        .from("profiles").update({ role: "admin" }).eq("id", user.id).select("*").single();
      if (up) next = up;
    }
    // Lazy credit grant: if the profile was created before email verification
    // and the user has now confirmed their email, give them the signup bonus.
    const verified = isEmailVerified(user);
    const alreadyGranted = (existing.credits || 0) > 0 || existing.role === "admin";
    if (verified && !alreadyGranted) {
      const newCredits = (existing.credits || 0) + SIGNUP_FREE_CREDITS;
      const { data: credited } = await adminClient
        .from("profiles").update({ credits: newCredits }).eq("id", user.id).select("*").single();
      if (credited) next = credited;
      await adminClient.from("credit_transactions").insert({
        user_id: user.id, type: "signup_grant", amount: SIGNUP_FREE_CREDITS,
      });
    }
    return next;
  }

  const admin = isAdminEmail(user.email);
  const meta = user.user_metadata || {};
  const verified = isEmailVerified(user);
  // Email signups start with 0 credits until verification; Google + admin get theirs immediately.
  const initialCredits = admin ? ADMIN_CREDITS : (verified ? SIGNUP_FREE_CREDITS : 0);
  const insert = {
    id: user.id,
    email: user.email,
    name: meta.full_name || meta.name || null,
    signature_data_url: meta.avatar_url || null,
    role: admin ? "admin" : "physician",
    credits: initialCredits,
    auth_provider: providerFromUser(user),
  };
  const { data: created, error } = await adminClient
    .from("profiles").insert(insert).select("*").single();
  // Multiple tabs or near-simultaneous frontend auth listeners can reach
  // first-profile creation together. The losing insert should reuse the
  // profile created by the winning request, not fail the user's login.
  if (error?.code === "23505") {
    const { data: racedProfile, error: selectError } = await adminClient
      .from("profiles").select("*").eq("id", user.id).single();
    if (selectError) throw selectError;
    return racedProfile;
  }
  if (error) throw error;
  if (initialCredits > 0) {
    await adminClient.from("credit_transactions")
      .insert({ user_id: user.id, type: "signup_grant", amount: initialCredits });
  }
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
    profile_complete: isProfileComplete(p),
  };
}

module.exports = {
  SIGNUP_FREE_CREDITS, MANDATORY_FIELDS, isProfileComplete,
  requireAuth, requireAdmin, publicUser, isEmailVerified,
};
