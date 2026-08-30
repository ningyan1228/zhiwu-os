-- Zhiwu OS V1.20: application-first lead discovery cleanup.
-- Apply after V1.19. Automatic records are prospecting candidates only;
-- only human-verified Excel imports may remain CRM-eligible strict records.
begin;

update public.customer_leads
set verification_bucket = '待补信息',
    matching_grade = null,
    status = case when status = '已排除' then status else '待审核' end,
    missing_requirements = array['自动抓取记录，未通过人工严格核验导入标准；需重新核验企业主体、联系方式与官方产品证据。'],
    verification_conclusion = '自动应用型候选；公开网页仅证明其下游业务，尚未证明采购或使用 CPPH-2A/CPP/CPO。',
    verification_status = 'auto_application_candidate',
    updated_at = now()
where coalesce(data_source, '') = 'public_web_discovery'
  and coalesce(verification_status, '') <> 'strict_verified_import'
  and coalesce(verification_bucket, '') <> '排除名单';

-- A company whose public business is CPP/CPO/resin/adhesion-promoter supply is
-- an upstream peer for this task, even if it exposes a valid company website.
update public.customer_leads
set verification_bucket = '排除名单',
    status = '已排除',
    exclusion_reason = '官网显示为 CPP/CPO/树脂/附着力促进剂等上游原料供应商或同行，不是下游客户。',
    verification_conclusion = '官网显示为 CPP/CPO/树脂/附着力促进剂等上游原料供应商或同行，不是下游客户。',
    verification_status = 'auto_excluded_competitor',
    updated_at = now()
where coalesce(data_source, '') = 'public_web_discovery'
  and coalesce(verification_status, '') <> 'strict_verified_import'
  and (
    lower(coalesce(company_type, '')) like '%原料供应%'
    or lower(coalesce(product_evidence_summary, '')) ~ '(cpp resin|cpo resin|chlorinated polypropylene|chlorinated polyolefin)'
    or lower(coalesce(possible_need, '')) ~ '(cpp resin|cpo resin|chlorinated polypropylene|chlorinated polyolefin)'
  );

commit;
