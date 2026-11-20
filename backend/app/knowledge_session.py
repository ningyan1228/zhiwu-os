"""Server-side session exchange for explicitly linked workspace identities.

No default/shared fallback. Bindings are administrator configuration, never client
input. Both project identities are checked before a normal user session is issued.
"""
import json
import os
from uuid import UUID
import httpx
from fastapi import Header, HTTPException, Response


def binding_for(user, bindings):
    try: identity = str(UUID(user['id']))
    except (ValueError, KeyError, TypeError): raise HTTPException(401, '工作站登录身份无效')
    if not isinstance(bindings, dict): raise HTTPException(503, '资料账号关联配置有误')
    if user.get('is_anonymous') or not user.get('email_confirmed_at'):
        raise HTTPException(403, '请使用已验证的工作站账号')
    binding = bindings.get(identity)
    if not isinstance(binding, dict) or binding.get('workspace_email', '').lower() != user.get('email', '').lower():
        raise HTTPException(403, '此工作站账号尚未关联资料权限，请联系管理员')
    try:
        target_id = str(UUID(binding['knowledge_user_id']))
        email = binding['knowledge_email'].strip().lower()
        if not email: raise ValueError()
    except (KeyError, ValueError, AttributeError):
        raise HTTPException(503, '资料账号关联配置不完整')
    return target_id, email


def install(app, settings, bearer):
    @app.post('/api/auth/knowledge-session')
    async def knowledge_session(response: Response, authorization: str | None = Header(default=None)):
        response.headers['Cache-Control'] = 'no-store'
        token = bearer(authorization)
        cfg = settings()
        async with httpx.AsyncClient(timeout=15) as client:
            who = await client.get(cfg.supabase_url.rstrip('/') + '/auth/v1/user', headers={'apikey':cfg.supabase_anon_key,'Authorization':token})
            if who.status_code != 200: raise HTTPException(401, '工作站登录已失效，请重新登录')
            try: bindings = json.loads(os.environ.get('KNOWLEDGE_ACCOUNT_BINDINGS', '{}'))
            except ValueError: raise HTTPException(503, '资料账号关联配置有误')
            target_id, email = binding_for(who.json(), bindings)
            key = os.environ.get('KNOWLEDGE_SERVICE_ROLE_KEY', '')
            base = os.environ.get('KNOWLEDGE_SUPABASE_URL', '').rstrip('/')
            if not key or base != 'https://lyozybqqgwnohqjtzmpx.supabase.co':
                raise HTTPException(503, '统一登录尚未完成服务器配置，暂可使用原资料登录')
            headers = {'apikey':key,'Authorization':'Bearer '+key}
            # Check the existing identity first. generate_link can create users;
            # we must never create an account based on an untrusted email.
            target = await client.get(base+'/auth/v1/admin/users/'+target_id,headers=headers)
            if target.status_code != 200 or target.json().get('email','').lower() != email:
                raise HTTPException(403, '资料账号关联已变化，请管理员重新核对')
            generated = await client.post(base+'/auth/v1/admin/generate_link',headers=headers,json={'type':'magiclink','email':email})
            if generated.status_code != 200: raise HTTPException(503, '资料登录服务暂时不可用，请稍后重试')
            link = generated.json()
            if link.get('id') != target_id or not link.get('hashed_token'):
                raise HTTPException(503, '资料登录身份校验失败')
            verified = await client.post(base+'/auth/v1/verify',headers={'apikey':key},json={'type':'magiclink','token_hash':link['hashed_token']})
            if verified.status_code != 200: raise HTTPException(503, '资料登录验证失败，请稍后重试')
            result = verified.json()
            if result.get('user',{}).get('id') != target_id:
                raise HTTPException(503, '资料登录身份不一致')
            return {k:result[k] for k in ('access_token','refresh_token')}
