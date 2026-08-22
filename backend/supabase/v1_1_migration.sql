-- Zhiwu OS V1.1: CRM projects, quotations and richer customer workflow.
-- Run this once in Supabase SQL Editor after the original schema.sql.

alter table public.customers add column if not exists priority text not null default 'MEDIUM'
  check (priority in ('HIGH', 'MEDIUM HIGH', 'MEDIUM'));
alter table public.customers add column if not exists application text;
alter table public.customers add column if not exists status_label text;
alter table public.customers add column if not exists status_tone text
  check (status_tone in ('warning', 'attention', 'success'));

-- Replace the V1 short stage list with the complete trade workflow.
alter table public.customers drop constraint if exists customers_customer_stage_check;
alter table public.customers add constraint customers_customer_stage_check check (customer_stage in (
  'New', 'Inquiry', 'Quoted', 'Sample', 'Negotiation', 'Won', 'Lost',
  'New Inquiry', 'Technical Discussion', 'Quotation', 'Sample Payment',
  'Sample Payment Pending', 'Technical Testing', 'Technical Confirmation', 'Maintain Relationship'
));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  project_name text not null,
  product_id uuid references public.products(id) on delete set null,
  application text,
  stage text not null default 'New Inquiry',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  quantity text not null,
  amount numeric(14, 2),
  currency text not null default 'USD',
  trade_term text,
  status text not null default 'Draft',
  created_at timestamptz not null default now()
);

create index if not exists projects_customer_idx on public.projects(customer_id, created_at desc);
create index if not exists quotes_customer_idx on public.quotes(customer_id, created_at desc);

alter table public.projects enable row level security;
alter table public.quotes enable row level security;

do $$ begin
  create policy "own projects" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own quotes" on public.quotes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
