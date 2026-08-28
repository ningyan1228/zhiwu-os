-- Zhiwu OS V1.16: strict customer verification evidence and result buckets.
begin;

alter table public.customer_leads
  add column if not exists verification_bucket text not null default '待补信息'
    check (verification_bucket in ('严格客户名单', '待补信息', '排除名单')),
  add column if not exists company_type text,
  add column if not exists official_homepage_url text,
  add column if not exists company_source_url text,
  add column if not exists contact_department text,
  add column if not exists contact_source_url text,
  add column if not exists email_source_url text,
  add column if not exists phone_source_url text,
  add column if not exists email_domain_note text,
  add column if not exists official_address text,
  add column if not exists business_scope text,
  add column if not exists product_evidence_summary text,
  add column if not exists product_evidence_url text,
  add column if not exists product_evidence_type text,
  add column if not exists matching_grade text check (matching_grade in ('A', 'B')),
  add column if not exists recommended_contact_department text,
  add column if not exists first_contact_questions text,
  add column if not exists verification_conclusion text,
  add column if not exists missing_requirements text[] not null default array[]::text[],
  add column if not exists verified_at timestamptz;

create index if not exists customer_leads_verification_bucket_idx
  on public.customer_leads(user_id, verification_bucket, discovered_at desc);

-- Existing directory-derived records are not discarded, but none may remain in
-- a strict list until the new official-site verification process completes.
update public.customer_leads
set verification_bucket = '待补信息',
    matching_grade = null,
    missing_requirements = array['未完成官网、联系人/部门、邮箱、电话与产品证据的严格核验'],
    verification_conclusion = '历史发现线索，需按严格客户核验规则重新处理。',
    updated_at = now()
where verification_bucket <> '排除名单';

update public.customer_leads
set verification_bucket = '排除名单',
    verification_conclusion = coalesce(exclusion_reason, '已由人工排除。'),
    updated_at = now()
where status = '已排除';

commit;
