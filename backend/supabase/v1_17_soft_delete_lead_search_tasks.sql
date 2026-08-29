-- Zhiwu OS V1.17: hide deleted discovery tasks without deleting evidence/history.
begin;

alter table public.lead_search_tasks
  add column if not exists deleted_at timestamptz;

create index if not exists lead_search_tasks_active_idx
  on public.lead_search_tasks(user_id, deleted_at, created_at asc);

commit;
