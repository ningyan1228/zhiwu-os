import { followupReferenceIds, identityFromLabel, internalFollowupKey, readFollowupIdentities, visibleFollowupText, type FollowupIdentity } from './followupIdentity.ts'

export type Source = { id: string; start: number; end: number; section: string; raw: string; historical?: boolean; relatedSources?: Source[] }
export type MarkdownBlock = Source & ({ kind: 'heading'; level: number; text: string } | { kind: 'table'; headers: string[]; rows: string[][]; rowLines: number[] } | { kind: 'text'; text: string })
export type FollowupEvent = { id: string; customerId: string; project: string; time: string; precision: string; type: string; content: string; source: Source; relatedSources?: Source[] }
export type FollowupTask = { id: string; customerId: string; project: string; action: string; waiting: string; dateNature: string; status: string; evidence: string; source: Source }
export type FollowupCustomer = { id: string; customer: string; product: string; contactPriorityRank: number | null; contactPriority: string; priorityReason: string; actionDate: string | null; actionLabel: string; lastEmailProcessedDate: string | null; processingDateLabel: string; processingActionText: string; processingDatePrecision: '日期' | '待核'; processingSourceText: string; processingSources: Source[]; sourceOrder: number; progress: string; status: string; next: string; detail: string; fields: { label: string; value: string }[]; customerTime: string; sentTime: string; waiting: string; dateNature: string; uncertainty: string; currentFields: Source[]; sources: Source[]; events: FollowupEvent[]; tasks: FollowupTask[] }
export type FollowupDocument = { title: string; blocks: MarkdownBlock[]; customers: FollowupCustomer[]; domestic: Source[]; sections: Source[]; events: FollowupEvent[]; tasks: FollowupTask[]; identities: FollowupIdentity[]; warnings: string[]; metadata: Record<string, string>; coverage: { total: number; retained: number; unretained: number }; failed: boolean }

// Render a deliberately small, text-only Markdown subset. Uploaded HTML is never executed.
export function markdownText(value: string) {
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\\\|/g, '|')
}

export function tableCells(line: string): string[] {
  const source = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  const cells: string[] = []
  let cell = '', quoted = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '`' && source[i - 1] !== '\\') quoted = !quoted
    if (char === '|' && source[i - 1] !== '\\' && !quoted) { cells.push(cell.trim()); cell = '' } else cell += char
  }
  cells.push(cell.trim())
  return cells
}

export function markdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n'), blocks: MarkdownBlock[] = []
  let section = '文件头与版本信息'
  for (let i = 0; i < lines.length; i++) {
    const first = i
    const line = lines[i]
    if (!line.trim()) continue
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    const source = (last: number): Source => ({ id: `source-L${first + 1}`, start: first + 1, end: last + 1, section, raw: lines.slice(first, last + 1).join('\n') })
    if (heading) { if (heading[1].length === 2) section = heading[2]; blocks.push({ ...source(i), kind: 'heading', level: heading[1].length, text: markdownText(heading[2]) }); continue }
    if (line.trim().startsWith('|') && lines[i + 1]?.trim().startsWith('|') && tableCells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = tableCells(line), rows: string[][] = [], rowLines: number[] = []
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(tableCells(lines[i])); rowLines.push(i + 1); i++ }
      i--
      blocks.push({ ...source(i), kind: 'table', headers, rows, rowLines }); continue
    }
    blocks.push({ ...source(i), kind: 'text', text: markdownText(line) })
  }
  return blocks
}

function validDate(value: string): string | null {
  const match = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (!match) return null
  const date = new Date(match[1] + 'T00:00:00Z')
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === match[1] ? match[1] : null
}

