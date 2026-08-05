-- PA Copilot — Supabase schema (Postgres). Run in the Supabase SQL Editor.
-- Stores ONLY account profiles, credits, transactions and anonymous usage events.
-- No clinical data (PHI) is ever stored.

-- 1) profiles: 1 row per auth user (id references auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'physician',           -- 'physician' | 'admin'
  credits integer not null default 0,
  npi text,
  specialty text,
  facility_name text,
  facility_address text,
  signature_data_url text,
  auth_provider text default 'email',
  trial_ends_at timestamptz,                       -- 7-day free trial window
  created_at timestamptz not null default now()
);
-- Safe add for existing projects that already have profiles:
alter table public.profiles add column if not exists trial_ends_at timestamptz;

-- 2) credit ledger
create table if not exists public.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                                -- signup_grant | purchase | consume | admin_grant
  amount integer not null,
  pack text,
  granted_by uuid,
  paypal_order_id text,
  paypal_capture_id text,
  created_at timestamptz not null default now()
);
create index if not exists idx_credit_tx_user on public.credit_transactions(user_id);

-- 3) anonymous usage events
create table if not exists public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,                          -- e.g. pa_request_completed
  created_at timestamptz not null default now()
);
create index if not exists idx_usage_user on public.usage_events(user_id);

-- 4) PayPal Orders ledger — one row per PayPal order we create. Used to:
--    * enforce ownership when /billing/capture-order/:id is hit
--    * map pack/credits so capture can credit the correct user
--    * idempotency (a row that's already COMPLETED never re-credits)
-- All inserts/updates happen server-side via the service-role key, so no
-- RLS policies are needed for authenticated users.
create table if not exists public.paypal_orders (
  id text primary key,                               -- PayPal order id (17 chars)
  user_id uuid not null references auth.users(id) on delete cascade,
  pack text not null,                                -- starter | pro | clinic
  credits integer not null,
  amount_usd numeric(10,2) not null,
  status text not null default 'CREATED',            -- CREATED | APPROVED | COMPLETED | CANCELLED
  capture_id text,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_paypal_orders_user on public.paypal_orders(user_id);
create index if not exists idx_paypal_orders_status on public.paypal_orders(status);

-- Enforce the (user_id, paypal_order_id) uniqueness that the backend relies
-- on for idempotent credit grants (treats a 23505 as a benign duplicate).
create unique index if not exists uq_credit_tx_paypal_order
  on public.credit_transactions(paypal_order_id)
  where paypal_order_id is not null;

-- ---------------------------------------------------------------------------
-- Row Level Security. The backend uses the SERVICE ROLE key, which bypasses
-- RLS. These policies protect direct client (anon key) access so a signed-in
-- user can only read/update their own rows.
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.usage_events        enable row level security;
alter table public.paypal_orders       enable row level security;

-- paypal_orders: no client policies — only the service role (backend) may touch rows.
drop policy if exists "paypal_orders deny all authenticated" on public.paypal_orders;

drop policy if exists "own profile select" on public.profiles;
create policy "own profile select" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own credit tx select" on public.credit_transactions;
create policy "own credit tx select" on public.credit_transactions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "own usage select" on public.usage_events;
create policy "own usage select" on public.usage_events
  for select to authenticated using (auth.uid() = user_id);

-- Note: inserts/updates to credits & events happen server-side via the service
-- role key (bypasses RLS), so no INSERT policies for `authenticated` are needed.
