import {useState} from 'react'
type Spec={name:string;originalValue:string;condition?:string;note?:string;reviewStatus?:string}
export function ProductSpecs({specs,onSource}:{specs:Spec[];onSource:()=>void}){
 const [query,setQuery]=useState('')
 const shown=specs.filter(s=>(s.name+' '+s.originalValue+' '+(s.condition||'')+' '+(s.note||'')).toLowerCase().includes(query.toLowerCase()))
 return <section className="spec-library" aria-label="产品参数"><div className="spec-toolbar"><div><h3 id="product-parameters">技术参数</h3><p>原始数值与单位保留；使用前请核对测试条件。</p></div><input aria-label="搜索牌号或参数" placeholder="搜索牌号、参数或用途" value={query} onChange={e=>setQuery(e.target.value)}/></div><small className="spec-count">显示 {shown.length} / {specs.length} 项 · 学习手册摘录</small><div className="spec-cards">{shown.map(s=><article key={s.name} className="spec-card"><div className="spec-card-head"><h4>{s.name}</h4><span className="spec-state">{s.reviewStatus==='approved'?'已确认':s.reviewStatus==='rejected'?'存疑':'待原件核验'}</span></div><p className="spec-value">{s.originalValue}</p>{s.condition&&<p className="spec-condition"><b>测试条件</b>{s.condition}</p>}<details><summary>备注、来源与核验详情</summary><div className="spec-evidence">{s.note&&<p>{s.note}</p>}<p>核验人 / 日期：未记录</p><button className="text-button" onClick={onSource}>查看学习手册与来源 →</button></div></details></article>)}</div>{!shown.length&&<p>没有匹配的参数，请更换关键词。</p>}</section>
}
