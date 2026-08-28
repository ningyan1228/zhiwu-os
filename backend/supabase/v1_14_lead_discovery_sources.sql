-- Zhiwu OS V1.14: trusted input sources for compliant lead discovery.
-- Search keys remain server-only; public directory URLs are reviewed through
-- robots.txt before any company page is requested.
begin;

alter table public.lead_search_tasks
  add column if not exists source_urls text[] not null default array[]::text[];

commit;
