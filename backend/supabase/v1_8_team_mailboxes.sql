-- Zhiwu OS V1.8: team workspace + private mailboxes.
-- Run once in Supabase SQL Editor after v1_7_ai_import_inbox.sql.
-- This makes CRM data shared by approved workspace members while email inboxes stay private.

create table if not exists public.workspace_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

-- Seed only the two approved Zhiwu OS accounts. Future members must be added deliberately.
insert into public.workspace_members (user_id, display_name, role)
select id,
  case lower(email)
    when 'gjsxning@163.com' then 'Zhiwu'
    when 'peter@neonliontech.com' then 'Peter'
    else email
  end,
  case when lower(email) = 'gjsxning@163.com' then 'admin' else 'member' end
from auth.users
where lower(email) in ('gjsxning@163.com', 'peter@neonliontech.com')
on conflict (user_id) do update set display_name = excluded.display_name, role = excluded.role;

create or replace function public.is_workspace_member()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.workspace_members where user_id = auth.uid()) $$;

create table if not exists public.mailbox_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  mailbox_key text not null unique check (mailbox_key ~ '^[a-z][a-z0-9_]{1,30}$'),
  label text not null,
  email_address text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.mailbox_accounts (user_id, mailbox_key, label, email_address)
select id,
  case lower(email)
    when 'gjsxning@163.com' then 'zhiwu'
    when 'peter@neonliontech.com' then 'peter'
  end,
  case lower(email)
    when 'gjsxning@163.com' then 'Zhiwu 的邮件中心'
    when 'peter@neonliontech.com' then 'Peter 的邮件中心'
  end,
  lower(email)
from auth.users
where lower(email) in ('gjsxning@163.com', 'peter@neonliontech.com')
on conflict (user_id) do update set label = excluded.label, email_address = excluded.email_address, updated_at = now();

alter table public.emails add column if not exists mailbox_id uuid references public.mailbox_accounts(id) on delete set null;
alter table public.email_sync add column if not exists mailbox_id uuid references public.mailbox_accounts(id) on delete set null;
alter table public.email_sync drop constraint if exists email_sync_status_check;
alter table public.email_sync add constraint email_sync_status_check
  check (status in ('Idle', 'Running', 'Success', 'Error', 'Not configured'));
create index if not exists emails_mailbox_received_idx on public.emails(mailbox_id, received_at desc);

-- Preserve all existing Zhiwu mail by attaching it to Zhiwu's mailbox account.
update public.emails e set mailbox_id = m.id
from public.mailbox_accounts m
where e.mailbox_id is null and e.user_id = m.user_id;
update public.email_sync s set mailbox_id = m.id
from public.mailbox_accounts m
where s.mailbox_id is null and s.user_id = m.user_id;

alter table public.workspace_members enable row level security;
alter table public.mailbox_accounts enable row level security;
drop policy if exists "members can read workspace members" on public.workspace_members;
create policy "members can read workspace members" on public.workspace_members for select using (public.is_workspace_member());
drop policy if exists "own mailbox account" on public.mailbox_accounts;
create policy "own mailbox account" on public.mailbox_accounts for select using (auth.uid() = user_id);

-- Shared business CRM: only approved workspace members can read or change it.
drop policy if exists "own customers" on public.customers;
create policy "workspace customers" on public.customers for all using (public.is_workspace_member()) with check (public.is_workspace_member());
drop policy if exists "own products" on public.products;
create policy "workspace products" on public.products for all using (public.is_workspace_member()) with check (public.is_workspace_member());
drop policy if exists "own followups" on public.followups;
create policy "workspace followups" on public.followups for all using (public.is_workspace_member()) with check (public.is_workspace_member());
drop policy if exists "own projects" on public.projects;
create policy "workspace projects" on public.projects for all using (public.is_workspace_member()) with check (public.is_workspace_member());
drop policy if exists "own quotes" on public.quotes;
create policy "workspace quotes" on public.quotes for all using (public.is_workspace_member()) with check (public.is_workspace_member());
drop policy if exists "own product customer relations" on public.product_customer_relations;
create policy "workspace product customer relations" on public.product_customer_relations for all using (public.is_workspace_member()) with check (public.is_workspace_member());

-- CRM timeline items are shared only when they are linked to a customer; personal task notes remain private.
drop policy if exists "workspace customer timeline read" on public.timeline_events;
create policy "workspace customer timeline read" on public.timeline_events for select
  using (auth.uid() = user_id or (customer_id is not null and public.is_workspace_member()));
drop policy if exists "workspace customer timeline write" on public.timeline_events;
create policy "workspace customer timeline write" on public.timeline_events for insert
  with check (auth.uid() = user_id and public.is_workspace_member());
drop policy if exists "workspace customer timeline update" on public.timeline_events;
create policy "workspace customer timeline update" on public.timeline_events for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "workspace customer timeline delete" on public.timeline_events;
create policy "workspace customer timeline delete" on public.timeline_events for delete using (auth.uid() = user_id);

-- Prevent a member from creating a second product record with the same code.
create unique index if not exists products_workspace_code_unique on public.products (lower(product_code));
