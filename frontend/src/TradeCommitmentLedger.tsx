import { useMemo, useState } from 'react'
import { CheckCircle2, ClipboardCheck, Clock3, FileText, Handshake, Plus, Search, ShieldCheck } from 'lucide-react'
import type { Customer, Product, Project, TradeCommitment, TradeCommitmentEvidenceType, TradeCommitmentParty, TradeCommitmentStatus } from './types'
import { countryName } from './CustomerMemory'
import './trade-commitment-ledger.css'

type Filter = '全部' | TradeCommitmentStatus
type CommitmentInput = Omit<TradeCommitment, 'id' | 'created_at' | 'updated_at' | 'completed_at'> & { create_task?: boolean }

const statuses: TradeCommitmentStatus[] = ['我方待办', '等待客户', '待核对', '已确认', '已兑现']
const parties: TradeCommitmentParty[] = ['我方承诺', '客户承诺', '双方约定']
const evidenceTypes: TradeCommitmentEvidenceType[] = ['微信手动记录', '邮件', '项目记录', '运单/物流', '付款凭证', '其他']
const categories = ['样品', '付款', '发货/物流', '技术资料', 'TDS/SDS/COA', '地址', '订单', '其他']
const today = () => new Date().toISOString().slice(0, 10)
const dateText = (value?: string | null) => value?.slice(0, 10) || '未设日期'
const customerName = (id: string, customers: Customer[]) => customers.find(item => item.id === id)?.company_name || '客户已归档'
const projectName = (id: string | null | undefined, projects: Project[]) => projects.find(item => item.id === id)?.project_name || '未关联项目'
const productName = (id: string | null | undefined, products: Product[]) => {
  const product = products.find(item => item.id === id)
  return product ? `${product.product_code} · ${product.product_name}` : '未关联产品'
}

function isOpen(item: TradeCommitment) { return item.status !== '已兑现' }
function dueState(item: TradeCommitment) {
  if (!isOpen(item) || !item.due_date) return 'plain'
  if (item.due_date < today()) return 'overdue'
  if (item.due_date === today()) return 'today'
  return 'upcoming'
}

