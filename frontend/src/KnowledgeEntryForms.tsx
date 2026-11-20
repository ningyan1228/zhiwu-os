import { useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './knowledge-generated/lib/supabase'
import { useAccountSession } from './knowledge-generated/lib/accountSession'

function message(error: unknown) {
  const e=error as {code?:string;message?:string}
  return ['42P01','PGRST202','PGRST205'].includes(e.code||'')?'此录入功能尚待管理员安装 202611180001_private_entry_forms 数据库迁移。':e.message||'保存失败，请重试。'
}
export function NewInquiry({onSaved}:{onSaved:()=>void}) {
  const account=useAccountSession(), [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID())
  const formRef=useRef<HTMLFormElement>(null)
  const [notice,setNotice]=useState('')
  const readFile=async(file:File)=>{
    setError('');setNotice('')
    try{
      if(file.size>200000)throw Error('文件超过 200 KB，请每次选择一封询盘。')
      const data=JSON.parse((await file.text()).replace(/^\uFEFF/,''))
      if(!data||Array.isArray(data)||typeof data!=='object')throw Error('请选择单封询盘的数据文件。')
      for(const key of ['product','inquiry_original'])if(typeof data[key]!=='string'||!data[key].trim())throw Error('文件缺少产品或询盘原文，尚未保存。')
      const fields:Record<string,unknown>={customer_name:data.customer_name||'未提供姓名',company:data.company||'',country:data.country_region??data.country??'',product:data.product,subject:data.subject||'',inquiry_time:data.inquiry_datetime??data.inquiry_time??'',language:data.inquiry_lang??data.language??'en',inquiry_original:data.inquiry_original,inquiry_zh:data.inquiry_zh||'',reply_original:data.reply_original||'',reply_zh:data.reply_zh||'',source_metadata:[`录入文件：${file.name}`,data.source_metadata||data.notes||'',data.extra_requests?`额外要求：${Array.isArray(data.extra_requests)?data.extra_requests.join('; '):data.extra_requests}`:''].filter(Boolean).join('\n')}
      if(!['en','vi'].includes(String(fields.language)))throw Error('当前支持英文和越南语，请核对原文语言。')
      for(const [key,value] of Object.entries(fields)){
        if(typeof value!=='string'||value.length>30000)throw Error('文件字段格式或长度不符合要求。')
      }
      for(const [key,value] of Object.entries(fields)){
        const control=formRef.current?.elements.namedItem(key) as HTMLInputElement|null
        if(control)control.value=String(value)
      }
      setRequestId(crypto.randomUUID());setNotice('文件已填入下方表单，尚未保存。请核对后点击“保存询盘”；回复状态默认为待发送。')
    }catch(e){setError(message(e))}
  }
  if(!account.user)return null
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(!supabase||busy)return;setBusy(true);setError('')
    try{const data=Object.fromEntries(new FormData(e.currentTarget));const result=await supabase.rpc('create_manual_inquiry',{p_request_id:requestId,p_data:data});if(result.error)throw result.error;if(!result.data)throw Error('服务器未返回记录，请重新读取确认。');setOpen(false);setRequestId(crypto.randomUUID());setNotice('询盘已保存到当前资料账号，回复状态为待发送。');onSaved()}
    catch(e){setError(message(e))}finally{setBusy(false)}
  }
  return <section className="private-entry"><button className="primary-button" onClick={()=>setOpen(v=>!v)}>{open?'收起录入':'新增询盘'}</button>{notice&&<p role="status">{notice}</p>}{open&&<form ref={formRef} onSubmit={submit}><h2>新增私人询盘</h2><label>从资料文件填写（单封 JSON）<input type="file" accept=".json,application/json" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void readFile(file)}}/></label><p>保存到当前资料账号；默认待发送回复。保存不会发送邮件。</p><div className="entry-grid">{[['customer_name','客户 / 联系人',true],['company','公司',false],['country','国家 / 地区',false],['product','产品',true],['subject','原邮件主题',false],['inquiry_time','收到日期（可保留源记录）',false]].map(([name,label,required])=><label key={String(name)}>{label}<input name={String(name)} required={Boolean(required)} maxLength={500}/></label>)}<label>原文语言<select name="language"><option value="en">英文</option><option value="vi">越南语</option></select></label></div>{[['inquiry_original','询盘原文',true],['inquiry_zh','询盘中文对照',false],['reply_original','回复原文（未准备可留空）',false],['reply_zh','回复中文对照',false],['source_metadata','来源与备注',true]].map(([name,label,required])=><label key={String(name)}>{label}<textarea name={String(name)} required={Boolean(required)} maxLength={30000}/></label>)}<button className="primary-button" disabled={busy}>{busy?'保存中…':'保存询盘'}</button>{error&&<p role="alert">{error}</p>}</form>}</section>
}
type Verification={id:string;product:string;grade:string;parameter:string;verified_value:string;evidence:string;verified_by:string;verified_date:string}
export function ParameterVerification() {
  const [saved,setSaved]=useState('')
  const [entryId,setEntryId]=useState(()=>crypto.randomUUID())
  const account=useAccountSession(),[rows,setRows]=useState<Verification[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[open,setOpen]=useState(false)
  useEffect(()=>{if(!open||!account.user||!supabase)return;const controller=new AbortController();setError('');setRows([]);void supabase.from('product_parameter_verifications').select('id,product,grade,parameter,verified_value,evidence,verified_by,verified_date').eq('owner_id',account.user.id).order('created_at',{ascending:false}).abortSignal(controller.signal).then(({data,error})=>{if(controller.signal.aborted)return;if(error)setError(message(error));else setRows(data||[])});return()=>controller.abort()},[open,account.user?.id,revision])
  if(!account.user)return <p className="private-entry">登录资料账号后可录入私人产品参数核验记录。</p>
  const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();if(!supabase||busy)return;const form=e.currentTarget;setBusy(true);setError('');try{const values=Object.fromEntries(new FormData(form));const {error}=await supabase.from('product_parameter_verifications').insert({...values,id:entryId,owner_id:account.user!.id});if(error){if(error.code==='23505')throw Error('这条记录可能已保存，请收起后重新打开核验记录确认，不要重复新增。');throw error}form.reset();setEntryId(crypto.randomUUID());setSaved('核验记录已保存，已保留原有历史。');setRevision(v=>v+1)}catch(e){setError(message(e))}finally{setBusy(false)}}
  return <section className="private-entry"><button className="secondary-button" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>产品参数核验记录</button>{open&&<><h2>私人参数核验</h2>{saved&&<p role="status">{saved}</p>}<p>只保存到当前资料账号。每次核验追加历史记录，不覆盖原始 TDS；填入单位、方法、温度和文件页码。</p><form onSubmit={submit}><div className="entry-grid">{[['product','产品'],['grade','牌号'],['parameter','参数'],['verified_value','核验值 / 单位 / 条件'],['verified_by','核验人'],['verified_date','核验日期']].map(([name,label])=><label key={name}>{label}<input name={name} type={name==='verified_date'?'date':'text'} required maxLength={500}/></label>)}</div><label>核验依据<textarea name="evidence" required maxLength={4000} placeholder="资料文件名、版本、页码、测试方法"/></label><button className="primary-button" disabled={busy}>{busy?'保存中…':'追加核验记录'}</button></form>{error&&<p role="alert">{error}</p>}<div className="table-wrap"><table><thead><tr>{['产品 / 牌号','参数与核验值','核验人 / 日期','依据'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id}><td>{r.product} / {r.grade}</td><td>{r.parameter}：{r.verified_value}</td><td>{r.verified_by} · {r.verified_date}</td><td>{r.evidence}</td></tr>)}</tbody></table></div></>}</section>
}
