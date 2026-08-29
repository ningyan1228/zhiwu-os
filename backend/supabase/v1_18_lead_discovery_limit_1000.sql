-- Zhiwu OS V1.18: allow a larger, still bounded public-web discovery target.
-- The worker remains sequential, robots.txt-aware and rate-limited. This is a
-- candidate target, not a promise that every result becomes a verified lead.
begin;

alter table public.lead_search_tasks
  drop constraint if exists lead_search_tasks_max_results_check;

alter table public.lead_search_tasks
  add constraint lead_search_tasks_max_results_check
  check (max_results between 1 and 1000);

commit;
