-- Schema only. No customer or technical business content.
begin;
alter table public.customer_inquiries drop constraint if exists customer_inquiries_status_check;
alter table public.customer_inquiries add constraint customer_inquiries_status_check check(status in ('pending','sent','replied','closed'));
create or replace function public.set_inquiry_status(p_id uuid,p_status text,p_expected_version integer)
returns public.customer_inquiries language plpgsql security definer set search_path='' as $$
declare r public.customer_inquiries;
begin
  if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
  if p_status is null or p_status not in ('pending','sent','replied','closed') then raise exception '状态无效' using errcode='22023'; end if;
  select * into r from public.customer_inquiries where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception '无权访问' using errcode='42501'; end if;
  if p_expected_version is distinct from r.version then raise exception '记录已更新，请刷新' using errcode='40001'; end if;
  if r.status=p_status then return r; end if;
  insert into public.inquiry_status_events(inquiry_id,owner_id,previous_status,status,actor_id) values(r.id,r.owner_id,r.status,p_status,auth.uid());
  update public.customer_inquiries set status=p_status,version=version+1,status_updated_at=now(),status_updated_by=auth.uid() where id=p_id returning * into r;
  return r;
end; $$;
create or replace function public.create_manual_inquiry(p_request_id uuid,p_data jsonb)
returns public.customer_inquiries language plpgsql security definer set search_path='' as $$
declare batch uuid; r public.customer_inquiries; fingerprint text;
begin
  if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
  if p_request_id is null or p_data is null or nullif(trim(p_data->>'customer_name'),'') is null or nullif(trim(p_data->>'product'),'') is null or nullif(trim(p_data->>'inquiry_original'),'') is null then raise exception '客户、产品、询盘原文必填' using errcode='22023'; end if;
  if octet_length(p_data::text)>200000 then raise exception '内容过长' using errcode='22023'; end if;
  fingerprint=repeat(replace(p_request_id::text,'-',''),2);
  insert into public.inquiry_imports(owner_id,source_name,source_sha256,source_text) values(auth.uid(),'页面手动录入',fingerprint,p_data::text) on conflict(owner_id,source_sha256) do nothing;
  select id into batch from public.inquiry_imports where owner_id=auth.uid() and source_sha256=fingerprint for update;
  select * into r from public.customer_inquiries where import_id=batch and owner_id=auth.uid();
  if found then return r; end if;
  insert into public.customer_inquiries(owner_id,import_id,position,customer_name,company,country,product,inquiry_time,subject,source_metadata,language,inquiry_original,inquiry_zh,reply_original,reply_zh,source_section)
  values(auth.uid(),batch,1,trim(p_data->>'customer_name'),p_data->>'company',p_data->>'country',trim(p_data->>'product'),p_data->>'inquiry_time',p_data->>'subject',coalesce(p_data->>'source_metadata','手动录入'),coalesce(p_data->>'language','en'),p_data->>'inquiry_original',coalesce(p_data->>'inquiry_zh',''),coalesce(p_data->>'reply_original',''),coalesce(p_data->>'reply_zh',''),'页面录入') returning * into r;
  return r;
end; $$;
create table if not exists public.product_parameter_verifications(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
 product text not null check(length(trim(product))>0),grade text not null check(length(trim(grade))>0),
 parameter text not null check(length(trim(parameter))>0),verified_value text not null check(length(trim(verified_value))>0),
 evidence text not null check(length(trim(evidence))>0),verified_by text not null check(length(trim(verified_by))>0),
 verified_date date not null,created_at timestamptz not null default now()
);
alter table public.product_parameter_verifications enable row level security;
revoke all on public.product_parameter_verifications from public,anon,authenticated;
grant select,insert on public.product_parameter_verifications to authenticated;
drop policy if exists parameter_owner_read on public.product_parameter_verifications;
create policy parameter_owner_read on public.product_parameter_verifications for select to authenticated using(owner_id=(select auth.uid()));
drop policy if exists parameter_owner_create on public.product_parameter_verifications;
create policy parameter_owner_create on public.product_parameter_verifications for insert to authenticated with check(owner_id=(select auth.uid()));
revoke all on function public.create_manual_inquiry(uuid,jsonb) from public,anon;
grant execute on function public.create_manual_inquiry(uuid,jsonb) to authenticated;
revoke all on function public.set_inquiry_status(uuid,text,integer) from public,anon;
grant execute on function public.set_inquiry_status(uuid,text,integer) to authenticated;
commit;
notify pgrst,'reload schema';
