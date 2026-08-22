import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUpRight, Bell, CalendarDays, Check, ChevronRight, CircleHelp, ClipboardList, Grid2X2,
  Layers3, Menu, Package, Plus, Search, Settings, Sparkles, Users, X, type LucideIcon
} from 'lucide-react'
import { customers as seedCustomers, followups, products as seedProducts } from './data'
import { api } from './api'
import type { Customer, CustomerStage, Product } from './types'
import './styles.css'

type View = 'dashboard' | 'crm' | 'products'
const nav: [string, string, LucideIcon][] = [
  ['dashboard', '总览', Grid2X2], ['crm', '外贸 CRM', Users], ['products', '产品中心', Package],
  ['quotes', '报价管理', ClipboardList], ['assets', 'AI 资产', Sparkles], ['projects', '项目管理', Layers3],
]
const stageLabels: Record<CustomerStage, string> = { New: '新线索', Inquiry: '询盘', Quoted: '已报价', Sample: '寄样中', Negotiation: '谈判中', Won: '已成交', Lost: '已流失' }

function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem('zhiwu-demo-session') === 'active' || sessionStorage.getItem('zhiwu-access-token')))
  const [view, setView] = useState<View>('dashboard')
  const [sidebar, setSidebar] = useState(false)
  const [customers, setCustomers] = useState(seedCustomers)
  const [products, setProducts] = useState(seedProducts)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [modal, setModal] = useState<'customer' | 'product' | null>(null)
  const [query, setQuery] = useState('')
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(2026, 7, 21))
  const visibleCustomers = useMemo(() => customers.filter(c => `${c.company_name} ${c.country} ${c.contact_person}`.toLowerCase().includes(query.toLowerCase())), [customers, query])
  useEffect(() => {
    if (!authenticated || !sessionStorage.getItem('zhiwu-access-token')) return
    void Promise.all([api.customers(), api.products()]).then(([customerRows, productRows]) => {
      setCustomers(customerRows); setProducts(productRows)
    }).catch(error => console.error('Unable to load workspace data:', error))
  }, [authenticated])
  const addCustomer = async (form: HTMLFormElement) => {
    const value = Object.fromEntries(new FormData(form)) as Record<string, string>
    const customer = await api.createCustomer({ company_name: value.company_name, country: value.country, contact_person: value.contact_person, email: value.email, whatsapp: value.whatsapp || '', product_interest: value.product_interest || '', customer_stage: 'New', next_followup_date: value.next_followup_date || '', notes: value.notes || '' })
    setCustomers(current => [customer, ...current])
    setModal(null)
  }
  const addProduct = async (form: HTMLFormElement) => {
    const value = Object.fromEntries(new FormData(form)) as Record<string, string>
    const product = await api.createProduct({ product_name: value.product_name, product_code: value.product_code, category: value.category || '', application: value.application || '', description: value.description || '', notes: value.notes || '' })
    setProducts(current => [product, ...current])
    setModal(null)
  }
  if (!authenticated) return <Login onAuthenticated={() => { sessionStorage.setItem('zhiwu-demo-session', 'active'); setAuthenticated(true) }} />
  return <div className="app-shell">
    <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
      <div className="brand"><div className="brand-mark">Z</div><div><strong>Zhiwu OS</strong><span>个人创业操作系统</span></div><button className="mobile-close" onClick={() => setSidebar(false)}><X size={18}/></button></div>
      <nav>{nav.map(([key, label, Icon]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => { if (key === 'dashboard' || key === 'crm' || key === 'products') setView(key as View); setSidebar(false) }}><Icon size={18}/><span>{label}</span>{key === 'crm' && <em>5</em>}</button>)}</nav>
      <div className="nav-bottom"><button><CalendarDays size={18}/><span>知识库</span></button><button><Settings size={18}/><span>设置</span></button><div className="profile"><div className="avatar">Z</div><div><b>Zhiwu</b><small>Founder</small></div><ChevronRight size={16}/></div></div>
    </aside>
    <main>
      <header><button className="menu" onClick={() => setSidebar(true)}><Menu/></button><div className="crumb">工作空间 <ChevronRight size={15}/> <b>{view === 'dashboard' ? '总览' : view === 'crm' ? '外贸 CRM' : '产品中心'}</b></div><div className="header-actions"><label className="global-search"><Search size={17}/><input placeholder="搜索工作空间" /></label><button className="icon-button"><Bell size={19}/><i/></button><div className="avatar avatar-small">Z</div></div></header>
      {view === 'dashboard' && <Dashboard customers={customers} today={today} onOpenCRM={() => setView('crm')} />}
      {view === 'crm' && <CRM customers={visibleCustomers} query={query} setQuery={setQuery} open={setSelected} create={() => setModal('customer')} />}
      {view === 'products' && <Products products={products} create={() => setModal('product')} />}
    </main>
    {selected && <CustomerDrawer customer={selected} close={() => setSelected(null)} />}
    {modal === 'customer' && <CustomerForm close={() => setModal(null)} submit={addCustomer} />}
    {modal === 'product' && <ProductForm close={() => setModal(null)} submit={addProduct} />}
  </div>
}

