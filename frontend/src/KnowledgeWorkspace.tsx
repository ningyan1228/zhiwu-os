import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { App } from './knowledge-generated/App'
import { supabase } from './knowledge-generated/lib/supabase'
import { useAccountSession } from './knowledge-generated/lib/accountSession'
import { setKnowledgeRoot } from './KnowledgeDocument'
import leafletStyles from 'leaflet/dist/leaflet.css?inline'
import polishStyles from './KnowledgePolish.css?inline'

const styles = Object.values(import.meta.glob('./knowledge-generated/**/*.css', { eager:true, query:'?inline', import:'default' })) as string[]
window.addEventListener('workspace-signout',()=>{void supabase?.auth.signOut({scope:'local'})})
const layout = `:host{display:block;min-width:0;min-height:0;color:var(--text);font-family:system-ui,sans-serif}:host([data-theme="light"]){--blue:#246678;--blue-soft:#e8f2f1;--bg:#f8f7f2}:host([data-theme="dark"]){--blue:#a3d6dc;--blue-soft:#153b47} .app-shell,.app-shell.sidebar-collapsed{display:block!important;min-height:0!important;grid-template-columns:none!important}.main-area{margin:0!important;min-width:0;width:100%!important}.page-content{padding:20px!important}.knowledge-account{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--line);font-size:13px}.knowledge-account button{margin-left:auto}.knowledge-account small{color:var(--muted)} @media(max-width:600px){.page-content{padding:12px!important}}`

function AccountBar() {
  const account=useAccountSession()
  return <details className="knowledge-account-menu"><summary>{account.user?'资料已登录':account.status==='loading'?'确认账号…':'登录资料'}</summary><div><strong>阳光心材料资料账号</strong><span>{account.user?.email||'尚未登录'}</span><small>{account.user?'私有资料按此账号访问。':'验证原资料账号后查看私有询盘与台账。'}</small><button onClick={e=>{window.location.hash='settings';e.currentTarget.closest('details')?.removeAttribute('open')}}>资料账号与设置</button></div></details>
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
  const accountSlot=document.getElementById('knowledge-account-slot')
  return <><div ref={host} data-theme={theme} className="knowledge-host">{root&&createPortal(<><style>{leafletStyles+'\n'+styles.join('\n')+'\n'+layout+'\n'+polishStyles}</style><App/></>,root)}</div>{accountSlot&&createPortal(<AccountBar/>,accountSlot)}</>
}

