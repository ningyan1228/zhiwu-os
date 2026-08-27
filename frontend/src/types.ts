export type CustomerStage = 'New' | 'Inquiry' | 'Quoted' | 'Sample' | 'Negotiation' | 'Won' | 'Lost' | 'New Inquiry' | 'Technical Discussion' | 'Quotation' | 'Sample Payment' | 'Sample Payment Pending' | 'Technical Testing' | 'Technical Confirmation' | 'Maintain Relationship'

export type Customer = {
  id: string; user_id?: string; company_name: string; country: string; contact_person: string; email: string
  whatsapp: string; product_interest: string; customer_stage: CustomerStage; last_contact_date: string
  next_followup_date: string; notes: string; created_at: string
  application?: string; priority?: 'HIGH' | 'MEDIUM HIGH' | 'MEDIUM'; status_label?: string
  status_tone?: 'warning' | 'attention' | 'success'; current_progress?: string[]; next_action?: string[]
  requirements?: string[]; project_background?: string[]; monthly_consumption?: string; quotation?: string[]
  sample_status?: string; timeline?: TimelineItem[]
  customer_summary?: string; customer_background?: string; customer_need?: string; important_notes?: string
  customer_value?: number; customer_tags?: string[]; industry?: string; website?: string; wechat?: string
}
export type WorkspaceMember = { user_id: string; display_name: string; role: 'admin' | 'member' }

export type SupplierStatus = '待联系' | '已询价' | '等 TDS' | '等报价' | '等样品' | '技术评估' | '已合作' | '暂停' | '淘汰'
export type Supplier = {
  id: string; user_id?: string; company_name: string; english_name?: string | null; country: string; province?: string | null; city?: string | null; address?: string | null; website?: string | null
  supplier_type: '工厂' | '贸易商' | '待确认'; export_status: '可出口' | '不可出口' | '待确认'; main_phone?: string | null; main_email?: string | null; wechat?: string | null
  product_keywords: string[]; product_categories: string[]; supplier_tags: string[]; current_status: SupplierStatus; last_contact_date?: string | null; next_action?: string | null; next_followup_date?: string | null; notes?: string | null; risk_notes?: string | null; created_at: string
}
export type SupplierContact = { id: string; supplier_id: string; name: string; title?: string | null; mobile?: string | null; phone?: string | null; email?: string | null; wechat?: string | null; whatsapp?: string | null; responsible_products?: string | null; is_primary: boolean; notes?: string | null; created_at: string }
export type SupplierProduct = { id: string; supplier_id: string; product_name: string; internal_keywords: string[]; nl_product_id?: string | null; nl_status: '无 / 待确认' | '已确认关联'; reference_model?: string | null; application?: string | null; technical_summary?: string | null; customizable: '是' | '否' | '待确认'; sample_available: '是' | '否' | '待确认'; capacity?: string | null; moq?: string | null; standard_lead_time?: string | null; packaging?: string | null; export_capacity: string; notes?: string | null; created_at: string }
export type SupplierDocument = { id: string; supplier_id: string; supplier_product_id?: string | null; project_id?: string | null; rfq_id?: string | null; document_type: 'TDS' | 'SDS' | 'COA' | '报价单' | '产品图片' | '认证文件' | '邮件附件' | '其他资料'; file_name: string; storage_path: string; mime_type?: string | null; file_size?: number | null; source: string; internal_notes?: string | null; uploaded_at: string }
export type SupplierFollowup = { id: string; supplier_id: string; supplier_project_link_id?: string | null; rfq_id?: string | null; date: string; channel: '邮件' | '微信' | '电话' | '会议' | '报价' | '样品' | '技术确认' | '其他'; content: string; conclusion?: string | null; next_action?: string | null; next_followup_date?: string | null; owner_name?: string | null; status: SupplierStatus; created_at: string }
export type SupplierProjectLink = { id: string; customer_id: string; project_id: string; supplier_id: string; supplier_product_id?: string | null; customer_need?: string | null; reference_product?: string | null; match_status: '待询价' | '等资料' | '技术评估' | '已推荐' | '已送样' | '测试中' | '已成交' | '未匹配'; technical_match_notes?: string | null; quote_status?: string | null; sample_status?: string | null; current_risk?: string | null; next_action?: string | null; next_followup_date?: string | null; created_at: string }
export type SupplierRfq = { id: string; rfq_number: string; customer_id: string; project_id: string; supplier_id: string; supplier_product_id?: string | null; demand_product: string; reference_product?: string | null; end_application?: string | null; technical_requirements?: string | null; sample_quantity?: string | null; expected_monthly_usage?: string | null; expected_annual_usage?: string | null; destination_country?: string | null; requested_materials: string[]; status: '草稿' | '已发送' | '供应商已回复' | '技术评估' | '关闭'; created_date: string; sent_date?: string | null; next_followup_date?: string | null; reply_content?: string | null; created_at: string }
export type SupplierInsight = { supplier_id: string; document_count: number; tds_count: number; sample_available: boolean; effective_quote_count: number; project_link_count: number }

