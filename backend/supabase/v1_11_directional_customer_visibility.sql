-- Zhiwu OS V1.11: directional customer visibility.
-- Zhiwu sees only Zhiwu-owned customers. Peter sees Peter-owned customers
-- plus Zhiwu-owned customers. Mailboxes and personal tasks remain private.
-- Safe to rerun; this changes access rules only and never rewrites customer data.

begin;

-- The legacy user_id column is the customer owner. Peter may collaborate on
-- Zhiwu-owned records, but a customer can never silently change owner.
create or replace function public.prevent_customer_owner_change()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Customer ownership is immutable; create a new customer or use an explicit ownership transfer workflow.';
  end if;
  return new;
end;
$$;

drop trigger if exists customers_prevent_owner_change on public.customers;
create trigger customers_prevent_owner_change
  before update on public.customers
  for each row execute function public.prevent_customer_owner_change();

-- This deliberately uses mailbox keys, not display names, so a renamed profile
-- cannot accidentally change CRM visibility.
create or replace function public.can_access_customer_owner(customer_owner_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.is_workspace_member()
    and (
      customer_owner_id = auth.uid()
      or (
        exists (
          select 1 from public.mailbox_accounts peter
          where peter.user_id = auth.uid() and peter.mailbox_key = 'peter'
        )
        and exists (
          select 1 from public.mailbox_accounts zhiwu
          where zhiwu.user_id = customer_owner_id and zhiwu.mailbox_key = 'zhiwu'
        )
      )
    );
$$;

create or replace function public.can_access_customer(customer_record_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.customers customer
    where customer.id = customer_record_id
      and public.can_access_customer_owner(customer.user_id)
  );
$$;

-- Customers: Zhiwu has only own rows; Peter has own rows plus Zhiwu rows.
drop policy if exists "own customers" on public.customers;
drop policy if exists "workspace customers" on public.customers;
drop policy if exists "directional customers select" on public.customers;
drop policy if exists "directional customers insert" on public.customers;
drop policy if exists "directional customers update" on public.customers;
drop policy if exists "directional customers delete" on public.customers;
create policy "directional customers select" on public.customers
  for select using (public.can_access_customer_owner(user_id));
create policy "directional customers insert" on public.customers
  for insert with check (public.is_workspace_member() and user_id = auth.uid());
create policy "directional customers update" on public.customers
  for update using (public.can_access_customer_owner(user_id))
  with check (public.can_access_customer_owner(user_id));
create policy "directional customers delete" on public.customers
  for delete using (public.can_access_customer_owner(user_id));

-- CRM records follow their linked customer's visibility, rather than the user
-- who happened to create a project, quote, follow-up, or product relation.
drop policy if exists "own projects" on public.projects;
drop policy if exists "workspace projects" on public.projects;
drop policy if exists "directional projects select" on public.projects;
drop policy if exists "directional projects insert" on public.projects;
drop policy if exists "directional projects update" on public.projects;
drop policy if exists "directional projects delete" on public.projects;
create policy "directional projects select" on public.projects for select
  using (public.can_access_customer(customer_id));
create policy "directional projects insert" on public.projects for insert
  with check (public.is_workspace_member() and user_id = auth.uid() and public.can_access_customer(customer_id));
create policy "directional projects update" on public.projects for update
  using (public.can_access_customer(customer_id)) with check (public.can_access_customer(customer_id));
create policy "directional projects delete" on public.projects for delete
  using (public.can_access_customer(customer_id));

drop policy if exists "own followups" on public.followups;
drop policy if exists "workspace followups" on public.followups;
drop policy if exists "directional followups select" on public.followups;
drop policy if exists "directional followups insert" on public.followups;
drop policy if exists "directional followups update" on public.followups;
drop policy if exists "directional followups delete" on public.followups;
create policy "directional followups select" on public.followups for select
  using (public.can_access_customer(customer_id));
create policy "directional followups insert" on public.followups for insert
  with check (public.is_workspace_member() and user_id = auth.uid() and public.can_access_customer(customer_id));
create policy "directional followups update" on public.followups for update
  using (public.can_access_customer(customer_id)) with check (public.can_access_customer(customer_id));
create policy "directional followups delete" on public.followups for delete
  using (public.can_access_customer(customer_id));

drop policy if exists "own quotes" on public.quotes;
drop policy if exists "workspace quotes" on public.quotes;
drop policy if exists "directional quotes select" on public.quotes;
drop policy if exists "directional quotes insert" on public.quotes;
drop policy if exists "directional quotes update" on public.quotes;
drop policy if exists "directional quotes delete" on public.quotes;
create policy "directional quotes select" on public.quotes for select
  using (public.can_access_customer(customer_id));
create policy "directional quotes insert" on public.quotes for insert
  with check (public.is_workspace_member() and user_id = auth.uid() and public.can_access_customer(customer_id));
create policy "directional quotes update" on public.quotes for update
  using (public.can_access_customer(customer_id)) with check (public.can_access_customer(customer_id));
create policy "directional quotes delete" on public.quotes for delete
  using (public.can_access_customer(customer_id));

drop policy if exists "own product customer relations" on public.product_customer_relations;
drop policy if exists "workspace product customer relations" on public.product_customer_relations;
drop policy if exists "directional product customer relations select" on public.product_customer_relations;
drop policy if exists "directional product customer relations insert" on public.product_customer_relations;
drop policy if exists "directional product customer relations update" on public.product_customer_relations;
drop policy if exists "directional product customer relations delete" on public.product_customer_relations;
create policy "directional product customer relations select" on public.product_customer_relations for select
  using (public.can_access_customer(customer_id));
create policy "directional product customer relations insert" on public.product_customer_relations for insert
  with check (public.is_workspace_member() and user_id = auth.uid() and public.can_access_customer(customer_id));
create policy "directional product customer relations update" on public.product_customer_relations for update
  using (public.can_access_customer(customer_id)) with check (public.can_access_customer(customer_id));
create policy "directional product customer relations delete" on public.product_customer_relations for delete
  using (public.can_access_customer(customer_id));

-- Customer-linked timeline entries follow the same rule; personal notes stay
-- visible only to their creator.
drop policy if exists "workspace customer timeline read" on public.timeline_events;
drop policy if exists "workspace customer timeline write" on public.timeline_events;
drop policy if exists "workspace customer timeline update" on public.timeline_events;
drop policy if exists "workspace customer timeline delete" on public.timeline_events;
drop policy if exists "directional timeline select" on public.timeline_events;
drop policy if exists "directional timeline insert" on public.timeline_events;
drop policy if exists "directional timeline update" on public.timeline_events;
drop policy if exists "directional timeline delete" on public.timeline_events;
create policy "directional timeline select" on public.timeline_events for select
  using ((customer_id is null and user_id = auth.uid()) or (customer_id is not null and public.can_access_customer(customer_id)));
create policy "directional timeline insert" on public.timeline_events for insert
  with check (user_id = auth.uid() and public.is_workspace_member() and (customer_id is null or public.can_access_customer(customer_id)));
create policy "directional timeline update" on public.timeline_events for update
  using ((customer_id is null and user_id = auth.uid()) or (customer_id is not null and public.can_access_customer(customer_id)))
  with check ((customer_id is null and user_id = auth.uid()) or (customer_id is not null and public.can_access_customer(customer_id)));
create policy "directional timeline delete" on public.timeline_events for delete
  using ((customer_id is null and user_id = auth.uid()) or (customer_id is not null and public.can_access_customer(customer_id)));

create index if not exists customers_owner_operational_idx
  on public.customers(user_id, created_at desc)
  where archived_at is null and import_reverted = false;

commit;
