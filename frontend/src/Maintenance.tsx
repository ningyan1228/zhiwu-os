import {useEffect,useState,type ReactNode} from 'react'
import {Wrench,ArrowRight} from 'lucide-react'
import './Maintenance.css'
// Scheduled maintenance window, expressed in UTC (Beijing time is UTC+8).
export const maintenanceStartsAt = Date.parse('2026-11-20T15:59:00Z')
export const maintenanceEndsAt = Date.parse('2026-11-21T01:00:00Z')
const isMaintenanceActive = () => Date.now() >= maintenanceStartsAt && Date.now() < maintenanceEndsAt
export function MaintenanceGate({children}:{children:ReactNode}){const [active,setActive]=useState(()=>isMaintenanceActive());useEffect(()=>{const check=()=>setActive(isMaintenanceActive());const timer=setInterval(check,1000);window.addEventListener('focus',check);return()=>{clearInterval(timer);window.removeEventListener('focus',check)}},[]);return active?<Maintenance/>:<>{children}</>}
export function Maintenance(){return <main className="maintenance-screen"><div className="maintenance-brand">干就是学<span>工作站</span></div><section className="maintenance-dialog" role="alertdialog" aria-modal="true" aria-labelledby="maintenance-title" aria-describedby="maintenance-description"><div className="maintenance-icon"><Wrench size={28}/></div><span className="maintenance-label">WORKSPACE UPDATE</span><h1 id="maintenance-title">工作站正在升级维护</h1><p id="maintenance-description">我们正在优化页面体验与业务功能。<br/>维护期间，所有业务页面暂时停止访问，登录后也无法进入。</p><div className="maintenance-status"><i/>升级维护中 · 预计北京时间 11 月 21 日上午 9:00 恢复</div><button onClick={()=>window.location.reload()}>刷新查看恢复情况<ArrowRight size={16}/></button><small>感谢你的耐心等待，完成维护后即可继续使用。</small></section><footer>更清晰的工作界面，更顺畅的业务协作。</footer></main>}
