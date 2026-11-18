let root: ShadowRoot | null = null
export function setKnowledgeRoot(value: ShadowRoot | null) { root = value }
export function knowledgeDocument(): Document | ShadowRoot { return root || document }
