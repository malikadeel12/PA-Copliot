# PA Copilot — PRD

## Product
Physician prior-authorization assistant: capture docs → dictate → validate/cross-walk →
single AI reasoning call → 4-panel package (Filled Form, Analysis w/ approval %, Suggestions,
Cover Letter) → export & purge. Mobile-first, "zero data retention / no PHI stored".

## Current Architecture (as of 2026-07-04)
- **Frontend:** React + Tailwind + shadcn/ui. Auth via **supabase-js** (email/password + Google OAuth).
  Sends Supabase JWT as `Authorization: Bearer` to the backend. Custom brand mark (transparent),
  Cabinet Grotesk headings, deep-emerald control-room theme, sidebar app shell, admin console.
- **Backend:** **Node.js / Express** (`/app/backend-node`). Verifies Supabase JWT via
  `supabase.auth.getUser`; server-side DB via service-role key.
- **Database/Auth:** **Supabase** (Postgres + Supabase Auth). Tables: `profiles`,
  `credit_transactions`, `usage_events` (see `backend-node/supabase_schema.sql`) + RLS.
- **AI:** Anthropic **Claude** via `@anthropic-ai/sdk` (reasoning + vision OCR) — uses the user's
  own `ANTHROPIC_API_KEY`.
- Local rule engine (payer portal matrix, ICD→CPT cross-walk, presets). In-memory PA store, 30-min TTL.

## History
- v1: React + FastAPI(Python) + MongoDB + Emergent LLM key + JWT/Emergent-Google auth (deprecated/removed).
- v2 (current): migrated backend to Node/Express + Supabase per user request (self-host). Python removed.

## Env / Keys
- Backend `/app/backend-node/.env`: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAIL, ANTHROPIC_API_KEY (**placeholder — must be set for AI**), ANTHROPIC_MODEL, PORT, CORS_ORIGINS.
- Frontend `.env`: REACT_APP_BACKEND_URL, REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY.

## Verified (testing agent)
- iteration_4: backend 15/15 (auth/role/admin/credits/profile/401-403). iteration_5: frontend
  hard-reload deadlock fix 100% (deep-link protected routes load; physician→/admin redirect; logout).

## Known / Deferred
- AI OCR + reasoning (`/api/pa/capture`, `/api/pa/:id/generate`) return 502 until a real
  ANTHROPIC_API_KEY is set (currently placeholder).
- Google OAuth requires the provider enabled + redirect URLs configured in the Supabase dashboard.
- Node backend runs as a background process on :8001 in the Emergent sandbox (managed runtime is
  Python-only); production = run `backend-node` on the user's own host.
- Real Stripe checkout (mock now); server-side PDF/ZIP export.

## Next Tasks
1. Set real ANTHROPIC_API_KEY → verify full capture→generate→results flow.
2. Finish Google provider config in Supabase; test Google login end-to-end.
3. Deploy `backend-node` to the user's host; point frontend REACT_APP_BACKEND_URL at it.

## Changelog
- 2026-07-07 (b): Full npm switch — removed yarn.lock, added frontend package-lock.json + .npmrc
  (legacy-peer-deps=true), supervisor frontend now `npm start`. Fixed post-login bounce-back to
  /login: root cause was the Node backend (:8001) running as a manual bg process that died.
  Moved it under supervisor (repurposed [program:backend] → `node src/index.js`, autorestart).
- 2026-07-07: Fixed OAuth error toast on Login (deferred toast so sonner Toaster subscribes first;
  useRef guard for StrictMode). Added **Forgot Password** flow (client-side Supabase):
  `Login.js` "Forgot password?" view calls `resetPasswordForEmail({ redirectTo: /reset-password })`;
  new `pages/ResetPassword.js` (route `/reset-password`) verifies the recovery session
  (`detectSessionInUrl` + onAuthStateChange), calls `updateUser({ password })`, signs out, → /login.
  Requires Supabase URL Config: Site URL + redirect `.../ **` allow-list. Verified via screenshot;
  Supabase round-trip confirmed (errors surface in toast).
