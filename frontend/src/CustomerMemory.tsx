import { useState } from 'react'
import type { Customer, Project, Product, Followup } from './types'
import './customer-memory.css'

export const chineseStage: Record<string, string> = { New: '新线索', Inquiry: '询盘', Quoted: '已报价', Sample: '寄样中', Negotiation: '谈判中', Won: '已成交', Lost: '已流失', 'New Inquiry': '新询盘', 'Technical Discussion': '技术沟通', Quotation: '报价沟通', 'Sample Payment': '样品付款沟通', 'Sample Payment Pending': '等待样品付款', 'Technical Testing': '技术测试', 'Technical Confirmation': '技术确认', 'Maintain Relationship': '关系维护' }
const countries: Record<string, string> = { 'South Korea': '韩国', 'United States': '美国', India: '印度', Thailand: '泰国', Netherlands: '荷兰', Philippines: '菲律宾', Vietnam: '越南', Indonesia: '印度尼西亚', Brazil: '巴西', Mexico: '墨西哥', Turkey: '土耳其', Germany: '德国', Poland: '波兰', China: '中国' }
export const countryName = (value: string) => countries[value] || value
const glossary: Record<string, string> = { 'Epoxidized Linseed Oil (ELO)': '环氧亚麻籽油（ELO）', ELO: '环氧亚麻籽油（ELO）', ESO: '环氧大豆油（ESO）', 'PHA Fibers': 'PHA 纤维', 'PHA/PLA Biofilament yarn': 'PHA/PLA 生物基长丝纱线', 'PHA filament yarn 75D': 'PHA 长丝纱线 75D', 'PHA latex / emulsion coating': 'PHA 乳液涂层', 'High-barrier compostable bio-plastic resin': '高阻隔可堆肥生物塑料树脂', 'Water-based Barrier Coating': '水性阻隔涂层', 'Food Packaging': '食品包装', 'Paper Cup Barrier Coating': '纸杯阻隔涂层' }
export const readable = (value?: string) => value ? glossary[value] || value : '待补充'
const isDate = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value)))
const todayText = () => new Date().toISOString().slice(0, 10)
const latestRecordDate = (customer: Customer, followups: Followup[]) => {
  const followup = followups.filter(item => item.customer_id === customer.id && isDate(item.date)).sort((a, b) => b.date.localeCompare(a.date))[0]
  return followup && (!isDate(customer.last_contact_date) || followup.date >= customer.last_contact_date!) ? followup.date : customer.last_contact_date || ''
}
const followupTimeLabel = (date?: string | null) => {
  if (!isDate(date) || date === '—') return { text: '未设置跟进日期', tone: 'unset' }
  const gap = Math.round((Date.parse(date!) - Date.parse(todayText())) / 86400000)
  if (gap < 0) return { text: `已逾期 ${Math.abs(gap)} 天 · ${date}`, tone: 'overdue' }
  if (gap === 0) return { text: `今天跟进 · ${date}`, tone: 'today' }
  return { text: `${gap} 天后 · ${date}`, tone: 'upcoming' }
}
type Props = { customer: Customer; projects: Project[]; products: Product[]; followups: Followup[] }
export function MemorySummary({ customer, projects, products, followups }: Props) {
  const latest = followups.filter(item => item.customer_id === customer.id && isDate(item.date)).sort((a,b) => b.date.localeCompare(a.date))[0]
  const useFollowup = latest && (!customer.last_contact_date || latest.date >= customer.last_contact_date)
  const date = useFollowup ? latest.date : customer.last_contact_date
  const validDate = isDate(date)
  const age = validDate ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : null
  const related = projects.filter(item => item.customer_id === customer.id)
  return <section className="customer-memory-summary" aria-label="客户中文速记">
    <dl><div><dt>关注什么产品</dt><dd>{readable(customer.product_interest)}</dd></div><div><dt>用在哪</dt><dd>{readable(customer.application)}</dd></div><div><dt>最近记录</dt><dd>{useFollowup ? latest.content : customer.current_progress?.join('；') || customer.status_label || '尚未记录进展'}<small>{validDate ? date.slice(0,10) : '记录日期待补充'} · {useFollowup ? '客户跟进记录' : '客户档案'}</small></dd></div><div><dt>下一步做什么</dt><dd>{(useFollowup ? latest.next_action : customer.next_action?.join('；')) || '尚未记录下一步'}<small>跟进日期：{customer.next_followup_date && customer.next_followup_date !== '—' ? customer.next_followup_date : '未设置'}</small></dd></div></dl>
    {(age === null || age >= 30) && <p className="memory-age">{age === null ? '进展日期待补充' : `这条记录距今 ${age} 天`}，当前情况需要重新确认。</p>}
    {related.length > 0 && <details className="memory-projects" open={related.length > 1}><summary>分别查看 {related.length} 个项目的产品与进展</summary>{related.map(project => { const product = products.find(item => project.product_id ? item.id === project.product_id : Boolean(project.product_code) && item.product_code === project.product_code); return <article key={project.id}><b>{product ? `${product.product_code} · ${readable(product.product_name)}` : project.product_code || '产品待关联'}</b><span>{chineseStage[project.stage] || project.stage}</span><p>{readable(project.application)}</p><p>{project.notes || '尚未记录项目进展'}</p><small>原项目：{project.project_name} · 项目进展更新时间未记录</small></article> })}</details>}
  </section>
}
type Preferences = Record<string, { alias: string; pinned: boolean }>
export function MemoryCRM({ customers, projects, products, followups, open, create, addFollowup }: { customers: Customer[]; projects: Project[]; products: Product[]; followups: Followup[]; open: (customer: Customer) => void; create: () => void; addFollowup: (customer: Customer) => void }) {
  const storageKey = `zhiwu-customer-memory:${sessionStorage.getItem('zhiwu-account-email') || 'local'}`
  const [preferences, setPreferences] = useState<Preferences>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { return {} } })
  const [query,setQuery] = useState('')
  const [error,setError] = useState('')
  const [editing,setEditing] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'next' | 'recent' | 'stale'>('next')
  const save = (id: string, alias: string, pinned: boolean) => { const next = { ...preferences, [id]: { alias, pinned } }; try { localStorage.setItem(storageKey, JSON.stringify(next)); setPreferences(next); setEditing(null); setError('') } catch { setError('浏览器未能保存记忆名，请检查存储空间后重试。') } }
  const compare = (a: Customer, b: Customer) => {
    const pinned = Number(Boolean(preferences[b.id]?.pinned)) - Number(Boolean(preferences[a.id]?.pinned))
    if (pinned) return pinned
    const recentA = latestRecordDate(a, followups), recentB = latestRecordDate(b, followups)
    if (sortBy === 'recent') return (recentB || '0000-00-00').localeCompare(recentA || '0000-00-00')
    if (sortBy === 'stale') return (recentA || '0000-00-00').localeCompare(recentB || '0000-00-00')
    const nextA = isDate(a.next_followup_date) ? a.next_followup_date : '9999-12-31'
    const nextB = isDate(b.next_followup_date) ? b.next_followup_date : '9999-12-31'
    return nextA.localeCompare(nextB) || (recentA || '0000-00-00').localeCompare(recentB || '0000-00-00')
  }
  const visible = customers.filter(customer => `${preferences[customer.id]?.alias || ''} ${customer.company_name} ${countryName(customer.country)} ${customer.contact_person} ${readable(customer.product_interest)} ${readable(customer.application)} ${projects.filter(p=>p.customer_id===customer.id).map(p=>`${p.product_code || ''} ${readable(p.application)} ${p.project_name}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort(compare)
  return <section className="page memory-crm"><div className="page-heading"><div><h1>客户速记</h1><p>认客户、看产品、回顾进展。默认把最早要跟进的客户排在前面。</p></div><button className="primary" onClick={create}>新建客户</button></div><div className="memory-toolbar"><label className="memory-search">查找客户<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="输入中文记忆名、国家、产品或型号"/></label><label className="memory-sort">排序方式<select value={sortBy} onChange={event => setSortBy(event.target.value as typeof sortBy)}><option value="next">下次跟进：最早优先</option><option value="recent">最近进展：最新优先</option><option value="stale">最近进展：最久未更新优先</option></select></label></div><p>共 {customers.length} 位客户 · 显示 {visible.length} 位 · 已置顶客户始终优先；记忆名和置顶仅保存在当前浏览器。</p>{error && <p role="alert">{error}</p>}<div className="memory-grid">{visible.map(customer=> { const pref=preferences[customer.id]; const schedule=followupTimeLabel(customer.next_followup_date); return <article className="memory-customer" key={customer.id}><header><div><small>{countryName(customer.country)} · {customer.contact_person || '联系人待补充'}</small><h2>{pref?.alias || customer.company_name}</h2>{pref?.alias && <small>{customer.company_name}</small>}</div><button aria-label={`${pref?.pinned ? '取消置顶' : '置顶'} ${customer.company_name}`} onClick={()=>save(customer.id,pref?.alias || '',!pref?.pinned)}>{pref?.pinned ? '★ 已置顶' : '☆ 置顶'}</button></header><p className={`memory-schedule ${schedule.tone}`}>时间安排：{schedule.text}</p><button className="memory-alias-button" onClick={()=>setEditing(customer.id)}>设置中文记忆名</button>{editing===customer.id && <form onSubmit={e=> { e.preventDefault(); save(customer.id,String(new FormData(e.currentTarget).get('alias') || '').trim(),Boolean(pref?.pinned)) }}><input autoFocus aria-label="中文记忆名" name="alias" maxLength={60} defaultValue={pref?.alias || ''} placeholder="用你自己记得住的称呼"/><button>保存</button><button type="button" onClick={()=>setEditing(null)}>取消</button></form>}<p className="memory-stage">档案阶段：{chineseStage[customer.customer_stage] || customer.customer_stage}</p><MemorySummary customer={customer} projects={projects} products={products} followups={followups}/><footer><button className="primary" onClick={()=>open(customer)}>客户 360 · 看详细记录</button><button onClick={()=>addFollowup(customer)}>记录新进展</button></footer></article> })}</div>{!visible.length && <p>没有找到符合搜索条件的客户。</p>}</section>
}
