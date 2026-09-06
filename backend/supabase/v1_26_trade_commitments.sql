-- Zhiwu OS V1.26: evidence-backed foreign-trade commitment ledger.
-- A commitment records one side of a verifiable promise. It is deliberately
-- separate from CRM stages and follow-up prose, so payment, samples, TDS and
-- shipment duties cannot be silently lost in a long note.
begin;

create table if not exists public.trade_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  title text not null,
  category text not null default '其他',
  responsible_party text not null check (responsible_party in ('客户承诺','我方承诺','双方约定')),
  status text not null default '待核对' check (status in ('已确认','我方待办','等待客户','待核对','已兑现')),
  due_date date,
  evidence_type text not null default '其他' check (evidence_type in ('微信手动记录','邮件','项目记录','运单/物流','付款凭证','其他')),
  evidence_reference text,
  evidence_note text not null,
  detail text,
  next_action text,
  completed_at timestamptz,
  archived_at timestamptz,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trade_commitments_customer_idx
  on public.trade_commitments (user_id, customer_id, due_date asc);
create index if not exists trade_commitments_open_idx
  on public.trade_commitments (user_id, status, due_date asc)
  where archived_at is null;

alter table public.trade_commitments enable row level security;
drop policy if exists "own trade commitments" on public.trade_commitments;
create policy "own trade commitments" on public.trade_commitments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
