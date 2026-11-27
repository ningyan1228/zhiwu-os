import { useEffect, useRef, useState } from 'react'
import type { MarketTab } from './knowledge-generated/lib/leadViewPreference'

export function MarketNavigation({customerView,tab,preferredView,onOpen}:{customerView:boolean;tab:MarketTab;preferredView:'map'|'leads';onOpen:(tab:MarketTab)=>void}) {
  return <nav className="market-tabs polished-tabs" aria-label="客户开发导航"><button className={customerView?'active':''} aria-current={customerView?'page':undefined} onClick={()=>onOpen(preferredView)}>客户库</button><button className={tab==='results'?'active':''} aria-current={tab==='results'?'page':undefined} onClick={()=>onOpen('results')}>开发成果</button></nav>
}

const storageKey='workspace-customer-list-width'
export function PaneResize() {
  const ref=useRef<HTMLDivElement>(null)
  const [width,setWidth]=useState(()=>{try{const n=Number(localStorage.getItem(storageKey));return n>=38&&n<=68?n:56}catch{return 56}})
  useEffect(()=>{ref.current?.parentElement?.style.setProperty('--customer-list-width',width+'%');try{localStorage.setItem(storageKey,String(width))}catch{}},[width])
  const move=(clientX:number)=>{const box=ref.current?.parentElement?.getBoundingClientRect();if(box&&box.width)setWidth(Math.max(38,Math.min(68,(clientX-box.left)/box.width*100)))}
  return <div ref={ref} role="separator" tabIndex={0} aria-label="调整客户列表和详情宽度" aria-orientation="vertical" aria-valuemin={38} aria-valuemax={68} aria-valuenow={Math.round(width)} className="customer-pane-resizer" title="拖动调整宽度；方向键微调，双击恢复默认"
    onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);move(e.clientX)}}
    onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))move(e.clientX)}}
    onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
    onDoubleClick={()=>setWidth(56)} onKeyDown={e=>{const delta=e.key==='ArrowLeft'?-2:e.key==='ArrowRight'?2:0;if(delta){e.preventDefault();setWidth(v=>Math.max(38,Math.min(68,v+delta)))}else if(e.key==='Home'){e.preventDefault();setWidth(38)}else if(e.key==='End'){e.preventDefault();setWidth(68)}}}><span/></div>
}


