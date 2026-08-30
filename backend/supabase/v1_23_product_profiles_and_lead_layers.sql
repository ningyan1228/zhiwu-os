-- Zhiwu OS V1.23: reusable product profiles and explicit lead layers.
-- A profile is evidence-backed configuration for one product; it is not an
-- assertion that any discovered company has bought that product.
begin;

alter table public.products
  add column if not exists technical_keywords text[] not null default array[]::text[],
  add column if not exists confirmed_applications text[] not null default array[]::text[],
  add column if not exists target_industries text[] not null default array[]::text[],
  add column if not exists target_company_types text[] not null default array[]::text[],
  add column if not exists exclusion_rules text[] not null default array[]::text[],
  add column if not exists evidence_urls text[] not null default array[]::text[],
  add column if not exists profile_status text not null default '草稿'
    check (profile_status in ('草稿', '已确认')),
  add column if not exists profile_updated_at timestamptz;

alter table public.lead_search_tasks
  add column if not exists product_id uuid references public.products(id) on delete set null,
  add column if not exists profile_exclusion_rules text[] not null default array[]::text[];

create index if not exists lead_search_tasks_product_idx
  on public.lead_search_tasks(user_id, product_id, created_at desc);

alter table public.customer_leads
  add column if not exists lead_layer text not null default '待判定'
    check (lead_layer in ('直接需求候选', '间接应用链', '供应工厂候选', '排除', '待判定'));

-- Historical data does not contain enough source-specific evidence to claim a
-- direct buyer. Existing automatic demand records are conservatively marked as
-- indirect application-chain research; strict manual imports remain direct.
update public.customer_leads
set lead_layer = case
  when verification_bucket = '排除名单' or status = '已排除' then '排除'
  when discovery_mode = '供应工厂' then '供应工厂候选'
  when verification_status = 'strict_verified_import' then '直接需求候选'
  when coalesce(data_source, '') = 'public_web_discovery' then '间接应用链'
  else '待判定'
end;

create index if not exists customer_leads_layer_idx
  on public.customer_leads(user_id, lead_layer, discovered_at desc);

commit;
