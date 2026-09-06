import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleDotDashed, Clock3, FileText, Mail, Map as MapIcon, Package, Search, Users } from 'lucide-react'
import type { Customer, Followup, MailEmail, Product, Project, Task, TimelineEvent } from './types'
import { chineseStage, countryName, readable } from './CustomerMemory'
import './business-map.css'

type MapTab = 'customer' | 'product' | 'time'
type EvidenceKind = 'email' | 'followup' | 'project' | 'timeline' | 'task'
type Evidence = {
  id: string
  kind: EvidenceKind
  date: string
  title: string
  detail: string
  customer: Customer
  project?: Project
  email?: MailEmail
  task?: Task
}
type BusinessLine = {
  id: string
  customer: Customer
  project?: Project
  product?: Product
  productLabel: string
  application: string
  progress: string
  nextAction: string
  nextDate: string
  evidence: Evidence[]
}

const today = () => new Date().toISOString().slice(0, 10)
const validDate = (value?: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}/.test(value))
const displayDate = (value?: string | null) => validDate(value) ? value!.slice(0, 10) : '日期待补充'
const clean = (value?: string | null, fallback = '尚未记录') => value && value.trim() ? value.trim() : fallback
const kindLabel: Record<EvidenceKind, string> = { email: '邮件事实', followup: '手动跟进', project: '项目记录', timeline: '系统时间线', task: '待办提醒' }

function dateStatus(value?: string | null) {
  if (!validDate(value)) return { label: '未设置跟进日', tone: 'unset' }
  const difference = Math.round((Date.parse(value!) - Date.parse(today())) / 86400000)
  if (difference < 0) return { label: `已逾期 ${Math.abs(difference)} 天`, tone: 'overdue' }
  if (difference === 0) return { label: '今天要跟进', tone: 'today' }
  return { label: `${difference} 天后跟进`, tone: 'upcoming' }
}

function productFor(customer: Customer, project: Project | undefined, products: Product[]) {
  return products.find(product => product.id === project?.product_id || product.product_code === project?.product_code || product.product_code === customer.product_interest)
}

function latestFollowup(customer: Customer, followups: Followup[]) {
  return followups.filter(item => item.customer_id === customer.id).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
}

function sourceIcon(kind: EvidenceKind) {
  if (kind === 'email') return <Mail size={15}/>
  if (kind === 'followup') return <FileText size={15}/>
  if (kind === 'task') return <CalendarClock size={15}/>
  if (kind === 'project') return <CircleDotDashed size={15}/>
  return <Clock3 size={15}/>
}

function EvidenceList({ evidence, openEmail, openCustomer, openProject }: { evidence: Evidence[]; openEmail: (email: MailEmail) => void; openCustomer: (customer: Customer) => void; openProject: (project: Project) => void }) {
  const ordered = [...evidence].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 12)
  if (!ordered.length) return <p className="map-empty">尚未关联邮件、项目或手动跟进记录；请补充后再判断当前进度。</p>
  return <ol className="map-evidence-list">
    {ordered.map(item => <li key={`${item.kind}-${item.id}`}>
      <span className={`map-evidence-icon ${item.kind}`}>{sourceIcon(item.kind)}</span>
      <div><div className="map-evidence-title"><b>{item.title}</b><time>{displayDate(item.date)}</time></div><p>{item.detail}</p><small>{kindLabel[item.kind]} · {item.kind === 'email' ? (item.email?.is_internal_sender ? '我方已发/内部归档邮件' : '客户来信') : '仅作记录依据，不等于客户确认'}</small></div>
      {item.email ? <button onClick={() => openEmail(item.email!)}>看邮件</button> : item.project ? <button onClick={() => openProject(item.project!)}>看项目</button> : <button onClick={() => openCustomer(item.customer)}>看客户</button>}
    </li>)}
  </ol>
}

