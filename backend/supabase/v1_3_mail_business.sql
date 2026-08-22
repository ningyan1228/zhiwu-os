-- Zhiwu OS V1.3: Mail Center business workflow. Run after v1_2_mail_center.sql.

alter table public.emails add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.emails add column if not exists category text;

alter table public.emails drop constraint if exists emails_status_check;
alter table public.emails alter column status set default 'unread';
update public.emails
set status = case
  when status = 'Follow-up created' then 'followup_created'
  when status = 'Processed' then 'completed'
  when customer_id is not null then 'linked'
  else 'new_lead'
end
where status in ('Unprocessed', 'Processed', 'Follow-up created');
alter table public.emails add constraint emails_status_check
  check (status in ('unread', 'new_lead', 'linked', 'followup_created', 'completed'));

update public.emails
set category = case
  when lower(subject || ' ' || coalesce(content_preview, '')) ~ '(pi|payment|remittance|invoice)' then 'payment'
  when lower(subject || ' ' || coalesce(content_preview, '')) ~ '(sample|specimen)' then 'sample'
  when lower(subject || ' ' || coalesce(content_preview, '')) ~ '(quote|quotation|price|offer)' then 'quotation'
  when lower(subject || ' ' || coalesce(content_preview, '')) ~ '(test|technical|tds|coa|performance)' then 'technical'
  else 'customer_inquiry'
end
where category is null;
alter table public.emails alter column category set default 'customer_inquiry';
alter table public.emails alter column category set not null;
alter table public.emails add constraint emails_category_check
  check (category in ('customer_inquiry', 'technical', 'quotation', 'sample', 'payment', 'other'));

alter table public.customer_email_mappings add column if not exists contact_name text;
alter table public.followups add column if not exists email_id uuid references public.emails(id) on delete set null;

create table if not exists public.email_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email_id uuid not null references public.emails(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  action text not null,
  next_action text,
  deadline date,
  status text not null default 'Pending' check (status in ('Pending', 'Completed')),
  created_at timestamptz not null default now()
);

create index if not exists emails_business_filter_idx on public.emails(user_id, category, status, received_at desc);
create index if not exists followups_email_idx on public.followups(email_id);
create index if not exists email_actions_email_idx on public.email_actions(email_id);
create index if not exists email_actions_pending_idx on public.email_actions(user_id, status, deadline);

alter table public.email_actions enable row level security;
do $$ begin
  create policy "own email actions" on public.email_actions for all
    using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
