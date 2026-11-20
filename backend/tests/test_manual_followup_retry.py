"""Exercise the actual endpoint without credentials or production mutations."""
import ast
import asyncio
from datetime import date
import json
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote
from uuid import uuid5, NAMESPACE_URL
import unittest

class HTTPException(Exception):
    def __init__(self,status_code,detail):
        self.status_code,self.detail=status_code,detail

class Payload:
    def __init__(self, **values): self.__dict__.update(values)
    def model_dump(self,**_): return dict(self.__dict__)

class RetryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.rows={};self.inserts=0;self.events=0
        async def db(path,token,method='GET',payload=None):
            self.assertEqual(token,'Bearer test-user')
            if method=='POST':
                await asyncio.sleep(0)
                if payload['id'] in self.rows: raise HTTPException(409,'duplicate key')
                self.inserts+=1;self.rows[payload['id']]=payload.copy()
                return [payload.copy()]
            if 'id=eq.' in path and path.startswith('followups?id='):
                key=path.split('id=eq.')[1].split('&')[0]
                return [self.rows[key].copy()] if key in self.rows else []
            return list(self.rows.values())
        async def timeline(*args,**kwargs): self.events+=1
        node=next(n for n in ast.parse((Path(__file__).parents[1]/'app/main.py').read_text(encoding='utf-8')).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='create_followup')
        node.decorator_list=[]
        env=dict(FollowupIn=Payload,Header=lambda **kw:None,bearer=lambda value:value,supabase=db,record_timeline_event=timeline,HTTPException=HTTPException,httpx=SimpleNamespace(RequestError=ConnectionError),asyncio=asyncio,date=date,quote=quote,json=json,uuid5=uuid5,NAMESPACE_URL=NAMESPACE_URL)
        exec(compile(ast.Module(body=[node],type_ignores=[]),'endpoint','exec'),env)
        self.save=env['create_followup']
        self.payload=lambda **extra:Payload(**({'customer_id':'customer-a','date':'2026-11-20','content':' actual conversation ','next_action':'next','status':'Open'}|extra))
    async def test_simultaneous_retry(self):
        a,b=await asyncio.gather(self.save(self.payload(),'Bearer test-user'),self.save(self.payload(),'Bearer test-user'))
        self.assertEqual(a[0]['id'],b[0]['id']);self.assertEqual(self.inserts,1)
    async def test_repeat_returns_saved_row(self):
        a=await self.save(self.payload(),'Bearer test-user')
        b=await self.save(self.payload(),'Bearer test-user')
        self.assertEqual(a,b);self.assertEqual(self.inserts,1)
    async def test_changed_next_action_is_conflict(self):
        await self.save(self.payload(),'Bearer test-user')
        with self.assertRaises(HTTPException) as caught: await self.save(self.payload(next_action='different'),'Bearer test-user')
        self.assertEqual(caught.exception.status_code,409)
    async def test_invalid_date_and_blank_content(self):
        for payload in [self.payload(date='2026-02-30'),self.payload(content=' ')]:
            with self.assertRaises(HTTPException) as caught: await self.save(payload,'Bearer test-user')
            self.assertEqual(caught.exception.status_code,422)
        self.assertEqual(self.inserts,0)

if __name__=='__main__': unittest.main()
