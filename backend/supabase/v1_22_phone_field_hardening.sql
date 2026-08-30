-- Zhiwu OS V1.22: remove false phone values that are actually webpage dates.
-- Records are retained for human review; only the unreliable contact field and
-- its source are cleared.  This migration is idempotent.
begin;

update public.customer_leads
set public_business_phone = null,
    phone_source_url = null,
    missing_requirements = array(
      select distinct requirement
      from unnest(
        coalesce(missing_requirements, '{}'::text[]) ||
        array['公开电话字段为日期格式，已清空；需重新核验官方电话。']
      ) as requirement
    ),
    updated_at = now()
where coalesce(verification_status, '') <> 'strict_verified_import'
  and translate(coalesce(public_business_phone, ''), '‐‑‒–—−﹣', '-------')
      ~ '^(19|20)[0-9]{2}[-/.][0-9]{1,2}[-/.][0-9]{1,2}$';

commit;
