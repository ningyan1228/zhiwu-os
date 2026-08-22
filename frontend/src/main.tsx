import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUpRight, Bell, CalendarDays, Check, ChevronRight, CircleHelp, ClipboardList, Grid2X2,
  Layers3, Menu, Package, Plus, Search, Settings, Sparkles, Users, X, type LucideIcon
} from 'lucide-react'
import { customers as seedCustomers, followups as seedFollowups, products as seedProducts, projects as seedProjects, quotes as seedQuotes } from './data'
import { api } from './api'
import type { Customer, CustomerStage, Followup, Product, Project, Quote } from './types'
import './styles.css'

type View = 'dashboard' | 'crm' | 'products'
const nav: [string, string, LucideIcon][] = [
  ['dashboard', '总览', Grid2X2], ['crm', '外贸 CRM', Users], ['products', '产品中心', Package],
  ['quotes', '报价管理', ClipboardList], ['assets', 'AI 资产', Sparkles], ['projects', '项目管理', Layers3],
]
const stageLabels: Record<CustomerStage, string> = {
  New: '新线索', Inquiry: '询盘', Quoted: '已报价', Sample: '寄样中', Negotiation: '谈判中', Won: '已成交', Lost: '已流失',
  'New Inquiry': 'New Inquiry', 'Technical Discussion': 'Technical Discussion', Quotation: 'Quotation',
  'Sample Payment': 'Sample Payment', 'Sample Payment Pending': 'Sample Payment Pending',
  'Technical Testing': 'Technical Testing', 'Technical Confirmation': 'Technical Confirmation', 'Maintain Relationship': 'Maintain Relationship',
}

