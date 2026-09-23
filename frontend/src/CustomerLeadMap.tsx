import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Building2, ExternalLink, Filter, Mail, MapPin, Phone, Search, X } from 'lucide-react'
import type { ApplicationDiscoveryTask, CustomerLead } from './types'
import './customer-lead-map.css'

type Coordinates = [number, number]
type LocationRule = { label: string; coordinates: Coordinates; aliases: string[] }
type LocatedLead = {
  lead: CustomerLead
  coordinates: Coordinates
  locationLabel: string
  precision: 'address' | 'country'
}

const COUNTRY_LOCATIONS: LocationRule[] = [
  { label: '巴西', coordinates: [-14.235, -51.925], aliases: ['brazil', 'brasil', '巴西'] },
  { label: '印度', coordinates: [22.594, 78.963], aliases: ['india', '印度'] },
  { label: '越南', coordinates: [15.903, 105.806], aliases: ['vietnam', 'viet nam', '越南'] },
  { label: '泰国', coordinates: [15.87, 100.993], aliases: ['thailand', '泰国'] },
  { label: '印度尼西亚', coordinates: [-2.549, 118.014], aliases: ['indonesia', '印度尼西亚', '印尼'] },
  { label: '马来西亚', coordinates: [4.211, 101.976], aliases: ['malaysia', '马来西亚'] },
  { label: '菲律宾', coordinates: [12.88, 121.774], aliases: ['philippines', '菲律宾'] },
  { label: '土耳其', coordinates: [38.964, 35.244], aliases: ['turkey', 'türkiye', 'turkiye', '土耳其'] },
  { label: '美国', coordinates: [39.828, -98.58], aliases: ['united states', 'usa', 'u.s.a', '美国'] },
  { label: '墨西哥', coordinates: [23.635, -102.553], aliases: ['mexico', 'méxico', '墨西哥'] },
  { label: '加拿大', coordinates: [56.13, -106.347], aliases: ['canada', '加拿大'] },
  { label: '德国', coordinates: [51.166, 10.452], aliases: ['germany', 'deutschland', '德国'] },
  { label: '法国', coordinates: [46.228, 2.214], aliases: ['france', '法国'] },
  { label: '意大利', coordinates: [41.872, 12.568], aliases: ['italy', 'italia', '意大利'] },
  { label: '西班牙', coordinates: [40.464, -3.749], aliases: ['spain', 'españa', 'espana', '西班牙'] },
  { label: '英国', coordinates: [55.378, -3.436], aliases: ['united kingdom', 'great britain', 'uk', '英国'] },
  { label: '荷兰', coordinates: [52.133, 5.291], aliases: ['netherlands', 'holland', '荷兰'] },
  { label: '波兰', coordinates: [51.919, 19.145], aliases: ['poland', 'polska', '波兰'] },
  { label: '俄罗斯', coordinates: [61.524, 105.319], aliases: ['russia', '俄罗斯'] },
  { label: '南非', coordinates: [-30.559, 22.938], aliases: ['south africa', '南非'] },
  { label: '埃及', coordinates: [26.821, 30.802], aliases: ['egypt', '埃及'] },
  { label: '阿联酋', coordinates: [23.424, 53.848], aliases: ['united arab emirates', 'uae', '阿联酋'] },
  { label: '沙特阿拉伯', coordinates: [23.886, 45.079], aliases: ['saudi arabia', '沙特阿拉伯', '沙特'] },
  { label: '澳大利亚', coordinates: [-25.274, 133.775], aliases: ['australia', '澳大利亚'] },
  { label: '中国', coordinates: [35.862, 104.195], aliases: ['china', '中国'] },
  { label: '日本', coordinates: [36.205, 138.253], aliases: ['japan', '日本'] },
  { label: '韩国', coordinates: [35.908, 127.767], aliases: ['south korea', 'korea', '韩国'] },
]

