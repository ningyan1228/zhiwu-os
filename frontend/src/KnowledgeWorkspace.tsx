import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { App } from './knowledge-generated/App'
import { supabase } from './knowledge-generated/lib/supabase'
import { useAccountSession } from './knowledge-generated/lib/accountSession'
import { setKnowledgeRoot } from './KnowledgeDocument'
import leafletStyles from 'leaflet/dist/leaflet.css?inline'

const styles = Object.values(import.meta.glob('./knowledge-generated/**/*.css', { eager:true, query:'?inline', import:'default' })) as string[]
window.addEventListener('workspace-signout',()=>{void supabase?.auth.signOut({scope:'local'})})
const layout = `:host{display:block;min-width:0;min-height:0;color:var(--text);font-family:system-ui,sans-serif}:host([data-theme="light"]){--blue:#246678;--blue-soft:#e8f2f1;--bg:#f8f7f2}:host([data-theme="dark"]){--blue:#a3d6dc;--blue-soft:#153b47} .app-shell,.app-shell.sidebar-collapsed{display:block!important;min-height:0!important;grid-template-columns:none!important}.main-area{margin:0!important;min-width:0;width:100%!important}.page-content{padding:20px!important}.knowledge-account{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--line);font-size:13px}.knowledge-account button{margin-left:auto}.knowledge-account small{color:var(--muted)} @media(max-width:600px){.page-content{padding:12px!important}}`

function AccountBar() {
  const account=useAccountSession()
  return <div className="knowledge-account"><strong>阳光心材料</strong><span>{account.user?.email || (account.status==='loading'?'正在确认资料账号…':'私有资料尚未登录')}</span><small>{account.user?'按此资料账号的权限访问':'首次使用请验证原资料账号；工作站账号与资料账号独立。'}</small><button className="secondary-button" onClick={()=>{window.location.hash='settings'}}>资料账号与设置</button></div>
}

export default function KnowledgeWorkspace({theme}:{theme:'light'|'dark'}) {
  const host=useRef<HTMLDivElement>(null)
  const [root,setRoot]=useState<ShadowRoot|null>(null)
  useEffect(()=>{
    if(!host.current)return
    const shadow=host.current.shadowRoot || host.current.attachShadow({mode:'open'})
    setKnowledgeRoot(shadow);setRoot(shadow)
    return ()=>{setKnowledgeRoot(null)}
  },[])
  return <div ref={host} data-theme={theme} className="knowledge-host">{root&&createPortal(<><style>{leafletStyles+'\n'+styles.join('\n')+'\n'+layout}</style><AccountBar/><App/></>,root)}</div>
}

