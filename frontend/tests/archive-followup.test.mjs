import assert from 'node:assert/strict'
import { archiveIsCurrent, customerPlan, latestManualFollowup, reminderRows } from '../src/followupModel.ts'
const customer={id:'customer',company_name:'Example',customer_tags:['archive-key:NL:C01','archive-sync:2026-11-24T10:00:00Z'],next_action:['核对实际结果'],next_followup_date:null}
const old={id:'old',customer_id:'customer',date:'2026-11-20',created_at:'2026-11-20T09:00:00Z',content:'旧沟通',next_action:'旧计划'}
const imported={...old,id:'evidence',date:'2026-11-24',created_at:'2026-11-24T10:00:00Z',content:'档案证据：日期已过，实际结果未知',channel:'archive_evidence'}
const snapshot={...imported,id:'snapshot',channel:'archive_snapshot',content:'资料补充：旧字段'}
assert.equal(latestManualFollowup('customer',[old,imported,snapshot]).id,'old')
assert.equal(archiveIsCurrent(customer,[old,imported]),true)
assert.equal(customerPlan(customer,[old,imported]).text,'核对实际结果')
const newer={...old,id:'new',date:'2026-11-24',created_at:'2026-11-24T11:00:00Z',next_action:'新人工约定'}
assert.equal(archiveIsCurrent(customer,[old,newer]),false)
assert.equal(customerPlan(customer,[newer,imported]).text,'新人工约定')
const row=reminderRows({customers:[customer],followups:[old,imported],emails:[]},'2026-11-24')[0]
assert.equal(row.date,null)
assert.equal(row.next,'核对实际结果')
assert.equal(row.status,'待定')
assert.equal(customerPlan({...customer,customer_tags:[]},[old]).text,'旧计划')
console.log('Archive provenance, manual update precedence, undated task and historical compatibility passed')
