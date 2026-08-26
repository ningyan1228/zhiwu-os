-- Zhiwu OS V1.9: CRM master-record merge.
--
-- Purpose:
--   Merge the accidental Peter-owned demo duplicates into Zhiwu's six real
--   customer master records. Nothing is hard-deleted. Source records receive
--   archived_at + merged_into_* metadata and an immutable audit snapshot.
--
-- Run once in Supabase SQL Editor after v1_8_team_mailboxes.sql.

begin;

-- Archive metadata is deliberately separate from AI-import reversal metadata.
alter table public.customers add column if not exists archived_at timestamptz;
alter table public.customers add column if not exists merged_into_customer_id uuid references public.customers(id) on delete set null;
alter table public.customers add column if not exists archive_reason text;

alter table public.products add column if not exists archived_at timestamptz;
alter table public.products add column if not exists merged_into_product_id uuid references public.products(id) on delete set null;
alter table public.products add column if not exists archive_reason text;

alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists merged_into_project_id uuid references public.projects(id) on delete set null;
alter table public.projects add column if not exists archive_reason text;

alter table public.quotes add column if not exists archived_at timestamptz;
alter table public.quotes add column if not exists merged_into_quote_id uuid references public.quotes(id) on delete set null;
alter table public.quotes add column if not exists archive_reason text;

alter table public.followups add column if not exists archived_at timestamptz;
alter table public.followups add column if not exists merged_into_followup_id uuid references public.followups(id) on delete set null;
alter table public.followups add column if not exists archive_reason text;

alter table public.tasks add column if not exists archived_at timestamptz;
alter table public.tasks add column if not exists archive_reason text;
alter table public.timeline_events add column if not exists archived_at timestamptz;
alter table public.timeline_events add column if not exists archive_reason text;
alter table public.product_customer_relations add column if not exists archived_at timestamptz;
alter table public.product_customer_relations add column if not exists archive_reason text;

create index if not exists customers_operational_idx on public.customers(archived_at) where archived_at is null;
create index if not exists products_operational_idx on public.products(archived_at) where archived_at is null;
create index if not exists projects_operational_idx on public.projects(archived_at) where archived_at is null;

create table if not exists public.customer_merge_log (
  id uuid primary key default gen_random_uuid(),
  source_customer_id uuid not null unique references public.customers(id) on delete restrict,
  master_customer_id uuid not null references public.customers(id) on delete restrict,
  source_snapshot jsonb not null,
  reason text not null,
  merged_by uuid references auth.users(id) on delete set null,
  merged_at timestamptz not null default now()
);
alter table public.customer_merge_log enable row level security;
drop policy if exists "workspace customer merge log" on public.customer_merge_log;
create policy "workspace customer merge log" on public.customer_merge_log for select
  using (public.is_workspace_member());

-- Fixed IDs make the migration auditable and idempotent. The left side is the
-- Zhiwu-created master record; the right side is the Peter-created duplicate.
create temporary table crm_customer_merge_map (
  master_customer_id uuid primary key,
  source_customer_id uuid unique not null
) on commit drop;

insert into crm_customer_merge_map (master_customer_id, source_customer_id) values
  ('85a38500-a3b6-4c5a-b085-b47eb31f0ed7', 'd5096fbc-88c1-4c8f-9448-afca609cef01'), -- Uflex
  ('c25c35f9-ae08-4df2-820d-a6cadc830a50', '60912070-590e-4f52-837b-35e4bb6a5880'), -- Agrileaf
  ('e88f5708-b28b-4f63-bca1-2e8fc0b0846a', '6ef2e1d3-7058-4d74-8040-dd4c005d0e8d'), -- Flexo
  ('cd24f346-4f95-45be-8d52-5dc7e63956eb', 'c6d6ac5f-1197-4451-bcca-013b13c8c795'), -- FLEX/design
  ('3dc314ce-e352-4e52-b904-c6e22e008694', '09ac615e-b44c-4504-9fc5-bac6ad4f5385'), -- ATSajan
  ('1a21538a-5630-4a90-84c8-4ec6c2181d91', '79e60567-5076-40cd-a11b-d26e993d7f13'); -- Inkofix

