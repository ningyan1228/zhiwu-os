import type { Customer, Followup, MailEmail } from './types'
export type ReminderCustomer=Customer & {followup_revision?:number;followup_closed?:boolean;followup_reason?:string|null;followup_source?:string|null;followup_date_placeholder?:boolean}
export type ReminderFollowup=Followup & {created_at?:string;channel?:string;email_id?:string}
export type ReminderSnapshot={customers:ReminderCustomer[];followups:ReminderFollowup[];emails:MailEmail[];mail_baseline:string;mailboxes:{id:string;email:string;key:string}[];mail_sync:{status:string;last_sync_time?:string}[]}
export const reminderToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
export function validDay(value?:string|null){return !!value&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value}
export function reminderTiming(value?:string|null,today=reminderToday()){
 const days=validDay(value)?Math.round((Date.parse(value!+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null
 return {days,status:days===null?'待定':days<0?'已逾期':days===0?'今日到期':days<=3?'3 天内到期':days<=7?'7 天内到期':'后续跟进'}
}
export function reminderRows(data:ReminderSnapshot,today=reminderToday(),includeClosed=false){
 return data.customers.filter(c=>includeClosed||!c.followup_closed).map(c=>{
  const latest=data.followups.filter(f=>f.customer_id===c.id).sort((a,b)=>b.date.localeCompare(a.date)||(b.created_at||'').localeCompare(a.created_at||''))[0]
  const manual=data.followups.filter(f=>f.customer_id===c.id&&!f.content.startsWith('邮件自动归档：')).sort((a,b)=>b.date.localeCompare(a.date)||(b.created_at||'').localeCompare(a.created_at||''))[0]
  const date=c.followup_date_placeholder?null:validDay(c.next_followup_date)?c.next_followup_date:null
  const emails=data.emails.filter(e=>e.customer_id===c.id&&!e.is_internal_sender).sort((a,b)=>b.received_at.localeCompare(a.received_at))
  return {customer:c,latest,date,...reminderTiming(date,today),next:manual?.next_action||'尚未记录下一步',source:manual?.channel||(manual?.email_id?'邮箱':c.followup_source)||'未注明',emails}
 }).sort((a,b)=>(a.days??Infinity)-(b.days??Infinity)||a.customer.company_name.localeCompare(b.customer.company_name))
}
export type ReminderRow=ReturnType<typeof reminderRows>[number]
