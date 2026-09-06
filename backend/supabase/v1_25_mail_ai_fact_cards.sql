-- Zhiwu OS V1.25: review-only AI mail fact cards.
-- Run once in Supabase SQL Editor after the mail-center migrations.
-- AI output is deliberately isolated from CRM: a user must still confirm a
-- separate CRM update using the original email as evidence.
begin;

create table if not exists public.mail_ai_fact_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email_id uuid not null references public.emails(id) on delete cascade,
  provider text not null default 'siliconflow',
  model text not null,
  prompt_version text not null default 'mail-facts-v1',
  source_hash text not null,
  chinese_summary text not null,
  facts jsonb not null default '{}'::jsonb,
  confidence numeric(4,3),
  status text not null default '待审核' check (status in ('待审核', '已确认', '已忽略')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email_id)
);

create index if not exists mail_ai_fact_cards_email_idx
  on public.mail_ai_fact_cards (email_id, created_at desc);

alter table public.mail_ai_fact_cards enable row level security;
drop policy if exists "own mail ai fact cards" on public.mail_ai_fact_cards;
create policy "own mail ai fact cards" on public.mail_ai_fact_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
