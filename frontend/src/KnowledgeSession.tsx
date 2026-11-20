import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from './knowledge-generated/lib/supabase'

let connection: Promise<void> | null = null
let connectionToken: string | null = null
let generation = 0
let linked: {token:string;userId:string;until:number}|null = null
export function connectKnowledge() {
 const workspaceToken=sessionStorage.getItem('zhiwu-access-token')
 if(connection&&connectionToken===workspaceToken)return connection
 const started=generation
 connectionToken=workspaceToken
 connection=(async()=>{
  if(!workspaceToken||!supabase)throw Error('请先登录工作站。')
  const existing=await supabase.auth.getSession()
  if(linked?.token===workspaceToken&&linked.until>Date.now()&&existing.data.session?.user.id===linked.userId&&Number(existing.data.session.expires_at)*1000>Date.now()+60000)return
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000)
  try {
   const response=await fetch(`${import.meta.env.VITE_API_URL||'https://zhiwu-os-api.gjsx.uno'}/api/auth/knowledge-session`,{method:'POST',headers:{Authorization:`Bearer ${workspaceToken}`},signal:controller.signal,cache:'no-store'})
   const result=await response.json()
   if(response.status===401){window.dispatchEvent(new Event('workspace-session-expired'));throw Error('工作站登录已过期，请重新登录。')}
   if(!response.ok)throw Error(typeof result.detail==='string'?result.detail:'暂时无法连接资料账号。')
   if(started!==generation||sessionStorage.getItem('zhiwu-access-token')!==workspaceToken)throw Error('工作站账号已变化，请重新打开资料。')
   const {data,error}=await supabase.auth.setSession({access_token:result.access_token,refresh_token:result.refresh_token})
   if(error)throw error
   if(started!==generation||sessionStorage.getItem('zhiwu-access-token')!==workspaceToken){await supabase.auth.signOut({scope:'local'});throw Error('工作站账号已退出，请重新登录。')}
   if(!data.session)throw Error('资料登录未完成，请重试。')
   linked={token:workspaceToken,userId:data.session.user.id,until:Date.now()+60000}
  }finally{clearTimeout(timer)}
 })().finally(()=>{if(connectionToken===workspaceToken){connection=null;connectionToken=null}})
 return connection
}
window.addEventListener('workspace-signout',()=>{generation++;connection=null;connectionToken=null;linked=null})
export function KnowledgeSession({children}:{children:ReactNode}) {
 const [state,setState]=useState<'loading'|'ready'|'error'>('loading'),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 useEffect(()=>{
  const subscription=supabase?.auth.onAuthStateChange(event=>{
   if(event==='SIGNED_OUT'&&sessionStorage.getItem('zhiwu-access-token')){linked=null;setState('loading');setAttempt(v=>v+1)}
  })
  return ()=>subscription?.data.subscription.unsubscribe()
 },[])
 useEffect(()=>{let active=true;setState('loading');void connectKnowledge().then(()=>{if(active)setState('ready')}).catch(reason=>{if(active){setState('error');setError(reason?.name==='AbortError'?'连接资料超时，请重试。':reason instanceof Error?reason.message:'资料连接失败。')}});return()=>{active=false}},[attempt])
 if(state==='loading')return <section className="private-entry" role="status">正在使用工作站账号连接私人资料…</section>
 if(state==='error')return <section className="private-entry"><h2>资料连接尚未完成</h2><p role="alert">{error}</p><button onClick={()=>setAttempt(v=>v+1)}>重新连接</button></section>
 return <>{children}</>
}
