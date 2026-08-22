import type { Customer, EmailSync, Followup, MailEmail, Product, ProductCustomerRelation, Project, Quote } from './types'

const apiBaseUrl = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://zhiwu-os-api.gjsx.uno' : 'http://localhost:8000')

function token() {
  const value = sessionStorage.getItem('zhiwu-access-token')
  if (!value) throw new Error('登录已失效，请重新登录。')
  return value
}

async function request<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...init.headers },
  })
  if (response.status === 401) {
    // A password reset or expired Supabase session must never leave the UI
    // showing seed/demo data as though the user were still authenticated.
    sessionStorage.removeItem('zhiwu-access-token')
    window.location.reload()
    throw new Error('登录会话已失效，请重新登录。')
  }
  if (!response.ok) throw new Error('保存失败，请稍后重试。')
  return response.json() as Promise<T>
}

async function publicRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  if (!response.ok) throw new Error('请求失败，请稍后重试。')
  return response.json() as Promise<T>
}

const asCustomer = (item: Customer): Customer => ({ ...item, whatsapp: item.whatsapp || '—', product_interest: item.product_interest || '—', last_contact_date: item.last_contact_date || '—', next_followup_date: item.next_followup_date || '—', notes: item.notes || '暂无备注', customer_summary: item.customer_summary || '待补充客户画像。', customer_background: item.customer_background || '待补充客户背景。', customer_need: item.customer_need || item.product_interest || '待确认客户需求。', important_notes: item.important_notes || '暂无特别注意事项。', customer_value: item.customer_value || 3, customer_tags: item.customer_tags || [], industry: item.industry || '待确认行业' })
const asProduct = (item: Product): Product => ({ ...item, category: item.category || '未分类', application: item.application || '—', description: item.description || '暂无描述', notes: item.notes || '' })
const asFollowup = (item: Followup): Followup => ({ ...item, next_action: item.next_action || '安排下一步跟进', status: item.status || 'Open' })
const asProject = (item: Project): Project => ({ ...item, application: item.application || '应用待确认', notes: item.notes || '' })
const asQuote = (item: Quote): Quote => ({ ...item, currency: item.currency || 'USD', quantity: item.quantity || '待确认', status: item.status || 'Draft' })
const asMailEmail = (item: MailEmail): MailEmail => ({ ...item, subject: item.subject || '(无主题)', content_preview: item.content_preview || '', attachment_count: item.attachment_count || 0, status: item.status || 'unread', category: item.category || 'customer_inquiry' })

export const api = {
  customers: () => request<Customer[]>('/api/customers').then(rows => rows.map(asCustomer)),
  createCustomer: (payload: Omit<Customer, 'id' | 'created_at' | 'last_contact_date'>) => request<Customer[]>('/api/customers', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asCustomer(rows[0])),
  products: () => request<Product[]>('/api/products').then(rows => rows.map(asProduct)),
  createProduct: (payload: Omit<Product, 'id'>) => request<Product[]>('/api/products', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asProduct(rows[0])),
  productCustomerRelations: () => request<ProductCustomerRelation[]>('/api/product-customer-relations'),
  linkProductCustomer: (productId: string, customerId: string) => request<ProductCustomerRelation>(`/api/products/${productId}/customers`, { method: 'POST', body: JSON.stringify({ customer_id: customerId }) }),
  updateCustomer: (id: string, payload: Omit<Customer, 'id' | 'created_at' | 'last_contact_date'>) => request<Customer[]>(`/api/customers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then(rows => asCustomer(rows[0])),
  followups: () => request<Followup[]>('/api/followups').then(rows => rows.map(asFollowup)),
  createFollowup: (payload: Omit<Followup, 'id'>) => request<Followup[]>('/api/followups', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asFollowup(rows[0])),
  projects: () => request<Project[]>('/api/projects').then(rows => rows.map(asProject)),
  createProject: (payload: Omit<Project, 'id'>) => request<Project[]>('/api/projects', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asProject(rows[0])),
  quotes: () => request<Quote[]>('/api/quotes').then(rows => rows.map(asQuote)),
  createQuote: (payload: Omit<Quote, 'id'>) => request<Quote[]>('/api/quotes', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asQuote(rows[0])),
  seedDemo: () => request<{ seeded: boolean }>('/api/demo/seed', { method: 'POST' }),
  updatePassword: (password: string, recoveryToken?: string) => recoveryToken
    ? publicRequest<{ updated: boolean }>('/api/auth/update-password', { method: 'POST', headers: { Authorization: `Bearer ${recoveryToken}` }, body: JSON.stringify({ password }) })
    : request<{ updated: boolean }>('/api/auth/update-password', { method: 'POST', body: JSON.stringify({ password }) }),
  requestPasswordRecovery: (email: string) => publicRequest<{ sent: boolean }>('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email }) }),
  emails: () => request<MailEmail[]>('/api/emails').then(rows => rows.map(asMailEmail)),
  unlinkedEmails: () => request<MailEmail[]>('/api/emails/unlinked').then(rows => rows.map(asMailEmail)),
  emailSync: () => request<EmailSync>('/api/email-sync'),
  createFollowupFromEmail: (id: string, payload: { content?: string; next_action?: string }) => request<Followup>(`/api/emails/${id}/followups`, { method: 'POST', body: JSON.stringify(payload) }).then(asFollowup),
  linkEmail: (id: string, payload: { customer_id: string; contact_name?: string }) => request<MailEmail>(`/api/emails/${id}/link`, { method: 'POST', body: JSON.stringify(payload) }).then(asMailEmail),
  updateEmailStatus: (id: string, status: MailEmail['status']) => request<MailEmail>(`/api/emails/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).then(asMailEmail),
}
