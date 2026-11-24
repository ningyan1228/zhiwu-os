import { useEffect, useState } from 'react'
import { connectKnowledge } from './KnowledgeSession'
import { supabase } from './knowledge-generated/lib/supabase'
import { followupRequest, type FollowupVersions } from './knowledge-generated/lib/followupApi'
import type { Customer } from './types'
import './FullArchive.css'

type Row = Record<string, any>
type Archive = { data: Row; snapshot: Row }
let pending: Promise<Archive> | null = null
let sessionKey = ''
window.addEventListener('workspace-signout', () => { pending=null; sessionKey=''; window.dispatchEvent(new Event('archive-cleared')) })
const display=(value:unknown):string => (typeof value==='string'?value:JSON.stringify(value,null,2) || '待确认').replaceAll('薛孝敏','同事')
const bytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0))
export async function verifyArchive(value:string, expected:string){
 const raw=bytes(value), hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',raw))).map(b=>b.toString(16).padStart(2,'0')).join('')
 if(hash!==expected)throw Error('原文件校验失败，请刷新重试。')
 return raw
}
async function loadArchive(){
 const key=sessionStorage.getItem('zhiwu-access-token')||''
 if(pending&&key===sessionKey)return pending
 sessionKey=key
 pending=(async()=>{
  await connectKnowledge()
  const {data}=await supabase!.auth.getSession(),uid=data.session?.user.id
  if(!uid)throw Error('请重新登录工作站。')
  const versions=await followupRequest<FollowupVersions>(uid,'/versions')
  if(!versions.current_id)throw Error('尚无完整档案版本。')
  const snapshot=await followupRequest<Row>(uid,`/versions/${versions.current_id}`)
  if(!snapshot.package)throw Error('当前台账没有配套的全量数据包。')
  const raw=await verifyArchive(snapshot.package.source_base64,snapshot.package.content_hash)
  const archive=JSON.parse(new TextDecoder().decode(raw).replace(/^\uFEFF/,''))
  if(archive.dataset_id!=='neon-lion-all-customer-archive'||!Array.isArray(archive.customers))throw Error('当前数据包格式尚未支持。')
  if(key!==sessionStorage.getItem('zhiwu-access-token'))throw Error('账号已变化，请刷新。')
  return {data:archive,snapshot}
 })().catch(e=>{pending=null;throw e})
 return pending
}
function useArchive(){
 const [archive,setArchive]=useState<Archive|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{let active=true;setError('');loadArchive().then(a=>{if(active)setArchive(a)}).catch(e=>{if(active)setError(e.message)});const clear=()=>{setArchive(null);setError('请重新登录。')};window.addEventListener('archive-cleared',clear);return()=>{active=false;window.removeEventListener('archive-cleared',clear)}},[attempt])
 return {archive,error,retry:()=>{pending=null;setAttempt(n=>n+1)}}
}
const sourceId=(c:Customer)=>c.customer_tags?.find(t=>t.startsWith('archive-key:NL:'))?.slice('archive-key:NL:'.length)
async function download(snapshot:Row,kind:'md'|'json'){
 const item=kind==='json'?snapshot.package:snapshot
 const raw=await verifyArchive(item.source_base64,item.content_hash)
 const url=URL.createObjectURL(new Blob([raw],{type:kind==='json'?'application/json':'text/markdown'})),a=document.createElement('a');a.href=url;a.download=item.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function ArchivePanel({view,customers,openCustomer,customer}:{view:string;customers:Customer[];openCustomer?:(c:Customer)=>void;customer?:Customer}){
 const {archive,error,retry}=useArchive(),[query,setQuery]=useState(''),[downloadError,setDownloadError]=useState('')
 if(error)return <section className="full-archive"><p role="alert">完整档案：{error}</p><button onClick={retry}>重新读取档案</button></section>
 if(!archive)return <p className="full-archive" role="status">正在核对完整档案版本…</p>
 const {data,snapshot}=archive,cid=customer?sourceId(customer):undefined
 if(customer&&!cid)return null
 const records:Row[]=data.customers,byId=new Map<string,Row>(records.map(r=>[r.customer_id,r])),current=cid?byId.get(cid):null
 const relevant=(rows:Row[])=>rows.filter(r=>!cid||r.customer_id===cid)
 const label=(r:Row)=>{const c=byId.get(r.customer_id);return display(c?`${c.name} · ${r.product || r.product_text || c.product_text}`:r.name||r.title||'未归属记录')}
 const link=(r:Row)=>{const c=customers.find(c=>sourceId(c)===r.customer_id);return <button className="archive-customer" onClick={()=>c&&openCustomer?.(c)} disabled={!c||!openCustomer}>{label(r)}</button>}
 const matches=(r:Row)=>display(r).toLocaleLowerCase().includes(query.toLocaleLowerCase())||label(r).toLocaleLowerCase().includes(query.toLocaleLowerCase())
 const list=(title:string,rows:Row[],render:(r:Row)=>React.ReactNode,expanded=false)=><details open={expanded}><summary>{title} · {rows.length}</summary>{rows.filter(matches).map((r,i)=><article key={r.event_id||r.summary_id||r.task_id||r.customer_id||i}>{r.customer_id&&link(r)}{render(r)}</article>)}</details>
 const field=(title:string,value:unknown)=><p><strong>{title}：</strong>{display(value??'待确认')}</p>
 return <section className="full-archive" aria-label="同版本完整客户档案">
  <div className="archive-heading"><div><b>{customer?'完整客户档案':'全量业务档案'} · {display(data.package_date)}</b><small>资料整理日，不代表实际联系日；既有业务记录及历史继续保留。</small></div><div><button onClick={()=>{void download(snapshot,'md').catch(e=>setDownloadError(e.message))}}>完整 MD</button><button onClick={()=>{void download(snapshot,'json').catch(e=>setDownloadError(e.message))}}>原始 JSON</button><button onClick={retry}>刷新档案</button></div></div>
  {downloadError&&<p role="alert">{downloadError}</p>}
  {current&&<><p className="archive-current">{display(current.current_status)}</p>{field('下一步',current.next_action)}{field('待核与冲突',current.pending)}</>}
  <input aria-label="搜索完整档案" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索客户、产品、历史或待核事项…"/>
  {(view==='crm'||view==='projects'||view==='business-map'||view==='detail')&&list('客户当前档案',relevant(records),r=><>{field('关注产品',r.product_text)}{field('当前进度',r.current_status)}{field('下一步',r.next_action)}{field('待核事项',r.pending)}<details><summary>联系方式与完整字段</summary><pre>{display(r)}</pre></details></>)}
  {(view==='tasks'||view==='calendar'||view==='detail')&&list('待核任务与建议安排',relevant(data.proposed_tasks||[]),r=><>{field('下一步',r.action)}{field('优先级',r.priority)}{field('建议时机',r.suggested_timing)}{field('已确认期限',r.actual_due_date||'未排期；不是客户承诺')}</>,view==='tasks')}
  {(view==='quotes'||view==='detail')&&list('历史报价与付款依据',relevant(data.quote_summaries||[]),r=><>{field('金额及条款原记录',r.amount_and_terms_text)}{field('依据与限制',r.evidence_and_limitations)}<small>历史摘要，不是新报价或已接受订单；原报价版本保持独立。</small></>,view==='quotes')}
  {(view==='commitments'||view==='detail')&&list('约定、付款与寄样待核',relevant(data.commitments||[]),r=><>{field('事项',r.content)}{field('原记录日期',r.scheduled_date||r.estimated_date||r.tentative_date)}{field('确认情况',r.status)}<small>预约、预计与意向分别保留，不能据日期已过认定完成。</small></>)}
  {(view==='products'||view==='relationships')&&list('产品画像与供货边界',data.products||[],r=><><b>{display(r.family)} · {display(r.grade_text)}</b>{field('应用',r.application)}{field('对应客户',r.customer_text)}{field('核实边界',r.verification_note)}</>)}
  {(view==='products'||view==='relationships'||view==='detail')&&list('产品与客户对应',relevant(data.product_customer_relationships||[]),r=><>{field('产品',r.product_text)}{field('对应依据',r.basis_text)}{field('当前状态',r.current_status)}</>)}
  {(view==='mail'||view==='inquiries'||view==='detail')&&list('询盘完整原记录',relevant(data.inquiries||[]),r=><><p>资料中的发送状态与邮箱实际记录分别保留，差异待核；本次未重新读取实时邮箱。</p><pre>{display(r)}</pre></>,view==='inquiries')}
  {(view==='mail'||view==='detail')&&list('邮件客户别名与关联依据',relevant(data.email_customer_alias_rules||[]),r=><pre>{display(r)}</pre>)}
  {(view==='mail'||view==='detail'||view==='projects')&&list('有日期的证据时间线',relevant(data.activities||[]),r=><>{field('原日期',r.event_date)}{field('内容',r.summary)}<details><summary>完整证据字段</summary><pre>{display(r)}</pre></details></>)}
  {(view==='detail'||view==='crm')&&list('全部历史原文',relevant(data.customer_histories||[]),r=><>{Object.entries(r).filter(([k])=>k.endsWith('_markdown')).map(([k,v])=><details key={k}><summary>{k.match(/\d{4}_\d{2}_\d{2}/)?.[0].replaceAll('_','-')} 历史快照</summary><pre>{display(v)}</pre></details>)}<details><summary>历史更新与记录口径</summary><pre>{display(r.updates)}</pre>{field('保留原则',r.history_policy)}</details></>)}
  {(!customer&&['crm','imports'].includes(view))&&<details><summary>未归属线索、缺项与原始数据范围</summary><pre>{display({unassigned_lines:data.unassigned_lines,development_targets:data.development_targets,pesticide_requirements:data.pesticide_requirements,coverage_gaps:data.coverage_gaps})}</pre><p>历史结构化数据及完整快照可在完整 MD、原始 JSON 中逐字下载查看。</p></details>}
 </section>
}
