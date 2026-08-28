-- Zhiwu OS V1.13: compliant public-web customer lead discovery MVP.
-- This migration creates a review queue only. It never sends outreach and never
-- writes a lead into CRM until a signed-in user explicitly converts it.

begin;

create table if not exists public.lead_search_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_name text not null,
  product_keywords text[] not null default array[]::text[],
  application_keywords text[] not null default array[]::text[],
  target_countries text[] not null default array[]::text[],
  excluded_countries text[] not null default array[]::text[],
  target_company_types text[] not null default array[]::text[],
  search_language text not null default 'English',
  max_results integer not null default 15 check (max_results between 1 and 30),
  daily_enabled boolean not null default false,
  daily_run_time time not null default '08:30',
  status text not null default '启用' check (status in ('启用', '暂停')),
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('成功', '失败', '跳过')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, task_name)
);

create table if not exists public.lead_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.lead_search_tasks(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('manual', 'daily', 'retry')),
  status text not null default '运行中' check (status in ('运行中', '成功', '失败', '跳过')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  discovered_count integer not null default 0,
  inserted_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text,
  run_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.lead_search_tasks(id) on delete set null,
  company_name text not null,
  country text,
  city text,
  website text,
  website_domain text,
  source_url text not null,
  source_type text not null default '官网' check (source_type in ('官网', '展会目录', '协会目录', '行业目录', '新闻', '公开搜索结果', '其他公开网页')),
  public_contact_name text,
  public_contact_title text,
  public_business_email text,
  public_business_phone text,
  discovered_product_keywords text[] not null default array[]::text[],
  discovered_application_keywords text[] not null default array[]::text[],
  possible_need text,
  match_score integer not null default 0 check (match_score between 0 and 100),
  score_reasons jsonb not null default '[]'::jsonb,
  suspected_duplicate boolean not null default false,
  duplicate_customer_id uuid references public.customers(id) on delete set null,
  duplicate_supplier_id uuid references public.suppliers(id) on delete set null,
  robots_status text not null default 'checked',
  robots_reason text,
  discovered_at timestamptz not null default now(),
  status text not null default '待审核' check (status in ('待审核', '保留', '已转 CRM', '已排除', '已联系')),
  exclusion_reason text,
  notes text,
  watchlisted boolean not null default false,
  crm_customer_id uuid references public.customers(id) on delete set null,
  development_task_id uuid references public.tasks(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, source_url)
);

alter table public.tasks add column if not exists lead_id uuid references public.customer_leads(id) on delete set null;

create index if not exists lead_search_tasks_schedule_idx on public.lead_search_tasks(daily_enabled, status, daily_run_time);
create index if not exists lead_runs_task_started_idx on public.lead_discovery_runs(task_id, started_at desc);
create index if not exists customer_leads_review_idx on public.customer_leads(user_id, status, discovered_at desc);
create index if not exists customer_leads_domain_idx on public.customer_leads(user_id, website_domain);

alter table public.lead_search_tasks enable row level security;
alter table public.lead_discovery_runs enable row level security;
alter table public.customer_leads enable row level security;

drop policy if exists "own lead search tasks" on public.lead_search_tasks;
drop policy if exists "own lead discovery runs" on public.lead_discovery_runs;
drop policy if exists "own customer leads" on public.customer_leads;
create policy "own lead search tasks" on public.lead_search_tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own lead discovery runs" on public.lead_discovery_runs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own customer leads" on public.customer_leads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Defaults are manually runnable; daily automation stays off until the owner enables it.
do $$
declare zhiwu_id uuid;
begin
  select user_id into zhiwu_id from public.mailbox_accounts where mailbox_key = 'zhiwu' limit 1;
  if zhiwu_id is not null then
    insert into public.lead_search_tasks (user_id, task_name, product_keywords, application_keywords, target_countries, target_company_types, search_language, max_results, daily_enabled, status)
    values
      (zhiwu_id, 'PHA 水性阻隔涂层', array['PHA water-based barrier coating','waterborne barrier coating','PFAS-free barrier coating'], array['paper packaging','moulded pulp','paper cup','food packaging'], array['India','Thailand','Philippines','Netherlands','Europe'], array['制造商','包装公司','涂料/油墨公司'], 'English', 15, false, '启用'),
      (zhiwu_id, 'PPC / 可降解薄膜', array['polypropylene carbonate PPC','biodegradable film resin','barrier film resin'], array['flexible packaging','cast film','food packaging film'], array[]::text[], array['制造商','包装公司','贸易商'], 'English', 15, false, '启用'),
      (zhiwu_id, '水性 CPP / CPO 附着力促进剂', array['waterborne CPP','waterborne CPO','chlorinated polyolefin adhesion promoter'], array['PP coating','automotive interior','water-based coating'], array[]::text[], array['制造商','涂料/油墨公司'], 'English', 15, false, '启用')
    on conflict (user_id, task_name) do nothing;
  end if;
end $$;

commit;
