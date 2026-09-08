import { useEffect, useMemo, useState } from 'react'
import { Brain, ChevronRight, ClipboardCheck, Copy, Mail, MessageSquareText, Sparkles } from 'lucide-react'
import { api } from './api'
import type { Customer, MailAiFactCard, MailEmail, MailReplyDraft, Product, Project } from './types'

type MailThread = { key: string; latest: MailEmail; emails: MailEmail[]; customer?: Customer; project?: Project; product?: Product }

const normalizedSubject = (subject: string) => (subject || '(无主题)').replace(/^(?:(?:re|fw|fwd|回复)\s*[:：]\s*)+/i, '').trim()
const isSystemNotice = (email: MailEmail) => {
  const sender = (email.sender_name || '').toLowerCase()
  const subject = (email.subject || '').toLowerCase()
  return sender.includes('阿里邮箱') && (subject.includes('系统通知') || subject.includes('密码提醒'))
}
const emailAddress = (value?: string | null) => (value || '').trim().toLowerCase()
const shortDate = (value: string) => value ? value.slice(0, 10) : '日期待确认'
const firstFact = (value: unknown) => {
  const item = Array.isArray(value) ? value[0] : value
  if (typeof item === 'string') return item
  if (item && typeof item === 'object') {
    const record = item as Record<string, unknown>
    return ['fact', 'summary', 'content', 'text', 'statement', 'evidence'].map(key => record[key]).find(value => typeof value === 'string' && value.trim()) as string | undefined
  }
  return undefined
}

