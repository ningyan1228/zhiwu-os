import { useEffect, useState, type ReactNode, createContext, useContext } from 'react'
import { supabase } from './knowledge-generated/lib/supabase'

type Copy = { title: string; summary: string; createdAt?: string }
const kind = 'industry-editorial'
const Context = createContext<{ owner: string; rows: Record<string, Copy>; saved: (key: string, copy: Copy) => void } | null>(null)

export function EditorialProvider({children}:{children:ReactNode}) {
  const [owner,setOwner] = useState('')
  const [rows,setRows] = useState<Record<string,Copy>>({})
  const [error,setError] = useState('')
  const [attempt,retry] = useState(0)
  useEffect(()=>{
    let active=true
    async function load() {
      if (!supabase) throw Error()
      const {data:auth}=await supabase.auth.getUser()
      if (!auth.user) throw Error()
      const {data,error}=await supabase.from('bookmarks_notes').select('object_id,note').eq('owner_id',auth.user.id).eq('object_type',kind)
      if(error) throw error
      const entries=Object.fromEntries((data??[]).map(row=>[row.object_id,JSON.parse(row.note)]))
      if(active){setRows(entries);setOwner(auth.user.id);setError('')}
    }
    void load().catch(()=>{if(active)setError('编辑内容读取失败')})
    return ()=>{active=false}
  },[attempt])
  return <Context.Provider value={{owner,rows,saved:(key,copy)=>setRows(old=>({...old,[key]:copy}))}}>{error&&<button onClick={()=>retry(n=>n+1)}>{error} · 重试</button>}{children}</Context.Provider>
}

export function ManualIntelligence({category,showNews}:{category:string;showNews:()=>void}) {
  const context=useContext(Context)!
  const [newId,setNewId]=useState('')
  const entries=Object.entries(context.rows).filter(([,copy])=>copy.createdAt)
    .sort(([,a],[,b])=>b.createdAt!.localeCompare(a.createdAt!))
  return <>
    {newId ? <section className="article-card"><h2>新建情报</h2>
      <EditorialCopy key={newId} id={newId} title="" summary="" creating onDone={saved=>{setNewId('');if(saved)showNews()}}/>
    </section> : <div className="editorial-create"><button className="primary-button" disabled={!context.owner} onClick={()=>setNewId(crypto.randomUUID())}>＋ 新建情报</button></div>}
    {(category==='全部'||category==='行业资讯') && entries.map(([id,copy])=><article key={id} className="article-card">
      <div className="article-meta"><span>行业资讯</span><span>手动录入</span><time dateTime={copy.createdAt}>{new Date(copy.createdAt!).toLocaleDateString('zh-CN')}</time></div>
      <EditorialCopy id={id} title={copy.title} summary={copy.summary}/>
    </article>)}
  </>
}
export function EditorialCopy({id,title,summary,preview,creating=false,onDone}:{id:string;title:string;summary:string;preview?:string;creating?:boolean;onDone?:(saved:boolean)=>void}) {
  const context=useContext(Context)!
  const key=id==='trade-gov-export-basics'?'1f018f77-e4ea-46ce-a58e-3cf4822de280':id==='ifa-fertilizer'?'e46acd64-a42c-4657-83cd-45eb91a41129':id
  const value=context.rows[key]??{title,summary}
  const [draft,edit]=useState<Copy|null>(creating?{title,summary}:null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  if(!draft)return <><div className="editorial-title"><h2>{value.title}</h2><button disabled={!context.owner} onClick={()=>{edit({...value});setError('')}} aria-label={`编辑情报：${value.title}`}>编辑</button></div><p style={{whiteSpace:'pre-wrap'}}>{context.rows[key] || !preview ? value.summary : <><span className="editorial-full-summary">{value.summary}</span><span className="editorial-brief-summary">{preview}</span></>}</p></>
  return <form className="editorial-form" style={{display:'grid',gap:10}} onSubmit={async e=>{
    e.preventDefault()
    if(!supabase||busy)return
    const copy:Copy={...value,title:draft.title.trim(),summary:draft.summary.trim()}
    if(!copy.title||!copy.summary){setError('请填写标题和内容');return}
    if(creating)copy.createdAt=new Date().toISOString()
    setBusy(true)
    try {
      const {error}=await supabase.from('bookmarks_notes').upsert({owner_id:context.owner,object_type:kind,object_id:key,note:JSON.stringify(copy)},{onConflict:'owner_id,object_type,object_id'})
      if(error)throw error
      context.saved(key,copy);edit(null);onDone?.(true)
    } catch {setError('保存失败，修改内容已保留，请重试。')} finally {setBusy(false)}
  }}><label>标题<input required value={draft.title} onChange={e=>edit({...draft,title:e.target.value})}/></label><label>{creating||value.createdAt?'正文':'摘要'}<textarea required rows={5} value={draft.summary} onChange={e=>edit({...draft,summary:e.target.value})}/></label>{error&&<span role="alert">{error}</span>}<div><button disabled={busy}>{busy?'保存中…':'保存'}</button> <button type="button" disabled={busy} onClick={()=>{edit(null);onDone?.(false)}}>取消</button></div></form>
}