export function TradeCommitmentLedger({ commitments, customers, projects, products, create, update }: {
  commitments: TradeCommitment[]; customers: Customer[]; projects: Project[]; products: Product[]
  create: (payload: CommitmentInput) => Promise<void>
  update: (id: string, payload: Partial<Omit<TradeCommitment, 'id' | 'customer_id' | 'created_at' | 'updated_at'>>) => Promise<void>
}) {
  const [filter, setFilter] = useState<Filter>('全部')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<TradeCommitment | 'new' | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [saving, setSaving] = useState(false)

  const visible = useMemo(() => commitments.filter(item => {
    const search = `${item.title} ${item.category} ${item.evidence_note} ${item.next_action || ''} ${customerName(item.customer_id, customers)} ${projectName(item.project_id, projects)}`.toLowerCase()
    return (filter === '全部' || item.status === filter) && search.includes(query.trim().toLowerCase())
  }).sort((a, b) => {
    const aDone = a.status === '已兑现' ? 1 : 0
    const bDone = b.status === '已兑现' ? 1 : 0
    return aDone - bDone || (a.due_date || '9999').localeCompare(b.due_date || '9999') || b.created_at.localeCompare(a.created_at)
  }), [commitments, customers, filter, projects, query])

  const metrics = useMemo(() => ({
    mine: commitments.filter(item => item.status === '我方待办').length,
    waiting: commitments.filter(item => item.status === '等待客户').length,
    verify: commitments.filter(item => item.status === '待核对').length,
    overdue: commitments.filter(item => isOpen(item) && item.due_date && item.due_date < today()).length,
  }), [commitments])

  const beginCreate = () => { setCustomerId(customers[0]?.id || ''); setEditing('new') }
  const beginEdit = (item: TradeCommitment) => { setCustomerId(item.customer_id); setEditing(item) }
  const customerProjects = projects.filter(project => project.customer_id === customerId)

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>
    const value = (key: string) => values[key]?.trim() || undefined
    const payload = {
      project_id: value('project_id') || null,
      product_id: value('product_id') || null,
      title: values.title.trim(), category: values.category, responsible_party: values.responsible_party as TradeCommitmentParty,
      status: values.status as TradeCommitmentStatus, due_date: value('due_date') || null,
      evidence_type: values.evidence_type as TradeCommitmentEvidenceType, evidence_reference: value('evidence_reference') || null,
      evidence_note: values.evidence_note.trim(), detail: value('detail') || null, next_action: value('next_action') || null,
    }
    setSaving(true)
    try {
      if (editing === 'new') await create({ ...payload, customer_id: values.customer_id, create_task: values.create_task === 'on' })
      else if (editing) await update(editing.id, payload)
      setEditing(null)
    } catch (error) { alert(error instanceof Error ? error.message : '保存失败，请稍后再试。') } finally { setSaving(false) }
  }

  return <section className="page commitment-page">
    <div className="commitment-hero"><div><p className="eyebrow"><Handshake size={15}/> TRADE PROMISE LEDGER</p><h1>外贸承诺台账</h1><p>把客户承诺、我方承诺和双方约定拆开记录。每一条都必须有真实证据；阶段和 AI 摘要都不能替代证据。</p></div><button className="primary" onClick={beginCreate}><Plus size={17}/> 新增承诺</button></div>
    <div className="commitment-metrics"><div><ClipboardCheck/><b>{metrics.mine}</b><span>我方待兑现</span></div><div><Clock3/><b>{metrics.waiting}</b><span>等待客户</span></div><div><ShieldCheck/><b>{metrics.verify}</b><span>待人工核对</span></div><div className={metrics.overdue ? 'overdue' : ''}><FileText/><b>{metrics.overdue}</b><span>已逾期</span></div></div>
    <div className="commitment-guide"><ShieldCheck size={16}/><div><b>判定原则：</b>“客户已付款”“我方已发货”“客户已确认技术性能”都只能在有微信、邮件、凭证或项目记录时填写；无证据请选“待核对”。</div></div>
    <div className="commitment-tools"><div className="commitment-filters">{(['全部', ...statuses] as Filter[]).map(item => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><label><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索客户、项目、承诺或证据"/></label></div>
    <div className="commitment-list">{visible.map(item => { const customer = customers.find(row => row.id === item.customer_id); const state = dueState(item); return <article className={`commitment-card ${state}`} key={item.id}>
      <header><div className="commitment-card-main"><small>{customer ? `${countryName(customer.country)} · ${customer.contact_person || '联系人待补充'}` : '历史客户'}</small><h2>{item.title}</h2><div className="commitment-context"><span><i>客户</i>{customerName(item.customer_id, customers)}</span>{item.project_id && <span><i>项目</i>{projectName(item.project_id, projects)}</span>}{item.product_id && <span><i>产品</i>{productName(item.product_id, products)}</span>}</div></div><div className="commitment-card-tags"><span className={`commitment-status ${item.status}`}>{item.status}</span><span>{item.responsible_party}</span></div></header>
      <div className="commitment-details"><div><small>承诺类别</small><b>{item.category}</b></div><div><small>到期 / 跟进日</small><b>{dateText(item.due_date)}</b>{state === 'overdue' && <em>已逾期</em>}{state === 'today' && <em>今天处理</em>}</div><div><small>下一步</small><b>{item.next_action || '待补充下一步'}</b></div></div>
      <div className="commitment-evidence"><FileText size={15}/><div><small>证据 · {item.evidence_type}{item.evidence_reference ? ` · ${item.evidence_reference}` : ''}</small><p>{item.evidence_note}</p>{item.detail && <span>{item.detail}</span>}</div></div>
      <footer>{item.status === '已兑现' ? <span className="commitment-done"><CheckCircle2 size={16}/> 已兑现 · {dateText(item.completed_at)}</span> : <button className="primary subtle" onClick={() => void update(item.id, { status: '已兑现' })}><CheckCircle2 size={15}/> 标记已兑现</button>}<button onClick={() => beginEdit(item)}>修改</button></footer>
    </article>})}{!visible.length && <div className="commitment-empty"><Handshake size={24}/><b>还没有符合条件的承诺</b><span>先新增一条真实、可核对的客户或我方承诺。</span></div>}</div>
    {editing && <div className="commitment-modal-layer" onMouseDown={() => !saving && setEditing(null)}><section className="commitment-modal" onMouseDown={event => event.stopPropagation()}><header><div><p className="eyebrow"><Handshake size={14}/> PROMISE WITH EVIDENCE</p><h2>{editing === 'new' ? '新增外贸承诺' : '修改承诺'}</h2><p>先写证据，再写状态。不能把预期、推测或 AI 建议写成客户确认。</p></div><button className="close" onClick={() => setEditing(null)} aria-label="关闭">×</button></header><form onSubmit={save}><div className="form-grid">
      <label>客户 *<select name="customer_id" value={customerId} disabled={editing !== 'new'} onChange={event => setCustomerId(event.target.value)} required><option value="">选择客户</option>{customers.map(item => <option key={item.id} value={item.id}>{item.company_name} · {item.contact_person}</option>)}</select></label>
      <label>关联项目<select name="project_id" defaultValue={editing !== 'new' ? editing.project_id || '' : ''}><option value="">暂不关联项目</option>{customerProjects.map(item => <option key={item.id} value={item.id}>{item.project_name}</option>)}</select></label>
      <label>关联产品<select name="product_id" defaultValue={editing !== 'new' ? editing.product_id || '' : ''}><option value="">暂不关联产品</option>{products.map(item => <option key={item.id} value={item.id}>{item.product_code} · {item.product_name}</option>)}</select></label>
      <label>责任方 *<select name="responsible_party" defaultValue={editing !== 'new' ? editing.responsible_party : '我方承诺'}>{parties.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>承诺类别 *<select name="category" defaultValue={editing !== 'new' ? editing.category : '样品'}>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
      <label>当前状态 *<select name="status" defaultValue={editing !== 'new' ? editing.status : '我方待办'}>{statuses.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="wide">承诺内容 *<input name="title" required defaultValue={editing !== 'new' ? editing.title : ''} placeholder="例如：安排两款固体 MCPP 样品发往广州"/></label>
      <label>到期 / 跟进日<input name="due_date" type="date" defaultValue={editing !== 'new' ? editing.due_date?.slice(0, 10) || '' : today()}/></label>
      <label>证据类型 *<select name="evidence_type" defaultValue={editing !== 'new' ? editing.evidence_type : '微信手动记录'}>{evidenceTypes.map(item => <option key={item}>{item}</option>)}</select></label>
      <label className="wide">证据定位（可选）<input name="evidence_reference" defaultValue={editing !== 'new' ? editing.evidence_reference || '' : ''} placeholder="例如：微信 2026-09-06 / 邮件主题 / 运单号"/></label>
      <label className="wide">证据事实 *<textarea name="evidence_note" required defaultValue={editing !== 'new' ? editing.evidence_note : ''} placeholder="只填写实际沟通、凭证或文件明确表达的内容。"/></label>
      <label className="wide">背景 / 说明<textarea name="detail" defaultValue={editing !== 'new' ? editing.detail || '' : ''} placeholder="可补充规格、数量、地址或限制；不要写未核实推测。"/></label>
      <label className="wide">下一步行动<textarea name="next_action" defaultValue={editing !== 'new' ? editing.next_action || '' : ''} placeholder="例如：发货后回传物流单号。"/></label>
      {editing === 'new' && <label className="commitment-task-check wide"><input name="create_task" type="checkbox"/><span>同时生成一条每日待办</span></label>}
    </div><div className="form-actions"><button type="button" onClick={() => setEditing(null)}>取消</button><button className="primary" disabled={saving}>{saving ? '正在保存…' : '保存承诺'}</button></div></form></section></div>}
  </section>
}
