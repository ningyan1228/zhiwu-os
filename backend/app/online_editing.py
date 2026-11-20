"""Explicit, user-token/RLS protected editing of existing operational records."""
import json
from datetime import date, datetime
from urllib.parse import quote
from uuid import UUID
from fastapi import Header, HTTPException
from pydantic import BaseModel, Field, ValidationError

class EditRequest(BaseModel):
    changes: dict = Field(min_length=1, max_length=40)
    expected: dict = Field(max_length=40)

# Identifiers, ownership and source-mail contents cannot be rewritten here.
FIELDS = {
 'followups': {'date','content','next_action','status'},
 'projects': {'project_name','application','stage','notes','product_id'},
 'tasks': {'title','description','category','priority','task_date','start_time','end_time','estimated_minutes'},
 'supplier_contacts': {'name','title','mobile','phone','email','wechat','whatsapp','responsible_products','notes'},
 'supplier_products': {'product_name','reference_model','application','technical_summary','customizable','sample_available','capacity','moq','standard_lead_time','packaging','export_capacity','notes'},
 'supplier_followups': {'date','channel','content','conclusion','next_action','next_followup_date','owner_name','status'},
 'supplier_project_links': {'customer_need','reference_product','match_status','technical_match_notes','quote_status','sample_status','current_risk','next_action','next_followup_date'},
 'supplier_rfqs': {'demand_product','reference_product','end_application','technical_requirements','sample_quantity','expected_monthly_usage','expected_annual_usage','destination_country','status','sent_date','next_followup_date','reply_content'},
}

def cas_filter(key, value):
    if value is None: return f'{key}=is.null'
    if isinstance(value, (dict, list)): raise HTTPException(422, '此字段请使用专用编辑表单')
    if isinstance(value, bool): raw = 'true' if value else 'false'
    else: raw = str(value)
    escaped = raw.replace('\\', '\\\\').replace('"', '\\"')
    return f'{key}=eq.' + quote('"' + escaped + '"', safe='')

def install(app, supabase, bearer, models):
    def check(resource):
        if resource not in FIELDS: raise HTTPException(404, '此类资料不支持这个编辑入口')
    @app.get('/api/online-records/{resource}')
    async def read_records(resource: str, authorization: str | None = Header(default=None)):
        check(resource)
        filters = '&archived_at=is.null' if resource in ('followups','projects','tasks') else ''
        return await supabase(f'{resource}?select=*&limit=1000{filters}', bearer(authorization))

    @app.patch('/api/online-records/{resource}/{record_id}')
    async def edit_record(resource: str, record_id: UUID, payload: EditRequest, authorization: str | None = Header(default=None)):
        check(resource)
        if set(payload.changes) - FIELDS[resource] or set(payload.expected) != set(payload.changes):
            raise HTTPException(422, '只能修改表单列出的字段，且需要原值校验')
        token = bearer(authorization)
        path = f'{resource}?id=eq.{record_id}'
        rows = await supabase(path + '&select=*', token)
        if not rows: raise HTTPException(404, '记录不存在或当前账号无权访问')
        current = rows[0]
        if current.get('archived_at'): raise HTTPException(409, '记录已归档，请先恢复')
        if any(current.get(k) != v for k,v in payload.expected.items()):
            raise HTTPException(409, '这条记录已被其他人修改。请重新打开，核对最新内容后保存。')
        changes = dict(payload.changes)
        for k,v in changes.items():
            if k.endswith('_date') or k == 'date':
                if not v: changes[k] = None
                else:
                    try: changes[k] = date.fromisoformat(v).isoformat()
                    except (ValueError, TypeError): raise HTTPException(422, '日期请填写 YYYY-MM-DD')
        try:
            validated = models[resource].model_validate({**current, **changes}).model_dump()
        except ValidationError as error:
            raise HTTPException(422, '; '.join(str(e['loc'][-1])+': '+e['msg'] for e in error.errors()))
        changes = {k: validated[k] for k in changes}
        for k in ('content','title','project_name','name','product_name','demand_product'):
            if k in changes and not str(changes[k] or '').strip(): raise HTTPException(422, '必填内容不能为空')
        # Filter on every changed field's original value: a concurrent writer wins,
        # instead of silently losing their newer changes between read and write.
        condition = '&'.join(cas_filter(k,v) for k,v in payload.expected.items())
        updated = await supabase(path + '&' + condition, token, 'PATCH', changes)
        if not updated: raise HTTPException(409, '记录刚刚有更新，未覆盖。请重新打开后保存。')
        return updated[0]
