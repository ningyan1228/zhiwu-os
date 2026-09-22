import type { LeadSearchTask } from './types'

type DiscoveryTaskDraft = Omit<LeadSearchTask, 'id' | 'user_id' | 'last_run_at' | 'last_run_status' | 'last_error' | 'created_at'>

export type TdsDiscoveryPreset = {
  id: 'nl-w1201' | 'epoxidized-linseed-oil' | 'fertilizer-coating'
  title: string
  material: string
  summary: string
  applications: string[]
  customerFocus: string[]
  task: DiscoveryTaskDraft
}

// These profiles are a reviewed snapshot of the three supplied TDS documents.
// Demand-side search deliberately uses applications and maker roles rather than
// the material names, so the crawler does not drift toward competing suppliers.
export const tdsDiscoveryPresets: TdsDiscoveryPreset[] = [
  {
    id: 'nl-w1201',
    title: 'NL-W1201 水性表面处理剂',
    material: '水性聚烯烃乳液 · PP / PE / OPP 附着力促进',
    summary: '寻找生产水性油墨、水性底涂或软包装膜材涂层的配方商与制造企业。',
    applications: ['水性柔印/凹印油墨', 'PP / OPP / BOPP 膜材底涂', '聚丙烯水性涂层', '水性塑料底漆'],
    customerFocus: ['印度、越南、泰国、印尼、土耳其', '油墨制造商、涂料配方商、软包装加工企业'],
    task: {
      task_name: 'TDS预设｜NL-W1201｜水性 PP/OPP 涂层客户',
      discovery_mode: '需求客户',
      product_id: null,
      product_keywords: ['NL-W1201', 'water-based polyolefin emulsion'],
      application_keywords: ['water based flexographic inks', 'waterborne flexographic inks', 'water based printing inks', 'water based inks', 'BOPP films', 'OPP films', 'polypropylene coatings', 'waterborne primers'],
      target_countries: ['India', 'Vietnam', 'Thailand', 'Indonesia', 'Turkey'],
      excluded_countries: ['China'],
      target_company_types: ['printing ink manufacturer', 'coating manufacturer', 'flexible packaging converter', 'manufacturer', 'formulator'],
      profile_exclusion_rules: ['trading company', 'chemical raw material supplier', 'wholesaler', 'marketplace', 'association', 'directory'],
      // Public downstream manufacturers verified against the stated application.
      // They provide a useful first run even before a search API is configured.
      source_urls: ['https://www.hindavisolution.com/flexographic-printing-inks.php', 'https://www.isonicink.com/', 'https://dolphininks.com/'],
      search_language: 'English',
      max_results: 50,
      daily_enabled: false,
      daily_run_time: '08:30',
      status: '启用',
    },
  },
  {
    id: 'epoxidized-linseed-oil',
    title: '环氧化亚麻籽油（ELO）',
    material: '生物基增塑 / 稳定 / 树脂改性材料',
    summary: '寻找会自行配制柔性 PVC、电缆料、薄膜、人造革或工业涂料的制造商。',
    applications: ['柔性 PVC 配混', 'PVC 电缆料', 'PVC 膜与片材', '人造革', '涂料、胶黏剂、油墨改性'],
    customerFocus: ['印度、越南、泰国、印尼、马来西亚、土耳其', 'PVC 配混厂、电缆料厂、薄膜/人造革制造商'],
    task: {
      task_name: 'TDS预设｜ELO｜柔性 PVC 与配方改性客户',
      discovery_mode: '需求客户',
      product_id: null,
      product_keywords: ['Epoxidized Linseed Oil', 'ELO bio-based plasticizer'],
      application_keywords: ['flexible PVC compounds', 'PVC compounds', 'PVC cable compounds', 'PVC films and sheets', 'PVC artificial leather', 'PVC flooring', 'industrial sealants'],
      target_countries: ['India', 'Vietnam', 'Thailand', 'Indonesia', 'Malaysia', 'Turkey'],
      excluded_countries: ['China'],
      target_company_types: ['PVC compound manufacturer', 'cable compound manufacturer', 'PVC film manufacturer', 'artificial leather manufacturer', 'manufacturer', 'formulator'],
      profile_exclusion_rules: ['trading company', 'chemical raw material supplier', 'wholesaler', 'marketplace', 'association', 'directory'],
      source_urls: ['https://www.pvccompound.in/', 'https://www.periwalpolymers.com/', 'https://www.konnarkpolymer.com/', 'https://www.devpolymer.com/'],
      search_language: 'English',
      max_results: 50,
      daily_enabled: false,
      daily_run_time: '08:30',
      status: '启用',
    },
  },
  {
    id: 'fertilizer-coating',
    title: '缓释肥料专用包膜剂',
    material: '控释肥、包膜尿素与 NPK 的液体包膜原料',
    summary: '寻找拥有包膜尿素、控释肥或包膜 NPK 产品及滚筒/流化床工艺的肥料制造商。',
    applications: ['聚合物包膜尿素', '控释/缓释肥', '包膜 NPK', '肥料包膜', '滚筒/流化床包膜'],
    customerFocus: ['印度、越南、泰国、印尼、马来西亚、土耳其、中东', '控释肥、包膜尿素和 NPK 肥料制造商'],
    task: {
      task_name: 'TDS预设｜缓释肥包膜剂｜控释肥与包膜尿素客户',
      discovery_mode: '需求客户',
      product_id: null,
      product_keywords: ['slow release fertilizer coating agent', 'fertilizer coating material'],
      application_keywords: ['polymer coated urea', 'controlled release fertilizer', 'coated NPK fertilizer', 'slow release fertilizer', 'fertilizer coating'],
      target_countries: ['India', 'Vietnam', 'Thailand', 'Indonesia', 'Malaysia', 'Turkey', 'United Arab Emirates', 'Saudi Arabia'],
      excluded_countries: ['China'],
      target_company_types: ['controlled release fertilizer manufacturer', 'coated urea manufacturer', 'fertilizer manufacturer', 'NPK manufacturer', 'manufacturer'],
      profile_exclusion_rules: ['fertilizer retailer', 'agricultural store', 'trading company', 'wholesaler', 'marketplace', 'association', 'directory'],
      source_urls: ['https://www.smart-fert.com/products/', 'https://twinarrow.com.my/', 'https://www.crfagritech.com/', 'https://www.uregold.com/'],
      search_language: 'English',
      max_results: 50,
      daily_enabled: false,
      daily_run_time: '08:30',
      status: '启用',
    },
  },
]
