-- Zhiwu OS V1.2: Mail Center. Run once after schema.sql and v1_1_migration.sql.

create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id text not null,
  sender text not null,
  receiver text,
  sender_name text,
  subject text not null default '(无主题)',
  content_preview text,
  content_text text,
  received_at timestamptz not null default now(),
  attachment_count integer not null default 0 check (attachment_count >= 0),
  customer_id uuid references public.customers(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  status text not null default 'Unprocessed' check (status in ('Unprocessed', 'Processed', 'Follow-up created')),
  created_at timestamptz not null default now(),
  unique(user_id, message_id)
);

create table if not exists public.email_sync (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  last_sync_time timestamptz,
  total_synced integer not null default 0 check (total_synced >= 0),
  status text not null default 'Idle' check (status in ('Idle', 'Running', 'Success', 'Error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.customer_email_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  email_address text not null,
  created_at timestamptz not null default now(),
  unique(user_id, email_address)
);

create index if not exists emails_user_received_idx on public.emails(user_id, received_at desc);
create index if not exists emails_customer_received_idx on public.emails(customer_id, received_at desc);
create index if not exists customer_email_mappings_lookup_idx on public.customer_email_mappings(user_id, lower(email_address));

alter table public.emails enable row level security;
alter table public.email_sync enable row level security;
alter table public.customer_email_mappings enable row level security;

do $$ begin
  create policy "own emails" on public.emails for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own email sync" on public.email_sync for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own customer email mappings" on public.customer_email_mappings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
