import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleHelp, FileSearch, Mail, Package, ShieldCheck, Users } from 'lucide-react'
import type { Customer, CustomerStage, MailEmail, Product, Project } from './types'
import './mail-fact-card.css'

type Topic = '价格' | '样品' | '技术' | '付款' | '交期' | '资料' | '地址/文件' | '其他'
type Risk = { label: string; detail: string; tone: 'warning' | 'attention' }

const categoryTopic: Record<MailEmail['category'], Topic> = {
  customer_inquiry: '其他', technical: '技术', quotation: '价格', sample: '样品', payment: '付款', other: '其他',
}
const categorySuggestion: Record<MailEmail['category'], { stage: CustomerStage; action: string }> = {
  quotation: { stage: 'Quotation', action: '核对报价范围、数量、贸易条款和客户期望回复时间。' },
  sample: { stage: 'Sample Payment', action: '核对样品规格、寄送地址、付款和签收安排。' },
  payment: { stage: 'Sample Payment', action: '核对付款相关事实，再安排样品或订单动作。' },
  technical: { stage: 'Technical Discussion', action: '核对技术参数、应用工艺和需要补充的资料。' },
  customer_inquiry: { stage: 'New Inquiry', action: '确认客户需求、规格、数量和预计采购时间。' },
  other: { stage: 'New Inquiry', action: '人工确认这封邮件是否需要转为业务行动。' },
}
const topicRules: Array<[Topic, RegExp]> = [
  ['价格', /\b(price|pricing|quotation|quote|usd|eur|cif|fob|cost)\b|价格|报价|美元|欧元/i],
  ['样品', /\b(sample|trial|kg|shipment|courier|dhl)\b|样品|寄送|快递/i],
  ['技术', /\b(tds|sds|coa|specification|technical|otr|wvtr|viscosity|grade|test)\b|技术|指标|规格|测试/i],
  ['付款', /\b(payment|paid|pay|invoice|pi\b|proforma)\b|付款|水单|形式发票/i],
  ['交期', /\b(lead time|delivery|eta|etd|ship(?:ment|ping)?)\b|交期|到港|发货/i],
  ['资料', /\b(document|certificate|file|data sheet|attachment|brochure)\b|资料|文件|证书/i],
  ['地址/文件', /\b(address|postcode|zip|tax|vat|trc)\b|地址|邮编|税务/i],
]

function sourceName(email: MailEmail) { return email.is_internal_sender ? '我方已发/内部归档邮件' : '客户来信' }
function compactText(email: MailEmail) {
  const text = (email.content_preview || email.content_text || '').replace(/\s+/g, ' ').trim()
  if (!text) return '当前没有可用正文摘要，请打开原邮件核对。'
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}
function pickTopics(email: MailEmail, text: string) {
  const topics = new Set<Topic>([categoryTopic[email.category]])
  topicRules.forEach(([topic, pattern]) => { if (pattern.test(text)) topics.add(topic) })
  return [...topics]
}
function risksFor(email: MailEmail, text: string): Risk[] {
  const risks: Risk[] = []
  if (/undeliverable|delivery (?:has )?failed|mailbox unavailable|退信|投递失败/i.test(text)) risks.push({ label: '邮箱退信', detail: '邮件可能未送达；不要把它作为客户已收到或已回复的依据。', tone: 'attention' })
  if (/complaint|claim|issue|problem|dissatisfied|投诉|问题|异常/i.test(text)) risks.push({ label: '客户异议/问题', detail: '邮件出现问题或异议线索，需先读原文确认影响范围。', tone: 'attention' })
  if (/competitor|another supplier|lower price|price pressure|竞争对手|其他供应商|价格压力/i.test(text)) risks.push({ label: '竞品/价格压力', detail: '出现竞品或价格比较线索；不代表客户已接受任何价格。', tone: 'warning' })
  if (/deadline|urgent|asap|due date|by\s+\w+|截止|尽快|紧急/i.test(text)) risks.push({ label: '可能有时限', detail: '检测到时限或紧急措辞，请以原邮件的具体日期为准。', tone: 'warning' })
  if (/otr|wvtr|tds|sds|coa|specification|test result|技术指标|测试|资料/i.test(text)) risks.push({ label: '技术资料待核对', detail: '涉及技术指标、测试或资料，不应自动认定为技术可行或客户认可。', tone: 'warning' })
  if (/payment|paid|invoice|pi\b|付款|水单|形式发票/i.test(text)) risks.push({ label: '付款信息待核对', detail: '邮件提及付款或 PI，不等于已到账、已批准或已接受。', tone: 'warning' })
  return risks.slice(0, 4)
}

