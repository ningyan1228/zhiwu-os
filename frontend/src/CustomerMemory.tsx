import { useState } from 'react'
import type { Customer, Project, Product, Followup, MailEmail } from './types'
import './customer-memory.css'

export const chineseStage: Record<string, string> = { New: '新线索', Inquiry: '询盘', Quoted: '已报价', Sample: '寄样中', Negotiation: '谈判中', Won: '已成交', Lost: '已流失', 'New Inquiry': '新询盘', 'Technical Discussion': '技术沟通', Quotation: '报价沟通', 'Sample Payment': '样品付款沟通', 'Sample Payment Pending': '等待样品付款', 'Technical Testing': '技术测试', 'Technical Confirmation': '技术确认', 'Maintain Relationship': '关系维护' }
const countries: Record<string, string> = { 'South Korea': '韩国', 'United States': '美国', India: '印度', Thailand: '泰国', Netherlands: '荷兰', Philippines: '菲律宾', Vietnam: '越南', Indonesia: '印度尼西亚', Brazil: '巴西', Mexico: '墨西哥', Turkey: '土耳其', Germany: '德国', Poland: '波兰', China: '中国' }
export const countryName = (value: string) => countries[value] || value
const glossary: Record<string, string> = { 'Epoxidized Linseed Oil (ELO)': '环氧亚麻籽油（ELO）', ELO: '环氧亚麻籽油（ELO）', ESO: '环氧大豆油（ESO）', 'PHA Fibers': 'PHA 纤维', 'PHA/PLA Biofilament yarn': 'PHA/PLA 生物基长丝纱线', 'PHA filament yarn 75D': 'PHA 长丝纱线 75D', 'PHA latex / emulsion coating': 'PHA 乳液涂层', 'High-barrier compostable bio-plastic resin': '高阻隔可堆肥生物塑料树脂', 'Water-based Barrier Coating': '水性阻隔涂层', 'Food Packaging': '食品包装', 'Paper Cup Barrier Coating': '纸杯阻隔涂层' }
export const readable = (value?: string) => value ? glossary[value] || value : '待补充'
const isDate = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value)))
const todayText = () => new Date().toISOString().slice(0, 10)
const brief = (value?: string | null, limit = 76) => {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return '尚未记录'
  if (text.startsWith('邮件自动归档：')) return '已归档邮件，原文可在客户 360 查看。'
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
const latestFollowup = (customer: Customer, followups: Followup[]) => followups.filter(item => item.customer_id === customer.id && isDate(item.date)).sort((a, b) => b.date.localeCompare(a.date))[0]
const latestRecordDate = (customer: Customer, followups: Followup[]) => {
  const followup = latestFollowup(customer, followups)
  return followup && (!isDate(customer.last_contact_date) || followup.date >= customer.last_contact_date!) ? followup.date : customer.last_contact_date || ''
}
const followupTimeLabel = (date?: string | null) => {
  if (!isDate(date) || date === '—') return { text: '未设置跟进日期', tone: 'unset' }
  const gap = Math.round((Date.parse(date!) - Date.parse(todayText())) / 86400000)
  if (gap < 0) return { text: `已逾期 ${Math.abs(gap)} 天 · ${date}`, tone: 'overdue' }
  if (gap === 0) return { text: `今天跟进 · ${date}`, tone: 'today' }
  return { text: `${gap} 天后 · ${date}`, tone: 'upcoming' }
}
type SummaryProps = { customer: Customer; projects: Project[]; products: Product[]; followups: Followup[] }
export function MemorySummary({ customer, projects, products, followups }: SummaryProps) {
  const latest = latestFollowup(customer, followups)
  const useFollowup = latest && (!customer.last_contact_date || latest.date >= customer.last_contact_date)
  const date = useFollowup ? latest.date : customer.last_contact_date
  const validDate = isDate(date)
  const age = validDate ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : null
  const related = projects.filter(item => item.customer_id === customer.id)
  const progress = useFollowup ? brief(latest.content, 180) : brief(customer.current_progress?.join('；') || customer.status_label, 180)
  const nextAction = useFollowup ? latest.next_action : customer.next_action?.join('；')

  return <section className="customer-memory-summary" aria-label="客户中文速记">
    <dl>
      <div><dt>关注什么产品</dt><dd>{readable(customer.product_interest)}</dd></div>
      <div><dt>用在哪</dt><dd>{readable(customer.application)}</dd></div>
      <div><dt>最近记录</dt><dd>{progress}<small>{validDate ? date.slice(0, 10) : '记录日期待补充'} · {useFollowup ? '客户跟进记录' : '客户档案'}</small></dd></div>
      <div><dt>下一步做什么</dt><dd>{brief(nextAction, 180)}<small>跟进日期：{customer.next_followup_date && customer.next_followup_date !== '—' ? customer.next_followup_date : '未设置'}</small></dd></div>
    </dl>
    {(age === null || age >= 30) && <p className="memory-age">{age === null ? '进展日期待补充' : `这条记录距今 ${age} 天`}，当前情况需要重新确认。</p>}
    {related.length > 0 && <details className="memory-projects" open={related.length > 1}><summary>分别查看 {related.length} 个项目的产品与进展</summary>{related.map(project => {
      const product = products.find(item => project.product_id ? item.id === project.product_id : Boolean(project.product_code) && item.product_code === project.product_code)
      return <article key={project.id}><b>{product ? `${product.product_code} · ${readable(product.product_name)}` : project.product_code || '产品待关联'}</b><span>{chineseStage[project.stage] || project.stage}</span><p>{readable(project.application)}</p><p>{brief(project.notes, 180)}</p><small>原项目：{project.project_name}</small></article>
    })}</details>}
  </section>
}

type Preferences = Record<string, { alias: string; pinned: boolean }>
const senderNameFromMail = (mail: MailEmail) => mail.sender_name?.trim() || ''
const defaultMemoryName = (customer: Customer, emails: MailEmail[]) => {
  const senderName = emails.filter(mail => mail.customer_id === customer.id && !mail.is_internal_sender).sort((a, b) => (b.received_at || '').localeCompare(a.received_at || '')).map(senderNameFromMail).find(Boolean)
  return `${countryName(customer.country || '地区待确认')} · ${senderName || customer.contact_person?.trim() || '联系人待补充'}`
}
type MemoryCRMProps = { customers: Customer[]; projects: Project[]; products: Product[]; followups: Followup[]; emails: MailEmail[]; open: (customer: Customer) => void; create: () => void; addFollowup: (customer: Customer) => void }
export function MemoryCRM({ customers, projects, products, followups, emails, open, create, addFollowup }: MemoryCRMProps) {
  const storageKey = `zhiwu-customer-memory:${sessionStorage.getItem('zhiwu-account-email') || 'local'}`
  const [preferences, setPreferences] = useState<Preferences>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { return {} } })
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'next' | 'recent' | 'stale'>('next')
  const [page, setPage] = useState(1)
  const pageSize = 6
  const save = (id: string, alias: string, pinned: boolean) => {
    const next = { ...preferences, [id]: { alias, pinned } }
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setPreferences(next); setEditing(null); setError('') } catch { setError('浏览器未能保存记忆名，请检查存储空间后重试。') }
  }
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
  const visible = customers.filter(customer => `${preferences[customer.id]?.alias || ''} ${defaultMemoryName(customer, emails)} ${customer.company_name} ${countryName(customer.country)} ${customer.contact_person} ${readable(customer.product_interest)} ${readable(customer.application)} ${projects.filter(item => item.customer_id === customer.id).map(item => `${item.product_code || ''} ${readable(item.application)} ${item.project_name}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort(compare)
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageCustomers = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  return <section className="page memory-crm">
    <div className="page-heading"><div><h1>客户速记</h1><p>默认只看最重要的信息；完整邮件和全部历史请进入客户 360。</p></div><button className="primary" onClick={create}>新建客户</button></div>
    <div className="memory-toolbar"><label className="memory-search">查找客户<input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="输入中文记忆名、国家、产品或型号"/></label><label className="memory-sort">排序方式<select value={sortBy} onChange={event => { setSortBy(event.target.value as typeof sortBy); setPage(1) }}><option value="next">下次跟进：最早优先</option><option value="recent">最近进展：最新优先</option><option value="stale">最近进展：最久未更新优先</option></select></label></div>
    <p>共 {customers.length} 位客户 · 当前显示第 {currentPage}/{totalPages} 页的 {pageCustomers.length} 位 · 每页 6 位；默认记忆名来自国家和客户邮件发件人。</p>
    {error && <p role="alert">{error}</p>}
    <div className="memory-grid">{pageCustomers.map(customer => {
      const pref = preferences[customer.id]
      const schedule = followupTimeLabel(customer.next_followup_date)
      const defaultName = defaultMemoryName(customer, emails)
      const memoryName = pref?.alias || defaultName
      const latest = latestFollowup(customer, followups)
      const useFollowup = latest && (!customer.last_contact_date || latest.date >= customer.last_contact_date)
      const nextAction = useFollowup ? latest.next_action : customer.next_action?.join('；')
      return <article className="memory-customer" key={customer.id}>
        <header><div><small>{customer.company_name}</small><h2>{memoryName}</h2><small>{pref?.alias ? `默认：${defaultName}` : '默认名称：国家 · 邮件发件人'}</small></div><button aria-label={`${pref?.pinned ? '取消置顶' : '置顶'} ${customer.company_name}`} onClick={() => save(customer.id, pref?.alias || '', !pref?.pinned)}>{pref?.pinned ? '★ 已置顶' : '☆ 置顶'}</button></header>
        <p className={`memory-schedule ${schedule.tone}`}>时间安排：{schedule.text}</p>
        <div className="memory-quick-facts"><div><small>档案阶段</small><b>{chineseStage[customer.customer_stage] || customer.customer_stage}</b></div><div><small>关注产品</small><b>{readable(customer.product_interest)}</b></div><div><small>下一步</small><b>{brief(nextAction, 54)}</b></div></div>
        {editing === customer.id ? <form className="memory-alias-form" onSubmit={event => { event.preventDefault(); save(customer.id, String(new FormData(event.currentTarget).get('alias') || '').trim(), Boolean(pref?.pinned)) }}><input autoFocus aria-label="中文记忆名" name="alias" maxLength={60} defaultValue={memoryName}/><button>保存</button>{pref?.alias && <button type="button" onClick={() => save(customer.id, '', Boolean(pref?.pinned))}>恢复默认</button>}<button type="button" onClick={() => setEditing(null)}>取消</button></form> : <button className="memory-alias-button" onClick={() => setEditing(customer.id)}>修改中文记忆名</button>}
        <details className="memory-more"><summary>展开更多（最近记录、项目）</summary><MemorySummary customer={customer} projects={projects} products={products} followups={followups}/></details>
        <footer><button className="primary" onClick={() => open(customer)}>客户 360</button><button onClick={() => addFollowup(customer)}>记录进展</button></footer>
      </article>
    })}</div>
    {!visible.length && <p>没有找到符合搜索条件的客户。</p>}
    {visible.length > pageSize && <nav className="memory-pagination" aria-label="客户分页"><button disabled={currentPage === 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</button>{Array.from({ length: totalPages }, (_, index) => index + 1).map(value => <button key={value} className={value === currentPage ? 'active' : ''} aria-current={value === currentPage ? 'page' : undefined} onClick={() => setPage(value)}>{value}</button>)}<button disabled={currentPage === totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))}>下一页</button></nav>}
  </section>
}
