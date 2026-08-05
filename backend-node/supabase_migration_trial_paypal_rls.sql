-- Run once in Supabase SQL Editor (safe to re-run).
-- Covers trial column + PayPal tables/columns that billing needs.

-- 1) Free-trial window on profiles
alter table public.profiles add column if not exists trial_ends_at timestamptz;

-- 2) PayPal order ledger (required for create-order / capture-order)
create table if not exists public.paypal_orders (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  pack text not null,
  credits integer not null,
  amount_usd numeric(10,2) not null,
  status text not null default 'CREATED',
  capture_id text,
  captured_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_paypal_orders_user on public.paypal_orders(user_id);
create index if not exists idx_paypal_orders_status on public.paypal_orders(status);

-- 3) Credit ledger PayPal columns + idempotency
alter table public.credit_transactions add column if not exists paypal_order_id text;
alter table public.credit_transactions add column if not exists paypal_capture_id text;
create unique index if not exists uq_credit_tx_paypal_order
  on public.credit_transactions(paypal_order_id)
  where paypal_order_id is not null;

-- 4) RLS: clients must not read/write paypal_orders (service role only)
alter table public.paypal_orders enable row level security;
