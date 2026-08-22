-- Zhiwu OS Daily Focus & Calendar V1.6
-- Run this script in Supabase SQL Editor after v1_5_product_customer_relations.sql.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  category text not null default '外贸' check (category in ('外贸', '网站', '设计', '学习', '生活', '其他')),
  priority text not null default 'normal' check (priority in ('important', 'normal', 'low')),
  status text not null default 'Pending' check (status in ('Pending', 'Completed')),
  task_date date not null default current_date,
  start_time time,
  end_time time,
  estimated_minutes integer check (estimated_minutes is null or estimated_minutes between 5 and 1440),
  customer_id uuid references public.customers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists tasks_user_date_idx on public.tasks(user_id, task_date, start_time);
create index if not exists tasks_customer_idx on public.tasks(customer_id, task_date desc);

create table if not exists public.daily_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  log_date date not null,
  summary text,
  problem text,
  tomorrow_plan text,
  rating integer check (rating is null or rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, log_date)
);

create index if not exists daily_logs_user_date_idx on public.daily_logs(user_id, log_date desc);

create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_date date not null default current_date,
  event_time time,
  title text not null,
  event_type text not null check (event_type in ('task', 'email', 'crm', 'project', 'note')),
  source text not null default 'manual',
  related_id uuid,
  customer_id uuid references public.customers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  product_id uuid references public.products(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists timeline_events_user_date_idx on public.timeline_events(user_id, event_date desc, event_time desc);
create index if not exists timeline_events_customer_idx on public.timeline_events(customer_id, event_date desc);

alter table public.tasks enable row level security;
alter table public.daily_logs enable row level security;
alter table public.timeline_events enable row level security;

drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own daily logs" on public.daily_logs;
create policy "own daily logs" on public.daily_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own timeline events" on public.timeline_events;
create policy "own timeline events" on public.timeline_events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Seed only three practical starter tasks. They appear only for the task owner's account.
insert into public.tasks (user_id, title, category, priority, task_date, start_time, end_time, estimated_minutes, customer_id, project_id, product_id)
select c.user_id, '发送 Uflex 样品 PI', '外贸', 'important', current_date, '09:00', '10:00', 60, c.id, p.id, p.product_id
from public.customers c
left join public.projects p on p.customer_id = c.id
where c.company_name = 'Uflex'
  and not exists (select 1 from public.tasks t where t.user_id = c.user_id and t.title = '发送 Uflex 样品 PI' and t.task_date = current_date);

insert into public.tasks (user_id, title, category, priority, task_date, start_time, end_time, estimated_minutes, customer_id, project_id, product_id)
select c.user_id, '跟进 Agrileaf 样品付款', '外贸', 'important', current_date, '10:30', '11:00', 30, c.id, p.id, p.product_id
from public.customers c
left join public.projects p on p.customer_id = c.id
where c.company_name = 'Agrileaf'
  and not exists (select 1 from public.tasks t where t.user_id = c.user_id and t.title = '跟进 Agrileaf 样品付款' and t.task_date = current_date);

insert into public.tasks (user_id, title, category, priority, task_date, start_time, end_time, estimated_minutes, product_id)
select p.user_id, '制作 HM-800 产品图片', '设计', 'normal', current_date, '14:00', '16:00', 120, p.id
from public.products p
where p.product_code = 'HM-800'
  and not exists (select 1 from public.tasks t where t.user_id = p.user_id and t.title = '制作 HM-800 产品图片' and t.task_date = current_date);
