import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CircleHelp, FileSearch, Mail, Package, ShieldCheck, Users } from 'lucide-react'
import type { Customer, CustomerStage, MailAiFactCard, MailEmail, Product, Project } from './types'
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

function listValues(value: unknown, key?: string) {
  if (!Array.isArray(value)) return [] as string[]
  return value.map(item => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      return String(row[key || 'fact'] || row.fact || row.statement || row.value || row.type || '')
    }
    return ''
  }).filter(Boolean).slice(0, 5)
}
function evidenceItems(value: unknown, label: 'fact' | 'statement' | 'type') {
  if (!Array.isArray(value)) return [] as Array<{ text: string; evidence: string }>
  return value.map(item => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return { text: String(row[label] || row.fact || row.statement || row.type || ''), evidence: String(row.evidence || '') }
  }).filter(item => item.text || item.evidence).slice(0, 4)
}

export function MailFactCard({ email, customer, project, product, onReview, aiCard, aiGenerating, aiError, onGenerate }: { email: MailEmail; customer?: Customer; project?: Project; product?: Product; onReview: () => void; aiCard?: MailAiFactCard | null; aiGenerating?: boolean; aiError?: string; onGenerate?: () => void }) {
  const facts = mailFacts(email, customer, project, product)
  const aiFacts = aiCard?.facts || {}
  const aiCustomerFacts = evidenceItems(aiFacts.customer_stated_facts, 'fact')
  const aiCommitments = evidenceItems(aiFacts.sender_commitments, 'statement')
  const aiRisks = evidenceItems(aiFacts.risks, 'type')
  const aiTopics = listValues(aiFacts.topics)
  const aiProductMentions = listValues(aiFacts.product_mentions)
  const aiApplications = listValues(aiFacts.application_mentions)
  const aiSuggestion = aiFacts.suggested_crm_update && typeof aiFacts.suggested_crm_update === 'object' ? aiFacts.suggested_crm_update as Record<string, unknown> : null
  const customerNeed = aiCustomerFacts.map(item => item.text).join('；') || (email.is_internal_sender ? '这是我方邮件，不把我方安排当作客户需求。' : '未提取到可核对的客户需求，请看原邮件。')
  const nextAction = aiSuggestion ? String(aiSuggestion.next_action || '请人工确认下一步。') : facts.suggestion.action
  const suggestedStage = aiSuggestion ? String(aiSuggestion.stage || '未建议') : facts.suggestion.stage
  return <section className="mail-fact-card" aria-label="邮件事实卡">
    <header><div><p><FileSearch size={15}/> 邮件 AI 摘要 · 待核对</p><h3>这封邮件，重点看这三件事</h3></div><span><ShieldCheck size={14}/> 不会自动改 CRM</span></header>
    <div className="mail-fact-source"><Mail size={15}/><b>{facts.source}</b><span>{email.received_at.slice(0, 10)}</span></div>
    <div className="mail-fact-simple">
      <article className="mail-fact-summary"><small>1 · 这封邮件讲什么</small><b>{aiCard?.chinese_summary || facts.core}</b><em>{aiCard ? 'AI 已翻成中文；请以原邮件为准。' : '尚未生成 AI 摘要。'}</em></article>
      <article><small>2 · 对方要什么</small><b>{aiCard ? customerNeed : `${facts.productLabel}；${facts.application}`}</b><em>{email.is_internal_sender ? '本封为我方邮件，仅供回顾，不代表客户确认。' : '只记录能在邮件中找到的内容。'}</em></article>
      <article><small>3 · 我下一步做什么</small><b>{nextAction}</b><em>建议阶段：{suggestedStage}；先核对，再决定是否更新。</em></article>
    </div>
    <div className="mail-fact-actions mail-fact-primary-action">{!aiCard && onGenerate && <button onClick={onGenerate} disabled={aiGenerating}>{aiGenerating ? '正在生成中文摘要…' : '生成中文摘要'}</button>}<button className="primary" onClick={onReview}>{facts.canWrite ? '确认后更新客户进度' : '先确认对应客户'}<ArrowRight size={15}/></button></div>
    <details className="mail-fact-evidence"><summary>查看原文证据、识别主题与风险</summary><div className="mail-fact-tags">{(aiTopics.length ? aiTopics : facts.topics).map(topic => <span key={topic}>{topic}</span>)}{aiProductMentions.map(item => <span key={item}>{item}</span>)}{aiApplications.map(item => <span key={item}>{item}</span>)}</div>{aiCommitments.length > 0 && <section><b>{email.is_internal_sender ? '我方邮件中的安排' : '邮件中的承诺/安排'}</b>{aiCommitments.map(item => <p key={`${item.text}${item.evidence}`}>{item.text}<em>{item.evidence || '请回看原邮件。'}</em></p>)}</section>}{(aiRisks.length > 0 || facts.risks.length > 0) && <section className="mail-fact-risk"><b><AlertTriangle size={14}/> 待核对项</b>{(aiRisks.length ? aiRisks : facts.risks.map(item => ({ text: item.label, evidence: item.detail }))).map(item => <p key={`${item.text}${item.evidence}`}>{item.text}<em>{item.evidence || '请回看原邮件。'}</em></p>)}</section>}</details>
    {aiError && <div className="mail-ai-error">{aiError}</div>}
    <footer><CircleHelp size={14}/> 价格、付款、交期、技术可行性和客户确认，仍需你按原邮件核对。</footer>
  </section>
}