-- Archive Peter's duplicate product seeds and repoint dependent records to the
-- Zhiwu product of the same public product code.
create temporary table crm_product_merge_map on commit drop as
select source.id as source_product_id, master.id as master_product_id
from public.products source
join public.products master
  on lower(master.product_code) = lower(source.product_code)
 and master.user_id = 'e91acccf-12de-4a1b-aa50-770d43e77914'
where source.user_id = 'e2f5ee6c-75ca-448d-a854-83f5ca5c6a98'
  and source.archived_at is null;

update public.projects target set product_id = map.master_product_id
from crm_product_merge_map map where target.product_id = map.source_product_id;
update public.quotes target set product_id = map.master_product_id
from crm_product_merge_map map where target.product_id = map.source_product_id;
update public.emails target set product_id = map.master_product_id
from crm_product_merge_map map where target.product_id = map.source_product_id;
update public.tasks target set product_id = map.master_product_id
from crm_product_merge_map map where target.product_id = map.source_product_id;
update public.timeline_events target set product_id = map.master_product_id
from crm_product_merge_map map where target.product_id = map.source_product_id;
update public.product_customer_relations target set product_id = map.master_product_id
from crm_product_merge_map map where target.product_id = map.source_product_id;
update public.products target
set archived_at = now(), merged_into_product_id = map.master_product_id,
    archive_reason = 'Merged duplicate demo product into Zhiwu master product'
from crm_product_merge_map map
where target.id = map.source_product_id and target.archived_at is null;

-- Find Peter's duplicate project records before moving source customer IDs.
create temporary table crm_project_merge_map on commit drop as
select source.id as source_project_id, master.id as master_project_id
from public.projects source
join crm_customer_merge_map customer_map on customer_map.source_customer_id = source.customer_id
join public.projects master
  on master.customer_id = customer_map.master_customer_id
 and lower(master.project_name) = lower(source.project_name)
 and master.archived_at is null
where source.archived_at is null;

-- Keep any genuinely distinct project, but archive the exact copied project.
update public.projects source
set archived_at = now(), merged_into_project_id = project_map.master_project_id,
    archive_reason = 'Merged duplicate demo project into master project'
from crm_project_merge_map project_map
where source.id = project_map.source_project_id and source.archived_at is null;

update public.projects source set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map
left join crm_project_merge_map project_map on project_map.source_project_id = source.id
where source.customer_id = customer_map.source_customer_id
  and project_map.source_project_id is null
  and source.archived_at is null;

update public.emails target set project_id = project_map.master_project_id
from crm_project_merge_map project_map where target.project_id = project_map.source_project_id;
update public.tasks target set project_id = project_map.master_project_id
from crm_project_merge_map project_map where target.project_id = project_map.source_project_id;
update public.timeline_events target set project_id = project_map.master_project_id
from crm_project_merge_map project_map where target.project_id = project_map.source_project_id;

-- Move actual mailbox history and unique operational records to the master.
update public.emails target set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map where target.customer_id = customer_map.source_customer_id;
update public.email_actions target set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map where target.customer_id = customer_map.source_customer_id;
update public.tasks target set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map where target.customer_id = customer_map.source_customer_id;
update public.timeline_events target set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map where target.customer_id = customer_map.source_customer_id;

-- Identical copied follow-ups and quotes are archived; unique historical rows
-- are retained and moved to the customer master record.
create temporary table crm_followup_merge_map on commit drop as
select source.id as source_followup_id, master.id as master_followup_id
from public.followups source
join crm_customer_merge_map customer_map on customer_map.source_customer_id = source.customer_id
join public.followups master
  on master.customer_id = customer_map.master_customer_id
 and master.date = source.date
 and master.content = source.content
 and coalesce(master.next_action, '') = coalesce(source.next_action, '')
 and master.archived_at is null
where source.archived_at is null;

update public.followups source
set archived_at = now(), merged_into_followup_id = followup_map.master_followup_id,
    archive_reason = 'Merged duplicate demo follow-up into master follow-up'
from crm_followup_merge_map followup_map
where source.id = followup_map.source_followup_id and source.archived_at is null;
update public.followups source set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map
left join crm_followup_merge_map followup_map on followup_map.source_followup_id = source.id
where source.customer_id = customer_map.source_customer_id
  and followup_map.source_followup_id is null
  and source.archived_at is null;

