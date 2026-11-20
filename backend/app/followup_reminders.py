"""Reminder operations retain the requesting JWT and existing RLS."""
from datetime import date
from uuid import UUID
from typing import Literal
from fastapi import Header
from pydantic import BaseModel, Field

class ReminderSave(BaseModel):
    p_customer: UUID
    p_expected: dict
    p_action: Literal['reschedule','complete']
    p_date: date | None = None
    p_closed: bool = False
    p_reason: str = Field(default='', max_length=1000)
    p_source: Literal['邮箱','微信','WhatsApp','GPT','人工确认','未注明'] = '未注明'
    p_content: str = Field(default='', max_length=20000)
    p_next_action: str = Field(default='', max_length=10000)
    p_communication_date: date | None = None

def install(app, supabase, bearer, is_internal):
    @app.get('/api/followup-reminders')
    async def snapshot(authorization: str | None = Header(default=None)):
        result = await supabase('rpc/followup_reminder_snapshot', bearer(authorization), 'POST', {})
        result['emails'] = [e for e in result.get('emails', []) if not is_internal(e.get('sender'))]
        return result

    @app.post('/api/followup-reminders/save')
    async def save(payload: ReminderSave, authorization: str | None = Header(default=None)):
        return await supabase('rpc/save_followup_reminder', bearer(authorization), 'POST', payload.model_dump(mode='json'))