function Dashboard({ customers, today, onOpenCRM }: { customers: Customer[]; today: string; onOpenCRM: () => void }) {
  const tasks = ['跟进 Manila Packaging 的报价反馈', '确认 Apex Polymers 的装柜方案', '更新 HM-800 产品资料页', '整理本周产品图片素材']
  return <section className="page dashboard"><div className="hero"><div><p className="eyebrow"><span className="pulse"/> {today}</p><h1>早上好，Zhiwu <span>✦</span></h1><p className="subhead">聚焦今天最重要的事，让每一步都推动业务向前。</p></div><div className="goal"><div className="goal-top"><span>2026 年收入目标</span><b>¥1,000,000</b></div><div className="progress"><i style={{width:'23%'}}/></div><div className="goal-foot"><span>已完成 ¥230,000</span><strong>23%</strong></div></div></div>
    <div className="metrics"><Metric label="活跃客户" value={String(customers.length)} delta="本月 +2" icon={<Users/>}/><Metric label="进行中报价" value="12" delta="价值 ¥348,000" icon={<ClipboardList/>}/><Metric label="推进项目" value="4" delta="3 个按计划进行" icon={<Layers3/>}/><Metric label="产品资料" value="24" delta="资料完整度 86%" icon={<Package/>}/></div>
    <div className="dashboard-grid"><section className="panel tasks"><PanelTitle title="今日重点" action="查看全部"/><div>{tasks.map((t,i) => <button className="task" key={t}><span className={`task-box ${i === 3 ? 'checked' : ''}`}>{i===3 && <Check size={13}/>}</span><span>{t}</span>{i < 2 && <b>重要</b>}<ChevronRight size={16}/></button>)}</div><button className="add-line"><Plus size={17}/> 添加任务</button></section>
    <section className="panel follow"><PanelTitle title="待跟进客户" action="进入 CRM" onAction={onOpenCRM}/>{customers.filter(c=>c.customer_stage !== 'Won').slice(0,3).map(c => <button className="follow-row" key={c.id} onClick={onOpenCRM}><div className="company-avatar">{c.company_name.slice(0,1)}</div><div><b>{c.company_name}</b><span>{c.contact_person} · {c.country}</span></div><time>{c.next_followup_date.slice(5).replace('-', '/')}</time><ChevronRight size={16}/></button>)}</section></div>
    <section className="panel activity"><PanelTitle title="最近动态" action="查看全部"/><div className="timeline"><Activity icon={<Users/>} title="Apex Polymers 更新了采购需求" text="客户希望将 HM-800 与 CPP 合并运输" time="2 小时前"/><Activity icon={<Package/>} title="HM-800 已补充 3 张产品图片" text="在产品中心更新" time="昨天"/><Activity icon={<Check/>} title="完成了网站产品页优化" text="个人站 · 产品详情页" time="8月19日"/></div></section>
  </section>
}
function Metric({label,value,delta,icon}:{label:string;value:string;delta:string;icon:ReactNode}) { return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{label==='活跃客户' && <ArrowUpRight size={13}/>} {delta}</small></div></div> }
function PanelTitle({title,action,onAction}:{title:string;action:string;onAction?:()=>void}) { return <div className="panel-title"><h2>{title}</h2><button onClick={onAction}>{action}<ChevronRight size={15}/></button></div> }
function Activity({icon,title,text,time}:{icon:ReactNode;title:string;text:string;time:string}) { return <div className="activity-row"><div className="activity-icon">{icon}</div><div><b>{title}</b><span>{text}</span></div><time>{time}</time></div> }