create temporary table crm_quote_merge_map on commit drop as
select source.id as source_quote_id, master.id as master_quote_id
from public.quotes source
join crm_customer_merge_map customer_map on customer_map.source_customer_id = source.customer_id
join public.quotes master
  on master.customer_id = customer_map.master_customer_id
 and master.product_id is not distinct from source.product_id
 and master.quantity = source.quantity
 and master.amount is not distinct from source.amount
 and master.currency = source.currency
 and coalesce(master.trade_term, '') = coalesce(source.trade_term, '')
 and master.archived_at is null
where source.archived_at is null;

update public.quotes source
set archived_at = now(), merged_into_quote_id = quote_map.master_quote_id,
    archive_reason = 'Merged duplicate demo quotation into master quotation'
from crm_quote_merge_map quote_map
where source.id = quote_map.source_quote_id and source.archived_at is null;
update public.quotes source set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map
left join crm_quote_merge_map quote_map on quote_map.source_quote_id = source.id
where source.customer_id = customer_map.source_customer_id
  and quote_map.source_quote_id is null
  and source.archived_at is null;

-- A mailbox mapping belongs to its mailbox owner but now targets the shared
-- customer master. Peter's own address is explicitly not a customer mapping.
update public.customer_email_mappings target set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map where target.customer_id = customer_map.source_customer_id;
delete from public.customer_email_mappings
where lower(email_address) = 'peter@neonliontech.com';

-- Product/customer relations are business links, not customer records. Move
-- non-duplicate links and archive only exact collisions.
create temporary table crm_relation_collision on commit drop as
select source.id as source_relation_id
from public.product_customer_relations source
join crm_customer_merge_map customer_map on customer_map.source_customer_id = source.customer_id
where source.archived_at is null
  and exists (
    select 1 from public.product_customer_relations master
    where master.user_id = source.user_id
      and master.product_id = source.product_id
      and master.customer_id = customer_map.master_customer_id
      and master.id <> source.id
      and master.archived_at is null
  );
update public.product_customer_relations source
set archived_at = now(), archive_reason = 'Merged duplicate product/customer relation'
from crm_relation_collision collision
where source.id = collision.source_relation_id and source.archived_at is null;
update public.product_customer_relations source set customer_id = customer_map.master_customer_id
from crm_customer_merge_map customer_map
left join crm_relation_collision collision on collision.source_relation_id = source.id
where source.customer_id = customer_map.source_customer_id
  and collision.source_relation_id is null
  and source.archived_at is null;

-- Preserve an immutable customer snapshot before archiving each duplicate.
insert into public.customer_merge_log (source_customer_id, master_customer_id, source_snapshot, reason, merged_by)
select source.id, customer_map.master_customer_id, to_jsonb(source),
       'Peter-created duplicate CRM master record merged into Zhiwu-created master record', auth.uid()
from public.customers source
join crm_customer_merge_map customer_map on customer_map.source_customer_id = source.id
where source.archived_at is null
on conflict (source_customer_id) do nothing;

insert into public.timeline_events (user_id, event_date, event_time, title, event_type, source, related_id, customer_id)
select master.user_id, current_date, localtime,
       '已合并重复客户档案：' || source.company_name || '（保留历史快照）',
       'crm', 'customer_merge', source.id, master.id
from public.customers source
join crm_customer_merge_map customer_map on customer_map.source_customer_id = source.id
join public.customers master on master.id = customer_map.master_customer_id
where source.archived_at is null;

update public.customers source
set archived_at = now(), merged_into_customer_id = customer_map.master_customer_id,
    archive_reason = 'Peter-created duplicate CRM master record merged into Zhiwu master record'
from crm_customer_merge_map customer_map
where source.id = customer_map.source_customer_id and source.archived_at is null;

-- Canonical company identities and the current business truth supplied by Zhiwu.
update public.customers set
  company_name = 'Uflex Limited (Film Business)', contact_person = 'Dileep Pathak',
  product_interest = 'NL-007', application = 'PPC 薄膜 / 食品包装',
  customer_stage = 'Sample Payment Pending', status_label = '已发 PI · 技术澄清中', status_tone = 'warning',
  customer_summary = '印度 Uflex Films Business；PPC 薄膜及食品包装阻隔母粒项目。',
  customer_need = '流延膜食品包装与保鲜膜用 PPC 薄膜/阻隔母粒；25–50kg 样品。',
  important_notes = '性能目标：MFR 5–7、20–30μm、OTR＜5、WVTR＜5。样品+快递 USD 310，PI 已发，付款前技术澄清。',
  notes = 'NL-007 · PPC 薄膜/食品包装。客户已收 PI；付款前技术澄清中。25kg 样品+快递 USD 310。',
  customer_tags = array['High Potential','PPC Film','Food Packaging','PI Sent']::text[]