function LineFacts({ line, onEvidence }: { line: BusinessLine; onEvidence: () => void }) {
  const due = dateStatus(line.nextDate)
  return <>
    <div className="map-fact-grid">
      <div><small>谁</small><b>{line.customer.company_name}</b><span>{countryName(line.customer.country)} · {line.customer.contact_person || '联系人待补充'}</span></div>
      <div><small>要什么产品</small><b>{line.productLabel}</b><span>{line.project ? `项目：${line.project.project_name}` : '来源：客户档案'}</span></div>
      <div><small>用在哪</small><b>{line.application}</b><span>阶段：{chineseStage[line.project?.stage || line.customer.customer_stage] || line.project?.stage || line.customer.customer_stage}</span></div>
      <div className="map-risk"><small>现在卡在哪里</small><b>{line.progress}</b><button onClick={onEvidence}><FileText size={14}/> 查看证据 {line.evidence.length}</button></div>
      <div className="map-next"><small>下一步做什么</small><b>{line.nextAction}</b><span className={`map-due ${due.tone}`}>{due.label} · {displayDate(line.nextDate)}</span></div>
    </div>
  </>
}

export function BusinessMap({ customers, products, projects, followups, emails, tasks, timelineEvents, openCustomer, openEmail, openProject }: { customers: Customer[]; products: Product[]; projects: Project[]; followups: Followup[]; emails: MailEmail[]; tasks: Task[]; timelineEvents: TimelineEvent[]; openCustomer: (customer: Customer) => void; openEmail: (email: MailEmail) => void; openProject: (project: Project) => void }) {
  const [tab, setTab] = useState<MapTab>('customer')
  const [query, setQuery] = useState('')
  const [evidenceFilter, setEvidenceFilter] = useState<'all' | EvidenceKind>('all')
  const [focusedLine, setFocusedLine] = useState<BusinessLine | null>(null)

  const lines = useMemo(() => customers.flatMap(customer => {
    const customerProjects = projects.filter(project => project.customer_id === customer.id)
    const units = customerProjects.length ? customerProjects : [undefined]
    return units.map(project => {
      const product = productFor(customer, project, products)
      const productLabel = product ? `${product.product_code} · ${readable(product.product_name)}` : clean(project?.product_code || customer.product_interest, '产品待确认')
      const application = readable(project?.application || customer.application)
      const latest = latestFollowup(customer, followups)
      const linkedEmails = emails.filter(email => email.customer_id === customer.id || Boolean(project && email.project_id === project.id))
      const customerEvents = timelineEvents.filter(event => event.customer_id === customer.id || Boolean(project && event.project_id === project.id))
      const customerTasks = tasks.filter(task => task.customer_id === customer.id || Boolean(project && task.project_id === project.id))
      const evidence: Evidence[] = [
        ...linkedEmails.map(email => ({ id: email.id, kind: 'email' as const, date: email.received_at, title: email.subject || '未命名邮件', detail: clean(email.content_preview || email.content_text, '邮件正文待查看'), customer, project, email })),
        ...followups.filter(item => item.customer_id === customer.id).map(item => ({ id: item.id, kind: 'followup' as const, date: item.date, title: item.content || '客户跟进记录', detail: clean(item.next_action, '尚未记录下一步'), customer, project })),
        ...(project ? [{ id: project.id, kind: 'project' as const, date: project.created_at || '', title: `项目：${project.project_name}`, detail: clean(project.notes, '项目已建立，进展待补充'), customer, project }] : []),
        ...customerEvents.map(event => ({ id: event.id, kind: 'timeline' as const, date: event.event_date, title: event.title, detail: `${event.source || '系统'}记录`, customer, project })),
        ...customerTasks.map(task => ({ id: task.id, kind: 'task' as const, date: task.task_date, title: task.title, detail: task.description || `${task.status === 'Completed' ? '已完成' : '待处理'} · ${task.priority === 'important' ? '重要' : '普通'}任务`, customer, project, task })),
      ]
      const datedFollowup = latest && validDate(latest.date) ? latest : undefined
      const latestEmail = linkedEmails.sort((a, b) => (b.received_at || '').localeCompare(a.received_at || ''))[0]
      const progress = clean(customer.status_label || (datedFollowup?.content && datedFollowup.content) || project?.notes || latestEmail?.content_preview || customer.current_progress?.join('；'), '尚未记录当前卡点')
      const nextAction = clean((datedFollowup?.next_action && datedFollowup.next_action) || customer.next_action?.join('；'), '尚未记录下一步')
      return { id: `${customer.id}:${project?.id || 'profile'}`, customer, project, product, productLabel, application, progress, nextAction, nextDate: customer.next_followup_date || '', evidence }
    })
  }), [customers, products, projects, followups, emails, tasks, timelineEvents])

  const matches = (line: BusinessLine) => `${line.customer.company_name} ${countryName(line.customer.country)} ${line.customer.contact_person} ${line.productLabel} ${line.application} ${line.progress} ${line.nextAction}`.toLowerCase().includes(query.toLowerCase())
  const visibleLines = lines.filter(matches).sort((a, b) => (a.nextDate || '9999-12-31').localeCompare(b.nextDate || '9999-12-31'))
  const evidenceLines = evidenceFilter === 'all' ? visibleLines : visibleLines.map(line => ({ ...line, evidence: line.evidence.filter(item => item.kind === evidenceFilter) })).filter(line => line.evidence.length)
  const totalEvidence = lines.reduce((sum, line) => sum + line.evidence.length, 0)
  const priorityLines = lines.filter(line => validDate(line.nextDate) && line.nextDate <= today()).length
  const groupedProducts = Array.from(new Map(visibleLines.map(line => [line.product?.id || line.productLabel, { label: line.productLabel, product: line.product, lines: visibleLines.filter(candidate => (candidate.product?.id || candidate.productLabel) === (line.product?.id || line.productLabel)) }])).values())
  const chronology = visibleLines.flatMap(line => line.evidence.map(event => ({ ...event, line }))).filter(event => evidenceFilter === 'all' || event.kind === evidenceFilter).sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return <section className="page business-map-page">
    <div className="map-hero">
      <div><p className="eyebrow"><MapIcon size={15}/> TRADE RELATIONSHIP MAP</p><h1>客户—产品生意地图</h1><p>把客户、产品、项目与沟通证据放在同一张图里。先看清楚，再决定下一步。</p></div>
      <aside><b><CheckCircle2 size={17}/> 所有结论均保留来源</b><span>邮件事实、手动跟进和项目记录会明确区分；没有证据的内容只显示“待补充”。</span></aside>
    </div>

    <div className="map-metrics">
      <div><Users/><b>{customers.length}</b><span>客户</span></div><div><Package/><b>{lines.length}</b><span>客户产品线</span></div><div className={priorityLines ? 'attention' : ''}><AlertTriangle/><b>{priorityLines}</b><span>今天/逾期需跟进</span></div><div><FileText/><b>{totalEvidence}</b><span>已关联证据</span></div>
    </div>

    <div className="map-guide"><b>使用方式：</b><span>先选视图，再点“查看证据”。客户说过什么、我方记录过什么、哪个项目在推进，都会展开显示。</span></div>
    <div className="map-tabs" role="tablist" aria-label="生意地图视图">
      <button className={tab === 'customer' ? 'active' : ''} onClick={() => setTab('customer')}><Users size={16}/> 按客户看</button>
      <button className={tab === 'product' ? 'active' : ''} onClick={() => setTab('product')}><Package size={16}/> 按产品看</button>
      <button className={tab === 'time' ? 'active' : ''} onClick={() => setTab('time')}><Clock3 size={16}/> 按时间看</button>
    </div>
    <div className="map-tools">
      <label><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索客户、国家、产品、应用或当前卡点"/></label>
      <select value={evidenceFilter} onChange={event => setEvidenceFilter(event.target.value as 'all' | EvidenceKind)} aria-label="证据来源筛选"><option value="all">全部证据</option><option value="email">只看邮件</option><option value="followup">只看手动跟进</option><option value="project">只看项目记录</option><option value="timeline">只看系统时间线</option><option value="task">只看待办提醒</option></select>
    </div>

    {tab === 'customer' && <div className="map-customer-list">{evidenceLines.map(line => <article className="map-line-card" key={line.id}>
      <header><div><small>{countryName(line.customer.country)} · {line.customer.contact_person || '联系人待补充'}</small><h2>{line.customer.company_name}</h2></div><div className="map-card-actions"><span>{chineseStage[line.project?.stage || line.customer.customer_stage] || line.project?.stage || line.customer.customer_stage}</span><button onClick={() => openCustomer(line.customer)}>客户 360 <ArrowRight size={14}/></button></div></header>
      <LineFacts line={line} onEvidence={() => setFocusedLine(line)}/>
    </article>)}{!evidenceLines.length && <p className="map-empty">没有符合条件的业务线。你可以清除搜索或切换证据来源。</p>}</div>}

    {tab === 'product' && <div className="map-product-list">{groupedProducts.map(group => <article className="map-product-group" key={group.label}><header><div><small>关联客户 {group.lines.length} 位</small><h2>{group.label}</h2><p>{readable(group.product?.application)}</p></div><button onClick={() => group.lines[0] && setFocusedLine(group.lines[0])}>查看产品证据</button></header><div className="map-product-rows">{group.lines.map(line => { const due = dateStatus(line.nextDate); return <button key={line.id} onClick={() => setFocusedLine(line)}><span className={`map-row-dot ${due.tone}`}/><div><b>{line.customer.company_name}</b><small>{countryName(line.customer.country)} · {line.application}</small></div><div><b>{line.progress}</b><small>下一步：{line.nextAction}</small></div><time>{due.label}</time><ArrowRight size={15}/></button>})}</div></article>)}{!groupedProducts.length && <p className="map-empty">没有找到相关产品。</p>}</div>}

    {tab === 'time' && <div className="map-time-layout"><section className="map-time-list"><header><div><small>按最新记录排序</small><h2>业务时间线</h2></div><span>{chronology.length} 条</span></header>{chronology.length ? chronology.map(item => <article key={`${item.kind}-${item.id}`}><time>{displayDate(item.date)}</time><span className={`map-time-icon ${item.kind}`}>{sourceIcon(item.kind)}</span><div><small>{item.line.customer.company_name} · {item.line.productLabel}</small><b>{item.title}</b><p>{item.detail}</p><em>{kindLabel[item.kind]}</em></div>{item.email ? <button onClick={() => openEmail(item.email!)}>看邮件</button> : item.project ? <button onClick={() => openProject(item.project!)}>看项目</button> : <button onClick={() => openCustomer(item.customer)}>看客户</button>}</article>) : <p className="map-empty">没有可显示的时间线记录。</p>}</section><aside className="map-time-help"><h3>时间线怎么看？</h3><p>邮件是最直接的对外沟通事实；手动跟进和项目记录用于补充内部判断。待办只能说明计划，不代表客户已经确认。</p><ul><li><Mail size={15}/> 邮件事实：打开原邮件核对</li><li><FileText size={15}/> 手动跟进：查看客户 360</li><li><CircleDotDashed size={15}/> 项目记录：打开项目作战室</li></ul></aside></div>}

    {focusedLine && <div className="map-evidence-layer" role="dialog" aria-modal="true" aria-label="业务线证据" onMouseDown={() => setFocusedLine(null)}><aside onMouseDown={event => event.stopPropagation()}><button className="map-evidence-close" aria-label="关闭证据" onClick={() => setFocusedLine(null)}>×</button><p className="eyebrow"><FileText size={14}/> EVIDENCE LEDGER</p><h2>{focusedLine.customer.company_name}</h2><p className="map-evidence-subtitle">{focusedLine.productLabel} · {focusedLine.application}</p><LineFacts line={focusedLine} onEvidence={() => undefined}/><section><h3>这条业务线的证据</h3><p>证据按时间倒序排列。请以原邮件和实际记录为准，系统不会把推测写成客户确认。</p><EvidenceList evidence={evidenceFilter === 'all' ? focusedLine.evidence : focusedLine.evidence.filter(item => item.kind === evidenceFilter)} openEmail={openEmail} openCustomer={openCustomer} openProject={openProject}/></section></aside></div>}
  </section>
}
