-- Zhiwu OS V1.12: Supplier Center / Supply-chain collaboration.
-- Run after V1.11.  This migration only adds supplier-side records and links;
-- it never changes an existing customer or creates a formal NL product code.

begin;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_name text not null,
  english_name text,
  country text not null default 'China',
  province text,
  city text,
  address text,
  website text,
  supplier_type text not null default '待确认' check (supplier_type in ('工厂', '贸易商', '待确认')),
  export_status text not null default '待确认' check (export_status in ('可出口', '不可出口', '待确认')),
  main_phone text,
  main_email text,
  wechat text,
  product_keywords text[] not null default array[]::text[],
  product_categories text[] not null default array[]::text[],
  supplier_tags text[] not null default array[]::text[],
  current_status text not null default '待联系' check (current_status in ('待联系', '已询价', '等 TDS', '等报价', '等样品', '技术评估', '已合作', '暂停', '淘汰')),
  last_contact_date date,
  next_action text,
  next_followup_date date,
  notes text,
  risk_notes text,
  archived_at timestamptz,
  import_batch_id uuid references public.import_batches(id) on delete set null,
  import_reverted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name text not null,
  title text,
  mobile text,
  phone text,
  email text,
  wechat text,
  whatsapp text,
  responsible_products text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_name text not null,
  internal_keywords text[] not null default array[]::text[],
  nl_product_id uuid references public.products(id) on delete set null,
  nl_status text not null default '无 / 待确认' check (nl_status in ('无 / 待确认', '已确认关联')),
  reference_model text,
  application text,
  technical_summary text,
  customizable text not null default '待确认' check (customizable in ('是', '否', '待确认')),
  sample_available text not null default '待确认' check (sample_available in ('是', '否', '待确认')),
  capacity text,
  moq text,
  standard_lead_time text,
  packaging text,
  export_capacity text not null default '待确认',
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  rfq_id uuid,
  document_type text not null check (document_type in ('TDS', 'SDS', 'COA', '报价单', '产品图片', '认证文件', '邮件附件', '其他资料')),
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  source text not null default '手动上传',
  internal_notes text,
  uploaded_at timestamptz not null default now()
);

create table if not exists public.supplier_followups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_project_link_id uuid,
  rfq_id uuid,
  date date not null default current_date,
  channel text not null default '微信' check (channel in ('邮件', '微信', '电话', '会议', '报价', '样品', '技术确认', '其他')),
  content text not null,
  conclusion text,
  next_action text,
  next_followup_date date,
  owner_name text,
  status text not null default '待联系' check (status in ('待联系', '已询价', '等 TDS', '等报价', '等样品', '技术评估', '已合作', '暂停', '淘汰')),
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_project_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  customer_need text,
  reference_product text,
  match_status text not null default '待询价' check (match_status in ('待询价', '等资料', '技术评估', '已推荐', '已送样', '测试中', '已成交', '未匹配')),
  technical_match_notes text,
  quote_status text,
  sample_status text,
  current_risk text,
  next_action text,
  next_followup_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, supplier_id, supplier_product_id)
);

