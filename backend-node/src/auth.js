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

// Ensures a `profiles` row exists for the authenticated Supabase user and
// enforces the 4-case flow for OAuth sign-in:
//
//   ┌─────────────┬─────────────────────────┬─────────────────────────────────┐
//   │ Intent      │ Profile lookup result   │ Action                          │
//   ├─────────────┼─────────────────────────┼─────────────────────────────────┤
//   │ signup      │ exists (by id or email) │ reject — ALREADY_CREATED        │
//   │ signup      │ missing                 │ create new profile              │
//   │ login       │ exists (by id or email) │ return existing profile         │
//   │ login       │ missing                 │ reject — SIGNUP_REQUIRED        │
//   └─────────────┴─────────────────────────┴─────────────────────────────────┘
//
// The intent is supplied by the frontend via the X-OAuth-Intent header so
// the backend can make this decision after the cross-origin OAuth redirect,
// without depending on sessionStorage at request time.
async function ensureProfile(user, intent = "login") {
  const provider = providerFromUser(user);

  // Step 1 — look up by exact auth UUID. This is the fast path for any
  // returning user whose profile was created against the same auth identity.
  const { data: byId } = await adminClient
    .from("profiles").select("*").eq("id", user.id).maybeSingle();

  if (byId) {
    if (intent === "signup") {
      const err = new Error("Account already exists. Please log in instead.");
      err.code = "ALREADY_CREATED";
      throw err;
    }
    return applyCreditGrant(byId, user);
  }

  // Step 2 — fall back to a lookup by email. This covers the case where a
  // returning user originally signed up via email (one auth.users UUID) and
  // is now signing in with Google (different auth.users UUID, same email).
  // The email is verified by Google so we can trust it matches the same
  // person. Without this fallback the user would be told "please sign up
  // first" on every Google sign-in.
  if (user.email) {
    const { data: byEmail } = await adminClient
      .from("profiles").select("*").eq("email", user.email).maybeSingle();
    if (byEmail) {
      if (intent === "signup") {
        const err = new Error("Account already exists. Please log in instead.");
        err.code = "ALREADY_CREATED";
        throw err;
      }
      return applyCreditGrant(byEmail, user);
    }
  }

  // Step 3 — no profile by id OR email. Decide based on intent + provider.
  if (provider !== "email") {
    if (intent !== "signup") {
      const err = new Error("No account found for this Google account. Please sign up first.");
      err.code = "SIGNUP_REQUIRED";
      throw err;
    }
    // signup intent + OAuth provider → create the profile and let onboarding
    // collect the prescriber-specific fields.
    return createProfile(user, provider);
  }

  // Email signup (or returning email user) — create a new profile.
  return createProfile(user, provider);
}

async function applyCreditGrant(profile, user) {
  // Lazy credit grant: if the profile was created before email verification
  // and the user has now confirmed their email, give them the signup bonus.
  const verified = isEmailVerified(user);
  const alreadyGranted = (profile.credits || 0) > 0;
  if (verified && !alreadyGranted) {
    const newCredits = (profile.credits || 0) + SIGNUP_FREE_CREDITS;
    const { data: credited } = await adminClient
      .from("profiles").update({ credits: newCredits }).eq("id", profile.id).select("*").single();
    await adminClient.from("credit_transactions").insert({
      user_id: profile.id, type: "signup_grant", amount: SIGNUP_FREE_CREDITS,
    });
    return credited || profile;
  }
  return profile;
}

async function createProfile(user, provider) {
  const meta = user.user_metadata || {};
  const verified = isEmailVerified(user);
  // Email signups start with 0 credits until verification; verified email / OAuth get theirs.
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

  const intentRaw = (req.headers["x-oauth-intent"] || "login").toString().toLowerCase();
  const intent = intentRaw === "signup" ? "signup" : "login";

  try {
    req.user = await ensureProfile(data.user, intent);
  } catch (e) {
    if (e.code === "SIGNUP_REQUIRED") {
      return res.status(403).json({
        detail: "No account found for this sign-in. Please sign up first.",
        error_code: "SIGNUP_REQUIRED",
      });
    }
    if (e.code === "ALREADY_CREATED") {
      return res.status(403).json({
        detail: "An account already exists for this Google account. Please sign in instead.",
        error_code: "ALREADY_CREATED",
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
