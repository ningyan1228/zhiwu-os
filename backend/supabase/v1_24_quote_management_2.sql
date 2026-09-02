-- Zhiwu OS V1.24: formal quotation, revisions and quote-to-order conversion.
-- Commercial facts remain explicit.  Email-derived records are drafts only and
-- cannot be represented as sent quotations without an actual evidence record.
begin;

alter table public.quotes
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  add column if not exists quote_number text,
  add column if not exists version integer not null default 1,
  add column if not exists revision_of_quote_id uuid references public.quotes(id) on delete set null,
  add column if not exists product_code text,
  add column if not exists product_name_snapshot text,
  add column if not exists specification text,
  add column if not exists packaging text,
  add column if not exists quantity_unit text,
  add column if not exists unit_price numeric(14, 4),
  add column if not exists incoterm text,
  add column if not exists loading_port text,
  add column if not exists destination_port text,
  add column if not exists lead_time text,
  add column if not exists moq text,
  add column if not exists valid_until date,
  add column if not exists payment_terms text,
  add column if not exists source_email_id uuid references public.emails(id) on delete set null,
  add column if not exists source_evidence_summary text,
  add column if not exists send_evidence_type text,
  add column if not exists manual_send_confirmed_at timestamptz,
  add column if not exists manual_send_note text,
  add column if not exists sent_at timestamptz,
  add column if not exists internal_supplier_quote_refs text[] not null default array[]::text[],
  add column if not exists internal_technical_document_refs text[] not null default array[]::text[],
  add column if not exists internal_notes text,
  add column if not exists converted_order_id uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.quotes
set quote_number = coalesce(quote_number, 'LEGACY-' || upper(replace(left(id::text, 8), '-', ''))),
    version = coalesce(version, 1),
    product_code = coalesce(product_code, ''),
    updated_at = coalesce(updated_at, created_at, now())
where quote_number is null or product_code is null;

alter table public.quotes alter column quote_number set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_number_version_unique') then
    alter table public.quotes add constraint quotes_number_version_unique unique (user_id, quote_number, version);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'quotes_send_evidence_check') then
    alter table public.quotes add constraint quotes_send_evidence_check check (
      status not in ('已发送', '客户议价', '已接受')
      or source_email_id is not null
      or manual_send_confirmed_at is not null
    );
  end if;
end $$;

create index if not exists quotes_project_idx on public.quotes(user_id, project_id, created_at desc);
create index if not exists quotes_source_email_idx on public.quotes(user_id, source_email_id) where source_email_id is not null;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  order_number text not null,
  quote_id uuid not null references public.quotes(id) on delete restrict,
  customer_id uuid not null references public.customers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  product_code text,
  product_name_snapshot text,
  specification text,
  packaging text,
  quantity text,
  quantity_unit text,
  unit_price numeric(14, 4),
  amount numeric(14, 2),
  currency text not null default 'USD',
  incoterm text,
  loading_port text,
  destination_port text,
  lead_time text,
  payment_terms text,
  status text not null default '待PI/合同确认',
  execution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, order_number),
  unique(quote_id)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'quotes_converted_order_fk') then
    alter table public.quotes add constraint quotes_converted_order_fk foreign key (converted_order_id) references public.sales_orders(id) on delete set null;
  end if;
end $$;

alter table public.sales_orders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'sales_orders' and policyname = 'own sales orders') then
    create policy "own sales orders" on public.sales_orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

commit;
