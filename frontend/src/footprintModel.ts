import type {Customer,Followup} from './types'
const countries:[string,string,number,number][]=[['India','印度',22,79],['Italy','意大利',42.5,12.5],['Netherlands','荷兰',52,5],['Philippines','菲律宾',12,123],['Thailand','泰国',15,101],['Turkey','土耳其',39,35],['Poland','波兰',52,19],['United States','美国',39,-98],['Vietnam','越南',16,107],['South Korea','韩国',36,128],['Brazil','巴西',-10,-52],['Mexico','墨西哥',23,-102],['Japan','日本',36,138],['China','中国',35,104],['Germany','德国',51,10],['Russia','俄罗斯',60,95],['Bangladesh','孟加拉国',24,90],['New Zealand','新西兰',-41,174],['Australia','澳大利亚',-25,134],['United Kingdom','英国',54,-2],['France','法国',47,2],['Canada','加拿大',56,-106]]
export const locationPattern=/\n?【客户足迹】\n([^]*?)\n【足迹结束】/g
export type ShippingPoint={city:string;lat:number;lng:number;source:string}
export function shippingPoint(notes:string):ShippingPoint|null{try{const match=/【客户足迹】\n([^]*?)\n【足迹结束】/.exec(notes||'');if(!match)return null;const p=JSON.parse(match[1]);return typeof p.city==='string'&&p.city.trim()&&typeof p.source==='string'&&p.source.trim()&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=85&&Number.isFinite(p.lng)&&Math.abs(p.lng)<=180?p:null}catch{return null}}
export function footprintRows(customers:Customer[],followups:Followup[]){return customers.map(c=>{
 const manual=followups.filter(f=>f.customer_id===c.id&&f.content?.trim()&&!/^(邮件自动归档：|资料补充|导入|系统)/.test(f.content)&&/^\d{4}-\d{2}-\d{2}$/.test(f.date)).sort((a,b)=>b.date.localeCompare(a.date))[0]
 const contacted=!!manual||!!c.customer_tags?.includes('实际推进客户')
 const shipping=shippingPoint(c.notes),country=countries.find(x=>x[0].toLowerCase()===c.country?.trim().toLowerCase()||x[1]===c.country?.trim())
 return {customer:c,manual,contacted,shipping,country:country?.[1]||c.country,point:shipping?[shipping.lat,shipping.lng] as [number,number]:country?[country[2],country[3]] as [number,number]:null,level:shipping?'收货城市':'国家级 · 城市待补'}
})}
