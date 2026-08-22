export type CustomerStage = 'New' | 'Inquiry' | 'Quoted' | 'Sample' | 'Negotiation' | 'Won' | 'Lost' | 'New Inquiry' | 'Technical Discussion' | 'Quotation' | 'Sample Payment' | 'Sample Payment Pending' | 'Technical Testing' | 'Technical Confirmation' | 'Maintain Relationship'

export type Customer = {
  id: string; company_name: string; country: string; contact_person: string; email: string
  whatsapp: string; product_interest: string; customer_stage: CustomerStage; last_contact_date: string
  next_followup_date: string; notes: string; created_at: string
  application?: string; priority?: 'HIGH' | 'MEDIUM HIGH' | 'MEDIUM'; status_label?: string
  status_tone?: 'warning' | 'attention' | 'success'; current_progress?: string[]; next_action?: string[]
  requirements?: string[]; project_background?: string[]; monthly_consumption?: string; quotation?: string[]
  sample_status?: string; timeline?: TimelineItem[]
}

export type Followup = { id: string; customer_id: string; date: string; content: string; next_action: string; status: 'Open' | 'Done' }
export type Product = { id: string; product_name: string; product_code: string; category: string; application: string; description: string; image_url?: string; notes: string }
export type TimelineItem = { date: string; title: string; detail?: string }
export type Project = { id: string; customer_id: string; project_name: string; product_id?: string; product_code?: string; application: string; stage: CustomerStage; notes: string; created_at?: string }
export type Quote = { id: string; customer_id: string; product_id?: string; product_code?: string; quantity: string; amount?: number; currency: string; trade_term?: string; status: string; created_at?: string }
