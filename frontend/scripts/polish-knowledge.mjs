import { readFileSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function polishKnowledge(root) {
  function edit(name,fn){const p=join(root,name);writeFileSync(p,fn(readFileSync(p,'utf8')))}
  edit('App.tsx',s=>{
    const start=s.indexOf("{account.status === 'anonymous' && <div className=\"login-form\">")
    const end=s.indexOf('</section>{user ? <DocumentImporter',start)
    if(start<0||end<start)throw Error('Knowledge account settings changed; review integration')
    s=s.slice(0,start)+'<p>资料已由工作站统一登录。退出或切换账号，请使用左下角的工作站账号菜单。</p>'+s.slice(end)
    return s.replace('先连接，再把资料放进来。','共用资料与设置').replace('已登录私人资料库','已连接共用资料').replace('私人资料按当前账号访问。','由工作站授权连接共用资料。')
  })
  edit('features/market/OutreachResults.tsx',s=>s.replace('看实际联系与后续进展，找到值得继续投入的方向。','来源：当前资料账号的客户开发记录；按公司去重及本页筛选统计，不含工作站 CRM 跟进计划。').replace('暂无到期计划','当前资料账号的客户开发记录暂无到期计划').replace('<summary>记录与查看实际结果</summary>','<summary>记录与查看实际结果</summary><p>第一步：搜索并选择公司；第二步：填写跟进计划或记录结果。</p>'))
  edit('lib/productMarketMap.ts',s=>s.replace("name: '环氧化亚麻油 ELO'","name: '环氧亚麻油 ELO（CAS 8016-11-3）'"))
  edit('lib/inquiries.ts',s=>s.replace('id: string; customer_name: string;', 'id: string; customer_name: string; country: string | null;').replace('id,customer_name,product,inquiry_time,status,version,position', 'id,customer_name,country,product,inquiry_time,status,version,position').replace("status: 'pending' | 'sent'", "status: 'pending' | 'sent' | 'replied' | 'closed'"))
  edit('features/inquiries/Inquiries.tsx',s=>{
    s="import { InquiryEditor } from '@/InquiryEditor'\nimport { NewInquiry } from '@/KnowledgeEntryForms'\n"+s
    s=s.replace('<dl className="inquiry-metadata">', '<InquiryEditor row={row} ownerId={ownerId} onSaved={next=>{setRow(next);onStatus(next)}}/><dl className="inquiry-metadata">')
    s=s.replace('{...r,status:next.status,version:next.version}', '{...r,customer_name:next.customer_name,country:next.country,product:next.product,inquiry_time:next.inquiry_time,status:next.status,version:next.version}')
    s=s.replace("const update=async()=>{", "const update=async(status:Inquiry['status'])=>{")
    s=s.replace("    const status=row.status==='pending'?'sent':'pending'", "")
    s=s.replace("status==='sent'?'确认已在原邮件线程实际发送这封回复？此操作只记录状态，不发送邮件。':'确认更正为待发送？原状态变更记录会保留。'", "'确认将回复状态改为'+({pending:'待发送回复',sent:'回复已发送',replied:'客户已回信',closed:'已关闭'}[status])+'？仅记录实际进展，不发送邮件。'")
    s=s.replaceAll("row.status==='sent'?'已发送':'待发送'", "({pending:'待发送回复',sent:'回复已发送',replied:'客户已回信',closed:'已关闭'}[row.status])")
    s=s.replaceAll("r.status==='sent'?'已发送':'待发送'", "({pending:'待发送回复',sent:'回复已发送',replied:'客户已回信',closed:'已关闭'}[r.status])")
    s=s.replace('<th>状态</th>', '<th>回复状态</th>')
    s=s.replaceAll('{row.customer_name}', "{row.customer_name?.trim() || `未提供姓名${row.country ? `（${row.country}）` : ''}`}")
    s=s.replaceAll('{r.customer_name}', "{r.customer_name?.trim() || `未提供姓名${r.country ? `（${r.country}）` : ''}`}")
    s=s.replace(`<button className="primary-button" disabled={busy} onClick={()=>void update()}>{busy?'保存中…':row.status==='sent'?'更正为待发送':'确认已实际发送'}</button>`, `<label>回复状态<select aria-label="回复状态" disabled={busy} value={row.status} onChange={e=>void update(e.target.value as Inquiry['status'])}><option value="pending">待发送回复</option><option value="sent">回复已发送</option><option value="replied">客户已回信</option><option value="closed">已关闭</option></select></label>`)
    s=s.replace('<p className="inquiries-guidance">', '<NewInquiry onSaved={()=>setRevision(v=>v+1)}/><p className="inquiries-guidance">')
    return s
  })
  edit('features/market/CustomerFollowUp.tsx',s=>s.replace('<h1>客户跟进</h1>','<h1>团队台账</h1>').replace(
    "const access = await followupRequest<FollowupAccess>(userId, '/access', undefined, controller.signal)\n      const index = await followupRequest<FollowupVersions>(userId, '/versions', undefined, controller.signal)",
    "const [access,index] = await Promise.all([followupRequest<FollowupAccess>(userId, '/access', undefined, controller.signal),followupRequest<FollowupVersions>(userId, '/versions', undefined, controller.signal)])"))
  edit('features/market/MarketIntelligence.tsx',s=>{
    s="import { MarketNavigation, PaneResize } from '@/KnowledgePolish'\n"+s
    const start=s.indexOf('<nav className="market-tabs"'),end=s.indexOf('</nav>',start)+6
    if(start<0||end<6)throw Error('Market navigation changed')
    s=s.slice(0,start)+'<MarketNavigation customerView={customerView} tab={tab} preferredView={preferredView} onOpen={openTab}/>'+s.slice(end)
    s=s.replace("'下载开发信'","'导出可开发客户'").replace('<span>{unsentEmails.length}</span>','<span>（{unsentEmails.length}）</span>')
    s=s.replace("{view === 'leads' && <CompanyDetail", "{view === 'leads' && wide && <PaneResize/>}\n      {view === 'leads' && <CompanyDetail")
    return s
  })
  edit('features/market/CustomerBrowseList.tsx',s=>s.replace('{marketProducts.find(p=>p.id===lead.productId)?.name}', '<span className="short-product-tag" title={marketProducts.find(p=>p.id===lead.productId)?.name}>{{\'cpp-cpo\':\'CPP / CPO\',\'nl-w1201\':\'NL-W1201\',\'elo\':\'ELO\',\'fertilizer-coating\':\'肥料包膜\'}[lead.productId]}</span>'))
  edit('features/market/CompanyDetail.tsx',s=>{
    s="import { CustomerProfileHeader } from '@/CustomerProfileHeader'\n"+s
    s=s.replace('<p className="eyebrow">COMPANY DETAIL · PUBLIC RESEARCH</p><h2 id="company-detail-title">{lead.company}</h2>', '<CustomerProfileHeader name={lead.company} subtitle="" source="客户档案 · 公开研究"/><span id="company-detail-title" className="sr-only">{lead.company}</span>')
    const start=s.indexOf('          <div className="company-detail-status">'),end=s.indexOf('</div>',start)+6
    if(start<0)throw Error('Company overview changed')
    const status=s.slice(start,end)
    s=s.slice(0,start)+s.slice(end)
    s=s.replace('<p className="company-lead-fact">','<h3 className="action-section-label">为什么值得联系</h3><p className="company-lead-fact">')
    s=s.replace('<ContactChannels lead={lead} /></section>','<h3 className="action-section-label">可用联系渠道</h3><ContactChannels lead={lead} /><button type="button" className="primary-button customer-primary-action" disabled={work.busy} onClick={()=>setActiveSection(\'outreach\')}>{ledger.status!==\'ready\'?\'核对记录并准备开发信\':sent?\'查看原开发信与跟进\':\'准备开发信\'} →</button></section>')
    s=s.replace('        evidence={<>','        evidence={<>\n          <details className="company-disclosure"><summary>收录与核验日期</summary>'+status+'</details>')
    return s
  })
}