export type Followup = { id: string; customer_id: string; date: string; content: string; next_action: string; status: 'Open' | 'Done' }
export type Product = { id: string; product_name: string; product_code: string; category: string; application: string; description: string; image_url?: string; notes: string }
export type ProductCustomerRelation = { id: string; product_id: string; customer_id: string; created_at: string }
export type TimelineItem = { date: string; title: string; detail?: string }
export type Project = { id: string; customer_id: string; project_name: string; product_id?: string; product_code?: string; application: string; stage: CustomerStage; notes: string; created_at?: string }
export type Quote = { id: string; customer_id: string; product_id?: string; product_code?: string; quantity: string; amount?: number; currency: string; trade_term?: string; status: string; created_at?: string }
export type MailEmail = {
  id: string; message_id: string; sender: string; receiver?: string; sender_name?: string; subject: string
  content_preview?: string; content_text?: string; received_at: string; attachment_count: number
  customer_id?: string; project_id?: string; product_id?: string
  is_internal_sender?: boolean
  status: 'unread' | 'new_lead' | 'linked' | 'followup_created' | 'completed'
  category: 'customer_inquiry' | 'technical' | 'quotation' | 'sample' | 'payment' | 'other'; created_at: string
}
export type EmailSync = { status: string; total_synced: number; last_sync_time?: string | null; last_error?: string | null }
export type MailboxAccount = { id?: string; mailbox_key?: string; label: string; email_address?: string | null; is_active: boolean; configured: boolean }
export type TaskCategory = '外贸' | '网站' | '设计' | '学习' | '生活' | '其他'
export type TaskPriority = 'important' | 'normal' | 'low'
export type TaskStatus = 'Pending' | 'Completed'
export type Task = {
  id: string; title: string; description?: string; category: TaskCategory; priority: TaskPriority; status: TaskStatus
  task_date: string; start_time?: string | null; end_time?: string | null; estimated_minutes?: number | null
  customer_id?: string | null; project_id?: string | null; product_id?: string | null; created_at?: string; completed_at?: string | null
}
export type DailyLog = { id: string; log_date: string; summary?: string | null; problem?: string | null; tomorrow_plan?: string | null; rating?: number | null; created_at?: string; updated_at?: string }
export type TimelineEvent = { id: string; event_date: string; event_time?: string | null; title: string; event_type: 'task' | 'email' | 'crm' | 'project' | 'note'; source: string; related_id?: string | null; customer_id?: string | null; project_id?: string | null; product_id?: string | null; created_at?: string }
export type ImportAction = { entity: string; action: string; label: string; record_id?: string | null }
export type ImportCustomerMatch = { kind: 'email_exact' | 'company_manual_review' | 'company_ambiguous' | 'internal_forwarder' | 'new_customer' | 'new_supplier'; customer_id?: string | null; candidates: { id: string; company_name: string; email?: string | null }[]; requires_confirmation: boolean; message: string }
export type ImportPreview = { customer_match?: ImportCustomerMatch; supplier_match?: ImportCustomerMatch; actions: ImportAction[]; requires_human_confirmation: boolean; uncertain_fields: string[] }
export type ImportBatch = { id: string; schema_version: string; source_type?: string; source_date?: string; source_reference?: string; preview?: ImportPreview; status: 'draft' | 'applied' | 'reverted' | 'failed'; applied_at?: string | null; reverted_at?: string | null; created_at: string }
export type ImportPreviewResult = { batch: ImportBatch; preview: ImportPreview }
export type ImportApplyResult = { batch_id: string; customer: Customer; customer_action: 'created' | 'updated'; project?: Project | null; products: Product[]; followup?: Followup | null; task?: Task | null }
