const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/overviewRead.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:mod.exports,Promise,setTimeout});
const {readOverviewWithRetry:read,overviewReadError}=mod.exports;
(async()=>{
 let calls=0;const result=await read(async()=>{if(++calls===1)throw Error('Failed to fetch');return 218},()=>true,async()=>{});
 assert.equal(result,218);assert.equal(calls,2);
 calls=0;await assert.rejects(read(async()=>{calls++;throw Error('连接超时')},()=>true,async()=>{}));assert.equal(calls,2);
 for(const message of ['工作站登录已过期','无权限读取','资料账号关联配置有误']){
  calls=0;await assert.rejects(read(async()=>{calls++;throw Error(message)},()=>true,async()=>{}));assert.equal(calls,1);
 }
 calls=0;let active=true;await assert.rejects(read(async()=>{calls++;throw Error('Failed to fetch')},()=>active,async()=>{active=false}));assert.equal(calls,1);
 assert.equal(overviewReadError({message:'Failed to fetch'}),'网络连接中断，请重新读取。');
 console.log('PASS transient recovery, retry limit, auth exclusions, unmount cancellation, readable errors');
})().catch(e=>{console.error(e);process.exitCode=1});
