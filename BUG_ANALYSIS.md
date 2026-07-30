# PA Copilot — Bug Analysis & Fixes

**Generated:** 2026-07-30
**Repo:** `malikadeel12/PA-Copliot`
**Author:** opencode assistant
**Audit scope:** Full frontend + backend codebase

---

## Part 1 — Auth/Onboarding Bugs (user-reported, 4 issues)

### Bug #1: Google sign-in doesn't show account picker / permissions screen

**Symptom**
Clicking "Continue with Google" → user is signed in immediately, even though they expected to see Google's account chooser ("which Google account do you want to use?") and the OAuth permissions consent screen.

**Root cause analysis**

The Google account picker / permissions prompt is controlled by the `prompt=` query parameter sent to Google's authorization endpoint. Possible values:

| Value | Behavior |
|-------|----------|
| `none` | Silent re-auth (no UI) |
| `consent` | Always show permissions consent screen |
| `select_account` | Always show account chooser |

In `frontend/src/pages/Login.js:115-121`:
```js
const googleLogin = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/auth/callback" },
    // ← no queryParams — Supabase defaults to no prompt forcing
  });
  if (error) toast.error(error.message);
};
```

The client does NOT pass any `queryParams`, so Supabase forwards whatever the server-side Google provider config dictates. **This is a Supabase project config issue, not a code bug — but we CAN force it client-side via `queryParams` so we don't have to ask an admin to change project settings.**

**Fix** — add `queryParams: { prompt: "select_account consent" }` so the user always sees both the account chooser and consent screen.

---

### Bug #2: New Google user lands on `/dashboard` instead of `/onboarding`

**Symptom**
A brand-new user signs up via Google → completes OAuth → is redirected to `/dashboard` directly, **without ever being prompted to complete the mandatory prescriber onboarding form**. They have full access to the dashboard even though they haven't filled in NPI, specialty, facility, etc.

**Root cause analysis**

Two locations conspire to drop the onboarding gate:

**Root cause A** — `frontend/src/pages/AuthCallback.js:61`
```js
if (active) navigate(profile.role === "admin" ? "/admin" : "/dashboard", { replace: true });
```
This routes purely on `profile.role`. **It never checks `profile.profile_complete`**, so a new Google user whose profile has `name` populated (from Google) but `npi/specialty/facility_*` empty → still gets sent to `/dashboard`.

The expectation is that `ProtectedRoute` (on `/dashboard`) will catch this and redirect to `/onboarding`. **But there is a race:**

**Root cause B** — `frontend/src/context/AuthContext.js:13-30` `loadProfile`:
```js
profileRequest.current = api.get("/auth/me")
  .then(({ data }) => {
    setUser(data);
    return data;
  })
  .catch(() => {
    setUser(null);          // ← WIPES USER ON FAILURE
    return null;
  })
```