where id = '85a38500-a3b6-4c5a-b085-b47eb31f0ed7';

update public.customers set
  company_name = 'Agrileaf Exports Pvt. Ltd.', contact_person = 'Vaibhav Patil',
  product_interest = 'NL-PHA-21', application = '水性 PHA 阻隔乳液',
  customer_stage = 'Sample Payment', status_label = '样品付款处理中', status_tone = 'warning',
  customer_summary = '印度 Agrileaf Exports；水性 PHA 阻隔乳液样品项目。',
  customer_need = '5kg NL-PHA-21 试样，用于纸基/食品接触阻隔应用。',
  important_notes = '客户提及 NL-PHA-2 与 FDA FCN 2424；在工厂正式文件确认前不得对外确认二者关系。',
  notes = 'NL-PHA-21 水性 PHA 阻隔乳液；5kg 样品付款处理中。必须先核实 NL-PHA-2 / FDA FCN 2424 关系。',
  customer_tags = array['High Potential','Sample Payment','Water-based Coating','Compliance Verification']::text[]
where id = 'c25c35f9-ae08-4df2-820d-a6cadc830a50';

update public.customers set
  company_name = 'Flexo Manufacturing Corp', contact_person = 'Joselito Lorenzo',
  product_interest = 'NL-410LM', application = '玻璃纸挤出复合 / 1kg、2kg 奶酪包装',
  customer_stage = 'Technical Testing', status_label = '客户样品 DHL 在途', status_tone = 'attention',
  customer_summary = '菲律宾 Flexo；Henkel Proxmelt E4050 替代项目。',
  customer_need = '玻璃纸挤出复合用替代方案，月用量约 2.5 吨。',
  important_notes = '候选牌号仅内部标注 NL-410LM。客户样品已由 DHL 寄往中国；到货后测试粘接力等适配性能。',
  notes = 'Proxmelt E4050 替代项目；客户样品 DHL 在途，收样后进行适配测试。',
  customer_tags = array['High Potential','Technical Testing','E4050 Replacement','Sample In Transit']::text[]
where id = 'e88f5708-b28b-4f63-bca1-2e8fc0b0846a';

update public.customers set
  company_name = 'FLEX/design FLEX', contact_person = 'Dominic Hallyer',
  product_interest = 'NL-PHA-21', application = 'PFAS-free 模塑纸浆杯阻隔涂层',
  customer_stage = 'Technical Confirmation', status_label = '等待内部供应商审核与样品确认', status_tone = 'warning',
  customer_summary = '荷兰 FLEX/design；PFAS-free 模塑纸浆食品杯阻隔涂层项目。',
  customer_need = 'NL-PHA-21 喷涂/浸涂方案，关注酸性番茄酱耐受与成膜温度。',
  important_notes = '已说明建议烘干温度 110–150°C；细化耐酸/MFFT 数据需客户实测。1–2L 样品 USD 150，约 7 个工作日。',
  notes = '等待客户完成内部供应商审核及样品最终确认。',
  customer_tags = array['PFAS-free','Molded Pulp','Sample Confirmation','Paper Coating']::text[]
where id = 'cd24f346-4f95-45be-8d52-5dc7e63956eb';

update public.customers set
  company_name = 'ATSajan Supply Co., Ltd.', contact_person = 'Anchasa Putthiprasert',
  product_interest = 'NL-MCPP', application = '聚丙烯附着力改性',
  customer_stage = 'Maintain Relationship', status_label = '长期跟进 · 等待工厂确认水性无溶剂 CPO', status_tone = 'success',
  customer_summary = '泰国 ATSajan；MCPP 长期项目，并有水性无溶剂 CPO 新询盘。',
  customer_need = '液态马来酸酐改性氯化聚丙烯方案；潜在需求约 20 吨/年。',
  important_notes = '可接受液态产品 6 个月保质期。水性无溶剂 CPO 必须等待工厂/工程师确认，不能承诺具体时间。',
  notes = 'MCPP 项目年需求约 20 吨，暂作长期跟进；另有水性无溶剂 CPO 独立询盘待工厂确认。',
  customer_tags = array['Long Term Follow-up','MCPP','Water-based Solvent-free CPO','Thailand']::text[]
