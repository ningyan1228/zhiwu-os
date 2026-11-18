import { readFileSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
export function polishKnowledge(root) {
  function edit(name,fn){const p=join(root,name);writeFileSync(p,fn(readFileSync(p,'utf8')))}
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
