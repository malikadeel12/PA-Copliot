# PA Copilot — Node.js / Express + Supabase backend

Self-hostable backend for PA Copilot. Same `/api/...` surface as before, but auth + data
now run on **Supabase** (Postgres + Supabase Auth). AI uses **your own Anthropic key**.

## Stack
- **Node.js + Express**
- **Supabase Postgres** (tables: `profiles`, `credit_transactions`, `usage_events`) with RLS
- **Supabase Auth** — Email/Password + Google OAuth (client-side via `supabase-js`), JWT
- **AI:** Anthropic Claude via `@anthropic-ai/sdk` (reasoning + vision OCR) — bring your own key

## How auth works now
- **Sign-up / sign-in / Google OAuth happen on the FRONTEND** using `@supabase/supabase-js`.
  The frontend gets a Supabase **access token (JWT)** and sends it to this backend as
  `Authorization: Bearer <token>`.
- This backend **verifies** the token with `supabase.auth.getUser(token)` (anon key) and does all
  DB work with the **service-role key** (bypasses RLS).
- On first authenticated call, a `profiles` row is auto-created with **5 free credits**. The user
  whose email equals `ADMIN_EMAIL` is auto-promoted to **admin** (100 credits).
- There are no `/auth/register` or `/auth/login` endpoints anymore — Supabase handles that.

## Setup
1. Create a Supabase project. In **SQL Editor**, run `supabase_schema.sql`.
2. In **Authentication → Providers**, enable **Email** and **Google** (add your Google OAuth
   client ID/secret and redirect URLs per Supabase's Google guide).
3. Copy `.env.example` → `.env` and fill values (see keys below).
4. Install & run:
   ```bash
   cd backend-node
   yarn install        # or npm install
   yarn start          # boots on PORT (default 8001)
   ```

## Environment variables
| Var | Where to find it | Purpose |
|-----|------------------|---------|
| `SUPABASE_URL` | Supabase → Project Settings → API | Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys | Public key; verifies user JWTs |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys | **Secret**; server-side DB (bypasses RLS) |
| `ADMIN_EMAIL` | you choose | Email auto-promoted to admin |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Your Claude key (AI OCR + reasoning) |
| `ANTHROPIC_MODEL` | — | Claude model id (default `claude-3-5-sonnet-latest`) |
| `CORS_ORIGINS` | — | Your frontend origin(s), comma-separated |
| `PORT` | — | Listen port (default 8001) |

## API surface (all prefixed with `/api`, all protected routes need `Authorization: Bearer <supabase_jwt>`)
- `GET /auth/me` — returns the profile (creates it on first call)
- `PUT /profile`
- `GET /stats`
- `GET /admin/overview`, `GET /admin/users`, `POST /admin/users/:userId/grant-credits` (admin only)
- `POST /billing/mock-purchase` `{ pack: "starter"|"pro"|"clinic" }`
- `GET /reference`
- `POST /pa/capture` → `POST /pa/:id/dictate` → `GET /pa/:id/grids` → `POST /pa/:id/confirm` → `POST /pa/:id/generate` → `POST /pa/:id/end`

## Frontend change required
Point the React app at Supabase for auth: initialize `@supabase/supabase-js` with your
`SUPABASE_URL` + anon key, use `signInWithPassword` / `signUp` / `signInWithOAuth({provider:'google'})`,
and attach `session.access_token` as the `Authorization: Bearer` header on API calls. The rest of
the app (dashboard, wizard, admin) works unchanged against the same `/api` responses.

## Privacy
No PHI is stored. PA request data (images, transcript, AI output) lives only in an in-memory
store with a 30-minute TTL and is purged on `/pa/:id/end` or expiry. Supabase stores only
profiles, credits, transactions and anonymous usage counters.