create table if not exists public.supplier_rfqs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rfq_number text not null unique,
  customer_id uuid not null references public.customers(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  supplier_product_id uuid references public.supplier_products(id) on delete set null,
  demand_product text not null,
  reference_product text,
  end_application text,
  technical_requirements text,
  sample_quantity text,
  expected_monthly_usage text,
  expected_annual_usage text,
  destination_country text,
  requested_materials text[] not null default array['TDS', 'SDS', 'COA', '报价', 'MOQ', '样品', '交期', '包装', '出口能力']::text[],
  status text not null default '草稿' check (status in ('草稿', '已发送', '供应商已回复', '技术评估', '关闭')),
  created_date date not null default current_date,
  sent_date date,
  next_followup_date date,
  reply_content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Supplier imports use the same review/revert audit trail as customer imports.
alter table public.suppliers add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.suppliers add column if not exists import_reverted boolean not null default false;
alter table public.supplier_contacts add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.supplier_contacts add column if not exists import_reverted boolean not null default false;
alter table public.supplier_products add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.supplier_products add column if not exists import_reverted boolean not null default false;
alter table public.supplier_followups add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.supplier_followups add column if not exists import_reverted boolean not null default false;
alter table public.supplier_project_links add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.supplier_project_links add column if not exists import_reverted boolean not null default false;
alter table public.supplier_rfqs add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;
alter table public.supplier_rfqs add column if not exists import_reverted boolean not null default false;

alter table public.import_effects drop constraint if exists import_effects_entity_type_check;
alter table public.import_effects add constraint import_effects_entity_type_check check (entity_type in ('customer', 'project', 'product', 'product_customer_relation', 'followup', 'task', 'timeline', 'supplier', 'supplier_contact', 'supplier_product', 'supplier_followup', 'supplier_project_link', 'supplier_rfq'));

do $$ begin
  alter table public.supplier_documents add constraint supplier_documents_rfq_id_fkey foreign key (rfq_id) references public.supplier_rfqs(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.supplier_followups add constraint supplier_followups_link_id_fkey foreign key (supplier_project_link_id) references public.supplier_project_links(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.supplier_followups add constraint supplier_followups_rfq_id_fkey foreign key (rfq_id) references public.supplier_rfqs(id) on delete set null;
exception when duplicate_object then null; end $$;

alter table public.tasks add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.tasks add column if not exists supplier_rfq_id uuid references public.supplier_rfqs(id) on delete set null;
alter table public.timeline_events add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;
alter table public.timeline_events add column if not exists supplier_rfq_id uuid references public.supplier_rfqs(id) on delete set null;

create index if not exists suppliers_operational_idx on public.suppliers(next_followup_date) where archived_at is null and import_reverted = false;
create index if not exists supplier_contacts_supplier_idx on public.supplier_contacts(supplier_id);
create index if not exists supplier_products_supplier_idx on public.supplier_products(supplier_id);
create index if not exists supplier_documents_supplier_idx on public.supplier_documents(supplier_id, uploaded_at desc);
create index if not exists supplier_followups_supplier_idx on public.supplier_followups(supplier_id, date desc);
create index if not exists supplier_links_project_idx on public.supplier_project_links(project_id, supplier_id);
create index if not exists supplier_rfqs_supplier_idx on public.supplier_rfqs(supplier_id, next_followup_date);

alter table public.suppliers enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.supplier_products enable row level security;
alter table public.supplier_documents enable row level security;
alter table public.supplier_followups enable row level security;
alter table public.supplier_project_links enable row level security;
alter table public.supplier_rfqs enable row level security;

-- The supplier library is shared by authenticated workspace members. Customer
-- project links and RFQs additionally require access to the linked customer.
drop policy if exists "workspace suppliers" on public.suppliers;
drop policy if exists "workspace supplier contacts" on public.supplier_contacts;
drop policy if exists "workspace supplier products" on public.supplier_products;
drop policy if exists "workspace supplier documents" on public.supplier_documents;
drop policy if exists "workspace supplier followups" on public.supplier_followups;
drop policy if exists "directional supplier project links" on public.supplier_project_links;
drop policy if exists "directional supplier rfqs" on public.supplier_rfqs;
create policy "workspace suppliers" on public.suppliers for all using (public.is_workspace_member()) with check (public.is_workspace_member());
create policy "workspace supplier contacts" on public.supplier_contacts for all using (public.is_workspace_member()) with check (public.is_workspace_member());
create policy "workspace supplier products" on public.supplier_products for all using (public.is_workspace_member()) with check (public.is_workspace_member());
create policy "workspace supplier documents" on public.supplier_documents for all using (public.is_workspace_member()) with check (public.is_workspace_member());
create policy "workspace supplier followups" on public.supplier_followups for all using (public.is_workspace_member()) with check (public.is_workspace_member());
create policy "directional supplier project links" on public.supplier_project_links for all
  using (public.can_access_customer(customer_id)) with check (public.can_access_customer(customer_id));
create policy "directional supplier rfqs" on public.supplier_rfqs for all
  using (public.can_access_customer(customer_id)) with check (public.can_access_customer(customer_id));

insert into storage.buckets (id, name, public)
values ('supplier-documents', 'supplier-documents', false)
on conflict (id) do update set public = false;

-- Seed one reviewed-but-unconfirmed supplier. No NL product is created.
do $$
declare
  zhiwu_id uuid;
  atsajan_customer_id uuid;
  target_project_id uuid;
  deshang_supplier_id uuid;
  deshang_product_id uuid;
begin
  select user_id into zhiwu_id from public.mailbox_accounts where mailbox_key = 'zhiwu' limit 1;
  if zhiwu_id is null then
    raise exception 'Cannot seed supplier: Zhiwu mailbox member was not found';
  end if;
  select id into atsajan_customer_id from public.customers where lower(company_name) = lower('ATSajan Supply Co., Ltd.') and archived_at is null limit 1;
  if atsajan_customer_id is null then
    raise exception 'Cannot seed supplier link: ATSajan Supply Co., Ltd. was not found';
  end if;
  select id into target_project_id from public.projects where customer_id = atsajan_customer_id and lower(project_name) = lower('Waterborne Acid-modified CPP / CPO for PP Automotive Interior') and archived_at is null limit 1;
  if target_project_id is null then
    insert into public.projects (user_id, customer_id, project_name, application, stage, notes)
    values (zhiwu_id, atsajan_customer_id, 'Waterborne Acid-modified CPP / CPO for PP Automotive Interior', 'PP 汽车内饰件水性涂装', 'Technical Discussion', '客户提供 Hardlen EW-5303 参考 TDS；待国内供应商确认接近型号或定制可行性。')
    returning id into target_project_id;
  end if;
  select id into deshang_supplier_id from public.suppliers where lower(company_name) = lower('浙江德尚化工科技有限公司') and archived_at is null limit 1;
  if deshang_supplier_id is null then
    insert into public.suppliers (user_id, company_name, english_name, country, province, city, address, website, supplier_type, export_status, main_phone, main_email, product_keywords, supplier_tags, current_status, next_action, next_followup_date, notes, risk_notes)
    values (zhiwu_id, '浙江德尚化工科技有限公司', 'Zhejiang Deshang Chemical Technology Co., Ltd.', 'China', '浙江省', '湖州市德清县', '乾元镇北郊路 26 号', 'https://www.desoul.net/', '待确认', '待确认', '0572-8434059 / 0572-8434060', 'admin@desoul.cn', array['水性 CPP 乳液','马来酸酐改性 PP','PP 附着力促进剂'], array['待确认','水性 CPP','PP 附着力促进剂'], '已询价', '等待德尚回复接近型号、TDS、SDS、COA、样品政策、MOQ、报价、交期和出口包装信息。', '2026-08-29', '销售电话：0572-8434059；总机：0572-8434060。', '尚未确认其产品与 Hardlen EW-5303 的技术等同性；不得对客户承诺可替代，必须经 TDS 对比与样品测试后确认。')
    returning id into deshang_supplier_id;
  end if;
  select id into deshang_product_id from public.supplier_products where supplier_id = deshang_supplier_id and product_name = '水性酸改性 CPP / CPO（待确认型号）' limit 1;
  if deshang_product_id is null then
    insert into public.supplier_products (user_id, supplier_id, product_name, internal_keywords, nl_status, reference_model, application, technical_summary, customizable, sample_available, export_capacity, notes)
    values (zhiwu_id, deshang_supplier_id, '水性酸改性 CPP / CPO（待确认型号）', array['水性 CPP','酸改性 CPP','CPO','PP 附着力促进剂'], '无 / 待确认', 'Hardlen EW-5303', 'PP 汽车内饰件水性涂装', '待供应商正式 TDS / SDS / COA 确认。', '待确认', '待确认', '待确认', '参考型号仅用于技术对比，不代表已确认等同或可替代。')
    returning id into deshang_product_id;
  end if;
  insert into public.supplier_project_links (user_id, customer_id, project_id, supplier_id, supplier_product_id, customer_need, reference_product, match_status, technical_match_notes, current_risk, next_action, next_followup_date)
  values (zhiwu_id, atsajan_customer_id, target_project_id, deshang_supplier_id, deshang_product_id, '水性酸改性氯化聚烯烃 / 水性 CPP，应用于 PP 汽车内饰件水性涂装；需确认接近型号或可按 TDS 定制。', 'Hardlen EW-5303', '等资料', '待供应商回复后与客户参考 TDS 进行技术对比。', '尚未确认技术等同性，不得向客户承诺替代。', '等待德尚回复 TDS、SDS、COA、样品政策、MOQ、报价、交期和出口包装信息。', '2026-08-29')
  on conflict (project_id, supplier_id, supplier_product_id) do update set
    customer_need = excluded.customer_need, reference_product = excluded.reference_product,
    match_status = excluded.match_status, technical_match_notes = excluded.technical_match_notes,
    current_risk = excluded.current_risk, next_action = excluded.next_action,
    next_followup_date = excluded.next_followup_date, updated_at = now();
end $$;

commit;