export type MailFacts = ReturnType<typeof mailFacts>
export function mailFacts(email: MailEmail, customer?: Customer, project?: Project, product?: Product) {
  const core = compactText(email)
  const source = sourceName(email)
  const topics = pickTopics(email, `${email.subject} ${core}`)
  const linked = customer ? `${customer.company_name}${project ? ` · ${project.project_name}` : ''}` : '尚未关联客户'
  const productLabel = product ? `${product.product_code} · ${product.product_name}` : customer?.product_interest || '产品待确认'
  const application = project?.application || customer?.application || '应用待确认'
  const suggestion = categorySuggestion[email.category]
  const risks = risksFor(email, `${email.subject} ${core}`)
  return {
    source, core, topics, linked, productLabel, application, suggestion, risks,
    commitment: email.is_internal_sender
      ? '这是我方已发或内部归档邮件；它只能说明我方表达/安排过什么，不能作为客户确认。'
      : '系统不自动认定客户承诺。请在原邮件中确认是否存在明确的数量、时间、付款或技术确认。',
    canWrite: Boolean(customer),
  }
}

export function MailFactCard({ email, customer, project, product, onReview }: { email: MailEmail; customer?: Customer; project?: Project; product?: Product; onReview: () => void }) {
  const facts = mailFacts(email, customer, project, product)
  return <section className="mail-fact-card" aria-label="邮件事实卡">
    <header><div><p><FileSearch size={15}/> MAIL FACT CARD · 待确认</p><h3>邮件事实卡</h3></div><span><ShieldCheck size={14}/> 不会自动写入 CRM</span></header>
    <div className="mail-fact-source"><Mail size={15}/><b>{facts.source}</b><span>邮件时间：{email.received_at.slice(0, 10)}</span></div>
    <div className="mail-fact-grid">
      <article className="wide"><small>{email.is_internal_sender ? '我方邮件核心内容' : '客户邮件核心内容'}</small><b>{facts.core}</b><em>这是邮件正文摘要，需以“查看原邮件”为准。</em></article>
      <article><small>这封邮件主要在谈什么</small><div className="mail-fact-tags">{facts.topics.map(topic => <span key={topic}>{topic}</span>)}</div><em>由邮件类别与关键词提取，可能不完整。</em></article>
      <article><small>涉及客户 / 项目</small><b>{facts.linked}</b><em>{customer ? '已关联，可审核更新。' : '请先关联真实客户，不能直接写入。'}</em></article>
      <article><small>涉及产品 / 应用</small><b>{facts.productLabel}</b><em>{facts.application}</em></article>
      <article><small>客户 / 我方承诺</small><b>{facts.commitment}</b><em>不会根据措辞自动写成“已确认”。</em></article>
    </div>
    <div className="mail-fact-risk"><div><AlertTriangle size={16}/><b>风险与待核对项</b></div>{facts.risks.length ? <ul>{facts.risks.map(risk => <li className={risk.tone} key={risk.label}><b>{risk.label}</b><span>{risk.detail}</span></li>)}</ul> : <p>当前未自动检测到明显风险词；这不代表没有风险，请仍以原邮件为准。</p>}</div>
    <div className="mail-fact-recommendation"><div><CalendarClock size={17}/><div><small>建议更新（仅预填，不是事实结论）</small><b>阶段：{facts.suggestion.stage}；下一步：{facts.suggestion.action}</b><span>确认后才会写入客户阶段、下一步、跟进日期，并把此邮件保留为证据。</span></div></div><button className="primary" onClick={onReview}>{facts.canWrite ? '审核后决定是否写入' : '先关联客户再审核'}<ArrowRight size={15}/></button></div>
    <footer><CircleHelp size={14}/> 自动提炼用于减少漏看邮件，不用于替代你的外贸判断；价格、付款、交期、技术可行性和客户确认必须人工核对。</footer>
  </section>
}
