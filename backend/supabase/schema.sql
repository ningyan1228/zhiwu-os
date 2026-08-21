-- Execute this file in Supabase SQL Editor. RLS reads the authenticated user id from the JWT.
create extension if not exists "pgcrypto";

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_name text not null, country text not null, contact_person text not null, email text not null,
  whatsapp text, wechat text, website text, product_interest text, customer_stage text not null default 'New'
    check (customer_stage in ('New','Inquiry','Quoted','Sample','Negotiation','Won','Lost')),
  last_contact_date date, next_followup_date date, notes text, created_at timestamptz not null default now()
);
create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade, date date not null default current_date,
  content text not null, next_action text, status text not null default 'Open' check (status in ('Open','Done')), created_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_name text not null, product_code text not null, category text, application text, description text,
  tds_url text, coa_url text, image_url text, notes text, created_at timestamptz not null default now(), unique(user_id, product_code)
);
create index if not exists customers_followup_idx on public.customers(user_id, next_followup_date);
create index if not exists followups_customer_idx on public.followups(customer_id, date desc);

alter table public.customers enable row level security;
alter table public.followups enable row level security;
alter table public.products enable row level security;
create policy "own customers" on public.customers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own followups" on public.followups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own products" on public.products for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- V2 tables are intentionally omitted until their workflows are finalized.
