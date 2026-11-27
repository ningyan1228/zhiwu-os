import { useMemo, useState } from 'react'
import { marketProducts, type PublicLead } from './knowledge-generated/lib/productMarketMap'
import { matchedProductIds } from './knowledge-generated/lib/leadProductMatches'
import { outreachCompanyKey } from './knowledge-generated/lib/outreachLedger'
import { leadIndustry } from './knowledge-generated/lib/leadWorkbench'

export function CountryGallery({ leads }: { leads: PublicLead[] }) {
  const [country, setCountry] = useState('')
  const [product, setProduct] = useState('')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(24)
  const companies = useMemo(() => {
    const groups = new Map<string, PublicLead[]>()
    for (const lead of leads) {
      const key = outreachCompanyKey(lead)
      const group = groups.get(key)
      if (group) group.push(lead)
      else groups.set(key, [lead])
    }
    return [...groups.values()]
  }, [leads])
  const counts = new Map<string, number>()
  for (const [lead] of companies) counts.set(lead.countryZh, (counts.get(lead.countryZh) ?? 0) + 1)
  const countries = [...counts.keys()].sort((a,b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b,'zh'))
  const rows = companies.flatMap(group => {
    const lead = group.find(item => (!country || item.countryZh === country) && (!product || matchedProductIds(item).includes(product as PublicLead['productId'])) && [item.company,item.countryZh,item.companyEvidence.statement,leadIndustry(item)].join(' ').toLowerCase().includes(query.trim().toLowerCase()))
    return lead ? [lead] : []
  })
  const choose = (value:string) => {setCountry(value);setLimit(24)}
  return <main className="country-gallery"><h1>国家客户图鉴</h1><p>{companies.length} 家公司 · {countries.length} 个国家／地区</p>
    <section className="gallery-controls" aria-label="筛选客户"><div className="gallery-countries">{['',...countries.slice(0,8)].map(name=><button key={name} aria-pressed={country===name} onClick={()=>choose(name)}>{name || '全部国家'}</button>)}<select aria-label="选择全部国家或地区" value={country} onChange={e=>choose(e.target.value)}><option value="">所有国家／地区</option>{countries.map(name=><option key={name} value={name}>{name}（{counts.get(name)}）</option>)}</select></div>
    <div className="gallery-search"><select aria-label="匹配产品" value={product} onChange={e=>{setProduct(e.target.value);setLimit(24)}}><option value="">全部产品</option>{marketProducts.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input type="search" aria-label="搜索客户" placeholder="搜索公司、行业或业务" value={query} onChange={e=>{setQuery(e.target.value);setLimit(24)}}/></div></section>
    <p role="status">{country || '全部国家'} · {rows.length} 家客户</p>
    <div className="gallery-grid">{rows.slice(0,limit).map(lead=>{
      const material = product || lead.productId
      const image = material==='elo'?'linseed':material==='fertilizer-coating'?'granules':'pigment'
      return <article key={lead.id}><div className="gallery-photo"><img loading="lazy" alt="" src={'/material-covers/'+image+'.jpg'}/><span>{lead.countryZh}</span><small>材料示意图</small></div><div className="gallery-copy"><small>{leadIndustry(lead)}</small><h2>{lead.company}</h2><p>{lead.companyEvidence.statement}</p><strong>{marketProducts.find(p=>p.id===material)?.name}</strong><footer><a href={'#market-intelligence/map/'+lead.id}>查看客户详情 →</a><small>核验 {lead.checkedAt || '日期待核'}</small></footer></div></article>
    })}</div>
    {!rows.length && <p>没有匹配的客户。<button onClick={()=>{choose('');setProduct('');setQuery('')}}>清除筛选</button></p>}
    {rows.length>limit && <button className="gallery-more" onClick={()=>setLimit(limit+24)}>显示更多客户（已显示 {limit} / {rows.length}）</button>}
  </main>
}
