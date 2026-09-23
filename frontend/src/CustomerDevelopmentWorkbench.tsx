import { useEffect, useState } from 'react'
import { Check, ExternalLink, FileText, Globe2, Mail, Search, Upload } from 'lucide-react'
import { api } from './api'
import type { CustomerLead, DevelopmentCampaign, DevelopmentWorkspace, OutreachDraft } from './types'

type Props = { convertLead: (lead: CustomerLead) => void; onChanged: () => Promise<void> }

const searchLink = (text: string) => `https://www.google.com/search?q=${encodeURIComponent(text)}`

export function CustomerDevelopmentWorkbench({ convertLead, onChanged }: Props) {
  const [campaigns, setCampaigns] = useState<DevelopmentCampaign[]>([])
  const [workspace, setWorkspace] = useState<DevelopmentWorkspace | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [pdfSourceUrl, setPdfSourceUrl] = useState('')

  const loadCampaigns = async (preferredId?: string) => {
    const rows = await api.developmentCampaigns()
    setCampaigns(rows)
    const id = preferredId || workspace?.campaign.id || rows[0]?.id
    if (id) setWorkspace(await api.developmentWorkspace(id))
    else setWorkspace(null)
  }
  useEffect(() => { void loadCampaigns().catch(error => setNotice(error instanceof Error ? error.message : '无法读取客户开发任务。')) }, [])
  const work = async (job: () => Promise<string | void>) => {
    setBusy(true); setNotice('')
    try { const result = await job(); if (result) setNotice(result); await onChanged() }
    catch (error) { setNotice(error instanceof Error ? error.message : '操作失败，请稍后重试。') }
    finally { setBusy(false) }
  }
  const bootstrap = () => void work(async () => {
    const result = await api.bootstrapNlFcPuBrazil(); await loadCampaigns(result.campaign.id); return result.message
  })
  const current = workspace?.campaign
  const evidencesFor = (leadId: string) => workspace?.evidences.filter(item => item.customer_lead_id === leadId) || []
  const contactsFor = (leadId: string) => workspace?.contacts.filter(item => item.customer_lead_id === leadId) || []
  const draftFor = (leadId: string) => workspace?.drafts.find(item => item.customer_lead_id === leadId)
  const refresh = async () => { if (current) setWorkspace(await api.developmentWorkspace(current.id)); await loadCampaigns(current?.id) }

  return <section className="development-workbench panel">
    <div className="panel-title"><div><p className="eyebrow"><Globe2 size={13}/> REVIEW-FIRST CUSTOMER DEVELOPMENT</p><h2>客户开发工作台</h2><p>第一阶段只生成查询链接、导入公开候选、保存官网证据和审核草稿；不会自动发送邮件或社媒私信。</p></div><button className="primary" disabled={busy} onClick={bootstrap}>创建 NL-FC-PU 巴西任务</button></div>
    {notice && <p className="compliance-note">{notice}</p>}
    {!current ? <p className="detail-empty">尚未创建开发任务。点击右上角创建 NL-FC-PU 巴西任务。</p> : <>
      <div className="development-campaign-picker"><label>开发任务<select value={current.id} disabled={busy} onChange={event => void work(async () => { await loadCampaigns(event.target.value); return '' })}>{campaigns.map(item => <option key={item.id} value={item.id}>{item.campaign_name}</option>)}</select></label><dl><div><dt>产品事实来源</dt><dd>{current.product_claim_source}</dd></div><div><dt>客户类型</dt><dd>{current.target_company_types.join(' · ')}</dd></div><div><dt>人工边界</dt><dd>搜索、联系人、收件人和发送均须人工确认</dd></div></dl></div>
      <section className="development-queries"><header><div><h3>1. 查询词与人工发现入口</h3><p>点击后在你的浏览器中手动检索；系统不抓取 Google、Maps 或 LinkedIn 页面。</p></div></header><div>{workspace?.queries.map(query => <a key={query.id} href={query.search_url} target="_blank" rel="noreferrer"><Search size={14}/><span>{query.query_text}</span><small>{query.query_kind === 'maps' ? 'Maps' : query.query_kind === 'pdf_directory' ? 'PDF 名录' : 'Web'}</small><ExternalLink size={13}/></a>)}</div></section>
      <section className="development-import"><div><h3>2. 导入候选公司</h3><p>CSV：`company_name,website_url,country,company_type,evidence_url,evidence_excerpt,public_email`。邮箱仅限官网明确公开地址。</p><label className="secondary import-lead-button"><Upload size={15}/> 导入公开 CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void work(async () => { const r = await api.importDevelopmentCsv(current.id, file); await refresh(); return r.message }) }}/></label></div><div><h3>PDF 展商/企业名录</h3><p>仅提取 PDF 中清晰出现的官网 URL，并保留页码证据。</p><input value={pdfSourceUrl} onChange={event => setPdfSourceUrl(event.target.value)} placeholder="PDF 的公开来源 URL"/><label className="secondary import-lead-button"><FileText size={15}/> 导入公开 PDF<input type="file" accept="application/pdf,.pdf" disabled={busy || !pdfSourceUrl.trim()} onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void work(async () => { const r = await api.importDevelopmentPdf(current.id, file, pdfSourceUrl.trim()); await refresh(); return r.message }) }}/></label></div></section>
      <section className="development-leads"><header><div><h3>3. 官网证据、评分与 CRM 审核</h3><p>评分仅排序：应用证据 35、身份 25、国家 15、官网/公开入口 15、近期活动 10。没有证据不加分。</p></div><span>{workspace?.leads.length || 0} 家候选</span></header><div className="development-lead-grid">{workspace?.leads.map(lead => { const evidence = evidencesFor(lead.id); const contacts = contactsFor(lead.id); const draft = draftFor(lead.id); return <article key={lead.id}><header><div><b>{lead.company_name}</b><small>{lead.country || '国家待确认'} · {lead.development_status || '发现'} · {lead.match_score} 分</small></div><em className={lead.suspected_duplicate ? 'warning' : ''}>{lead.suspected_duplicate ? '疑似重复' : '待核实'}</em></header><dl><div><dt>官网</dt><dd>{lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">{lead.website_domain || '打开官网'} <ExternalLink size={12}/></a> : '未提供'}</dd></div><div><dt>公开联系</dt><dd>{contacts.map(item => item.email).filter(Boolean).join(' · ') || '未发现'}</dd></div></dl><div className="development-evidence">{evidence.length ? evidence.slice(0, 3).map(item => <p key={item.id}><b>{item.evidence_role}</b>：{item.excerpt}{item.page_number ? `（PDF 第 ${item.page_number} 页）` : ''}</p>) : <p>尚无可追溯证据。</p>}</div><div className="development-links"><a href={searchLink(`${lead.company_name} Brazil procurement`)} target="_blank" rel="noreferrer">Google 人工核查</a><a href={searchLink(`site:linkedin.com/company ${lead.company_name}`)} target="_blank" rel="noreferrer">LinkedIn 搜索链接</a></div><footer><button disabled={busy || !lead.website} onClick={() => void work(async () => { const r = await api.verifyDevelopmentLead(lead.id); await refresh(); return r.message })}>核验官网</button><button disabled={busy || lead.development_status === '合格'} onClick={() => void work(async () => { await api.updateDevelopmentLeadStatus(lead.id, { development_status: '合格' }); await refresh(); return '已标记为合格；现在可转 CRM 或创建开发信草稿。' })}><Check size={14}/>人工判为合格</button><button className="secondary" disabled={busy || lead.development_status !== '合格'} onClick={() => void work(async () => { const r = await api.createOutreachDraft(lead.id); await refresh(); return r.message })}><Mail size={14}/>生成审核草稿</button><button className="primary" disabled={busy || lead.development_status !== '合格'} onClick={() => convertLead(lead)}>转入 CRM</button></footer>{draft && <DraftReview draft={draft} approve={state => void work(async () => { await api.approveOutreachDraft(draft.id, { approval_state: state }); await refresh(); return state === '已审核' ? '草稿已审核；请人工复制并发送，系统不会代发。' : '草稿已拒绝。' })}/>}</article> })}{!workspace?.leads.length && <p className="detail-empty">先通过上方查询链接找到公开企业，再导入 CSV 或 PDF 名录。</p>}</div></section>
    </>}
  </section>
}

function DraftReview({ draft, approve }: { draft: OutreachDraft; approve: (state: '已审核' | '已拒绝') => void }) {
  return <details className="development-draft"><summary>开发信草稿 · {draft.approval_state}</summary><p><b>Subject:</b> {draft.subject}</p><pre>{draft.draft_body}</pre><small>公司事实来源：{draft.fact_source_url || '未提供'}；产品断言来源：{draft.product_claim_source}</small>{draft.approval_state === '待审核' && <footer><button onClick={() => approve('已审核')}>审核通过（不发送）</button><button className="danger" onClick={() => approve('已拒绝')}>拒绝草稿</button></footer>}</details>
}