// Only an explicitly dated mail-processing field (optionally annotated) can drive this order. Ranges,
// incoming messages, legacy suggestions and import dates never fill missing dates.
export function mailProcessingDate(value: string): string | null {
  const label = value.trim()
  if (/^20\d{2}-\d{2}-\d{2}(?:（[^）]*）)?$/.test(label)) return validDate(label)
  if (/^20\d{2}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d（邮件显示）$/.test(label)) return validDate(label)
  if (/^20\d{2}-\d{2}-\d{2}（[^）]*）[；;](?:20\d{2}-)?\d{2}-\d{2}为(?:上一轮|此前|历史)/.test(label)) return validDate(label)
  if (/^20\d{2}-\d{2}-\d{2}[，,]用户确认已发$/.test(label)) return validDate(label)
  // The source may explicitly distinguish an outbound-mail date from a later
  // internal WeChat update in the same field. Keep the scoped mail date only.
  const scoped = /^(20\d{2}-\d{2}-\d{2})（对客(?:邮件)?）[；;].*内部(?:技术)?微信/.exec(label)
  return scoped ? validDate(scoped[1]) : null
}

export function sortByMailProcessing(rows: FollowupCustomer[]): FollowupCustomer[] {
  return [...rows].sort((a, b) => (b.lastEmailProcessedDate ?? '').localeCompare(a.lastEmailProcessedDate ?? '') || a.sourceOrder - b.sourceOrder)
}

export function sortByContactPriority(rows: FollowupCustomer[]): FollowupCustomer[] {
  return [...rows].sort((a, b) => (a.contactPriorityRank ?? Infinity) - (b.contactPriorityRank ?? Infinity) || a.sourceOrder - b.sourceOrder)
}

export function sortByNextFollowup(rows: FollowupCustomer[]): FollowupCustomer[] {
  return sortByContactPriority(rows).sort((a, b) => (a.actionDate ?? '9999').localeCompare(b.actionDate ?? '9999'))
}

