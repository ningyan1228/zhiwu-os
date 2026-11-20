import { useState, type FormEvent } from 'react'
import { supabase } from './knowledge-generated/lib/supabase'
import { inquiryError, type Inquiry } from './knowledge-generated/lib/inquiries'

const shortFields = [['customer_name','客户 / 联系人'],['company','公司'],['country','国家 / 地区'],['product','产品'],['inquiry_time','询盘时间（源记录）'],['subject','原邮件主题'],['extra_request','额外要求']] as const
const longFields = [['inquiry_original','客户询盘原文'],['inquiry_zh','询盘中文对照'],['reply_original','回复原文'],['reply_zh','回复中文对照'],['source_metadata','来源与备注']] as const
export function InquiryEditor({row,ownerId,onSaved}:{row:Inquiry;ownerId:string;onSaved:(row:Inquiry)=>void}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[dirty,setDirty]=useState(false)
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(!supabase||busy)return
    const values=Object.fromEntries(new FormData(event.currentTarget))
    const changes=Object.fromEntries(Object.entries(values).filter(([key,value])=>value!==String(row[key as keyof Inquiry]??'')))
    if(!Object.keys(changes).length){setOpen(false);setNotice('内容没有变化。');return}
    setBusy(true);setError('');setNotice('')
    try {
      const session=await supabase.auth.getSession()
      if(session.error||session.data.session?.user.id!==ownerId)throw Error('账号已变化，请重新打开询盘。')
      const {data,error}=await supabase.rpc('edit_inquiry_content',{p_id:row.id,p_expected_version:row.version,p_changes:changes})
      if(error)throw error
      const saved=Array.isArray(data)?data[0]:data
      if(!saved||saved.id!==row.id||typeof saved.version!=='number')throw Error('保存结果尚未确认，请刷新核对后再操作。')
      onSaved(saved as Inquiry);setDirty(false);setOpen(false);setNotice('修改已保存，旧版本已保留；回复状态未改变。')
    }catch(reason){setError(inquiryError(reason))}finally{setBusy(false)}
  }
  return <section className="private-entry"><button type="button" disabled={busy} aria-expanded={open} onClick={()=>{if(open&&dirty&&!window.confirm('放弃尚未保存的修改？'))return;setDirty(false);setError('');setOpen(!open)}}>{open?'取消编辑':'编辑询盘与回复'}</button>{notice&&<p role="status">{notice}</p>}{open&&<form onSubmit={save} onChange={()=>setDirty(true)}><h3>编辑询盘与回复</h3><p>保存会保留旧版本。这里只更新资料，不发送邮件。</p><fieldset disabled={busy}><div className="entry-grid">{shortFields.map(([key,label])=><label key={key}>{label}<input name={key} defaultValue={row[key]||''} required={key==='product'} maxLength={30000}/></label>)}<label>原文语言<select name="language" defaultValue={row.language}><option value="en">英文</option><option value="vi">越南语</option></select></label></div>{longFields.map(([key,label])=><label key={key}>{label}<textarea name={key} defaultValue={row[key]||''} required={key==='inquiry_original'} maxLength={30000} rows={8}/></label>)}<button className="primary-button" type="submit">{busy?'保存中…':'保存修改'}</button></fieldset>{error&&<p role="alert">{error}</p>}</form>}</section>
}
