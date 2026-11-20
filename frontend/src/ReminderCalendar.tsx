import {useState} from 'react'
import {FollowupBoard} from './FollowupBoard'
import {reminderToday,type ReminderRow,type ReminderSnapshot} from './followupModel'
import type {Customer,MailEmail} from './types'
export function ReminderCalendar({rows,data,openCustomer,openEmail,refresh}:{rows:ReminderRow[];data:ReminderSnapshot;openCustomer:(c:Customer)=>void;openEmail:(e:MailEmail)=>void;refresh:()=>Promise<void>}){
 const [month,setMonth]=useState(reminderToday().slice(0,7)),[day,setDay]=useState(reminderToday())
 const first=new Date(month+'-01T12:00:00Z'),offset=(first.getUTCDay()+6)%7,days=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate()
 return <><section className="page"><div className="trade-section-head"><h1>跟进日历</h1><input aria-label="日历月份" type="month" value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setDay(e.target.value+'-01')}}}/></div><p className="trade-caption">与首页、跟进表使用同一批真实日期。待定、占位日期及已关闭跟进不进入日历；待核记录保留在原日期，并单独标注。</p><div className="calendar-weekdays">{['一','二','三','四','五','六','日'].map(d=><span key={d}>周{d}</span>)}</div><div className="calendar-grid">{Array.from({length:offset},(_,i)=><div key={'blank'+i}/>)}{Array.from({length:days},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0'),found=rows.filter(r=>r.date===date);return <button key={date} className={`calendar-day ${day===date?'selected':''}`} onClick={()=>setDay(date)}><time>{i+1}</time>{found.slice(0,2).map(r=><span key={r.customer.id}>{r.dateReview?'日期待核 · ':''}{r.customer.company_name}</span>)}{!!found.length&&<small>{found.length} 条跟进</small>}</button>})}</div><h2>{day} · 当日跟进</h2></section><FollowupBoard rows={rows.filter(r=>r.date===day)} data={data} openCustomer={openCustomer} openEmail={openEmail} refresh={refresh}/></>
}
