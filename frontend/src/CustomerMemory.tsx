import { followupAssessment, customerPlan, latestManualFollowup, effectiveFollowupDate, reminderToday } from './followupModel'
import { useState, type ReactNode } from 'react'
import type { Customer, Project, Product, Followup, MailEmail } from './types'
import './customer-memory.css'

export const chineseStage: Record<string, string> = { New: '新线索', Inquiry: '询盘', Quoted: '已报价', Sample: '寄样中', Negotiation: '谈判中', Won: '已成交', Lost: '已流失', 'New Inquiry': '新询盘', 'Technical Discussion': '技术沟通', Quotation: '报价沟通', 'Sample Payment': '样品付款沟通', 'Sample Payment Pending': '等待样品付款', 'Technical Testing': '技术测试', 'Technical Confirmation': '技术确认', 'Maintain Relationship': '关系维护' }
const countries: Record<string, string> = { 'South Korea': '韩国', 'United States': '美国', India: '印度', Thailand: '泰国', Netherlands: '荷兰', Philippines: '菲律宾', Vietnam: '越南', Indonesia: '印度尼西亚', Brazil: '巴西', Mexico: '墨西哥', Turkey: '土耳其', Germany: '德国', Poland: '波兰', China: '中国' }
export const countryName = (value: string) => countries[value] || value
const glossary: Record<string, string> = { 'Epoxidized Linseed Oil (ELO)': '环氧亚麻油（ELO；CAS 8016-11-3）', ELO: '环氧亚麻油（ELO；CAS 8016-11-3）', ESO: '环氧大豆油（ESO）', 'PHA Fibers': 'PHA 纤维', 'PHA/PLA Biofilament yarn': 'PHA/PLA 生物基长丝纱线', 'PHA filament yarn 75D': 'PHA 长丝纱线 75D', 'PHA latex / emulsion coating': 'PHA 乳液涂层', 'High-barrier compostable bio-plastic resin': '高阻隔可堆肥生物塑料树脂', 'Water-based Barrier Coating': '水性阻隔涂层', 'Food Packaging': '食品包装', 'Paper Cup Barrier Coating': '纸杯阻隔涂层' }
export const readable = (value?: string) => value ? glossary[value] || value : '待补充'
const isDate = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value)))
const todayText = () => reminderToday()
const brief = (value?: string | null, limit = 76) => {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return '尚未记录'
  if (text.startsWith('邮件自动归档：')) return '已归档邮件，原文可在客户 360 查看。'
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
const latestFollowup = (customer: Customer, followups: Followup[]) => latestManualFollowup(customer.id, followups)
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
const customerSchedule=(c:Customer,fs:Followup[])=>followupAssessment(c,fs).dateReview?{text:'跟进日期待核',tone:'review'}:followupTimeLabel(effectiveFollowupDate(c))
type SummaryProps = { customer: Customer; projects: Project[]; products: Product[]; followups: Followup[] }
export function MemorySummary({ customer, projects, products, followups }: SummaryProps) {
  const latest = latestFollowup(customer, followups)
  const useFollowup = latest && (!customer.last_contact_date || latest.date >= customer.last_contact_date)
  const date = useFollowup ? latest.date : customer.last_contact_date
  const validDate = isDate(date)
  const age = validDate ? Math.floor((Date.now() - Date.parse(date)) / 86400000) : null
  const related = projects.filter(item => item.customer_id === customer.id)
  const progress = useFollowup ? brief(latest.content, 180) : brief(customer.current_progress?.join('；') || customer.status_label, 180)
  const nextAction = customerPlan(customer,followups).text

  return <section className="customer-memory-summary" aria-label="客户中文速记">
    <dl>
      <div><dt>关注什么产品</dt><dd>{readable(customer.product_interest)}</dd></div>
      <div><dt>用在哪</dt><dd>{readable(customer.application)}</dd></div>
      <div><dt>最近记录</dt><dd>{progress}<small>{validDate ? date.slice(0, 10) : '记录日期待补充'} · {useFollowup ? '客户跟进记录' : '客户档案'}</small></dd></div>
      <div><dt>下一步计划</dt><dd>{brief(nextAction, 180)}<small>{customerPlan(customer,followups).source}</small>{followupAssessment(customer,followups).dateReview&&<small>跟进日期待核：旧日期后已有人工沟通，请重新核对安排。</small>}<small>跟进日期：{effectiveFollowupDate(customer) || '未设置或已关闭'}</small></dd></div>
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
type MemoryCRMProps = { actions?: ReactNode; customers: Customer[]; projects: Project[]; products: Product[]; followups: Followup[]; emails: MailEmail[]; open: (customer: Customer) => void; create: () => void; addFollowup: (customer: Customer) => void }
export function MemoryCRM({ customers, projects, products, followups, emails, open, create, addFollowup, actions }: MemoryCRMProps) {
  const storageKey = `zhiwu-customer-memory:${sessionStorage.getItem('zhiwu-account-email') || 'local'}`
  const [preferences, setPreferences] = useState<Preferences>(() => { try { return JSON.parse(localStorage.getItem(storageKey) || '{}') } catch { return {} } })
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'next' | 'recent' | 'stale'>('next')
  const [page, setPage] = useState(1)
  const [filter,setFilter] = useState<'all'|'overdue'|'today'|'unset'|'review'>('all')
  const pageSize = 12
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
    const nextA = effectiveFollowupDate(a) || '9999-12-31'
    const nextB = effectiveFollowupDate(b) || '9999-12-31'
    return nextA.localeCompare(nextB) || (recentA || '0000-00-00').localeCompare(recentB || '0000-00-00')
  }
  const visible = customers.filter(customer => filter==='all'||customerSchedule(customer,followups).tone===filter).filter(customer => `${preferences[customer.id]?.alias || ''} ${defaultMemoryName(customer, emails)} ${customer.company_name} ${countryName(customer.country)} ${customer.contact_person} ${readable(customer.product_interest)} ${readable(customer.application)} ${projects.filter(item => item.customer_id === customer.id).map(item => `${item.product_code || ''} ${readable(item.application)} ${item.project_name}`).join(' ')}`.toLowerCase().includes(query.toLowerCase())).sort(compare)
  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageCustomers = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const overdue=customers.filter(c=>customerSchedule(c,followups).tone==='overdue').length
  const today=customers.filter(c=>customerSchedule(c,followups).tone==='today').length
  return <section className="page memory-crm crm-workspace">
    <div className="crm-heading"><div><span className="crm-eyebrow">CUSTOMER WORKSPACE</span><h1>客户管理 <span>{customers.length}</span></h1><p>看清进展，安排下一次沟通。</p></div><div className="crm-heading-actions">{actions}<button className="primary" onClick={create}>＋ 新建客户</button></div></div>
    <div className="crm-workbench">
    <div className="crm-controls"><nav aria-label="客户跟进筛选" className="crm-filters">{([['all','全部客户',customers.length],['overdue','待跟进',overdue],['review','日期待核',customers.filter(c=>customerSchedule(c,followups).tone==='review').length],['today','今天',today],['unset','未排期',customers.filter(c=>!effectiveFollowupDate(c)).length]] as const).map(([id,label,count])=><button key={id} aria-pressed={filter===id} onClick={()=>{setFilter(id);setPage(1)}}>{label}<span>{count}</span></button>)}</nav><div className="crm-tools"><input aria-label="搜索客户" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}} placeholder="搜索客户、联系人或产品…"/><select aria-label="客户排序" value={sortBy} onChange={e=>{setSortBy(e.target.value as typeof sortBy);setPage(1)}}><option value="next">跟进日期 · 最早优先</option><option value="recent">最近更新 · 最新优先</option><option value="stale">最近更新 · 最久优先</option></select></div></div>
    {error&&<p role="alert" className="crm-feedback">{error}</p>}
    <div className="crm-column-head" aria-hidden="true"><span>客户 / 联系人</span><span>产品与阶段</span><span>下一步计划</span><span>跟进安排</span><span>操作</span></div>
    <div className="crm-rows">{pageCustomers.map(customer=>{
      const pref=preferences[customer.id],schedule=customerSchedule(customer,followups),latest=latestFollowup(customer,followups)
      const memoryName=pref?.alias||defaultMemoryName(customer,emails)
      const nextAction=customerPlan(customer,followups).text
      return <article className="crm-client-row" key={customer.id}>
        <div className="crm-identity"><button className="crm-pin" aria-pressed={!!pref?.pinned} aria-label={`${pref?.pinned?'取消置顶':'置顶'} ${customer.company_name}`} onClick={()=>save(customer.id,pref?.alias||'',!pref?.pinned)}>{pref?.pinned?'★':'☆'}</button><div><button className="crm-company" onClick={()=>open(customer)}>{customer.company_name||'未填写公司'}</button><p>{memoryName}</p></div></div>
        <div className="crm-product"><span className="crm-stage">{chineseStage[customer.customer_stage]||customer.customer_stage}</span><p title={readable(customer.product_interest)}>{readable(customer.product_interest)}</p></div>
        <div className="crm-next"><p title={nextAction}>{nextAction||'尚未安排下一步'}</p>{latest&&<span>最近沟通 · {latest.date.slice(0,10)}</span>}</div>
        <div className={`crm-due ${schedule.tone}`}><time>{effectiveFollowupDate(customer)||'未排期'}</time><span>{schedule.tone==='overdue'?schedule.text.split(' · ')[0]:schedule.tone==='today'?'今天跟进':schedule.tone==='unset'?'等待安排':schedule.text.split(' · ')[0]}</span></div>
        <div className="crm-row-actions"><button onClick={()=>addFollowup(customer)}>记进展</button><button aria-label={`修改 ${customer.company_name} 的记忆名`} title="修改记忆名" onClick={()=>setEditing(editing===customer.id?null:customer.id)}>···</button></div>
        {editing===customer.id&&<form className="crm-alias-editor" onSubmit={e=>{e.preventDefault();save(customer.id,String(new FormData(e.currentTarget).get('alias')||'').trim(),!!pref?.pinned)}}><label>显示记忆名<input name="alias" aria-label="显示记忆名" maxLength={60} defaultValue={memoryName}/></label><button type="submit">保存</button>{pref?.alias&&<button type="button" onClick={()=>save(customer.id,'',!!pref?.pinned)}>恢复默认</button>}<button type="button" onClick={()=>setEditing(null)}>取消</button></form>}
      </article>
    })}</div>
    {!visible.length&&<div className="crm-empty"><h2>没有符合条件的客户</h2><p>试试其他关键词，或切换到全部客户。</p><button onClick={()=>{setFilter('all');setQuery('');setPage(1)}}>显示全部客户</button></div>}
    <footer className="crm-list-footer"><span>当前筛选 {visible.length} 位 · 第 {currentPage} / {totalPages} 页</span><nav aria-label="客户分页"><button disabled={currentPage===1} onClick={()=>setPage(Math.max(1,currentPage-1))}>← 上一页</button><button disabled={currentPage===totalPages} onClick={()=>setPage(Math.min(totalPages,currentPage+1))}>下一页 →</button></nav></footer>
    </div><p className="crm-source-note">下一步优先显示最新实际沟通的约定（按沟通日期，同日按录入时间）；没有沟通记录时显示档案计划。补录旧记录不会覆盖新进展。占位日期不计提醒。</p>
  </section>
}