function parseDocument(markdown: string): FollowupDocument {
  const blocks = markdownBlocks(markdown), warnings: string[] = []
  const identities = readFollowupIdentities(markdown)
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  const metadata: Record<string, string> = {}
  if (lines[0] === '---') for (const line of lines.slice(1, lines.indexOf('---', 1))) { const match = /^(\w+):\s*(.*)$/.exec(line); if (match) metadata[match[1]] = match[2].replace(/^(['"])([\s\S]*)\1$/, '$2') }
  if (metadata.sort_field === 'contact_priority' && !metadata.default_sort_field) metadata.default_sort_field = 'contact_priority_rank'
  // An explicitly historical snapshot remains readable but cannot overwrite the
  // selected version's master fields, priority, mail status or suggested tasks.
  const explicitArchiveStart = blocks.find(b => b.kind === 'heading' && b.level === 2 && /历史完整快照.*非当前执行表/.test(b.text))?.start
  const archiveStart = explicitArchiveStart ?? (metadata.archive_scope?.includes('historical_only') ? blocks.find(b => b.kind === 'heading' && b.level === 2 && /完整历史快照.*仅供溯源/.test(b.text))?.start ?? Infinity : Infinity)
  const sourceScope = <T extends Source>(source: T): T => source.start >= archiveStart ? { ...source, historical: true, section: '历史留档 · ' + source.section } : source
  const activeBlocks = blocks.filter(b => b.start < archiveStart)
  if (archiveStart !== Infinity) {
    const embedded = lines.slice(archiveStart).join('\n').match(/(?:^|\n)(---\ndataset_id:[\s\S]*)/)?.[1]
    if (embedded) for (const old of readFollowupIdentities(embedded)) {
      const current = identities.find(i => i.id === old.id)
      if (current) { current.aliases = [...new Set([...current.aliases, ...old.aliases])]; current.projects = old.projects }
    }
  }
  const sections: Source[] = blocks.filter(b => b.kind === 'heading' && b.level === 2).map((b, i, all) => sourceScope({ ...b, end: (all[i + 1]?.start ?? lines.length + 1) - 1, raw: lines.slice(b.start - 1, (all[i + 1]?.start ?? lines.length + 1) - 1).join('\n') }))
  const title = blocks.find(block => block.kind === 'heading' && block.level === 1)
  let inOverview = false
  let summary: Extract<MarkdownBlock, {kind: 'table'}> | undefined
  for (const block of activeBlocks) {
    if (block.kind === 'heading' && block.level === 2) inOverview = /客户总览|客户.*总表|按建议跟进时间|跟进.*总表|优先联系.*总表|联系优先级总表/.test(block.text)
    if (inOverview && block.kind === 'table' && block.headers.some(h => /客户/.test(h))) { summary = block; break }
  }
  if (!summary) warnings.push('未识别到客户总览表。完整原文仍可阅读；本次更新请先核对原文。')
  const details = new Map<string, Source>()
  const historicalDetails: Source[] = []
  for (const block of blocks) {
    if (block.kind !== 'heading' || block.level !== 3) continue
    const match = /^(C\d+|D\d+)[｜|]|^(\d+)\.\s/.exec(block.text)
    const previousLine = lines[block.start - 2] ?? ''
    const following = lines.slice(block.start, block.start + 3).find(line => line.trim()) ?? ''
    const explicitId = /master_record:\s*true/.test(previousLine) ? internalFollowupKey(previousLine) : /master_record:\s*true/.test(following) ? internalFollowupKey(following) : null
    const namedId = identities.find(i => i.displayName === visibleFollowupText(block.text).replace(/^\d+\.\s*/, ''))?.id
    const id = explicitId || namedId || (match ? match[1] || 'C' + match[2].padStart(2, '0') : null)
    if (!id) continue
    let end = blocks.find(b => b.start > block.start && b.kind === 'heading' && b.level <= 3)?.start ?? lines.length + 1
    if (/master_record:\s*true/.test(lines[end - 2] ?? '')) end--
    const start = /master_record:\s*true/.test(previousLine) ? block.start - 1 : block.start
    const detail = sourceScope({ ...block, start, end: end - 1, raw: lines.slice(start - 1, end - 1).join('\n').trim() })
    if (detail.historical) historicalDetails.push(detail)
    else details.set(id, detail)
  }
  const headers = summary?.headers.map(markdownText) ?? []
  // The supplied source has a missing pipe between these two labels. Repair only
  // the derived index, with an explicit warning; the immutable source is untouched.
  const joined = headers.findIndex(h => /具体下一步\s+最近已核客户消息时间/.test(h))
  if (joined >= 0 && summary?.rows.every(row => row.length === headers.length + 1)) {
    headers.splice(joined, 1, '具体下一步', '最近已核客户消息时间')
    warnings.push('源总表表头“具体下一步／最近已核客户消息时间”缺少分隔符，已按12个数据列分开读取；下载原文保持不变。')
  }
  const index = (pattern: RegExp) => headers.findIndex(header => pattern.test(header))
  const exactCustomerIndex = index(/^(?:客户(?:\s*\/\s*地区)?|国家及原档客户信息)$/)
  const customerIndex = exactCustomerIndex >= 0 ? exactCustomerIndex : index(/^客户(?!公司|显示|编号)/), productIndex = index(/^产品|^项目$/), dateIndex = index(/下一次跟进|建议.*日期|建议行动|跟进日/)
  const hasNextSchedule = headers[dateIndex] === '下次跟进日期'
  const progressIndex = index(/最新.*进度|最近有据可查|当前进展/), statusIndex = index(/当前状态|当前阶段|目前阶段|当前进展/), nextIndex = index(/具体下一步|^下一步|这次具体做什么/)
  const processingIndex = index(/^最近(?:邮件处理|处理邮件)日期$/), processingActionIndex = index(/^最近处理内容[／/]发送状态$/)
  let customers = (summary?.rows ?? []).map((row, n) => {
    const get = (i: number) => i < 0 ? '' : visibleFollowupText(markdownText(row[i] ?? ''))
    const idValue = row.find(value => internalFollowupKey(value)) ?? get(0), id = internalFollowupKey(idValue) || identities.find(i => i.displayName === visibleFollowupText(idValue))?.id || (/^C?\d+$/.test(idValue) ? 'C' + idValue.replace(/^C/, '').padStart(2, '0') : `row-${n}`)
    const actionLabel = get(dateIndex)
    const actionDate = hasNextSchedule && !/^20\d{2}-\d{2}-\d{2}$/.test(actionLabel) ? null : validDate(actionLabel)
    const processingDateLabel = get(processingIndex) || '待核', lastEmailProcessedDate = mailProcessingDate(processingDateLabel)
    const rankText = get(index(/^顺序$/)), contactPriorityRank = /^[1-9]\d*$/.test(rankText) ? Number(rankText) : null
    const identity = identities.find(i => i.id === id)
    const combined = /客户\s*·\s*产品/.test(headers[customerIndex] ?? '') ? identityFromLabel(id,get(customerIndex)) : null
    return { id, customer: combined?.name || get(customerIndex), product: combined?.product || get(productIndex) || identity?.product || '', contactPriorityRank, contactPriority: get(index(/^(?:联系)?优先级$/)), priorityReason: '', actionDate, actionLabel: actionLabel || '未注明建议日期', lastEmailProcessedDate, processingDateLabel, processingActionText: get(processingActionIndex) || '本版未提供邮件处理内容／发送状态，待核', processingDatePrecision: (lastEmailProcessedDate ? '日期' : '待核') as '日期' | '待核', processingSourceText: '', processingSources: [] as Source[], sourceOrder: n, progress: get(progressIndex), status: get(statusIndex), next: get(nextIndex), detail: details.get(id)?.raw ?? '', fields: headers.map((label, i) => ({ label, value: get(i) })), customerTime: get(index(/^最近已核客户消息/)), sentTime: get(index(/^最近已核我方发送/)), waiting: get(index(/当前等待对象/)), dateNature: get(index(/日期性质/)), uncertainty: get(index(/关键待确认/)), sources: [] as Source[], currentFields: [] as Source[], events: [] as FollowupEvent[], tasks: [] as FollowupTask[] }
  })
  for (const c of customers) if (!identities.some(i => i.id === c.id)) {
    const name = c.customer.replace(/^[^｜]*｜/, '').replace(/ \/ /g, '／') || c.id
    const parts = c.product.split(/；另有/)
    const identity = identityFromLabel(c.id, `${name} · ${parts[0] || '对应产品待确认'}`, /^D\d+$/.test(c.id) ? 'domestic' : 'overseas')
    if (parts[1]) { const product = parts[1].replace(/询盘.*$/, '').trim(); identity.projects.push({ product, displayName: `${name} · ${product}` }) }
    identities.push(identity)
  }
  for (const [id, detail] of details) if (/^D\d+$/.test(id) && !identities.some(i => i.id === id)) {
    const heading = /^###\s+(.+)$/m.exec(detail.raw)?.[1].replace(/^D\d+[｜|]/, '') ?? id
    const product = /^\| 产品 \| ([^|]+)/m.exec(detail.raw)?.[1].split('；')[0].trim() || '对应产品待确认'
    identities.push(identityFromLabel(id, `${heading} · ${product}`, 'domestic'))
  }
  customers = customers.filter(c=>!/^D\d+$/.test(c.id))
  const ids = customers.map(row => row.id)
  if (new Set(ids).size !== ids.length) warnings.push('总览存在重复编号，请核对原文；系统不会自动合并客户。')
  if (customers.some(row => !row.customer)) warnings.push('部分总览行没有客户名称，请核对原文。')
  if (processingIndex < 0 && customers.length && !customers.some(row => row.actionDate)) warnings.push('此版本未注明可识别的建议跟进日期，保留原表顺序。')
  // Versioned datasets own their row order, including ties. Retain the legacy
  // date ordering only for older ledgers without a dataset contract.
  if (metadata.default_sort_field === 'next_follow_up_date') customers = sortByNextFollowup(customers)
  else if (metadata.default_sort_field === 'contact_priority_rank' || metadata.sort_field === 'contact_priority') customers = sortByContactPriority(customers)
  else if (processingIndex >= 0) customers = sortByMailProcessing(customers)
  else if (!metadata.dataset_id) customers.sort((a, b) => (a.actionDate ?? '9999').localeCompare(b.actionDate ?? '9999'))
  const events: FollowupEvent[] = [], tasks: FollowupTask[] = []
  const rowSource = (b: Extract<MarkdownBlock, { kind: 'table' }>, i: number): Source => sourceScope({ id: `source-L${b.rowLines[i]}`, start: b.rowLines[i], end: b.rowLines[i], section: b.section, raw: [lines[b.start - 1], lines[b.start], lines[b.rowLines[i] - 1]].join('\n') })
  const tokens = (c: FollowupCustomer) => [...new Set([...c.customer.split(/｜| \/ /).map(s => s.trim()), ...(c.customer.match(/[A-Za-zÀ-ž][A-Za-zÀ-ž-]{3,}/g) ?? []), ...(c.detail.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [])])].filter(s => s.length >= 4 && /[a-zA-Z]/.test(s))
  const aliases = new Map(customers.map(c => [c.id, tokens(c).filter(t => customers.filter(other => tokens(other).includes(t)).length === 1)]))
  const belongs = (text: string, c: FollowupCustomer) => followupReferenceIds(text, identities).includes(c.id) || (aliases.get(c.id) ?? []).some(a => new RegExp(`(?<![\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text))
  for (const c of customers) {
    const detail = details.get(c.id)
    if (detail) c.sources.push(detail)
    c.sources.push(...historicalDetails.filter(s => internalFollowupKey(s.raw) === c.id))
    c.currentFields = activeBlocks.filter(b => detail && b.start >= detail.start && b.end <= detail.end && (b.kind === 'heading' && /当前核对字段/.test(b.text) || b.kind === 'table' && (b.headers[0] === '字段' || b.headers[0] === '项目' && /最新口径|^最新状态$/.test(b.headers[1] ?? ''))))
    const currentTable = c.currentFields.find((b): b is Extract<MarkdownBlock, { kind: 'table' }> => 'kind' in b && b.kind === 'table')
    if (currentTable?.headers[0] === '项目') {
      const field = (label: string) => markdownText(currentTable.rows.find(r => r[0] === label)?.[1] ?? '')
      const compactMail = field('最近邮件处理日期／实际发送')
      c.processingDateLabel = field('最近邮件处理日期') || compactMail || c.processingDateLabel
      c.lastEmailProcessedDate = mailProcessingDate(c.processingDateLabel)
      c.processingDatePrecision = c.lastEmailProcessedDate ? '日期' : '待核'
      c.processingActionText = field('最近处理内容/发送状态') || field('已发内容') || c.processingActionText
      c.processingSources.push(currentTable)
      c.processingSourceText = field('补充事实与边界')
      c.customerTime = field('最近有据可查客户消息')
      c.sentTime = field('最近已核我方发件') || (mailProcessingDate(compactMail) && /用户确认已发/.test(compactMail) ? compactMail : '')
      c.waiting = field('等待对象')
      c.priorityReason = field('为什么排在这里')
      // These source notes may explicitly retain an earlier state. Keep the
      // note, while directing readers to the current execution record first.
      if (c.processingSourceText && /最新执行记录/.test(c.detail)) c.processingSourceText = '源表补充说明（含历史口径，请结合下方最新执行记录核对）：' + c.processingSourceText
    }
    for (const b of blocks) {
      if (b === summary || (detail && b.start >= detail.start && b.end <= detail.end)) continue
      if (b.kind === 'table') b.rows.forEach((row, i) => {
        if (belongs(markdownText(row.join(' ')), c)) {
          const source = rowSource(b, i)
          c.sources.push(source)
          if (!source.historical && b.headers.includes('最近邮件处理日期') && b.headers.includes('依据') && internalFollowupKey(row[0]) === c.id) {
            c.processingSources.push(source)
            c.processingSourceText = markdownText(row[b.headers.indexOf('依据')] ?? '')
          }
        }
      })
      else if (b.kind === 'text' && belongs(b.raw, c)) c.sources.push(sourceScope(b))
    }
    if (summary) {
      const i = c.sourceOrder
      if (i >= 0) {
        if (processingIndex >= 0) c.processingSources.unshift(rowSource(summary, i))
        const dateNature = hasNextSchedule
          ? `${c.actionLabel} · 内部跟进安排`
          : processingIndex >= 0 ? '下一次实际排期待确认；旧建议仅在详情历史参考中保留' : `${c.actionLabel} · ${c.dateNature || '原表建议，非已确认排期'}`
        tasks.push({ id: `${c.id}-suggested-L${summary.rowLines[i]}`, customerId: c.id, project: c.product, action: c.next || '原文未提供', waiting: c.waiting || '待确认', dateNature, status: /暂停|暂不供货|触发后再跟进/.test(`${c.actionLabel} ${c.status}`) ? '暂停／条件触发；处理情况待核' : '建议行动，处理情况待核', evidence: '原文未提供完成依据，未自动标完成', source: rowSource(summary, i) })
      }
    }
  }
  const eventType = (label: string) => /草稿|拟|编辑窗口/.test(label) ? '我方草稿／发送待核' : /已发送|已回复|我方.*已发/.test(label) ? '我方已发送（按源记录）' : /客户.*回复|客户.*邮件|客户.*动作|客户.*来信/.test(label) ? '客户来信／动作' : /工厂|技术反馈|内部/.test(label) ? '内部协调／技术反馈' : /更正|纠正/.test(label) ? '历史更正' : /PI|文件|箱唛/.test(label) ? '文件／版本记录（非发送证明）' : '历史记录（类型按原文待核）'
  for (const b of blocks) if (b.kind === 'table') b.rows.forEach((row, i) => {
    const source = rowSource(b, i), cells = row.map(markdownText)
    const eventId = internalFollowupKey(row[0], 'event'), taskId = internalFollowupKey(row[0], 'task')
    if (b.headers[0] === '事件编号' || eventId) {
      const id = eventId || cells[0], customerId = internalFollowupKey(row[1]) || id.split('-')[0]
      events.push({ id, customerId, project: customers.find(c => c.id === customerId)?.product ?? '按原始事件记录', time: cells[2], precision: timePrecision(cells[2]), type: cells[4], content: b.headers.map((h, k) => `${h}：${cells[k] ?? ''}`).join('\n'), source })
    } else if (b.headers[0] === '任务编号' || taskId) {
      const id = taskId || cells[0]
      tasks.push({ id, customerId: id.split('-')[0], project: customers.find(c => c.id === id.split('-')[0])?.product ?? '待确认', action: cells[1], waiting: cells[2], dateNature: cells[3], status: cells[4], evidence: cells[5], source })
    } else if (!source.historical && /新增.*事件/.test(b.section) && /^(日期|事件日期)$/.test(b.headers[0])) {
      const customerId = followupReferenceIds(row[1] ?? '', identities)[0]
      if (customerId) events.push({ id: `${customerId}-history-L${source.start}`, customerId, project: identities.find(c => c.id === customerId)?.product ?? '待确认', time: cells[0], precision: timePrecision(cells[0]), type: '新增／纠正记录（按原文）', content: b.headers.map((h, k) => `${h}：${cells[k] ?? ''}`).join('\n'), source })
    } else if (!source.historical && /新增.*事件/.test(b.section) && b.headers[0] === '项目' && b.headers[1] === '最新进展') {
      const customerId = followupReferenceIds(row[0] ?? '', identities)[0]
      const heading = blocks.filter(h => h.kind === 'heading' && h.level === 3 && h.start < b.start).at(-1)
      const time = heading && 'text' in heading ? heading.text.replace(/新增事件.*$/, '').trim() : '日期待核'
      if (customerId) events.push({ id: `${customerId}-history-L${source.start}`, customerId, project: identities.find(c => c.id === customerId)?.product ?? '待确认', time, precision: timePrecision(time), type: '本版新增事件（时间按源章节）', content: cells.join('\n'), source })
    } else if (!source.historical && /国内对接/.test(b.section) && b.headers[0] === '对象') {
      const customerId = internalFollowupKey(row[0])
      if (customerId) tasks.push({ id: `${customerId}-suggested-L${source.start}`, customerId, project: identities.find(c => c.id === customerId)?.product ?? '待确认', action: cells[3], waiting: '按源记录核对；不自动指派', dateNature: '原文内部建议／条件触发，不确认为承诺排期', status: '处理情况按原文；不自动完成', evidence: cells[2], source })
    } else if (!source.historical && /国内询盘/.test(b.section) && b.headers.includes('建议行动')) {
      const domesticId = internalFollowupKey(row[0])?.match(/^D\d+/)?.[0]
      tasks.push({ id: `${domesticId || 'other'}-source-L${source.start}`, customerId: domesticId || '国内／未归属／开发目标／内部', project: cells[0], action: cells[2], waiting: '源文未单列负责人，待确认', dateNature: cells[1] + '；排期性质按源记录，不确认为预约', status: '处理情况待核；不自动完成', evidence: '需取得实际处理记录', source })
    } else {
      const c = customers.find(c => [details.get(c.id), ...historicalDetails.filter(s => internalFollowupKey(s.raw) === c.id)].some(d => d && b.start >= d.start && b.end <= d.end))
      if (c && /\d{1,2}[-月]\d{1,2}/.test(cells[0]) && !/建议|下一步|行动/.test(cells[0])) events.push({ id: `${c.id}-history-L${source.start}`, customerId: c.id, project: c.product, time: cells[0], precision: timePrecision(cells[0]), type: eventType(cells[0]), content: cells.join('\n'), source })
    }
  })
  // Explicit event IDs identify the original event. Historical mentions with the
  // same exact minute are additional evidence, not a second business event.
  for (const explicit of events.filter(e => !e.id.includes('-history-'))) {
    const minute = explicit.time.match(/\d{2}-\d{2}\s+\d{2}:\d{2}/)?.[0]
    if (!minute) continue
    const duplicates = events.filter(e => e.id.includes('-history-') && e.customerId === explicit.customerId && e.source.historical === explicit.source.historical && e.time.includes(minute))
    explicit.relatedSources = duplicates.map(e => e.source)
    for (const duplicate of duplicates) events.splice(events.indexOf(duplicate), 1)
  }
  for (const c of customers) { c.events = events.filter(e => e.customerId === c.id); c.tasks = tasks.filter(t => t.customerId === c.id) }
  const domestic = [...details.entries()].filter(([id]) => /^D\d+$/.test(id)).map(([, source]) => source)
  for (const b of activeBlocks) if (b.kind === 'table' && /国内对接/.test(b.section) && b.headers[0] === '对象') b.rows.forEach((row, i) => {
    const id = internalFollowupKey(row[0])
    if (!id || domestic.some(s => internalFollowupKey(s.raw) === id)) return
    const relatedSources: Source[] = activeBlocks.filter(s => s.kind === 'text' && s.section === b.section && new RegExp(`\\b${id}\\b`).test(s.raw)).map(sourceScope)
    relatedSources.push(...historicalDetails.filter(s => internalFollowupKey(s.raw) === id))
    domestic.push({ ...rowSource(b, i), relatedSources })
  })
  if (blocks.some(b => b.kind === 'text' && visibleFollowupText(b.raw) && /^\s*(```|~~~|<|>)/.test(b.raw))) warnings.push('引用、代码或HTML等补充块以安全原文展示；未执行嵌入内容，全部保留。')
  return { title: title?.kind === 'heading' ? title.text : '客户跟进台账', blocks, customers, domestic, sections, events, tasks, identities, warnings, metadata, coverage: { total: blocks.length, retained: blocks.length, unretained: 0 }, failed: false }
}

export function timePrecision(value: string) { return /未核|未知|待核/.test(value) ? '时间待核（保留原文）' : /约/.test(value) ? '约略时间（按原文）' : /\d{1,2}:\d{2}/.test(value) ? '时分（时区按原文）' : '日期／范围（不补时分）' }

export function parseFollowup(markdown: string): FollowupDocument {
  try { return parseDocument(markdown) } catch {
    return { title: '原文已保留，解析失败', blocks: [], customers: [], domestic: [], sections: [], events: [], tasks: [], identities: [], warnings: ['解析失败：仅显示本版本完整源文本；未使用旧版索引。'], metadata: {}, coverage: { total: 1, retained: 1, unretained: 0 }, failed: true }
  }
}

export function compareFollowup(previous: FollowupDocument | null, next: FollowupDocument) {
  if (!previous) return { added: next.customers.length, changed: 0, removed: 0 }
  const old = new Map(previous.customers.map(row => [row.id, row]))
  const fresh = new Set(next.customers.map(row => row.id))
  return { added: next.customers.filter(row => !old.has(row.id)).length,
    changed: next.customers.filter(row => old.has(row.id) && JSON.stringify(row) !== JSON.stringify(old.get(row.id))).length,
    removed: previous.customers.filter(row => !fresh.has(row.id)).length }
}
