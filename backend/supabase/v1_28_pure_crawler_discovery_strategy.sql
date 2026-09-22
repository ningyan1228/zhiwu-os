-- Zhiwu OS V1.28: make public-directory / official-site crawling the default.
-- Existing tasks are migrated safely and keep working without any API key.
begin;

alter table public.lead_search_tasks
  add column if not exists discovery_strategy text not null default 'public_seed_crawl'
    check (discovery_strategy in ('public_seed_crawl', 'search_plus_crawl'));

update public.lead_search_tasks
set discovery_strategy = 'public_seed_crawl'
where discovery_strategy is null;

commit;
