# PA Copilot — Node.js / Express backend

A drop-in Node/Express reimplementation of the PA Copilot backend. It exposes the
**exact same `/api/...` routes and JSON shapes** as the FastAPI version, so the existing
React frontend works against it unchanged — just point `REACT_APP_BACKEND_URL` at this server.

## Stack
- **Node.js + Express**
- **MongoDB** (official `mongodb` driver)
- **Auth:** JWT (email/password, `jsonwebtoken` + `bcryptjs`) **and** Emergent-managed Google login
- **AI (your own key):** Anthropic **Claude** via `@anthropic-ai/sdk` — used for both the 4-panel
  reasoning and the document vision OCR. Bring your own `ANTHROPIC_API_KEY`.

## Setup
```bash
cd backend-node
cp .env.example .env          # then edit values
# npm install     (or)     yarn install
npm start                     # boots on PORT (default 8001)
```

### Required environment variables (`.env`)
| Var | Purpose |
|-----|---------|
| `PORT` | Port to listen on (default 8001) |
| `MONGO_URL` | MongoDB connection string |
| `DB_NAME` | Database name |
| `CORS_ORIGINS` | Comma-separated allowed origins (your frontend URL). Blank = reflect origin |
| `JWT_SECRET` | Long random secret for signing JWTs |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded admin account (role `admin`, 100 credits) |
| `COOKIE_SECURE` | `true` for HTTPS (required for cross-site cookies); `false` for local http |
| `ANTHROPIC_API_KEY` | **Your** Anthropic key |
| `ANTHROPIC_MODEL` | Claude model id (default `claude-3-5-sonnet-latest`) |

## API surface (all prefixed with `/api`)
- **Auth:** `POST /auth/register`, `POST /auth/login`, `POST /auth/session` (Google, needs `X-Session-ID`), `POST /auth/logout`, `GET /auth/me`, `PUT /profile`
- **Stats:** `GET /stats`
- **Admin (role=admin):** `GET /admin/overview`, `GET /admin/users`, `POST /admin/users/:userId/grant-credits`
- **Billing (mock):** `POST /billing/mock-purchase` (`{ pack: "starter"|"pro"|"clinic" }`)
- **Reference:** `GET /reference`
- **PA pipeline:** `POST /pa/capture` → `POST /pa/:id/dictate` → `GET /pa/:id/grids` → `POST /pa/:id/confirm` → `POST /pa/:id/generate` → `POST /pa/:id/end`

## Privacy model
No PHI is persisted. PA request data (images, transcript, AI output) lives only in an
in-memory store with a 30-minute TTL and is purged on `/pa/:id/end` or on expiry.
MongoDB stores only accounts, credit transactions, sessions and anonymous usage counters.

## Notes on differences from the Emergent-hosted version
- The Emergent universal LLM key is Python-only; this Node build uses **your own Anthropic key** instead.
- Google login uses the Emergent auth service (`/auth/session` with `X-Session-ID`); to use a
  different OAuth provider, swap that handler.
- Cross-site cookies require HTTPS + `COOKIE_SECURE=true` + an exact `CORS_ORIGINS` origin.

## Deploy
Any Node host works (Render, Railway, Fly, a VM, etc.). Set the env vars, run `npm start`,
and put it behind HTTPS. Point your React app's `REACT_APP_BACKEND_URL` to this server's base URL.