export function MailWorkbench({ emails, customers, projects, products, openEmail }: { emails: MailEmail[]; customers: Customer[]; projects: Project[]; products: Product[]; openEmail: (email: MailEmail) => void }) {
  const [cards, setCards] = useState<Record<string, MailAiFactCard>>({})
  const [loading, setLoading] = useState<Record<string, 'summary' | 'reply'>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [drafts, setDrafts] = useState<Record<string, MailReplyDraft>>({})

  const resolveCustomer = (email: MailEmail) => {
    const sender = emailAddress(email.sender)
    const receiver = emailAddress(email.receiver)
    return customers.find(customer => [sender, receiver].includes(emailAddress(customer.email))) || customers.find(customer => customer.id === email.customer_id)
  }
  const threads = useMemo(() => {
    const grouped = new Map<string, MailThread>()
    emails.filter(email => !isSystemNotice(email)).forEach(email => {
      const customer = resolveCustomer(email)
      const partner = customer?.id || (email.is_internal_sender ? emailAddress(email.receiver) : emailAddress(email.sender)) || email.id
      const key = `${partner}::${normalizedSubject(email.subject).toLowerCase()}`
      const current = grouped.get(key)
      const project = projects.find(item => item.id === email.project_id || item.customer_id === customer?.id)
      const product = products.find(item => item.id === email.product_id || item.id === project?.product_id)
      if (!current) grouped.set(key, { key, latest: email, emails: [email], customer, project, product })
      else {
        current.emails.push(email)
        if (email.received_at > current.latest.received_at) {
          current.latest = email; current.customer = customer; current.project = project; current.product = product
        }
      }
    })
    return [...grouped.values()].sort((a, b) => b.latest.received_at.localeCompare(a.latest.received_at))
  }, [emails, customers, projects, products])

  useEffect(() => {
    const ids = threads.map(thread => thread.latest.id)
    if (!ids.length) return
    let alive = true
    void api.emailAiFactCards(ids).then(rows => {
      if (alive) setCards(Object.fromEntries(rows.map(card => [card.email_id, card])))
    }).catch(() => { /* Older backend: individual summary generation still works. */ })
    return () => { alive = false }
  }, [threads])

  const summarize = async (thread: MailThread) => {
    if (!window.confirm('会把这条会话的最新邮件正文发送至已配置的硅基流动模型，生成中文速读；不会自动写入 CRM。是否继续？')) return
    setLoading(current => ({ ...current, [thread.key]: 'summary' })); setErrors(current => ({ ...current, [thread.key]: '' }))
    try {
      const card = await api.generateEmailAiFactCard(thread.latest.id)
      setCards(current => ({ ...current, [thread.latest.id]: card }))
    } catch (error) { setErrors(current => ({ ...current, [thread.key]: error instanceof Error ? error.message : '中文速读生成失败。' })) }
    finally { setLoading(current => { const next = { ...current }; delete next[thread.key]; return next }) }
  }
  const draftReply = async (thread: MailThread) => {
    const purpose = window.prompt('用中文写你希望这次回复达到什么目的（可留空，让系统按邮件内容建议）：', thread.customer ? `请根据邮件内容回复 ${thread.customer.contact_person || thread.customer.company_name}，推进下一步。` : '')
    if (purpose === null) return
    if (!window.confirm('会把这条最新客户邮件正文和你的中文意图发送至已配置的硅基流动模型，生成英文草稿与中文回译；不会发送邮件。是否继续？')) return
    setLoading(current => ({ ...current, [thread.key]: 'reply' })); setErrors(current => ({ ...current, [thread.key]: '' }))
    try {
      const draft = await api.generateEmailReplyDraft(thread.latest.id, purpose)
      setDrafts(current => ({ ...current, [thread.key]: draft }))
    }
    catch (error) { setErrors(current => ({ ...current, [thread.key]: error instanceof Error ? error.message : '英文草稿生成失败。' })) }
    finally { setLoading(current => { const next = { ...current }; delete next[thread.key]; return next }) }
  }
  const copyDraft = async (draft: MailReplyDraft) => {
    try { await navigator.clipboard.writeText(draft.english_draft); alert('英文草稿已复制。请先核对内容，再粘贴到邮箱发送。') }
    catch { alert('复制失败。请手动选择英文草稿复制。') }
  }

  return <section className="mail-workbench panel"><header><div><p className="eyebrow"><Sparkles size={14}/> CHINESE EMAIL WORKBENCH</p><h2>先看懂，再决定要不要回复</h2><span>按会话合并；AI 只在你点击时生成，所有 CRM 更新仍需人工确认。</span></div><div className="mail-workbench-count"><b>{threads.length}</b><span>条客户会话</span></div></header><div className="mail-workbench-list">{threads.map(thread => {
    const card = cards[thread.latest.id]
    const facts = card?.facts || {}
    const stated = firstFact((facts as Record<string, unknown>).customer_stated_facts) || card?.chinese_summary || '尚未生成中文速读；请先点击“帮我看懂”。'
    const suggested = (facts as Record<string, unknown>).suggested_crm_update as Record<string, unknown> | undefined
    const nextAction = typeof suggested?.next_action === 'string' ? suggested.next_action : thread.customer?.next_action?.[0] || '先核对客户明确表达的内容，再决定下一步。'
    const canReply = !thread.latest.is_internal_sender
    const draft = drafts[thread.key]
    return <article className="mail-thread-card" key={thread.key}><div className="mail-thread-head"><div><small>{thread.customer ? `${thread.customer.country} · ${thread.customer.contact_person || thread.customer.company_name}` : thread.latest.sender_name || thread.latest.sender} · {shortDate(thread.latest.received_at)}</small><h3>{thread.customer?.company_name || '待人工核对客户'} <span>· {normalizedSubject(thread.latest.subject)}</span></h3><p>{thread.project?.project_name || thread.product?.product_code || thread.customer?.product_interest || '产品/项目待核对'} · 共 {thread.emails.length} 封往来</p></div><button className="secondary" onClick={() => openEmail(thread.latest)}>查看原邮件 <ChevronRight size={15}/></button></div><div className="mail-four-lines"><div><span>客户最新明确说</span><b>{stated}</b></div><div><span>现在卡在哪里</span><b>{thread.customer?.status_label || '尚未人工确认邮件事实与业务阶段。'}</b></div><div><span>你下一步做什么</span><b>{nextAction}</b></div><div><span>不能擅自认定</span><b>未核对前，不标记已付款、已发货、客户已确认或技术可行。</b></div></div>{errors[thread.key] && <p className="mail-workbench-error">{errors[thread.key]}</p>}<footer><button className="secondary" disabled={loading[thread.key] === 'summary'} onClick={() => void summarize(thread)}><Brain size={15}/>{loading[thread.key] === 'summary' ? '正在生成中文速读…' : card ? '重新生成中文速读' : '帮我看懂'}</button>{canReply && <button className="primary" disabled={loading[thread.key] === 'reply'} onClick={() => void draftReply(thread)}><MessageSquareText size={15}/>{loading[thread.key] === 'reply' ? '正在起草…' : '帮我回复英文'}</button>}<button className="secondary" onClick={() => openEmail(thread.latest)}><ClipboardCheck size={15}/>人工确认写入跟进</button></footer>{draft && <section className="mail-reply-draft"><div><p className="eyebrow"><Mail size={13}/> REPLY DRAFT · 必须人工核对</p><b>中文回复意图：{draft.reply_intent_zh}</b></div><label>英文草稿<textarea readOnly value={draft.english_draft}/></label><label>中文回译<textarea readOnly value={draft.chinese_back_translation}/></label>{draft.assumptions.length > 0 && <p>需核对：{draft.assumptions.join('；')}</p>}<button className="secondary" onClick={() => void copyDraft(draft)}><Copy size={15}/>复制英文草稿</button></section>}</article>
  })}{!threads.length && <div className="mail-workbench-empty"><CircleCheckIcon/>暂时没有需要处理的客户邮件会话。</div>}</div></section>
}

function CircleCheckIcon() { return <ClipboardCheck size={22}/> }
