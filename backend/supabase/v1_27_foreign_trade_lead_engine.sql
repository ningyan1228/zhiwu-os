-- Zhiwu OS V1.27: configurable, review-first foreign-trade lead engine.
-- This extends (rather than replaces) V1.13 customer_leads, so existing CRM
-- records and previously reviewed discovery evidence remain intact.
begin;

create table if not exists public.product_keywords (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  keyword text not null check (char_length(trim(keyword)) between 1 and 300),
  keyword_type text not null default 'include' check (keyword_type in ('include', 'exclude', 'local')),
  language_code text not null default 'en' check (char_length(language_code) between 2 and 16),
  country text,
  weight integer not null default 5 check (weight between 1 and 20),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, product_id, keyword, language_code, country)
);

create table if not exists public.crawl_sources (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 200),
  source_type text not null check (source_type in ('官网', '展会目录', '协会目录', '行业目录', '政府或商会目录', '用户导入', '合规搜索 API')),
  start_url text,
  country text,
  industry text,
  enabled boolean not null default true,
  request_delay_seconds numeric(4,1) not null default 3 check (request_delay_seconds between 1 and 30),
  max_pages integer not null default 8 check (max_pages between 1 and 50),
  last_run_at timestamptz,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, name)
);

create table if not exists public.domain_blocklist (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  root_domain text not null check (root_domain !~ '[/:@]'),
  reason text not null default '人工屏蔽',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(owner_user_id, root_domain)
);

alter table public.lead_search_tasks
  add column if not exists run_state text not null default '草稿'
    check (run_state in ('草稿', '排队中', '搜索中', '抓取中', '分析中', '已暂停', '已完成', '部分失败', '已取消')),
  add column if not exists pause_requested boolean not null default false,
  add column if not exists cancel_requested boolean not null default false,
  add column if not exists current_url text,
  add column if not exists last_progress jsonb not null default '{}'::jsonb,
  add column if not exists minimum_match_score integer not null default 40 check (minimum_match_score between 0 and 100),
  add column if not exists max_pages_per_domain integer not null default 8 check (max_pages_per_domain between 1 and 20),
  add column if not exists extract_public_email boolean not null default true,
  add column if not exists visit_contact_page boolean not null default true,
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists task_note text;

alter table public.lead_discovery_runs
  add column if not exists failed_count integer not null default 0,
  add column if not exists duplicate_count integer not null default 0,
  add column if not exists analyzed_count integer not null default 0,
  add column if not exists current_url text,
  add column if not exists retry_of_run_id uuid references public.lead_discovery_runs(id) on delete set null;

alter table public.customer_leads
  add column if not exists root_domain text,
  add column if not exists public_emails jsonb not null default '[]'::jsonb,
  add column if not exists public_phones jsonb not null default '[]'::jsonb,
  add column if not exists contact_page_url text,
  add column if not exists confidence_score integer check (confidence_score between 0 and 100),
  add column if not exists risk_flags jsonb not null default '[]'::jsonb,
  add column if not exists recommended_product text,
  add column if not exists recommended_pitch text,
  add column if not exists evidence_snippets jsonb not null default '[]'::jsonb,
  add column if not exists last_verified_at timestamptz,
  add column if not exists source_content_hash text;

update public.customer_leads
set root_domain = coalesce(root_domain, website_domain)
where root_domain is null and website_domain is not null;

-- Existing V1.13 runs may legitimately contain historical cross-task records
-- for the same domain. Keep all of that evidence and use this lookup index;
-- the importer/crawler performs an owner+root-domain upsert before writes.
create index if not exists customer_leads_owner_root_domain_idx
  on public.customer_leads(user_id, root_domain)
  where root_domain is not null and root_domain <> '';
create index if not exists customer_leads_score_idx on public.customer_leads(user_id, match_score desc, discovered_at desc);
create index if not exists customer_leads_country_idx on public.customer_leads(user_id, country, discovered_at desc);
create index if not exists product_keywords_product_idx on public.product_keywords(owner_user_id, product_id, enabled);
create index if not exists crawl_sources_owner_idx on public.crawl_sources(owner_user_id, enabled, updated_at desc);
create index if not exists domain_blocklist_owner_idx on public.domain_blocklist(owner_user_id, enabled);

alter table public.product_keywords enable row level security;
alter table public.crawl_sources enable row level security;
alter table public.domain_blocklist enable row level security;

drop policy if exists "own product keywords" on public.product_keywords;
drop policy if exists "own crawl sources" on public.crawl_sources;
drop policy if exists "own domain blocklist" on public.domain_blocklist;
create policy "own product keywords" on public.product_keywords for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own crawl sources" on public.crawl_sources for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own domain blocklist" on public.domain_blocklist for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

-- Safe starter configuration: only the signed-in owner can see or modify it.
insert into public.crawl_sources (owner_user_id, name, source_type, country, industry, enabled)
select auth.uid(), '用户种子 URL / CSV', '用户导入', null, '通用', true
where auth.uid() is not null
on conflict (owner_user_id, name) do nothing;

commit;