function CRM({customers,query,setQuery,open,create}:{customers:Customer[];query:string;setQuery:(v:string)=>void;open:(c:Customer)=>void;create:()=>void}) { return <section className="page crm"><div className="page-heading"><div><p className="eyebrow">EXTERNAL TRADE</p><h1>外贸 CRM</h1><p>集中管理每一段客户关系与下一步机会。</p></div><button className="primary" onClick={create}><Plus size={17}/> 新建客户</button></div><div className="crm-kpis"><span><b>{customers.length}</b> 全部客户</span><span><b>{customers.filter(c=>c.customer_stage !== 'Won').length}</b> 活跃客户</span><span><b>{customers.filter(c=>c.customer_stage === 'Negotiation').length}</b> 处于谈判</span></div><div className="table-panel"><div className="table-tools"><label><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索公司、联系人或国家" /></label><button className="filter">阶段 <ChevronRight size={15}/></button><button className="filter">国家 <ChevronRight size={15}/></button></div><div className="table-wrap"><table><thead><tr><th>客户</th><th>阶段</th><th>产品兴趣</th><th>最后联系</th><th>下次跟进</th><th/></tr></thead><tbody>{customers.map(c=><tr key={c.id} onClick={()=>open(c)}><td><div className="customer-cell"><div className="company-avatar">{c.company_name[0]}</div><div><b>{c.company_name}</b><span>{c.contact_person} · {c.country}</span></div></div></td><td><Stage stage={c.customer_stage}/></td><td>{c.product_interest}</td><td>{c.last_contact_date}</td><td><span className={c.next_followup_date==='2026-08-21'?'due':''}>{c.next_followup_date}</span></td><td><ChevronRight size={17}/></td></tr>)}</tbody></table>{!customers.length && <div className="empty">还没有客户，点击“新建客户”开始添加。</div>}</div></div></section> }
function Stage({stage}:{stage:CustomerStage}) { return <span className={`stage ${stage.toLowerCase()}`}>{stageLabels[stage]}</span> }

function Products({products,create}:{products:Product[];create:()=>void}) { return <section className="page products"><div className="page-heading"><div><p className="eyebrow">PRODUCT INTELLIGENCE</p><h1>产品中心</h1><p>把每一份产品资料变成随时可用的销售资产。</p></div><button className="primary" onClick={create}><Plus size={17}/> 添加产品</button></div><div className="product-toolbar"><label><Search size={17}/><input placeholder="搜索产品名称或编号" /></label><button className="filter">全部分类 <ChevronRight size={15}/></button></div><div className="products-grid">{products.map(p=><ProductCard key={p.id} product={p}/>)}</div>{!products.length && <div className="empty">还没有产品，点击“添加产品”创建第一份资料。</div>}</section> }
function ProductCard({product}:{product:Product}) { return <article className="product-card"><div className="product-art"><span>{product.product_code.slice(0,2)}</span><div className="product-shape one"/><div className="product-shape two"/></div><div className="product-body"><span className="category">{product.category}</span><h2>{product.product_name}</h2><code>{product.product_code}</code><p>{product.description}</p><div><span>{product.application}</span><ChevronRight size={16}/></div></div></article> }

function CustomerDrawer({customer,close}:{customer:Customer;close:()=>void}) { const notes=followups.filter(f=>f.customer_id===customer.id); return <div className="drawer-layer" onMouseDown={close}><aside className="drawer" onMouseDown={e=>e.stopPropagation()}><button className="close" onClick={close}><X size={20}/></button><div className="drawer-head"><div className="company-avatar large">{customer.company_name[0]}</div><div><p>{customer.country}</p><h2>{customer.company_name}</h2><Stage stage={customer.customer_stage}/></div></div><div className="contact-grid"><span>联系人<b>{customer.contact_person}</b></span><span>邮箱<b>{customer.email}</b></span><span>WhatsApp<b>{customer.whatsapp}</b></span><span>关注产品<b>{customer.product_interest}</b></span></div><div className="next-action"><Sparkles size={17}/><div><span>下一步行动</span><b>{notes[0]?.next_action ?? '安排下一次客户联系'}</b></div><time>{customer.next_followup_date}</time></div><h3>沟通记录</h3>{notes.length ? notes.map(n=><div className="note" key={n.id}><time>{n.date}</time><p>{n.content}</p><small>下一步：{n.next_action}</small></div>) : <div className="note"><p>尚未添加沟通记录。</p></div>}<button className="primary full"><Plus size={17}/> 添加跟进记录</button></aside></div> }
function CustomerForm({close,submit}:{close:()=>void;submit:(f:HTMLFormElement)=>Promise<void>}) { return <Modal title="新建客户" close={close}><form onSubmit={async e=>{e.preventDefault();try { await submit(e.currentTarget) } catch (error) { alert(error instanceof Error ? error.message : '创建失败，请稍后重试。') }}}><div className="form-grid"><Field label="公司名称 *" name="company_name" required/><Field label="国家/地区 *" name="country" required/><Field label="联系人 *" name="contact_person" required/><Field label="邮箱 *" name="email" type="email" required/><Field label="WhatsApp" name="whatsapp"/><Field label="产品兴趣" name="product_interest"/><Field label="下次跟进" name="next_followup_date" type="date"/><label className="wide">备注<textarea name="notes" placeholder="记录客户背景、需求或特别事项"/></label></div><div className="form-actions"><button type="button" onClick={close}>取消</button><button className="primary">创建客户</button></div></form></Modal> }
function ProductForm({close,submit}:{close:()=>void;submit:(f:HTMLFormElement)=>Promise<void>}) { return <Modal title="添加产品" close={close}><form onSubmit={async e=>{e.preventDefault();try { await submit(e.currentTarget) } catch (error) { alert(error instanceof Error ? error.message : '保存失败，请稍后重试。') }}}><div className="form-grid"><Field label="产品名称 *" name="product_name" required/><Field label="产品编号 *" name="product_code" required/><Field label="分类" name="category"/><Field label="应用场景" name="application"/><label className="wide">产品描述<textarea name="description" placeholder="描述产品特性、优势与应用"/><textarea name="notes" placeholder="内部备注（可选）"/></label></div><div className="form-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存产品</button></div></form></Modal> }
function Field({label,name,type='text',required=false}:{label:string;name:string;type?:string;required?:boolean}) { return <label>{label}<input name={name} type={type} required={required}/></label> }
function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) { return <div className="modal-layer"><section className="modal"><div className="modal-head"><h2>{title}</h2><button className="close" onClick={close}><X size={20}/></button></div>{children}</section></div> }

function Login({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setError('')
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://zhiwu-os-api.gjsx.uno' : 'http://localhost:8000')}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) })
      if (!response.ok) throw new Error('邮箱或密码不正确，请检查后重试。')
      const session = await response.json(); sessionStorage.setItem('zhiwu-access-token', session.access_token); onAuthenticated()
    } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法登录，请稍后重试。') } finally { setLoading(false) }
  }
  return <main className="login-page"><section className="login-intro"><div className="brand"><div className="brand-mark">Z</div><div><strong>Zhiwu OS</strong><span>个人创业操作系统</span></div></div><div><p className="eyebrow"><span className="pulse"/> PERSONAL CEO WORKSPACE</p><h1>为今天的关键决策，<br/>腾出一个清晰的空间。</h1><p>外贸、产品与项目，全部聚合在同一个专注的工作台。</p></div><div className="login-quote">“小而清晰的系统，胜过散落各处的待办。”</div></section><section className="login-form-wrap"><form className="login-form" onSubmit={login}><div className="mobile-brand brand"><div className="brand-mark">Z</div><strong>Zhiwu OS</strong></div><p className="eyebrow">WELCOME BACK</p><h2>登录工作空间</h2><p>使用你的专属账号继续今天的工作。</p><label>邮箱<input type="email" name="email" placeholder="you@example.com" required /></label><label>密码<input type="password" name="password" placeholder="输入密码" required /></label>{error && <div className="login-error">{error}</div>}<button className="primary login-submit" disabled={loading}>{loading ? '正在验证…' : '登录'} <ArrowUpRight size={17}/></button><button type="button" className="demo-login" onClick={onAuthenticated}>进入演示工作空间 <ChevronRight size={16}/></button><small>正式部署后，登录由你的 Supabase 账号安全验证。</small></form></section></main>
}

createRoot(document.getElementById('root')!).render(<App />)

