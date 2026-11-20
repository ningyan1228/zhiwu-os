import ts from 'typescript'
import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {resolve,dirname} from 'node:path'
const cache=new Map()
function load(file){file=resolve(file);if(!existsSync(file))file+='.ts';if(cache.has(file))return cache.get(file);const result={};cache.set(file,result);const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;new Function('exports','require',source)(result,name=>{if(!name.startsWith('.'))throw Error('Unexpected data import '+name);return load(resolve(dirname(file),name))});return result}
const {publicLeads}=load('src/knowledge-generated/lib/productMarketMap.ts')
const rows=publicLeads.filter(x=>x.leadEligible).map(x=>({company:x.company,country:x.country,checkedAt:x.checkedAt}))
writeFileSync('src/publicLeadOverview.json',JSON.stringify(rows))
console.log('Prepared public lead overview:',rows.length)
