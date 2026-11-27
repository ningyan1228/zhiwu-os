import { useEffect, useState, type ReactNode, createContext, useContext } from 'react'
import { supabase } from './knowledge-generated/lib/supabase'

type Copy = { title: string; summary: string }
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

export function EditorialCopy({id,title,summary}:{id:string;title:string;summary:string}) {
  const context=useContext(Context)!
  const key=id==='trade-gov-export-basics'?'1f018f77-e4ea-46ce-a58e-3cf4822de280':id==='ifa-fertilizer'?'e46acd64-a42c-4657-83cd-45eb91a41129':id
  const value=context.rows[key]??{title,summary}
  const [draft,edit]=useState<Copy|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  if(!draft)return <><h2>{value.title}</h2><p style={{whiteSpace:'pre-wrap'}}>{value.summary}</p><button disabled={!context.owner} onClick={()=>{edit({...value});setError('')}}>编辑情报</button></>
  return <form style={{display:'grid',gap:10}} onSubmit={async e=>{
    e.preventDefault()
    if(!supabase||busy)return
    const copy={title:draft.title.trim(),summary:draft.summary.trim()}
    if(!copy.title||!copy.summary){setError('请填写标题和摘要');return}
    setBusy(true)
    try {
      const {error}=await supabase.from('bookmarks_notes').upsert({owner_id:context.owner,object_type:kind,object_id:key,note:JSON.stringify(copy)},{onConflict:'owner_id,object_type,object_id'})
      if(error)throw error
      context.saved(key,copy);edit(null)
    } catch {setError('保存失败，修改内容已保留，请重试。')} finally {setBusy(false)}
  }}><label>标题<input required value={draft.title} onChange={e=>edit({...draft,title:e.target.value})}/></label><label>摘要<textarea required rows={5} value={draft.summary} onChange={e=>edit({...draft,summary:e.target.value})}/></label>{error&&<span role="alert">{error}</span>}<div><button disabled={busy}>{busy?'保存中…':'保存'}</button> <button type="button" disabled={busy} onClick={()=>edit(null)}>取消</button></div></form>
}
