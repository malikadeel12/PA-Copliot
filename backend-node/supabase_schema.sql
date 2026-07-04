-- PA Copilot — Supabase schema (Postgres). Run in the Supabase SQL Editor.
-- Stores ONLY account profiles, credits, transactions and anonymous usage events.
-- No clinical data (PHI) is ever stored.

-- 1) profiles: 1 row per auth user (id references auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'physician',           -- 'physician' | 'admin'
  credits integer not null default 5,
  npi text,
  specialty text,
  facility_name text,
  facility_address text,
  signature_data_url text,
  auth_provider text default 'email',
  created_at timestamptz not null default now()
);

-- 2) credit ledger
create table if not exists public.credit_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                                -- signup_grant | purchase | consume | admin_grant
  amount integer not null,
  pack text,
  granted_by uuid,
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

-- ---------------------------------------------------------------------------
-- Row Level Security. The backend uses the SERVICE ROLE key, which bypasses
-- RLS. These policies protect direct client (anon key) access so a signed-in
-- user can only read/update their own rows.
-- ---------------------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.usage_events        enable row level security;

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
