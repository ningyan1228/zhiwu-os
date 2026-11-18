"""Conservative, reviewable updates to existing customers. Never guesses identity."""
import re
from typing import Any

FIELD_MAP = {
    'company_name': 'company_name', 'country': 'country', 'contact_name': 'contact_person',
    'email': 'email', 'wechat_or_whatsapp': 'whatsapp', 'industry': 'industry',
    'summary': 'customer_summary', 'background': 'customer_background',
    'current_need': 'customer_need', 'status_text': 'status_label',
}

def prepare_review(payload: dict[str, Any], customers: list[dict[str, Any]], is_internal) -> dict[str, Any]:
    """Return an immutable field preview; null/empty never erase trusted data."""
    customer = payload.get('customer') or {}
    match = payload.get('match') or {}
    email = str(customer.get('email') or match.get('customer_email') or '').strip().lower()
    explicit_id = str(match.get('website_customer_id') or '').strip()
    reasons = []
    if payload.get('intent') != 'upsert_customer_and_followup':
        reasons.append('本事务通道仅支持客户字段订正；其他业务使用对应页面。')
    if any(payload.get(k) for k in ('product_refs', 'project', 'follow_up', 'task')):
        reasons.append('包含产品、项目、跟进或任务写入，尚未通过本通道的事务验证，不能部分导入。')
    if explicit_id:
        matches = [r for r in customers if str(r.get('id')) == explicit_id]
        if email and matches and str(matches[0].get('email','')).strip().lower() != email:
            reasons.append('网站 ID 与邮箱不一致，需人工核对。')
    elif re.fullmatch(r'[^\s@;,；]+@[^\s@;,；]+\.[^\s@;,；]+', email) and not is_internal(email):
        matches = [r for r in customers if str(r.get('email','')).strip().lower() == email]
    else:
        matches = []
    if len(matches) != 1:
        reasons.append('必须以网站 ID 或唯一邮箱匹配现有客户；同名、无邮箱、多重匹配不自动写入。')
    target = matches[0] if len(matches) == 1 else None
    patch = {}
    for source, dest in FIELD_MAP.items():
        value = customer.get(source)
        if isinstance(value, str) and value.strip():
            value = value.strip()
            if dest == 'email':
                value = value.lower()
                if is_internal(value):
                    reasons.append('内部邮箱不得覆盖真实客户邮箱。')
                    continue
            if not target or target.get(dest) != value:
                patch[dest] = value
    unsupported = [k for k, v in customer.items() if k not in FIELD_MAP and v not in (None, '', [], {})]
    if unsupported:
        reasons.append('存在未纳入预览的客户字段：'+ '、'.join(unsupported)+'；请拆分或先完善核验，不能静默丢弃。')
    if not patch:
        reasons.append('没有需要更新的非空字段。')
    return {
        'version': 'reviewed-customer/v1', 'ready': not reasons,
        'blocked_reasons': reasons, 'customer_id': target.get('id') if target else None,
        'expected': target, 'patch': patch,
        'changes': [{'field': k, 'before': target.get(k) if target else None, 'after': v} for k, v in patch.items()],
        'date_policy': '整理日期仅用于导入来源，不更新最后联系日期或跟进日期。',
    }
