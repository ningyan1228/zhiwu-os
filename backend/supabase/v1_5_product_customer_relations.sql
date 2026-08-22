-- Zhiwu OS V1.5: persistent product-to-customer relationship matrix.
-- Run after v1_4_customer_intelligence.sql.

create table if not exists public.product_customer_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, product_id, customer_id)
);

create index if not exists product_customer_relations_product_idx
  on public.product_customer_relations(product_id, created_at desc);
create index if not exists product_customer_relations_customer_idx
  on public.product_customer_relations(customer_id, created_at desc);

alter table public.product_customer_relations enable row level security;
do $$ begin
  create policy "own product customer relations" on public.product_customer_relations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;

-- Preserve product relationships that already exist through CRM projects or a product code.
insert into public.product_customer_relations (user_id, product_id, customer_id)
select p.user_id, p.product_id, p.customer_id
from public.projects p
where p.product_id is not null
on conflict (user_id, product_id, customer_id) do nothing;

insert into public.product_customer_relations (user_id, product_id, customer_id)
select c.user_id, p.id, c.id
from public.customers c
join public.products p on p.user_id = c.user_id and p.product_code = c.product_interest
on conflict (user_id, product_id, customer_id) do nothing;
