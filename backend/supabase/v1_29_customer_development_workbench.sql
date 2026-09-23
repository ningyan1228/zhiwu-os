-- Zhiwu OS V1.29: review-first customer-development workbench.
-- It reuses public.customer_leads as the company record so explicit CRM
-- conversion, customer ownership and existing evidence fields stay intact.
begin;

create table if not exists public.development_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_name text not null check (char_length(trim(campaign_name)) between 1 and 200),
  product_code text not null check (char_length(trim(product_code)) between 1 and 100),
  product_name text not null check (char_length(trim(product_name)) between 1 and 300),
  product_claim_text text not null,
  product_claim_source text not null,
  target_country text not null check (char_length(trim(target_country)) between 1 and 100),
  target_company_types text[] not null default array[]::text[],
  applications text[] not null default array[]::text[],
  exclusion_terms text[] not null default array[]::text[],
  daily_candidate_limit integer not null default 20 check (daily_candidate_limit between 1 and 100),
  status text not null default '启用' check (status in ('草稿', '启用', '暂停', '已关闭')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, campaign_name)
);

create table if not exists public.discovery_queries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.development_campaigns(id) on delete cascade,
  query_text text not null check (char_length(trim(query_text)) between 1 and 500),
  country text not null,
  query_kind text not null default 'web' check (query_kind in ('web', 'maps', 'linkedin', 'pdf_directory')),
  search_url text not null,
  executed_at timestamptz,
  result_url text,
  note text,
  created_at timestamptz not null default now(),
  unique(owner_user_id, campaign_id, query_text, query_kind)
);

create table if not exists public.source_documents (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.development_campaigns(id) on delete cascade,
  source_name text not null,
  source_url text,
  source_type text not null check (source_type in ('CSV', 'PDF', '手工网页结果')),
  content_sha256 text,
  page_count integer,
  imported_at timestamptz not null default now()
);

alter table public.customer_leads
  add column if not exists development_campaign_id uuid references public.development_campaigns(id) on delete set null,
  add column if not exists development_status text not null default '发现'
    check (development_status in ('发现', '待核实', '合格', '不匹配', '已联系', '已回复', '拒绝联系'));

create table if not exists public.lead_evidences (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_lead_id uuid not null references public.customer_leads(id) on delete cascade,
  source_document_id uuid references public.source_documents(id) on delete set null,
  evidence_type text not null check (evidence_type in ('官网', 'PDF', '搜索结果', '人工核查')),
  source_url text,
  page_number integer check (page_number is null or page_number > 0),
  excerpt text not null,
  evidence_role text not null check (evidence_role in ('应用或产品', '客户身份', '国家或地址', '公开联系入口', '近期活动', '发现来源')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_lead_id uuid not null references public.customer_leads(id) on delete cascade,
  contact_name text,
  job_title text,
  department text,
  email text,
  email_status text not null default '未验证' check (email_status in ('官网公开', '已验证', '未验证', '不可发送')),
  source_url text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.development_campaigns(id) on delete cascade,
  customer_lead_id uuid not null references public.customer_leads(id) on delete cascade,
  lead_contact_id uuid references public.lead_contacts(id) on delete set null,
  subject text not null,
  channel text not null check (channel in ('邮件', 'LinkedIn', 'WhatsApp', 'Facebook')),
  recipient text,
  company_fact text not null,
  fact_source_url text,
  product_code text not null,
  product_claim_source text not null,
  draft_body text not null,
  approval_state text not null default '待审核' check (approval_state in ('待审核', '已审核', '已拒绝')),
  approval_note text,
  approved_at timestamptz,
  sent_at timestamptz,
  reply_state text not null default '未发送' check (reply_state in ('未发送', '待回复', '已回复', '拒绝联系', '退信')),
  next_follow_up_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists development_campaigns_owner_idx on public.development_campaigns(owner_user_id, status, created_at desc);
create index if not exists discovery_queries_campaign_idx on public.discovery_queries(campaign_id, created_at desc);
create index if not exists source_documents_campaign_idx on public.source_documents(campaign_id, imported_at desc);
create index if not exists customer_leads_development_campaign_idx on public.customer_leads(user_id, development_campaign_id, development_status, discovered_at desc);
create index if not exists lead_evidences_lead_idx on public.lead_evidences(customer_lead_id, created_at desc);
create index if not exists lead_contacts_lead_idx on public.lead_contacts(customer_lead_id, created_at desc);
create index if not exists outreach_drafts_campaign_idx on public.outreach_drafts(campaign_id, approval_state, created_at desc);

alter table public.development_campaigns enable row level security;
alter table public.discovery_queries enable row level security;
alter table public.source_documents enable row level security;
alter table public.lead_evidences enable row level security;
alter table public.lead_contacts enable row level security;
alter table public.outreach_drafts enable row level security;

drop policy if exists "own development campaigns" on public.development_campaigns;
drop policy if exists "own discovery queries" on public.discovery_queries;
drop policy if exists "own source documents" on public.source_documents;
drop policy if exists "own lead evidences" on public.lead_evidences;
drop policy if exists "own lead contacts" on public.lead_contacts;
drop policy if exists "own outreach drafts" on public.outreach_drafts;
create policy "own development campaigns" on public.development_campaigns for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own discovery queries" on public.discovery_queries for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own source documents" on public.source_documents for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own lead evidences" on public.lead_evidences for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own lead contacts" on public.lead_contacts for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "own outreach drafts" on public.outreach_drafts for all
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

commit;
