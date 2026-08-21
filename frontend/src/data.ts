import type { Customer, Followup, Product } from './types'

export const customers: Customer[] = [
  { id: 'c1', company_name: 'Apex Polymers Pvt Ltd', country: 'India', contact_person: 'Rohan Mehta', email: 'rohan@apexpolymers.in', whatsapp: '+91 98 221 8608', product_interest: 'HM-800, CPP', customer_stage: 'Negotiation', last_contact_date: '2026-08-19', next_followup_date: '2026-08-22', notes: '等待确认 20FT 柜的最终采购量。', created_at: '2026-05-12' },
  { id: 'c2', company_name: 'Manila Packaging Co.', country: 'Philippines', contact_person: 'Sofia Reyes', email: 'sofia@manilapack.ph', whatsapp: '+63 917 555 0190', product_interest: 'NL-PHA-21', customer_stage: 'Quoted', last_contact_date: '2026-08-17', next_followup_date: '2026-08-21', notes: '已发送 FOB 上海报价，询问付款条款。', created_at: '2026-06-03' },
  { id: 'c3', company_name: 'Nusantara Materials', country: 'Indonesia', contact_person: 'Budi Santoso', email: 'budi@nusantara.co.id', whatsapp: '+62 812 995 771', product_interest: 'ESO', customer_stage: 'Sample', last_contact_date: '2026-08-15', next_followup_date: '2026-08-25', notes: '样品已签收，等待测试报告。', created_at: '2026-07-20' },
  { id: 'c4', company_name: 'Mekong Chemical', country: 'Vietnam', contact_person: 'Minh Nguyen', email: 'minh@mekongchem.vn', whatsapp: '+84 903 118 690', product_interest: 'MCPP', customer_stage: 'Inquiry', last_contact_date: '2026-08-20', next_followup_date: '2026-08-23', notes: '首次询盘，需发送产品 TDS。', created_at: '2026-08-20' },
  { id: 'c5', company_name: 'Nordic Formulations AB', country: 'Sweden', contact_person: 'Erik Lind', email: 'erik@nordicform.se', whatsapp: '+46 70 516 2000', product_interest: 'CPP', customer_stage: 'Won', last_contact_date: '2026-08-10', next_followup_date: '2026-09-05', notes: '首单已确认，安排九月出货。', created_at: '2026-02-14' },
]

export const followups: Followup[] = [
  { id: 'f1', customer_id: 'c1', date: '2026-08-19', content: '客户希望将 HM-800 试单与 CPP 合并运输。', next_action: '确认装柜方案并发送 PI', status: 'Open' },
  { id: 'f2', customer_id: 'c2', date: '2026-08-17', content: '已向 Sofia 发送产品报价与规格书。', next_action: '询问报价反馈', status: 'Open' },
  { id: 'f3', customer_id: 'c3', date: '2026-08-15', content: '样品到达雅加达，客户开始实验室测试。', next_action: '索取测试结果', status: 'Open' },
]

export const products: Product[] = [
  { id: 'p1', product_name: 'HM-800', product_code: 'HM-800', category: '热熔胶原料', application: '包装、标签、卫生用品', description: '高初粘热熔胶基料，兼顾开放时间与粘接强度。', notes: '主推出口产品' },
  { id: 'p2', product_name: 'Nonyl Phenol PHA-21', product_code: 'NL-PHA-21', category: '橡胶助剂', application: '轮胎、工业橡胶', description: '适用于橡胶体系的功能性酚醛树脂。', notes: '可提供 COA / TDS' },
  { id: 'p3', product_name: 'Epoxidized Soybean Oil', product_code: 'ESO', category: '增塑剂', application: 'PVC、涂料、油墨', description: '环保型环氧增塑剂和稳定剂。', notes: '常规出口包装 200kg 铁桶' },
  { id: 'p4', product_name: 'Chlorinated Polypropylene', product_code: 'CPP', category: '树脂', application: '油墨、涂料、粘合剂', description: '改善 PP 基材附着力的氯化聚丙烯树脂。', notes: '溶剂型体系适用' },
]