If `GET /auth/me` fails transiently (which happens often on first OAuth load — the Bearer token interceptor hasn't cached the token yet), `setUser(null)` runs and `loadProfile` returns `null`. The retry loop in `AuthCallback.js:55-58` then sees `null` and after 3 attempts throws an error → user gets bounced back to `/login` with an error toast. That's the symptom users see.

But ALSO: even when `loadProfile` succeeds, `AuthCallback` calls `navigate("/dashboard")` **before** React's render cycle has propagated the new `user` state. `ProtectedRoute` may render in the same commit with the OLD `user` (or `null`), so:

- If `user === null` (still loading) → `ProtectedRoute` shows spinner → eventually either shows dashboard or redirects to /login based on what `user` becomes.
- If `user === stale object with profile_complete=true` (cached from previous login) → `ProtectedRoute` lets them through.

**The robust fix is in `AuthCallback.js`** — never rely on `ProtectedRoute` as a backup gate for the OAuth flow. Decide the destination from the freshly-fetched `profile`:

```js
if (!profile.profile_complete) navigate("/onboarding", { replace: true });
else if (profile.role === "admin") navigate("/admin", { replace: true });
else navigate("/dashboard", { replace: true });
```

---

### Bug #3: Removing the profile row from Supabase + refreshing → user lands on `/dashboard`

**Symptom**
A user (or developer) deletes the `profiles` row directly in Supabase to simulate a "fresh account" state. They refresh the browser. The site loads and the user is on `/dashboard` — onboarding was never triggered.

**Root cause analysis**

The Supabase auth JWT token (stored in browser localStorage) is independent of the `profiles` table. Even if you delete the `profiles` row, the JWT remains valid until expiry (default 1 hour, auto-refreshed).

On refresh:
1. `AuthContext.init` → `supabase.auth.getSession()` returns the still-valid session.
2. `loadProfile()` → `GET /auth/me` with JWT → backend `requireAuth` → `ensureProfile(data.user)`.
3. `ensureProfile` sees no existing profile → inserts a fresh row with **empty** `npi/specialty/facility_*` and `profile_complete=false`.
4. `publicUser()` returns `{ profile_complete: false, ... }`.
5. `setUser(data)` updates state with `profile_complete=false`.

So far so good — the freshly-fetched user has `profile_complete=false`. **The bug is in `AuthCallback` (Bug #2)**: if the user was already past the auth callback and just hitting refresh on `/dashboard`, `ProtectedRoute` SHOULD redirect to `/onboarding`.

**The actual issue:** `AuthContext` does this on first load (line 32-44):
```js
const init = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    if (!mounted) return;
    setSession(data.session);
    if (data.session) await loadProfile();   // ← this updates `user`
  } catch { /* ignore */ }
  finally {
    if (mounted) setLoading(false);
  }
};
```

This runs on initial mount. **`loadProfile` is awaited before `setLoading(false)`.** So `ProtectedRoute` should see the correct `user.profile_complete=false` after loading finishes.

**But there's a subtle issue**: between `setSession(data.session)` (line 38) and the `await loadProfile()` (line 39), there's a tick where `loading` is still `true` and `user` is still `null`. `ProtectedRoute` shows spinner. Then `loadProfile` resolves, `setUser(data)` runs, `setLoading(false)` runs.

If the user is on `/dashboard`, `ProtectedRoute` re-renders with `user.profile_complete=false` → redirects to `/onboarding`. ✓

**So why does it go to `/dashboard`?** Two possibilities:

1. **The fix to Bug #2 isn't deployed yet** (i.e. the same root cause — `AuthCallback` doesn't check `profile_complete`). On refresh, the user lands on `/dashboard`, `ProtectedRoute` checks, redirects to `/onboarding`... but maybe there's a navigation race where the spinner stays visible briefly, then `/onboarding` mounts.

2. **`AuthContext` on auth state change wipes `user` to null transiently** (the `onAuthStateChange` callback runs `loadProfile` from a `setTimeout(0)` which creates a gap where `user=null` → if `ProtectedRoute` evaluates during that gap, it redirects to `/login`).

Either way, the robust fix is to make `AuthCallback` check `profile_complete` explicitly, AND to make `loadProfile` more resilient (don't wipe `user` to `null` on transient failures — only on confirmed 401).

---

### Bug #4: Remove profile + refresh → opens onboarding directly (this is the correct behavior)

This is the **expected outcome** after Bug #2/#3 are fixed — when no profile exists for the authenticated user, they must complete onboarding. Currently it's inconsistent (sometimes works, sometimes lands on dashboard).

---

### Cross-cutting fix: Remove admin section

**User request**: "remove the admin scene because we don't need this just this application for user"

This is a product decision: PA Copilot is physician-only. Need to remove:
- `/admin` route in `App.js`
- `AdminRoute` guard
- `requireAdmin` middleware in `backend-node/src/index.js`
- `/admin/overview`, `/admin/users`, `/admin/users/:userId/grant-credits` routes
- `admin` role in `supabase_schema.sql` (or just stop checking it)
- `AdminDashboard` page
- `isAdminEmail` / `ADMIN_EMAIL` env var / `ADMIN_CREDITS`
- "Admin" nav item in `AppShell.js`

---

### Bug #5: Google OAuth silently creates accounts for new users

**Symptom**
A brand-new user clicks "Continue with Google" on `/login`. Without ever signing up, they're authenticated and dropped into the app. This bypasses the intended flow where users must explicitly register (and confirm their email) before using the service.

**Root cause analysis**
Supabase OAuth auto-creates an `auth.users` row for any successful OAuth callback, regardless of whether the user pre-registered. The `ensureProfile` function in `backend-node/src/auth.js` then unconditionally created a corresponding `profiles` row for any authenticated user. **There's no check for "this OAuth user is brand new".**

**Fix**

1. `ensureProfile` now throws a structured `SIGNUP_REQUIRED` error when no `profiles` row exists AND the auth provider is not `email` (i.e. it's OAuth like Google).
2. `requireAuth` translates that error to HTTP 403 with `{ error_code: "SIGNUP_REQUIRED" }`.
3. `AuthContext.loadProfile` detects the 403 + `error_code` and re-throws with `code: "SIGNUP_REQUIRED"`.
4. `AuthCallback` catches that, calls `supabase.auth.signOut()` to immediately kill the half-created session, and navigates to `/login?error_description=Please+sign+up+first...&mode=register`.
5. `Login.js` honors `?mode=register` to auto-switch to the Register tab; the toast displays the friendly message.

**Edge case not yet handled**
A returning user who originally signed up with email/password, then later clicks "Continue with Google", will be blocked by this rule. This is because Supabase OAuth creates a brand-new `auth.users` row (different UUID, same email) — the existing `profiles` row (keyed by the email signup's UUID) is invisible to the new OAuth UUID. **Workaround for now**: returning users should sign in with their original email/password. Linking identities via "Sign in with Google later" requires a separate `supabase.auth.linkIdentity()` flow which is out of scope for this fix.

---

### Bug #6: Register tab and Login tab share the same Google flow with no intent distinction

**Symptom**
The "Continue with Google" button on the Login page always behaves the same way regardless of which tab is active. New users clicking it from the Register tab have no special onboarding; users on the Login tab get the same behavior. There's no way for the user (or the backend) to distinguish "I want to create a new account" from "I want to sign into an existing one" via Google.

**Required 4-case matrix**

| Page | User status | Action | Expected result |
|------|------------|--------|-----------------|
| Register | Brand new (no profile) | Google | Select account → `/onboarding` → `/dashboard` |
| Register | Existing profile | Google | "Account already created — please login" |
| Login | Brand new | Google | "Please create account first" |
| Login | Existing profile | Google | Login success → `/dashboard` |

**Fix**

1. `Login.js` writes `pa-oauth-intent` (signup or login) to `sessionStorage` before OAuth, and the Google button label switches: **"Sign up with Google"** in Register tab, **"Sign in with Google"** in Login tab.
2. `api.js` axios interceptor reads the intent on every request and forwards it as the `X-OAuth-Intent` header.
3. `backend-node/src/auth.js` `ensureProfile(user, intent)` implements the full 4-case matrix:
   - By-id lookup → found: signup → ALREADY_CREATED, login → return profile.
   - By-email lookup → found: signup → ALREADY_CREATED, login → return profile (covers the "email signup, later Google login" case).
   - No profile anywhere: signup → create, login → SIGNUP_REQUIRED.
4. `requireAuth` reads `X-OAuth-Intent` and translates `ALREADY_CREATED` and `SIGNUP_REQUIRED` to HTTP 403 with structured `error_code`.
5. `AuthContext.loadProfile` re-throws both structured error codes so `AuthCallback` can route to the correct message.
6. `AuthCallback` calls `supabase.auth.signOut()` for both error cases (the half-created session must not linger), then navigates to `/login?error_description=...&mode=login|register`.

**Behavior now**

| Flow | Button label | Result |
|------|--------------|--------|
| Click on Register, brand new | "Sign up with Google" | Select account → `/onboarding` → fill → `/dashboard` |
| Click on Register, already has profile | "Sign up with Google" | Toast: "An account already exists for this Google account. Please sign in instead." → bounced to Login tab |
| Click on Login, brand new | "Sign in with Google" | Toast: "Please sign up first before signing in with Google." → bounced to Register tab |
| Click on Login, has profile | "Sign in with Google" | Sign-in succeeds → `/dashboard` |

---

### Bug #7: Email verification link fails silently — user never receives confirmation

**Symptom**
User signs up with email + password → sees toast "We sent a verification link to your email. Confirm it to activate your 10 free credits" → never receives the email. Even when they do (or in spam), clicking the link produces "The sign-in callback is missing or has expired." instead of completing signup.

**Root cause analysis**

This is a multi-cause bug spanning client code, client config, and Supabase project config:

**Cause 1 (client code)**: `AuthCallback.js` only handled `?code=...` (PKCE OAuth flow). Supabase's current email-confirmation links use `?token_hash=...&type=signup|email|recovery` (per the modern Supabase template using `{{ .TokenHash }}`). The client must call `supabase.auth.verifyOtp({ token_hash, type })` — which the old code never did. The fallback path ("no code in URL") only called `getSession()` and produced "missing or has expired."

**Cause 2 (client config)**: `supabase.js` set `detectSessionInUrl: false`. Combined with the bug above, even the implicit-flow variant (`#access_token=...` in the URL hash, used by older Supabase email templates) was ignored by the client. Setting this to `true` lets the client auto-detect session from hash and URL params, complementing the manual exchange.

**Cause 3 (Supabase project config)**: Supabase's built-in SMTP service has **very low hourly rate limits** ("intended only for demonstration purposes"), and emails frequently land in spam. Production projects must configure a custom SMTP provider (SendGrid, Mailgun, Resend, etc.) in the Supabase dashboard under **Authentication → SMTP Settings**. Without custom SMTP, signup emails may never arrive at all.

**Fix**

1. `AuthCallback.js` now handles all three URL shapes that Supabase can redirect with:
   - `?code=...` → existing PKCE exchange path (unchanged)
   - `?token_hash=...&type=...` → new `supabase.auth.verifyOtp({ token_hash, type })` call
   - (implicit hash) → handled by `detectSessionInUrl: true`
2. `supabase.js`: `detectSessionInUrl: true` so the implicit-flow hash variant works automatically.
3. `Login.js` adds a dedicated **"Check your email"** panel after a successful `signUp` with:
   - The email address shown back to the user
   - "Resend verification email" button calling `supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo } })`
   - "Back to sign in" button
   - Helper text reminding about spam folder and rate limits
4. Documentation note in this MD so anyone debugging "email not received" knows to check Supabase **Authentication → SMTP Settings**.

**Verified**
- All 3 changed files parse cleanly via Babel.
- All four OAuth 4-case flows still pass.

---

### Bug #8: Re-registering an existing email says "verification email sent" instead of "account already exists"

**Symptom**
A user signs up with `email@example.com` → gets the verification email → confirms it → completes onboarding → reaches the dashboard. Later, on a fresh session, they fill in the **Register** tab with the same email + password and click Create Account. The UI shows the **"Check your email"** panel (just like a brand-new signup) and claims a verification email was sent — but **no email is sent** because the account already exists.

**Root cause analysis**

Supabase's `signUp()` is intentionally silent on duplicate email when **"Enable email confirmations"** is on (the default for new projects). It returns:

```js
{ data: { user: <obfuscated fake user>, session: null }, error: null }
```

This is a deliberate enumeration-attack mitigation: an attacker cannot tell from the response whether an account exists. But it also means our client code — which only branches on `error` and `data.session` — cannot distinguish "new user, verification email sent" from "existing user, no email sent". The `awaitingEmail` panel renders in both cases.

**Fix**

Two complementary changes:

1. **Backend `POST /auth/check-email`** (anonymous, rate-limited at 5 reqs/min per IP)
   - Uses `adminClient.auth.admin.listUsers({ perPage: 1000 })` paginating locally
   - Returns `{ exists: boolean, email_confirmed_at: string|null, providers: string[] }`
   - Validates email format, lowercases for comparison

2. **Frontend `Login.js` `submit()` register branch**
   - Pre-checks via the new endpoint **before** calling `supabase.auth.signUp`
   - If `exists && email_confirmed_at`: toast "An account with this email already exists. Please sign in instead." → switch to login mode
   - If `exists && !email_confirmed_at`: send a fresh verification email via `supabase.auth.resend()` and show the awaiting-verification UI
   - If `!exists`: proceed with `signUp` as before

3. **Race-safe fallback**: Even with the pre-check, a concurrent signup can race. After `signUp` returns, we inspect `data.user.identities` — the obfuscated fake user has `identities: []` while a real new user has at least one identity entry. If empty, treat the same as the confirmed-exists branch.

**Why we accept the enumeration risk**
The `/auth/check-email` endpoint is anonymous but:
- Rate-limited to 5 reqs/min per IP (sliding window) — insufficient for bulk enumeration
- Email-format validation prevents trivial probes
- Returning `email_confirmed_at` is intentionally informational: it lets the user with a real problem (already-registered email) recover with one click instead of being stuck in a UI that promises an email that will never arrive

**Verified**
- Both backend (Node syntax-check) and frontend (Babel parse) compile cleanly.
- Behavior matrix:
| Pre-check | signUp returns | UI outcome |
|---|---|---|
| exists + confirmed | n/a | "already exists, sign in" → login tab |
| exists + unconfirmed | n/a | "fresh verification link sent" → awaiting panel |
| !exists | session | "account created — 10 credits" → onboarding |
| !exists | obfuscated (race) | "already exists" → login tab |
| !exists | no session | "check your email" → awaiting panel |

---

### Bug #9: "email rate limit exceeded" appears during signup with no actionable guidance

**Symptom**
User registers with email + password and gets a toast saying **"email rate limit exceeded"**. The error is opaque — no retry guidance, no indication of cause, and (in some cases) the user never actually receives a verification email at all.

**Root cause analysis**

This is a **Supabase platform configuration limit**, not a code bug. From https://supabase.com/docs/guides/auth/rate-limits:

| Operation | Path | Default cap |
|---|---|---|
| Email-triggering endpoints (signup / recover / user-update) | `/auth/v1/signup`, `/auth/v1/recover`, `/auth/v1/user` | **2 emails per hour project-wide** with built-in SMTP |
| Signup confirmation | `/auth/v1/signup` | 60-second per-user cooldown |
| Password reset | `/auth/v1/recover` | 60-second per-user cooldown |

The PA-Copilot project is still on **Supabase's built-in SMTP** (the project owner has not configured a custom provider like SendGrid/Mailgun/Resend). That means **2 emails/hour project-wide** is the absolute ceiling.

**Why the user hits it during normal testing**

| Action | Cumulative emails sent |
|---|---|
| First signup with `email@x.com` | 1 |
| Second signup (Bug #8 fix now catches duplicates, but first time was before the fix) | 2 |
| Click "Create Account" again → auto-resend fires | 3 → **HTTP 429** |
| Password reset test | 4 → **429** |

The raw Supabase error code is `over_email_send_rate_limit` and message is `email rate limit exceeded`. The bug isn't the rate limit itself — it's that:
1. **The toast is unhelpful** — just dumps the raw server string.
2. **Bug #8's "exists+unconfirmed" branch was auto-resending**, burning through quota whenever the user re-tried the same email.
3. **There's no recovery guidance** — users don't know they can wait an hour, configure custom SMTP, or use the explicit Resend button.

**Fix**

1. **`Login.js` `submit()` duplicate-unconfirmed branch**: removed the auto-resend. Now shows "click Resend verification email below" and routes to the awaiting-verification UI. The user only burns an email slot when they explicitly click Resend.
2. **`Login.js` adds `isEmailRateLimit()` + `rateLimitHint()` helpers** at the top of the file that detect any of:
   - `error.code === "over_email_send_rate_limit"` or `"over_request_rate_limit"`
   - message contains "email rate limit exceeded", "rate limit", "too many emails", "too many requests"
3. **`resendVerification()` and the `submit()` catch block** now translate the rate-limit error into: *"We've hit the hourly email rate limit (Supabase's built-in SMTP caps at ~2/hour). Please wait up to an hour and try again, or contact us to enable custom SMTP."* with a 12-second duration.
4. **Action item for the project owner** (documented in this MD): configure a custom SMTP provider in **Supabase Dashboard → Authentication → SMTP Settings** to lift the cap. Recommended providers: Resend (simplest), SendGrid, AWS SES, Mailgun.

**Verified**
- Babel parse clean.
- All three rate-limit error paths (signup, resend, future OAuth flows) route through the same translator.

---

### Bug #10: Google sign-in for an existing email+password account "succeeds" — is that OK?

**Symptom**
User signs up with email + password → confirms email → uses PA-Copilot. Later, in a fresh browser session, they sign in with **Google** using the same email. **It succeeds** and they reach the dashboard as the same user. The user asks: "is this a bug?"

**Root cause analysis**

This is **Supabase's automatic identity linking** working as designed, not a bug:

> "Supabase Auth automatically links identities with the same email address to a single user. This helps to improve the user experience when multiple OAuth login options are presented since the user does not need to remember which OAuth account they used to sign up with. When a new user signs in with OAuth, Supabase Auth will attempt to look for an existing user that uses the same email address. If a match is found, the new identity is linked to the user."  
> — https://supabase.com/docs/guides/auth/auth-identity-linking

**Security guarantees Supabase already provides:**
- Only links if the existing email is **verified** (prevents pre-account-takeover)
- Removes any **unconfirmed** identities on link
- Industry-standard behavior (Auth0, Clerk, Firebase, Supabase all do this)

**Why the user couldn't tell it was happening**

The auto-link was completely silent — Google sign-in just worked without telling the user "you now have two ways to sign in." This made it look like a bug.

**Decision**

Keep auto-link. The four alternative postures (block entirely / block-if-unverified / explicit prompt) were considered; the project owner confirmed auto-link is the desired behavior.

**Improvements shipped (not a behavior change, just discoverability)**

1. **`AuthCallback.js`**: After successful sign-in, fetch the user's identities and show a toast if multiple providers are linked: "Signed in with Google. This sign-in method has been linked to your existing email + password account."

2. **`Profile.js`**: New **"Sign-in methods"** panel that:
   - Lists every linked identity (email, google, etc.) via `supabase.auth.getUserIdentities()`
   - Lets the user unlink any provider except the last one (Supabase requires ≥1)
   - Offers a "Link Google account" button when Google is not yet linked, via `supabase.auth.linkIdentity({ provider: "google" })`
   - Re-fetches identities after unlink/link

**Verified**
- Babel parse clean for both `AuthCallback.js` and `Profile.js`
- `linkIdentity` and `unlinkIdentity` calls match Supabase JS SDK v2.x API

---

## Part 2 — Backend Audit Findings (from full-codebase audit)

### CRITICAL (4)

| # | File | Issue |
|---|---|---|
| **C1** | git history | GCP service-account key was historically committed. Now `.gitignored`, but verify no historical leak. |
| **C2** | `backend-node/src/index.js:121-128` | `POST /admin/users/:userId/grant-credits` accepts **negative `amount`** — admin can drain any user's credits. Needs `amount > 0` validation. |
| **C3** | `backend-node/src/index.js:138,257` | Credit balance mutations use read-then-write (`(req.user.credits \|\| 0) + amount`) — race condition. Use atomic SQL. |
| **C4** | `backend-node/src/index.js:151-184` | `/pa/capture` accepts both `manual_data` and `files` simultaneously — manual wins silently. Reject coexistence. |

### HIGH (13)

| # | File | Issue |
|---|---|---|
| **H1** | `backend-node/src/index.js:17` | `express.json({ limit: "25mb" })` — large base64 images can OOM Render. Cap at 8–10 MB. |
| **H2** | `backend-node/src/llm.js:23-30` | `parseJson` slices first `{` to last `}` — breaks if Claude narrates `}` mid-response. Walk balanced braces. |
| **H3** | `frontend/src/lib/api.js:22-24` | `onAuthStateChange` listener registered at module-load, never cleaned up — leaks in dev HMR. |
| **H4** | `frontend/src/components/wizard/ResultsStep.js:42` | `useEffect(..., [])` injects print stylesheet but never removes on unmount. |
| **H5** | `frontend/src/context/AuthContext.js:13-30` | `loadProfile` failure → `setUser(null)` wipes user state, locking out the user. |
| **H6** | `frontend/src/lib/api.js:48-55` | `formatApiError` mishandles object-detail shape. |
| **H7** | `frontend/src/components/wizard/CaptureStep.js` | Every analysis run consumes 1 credit even for trivial fixes. |
| **H8** | `backend-node/src/index.js:19-32` | CORS trusts any `*.vercel.app` — phishing risk. Lock to specific deploy URL. |
| **H9** | `backend-node/src/index.js:134-141` | `CREDIT_PACKS` lookup can be bypassed with array `pack` values. |
| **H10** | `backend-node/src/docai.js:96-102` | Unknown mime falls back to `Buffer.toString('utf8')` — mojibake for binary. |
| **H11** | `backend-node/src/index.js:151-184` | No `requestId` format validation in `/pa/:id/*` routes. |
| **H12** | `frontend/src/components/wizard/ResultsStep.js` downloadJson | JSON export can leak PHI if fields ever contain patient data. |
| **H13** | `frontend/src/components/wizard/ResultsStep.js` | Panels split mid-card on print — missing `break-inside: avoid`. |

### MEDIUM (36)

Full list in audit report. Notable ones:

- **M1** `CaptureStep.js:213` — multi-image pick races, only last editor opens
- **M7** `CaptureStep.js:319` — Re-scan leaves backend record alive for 30 min
- **M15** `backend-node/src/index.js:259` — `usage_events` has no `request_id` column for analytics
- **M25** `ResultsStep.js:155-164` — `printScope` body class can leak on unmount
- **M27** `index.js:71-86` — `/stats` is N+1 queries
- **M32** `index.js:13` — `CREDIT_PACKS.pro` but frontend sends `practice` — naming mismatch
- **M36** `ruleEngine.js` — `policyContextFor` type confusion possible

### LOW (20)

Decorative `alt=""`, stale Firebase logo, linear backoff, etc.

---

## Part 3 — Fix Implementation Plan

### Tier 1 (today) — fixes in this commit

1. **Auth Bug #1** — `Login.js`: add `queryParams: { prompt: "select_account consent" }` to Google OAuth
2. **Auth Bug #2** — `AuthCallback.js`: check `profile_complete` before navigating
3. **Auth Bug #3/#5** — `AuthContext.js`: `loadProfile` no longer wipes user on transient failures; distinguish 401 from network errors
4. **Remove admin section** — delete `AdminDashboard` page, `/admin` route, `requireAdmin` middleware, `/admin/*` API routes, `ADMIN_EMAIL` env, `ADMIN_CREDITS` constant, admin nav

### Tier 2 (next) — security hardening

5. **C2** reject negative credit grants
6. **C3** atomic SQL for credit mutations
7. **C4** reject manual_data + files coexistence
8. **H8** lock CORS to specific Vercel domains

### Tier 3 (later) — quality

9. All MEDIUM/LOW items from audit

---

## Verification commands

```bash
node -e "
const parser = require('@babel/parser');
const fs = require('fs');
parser.parse(fs.readFileSync('src/pages/Login.js', 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
console.log('Login.js OK');
parser.parse(fs.readFileSync('src/pages/AuthCallback.js', 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
console.log('AuthCallback.js OK');
parser.parse(fs.readFileSync('src/context/AuthContext.js', 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
console.log('AuthContext.js OK');
"
```
