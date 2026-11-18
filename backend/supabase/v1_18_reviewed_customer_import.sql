-- Apply to WORKSTATION project lcytqicctxigcrhzcwag, NOT knowledge-workbench.
-- No business data. Security invoker retains existing row-level permissions.
begin;
create or replace function public.apply_reviewed_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.import_batches; c public.customers; plan jsonb; patch jsonb; before_values jsonb; assignments text; k text;
begin
 if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
 select * into b from public.import_batches where id=p_batch_id and user_id=auth.uid() for update;
 if not found then raise exception '无权访问此导入' using errcode='42501'; end if;
 if b.status<>'draft' then raise exception '此批次已处理，请刷新；不允许重复提交' using errcode='40001'; end if;
 plan=b.preview->'safe_review';
 if plan is null or plan->>'version'<>'reviewed-customer/v1' or (plan->>'ready') is distinct from 'true' then raise exception '没有可执行的核验预览' using errcode='22023'; end if;
 select * into c from public.customers where id=(plan->>'customer_id')::uuid and import_reverted=false and archived_at is null for update;
 if not found then raise exception '客户不可访问或已归档' using errcode='42501'; end if;
 if to_jsonb(c) is distinct from plan->'expected' then raise exception '客户在预览后发生变化，请重新预览' using errcode='40001'; end if;
 patch=plan->'patch';
 if jsonb_typeof(patch)<>'object' or patch='{}'::jsonb then raise exception '更新字段为空' using errcode='22023'; end if;
 for k in select jsonb_object_keys(patch) loop
  if not k=any(array['company_name','country','contact_person','email','whatsapp','industry','customer_summary','customer_background','customer_need','status_label']) then raise exception '不允许更新字段 %',k using errcode='22023'; end if;
  if jsonb_typeof(patch->k)<>'string' or trim(patch->>k)='' then raise exception '不能用空值覆盖资料' using errcode='22023'; end if;
 end loop;
 select jsonb_object_agg(key,to_jsonb(c)->key),string_agg(format('%I = v.%I',key,key),',') into before_values,assignments from jsonb_each(patch);
 execute format('update public.customers t set %s from jsonb_populate_record(null::public.customers,$1) v where t.id=$2 returning t.*',assignments) into c using patch,c.id;
 if c.id is null then raise exception '无权更新客户' using errcode='42501'; end if;
 insert into public.import_effects(import_batch_id,entity_type,action,record_id,before_data,after_data)
 values(b.id,'customer','updated',c.id,before_values,to_jsonb(c));
 update public.import_batches set status='applied',applied_at=now() where id=b.id;
 return jsonb_build_object('batch_id',b.id,'customer',to_jsonb(c),'customer_action','updated','products','[]'::jsonb);
end; $$;
create or replace function public.revert_reviewed_customer_import(p_batch_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.import_batches; e public.import_effects; c public.customers; assignments text; k text;
begin
 if auth.uid() is null then raise exception '需要登录' using errcode='42501'; end if;
 select * into b from public.import_batches where id=p_batch_id and user_id=auth.uid() for update;
 if not found then raise exception '无权访问' using errcode='42501'; end if;
 if b.status<>'applied' then raise exception '仅可撤销已提交批次' using errcode='40001'; end if;
 if (b.preview->'safe_review'->>'version') is distinct from 'reviewed-customer/v1' then raise exception '旧导入不能自动撤销，请人工核对' using errcode='22023'; end if;
 if (select count(*) from public.import_effects where import_batch_id=b.id and reverted_at is null)<>1 then raise exception '影响记录异常，停止撤销' using errcode='22023'; end if;
 select * into e from public.import_effects where import_batch_id=b.id and reverted_at is null for update;
 if e.entity_type<>'customer' or e.action<>'updated' then raise exception '仅支持已核验客户订正撤销' using errcode='22023'; end if;
 select * into c from public.customers where id=e.record_id for update;
 if not found then raise exception '无权访问客户' using errcode='42501'; end if;
 if to_jsonb(c) is distinct from e.after_data then raise exception '导入后客户已被修改，不能覆盖后续工作，请人工核对' using errcode='40001'; end if;
 for k in select jsonb_object_keys(e.before_data) loop
  if not k=any(array['company_name','country','contact_person','email','whatsapp','industry','customer_summary','customer_background','customer_need','status_label']) then raise exception '撤销字段非法' using errcode='22023'; end if;
 end loop;
 select string_agg(format('%I = v.%I',key,key),',') into assignments from jsonb_each(e.before_data);
 if assignments is null then raise exception '缺少原始值' using errcode='22023'; end if;
 execute format('update public.customers t set %s from jsonb_populate_record(null::public.customers,$1) v where t.id=$2 returning t.*',assignments) into c using e.before_data,c.id;
 if c.id is null then raise exception '无权撤销' using errcode='42501'; end if;
 update public.import_effects set reverted_at=now() where id=e.id;
 update public.import_batches set status='reverted',reverted_at=now() where id=b.id;
 return jsonb_build_object('batch_id',b.id,'reverted_effects',1,'message','已撤销字段订正，保留完整记录。');
end; $$;
revoke all on function public.apply_reviewed_customer_import(uuid),public.revert_reviewed_customer_import(uuid) from public,anon;
grant execute on function public.apply_reviewed_customer_import(uuid),public.revert_reviewed_customer_import(uuid) to authenticated;
commit;
notify pgrst,'reload schema';
