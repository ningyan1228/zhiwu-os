-- Zhiwu OS V1.30: generic TDS -> confirmed applications -> customer discovery.
-- This is additive: legacy product profiles, NL-FC-PU campaigns, CRM records,
-- mail drafts and existing leads remain intact.
begin;

create table if not exists public.tds_documents (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  original_file_name text not null,
  document_version text,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0 and byte_size <= 15728640),
  content_sha256 text not null,
  parse_status text not null check (parse_status in ('已解析', '需要 OCR', '解析失败')),
  parse_error text,
  extracted_text text,
  extracted_summary text,
  parsed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(owner_user_id, content_sha256)
);

create table if not exists public.tds_applications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tds_document_id uuid not null references public.tds_documents(id) on delete cascade,
  application_name text not null check (char_length(trim(application_name)) between 1 and 180),
  description text,
  substrate_or_object text,
  material_function text,
  process_conditions text,
  limitations text,
  evidence_excerpt text,
  evidence_page integer check (evidence_page is null or evidence_page > 0),
  evidence_status text not null default '推测待确认' check (evidence_status in ('TDS明确', '推测待确认', '用户补充')),
  target_company_types text[] not null default array[]::text[],
  official_business_evidence text,
  exclusion_notes text,
  search_terms text[] not null default array[]::text[],
  local_search_terms text[] not null default array[]::text[],
  selected boolean not null default false,
  enabled boolean not null default true,
  revision_note text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.application_discovery_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tds_document_id uuid not null references public.tds_documents(id) on delete restrict,
  task_name text not null check (char_length(trim(task_name)) between 1 and 240),
  target_region text,
  candidate_limit integer not null default 20 check (candidate_limit between 1 and 500),
  search_budget integer not null default 0 check (search_budget between 0 and 10000),
  application_snapshot jsonb not null default '[]'::jsonb,
  status text not null default '草稿' check (status in ('草稿', '待配置', '待运行', '运行中', '已完成', '部分失败', '已取消')),
  search_provider text,
  provider_notice text,
  legacy_lead_task_id uuid references public.lead_search_tasks(id) on delete set null,
  discovered_count integer not null default 0,
  verified_count integer not null default 0,
  matched_count integer not null default 0,
  contact_count integer not null default 0,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Retry-safe for databases where an earlier editor selection created the
-- table before this bridge column was introduced.
alter table public.application_discovery_tasks
  add column if not exists legacy_lead_task_id uuid
  references public.lead_search_tasks(id) on delete set null;

create table if not exists public.application_discovery_queries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_task_id uuid not null references public.application_discovery_tasks(id) on delete cascade,
  tds_application_id uuid references public.tds_applications(id) on delete set null,
  query_text text not null,
  query_language text not null default 'en',
  query_kind text not null default 'web' check (query_kind in ('web', 'pdf_directory', 'maps', 'local')),
  execution_status text not null default '待配置' check (execution_status in ('待配置', '待运行', '已运行', '失败')),
  result_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_application_matches (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_lead_id uuid not null references public.customer_leads(id) on delete cascade,
  application_task_id uuid not null references public.application_discovery_tasks(id) on delete cascade,
  tds_application_id uuid references public.tds_applications(id) on delete set null,
  application_snapshot jsonb not null default '{}'::jsonb,
  match_status text not null default '资料不足' check (match_status in ('有直接使用迹象', '应用相关但工艺未知', '间接渠道', '不匹配', '资料不足')),
  matching_reason text,
  pending_confirmation text,
  evidence_strength integer not null default 0 check (evidence_strength between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_lead_id, application_task_id, tds_application_id)
);

-- Use an explicit catalog check here.  Some SQL-editor retries can see a
-- partially selected migration; this block either adds the column or proves
-- it is already present before the index below is attempted.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_leads'
      and column_name = 'application_discovery_task_id'
  ) then
    alter table public.customer_leads
      add column application_discovery_task_id uuid
      references public.application_discovery_tasks(id) on delete set null;
  end if;
end $$;

alter table public.lead_contacts
  add column if not exists phone text,
  add column if not exists whatsapp text,
  add column if not exists social_url text,
  add column if not exists contact_kind text not null default '公共部门邮箱'
    check (contact_kind in ('采购', '技术', '研发', '生产', '公共部门邮箱', '电话', '联系表单', 'LinkedIn', 'Facebook', 'WhatsApp')),
  add column if not exists employment_status text not null default '待核实'
    check (employment_status in ('已核实', '待核实', '未找到'));

create index if not exists tds_documents_owner_idx on public.tds_documents(owner_user_id, parsed_at desc);
create index if not exists tds_applications_document_idx on public.tds_applications(tds_document_id, selected, enabled, created_at);
create index if not exists application_discovery_tasks_owner_idx on public.application_discovery_tasks(owner_user_id, created_at desc);
create index if not exists application_discovery_queries_task_idx on public.application_discovery_queries(application_task_id, created_at);
create index if not exists lead_application_matches_task_idx on public.lead_application_matches(application_task_id, evidence_strength desc);
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'customer_leads'
      and column_name = 'application_discovery_task_id'
  ) then
    execute 'create index if not exists customer_leads_application_task_idx on public.customer_leads(user_id, application_discovery_task_id, discovered_at desc)';
  else
    raise exception 'application_discovery_task_id was not added to public.customer_leads';
  end if;
end $$;

alter table public.tds_documents enable row level security;
alter table public.tds_applications enable row level security;
alter table public.application_discovery_tasks enable row level security;
alter table public.application_discovery_queries enable row level security;
alter table public.lead_application_matches enable row level security;

drop policy if exists "own tds documents" on public.tds_documents;
drop policy if exists "own tds applications" on public.tds_applications;
drop policy if exists "own application discovery tasks" on public.application_discovery_tasks;
drop policy if exists "own application discovery queries" on public.application_discovery_queries;
drop policy if exists "own lead application matches" on public.lead_application_matches;
create policy "own tds documents" on public.tds_documents for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own tds applications" on public.tds_applications for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own application discovery tasks" on public.application_discovery_tasks for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own application discovery queries" on public.application_discovery_queries for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own lead application matches" on public.lead_application_matches for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

commit;
