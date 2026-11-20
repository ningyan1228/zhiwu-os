import type { ReactNode } from 'react'

/** Shared presentation for public prospects and private CRM records. */
export function CustomerProfileHeader({name,subtitle,source,children}:{name:string;subtitle:string;source:string;children?:ReactNode}) {
  return <div className="customer-profile-header"><small>{source}</small><h2>{name}</h2><p>{subtitle}</p>{children}</div>
}
