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
export type ProductProfileStatus = '草稿' | '已确认'
export type Product = { id: string; product_name: string; product_code: string; category: string; application: string; description: string; image_url?: string; notes: string; technical_keywords?: string[]; confirmed_applications?: string[]; target_industries?: string[]; target_company_types?: string[]; exclusion_rules?: string[]; evidence_urls?: string[]; profile_status?: ProductProfileStatus; profile_updated_at?: string | null }
export type ProductCustomerRelation = { id: string; product_id: string; customer_id: string; created_at: string }
export type TimelineItem = { date: string; title: string; detail?: string }
export type Project = { id: string; customer_id: string; project_name: string; product_id?: string; product_code?: string; application: string; stage: CustomerStage; notes: string; created_at?: string }
export type QuoteStatus = '草稿' | '待内部确认' | '已发送' | '客户议价' | '已接受' | '已失效' | '已拒绝' | string
export type Quote = {
  id: string; customer_id: string; project_id?: string | null; product_id?: string | null; product_code?: string | null
  quote_number?: string; version?: number; revision_of_quote_id?: string | null; product_name_snapshot?: string | null
  specification?: string | null; packaging?: string | null; quantity: string; quantity_unit?: string | null
  unit_price?: number | null; amount?: number | null; currency: string; trade_term?: string | null; incoterm?: string | null
  loading_port?: string | null; destination_port?: string | null; lead_time?: string | null; moq?: string | null
  valid_until?: string | null; payment_terms?: string | null; status: QuoteStatus; source_email_id?: string | null
  source_evidence_summary?: string | null; send_evidence_type?: 'linked_email' | 'manual_confirmation' | null
  manual_send_confirmed_at?: string | null; manual_send_note?: string | null; sent_at?: string | null
  internal_supplier_quote_refs?: string[]; internal_technical_document_refs?: string[]; internal_notes?: string | null
  converted_order_id?: string | null; created_at?: string; updated_at?: string
}
export type SalesOrder = { id: string; order_number: string; quote_id: string; customer_id: string; project_id?: string | null; product_id?: string | null; product_code?: string | null; product_name_snapshot?: string | null; specification?: string | null; packaging?: string | null; quantity?: string | null; quantity_unit?: string | null; unit_price?: number | null; amount?: number | null; currency: string; incoterm?: string | null; loading_port?: string | null; destination_port?: string | null; lead_time?: string | null; payment_terms?: string | null; status: string; execution_notes?: string | null; created_at?: string; updated_at?: string }
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
  customer_id?: string | null; project_id?: string | null; product_id?: string | null; lead_id?: string | null; created_at?: string; completed_at?: string | null
}
export type LeadSearchTask = {
  id: string; user_id?: string; task_name: string; discovery_mode?: '需求客户' | '供应工厂'; product_id?: string | null; product_keywords: string[]; application_keywords: string[]; target_countries: string[]; excluded_countries: string[]; target_company_types: string[]; profile_exclusion_rules: string[]; source_urls: string[]; search_language: string; max_results: number; daily_enabled: boolean; daily_run_time: string; status: '启用' | '暂停'; last_run_at?: string | null; last_run_status?: '成功' | '失败' | null; last_error?: string | null; created_at: string
}
export type CustomerLead = {
  id: string; task_id?: string | null; company_name: string; country?: string | null; city?: string | null; website?: string | null; website_domain?: string | null; source_url: string; source_type: string; public_contact_name?: string | null; public_contact_title?: string | null; public_business_email?: string | null; public_business_phone?: string | null; discovered_product_keywords: string[]; discovered_application_keywords: string[]; possible_need?: string | null; match_score: number; score_reasons: string[]; suspected_duplicate: boolean; duplicate_customer_id?: string | null; duplicate_supplier_id?: string | null; robots_status: string; robots_reason?: string | null; discovered_at: string; status: '待审核' | '保留' | '已转 CRM' | '已排除' | '已联系'; exclusion_reason?: string | null; notes?: string | null; watchlisted: boolean; crm_customer_id?: string | null; development_task_id?: string | null
  verification_bucket: '严格客户名单' | '待补信息' | '排除名单'; company_type?: string | null; official_homepage_url?: string | null; company_source_url?: string | null; contact_department?: string | null; contact_source_url?: string | null; email_source_url?: string | null; phone_source_url?: string | null; email_domain_note?: string | null; official_address?: string | null; business_scope?: string | null; product_evidence_summary?: string | null; product_evidence_url?: string | null; product_evidence_type?: string | null; matching_grade?: 'A' | 'B' | null; recommended_contact_department?: string | null; first_contact_questions?: string | null; verification_conclusion?: string | null; missing_requirements: string[]; verified_at?: string | null
  source_record_id?: string | null; match_level?: string | null; official_website?: string | null; public_contact_or_department?: string | null; product_application_evidence?: string | null; application_scope?: string | null; potential_fit?: string | null; source_urls?: string[]; verification_status?: string | null; discovery_mode?: '需求客户' | '供应工厂'; data_source?: string | null; imported_at?: string | null; needs_human_confirmation?: boolean; confirmation_note?: string | null; first_discovery_source_url?: string | null; official_validation_source_url?: string | null
  lead_layer?: '直接需求候选' | '间接应用链' | '供应工厂候选' | '排除' | '待判定'
}
export type StrictLeadImportResult = { total: number; inserted: number; updated: number; a_count: number; b_count: number }
export type LeadDiscoveryRun = { id: string; task_id: string; trigger_type: 'manual' | 'daily' | 'retry'; status: '运行中' | '成功' | '失败' | '跳过'; started_at: string; finished_at?: string | null; discovered_count: number; inserted_count: number; skipped_count: number; error_message?: string | null; run_log: string[] }
export type DailyLog = { id: string; log_date: string; summary?: string | null; problem?: string | null; tomorrow_plan?: string | null; rating?: number | null; created_at?: string; updated_at?: string }
export type TimelineEvent = { id: string; event_date: string; event_time?: string | null; title: string; event_type: 'task' | 'email' | 'crm' | 'project' | 'note'; source: string; related_id?: string | null; customer_id?: string | null; project_id?: string | null; product_id?: string | null; created_at?: string }
export type ImportAction = { entity: string; action: string; label: string; record_id?: string | null }
export type ImportCustomerMatch = { kind: 'email_exact' | 'company_manual_review' | 'company_ambiguous' | 'internal_forwarder' | 'new_customer' | 'new_supplier'; customer_id?: string | null; candidates: { id: string; company_name: string; email?: string | null }[]; requires_confirmation: boolean; message: string }
export type ImportPreview = { customer_match?: ImportCustomerMatch; supplier_match?: ImportCustomerMatch; actions: ImportAction[]; requires_human_confirmation: boolean; uncertain_fields: string[] }
export type ImportBatch = { id: string; schema_version: string; source_type?: string; source_date?: string; source_reference?: string; preview?: ImportPreview; status: 'draft' | 'applied' | 'reverted' | 'failed'; applied_at?: string | null; reverted_at?: string | null; created_at: string }
export type ImportPreviewResult = { batch: ImportBatch; preview: ImportPreview }
export type ImportApplyResult = { batch_id: string; customer: Customer; customer_action: 'created' | 'updated'; project?: Project | null; products: Product[]; followup?: Followup | null; task?: Task | null }
