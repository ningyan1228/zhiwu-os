-- Zhiwu OS V1.10: fields required by the AI Import Inbox.
-- Safe to rerun. This preserves every existing customer record.

begin;

alter table public.customers
  add column if not exists next_action text[] not null default array[]::text[];

-- Keep the dashboard and import API fast when selecting operational records.
create index if not exists customers_next_followup_operational_idx
  on public.customers(next_followup_date)
  where archived_at is null;

commit;
