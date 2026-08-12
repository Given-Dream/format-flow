import type { WorkflowSkillPackageEntry } from './types'

export function validateWorkflowSkillInventoryEntries(entries: WorkflowSkillPackageEntry[]): string {
  const unnumbered = entries.filter((entry) => !Number.isSafeInteger(entry.order))
  if (unnumbered.length > 0) return `以下 Skill 目录缺少两位数字前缀：${unnumbered.map((entry) => entry.directoryName).join('、')}`
  const missingNames = entries.filter((entry) => !entry.frontmatterName.trim())
  if (missingNames.length > 0) return `以下 SKILL.md 缺少 frontmatter name：${missingNames.map((entry) => entry.directoryName).join('、')}`
  const names = new Map<string, WorkflowSkillPackageEntry[]>()
  for (const entry of entries) {
    const nameKey = entry.frontmatterName.trim().toLocaleLowerCase()
    names.set(nameKey, [...(names.get(nameKey) || []), entry])
  }
  const duplicateNames = Array.from(names.values()).filter((matches) => matches.length > 1)
  if (duplicateNames.length > 0) return `SKILL.md frontmatter name 重复：${duplicateNames.map((matches) => matches[0].frontmatterName).join('、')}`
  return ''
}

export function validateWorkflowSkillPackageEntries(entries: WorkflowSkillPackageEntry[]): string {
  const inventoryError = validateWorkflowSkillInventoryEntries(entries)
  if (inventoryError) return inventoryError
  const orders = new Map<number, WorkflowSkillPackageEntry[]>()
  for (const entry of entries) {
    orders.set(entry.order, [...(orders.get(entry.order) || []), entry])
  }
  const duplicateOrders = Array.from(orders.entries()).filter(([, matches]) => matches.length > 1)
  if (duplicateOrders.length > 0) return `Skill 目录编号重复：${duplicateOrders.map(([order]) => String(order).padStart(2, '0')).join('、')}`
  const values = Array.from(orders.keys()).sort((left, right) => left - right)
  const start = values.includes(0) ? 0 : 1
  const missing: number[] = []
  for (let value = start; value <= values.at(-1)!; value += 1) {
    if (!orders.has(value)) missing.push(value)
  }
  if (missing.length > 0) return `Skill 目录编号断档：缺少 ${missing.map((value) => String(value).padStart(2, '0')).join('、')}`
  return ''
}

export function safeManagedSkillDirectoryName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-').replace(/[. ]+$/g, '').slice(0, 120) || 'skill'
}

export function extractWorkflowSkillFrontmatterName(content: string): string {
  const normalized = content.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) return ''
  const end = normalized.indexOf('\n---', 3)
  if (end === -1) return ''
  const frontmatter = normalized.slice(3, end).split(/\r?\n/)
  const nameLine = frontmatter.find((line) => /^name\s*:/i.test(line))
  if (!nameLine) return ''
  const value = nameLine.replace(/^name\s*:\s*/i, '').trim()
  if (!value) return ''
  const quote = value[0]
  return (quote === '"' || quote === "'") && value.endsWith(quote)
    ? value.slice(1, -1).trim()
    : value
}
