export type CustomerStage = 'New' | 'Inquiry' | 'Quoted' | 'Sample' | 'Negotiation' | 'Won' | 'Lost' | 'New Inquiry' | 'Technical Discussion' | 'Quotation' | 'Sample Payment' | 'Sample Payment Pending' | 'Technical Testing' | 'Technical Confirmation' | 'Maintain Relationship'

export type Customer = {
  id: string; company_name: string; country: string; contact_person: string; email: string
  whatsapp: string; product_interest: string; customer_stage: CustomerStage; last_contact_date: string
  next_followup_date: string; notes: string; created_at: string
  application?: string; priority?: 'HIGH' | 'MEDIUM HIGH' | 'MEDIUM'; status_label?: string
  status_tone?: 'warning' | 'attention' | 'success'; current_progress?: string[]; next_action?: string[]
  requirements?: string[]; project_background?: string[]; monthly_consumption?: string; quotation?: string[]
  sample_status?: string; timeline?: TimelineItem[]
  customer_summary?: string; customer_background?: string; customer_need?: string; important_notes?: string
  customer_value?: number; customer_tags?: string[]; industry?: string; website?: string; wechat?: string
}

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