const PRECISE_LOCATIONS: LocationRule[] = [
  { label: 'Mato Grosso, Brazil', coordinates: [-12.682, -56.921], aliases: ['mato grosso', 'cuiabá', 'cuiaba'] },
  { label: 'Goiás, Brazil', coordinates: [-15.827, -49.836], aliases: ['goiás', 'goias', 'goiânia', 'goiania'] },
  { label: 'Paraná, Brazil', coordinates: [-24.894, -51.55], aliases: ['paraná', 'parana', 'curitiba'] },
  { label: 'São Paulo, Brazil', coordinates: [-22.19, -48.79], aliases: ['são paulo', 'sao paulo', 'campinas', 'ribeirão preto', 'ribeirao preto'] },
  { label: 'Minas Gerais, Brazil', coordinates: [-18.512, -44.555], aliases: ['minas gerais', 'belo horizonte', 'uberaba', 'uberlândia', 'uberlandia'] },
  { label: 'Bahia, Brazil', coordinates: [-12.58, -41.7], aliases: ['bahia', 'salvador'] },
  { label: 'Rio Grande do Sul, Brazil', coordinates: [-30.035, -51.218], aliases: ['rio grande do sul', 'porto alegre'] },
  { label: 'Santa Catarina, Brazil', coordinates: [-27.243, -50.218], aliases: ['santa catarina', 'florianópolis', 'florianopolis'] },
  { label: 'Maharashtra, India', coordinates: [19.751, 75.714], aliases: ['maharashtra', 'mumbai', 'pune'] },
  { label: 'Gujarat, India', coordinates: [22.259, 71.192], aliases: ['gujarat', 'ahmedabad', 'vadodara'] },
  { label: 'Tamil Nadu, India', coordinates: [11.127, 78.657], aliases: ['tamil nadu', 'chennai', 'coimbatore'] },
  { label: 'Karnataka, India', coordinates: [15.318, 75.714], aliases: ['karnataka', 'bengaluru', 'bangalore'] },
  { label: 'Telangana, India', coordinates: [18.112, 79.019], aliases: ['telangana', 'hyderabad'] },
  { label: 'Ho Chi Minh City, Vietnam', coordinates: [10.824, 106.629], aliases: ['ho chi minh', 'hồ chí minh'] },
  { label: 'Bangkok, Thailand', coordinates: [13.756, 100.502], aliases: ['bangkok', 'กรุงเทพ'] },
  { label: 'Jakarta, Indonesia', coordinates: [-6.208, 106.846], aliases: ['jakarta'] },
  { label: 'Kuala Lumpur, Malaysia', coordinates: [3.139, 101.687], aliases: ['kuala lumpur', 'selangor'] },
]

