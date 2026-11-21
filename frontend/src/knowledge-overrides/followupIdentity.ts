export type FollowupIdentity = { id: string; displayName: string; name: string; product: string; category: 'overseas' | 'domestic'; aliases: string[]; projects: { product: string; displayName: string }[] }

export function internalFollowupKey(value: string, kind: 'customer' | 'event' | 'task' = 'customer'): string | null {
  const comment = new RegExp(`<!--\\s*${kind}_id:\\s*([A-Za-z0-9-]+)(?=[;\\s]|-->)`).exec(value)
  if (comment) return comment[1]
  const pattern = kind === 'customer' ? /^([CD]\d+)(?=\b|[｜／])/ : kind === 'event' ? /^([CD]\d+-E[\w-]+)/ : /^([CD]\d+-T\d+)/
  return pattern.exec(value.trim())?.[1] ?? null
}

export function visibleFollowupText(value: string): string {
  return value.replace(/<!--\s*(?:customer|event|task)_id:[\s\S]*?-->/g, '').trim()
}

const unquote = (text: string) => text.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
export function identityFromLabel(id: string, displayName: string, category: 'overseas' | 'domestic' = 'overseas'): FollowupIdentity {
  const at = displayName.lastIndexOf(' · ')
  const name = at < 0 ? displayName : displayName.slice(0, at), product = at < 0 ? '' : displayName.slice(at + 3)
  return { id, displayName, name, product, category, aliases: [...new Set([displayName, name, ...name.split('／').filter(s => s.length >= 3)])], projects: [] }
}

/** Read only the explicit identity/override list schema. No inferred companies or fuzzy joins. */
export function readFollowupIdentities(markdown: string): FollowupIdentity[] {
  const head = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1] ?? ''
  const identities: FollowupIdentity[] = [], overrides: { customer_id: string; project?: string; display_name?: string }[] = []
  let section = '', entry: Record<string, string> | null = null
  const flush = () => {
    if (!entry?.customer_id) return
    if (section === 'customer_identity_map' && entry.display_name) identities.push(identityFromLabel(entry.customer_id, entry.display_name, entry.category?.startsWith('domestic') ? 'domestic' : 'overseas'))
    if (section === 'project_display_overrides') overrides.push(entry as { customer_id: string; project?: string; display_name?: string })
    entry = null
  }
  for (const line of head.split(/\r?\n/)) {
    const top = /^(\w+):/.exec(line)
    if (top) { flush(); section = top[1]; continue }
    const item = /^(?:  )?- customer_id:\s*([CD]\d+)\s*$/.exec(line)
    if (item) { flush(); entry = { customer_id: item[1] }; continue }
    const field = /^ {2,4}(display_name|category|project):\s*(.+)$/.exec(line)
    if (field && entry) entry[field[1]] = unquote(field[2])
  }
  flush()
  for (const override of overrides) {
    const identity = identities.find(i => i.id === override.customer_id)
    if (identity && override.project && override.display_name) { identity.projects.push({ product: override.project, displayName: override.display_name }); identity.aliases.push(override.display_name) }
  }
  return identities
}

function exactAlias(text: string, alias: string) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9@])${escaped}(?![A-Za-z0-9@])`, 'iu').test(text)
}
export function followupReferenceIds(value: string, identities: FollowupIdentity[]): string[] {
  const ids = [...value.matchAll(/<!--\s*customer_id:\s*([CD]\d+)/g)].map(m => m[1])
  if (ids.length) return [...new Set(ids)].filter(id => identities.some(i => i.id === id))
  const codes = [...value.matchAll(/\b([CD]\d+)\b/g)].map(m => m[1]).filter(id => identities.some(i => i.id === id))
  if (codes.length) return [...new Set(codes)]
  const visible = visibleFollowupText(value)
  const fragments = visible.split(/\s+\/\s+|／|<br\s*\/?>|\n/i).map(s => s.trim())
  const matches: { id: string; start: number; end: number }[] = []
  for (const i of identities) for (const alias of i.aliases) {
    if (!exactAlias(visible, alias) || identities.filter(other => other.aliases.includes(alias)).length !== 1) continue
    const products = [i.product, ...i.projects.map(p => p.product), ...(i.product.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [])]
    const exactFragment = fragments.some(f => f === alias || products.some(p => p && f === `${alias} ${p}`) || f.startsWith(alias) && /^(?:金额|责任|发运)$/.test(f.slice(alias.length)))
    if (!exactFragment && visible !== alias) continue
    const start = visible.toLowerCase().indexOf(alias.toLowerCase())
    matches.push({ id: i.id, start, end: start + alias.length })
  }
  // A complete exact name wins over another company's shorter contained name.
  return [...new Set(matches.filter(m => !matches.some(other => other.id !== m.id && other.start <= m.start && other.end >= m.end && other.end - other.start > m.end - m.start)).map(m => m.id))]
}

/** A record's explicitly supplied display label wins; project overrides require exact product text. */
export function followupDisplayLabel(identity: FollowupIdentity, context = '', explicitCell = ''): string {
  const explicit = visibleFollowupText(explicitCell)
  const labels = [identity.displayName, ...identity.projects.map(p => p.displayName)]
  const supplied = labels.find(label => explicit.includes(label))
  if (supplied) return supplied
  if (!identity.projects.length) return identity.displayName
  const matched = identity.projects.filter(p => exactAlias(visibleFollowupText(context), p.product))
  // Match the actual primary product or an explicit product-family token, never an amount/PI number.
  const primaryTokens = [identity.product, ...(identity.product.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) ?? [])]
  const primary = primaryTokens.some(t => t && exactAlias(visibleFollowupText(context), t))
  if (matched.length && !primary) return matched.map(p => p.displayName).join(' / ')
  if (matched.length && primary) {
    const record = visibleFollowupText(context).toLowerCase()
    const overrideFirst = Math.min(...matched.map(p => record.indexOf(p.product.toLowerCase())))
    const primaryFirst = Math.min(...primaryTokens.filter(t => t && exactAlias(record, t)).map(t => record.indexOf(t.toLowerCase())))
    // A project's lead subject is not reassigned by a later comparison to another project.
    return overrideFirst < primaryFirst ? matched.map(p => p.displayName).join(' / ') : identity.displayName
  }
  return primary ? identity.displayName : `${identity.name} · 对应产品待确认`
}
