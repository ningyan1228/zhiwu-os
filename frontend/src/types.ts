export type CustomerStage = 'New' | 'Inquiry' | 'Quoted' | 'Sample' | 'Negotiation' | 'Won' | 'Lost'

export type Customer = {
  id: string; company_name: string; country: string; contact_person: string; email: string
  whatsapp: string; product_interest: string; customer_stage: CustomerStage; last_contact_date: string
  next_followup_date: string; notes: string; created_at: string
}

export type Followup = { id: string; customer_id: string; date: string; content: string; next_action: string; status: 'Open' | 'Done' }
export type Product = { id: string; product_name: string; product_code: string; category: string; application: string; description: string; image_url?: string; notes: string }
