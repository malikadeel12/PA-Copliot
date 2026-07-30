const { authClient, adminClient } = require("./supabase");

const SIGNUP_FREE_CREDITS = 10;

// Mandatory prescriber onboarding — required fields before dashboard access.
const MANDATORY_FIELDS = ["name", "npi", "specialty", "facility_name", "facility_address"];

function isProfileComplete(profile) {
  if (!profile) return false;
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
// For email signups, free credits are only granted once the email is verified
// (Supabase sets `email_confirmed_at` after the confirmation link).
//
// OAuth providers (Google etc.) are intentionally NOT allowed to silently
// create a new profile: a brand-new OAuth user with no pre-existing
// `profiles` row is rejected with `SIGNUP_REQUIRED` so the frontend can
// show "please sign up first". This forces every new user to register via
// email first (and confirm their address), giving us a verifiable owner
// identity before any PHI-bearing flow begins.
async function ensureProfile(user) {
  const { data: existing } = await adminClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  const provider = providerFromUser(user);

  if (!existing) {
    // For OAuth (Google etc.) we refuse to silently create a brand-new
    // profile. The user must register via email first so we have a verified
    // identity before any PHI-bearing flow begins. Returning a structured
    // error lets the frontend show "please sign up first" instead of a
    // generic failure.
    if (provider !== "email") {
      const err = new Error("OAuth sign-in requires a pre-existing account");
      err.code = "SIGNUP_REQUIRED";
      throw err;
    }
  }

  if (existing) {
    let next = existing;
    // Lazy credit grant: if the profile was created before email verification
    // and the user has now confirmed their email, give them the signup bonus.
    const verified = isEmailVerified(user);
    const alreadyGranted = (existing.credits || 0) > 0;
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

  const meta = user.user_metadata || {};
  const verified = isEmailVerified(user);
  // Email signups start with 0 credits until verification; verified email gets theirs.
  const initialCredits = verified ? SIGNUP_FREE_CREDITS : 0;
  const insert = {
    id: user.id,
    email: user.email,
    name: meta.full_name || meta.name || null,
    signature_data_url: meta.avatar_url || null,
    role: "physician",
    credits: initialCredits,
    auth_provider: provider,
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
    if (e.code === "SIGNUP_REQUIRED") {
      return res.status(403).json({
        detail: "No account found for this sign-in. Please sign up first.",
        error_code: "SIGNUP_REQUIRED",
      });
    }
    console.error("ensureProfile failed:", e.message);
    return res.status(500).json({ detail: "Profile lookup failed" });
  }
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
  requireAuth, publicUser, isEmailVerified,
};
