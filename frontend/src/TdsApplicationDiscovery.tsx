import { useEffect, useState } from 'react'
import { CheckCircle2, FileText, Plus, Search, Upload } from 'lucide-react'
import { api } from './api'
import type { ApplicationDiscoveryTask, TdsApplication, TdsDocument } from './types'

type Props = { onChanged: () => Promise<void> }

const blankApplication = (name: string): Omit<TdsApplication, 'id' | 'tds_document_id' | 'updated_at' | 'created_at'> => ({
  application_name: name, description: '用户补充的应用方向；请补充 TDS 原文或技术依据后再用于客户发现。', evidence_status: '用户补充',
  target_company_types: [], search_terms: [], local_search_terms: [], selected: false, enabled: true,
})

export function TdsApplicationDiscovery({ onChanged }: Props) {
  const [documents, setDocuments] = useState<TdsDocument[]>([])
  const [applications, setApplications] = useState<TdsApplication[]>([])
  const [tasks, setTasks] = useState<ApplicationDiscoveryTask[]>([])
  const [documentId, setDocumentId] = useState('')
  const [region, setRegion] = useState('')
  const [taskName, setTaskName] = useState('')
  const [manualName, setManualName] = useState('')
  const [version, setVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  const load = async (preferred?: string) => {
    const [docs, existingTasks] = await Promise.all([api.tdsDocuments(), api.applicationDiscoveryTasks()])
    setDocuments(docs); setTasks(existingTasks)
    const id = preferred || documentId || docs[0]?.id || ''
    setDocumentId(id)
    setApplications(id ? await api.tdsApplications(id) : [])
  }
  useEffect(() => { void load().catch(error => setNotice(error instanceof Error ? error.message : '无法读取 TDS 工作台。')) }, [])
  const work = async (job: () => Promise<string | void>) => {
    setBusy(true); setNotice('')
    try { const message = await job(); if (message) setNotice(message); await onChanged() }
    catch (error) { setNotice(error instanceof Error ? error.message : '操作失败，请稍后重试。') }
    finally { setBusy(false) }
  }
  const upload = (file?: File) => { if (!file) return; void work(async () => { const result = await api.parseTdsDocument(file, { document_version: version.trim() || undefined }); await load(result.document.id); return result.message }) }
  const update = (application: TdsApplication, values: Partial<TdsApplication>) => void work(async () => {
    const { id, tds_document_id, updated_at, created_at, ...payload } = { ...application, ...values }
    await api.updateTdsApplication(id, payload); await load(documentId); return '应用卡片已保存。'
  })
  const addManual = () => { const name = manualName.trim(); if (!name || !documentId) return; void work(async () => { await api.createTdsApplication(documentId, blankApplication(name)); setManualName(''); await load(documentId); return '已新增“用户补充”应用；确认前不会参加搜索。' }) }
  const createTask = () => { const selected = applications.filter(item => item.selected && item.enabled); if (!selected.length) { setNotice('请先勾选至少一个已确认应用。'); return } void work(async () => { const result = await api.createApplicationDiscoveryTask({ tds_document_id: documentId, application_ids: selected.map(item => item.id), target_region: region.trim() || undefined, task_name: taskName.trim() || undefined, candidate_limit: 20, search_budget: 0 }); await load(documentId); return result.message }) }
  const current = documents.find(item => item.id === documentId)

  return <section className="tds-discovery panel">
    <div className="panel-title"><div><p className="eyebrow"><FileText size={13}/> TDS-FIRST CUSTOMER DISCOVERY</p><h2>从 TDS 创建客户发现任务</h2><p>先确认材料的具体应用，再寻找可能使用该材料的企业。内部牌号仅可关联资料，不进入默认任务名或搜索词。</p></div></div>
    {notice && <p className="compliance-note">{notice}</p>}
    <section className="tds-upload-row"><div><b>1. 上传 TDS</b><p>支持可复制文本 PDF、DOCX；扫描 PDF 会明确提示需要 OCR，不会填入演示应用。</p><label className="secondary import-lead-button"><Upload size={15}/> 选择 TDS 文件<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={event => { upload(event.target.files?.[0]); event.currentTarget.value = '' }}/></label></div><label>版本（可选）<input value={version} disabled={busy} onChange={event => setVersion(event.target.value)} placeholder="例如 Rev. 2026-09"/></label></section>
    {documents.length > 0 && <section className="tds-document-picker"><label>当前 TDS<select value={documentId} disabled={busy} onChange={event => void work(async () => { await load(event.target.value); return '' })}>{documents.map(item => <option value={item.id} key={item.id}>{item.original_file_name} · {item.parse_status}</option>)}</select></label>{current && <p><b>{current.parse_status}</b>{current.parse_error ? `：${current.parse_error}` : ` · ${current.extracted_summary || '已保存解析文本'}`}</p>}</section>}
    {documentId && <section className="tds-application-area"><header><div><h3>2. 审核具体应用</h3><p>只有你勾选的应用会进入任务。TDS 明确、推测待确认、用户补充三类保持区分。</p></div><span>{applications.filter(item => item.selected).length} 项已选</span></header><div className="tds-application-grid">{applications.map(item => <article key={item.id}><header><b>{item.application_name}</b><em className={`tds-evidence-${item.evidence_status}`}>{item.evidence_status}</em></header><p>{item.description || '未填写说明。'}</p><dl><div><dt>TDS 证据</dt><dd>{item.evidence_excerpt || '未提供；请补充后再确认。'}{item.evidence_page ? `（第 ${item.evidence_page} 页）` : ''}</dd></div><div><dt>应找企业</dt><dd>{item.target_company_types.length ? item.target_company_types.join('、') : '待补充制造商/加工商等目标类型'}</dd></div><div><dt>官网核实</dt><dd>{item.official_business_evidence || '待补充需要在官网确认的工艺或业务。'}</dd></div></dl><footer><label><input type="checkbox" checked={item.selected} disabled={busy} onChange={event => update(item, { selected: event.target.checked })}/> 确认并用于搜索</label><button className="secondary" disabled={busy} onClick={() => { const value = window.prompt('补充“应找企业类型”，用逗号分隔', item.target_company_types.join(', ')); if (value !== null) update(item, { target_company_types: value.split(/[,，]/).map(x => x.trim()).filter(Boolean) }) }}>编辑企业类型</button></footer></article>)}</div><div className="tds-manual-application"><input value={manualName} disabled={busy} onChange={event => setManualName(event.target.value)} placeholder="没有识别到时，依据 TDS 原文手动添加具体应用"/><button className="secondary" disabled={busy || !manualName.trim()} onClick={addManual}><Plus size={14}/> 添加用户补充应用</button></div></section>}
    {documentId && <section className="tds-task-create"><div><h3>3. 创建应用客户发现任务</h3><p>任务锁定当前应用快照；地区为空即“全球”，不会默认任何国家。此阶段若未配置搜索服务，会准确标为待配置而非返回假候选。</p></div><label>任务名称（可编辑）<input value={taskName} disabled={busy} onChange={event => setTaskName(event.target.value)} placeholder="默认：应用名称 · 目标地区"/></label><label>目标地区（可选）<input value={region} disabled={busy} onChange={event => setRegion(event.target.value)} placeholder="例如 Brazil；留空即全球"/></label><button className="primary" disabled={busy || !applications.some(item => item.selected && item.enabled)} onClick={createTask}><Search size={15}/> 创建客户发现任务</button></section>}
    {tasks.length > 0 && <p className="tds-task-summary"><CheckCircle2 size={14}/> 已创建 {tasks.length} 个通用应用任务。最近任务：{tasks[0].task_name} · {tasks[0].status}{tasks[0].provider_notice ? ` · ${tasks[0].provider_notice}` : ''}</p>}
  </section>
}
