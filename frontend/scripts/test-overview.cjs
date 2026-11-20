const fs=require('fs'),vm=require('vm'),ts=require('typescript'),assert=require('assert/strict');
const output=ts.transpileModule(fs.readFileSync('src/OverviewBoards.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;
const exportsObject={};const mockedRequire=name=>name==='./api'?{api:{}}:name==='./followupModel'?{reminderToday:()=> '2026-11-20'}:name.endsWith('.css')?{}:name.endsWith('.svg')?'':require(name);
vm.runInNewContext(output,{exports:exportsObject,require:mockedRequire,Date,Intl,Number,Promise,setTimeout,clearTimeout,AbortSignal});
const sorted=exportsObject.sortItems([{title:'old',detail:'',date:'2026-10-01'},{title:'unknown',detail:''},{title:'new',detail:'',date:'2026-11-20'},{title:'bad',detail:'',date:'not-a-date'}]);assert.equal(sorted.length,2);assert.equal(sorted[0].title,'new');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const view=states=>renderToStaticMarkup(React.createElement(exportsObject.OverviewBoardView,{states,navigate:()=>{},reload:()=>{}}));
const loading=view(Array.from({length:6},()=>({})));assert.equal((loading.match(/ob-loading/g)||[]).length,6);assert.ok(!loading.includes('ob-metric'));
const error=view(Array.from({length:6},()=>({error:'test failure'})));assert.equal((error.match(/<b>暂时无法读取<\/b>/g)||[]).length,6);assert.ok(!error.includes('ob-metric'));
console.log('PASS newest-first ordering, missing date exclusion, six independent loading/error cards, no fake zero metrics');

const ready=view(Array.from({length:6},()=>({data:{value:10,unit:'条',metric:'测试',secondary:'测试',action:'查看',items:[],tasks:[{title:'需处理客户',detail:'安排试样',date:'2026-11-20'}],breakdown:[{label:'今日到期',value:1},{label:'日期待核',value:2}],source:'测试'}})));assert.ok(ready.includes('需处理客户'));assert.ok(ready.includes('日期待核'));assert.ok(!loading.includes('当前没有今日'));console.log('PASS actionable followups and unknown state preserved');
