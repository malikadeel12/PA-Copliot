# PA Copilot — PRD

## Original Problem Statement
Build "PA Copilot" from the provided MVP Build Brief: a physician-facing web app that turns a prior-authorization request into a submission-ready package (filled PA form, approval-likelihood analysis, ranked suggestions, medical-necessity cover letter) in under 5 minutes, WITHOUT connecting to an EHR and WITHOUT persisting any PHI after the session. Core trust claim: "we never store your patient's data." User had documentation only, no UI/theme — design was to be derived.

## Architecture (adapted to platform stack)
- Brief specified Node/Express + Supabase + Google Document AI + Anthropic + Stripe.
- Implemented on platform stack: **React + FastAPI + MongoDB**.
- AI via **Emergent universal LLM key**: reasoning = `anthropic/claude-sonnet-4-6`; vision OCR = `openai/gpt-5.4`.
- Auth: JWT email/password + Emergent-managed Google login (coexist).
- Credits: free 5 on signup + mock purchase (Stripe deferred).
- Design: Light "Organic/Earthy" theme — stone-50 base, emerald-600 primary, Outfit + IBM Plex Sans. (design_guidelines.json)

## User Personas
- Physicians / clinical staff doing repetitive insurance prior-auth paperwork; time-pressed, non-technical, mobile-first.

## Core Requirements (static)
- 6-step ephemeral wizard: Capture → Dictate → Validate → AI Reasoning → Package → Purge.
- No PHI persisted: PA request data lives only in in-memory store (30-min TTL), purged on export/session-end.
- Single consolidated Claude call → 4 result panels.
- Local rule engine: payer portal matrix, ICD→CPT/HCPCS/NDC cross-walk, modifier/quantity presets.

## Implemented (2026-07-03)
- Backend: auth (register/login/me/logout/session/profile), JWT + Emergent Google, admin seed, credits + mock purchase, `/api/reference`, full PA pipeline (`capture` vision OCR, `dictate`, `grids`, `confirm`, `generate` Claude 4-panel + credit decrement, `end` purge), in-memory TTL store + sweep.
- Frontend: split-screen Login (email/pw + Google), Dashboard (credits, CTA, how-it-works, privacy), Profile, BuyCredits, and the 4-step Wizard (CaptureStep image upload + extracted grid, DictationStep web-speech + template slots, ValidateStep portal/cross-walk/modifiers/quantity/urgency, ResultsStep 4 panels + approval gauge + print/JSON export + purge).
- Verified: 14/16 backend tests pass; reasoning pipeline smoke-tested returns all 4 panels; frontend all screens render with data-testid.

## Known / Deferred
- 2 backend tests (`generate` success + 402 path) blocked ONLY by Emergent LLM key budget cap during test run (external, not a code bug).
- Stripe real checkout (mock now); Google Document AI (using AI vision instead); PDF/ZIP server-side assembly (client print/JSON export now); e-signature image capture; denial-appeal flow (v2).

## Backlog (prioritized)
- P0: Confirm `generate` end-to-end once LLM key budget topped up; retest credit decrement + 402.
- P1: Real Stripe credit checkout + webhook ledger; server-side PDF export (pdf-lib/reportlab); one-click "apply suggestion" that patches narrative & re-generates.
- P2: Google Document AI option; e-signature pad; usage dashboard; denial appeal letter workflow.

## Next Tasks
1. User tops up Emergent LLM key balance (Profile → Universal Key → Add Balance), then retest full generate flow.
2. Add real Stripe checkout.
3. Server-side PDF/ZIP export bundle.
