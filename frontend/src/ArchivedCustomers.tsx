import { useState } from 'react'
import { api } from './api'
export function ArchivedCustomers(){
 const [open,setOpen]=useState(false),[rows,setRows]=useState<Awaited<ReturnType<typeof api.archivedCustomers>>>([]),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const load=async()=>{setOpen(true);setBusy(true);setError('');try{setRows(await api.archivedCustomers())}catch(e){setError(e instanceof Error?e.message:'读取失败')}finally{setBusy(false)}}
 return <><button onClick={()=>void load()}>已归档客户</button>{open&&<div className="modal-layer"><section className="modal" role="dialog" aria-label="已归档客户"><h2>已归档客户</h2><p>归档只从活跃客户列表移出，沟通、邮件、报价和项目历史保留。恢复后重新进入 CRM。</p>{error&&<p role="alert">{error}</p>}{busy?<p role="status">正在处理…</p>:rows.length?rows.map(row=><p key={row.id}>{row.company_name} · {row.contact_person} <button onClick={async()=>{setBusy(true);try{await api.archiveCustomer(row.id,false);window.location.reload()}catch(e){setError(e instanceof Error?e.message:'恢复失败');setBusy(false)}}}>恢复客户</button></p>):<p>没有已归档客户。</p>}<button onClick={()=>setOpen(false)}>关闭</button></section></div>}</>
}

