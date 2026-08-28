-- Zhiwu OS V1.15: allow a bounded 100-result public-web crawl per task.
-- Runs remain sequential and robots.txt-aware; this only raises the review
-- queue cap, never the crawler's concurrency.
begin;

alter table public.lead_search_tasks
  drop constraint if exists lead_search_tasks_max_results_check;

alter table public.lead_search_tasks
  add constraint lead_search_tasks_max_results_check
  check (max_results between 1 and 100);

commit;