where id = '3dc314ce-e352-4e52-b904-c6e22e008694';

update public.customers set
  company_name = 'Inkofix', contact_person = 'LN Garg',
  product_interest = 'NL-PHA-21', application = '水性阻隔涂层',
  customer_stage = 'Quotation', status_label = '报价偏高 · 收集热封条件', status_tone = 'attention',
  customer_summary = '印度 Inkofix；水性阻隔涂层报价与热封适配项目。',
  customer_need = '热封及 CIF Mundra 价格；需确认温度、压力、时间、基材、目标热封强度与实际用量。',
  important_notes = '参考报价 USD 5,550/吨 CIF Mundra，1000kg IBC，20 尺柜约 18 吨。客户认为价格偏高。',
  notes = 'NL-PHA-21 水性阻隔涂层。客户认为报价偏高；下一步收集热封条件、基材、用量及性能需求。',
  customer_tags = array['Price Sensitive','Quotation','Heat Seal','Water-based Coating']::text[]
where id = '1a21538a-5630-4a90-84c8-4ec6c2181d91';

-- Public product codes shown to customers use the NL- prefix.
update public.products set product_name = 'NL-MCPP', product_code = 'NL-MCPP',
  notes = '对外牌号 NL-MCPP；原 MCPP 仅保留在项目说明中。'
where id = '40634d2e-3545-460e-a9f1-26f3bd3f528d' and archived_at is null;

insert into public.products (user_id, product_name, product_code, category, application, description, notes)
select 'e91acccf-12de-4a1b-aa50-770d43e77914', 'NL-410LM', 'NL-410LM',
       'E4050 replacement candidate', 'Glassine extrusion coating',
       'Candidate product for the Proxmelt E4050 replacement project.',
       '内部候选牌号；对外须以经确认的产品资料为准。'
where not exists (
  select 1 from public.products where lower(product_code) = 'nl-410lm' and archived_at is null
);

update public.projects set
  product_id = (select id from public.products where lower(product_code) = 'nl-410lm' and archived_at is null limit 1),
  project_name = 'Proxmelt E4050 Replacement Project',
  application = '玻璃纸挤出复合 / 奶酪包装', stage = 'Sample In Transit',
  notes = '候选牌号 NL-410LM（内部）；客户样品已由 DHL 寄往中国，在途，收样后进行适配测试。'
where id = 'cae5849a-e6e5-4fc5-9e3d-5b10fa91b094' and archived_at is null;

update public.projects set
  product_id = (select id from public.products where lower(product_code) = 'nl-mcpp' and archived_at is null limit 1),
  project_name = 'MCPP Long-term Project', stage = 'Maintain Relationship',
  notes = '潜在年需求约 20 吨；保持长期沟通，液态定制方案等待工程师/工厂评估。'
where id = '9366d44f-f31c-415d-a38c-b2be57ac486b' and archived_at is null;

insert into public.projects (user_id, customer_id, project_name, application, stage, notes)
select 'e91acccf-12de-4a1b-aa50-770d43e77914', '3dc314ce-e352-4e52-b904-c6e22e008694',
       'Water-based Solvent-free CPO Inquiry', '水性无溶剂 CPO', 'Factory Confirmation Pending',
       '独立询盘；等待工厂确认方案与可行性，未经确认不得承诺交期或性能。'
where not exists (
  select 1 from public.projects
  where customer_id = '3dc314ce-e352-4e52-b904-c6e22e008694'
    and lower(project_name) = lower('Water-based Solvent-free CPO Inquiry')
    and archived_at is null
);

insert into public.product_customer_relations (user_id, product_id, customer_id)
select 'e91acccf-12de-4a1b-aa50-770d43e77914', product.id, 'e88f5708-b28b-4f63-bca1-2e8fc0b0846a'
from public.products product
where lower(product.product_code) = 'nl-410lm' and product.archived_at is null
  and not exists (
    select 1 from public.product_customer_relations relation
    where relation.product_id = product.id and relation.customer_id = 'e88f5708-b28b-4f63-bca1-2e8fc0b0846a'
      and relation.archived_at is null
  );

commit;