function normalized(value?: string | null) {
  return (value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function deterministicOffset(seed: string, scale: number): Coordinates {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619)
  const latitude = (((hash >>> 1) % 1000) / 999 - 0.5) * scale
  const longitude = (((hash >>> 11) % 1000) / 999 - 0.5) * scale
  return [latitude, longitude]
}

function locateLead(lead: CustomerLead): LocatedLead | null {
  const address = normalized(`${lead.official_address || ''} ${lead.city || ''}`)
  const precise = PRECISE_LOCATIONS.find(rule => rule.aliases.some(alias => address.includes(normalized(alias))))
  const seed = lead.website_domain || lead.company_name || lead.id
  if (precise) {
    const offset = deterministicOffset(seed, 0.32)
    return { lead, coordinates: [precise.coordinates[0] + offset[0], precise.coordinates[1] + offset[1]], locationLabel: precise.label, precision: 'address' }
  }
  const countryText = normalized(`${lead.country || ''} ${lead.official_address || ''}`)
  const country = COUNTRY_LOCATIONS.find(rule => rule.aliases.some(alias => countryText.includes(normalized(alias))))
  if (!country) return null
  const offset = deterministicOffset(seed, 2.2)
  return { lead, coordinates: [country.coordinates[0] + offset[0], country.coordinates[1] + offset[1]], locationLabel: country.label, precision: 'country' }
}

function externalUrl(value?: string | null) {
  if (!value) return ''
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function contactLabel(lead: CustomerLead) {
  if (lead.public_business_email) return lead.public_business_email
  if (lead.public_business_phone) return lead.public_business_phone
  if (lead.contact_department || lead.public_contact_or_department) return lead.contact_department || lead.public_contact_or_department
  return '公开联系方式待补充'
}

function countryFromLabel(label: string) {
  const parts = label.split(',')
  return parts[parts.length - 1]?.trim() || label
}

export function CustomerLeadMap({ task, leads, onClose }: { task: ApplicationDiscoveryTask; leads: CustomerLead[]; onClose: () => void }) {
  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const markerIndex = useRef(new Map<string, L.CircleMarker>())
  const [country, setCountry] = useState('全部地区')
  const [grade, setGrade] = useState('全部等级')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(leads[0]?.id || '')

  const allLocated = useMemo(() => leads.map(locateLead).filter((item): item is LocatedLead => Boolean(item)), [leads])
  const countries = useMemo(() => Array.from(new Set(allLocated.map(item => countryFromLabel(item.locationLabel)))).sort(), [allLocated])
  const points = useMemo(() => allLocated.filter(item => {
    const countryLabel = countryFromLabel(item.locationLabel)
    const matchesCountry = country === '全部地区' || countryLabel === country
    const matchesGrade = grade === '全部等级' || (grade === '待补信息' ? !item.lead.matching_grade : item.lead.matching_grade === grade)
    const text = `${item.lead.company_name} ${item.lead.country || ''} ${item.lead.city || ''} ${item.lead.business_scope || ''} ${item.lead.discovered_application_keywords.join(' ')}`.toLowerCase()
    return matchesCountry && matchesGrade && text.includes(query.trim().toLowerCase())
  }), [allLocated, country, grade, query])
  const selected = points.find(item => item.lead.id === selectedId) || points[0]
  const addressCount = allLocated.filter(item => item.precision === 'address').length
  const contactCount = leads.filter(item => item.public_business_email || item.public_business_phone).length

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  useEffect(() => {
    if (!mapElement.current) return
    markerIndex.current.clear()
    const map = L.map(mapElement.current, { zoomControl: true, minZoom: 2, worldCopyJump: true }).setView([18, 20], 2)
    mapInstance.current = map
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }).addTo(map)
    const group = L.featureGroup().addTo(map)
    points.forEach(point => {
      const color = point.lead.matching_grade === 'A' ? '#f7c95c' : point.lead.matching_grade === 'B' ? '#72d3b1' : '#8aa0ab'
      const marker = L.circleMarker(point.coordinates, {
        radius: Math.max(7, Math.min(14, 6 + point.lead.match_score / 18)),
        color: point.precision === 'address' ? '#f7f1d8' : color,
        weight: point.precision === 'address' ? 2 : 1.5,
        dashArray: point.precision === 'country' ? '4 4' : undefined,
        fillColor: color,
        fillOpacity: 0.88,
      })
      marker.on('click', () => setSelectedId(point.lead.id))
      marker.bindTooltip(point.lead.company_name, { direction: 'top', offset: [0, -8], opacity: 0.96 })
      marker.addTo(group)
      markerIndex.current.set(point.lead.id, marker)
    })
    if (points.length === 1) map.setView(points[0].coordinates, points[0].precision === 'address' ? 6 : 4)
    else if (points.length > 1) map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 6 })
    window.setTimeout(() => map.invalidateSize(), 80)
    return () => { map.remove(); mapInstance.current = null }
  }, [points])

  useEffect(() => {
    if (!points.some(item => item.lead.id === selectedId)) setSelectedId(points[0]?.lead.id || '')
  }, [points, selectedId])

  const focusLead = (item: LocatedLead) => {
    setSelectedId(item.lead.id)
    mapInstance.current?.flyTo(item.coordinates, Math.max(mapInstance.current.getZoom(), item.precision === 'address' ? 7 : 5), { duration: 0.7 })
    markerIndex.current.get(item.lead.id)?.openTooltip()
  }

  return <div className="customer-map-layer" role="dialog" aria-modal="true" aria-label={`${task.task_name}客户地图`}>
    <section className="customer-map-shell">
      <header className="customer-map-header">
        <div><p>TDS CUSTOMER DISTRIBUTION</p><h2>{task.task_name}</h2><span>{task.target_region || '全球'} · 已采集 {leads.length} 家 · 地图可定位 {allLocated.length} 家</span></div>
        <div className="customer-map-kpis"><span><b>{addressCount}</b> 地址级</span><span><b>{allLocated.length - addressCount}</b> 国家级估算</span><span><b>{contactCount}</b> 有公开联系方式</span></div>
        <button className="customer-map-close" onClick={onClose} aria-label="关闭客户地图"><X size={20}/></button>
      </header>
      <div className="customer-map-toolbar">
        <label><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索公司、业务或应用"/></label>
        <label><MapPin size={15}/><select value={country} onChange={event => setCountry(event.target.value)}><option>全部地区</option>{countries.map(item => <option key={item}>{item}</option>)}</select></label>
        <label><Filter size={15}/><select value={grade} onChange={event => setGrade(event.target.value)}><option>全部等级</option><option>A</option><option>B</option><option>待补信息</option></select></label>
        <span className="customer-map-legend"><i className="solid"/> 地址识别 <i className="estimated"/> 国家级估算</span>
      </div>
      <div className="customer-map-body">
        <div className="customer-map-canvas-wrap"><div ref={mapElement} className="customer-map-canvas"/>{!points.length && <div className="customer-map-empty"><MapPin size={27}/><b>当前筛选没有可定位客户</b><span>客户需要至少有国家；填写官网地址后可提升到州/省级定位。</span></div>}<div className="customer-map-applications">{task.application_snapshot.filter(item => item.selected).slice(0, 4).map(item => <span key={item.id}>{item.application_name}</span>)}</div></div>
        <aside className="customer-map-list"><header><div><b>{points.length} 个位置</b><span>点击公司，地图会自动定位</span></div></header><div className="customer-map-scroll">{points.map(item => <button key={item.lead.id} className={selected?.lead.id === item.lead.id ? 'active' : ''} onClick={() => focusLead(item)}><span className="customer-map-pin"><Building2 size={18}/></span><span><b>{item.lead.company_name}</b><small>{item.locationLabel} · {item.precision === 'address' ? '地址识别' : '国家级估算'}</small><em>{item.lead.matching_grade ? `${item.lead.matching_grade} 类` : '待补信息'} · 匹配 {item.lead.match_score}</em></span></button>)}</div>{selected && <article className="customer-map-detail"><div><span>{selected.lead.verification_bucket}</span><b>{selected.lead.company_name}</b><p>{selected.lead.product_evidence_summary || selected.lead.business_scope || selected.lead.possible_need || '业务证据待补充'}</p></div><dl><div><dt>匹配理由</dt><dd>{selected.lead.score_reasons?.join('；') || selected.lead.verification_conclusion || '待人工核验'}</dd></div><div><dt>公开联系</dt><dd>{contactLabel(selected.lead)}</dd></div><div><dt>待确认</dt><dd>{selected.lead.missing_requirements?.join('；') || selected.lead.confirmation_note || '无额外待确认项'}</dd></div></dl><footer>{selected.lead.public_business_email && <a href={`mailto:${selected.lead.public_business_email}`}><Mail size={14}/> 邮件</a>}{selected.lead.public_business_phone && <a href={`tel:${selected.lead.public_business_phone}`}><Phone size={14}/> 电话</a>}{(selected.lead.official_homepage_url || selected.lead.website || selected.lead.official_website) && <a href={externalUrl(selected.lead.official_homepage_url || selected.lead.website || selected.lead.official_website)} target="_blank" rel="noreferrer"><ExternalLink size={14}/> 官网</a>}</footer></article>}</aside>
      </div>
    </section>
  </div>
}
