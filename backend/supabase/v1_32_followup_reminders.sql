begin;
alter table public.customers add column if not exists followup_revision integer not null default 0;
alter table public.customers add column if not exists followup_closed boolean not null default false;
alter table public.customers add column if not exists followup_reason text;
alter table public.customers add column if not exists followup_source text;
alter table public.customers add column if not exists followup_date_placeholder boolean not null default false;
alter table public.followups add column if not exists channel text;
create table if not exists public.followup_mail_baselines(user_id uuid primary key default auth.uid() references auth.users(id), since timestamptz not null);
alter table public.followup_mail_baselines enable row level security;
drop policy if exists own_baseline on public.followup_mail_baselines;
create policy own_baseline on public.followup_mail_baselines for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert on public.followup_mail_baselines to authenticated;
create table if not exists public.mail_reply_evidence(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),mailbox_id uuid,reply_to_message_id text not null,sent_message_id text not null,sent_at timestamptz not null,unique(user_id,sent_message_id,reply_to_message_id));
alter table public.mail_reply_evidence enable row level security;
drop policy if exists own_reply_evidence on public.mail_reply_evidence;
create policy own_reply_evidence on public.mail_reply_evidence for select to authenticated using(user_id=auth.uid());
grant select on public.mail_reply_evidence to authenticated;
grant select,insert on public.mail_reply_evidence to service_role;

create or replace function public.save_followup_reminder(p_customer uuid,p_expected jsonb,p_action text,p_date date,p_closed boolean,p_reason text,p_source text,p_content text,p_next_action text,p_communication_date date)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.customers; f public.followups; n jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_action is null or p_source is null or p_closed is null or p_action not in ('reschedule','complete') or p_source not in ('邮箱','微信','WhatsApp','GPT','人工确认','未注明') then raise exception 'Invalid action or source'; end if;
 select * into strict c from public.customers where id=p_customer and archived_at is null for update;
 n=jsonb_build_object('date',c.next_followup_date,'closed',c.followup_closed,'reason',c.followup_reason,'source',c.followup_source,'placeholder',c.followup_date_placeholder,'revision',c.followup_revision,'next_action',c.next_action);
 if n is distinct from p_expected then raise exception '记录已有更新，请刷新后重试' using errcode='40001'; end if;
 if p_action='complete' and (nullif(trim(p_content),'') is null or p_communication_date is null or (not p_closed and p_date is null)) then raise exception '完成跟进需填写沟通记录，并安排下次日期或关闭'; end if;
 if p_closed and p_action<>'complete' then raise exception '请通过完成表单关闭'; end if;
 if p_action='complete' and not p_closed and nullif(trim(p_next_action),'') is null then raise exception '请填写下一步行动'; end if;
 if p_action='complete' then
  insert into public.followups(customer_id,user_id,date,content,next_action,status,channel) values(c.id,auth.uid(),p_communication_date,p_content,case when p_closed then '本次跟进已关闭' else p_next_action end,'Done',p_source) returning * into f;
 end if;
 update public.customers set followup_revision=followup_revision+1,next_followup_date=case when p_closed then null else p_date end,followup_closed=p_closed,followup_reason=nullif(trim(p_reason),''),followup_source=p_source,followup_date_placeholder=false,
 next_action=case when p_action='complete' then case when p_closed then array[]::text[] else array[p_next_action] end else next_action end,
 last_contact_date=case when p_action='complete' then greatest(last_contact_date,p_communication_date) else last_contact_date end
 where id=c.id returning * into c;
 if c.id is null then raise exception '无更新权限'; end if;
 return jsonb_build_object('customer',to_jsonb(c),'followup',case when f.id is null then null else to_jsonb(f) end);
end;$$;
revoke all on function public.save_followup_reminder(uuid,jsonb,text,date,boolean,text,text,text,text,date) from public,anon;
grant execute on function public.save_followup_reminder(uuid,jsonb,text,date,boolean,text,text,text,text,date) to authenticated;

create or replace function public.followup_reminder_snapshot() returns jsonb language plpgsql security invoker set search_path=public as $$
declare cutoff timestamptz; result jsonb;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.followup_mail_baselines(user_id,since) values(auth.uid(),coalesce((select max(last_sync_time) from public.email_sync),now())) on conflict(user_id) do nothing;
 select since into cutoff from public.followup_mail_baselines where user_id=auth.uid();
 select jsonb_build_object('customers',(select coalesce(jsonb_agg(c),'[]') from public.customers c where archived_at is null and not import_reverted),
 'followups',(select coalesce(jsonb_agg(f order by f.date desc,f.created_at desc),'[]') from public.followups f where archived_at is null and not import_reverted),
 'emails',(select coalesce(jsonb_agg(e order by e.received_at desc),'[]') from public.emails e where e.received_at>cutoff and e.customer_id is not null and e.status in ('unread','new_lead','linked') and not exists(select 1 from public.mail_reply_evidence r where r.reply_to_message_id=e.message_id and r.mailbox_id=e.mailbox_id and r.sent_at>=e.received_at) and not exists(select 1 from public.followups f where f.email_id=e.id and f.archived_at is null and not f.import_reverted and f.content not like '邮件自动归档：%')),
 'mail_baseline',cutoff,'mail_sync',(select coalesce(jsonb_agg(s),'[]') from public.email_sync s),'mailboxes',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'email',m.email_address,'key',m.mailbox_key)),'[]') from public.mailbox_accounts m)) into result;
 return result;
end;$$;
revoke all on function public.followup_reminder_snapshot() from public,anon;
grant execute on function public.followup_reminder_snapshot() to authenticated;
commit;
notify pgrst,'reload schema';
