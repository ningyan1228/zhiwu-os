-- Zhiwu OS V1.7: AI Import Inbox
-- Run after v1_6_daily_focus.sql in the Supabase SQL Editor.
-- This module is deliberately review-first: JSON is stored as a draft, then
-- only the user-confirmed batch is written to business tables.

create table if not exists public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schema_version text not null,
  source_type text,
  source_date date,
  source_reference text,
  raw_payload jsonb not null,
  preview jsonb,
  status text not null default 'draft' check (status in ('draft', 'applied', 'reverted', 'failed')),
  applied_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.import_effects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  import_batch_id uuid not null references public.import_batches(id) on delete cascade,
  entity_type text not null check (entity_type in ('customer', 'project', 'product', 'product_customer_relation', 'followup', 'task', 'timeline')),
  action text not null check (action in ('created', 'updated')),
  record_id uuid not null,
  before_data jsonb,
  after_data jsonb,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Imported records are never hard-deleted by a reversal. New records are
-- hidden from operational lists with this soft-reversal flag; updated records
-- are restored to their recorded before_data.
alter table public.customers add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.customers add column if not exists import_reverted boolean not null default false;
alter table public.products add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.products add column if not exists import_reverted boolean not null default false;
alter table public.projects add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.projects add column if not exists import_reverted boolean not null default false;
alter table public.followups add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.followups add column if not exists import_reverted boolean not null default false;
alter table public.tasks add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.tasks add column if not exists import_reverted boolean not null default false;
alter table public.timeline_events add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.timeline_events add column if not exists import_reverted boolean not null default false;
alter table public.product_customer_relations add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.product_customer_relations add column if not exists import_reverted boolean not null default false;

create index if not exists import_batches_user_created_idx on public.import_batches(user_id, created_at desc);
create index if not exists import_effects_batch_idx on public.import_effects(import_batch_id, created_at);
create index if not exists customers_import_active_idx on public.customers(user_id, import_reverted);
create index if not exists products_import_active_idx on public.products(user_id, import_reverted);

alter table public.import_batches enable row level security;
alter table public.import_effects enable row level security;

do $$ begin
  create policy "own import batches" on public.import_batches
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own import effects" on public.import_effects
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
