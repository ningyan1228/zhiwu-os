import type { Customer, Product } from './types'

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
  if (!response.ok) throw new Error('保存失败，请稍后重试。')
  return response.json() as Promise<T>
}

const asCustomer = (item: Customer): Customer => ({ ...item, whatsapp: item.whatsapp || '—', product_interest: item.product_interest || '—', last_contact_date: item.last_contact_date || '—', next_followup_date: item.next_followup_date || '—', notes: item.notes || '暂无备注' })
const asProduct = (item: Product): Product => ({ ...item, category: item.category || '未分类', application: item.application || '—', description: item.description || '暂无描述', notes: item.notes || '' })

export const api = {
  customers: () => request<Customer[]>('/api/customers').then(rows => rows.map(asCustomer)),
  createCustomer: (payload: Omit<Customer, 'id' | 'created_at' | 'last_contact_date'>) => request<Customer[]>('/api/customers', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asCustomer(rows[0])),
  products: () => request<Product[]>('/api/products').then(rows => rows.map(asProduct)),
  createProduct: (payload: Omit<Product, 'id'>) => request<Product[]>('/api/products', { method: 'POST', body: JSON.stringify(payload) }).then(rows => asProduct(rows[0])),
}
