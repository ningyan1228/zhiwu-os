-- Zhiwu OS V1.21: dual-direction discovery.
-- A task is either demand-side customer discovery or mainland-China factory
-- discovery. Both remain review records until a human explicitly promotes them.
begin;

alter table public.lead_search_tasks
  add column if not exists discovery_mode text not null default '需求客户'
  check (discovery_mode in ('需求客户', '供应工厂'));

alter table public.customer_leads
  add column if not exists discovery_mode text not null default '需求客户'
  check (discovery_mode in ('需求客户', '供应工厂'));

create index if not exists customer_leads_discovery_mode_idx
  on public.customer_leads(user_id, discovery_mode, discovered_at desc);

commit;
