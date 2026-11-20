import {ReminderVisual} from './ReminderVisual'
import type {ReminderRow} from './followupModel'
import { useState } from 'react'
import type { Customer, Followup, Task, TradeCommitment } from './types'
import { chineseStage } from './CustomerMemory'
import './TradeDashboard.css'

export const businessDay = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.isNaN(Date.parse(value)) ? '' : value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)
}
type Props = { reminderRows:ReminderRow[]|null;reminderError:string; customers: Customer[]; followups: Followup[]; tasks: Task[]; commitments: TradeCommitment[]; status: string; onCRM:()=>void; onTasks:()=>void; onCommitments:()=>void; openCustomer:(c:Customer)=>void; refresh:()=>void }
export function TradeDashboard({reminderRows,reminderError,customers,followups,tasks,commitments,status,onCRM,onTasks,onCommitments,openCustomer,refresh}:Props){
  const today=businessDay(new Date().toISOString()), currentMonth=today.slice(0,7)
  const [month,setMonth]=useState(currentMonth),[selectedDay,setSelectedDay]=useState('')
  const inMonth=(d?:string|null)=>Boolean(d&&businessDay(d).startsWith(month))
  const monthRows=followups.filter(f=>inMonth(f.date)&&!f.content.startsWith('邮件自动归档：'))
  const completed=tasks.filter(t=>t.status==='Completed'&&inMonth(t.completed_at))
  const fulfilled=commitments.filter(c=>c.status==='已兑现'&&inMonth(c.completed_at))
  const planned=tasks.filter(t=>t.task_date===today)
  const pending=tasks.filter(t=>t.status!=='Completed'&&businessDay(t.task_date)&&t.task_date<=today).sort((a,b)=>a.task_date.localeCompare(b.task_date))
  const due=customers.filter(c=>!['Won','Lost','Maintain Relationship'].includes(c.customer_stage)&&businessDay(c.next_followup_date)&&c.next_followup_date<=today).sort((a,b)=>a.next_followup_date.localeCompare(b.next_followup_date))
  const own=commitments.filter(c=>['我方待办','待核对'].includes(c.status))
  const waiting=commitments.filter(c=>c.status==='等待客户')
  const days=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate()
  const daily=Array.from({length:days},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`;return {date,count:monthRows.filter(f=>businessDay(f.date)===date).length}})
  const max=Math.max(1,...daily.map(d=>d.count))
  const months=Array.from(new Set([currentMonth,...followups.map(f=>businessDay(f.date).slice(0,7)),...tasks.map(t=>businessDay(t.completed_at||'').slice(0,7)),...commitments.map(c=>businessDay(c.completed_at||'').slice(0,7))].filter(Boolean))).sort().reverse()
  const stages=Array.from(new Set(customers.map(c=>c.customer_stage))).map(stage=>({stage,count:customers.filter(c=>c.customer_stage===stage).length})).sort((a,b)=>b.count-a.count)
  const dayRows=monthRows.filter(f=>!selectedDay||businessDay(f.date)===selectedDay).sort((a,b)=>b.date.localeCompare(a.date))
  const customer=(id:string)=>customers.find(c=>c.id===id)
  const done=planned.filter(t=>t.status==='Completed').length
  return <section className="page trade-dashboard">
    <header className="trade-heading"><div><small>WORKSPACE / DAILY OVERVIEW</small><h1>今日工作</h1><p>{today} · 北京时间 · 从记录看进展，从待办推进业务</p></div><div><button onClick={refresh}>刷新数据</button><button className="primary" onClick={onTasks}>安排跟进</button></div></header>
    <section className="trade-block">{reminderRows?<ReminderVisual rows={reminderRows} open={openCustomer} table={onTasks}/>:<div role="status"><h2>跟进提醒正在连接</h2><p>{reminderError||'正在读取统一跟进表…'}</p><button onClick={refresh}>重新读取</button></div>}</section>
    {status!=='ready'?<section className="trade-block" role="status"><h2>{status==='error'?'业务数据读取未完成':'正在读取月度统计与承诺…'}</h2><p>统计暂不显示，避免把未读取的数据算作零。{status==='error'?'请刷新重试。':''}</p></section>:<>
    <div style={{marginTop:20}}><section className="trade-block"><div className="trade-section-head"><div><h2>本月工作记录</h2><p>记录量反映已录入的工作，不代表销售收入。</p></div><select aria-label="统计月份" value={month} onChange={e=>{setMonth(e.target.value);setSelectedDay('')}}>{months.map(m=><option key={m}>{m}</option>)}</select></div>
      <div className="trade-month-kpis"><div><b>{monthRows.length}</b><span>客户跟进记录 · 条</span></div><div><b>{new Set(monthRows.map(f=>f.customer_id)).size}</b><span>记录涉及客户 · 位</span></div><div><b>{completed.length}</b><span>完成任务 · 项</span></div><div><b>{fulfilled.length}</b><span>兑现承诺 · 条</span></div></div>
      <h3>每日跟进记录 <span>最高 {Math.max(...daily.map(d=>d.count),0)} 条 / 日</span></h3><div className="trade-chart" aria-label={`${month}每日跟进记录柱状图`}>{daily.map(d=><button aria-label={`${d.date}：${d.count}条跟进记录`} aria-pressed={selectedDay===d.date} title={`${d.date} · ${d.count} 条`} key={d.date} onClick={()=>setSelectedDay(selectedDay===d.date?'':d.date)}><span style={{height:`${d.count/max*100}%`}}/><small>{Number(d.date.slice(-2))%5===0||d.date.endsWith('01')?Number(d.date.slice(-2)):''}</small></button>)}</div><p className="trade-caption">按人工跟进记录填写的日期统计，排除邮件自动归档；点击日期查看记录。无记录不等于未开展工作。</p>
      <div className="trade-section-head"><h3>{selectedDay||month} · 跟进明细</h3>{selectedDay&&<button onClick={()=>setSelectedDay('')}>显示整月</button>}</div>{dayRows.slice(0,4).map(f=><button className="trade-record" key={f.id} onClick={()=>{const c=customer(f.customer_id);if(c)openCustomer(c);else onCRM()}}><div><b>{customer(f.customer_id)?.company_name||'客户待关联'}</b><small>{f.content}</small></div><time>{businessDay(f.date).slice(5)}</time></button>)}{!dayRows.length&&<p className="trade-empty">此期间暂无已录入的客户跟进记录。</p>}<p className="trade-caption">显示最近 {Math.min(4,dayRows.length)} / {dayRows.length} 条，完整历史请进入客户详情。</p>
    </section></div>
    <div className="trade-bottom-grid"><section className="trade-block"><div className="trade-section-head"><div><h2>客户当前阶段</h2><p>当前 CRM 档案分布 · {customers.length} 位；不是本月新增或转化漏斗。</p></div><button onClick={onCRM}>客户 CRM ↗</button></div><div className="trade-stages">{stages.map(s=><div key={s.stage}><span>{chineseStage[s.stage]||s.stage}</span><progress aria-label={`${chineseStage[s.stage]||s.stage}客户占比`} max={customers.length||1} value={s.count}/><b>{s.count}</b></div>)}</div>{!stages.length&&<p className="trade-empty">暂无客户档案。</p>}</section>
    <section className="trade-block"><div className="trade-section-head"><div><h2>承诺与交付</h2><p>报价、样品、付款、物流等，以台账实际录入为准。</p></div><button onClick={onCommitments}>打开台账 ↗</button></div>{[...own,...waiting].sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999')).slice(0,5).map(c=><button className="trade-record" onClick={onCommitments} key={c.id}><div><b>{c.title}</b><small>{customer(c.customer_id)?.company_name||'客户待关联'} · {c.status} · {c.category}</small></div><time>{c.due_date?.slice(5)||'未排期'}</time></button>)}{!own.length&&!waiting.length&&<p className="trade-empty">暂无我方待办、待核对或等待客户的承诺。</p>}</section></div>
    <footer className="trade-footnote">数据范围：当前账号可见的 CRM、跟进记录、任务及承诺台账。完成数量按明确的完成时间统计，缺少完成时间不计入月份；无金额推算。保存记录后，点击“刷新数据”更新面板。</footer>
    </>}
  </section>
}
