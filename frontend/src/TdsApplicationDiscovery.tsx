import { useEffect, useState } from 'react'
import { Download, FileText, Play, Plus, RefreshCw, Search, Upload } from 'lucide-react'
import { api } from './api'
import type { ApplicationDiscoveryTask, TdsApplication, TdsDocument, TdsPreset } from './types'

type Props = { onChanged: () => Promise<void> }

const blankApplication = (name: string): Omit<TdsApplication, 'id' | 'tds_document_id' | 'updated_at' | 'created_at'> => ({
  application_name: name, description: '用户补充的应用方向；请补充 TDS 原文或技术依据后再用于客户发现。', evidence_status: '用户补充',
  target_company_types: [], search_terms: [], local_search_terms: [], selected: false, enabled: true,
})

export function TdsApplicationDiscovery({ onChanged }: Props) {
  const [presets, setPresets] = useState<TdsPreset[]>([])
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
    const [docs, existingTasks, availablePresets] = await Promise.all([api.tdsDocuments(), api.applicationDiscoveryTasks(), api.tdsPresets()])
    setDocuments(docs); setTasks(existingTasks); setPresets(availablePresets)
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
  const loadPreset = (preset: TdsPreset) => void work(async () => { const result = await api.bootstrapTdsPreset(preset.id); await load(result.document.id); return result.message })
  const update = (application: TdsApplication, values: Partial<TdsApplication>) => void work(async () => {
    const { id, tds_document_id, updated_at, created_at, ...payload } = { ...application, ...values }
    await api.updateTdsApplication(id, payload); await load(documentId); return '应用卡片已保存。'
  })
  const addManual = () => { const name = manualName.trim(); if (!name || !documentId) return; void work(async () => { await api.createTdsApplication(documentId, blankApplication(name)); setManualName(''); await load(documentId); return '已新增“用户补充”应用；确认前不会参加搜索。' }) }
  const createTask = () => { const selected = applications.filter(item => item.selected && item.enabled); if (!selected.length) { setNotice('请先勾选至少一个已确认应用。'); return } void work(async () => { const result = await api.createApplicationDiscoveryTask({ tds_document_id: documentId, application_ids: selected.map(item => item.id), target_region: region.trim() || undefined, task_name: taskName.trim() || undefined, candidate_limit: 20, search_budget: 0 }); await load(documentId); return result.message }) }
  const runTask = (task: ApplicationDiscoveryTask) => void work(async () => { const result = await api.runApplicationDiscoveryTask(task.id); await load(documentId); return result.message })
  const current = documents.find(item => item.id === documentId)

  return <section className="tds-discovery panel">
    <div className="panel-title"><div><p className="eyebrow"><FileText size={13}/> TDS-FIRST CUSTOMER DISCOVERY</p><h2>三份重点 TDS 已内置</h2><p>直接选择产品，审核文档原文支持的具体应用，再寻找可能实际使用该材料的企业。无需重复上传；内部牌号只关联资料，不进入搜索词。</p></div></div>
    {notice && <p className="compliance-note">{notice}</p>}
    <section className="tds-builtin-area"><header><div><h3>1. 选择内置 TDS</h3><p>应用、目标企业类型和官网核实条件均已根据你提供的原文件预置；载入后仍由你逐项确认。</p></div></header><div className="tds-preset-grid">{presets.map(preset => { const active = current?.original_file_name === preset.original_file_name; return <article className="tds-preset-card" key={preset.id}><div><span>{preset.material}</span><h3>{preset.title}</h3><p>{preset.summary}</p></div><dl><div><dt>已核对应用</dt><dd>{preset.applications.map(item => item.application_name).join('；')}</dd></div><div><dt>原始文件</dt><dd>{preset.original_file_name}</dd></div></dl><button className={active ? 'secondary' : 'primary'} disabled={busy} onClick={() => loadPreset(preset)}>{active ? '重新载入并保留修改' : `载入 ${preset.application_count} 项应用`}</button></article> })}</div></section>
    <details className="tds-optional-upload"><summary><Upload size={14}/> 新增其他 TDS（可选）</summary><section className="tds-upload-row"><div><b>仅供以后新增产品</b><p>支持可复制文本 PDF、DOCX；扫描 PDF 会明确提示需要 OCR，不会填入演示应用。</p><label className="secondary import-lead-button"><Upload size={15}/> 选择新 TDS 文件<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={event => { upload(event.target.files?.[0]); event.currentTarget.value = '' }}/></label></div><label>版本（可选）<input value={version} disabled={busy} onChange={event => setVersion(event.target.value)} placeholder="例如 Rev. 2026-09"/></label></section></details>
    {documents.length > 0 && <section className="tds-document-picker"><label>当前 TDS<select value={documentId} disabled={busy} onChange={event => void work(async () => { await load(event.target.value); return '' })}>{documents.map(item => <option value={item.id} key={item.id}>{item.original_file_name} · {item.parse_status}</option>)}</select></label>{current && <p><b>{current.parse_status}</b>{current.parse_error ? `：${current.parse_error}` : ` · ${current.extracted_summary || '已保存解析文本'}`}</p>}</section>}
    {documentId && <section className="tds-application-area"><header><div><h3>2. 审核具体应用</h3><p>只有你勾选的应用会进入任务。TDS 明确、推测待确认、用户补充三类保持区分。</p></div><span>{applications.filter(item => item.selected).length} 项已选</span></header><div className="tds-application-grid">{applications.map(item => <article key={item.id}><header><b>{item.application_name}</b><em className={`tds-evidence-${item.evidence_status}`}>{item.evidence_status}</em></header><p>{item.description || '未填写说明。'}</p><dl><div><dt>TDS 证据</dt><dd>{item.evidence_excerpt || '未提供；请补充后再确认。'}{item.evidence_page ? `（第 ${item.evidence_page} 页）` : ''}</dd></div><div><dt>应找企业</dt><dd>{item.target_company_types.length ? item.target_company_types.join('、') : '待补充制造商/加工商等目标类型'}</dd></div><div><dt>官网核实</dt><dd>{item.official_business_evidence || '待补充需要在官网确认的工艺或业务。'}</dd></div></dl><footer><label><input type="checkbox" checked={item.selected} disabled={busy} onChange={event => update(item, { selected: event.target.checked })}/> 确认并用于搜索</label><button className="secondary" disabled={busy} onClick={() => { const value = window.prompt('补充“应找企业类型”，用逗号分隔', item.target_company_types.join(', ')); if (value !== null) update(item, { target_company_types: value.split(/[,，]/).map(x => x.trim()).filter(Boolean) }) }}>编辑企业类型</button></footer></article>)}</div><div className="tds-manual-application"><input value={manualName} disabled={busy} onChange={event => setManualName(event.target.value)} placeholder="没有识别到时，依据 TDS 原文手动添加具体应用"/><button className="secondary" disabled={busy || !manualName.trim()} onClick={addManual}><Plus size={14}/> 添加用户补充应用</button></div></section>}
    {documentId && <section className="tds-task-create"><div><h3>3. 创建应用客户发现任务</h3><p>任务锁定当前应用快照；地区为空即“全球”，不会默认任何国家。此阶段若未配置搜索服务，会准确标为待配置而非返回假候选。</p></div><label>任务名称（可编辑）<input value={taskName} disabled={busy} onChange={event => setTaskName(event.target.value)} placeholder="默认：应用名称 · 目标地区"/></label><label>目标地区（可选）<input value={region} disabled={busy} onChange={event => setRegion(event.target.value)} placeholder="例如 Brazil；留空即全球"/></label><button className="primary" disabled={busy || !applications.some(item => item.selected && item.enabled)} onClick={createTask}><Search size={15}/> 创建客户发现任务</button></section>}
    {tasks.length > 0 && <section className="tds-task-list"><header><div><h3>4. 真实采集与客户清单</h3><p>运行后会按公开入口逐页核验企业官网、业务证据和公开联系方式；结果进入下方分层线索库，不会自动转入 CRM。</p></div><button className="secondary" disabled={busy} onClick={() => void work(async () => { await load(documentId); return '任务状态已刷新。' })}><RefreshCw size={14}/> 刷新状态</button></header>{tasks.map(task => <article key={task.id}><div><b>{task.task_name}</b><p>{task.target_region || '全球'} · {task.search_provider || '未配置采集入口'} · {task.status}</p><small>{task.provider_notice || '应用快照已锁定。'}{task.failure_message ? ` · ${task.failure_message}` : ''}</small></div><dl><div><dt>发现</dt><dd>{task.discovered_count}</dd></div><div><dt>官网核验</dt><dd>{task.verified_count}</dd></div><div><dt>应用相关</dt><dd>{task.matched_count}</dd></div><div><dt>有联系方式</dt><dd>{task.contact_count}</dd></div></dl><div className="tds-task-actions"><button className="primary" disabled={busy || task.status === '待配置' || task.status === '运行中'} onClick={() => runTask(task)}><Play size={14}/> {task.status === '已完成' || task.status === '部分失败' ? '再次运行' : '开始真实发现'}</button><button className="secondary" disabled={busy || task.discovered_count === 0} onClick={() => void work(async () => { await api.exportCustomerLeadsCsv(`application_task_id=${encodeURIComponent(task.id)}`); return '客户清单已导出。' })}><Download size={14}/> 导出清单</button></div></article>)}</section>}
  </section>
}
