import type { Customer, CustomerLead, DailyLog, EmailSync, Followup, ImportApplyResult, ImportBatch, ImportPreviewResult, LeadDiscoveryRun, LeadSearchTask, MailboxAccount, MailEmail, Product, ProductCustomerRelation, Project, Quote, Supplier, SupplierContact, SupplierDocument, SupplierFollowup, SupplierInsight, SupplierProduct, SupplierProjectLink, SupplierRfq, Task, TimelineEvent, WorkspaceMember } from './types'

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
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || '保存失败，请稍后重试。')
  }
  return response.json() as Promise<T>
}

async function publicRequest<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  if (!response.ok) throw new Error('请求失败，请稍后重试。')
  return response.json() as Promise<T>
}

async function upload<T>(path: string, body: FormData) {
  const response = await fetch(`${apiBaseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail || '文件上传失败，请稍后重试。')
  }
  return response.json() as Promise<T>
}

async function download(path: string, filename: string) {
  const response = await fetch(`${apiBaseUrl}${path}`, { headers: { Authorization: `Bearer ${token()}` } })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail || '导出失败，请稍后重试。')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

const asCustomer = (item: Customer): Customer => ({ ...item, whatsapp: item.whatsapp || '—', product_interest: item.product_interest || '—', last_contact_date: item.last_contact_date || '—', next_followup_date: item.next_followup_date || '—', notes: item.notes || '暂无备注', customer_summary: item.customer_summary || '待补充客户画像。', customer_background: item.customer_background || '待补充客户背景。', customer_need: item.customer_need || item.product_interest || '待确认客户需求。', important_notes: item.important_notes || '暂无特别注意事项。', customer_value: item.customer_value || 3, customer_tags: item.customer_tags || [], industry: item.industry || '待确认行业' })
const asProduct = (item: Product): Product => ({ ...item, category: item.category || '未分类', application: item.application || '—', description: item.description || '暂无描述', notes: item.notes || '' })
const asFollowup = (item: Followup): Followup => ({ ...item, next_action: item.next_action || '安排下一步跟进', status: item.status || 'Open' })
const asProject = (item: Project): Project => ({ ...item, application: item.application || '应用待确认', notes: item.notes || '' })
const asQuote = (item: Quote): Quote => ({ ...item, currency: item.currency || 'USD', quantity: item.quantity || '待确认', status: item.status || 'Draft' })
const asMailEmail = (item: MailEmail): MailEmail => ({ ...item, subject: item.subject || '(无主题)', content_preview: item.content_preview || '', attachment_count: item.attachment_count || 0, status: item.status || 'unread', category: item.category || 'customer_inquiry' })
const asTask = (item: Task): Task => ({ ...item, description: item.description || '', start_time: item.start_time || null, end_time: item.end_time || null, status: item.status || 'Pending', category: item.category || '外贸', priority: item.priority || 'normal' })

export const api = {
  customers: () => request<Customer[]>('/api/customers').then(rows => rows.map(asCustomer)),
  workspaceMembers: () => request<WorkspaceMember[]>('/api/workspace-members'),
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
  updateProject: (id: string, payload: Omit<Project, 'id' | 'customer_id' | 'created_at'>) => request<Project[]>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }).then(rows => asProject(rows[0])),
  quotes: () => request<Quote[]>('/api/quotes').then(rows => rows.map(asQuote)),
  createQuote: (payload: Omit<Quote, 'id'>) => request<Quote[]>('/api/quotes', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asQuote(rows[0])),
  suppliers: () => request<Supplier[]>('/api/suppliers?limit=500'),
  supplierInsights: () => request<SupplierInsight[]>('/api/supplier-insights'),
  createSupplier: (payload: Omit<Supplier, 'id' | 'created_at'>) => request<Supplier>('/api/suppliers', { method: 'POST', body: JSON.stringify(payload) }),
  updateSupplier: (id: string, payload: Omit<Supplier, 'id' | 'created_at'>) => request<Supplier>(`/api/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  supplierContacts: (supplierId: string) => request<SupplierContact[]>(`/api/suppliers/${supplierId}/contacts`),
  createSupplierContact: (payload: Omit<SupplierContact, 'id' | 'created_at'>) => request<SupplierContact>('/api/supplier-contacts', { method: 'POST', body: JSON.stringify(payload) }),
  supplierProducts: (supplierId: string) => request<SupplierProduct[]>(`/api/suppliers/${supplierId}/products`),
  createSupplierProduct: (payload: Omit<SupplierProduct, 'id' | 'created_at'>) => request<SupplierProduct>('/api/supplier-products', { method: 'POST', body: JSON.stringify(payload) }),
  supplierFollowups: (supplierId: string) => request<SupplierFollowup[]>(`/api/suppliers/${supplierId}/followups`),
  createSupplierFollowup: (payload: Omit<SupplierFollowup, 'id' | 'created_at'> & { create_task: boolean }) => request<{ followup: SupplierFollowup; supplier: Supplier; task: Task | null }>('/api/supplier-followups', { method: 'POST', body: JSON.stringify(payload) }),
  supplierProjectLinks: (filters: { project_id?: string; supplier_id?: string } = {}) => { const params = new URLSearchParams(filters as Record<string, string>); return request<SupplierProjectLink[]>(`/api/supplier-project-links${params.size ? `?${params}` : ''}`) },
  createSupplierProjectLink: (payload: Omit<SupplierProjectLink, 'id' | 'created_at'>) => request<SupplierProjectLink>('/api/supplier-project-links', { method: 'POST', body: JSON.stringify(payload) }),
  supplierRfqs: (filters: { supplier_id?: string; project_id?: string } = {}) => { const params = new URLSearchParams(filters as Record<string, string>); return request<SupplierRfq[]>(`/api/supplier-rfqs${params.size ? `?${params}` : ''}`) },
  createSupplierRfq: (payload: Omit<SupplierRfq, 'id' | 'rfq_number' | 'created_date' | 'created_at'>) => request<SupplierRfq>('/api/supplier-rfqs', { method: 'POST', body: JSON.stringify(payload) }),
  supplierDocuments: (supplierId: string) => request<SupplierDocument[]>(`/api/suppliers/${supplierId}/documents`),
  uploadSupplierDocument: (payload: { supplier_id: string; document_type: SupplierDocument['document_type']; file: File; supplier_product_id?: string; project_id?: string; rfq_id?: string; source?: string; internal_notes?: string }) => { const form = new FormData(); Object.entries(payload).forEach(([key, value]) => { if (value !== undefined && value !== null) form.append(key, value as string | Blob) }); return upload<SupplierDocument>('/api/supplier-documents', form) },
  supplierDocumentPreview: (documentId: string) => request<{ url: string; file_name: string; mime_type?: string | null }>(`/api/supplier-documents/${documentId}/preview`),
  seedDemo: () => request<{ seeded: boolean }>('/api/demo/seed', { method: 'POST' }),
  updatePassword: (password: string, recoveryToken?: string) => recoveryToken
    ? publicRequest<{ updated: boolean }>('/api/auth/update-password', { method: 'POST', headers: { Authorization: `Bearer ${recoveryToken}` }, body: JSON.stringify({ password }) })
    : request<{ updated: boolean }>('/api/auth/update-password', { method: 'POST', body: JSON.stringify({ password }) }),
  requestPasswordRecovery: (email: string) => publicRequest<{ sent: boolean }>('/api/auth/recover', { method: 'POST', body: JSON.stringify({ email }) }),
  // The Mail Center metrics must reflect the full mailbox rather than the
  // API's old first-page default of 100 records.
  emails: () => request<MailEmail[]>('/api/emails?limit=500').then(rows => rows.map(asMailEmail)),
  mailbox: () => request<MailboxAccount>('/api/mailbox'),
  unlinkedEmails: () => request<MailEmail[]>('/api/emails/unlinked').then(rows => rows.map(asMailEmail)),
  emailSync: () => request<EmailSync>('/api/email-sync'),
  createFollowupFromEmail: (id: string, payload: { content?: string; next_action?: string }) => request<Followup>(`/api/emails/${id}/followups`, { method: 'POST', body: JSON.stringify(payload) }).then(asFollowup),
  updateCrmFromEmail: (id: string, payload: { customer_id: string; project_id?: string; product_id?: string; customer_stage: Customer['customer_stage']; next_action: string; followup_date: string; notes: string; create_task: boolean; task_date?: string }) => request<{ email: MailEmail; customer: Customer; project: Project | null; followup: Followup; task: Task | null }>(`/api/emails/${id}/update-crm`, { method: 'POST', body: JSON.stringify(payload) }).then(result => ({ ...result, email: asMailEmail(result.email), customer: asCustomer(result.customer), project: result.project ? asProject(result.project) : null, followup: asFollowup(result.followup), task: result.task ? asTask(result.task) : null })),
  linkEmail: (id: string, payload: { customer_id: string; contact_name?: string }) => request<MailEmail>(`/api/emails/${id}/link`, { method: 'POST', body: JSON.stringify(payload) }).then(asMailEmail),
  createCustomerFromEmail: (id: string, payload: Omit<Customer, 'id' | 'created_at' | 'last_contact_date'>) => request<{ customer: Customer; email: MailEmail }>(`/api/emails/${id}/customers`, { method: 'POST', body: JSON.stringify(payload) }).then(result => ({ customer: asCustomer(result.customer), email: asMailEmail(result.email) })),
  updateEmailStatus: (id: string, status: MailEmail['status']) => request<MailEmail>(`/api/emails/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).then(asMailEmail),
  tasks: (filters: { task_date?: string; from_date?: string; to_date?: string } = {}) => {
    const params = new URLSearchParams(filters as Record<string, string>)
    return request<Task[]>(`/api/tasks${params.size ? `?${params}` : ''}`).then(rows => rows.map(asTask))
  },
  createTask: (payload: Omit<Task, 'id' | 'created_at' | 'completed_at'>) => request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }).then(asTask),
  updateTaskStatus: (id: string, status: Task['status']) => request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }).then(asTask),
  leadSearchTasks: () => request<LeadSearchTask[]>('/api/lead-search-tasks'),
  createLeadSearchTask: (payload: Omit<LeadSearchTask, 'id' | 'user_id' | 'last_run_at' | 'last_run_status' | 'last_error' | 'created_at'>) => request<LeadSearchTask>('/api/lead-search-tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateLeadSearchTask: (id: string, payload: Omit<LeadSearchTask, 'id' | 'user_id' | 'last_run_at' | 'last_run_status' | 'last_error' | 'created_at'>) => request<LeadSearchTask>(`/api/lead-search-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  runLeadSearchTask: (id: string) => request<{ run_id?: string; status: string; message: string }>(`/api/lead-search-tasks/${id}/run`, { method: 'POST' }),
  runEnabledLeadSearchTasks: () => request<{ status: string; message: string }>('/api/lead-search-tasks/run-enabled', { method: 'POST' }),
  customerLeads: () => request<CustomerLead[]>('/api/customer-leads'),
  exportStrictCustomerLeads: () => download('/api/customer-leads/strict-export', '严格客户名单.xlsx'),
  leadDiscoveryRuns: () => request<LeadDiscoveryRun[]>('/api/lead-discovery-runs'),
  reviewCustomerLead: (id: string, payload: { status: CustomerLead['status']; exclusion_reason?: string; notes?: string; watchlisted?: boolean }) => request<CustomerLead>(`/api/customer-leads/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  createDevelopmentTaskFromLead: (id: string, payload: { priority: Task['priority']; task_date: string; suggested_next_action?: string }) => request<Task>(`/api/customer-leads/${id}/development-task`, { method: 'POST', body: JSON.stringify(payload) }).then(asTask),
  convertCustomerLead: (id: string, payload: { email?: string; contact_person?: string; country?: string; product_interest?: string; application?: string; priority?: Customer['priority']; next_action?: string; next_followup_date?: string; notes?: string; customer_id?: string }) => request<{ customer: Customer; action: 'created' | 'updated' }>(`/api/customer-leads/${id}/convert`, { method: 'POST', body: JSON.stringify(payload) }).then(result => ({ ...result, customer: asCustomer(result.customer) })),
  dailyLog: (day: string) => request<DailyLog | null>(`/api/daily-logs?log_date=${encodeURIComponent(day)}`),
  saveDailyLog: (day: string, payload: Omit<DailyLog, 'id' | 'log_date' | 'created_at' | 'updated_at'>) => request<DailyLog>(`/api/daily-logs/${day}`, { method: 'PUT', body: JSON.stringify(payload) }),
  timeline: (filters: { event_date?: string; from_date?: string; to_date?: string } = {}) => {
    const params = new URLSearchParams(filters as Record<string, string>)
    return request<TimelineEvent[]>(`/api/timeline${params.size ? `?${params}` : ''}`)
  },
  imports: () => request<ImportBatch[]>('/api/imports'),
  previewImport: (payload: Record<string, unknown>) => request<ImportPreviewResult>('/api/imports/preview', { method: 'POST', body: JSON.stringify({ payload }) }),
  applyImport: (id: string, payload: { confirm_company_match: boolean; selected_customer_id?: string }) => request<ImportApplyResult | Record<string, unknown>>(`/api/imports/${id}/apply`, { method: 'POST', body: JSON.stringify(payload) }).then(result => 'customer' in result && result.customer ? ({ ...result, customer: asCustomer(result.customer as Customer), project: result.project ? asProject(result.project as Project) : null, products: Array.isArray(result.products) ? (result.products as Product[]).map(asProduct) : [], followup: result.followup ? asFollowup(result.followup as Followup) : null, task: result.task ? asTask(result.task as Task) : null }) : result),
  revertImport: (id: string) => request<{ batch_id: string; reverted_effects: number; message: string }>(`/api/imports/${id}/revert`, { method: 'POST' }),
}
