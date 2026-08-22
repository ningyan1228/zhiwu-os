-- Zhiwu OS V1.4: Customer Intelligence Layer. Run after v1_3_mail_business.sql.

alter table public.customers add column if not exists customer_summary text;
alter table public.customers add column if not exists customer_background text;
alter table public.customers add column if not exists customer_need text;
alter table public.customers add column if not exists important_notes text;
alter table public.customers add column if not exists customer_value integer not null default 3;
alter table public.customers add column if not exists customer_tags text[] not null default array[]::text[];
alter table public.customers add column if not exists industry text;

alter table public.customers drop constraint if exists customers_customer_value_check;
alter table public.customers add constraint customers_customer_value_check check (customer_value between 1 and 5);
create index if not exists customers_country_idx on public.customers(user_id, country);
create index if not exists customers_tags_idx on public.customers using gin(customer_tags);

-- Approved CRM enrichment for the existing Zhiwu OS customer records.
update public.customers set
  industry = 'Flexible Packaging', customer_summary = '印度包装企业，开发 PPC 食品包装薄膜。',
  customer_background = '大型包装企业，主要从事薄膜和食品包装业务。',
  customer_need = '测试 NL-007，评估 PPC 食品包装薄膜的阻隔性能。',
  important_notes = '关注 MFR 5–7、20–30μm 膜厚、OTR <5 与 WVTR <5。',
  customer_value = 5, customer_tags = array['High Potential', 'Sample Stage', 'Flexible Packaging']
where company_name = 'Uflex';

update public.customers set
  industry = 'Agricultural Packaging', customer_summary = '印度农业包装相关企业，测试水性阻隔乳液。',
  customer_background = '关注纸基/农业包装的 PFAS-free 阻隔方案。',
  customer_need = '测试 NL-PHA-21 水性阻隔涂层并确认样品付款。',
  important_notes = '样品费用待确认，优先核对收货信息与付款节点。',
  customer_value = 4, customer_tags = array['High Potential', 'Sample Stage', 'Water-based Coating']
where company_name = 'Agrileaf';

update public.customers set
  industry = 'Flexible Packaging', customer_summary = '菲律宾软包装客户，寻找 Henkel Proxmelt E4050 替代方案。',
  customer_background = '正在进行替代材料的技术验证。',
  customer_need = '确认替代产品的技术性能并接收客户样品。',
  important_notes = '技术测试优先，跟进客户寄样进度。',
  customer_value = 4, customer_tags = array['Technical Testing', 'Replacement Project', 'Flexible Packaging']
where company_name = 'Flexo';

update public.customers set
  industry = 'Food Service Packaging', customer_summary = '荷兰食品纸杯客户，寻找 PFAS-free 阻隔涂层。',
  customer_background = '聚焦食品纸杯和纸基包装的合规性。',
  customer_need = '确认 NL-PHA-21 样品在纸杯涂层中的效果。',
  important_notes = '需确认样品方案与涂布工艺。',
  customer_value = 4, customer_tags = array['PFAS-free', 'Sample Stage', 'Paper Coating']
where company_name = 'FLEX Design';

update public.customers set
  industry = 'Polypropylene Applications', customer_summary = '泰国客户寻找液态马来酸酐改性氯化聚丙烯方案。',
  customer_background = '对 PP 附着力改性有长期潜在需求。',
  customer_need = '评估 MCPP 在聚丙烯附着力改性中的表现。',
  important_notes = '潜在年需求约 20 吨，保持长期技术沟通。',
  customer_value = 3, customer_tags = array['Long Term Follow-up', 'MCPP', 'Thailand']
where company_name = 'ATSajan';

update public.customers set
  industry = 'Printing & Packaging', customer_summary = '印度印刷/包装客户，关注水性阻隔涂层价格和热封性能。',
  customer_background = '已进入报价沟通，关注 CIF Mundra 条件。',
  customer_need = '确认 NL-PHA-21 的价格、热封性能和应用数据。',
  important_notes = '价格敏感，报价后应在 7 天内跟进。',
  customer_value = 4, customer_tags = array['Price Sensitive', 'Quotation', 'Water-based Coating']
where company_name = 'Inkofix';
