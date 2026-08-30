-- Zhiwu OS V1.19: provenance-preserving manual strict-lead imports.
-- Apply after V1.18. Imported strict records retain the Excel evidence verbatim.
begin;

alter table public.customer_leads
  add column if not exists source_record_id text,
  add column if not exists match_level text,
  add column if not exists official_website text,
  add column if not exists public_contact_or_department text,
  add column if not exists product_application_evidence text,
  add column if not exists application_scope text,
  add column if not exists potential_fit text,
  add column if not exists source_urls jsonb not null default '[]'::jsonb,
  add column if not exists verification_status text,
  add column if not exists data_source text,
  add column if not exists imported_at timestamptz,
  add column if not exists needs_human_confirmation boolean not null default true,
  add column if not exists confirmation_note text,
  add column if not exists first_discovery_source_url text,
  add column if not exists official_validation_source_url text;

create unique index if not exists customer_leads_manual_source_record_idx
  on public.customer_leads(user_id, task_id, data_source, source_record_id)
  where source_record_id is not null and data_source is not null;

create index if not exists customer_leads_verification_status_idx
  on public.customer_leads(user_id, verification_status, imported_at desc);

-- The previous automated records stay available for re-checking, but are never
-- allowed to remain CRM-eligible.  The imported manual records are excluded.
update public.customer_leads
set verification_bucket = '待补信息',
    matching_grade = null,
    missing_requirements = array['自动抓取记录，未通过人工严格核验导入标准；需重新核验企业主体、联系方式与官方产品证据。'],
    verification_conclusion = '自动抓取记录，未通过人工严格核验导入标准；需重新核验企业主体、联系方式与官方产品证据。',
    updated_at = now()
where verification_bucket = '严格客户名单'
  and coalesce(verification_status, '') <> 'strict_verified_import';

-- Known non-entity examples are explicitly excluded rather than left as
-- customer candidates.  All other historic automatic records remain pending.
update public.customer_leads
set verification_bucket = '排除名单',
    status = '已排除',
    exclusion_reason = case
      when lower(company_name) like '%why cpp resin exhibits exceptional adhesion in inks%'
        then '文章标题，不是企业实体。'
      when lower(company_name) like '%plastics decorating%' or lower(coalesce(source_url, '')) like '%plasticsdecorating%'
        then '行业媒体，不是目标客户企业。'
      when lower(company_name) ~ '(association|association$|eupia|cepe|directory|exhibition|trade show)'
        then '协会、展会或行业目录，仅可用于发现企业名称。'
      when lower(coalesce(source_type, '')) = '新闻'
        then '新闻/文章来源不是企业实体。'
      else exclusion_reason
    end,
    verification_conclusion = case
      when lower(company_name) like '%why cpp resin exhibits exceptional adhesion in inks%'
        then '文章标题，不是企业实体。'
      when lower(company_name) like '%plastics decorating%' or lower(coalesce(source_url, '')) like '%plasticsdecorating%'
        then '行业媒体，不是目标客户企业。'
      when lower(company_name) ~ '(association|association$|eupia|cepe|directory|exhibition|trade show)'
        then '协会、展会或行业目录，仅可用于发现企业名称。'
      when lower(coalesce(source_type, '')) = '新闻'
        then '新闻/文章来源不是企业实体。'
      else coalesce(exclusion_reason, '已确认不是可开发企业实体。')
    end,
    updated_at = now()
where coalesce(verification_status, '') <> 'strict_verified_import'
  and (
    lower(company_name) like '%why cpp resin exhibits exceptional adhesion in inks%'
    or lower(company_name) like '%plastics decorating%'
    or lower(coalesce(source_url, '')) like '%plasticsdecorating%'
    or lower(company_name) ~ '(association|association$|eupia|cepe|directory|exhibition|trade show)'
    or lower(coalesce(source_type, '')) = '新闻'
  );

commit;
