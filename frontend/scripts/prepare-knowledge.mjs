import { mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { polishKnowledge } from './polish-knowledge.mjs'

// Only this audited public revision is imported. Private imports are never copied.
const revision = '27748e0ba82e8cc9e9e4ff33edf03b90c2f4fb22'
const cache = resolve('.knowledge-source')
if (!process.env.KNOWLEDGE_SOURCE) {
  mkdirSync(cache, {recursive:true})
  if (!existsSync(join(cache, 'source.tar.gz'))) execFileSync('curl', ['--fail','--location','--retry','3',`https://codeload.github.com/ningyan1228/knowledge-workbench/tar.gz/${revision}`,'-o',join(cache,'source.tar.gz')], {stdio:'inherit'})
  execFileSync('tar',['-xzf',join(cache,'source.tar.gz'),'-C',cache])
}
const source = process.env.KNOWLEDGE_SOURCE || join(cache,`knowledge-workbench-${revision}`)
const target = resolve('src/knowledge-generated')
mkdirSync(target,{recursive:true})
cpSync(join(source,'src'),target,{recursive:true})
cpSync(resolve('src/knowledge-overrides/GlobalLeadMap.tsx.template'), join(target, 'features/market/GlobalLeadMap.tsx'))
// Assets are namespaced; no research, private imports, credentials or source docs.
if (existsSync(join(source,'public'))) cpSync(join(source,'public'),resolve('public/knowledge'),{recursive:true})
function walk(dir) { return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]) }
for (const file of walk(target)) {
  if (!/\.(tsx?|css)$/.test(file)) continue
  let text=readFileSync(file,'utf8')
  if (file.endsWith('.css')) {
    text=text.replaceAll(':root',':host').replace(/(^|[{},]\s*)body(?=[\s{.#:[>,])/gm,'$1:host')
    text=text.replace(/:host\[([^\]]+)\]/g,':host([$1])')
  } else {
    text=text.replace(/\bLinkedin\b/g,'Link2')
    text=text.replace(/^import\s+['"][^'"\n]+\.css['"];?\s*$/gm,'')
    text=text.replaceAll('import.meta.env.BASE_URL',"(import.meta.env.BASE_URL + 'knowledge/')")
    // DOM lookups must resolve inside the module's style-isolated root.
    if (/document\.(getElementById|querySelector|activeElement)/.test(text)) {
      text="import { knowledgeDocument } from '@/KnowledgeDocument'\n"+text
      text=text.replace(/document\.(getElementById|querySelectorAll|querySelector|activeElement)/g,'knowledgeDocument().$1')
      text=text.replaceAll('window.knowledgeDocument()', 'knowledgeDocument()')
    }
  }
  writeFileSync(file,text)
}
const publicData=join(target,'features/market/usePublicLeadData.ts')
writeFileSync(publicData,readFileSync(publicData,'utf8').replace("new URL((import.meta.env.BASE_URL + 'knowledge/'),window.location.href)","new URL('https://ningyan1228.github.io/knowledge-workbench/')"))
const authFile=join(target,'lib/supabase.ts')
writeFileSync(authFile,"import { knowledgeConfig } from '@/knowledgeConfig'\n"+readFileSync(authFile,'utf8').replaceAll('import.meta.env.VITE_SUPABASE_URL','knowledgeConfig.url').replaceAll('import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY','knowledgeConfig.publishableKey').replaceAll('import.meta.env.VITE_API_BASE_URL','knowledgeConfig.api'))
const app=join(target,'App.tsx')
let text=readFileSync(app,'utf8')
text=text.replace('export function App() {','export function App() {')
text=text.replace(/useEffect\(\(\) => \{ document.documentElement.dataset.theme = dark[^\n]+/,'// Theme is owned by the host workspace.')
// Remove the duplicate shell while preserving every original page and dialog.
const start=text.indexOf('    <aside '), end=text.indexOf('      {!hasSupabaseConfig',start)
if(start<0||end<0) throw new Error('Knowledge shell changed; review adapter before updating revision')
text=text.slice(0,start)+'    <main className="main-area">\n'+text.slice(end)
writeFileSync(app,text)
polishKnowledge(target)
cpSync(resolve('src/knowledge-overrides/customerFollowup.ts'),join(target,'lib/customerFollowup.ts'))
console.log(`Prepared public knowledge module ${revision}`)

await import('./prepare-overview.mjs')

// Respect a source ledger's explicitly declared contact-priority ordering.
const followupView=join(target,'features/market/FollowupViews.tsx')
writeFileSync(followupView,readFileSync(followupView,'utf8').replace("const defaultOrder = 'schedule'","const defaultOrder = document.metadata.default_sort_field === 'contact_priority_rank' ? 'priority' : 'schedule'"))
const mapWorkspace = join(target, 'features/market/CustomerMapWorkspace.tsx')
writeFileSync(mapWorkspace, readFileSync(mapWorkspace, 'utf8').replace('className="explorer-profile"', 'className="explorer-profile" data-product={activeLead.productId}'))