function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem('zhiwu-demo-session') === 'active' || sessionStorage.getItem('zhiwu-access-token')))
  const [view, setView] = useState<View>('dashboard')
  const [sidebar, setSidebar] = useState(false)
  const [customers, setCustomers] = useState(seedCustomers)
  const [products, setProducts] = useState(seedProducts)
  const [followupRows, setFollowupRows] = useState(seedFollowups)
  const [projects, setProjects] = useState(seedProjects)
  const [quotes, setQuotes] = useState(seedQuotes)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [modal, setModal] = useState<'customer' | 'product' | 'followup' | 'quote' | null>(null)
  const [query, setQuery] = useState('')
  const today = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(2026, 7, 21))
  const visibleCustomers = useMemo(() => customers.filter(c => `${c.company_name} ${c.country} ${c.contact_person}`.toLowerCase().includes(query.toLowerCase())), [customers, query])
  useEffect(() => {
    if (!authenticated || !sessionStorage.getItem('zhiwu-access-token')) return
    void Promise.all([api.customers(), api.products(), api.followups(), api.projects(), api.quotes()]).then(([customerRows, productRows, loadedFollowups, loadedProjects, loadedQuotes]) => {
      setCustomers(customerRows.length ? customerRows : seedCustomers); setProducts(productRows.length ? productRows : seedProducts)
      setFollowupRows(loadedFollowups.length ? loadedFollowups : seedFollowups); setProjects(loadedProjects.length ? loadedProjects : seedProjects); setQuotes(loadedQuotes.length ? loadedQuotes : seedQuotes)
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
  const addFollowup = async (form: HTMLFormElement) => {
    if (!selected) return
    const value = Object.fromEntries(new FormData(form)) as Record<string, string>
    const payload: Omit<Followup, 'id'> = { customer_id: selected.id, date: value.date, content: value.content, next_action: value.next_action || '安排下一步跟进', status: 'Open' }
    const record = sessionStorage.getItem('zhiwu-access-token') ? await api.createFollowup(payload) : { ...payload, id: `demo-followup-${Date.now()}` }
    setFollowupRows(current => [record, ...current]); setModal(null)
  }
  const addQuote = async (form: HTMLFormElement) => {
    if (!selected) return
    const value = Object.fromEntries(new FormData(form)) as Record<string, string>
    const payload: Omit<Quote, 'id'> = { customer_id: selected.id, product_code: selected.product_interest, quantity: value.quantity, amount: Number(value.amount) || undefined, currency: value.currency || 'USD', trade_term: value.trade_term || '', status: value.status || 'Draft' }
    const quote = sessionStorage.getItem('zhiwu-access-token') ? await api.createQuote(payload) : { ...payload, id: `demo-quote-${Date.now()}`, created_at: new Date().toISOString().slice(0, 10) }
    setQuotes(current => [quote, ...current]); setModal(null)
  }
  const updateStage = async (customer: Customer, stage: CustomerStage) => {
    const updated = { ...customer, customer_stage: stage }
    const { id: _id, created_at: _createdAt, last_contact_date: _lastContactDate, ...payload } = updated
    const next = sessionStorage.getItem('zhiwu-access-token') ? await api.updateCustomer(customer.id, payload) : updated
    setCustomers(current => current.map(item => item.id === customer.id ? next : item)); setSelected(next)
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
      {view === 'dashboard' && <Dashboard customers={customers} projects={projects} followups={followupRows} today={today} onOpenCRM={() => setView('crm')} openCustomer={setSelected} />}
      {view === 'crm' && <CRM customers={visibleCustomers} projects={projects} query={query} setQuery={setQuery} open={setSelected} create={() => setModal('customer')} addFollowup={customer => { setSelected(customer); setModal('followup') }} />}
      {view === 'products' && <Products products={products} create={() => setModal('product')} />}
    </main>
    {selected && <CustomerDrawer customer={selected} projects={projects} quotes={quotes} followups={followupRows} products={products} close={() => setSelected(null)} addFollowup={() => setModal('followup')} addQuote={() => setModal('quote')} updateStage={updateStage} />}
    {modal === 'customer' && <CustomerForm close={() => setModal(null)} submit={addCustomer} />}
    {modal === 'product' && <ProductForm close={() => setModal(null)} submit={addProduct} />}
    {modal === 'followup' && selected && <FollowupForm customer={selected} close={() => setModal(null)} submit={addFollowup} />}
    {modal === 'quote' && selected && <QuoteForm customer={selected} close={() => setModal(null)} submit={addQuote} />}
  </div>
}

function Dashboard({ customers, projects, followups, today, onOpenCRM, openCustomer }: { customers: Customer[]; projects: Project[]; followups: Followup[]; today: string; onOpenCRM: () => void; openCustomer: (customer: Customer) => void }) {
  const reminders = customers.filter(customer => customer.customer_stage !== 'Maintain Relationship' && customer.customer_stage !== 'Won').sort((a, b) => a.next_followup_date.localeCompare(b.next_followup_date)).slice(0, 4)
  const tasks = ['向 Uflex 发送 25kg 样品 PI', '确认 Agrileaf 的 USD 150 样品付款', '跟进 Flexo 客户样品的寄送状态']
  const pipeline = [
    ['New Inquiry', customers.filter(c => c.customer_stage === 'New' || c.customer_stage === 'New Inquiry' || c.customer_stage === 'Inquiry').length],
    ['Quotation', customers.filter(c => c.customer_stage === 'Quotation' || c.customer_stage === 'Quoted').length],
    ['Sample', customers.filter(c => c.customer_stage.includes('Sample')).length],
    ['Testing', customers.filter(c => c.customer_stage === 'Technical Testing' || c.customer_stage === 'Technical Confirmation').length],
    ['Negotiation', customers.filter(c => c.customer_stage === 'Negotiation').length], ['Won', customers.filter(c => c.customer_stage === 'Won').length],
  ]
  const samplesPending = customers.filter(c => c.customer_stage.includes('Sample')).length
  const recentUpdates = [...followups].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
  return <section className="page dashboard"><div className="hero"><div><p className="eyebrow"><span className="pulse"/> {today}</p><h1>早上好，Zhiwu <span>✦</span></h1><p className="subhead">一眼看清客户状态、项目阶段与下一步商业机会。</p></div><div className="goal"><div className="goal-top"><span>2026 年收入目标</span><b>¥1,000,000</b></div><div className="progress"><i style={{width:'23%'}}/></div><div className="goal-foot"><span>已完成 ¥230,000</span><strong>23%</strong></div></div></div>
    <p className="section-kicker">TODAY'S SALES STATUS</p><div className="metrics metrics-six"><Metric label="客户总数" value={String(customers.length)} delta="来自 CRM 实时统计" icon={<Users/>}/><Metric label="进行中项目" value={String(projects.length)} delta="聚焦本周推进" icon={<Layers3/>}/><Metric label="报价中" value={String(pipeline[1][1])} delta="等待价格沟通" icon={<ClipboardList/>}/><Metric label="样品阶段" value={String(samplesPending)} delta="样品与付款待推进" icon={<Package/>}/><Metric label="待跟进客户" value={String(reminders.length)} delta="按下一步行动排序" icon={<Bell/>}/><Metric label="产品数量" value="5" delta="已关联客户项目" icon={<Sparkles/>}/></div>
    <section className="panel pipeline"><PanelTitle title="销售漏斗" action="进入 CRM" onAction={onOpenCRM}/><div className="pipeline-list">{pipeline.map(([label, count], index) => <button key={label} className="pipeline-step" onClick={onOpenCRM}><span className="pipeline-index">0{index + 1}</span><span>{label}</span><b>{count}</b><i style={{ width: `${Math.max(10, Number(count) / 6 * 100)}%` }}/></button>)}</div></section>
    <div className="dashboard-grid"><section className="panel tasks"><PanelTitle title="今日重点" action="查看全部"/><div>{tasks.map((task, index) => <button className="task" key={task}><span className="task-box">{index === 2 && <Check size={13}/>}</span><span>{task}</span>{index < 2 && <b>重要</b>}<ChevronRight size={16}/></button>)}</div><button className="add-line"><Plus size={17}/> 添加任务</button></section>
    <section className="panel reminders"><PanelTitle title="Today's Follow-up" action="进入 CRM" onAction={onOpenCRM}/>{reminders.map((customer, index) => <button className="reminder-row" key={customer.id} onClick={() => openCustomer(customer)}><span className={`reminder-dot ${customer.status_tone ?? (index ? 'attention' : 'warning')}`}>{customer.status_tone === 'success' ? '●' : '⚠'}</span><div><b>{customer.company_name}</b><span>{customer.next_action?.[0] ?? customer.status_label ?? '安排下一步行动'}</span></div><time>{customer.next_followup_date.slice(5).replace('-', '/')}</time><ChevronRight size={16}/></button>)}</section></div>
    <section className="panel activity"><PanelTitle title="Recent Updates" action="查看全部"/><div className="timeline">{recentUpdates.map((update, index) => { const customer = customers.find(item => item.id === update.customer_id); return <Activity key={update.id} icon={index === 1 ? <Package/> : index === 2 ? <Check/> : <Users/>} title={`${customer?.company_name ?? '客户'} · ${update.content}`} text={`Next: ${update.next_action}`} time={update.date}/>} )}</div></section>
  </section>
}
function Metric({label,value,delta,icon}:{label:string;value:string;delta:string;icon:ReactNode}) { return <div className="metric"><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{label==='活跃客户' && <ArrowUpRight size={13}/>} {delta}</small></div></div> }
function PanelTitle({title,action,onAction}:{title:string;action:string;onAction?:()=>void}) { return <div className="panel-title"><h2>{title}</h2><button onClick={onAction}>{action}<ChevronRight size={15}/></button></div> }
function Activity({icon,title,text,time}:{icon:ReactNode;title:string;text:string;time:string}) { return <div className="activity-row"><div className="activity-icon">{icon}</div><div><b>{title}</b><span>{text}</span></div><time>{time}</time></div> }

function CRM({customers,projects,query,setQuery,open,create,addFollowup}:{customers:Customer[];projects:Project[];query:string;setQuery:(v:string)=>void;open:(c:Customer)=>void;create:()=>void;addFollowup:(customer:Customer)=>void}) {
  const pending = customers.filter(customer => customer.customer_stage !== 'Maintain Relationship' && customer.customer_stage !== 'Won').length
  const quoted = customers.filter(customer => customer.customer_stage === 'Quotation' || customer.customer_stage === 'Quoted').length
  return <section className="page crm"><div className="page-heading"><div><p className="eyebrow">CUSTOMER RELATIONSHIP MANAGEMENT</p><h1>外贸 CRM</h1><p>客户、项目、产品、报价和下一步行动汇聚在同一条业务链路。</p></div><button className="primary" onClick={create}><Plus size={17}/> 新建客户</button></div><div className="crm-kpis"><span><b>{customers.length}</b> 客户</span><span><b>{projects.length}</b> 进行中项目</span><span><b>{pending}</b> 待跟进</span><span><b>{quoted}</b> 报价中</span></div><div className="table-panel crm-card-panel"><div className="table-tools"><label><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索公司、联系人或国家" /></label><button className="filter">全部阶段 <ChevronRight size={15}/></button></div><div className="crm-cards">{customers.map(customer => { const project = projects.find(item => item.customer_id === customer.id); return <article className="crm-card" key={customer.id}><div className="crm-card-top"><div className="customer-cell"><div className="company-avatar">{customer.company_name[0]}</div><div><b>{customer.company_name}</b><span>{customer.country} · {customer.contact_person}</span></div></div><Priority value={customer.priority}/></div><div className="crm-card-status"><Stage stage={customer.customer_stage}/><span className={`status-label ${customer.status_tone ?? ''}`}>{customer.status_label ?? '跟进中'}</span></div><dl><div><dt>关注产品</dt><dd>{customer.product_interest}</dd></div><div><dt>项目</dt><dd>{project?.project_name ?? customer.application ?? '待创建项目'}</dd></div><div><dt>下一步</dt><dd>{customer.next_action?.[0] ?? '安排下一次客户联系'}</dd></div><div><dt>最后联系</dt><dd>{customer.last_contact_date}</dd></div></dl><div className="crm-card-actions"><button className="primary" onClick={() => open(customer)}>查看详情 <ChevronRight size={14}/></button><button onClick={() => open(customer)}>编辑</button><button onClick={() => addFollowup(customer)}>添加跟进</button></div></article> })}</div>{!customers.length && <div className="empty">还没有客户，点击“新建客户”开始添加。</div>}</div></section> }
function stageClass(stage: CustomerStage) { return stage.toLowerCase().replace(/\s/g, '-') }
function Stage({stage}:{stage:CustomerStage}) { return <span className={`stage ${stageClass(stage)}`}>{stageLabels[stage]}</span> }
function Priority({ value }: { value?: Customer['priority'] }) { return value ? <span className={`priority ${value.toLowerCase().replace(/\s/g, '-')}`}>{value}</span> : <span className="priority medium">MEDIUM</span> }

function Products({products,create}:{products:Product[];create:()=>void}) { return <section className="page products"><div className="page-heading"><div><p className="eyebrow">PRODUCT INTELLIGENCE</p><h1>产品中心</h1><p>把每一份产品资料变成随时可用的销售资产。</p></div><button className="primary" onClick={create}><Plus size={17}/> 添加产品</button></div><div className="product-toolbar"><label><Search size={17}/><input placeholder="搜索产品名称或编号" /></label><button className="filter">全部分类 <ChevronRight size={15}/></button></div><div className="products-grid">{products.map(p=><ProductCard key={p.id} product={p}/>)}</div>{!products.length && <div className="empty">还没有产品，点击“添加产品”创建第一份资料。</div>}</section> }
function ProductCard({product}:{product:Product}) { return <article className="product-card"><div className="product-art"><span>{product.product_code.slice(0,2)}</span><div className="product-shape one"/><div className="product-shape two"/></div><div className="product-body"><span className="category">{product.category}</span><h2>{product.product_name}</h2><code>{product.product_code}</code><p>{product.description}</p><div><span>{product.application}</span><ChevronRight size={16}/></div></div></article> }

function CustomerDrawer({customer,projects,quotes,followups,products,close,addFollowup,addQuote,updateStage}:{customer:Customer;projects:Project[];quotes:Quote[];followups:Followup[];products:Product[];close:()=>void;addFollowup:()=>void;addQuote:()=>void;updateStage:(customer:Customer,stage:CustomerStage)=>Promise<void>}) {
  const notes = followups.filter(f=>f.customer_id===customer.id)
  const project = projects.find(item => item.customer_id === customer.id)
  const customerQuotes = quotes.filter(quote => quote.customer_id === customer.id)
  const product = products.find(item => item.id === project?.product_id || item.product_code === project?.product_code || item.product_code === customer.product_interest)
  const timeline = customer.timeline ?? notes.map(note => ({ date: note.date, title: note.content, detail: `Next: ${note.next_action}` }))
  const list = (items?: string[]) => items?.length ? <ul className="detail-list">{items.map(item => <li key={item}>{item}</li>)}</ul> : <p className="detail-empty">暂无补充信息</p>
  return <div className="drawer-layer" onMouseDown={close}><aside className="drawer" onMouseDown={e=>e.stopPropagation()}><button className="close" onClick={close}><X size={20}/></button>
    <div className="drawer-head"><div className="company-avatar large">{customer.company_name[0]}</div><div><p>{customer.country} · {customer.contact_person}</p><h2>{customer.company_name}</h2><div className="drawer-badges"><Stage stage={customer.customer_stage}/><Priority value={customer.priority}/></div></div></div>
    <div className="drawer-actions"><button className="primary" onClick={() => document.getElementById('customer-stage')?.focus()}>编辑客户</button><button onClick={addFollowup}>添加跟进</button><button onClick={addQuote}>创建报价</button><button>上传文件</button></div>
    <DetailSection title="Company Profile"><div className="contact-grid"><span>联系人<b>{customer.contact_person}</b></span><span>国家 / 地区<b>{customer.country}</b></span><span>邮箱<b>{customer.email}</b></span><span>WhatsApp<b>{customer.whatsapp}</b></span></div></DetailSection>
    <DetailSection title="Customer Project"><div className="project-summary"><span>项目名称</span><b>{project?.project_name ?? customer.product_interest}</b><span>产品</span><b>{project?.product_code ?? customer.product_interest}</b><span>应用</span><b>{project?.application ?? customer.application ?? '应用待确认'}</b><span>项目阶段</span><b>{stageLabels[project?.stage ?? customer.customer_stage]}</b>{customer.monthly_consumption && <><span>月度用量</span><b>{customer.monthly_consumption}</b></>}</div>{customer.project_background && list(customer.project_background)}{customer.requirements && <div className="requirement-box"><span>关键需求</span>{list(customer.requirements)}</div>}</DetailSection>
    <DetailSection title="Interested Products"><div className="product-detail"><span>{product?.product_code ?? customer.product_interest}</span><b>{product?.product_name ?? customer.application ?? '应用待确认'}</b></div><div className="document-tags"><span>TDS</span><span>COA</span><span>Product Images</span></div></DetailSection>
    <DetailSection title="Communication Timeline"><div className="communication-timeline">{timeline.length ? timeline.map(item => <div className="communication-item" key={`${item.date}-${item.title}`}><time>{item.date}</time><div><b>{item.title}</b>{item.detail && <span>{item.detail}</span>}</div></div>) : <p className="detail-empty">尚未添加沟通记录。</p>}</div></DetailSection>
    <DetailSection title="Quotation History">{customerQuotes.length ? <div className="quote-list">{customerQuotes.map(quote => <div className="quote-row" key={quote.id}><div><b>{quote.product_code ?? customer.product_interest}</b><span>{quote.quantity} · {quote.trade_term}</span></div><div><b>{quote.amount ? `${quote.currency} ${quote.amount.toLocaleString()}` : 'Amount pending'}</b><span>{quote.status}</span></div></div>)}</div> : customer.quotation ? <div className="quotation-box">{customer.quotation.map(item => <span key={item}>{item}</span>)}</div> : <p className="detail-empty">当前没有正式报价记录。</p>}</DetailSection>
    <DetailSection title="Sample Status"><div className="sample-box"><Package size={16}/><span>{customer.sample_status ?? customer.status_label ?? '等待样品安排'}</span></div>{customer.current_progress && <div className="progress-detail"><span>当前进度</span>{list(customer.current_progress)}</div>}</DetailSection>
    <div className="next-action"><Sparkles size={17}/><div><span>Next Action</span><b>{customer.next_action?.[0] ?? notes[0]?.next_action ?? '安排下一次客户联系'}</b>{customer.next_action && customer.next_action.length > 1 && <small>{customer.next_action.slice(1).join(' · ')}</small>}</div><time>{customer.next_followup_date}</time></div><div className="stage-editor"><label htmlFor="customer-stage">更新客户阶段</label><select id="customer-stage" value={customer.customer_stage} onChange={event => void updateStage(customer, event.target.value as CustomerStage)}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><button className="primary full" onClick={addFollowup}><Plus size={17}/> 添加跟进记录</button></aside></div>
}
function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="detail-section"><h3>{title}</h3>{children}</section> }
function CustomerForm({close,submit}:{close:()=>void;submit:(f:HTMLFormElement)=>Promise<void>}) { return <Modal title="新建客户" close={close}><form onSubmit={async e=>{e.preventDefault();try { await submit(e.currentTarget) } catch (error) { alert(error instanceof Error ? error.message : '创建失败，请稍后重试。') }}}><div className="form-grid"><Field label="公司名称 *" name="company_name" required/><Field label="国家/地区 *" name="country" required/><Field label="联系人 *" name="contact_person" required/><Field label="邮箱 *" name="email" type="email" required/><Field label="WhatsApp" name="whatsapp"/><Field label="产品兴趣" name="product_interest"/><Field label="下次跟进" name="next_followup_date" type="date"/><label className="wide">备注<textarea name="notes" placeholder="记录客户背景、需求或特别事项"/></label></div><div className="form-actions"><button type="button" onClick={close}>取消</button><button className="primary">创建客户</button></div></form></Modal> }
function ProductForm({close,submit}:{close:()=>void;submit:(f:HTMLFormElement)=>Promise<void>}) { return <Modal title="添加产品" close={close}><form onSubmit={async e=>{e.preventDefault();try { await submit(e.currentTarget) } catch (error) { alert(error instanceof Error ? error.message : '保存失败，请稍后重试。') }}}><div className="form-grid"><Field label="产品名称 *" name="product_name" required/><Field label="产品编号 *" name="product_code" required/><Field label="分类" name="category"/><Field label="应用场景" name="application"/><label className="wide">产品描述<textarea name="description" placeholder="描述产品特性、优势与应用"/><textarea name="notes" placeholder="内部备注（可选）"/></label></div><div className="form-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存产品</button></div></form></Modal> }
function FollowupForm({ customer, close, submit }: { customer: Customer; close: () => void; submit: (form: HTMLFormElement) => Promise<void> }) { return <Modal title={`添加跟进 · ${customer.company_name}`} close={close}><form onSubmit={async event => { event.preventDefault(); try { await submit(event.currentTarget) } catch (error) { alert(error instanceof Error ? error.message : '保存失败，请稍后重试。') } }}><div className="form-grid"><Field label="日期 *" name="date" type="date" required/><Field label="下一步行动" name="next_action"/><label className="wide">沟通内容 *<textarea name="content" required placeholder="记录客户反馈、技术确认或项目进展"/></label></div><div className="form-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存跟进</button></div></form></Modal> }
function QuoteForm({ customer, close, submit }: { customer: Customer; close: () => void; submit: (form: HTMLFormElement) => Promise<void> }) { return <Modal title={`创建报价 · ${customer.company_name}`} close={close}><form onSubmit={async event => { event.preventDefault(); try { await submit(event.currentTarget) } catch (error) { alert(error instanceof Error ? error.message : '保存失败，请稍后重试。') } }}><div className="form-grid"><Field label="数量 *" name="quantity" required/><Field label="金额" name="amount" type="number"/><Field label="币种" name="currency"/><Field label="贸易条款" name="trade_term"/><Field label="状态" name="status"/><div/></div><div className="form-actions"><button type="button" onClick={close}>取消</button><button className="primary">保存报价</button></div></form></Modal> }
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

