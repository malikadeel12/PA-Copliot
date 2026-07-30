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
