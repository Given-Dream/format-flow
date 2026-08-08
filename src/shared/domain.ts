import type {
  AppStore,
  DataDirectoryOverrides,
  GroupItem,
  McpServer,
  PromptDuplicateGroup,
  PromptItem,
  PromptImportAnalysis,
  PromptDuplicateConflict,
  ResourceGroups,
  RunStep,
  SkillDuplicateGroup,
  SkillItem,
  SkillDuplicateConflict,
  SkillImportAnalysis,
  SkillMetadata,
  Workflow,
  WorkflowEdge,
  WorkflowNode
} from './types'
import { normalizeDiscoverySources } from './github-discovery'

export const STORE_VERSION = 2
export const DEFAULT_SHORTCUT = 'CommandOrControl+Alt+F'

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}_${random}`
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#/, '').toLowerCase()
}

export function parseTags(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[,，;；\r\n]+/)
        .map(normalizeTag)
        .filter(Boolean)
    )
  )
}

export function groupFromTag(tag: string): GroupItem {
  const normalized = normalizeTag(tag)
  return {
    id: newId('group'),
    name: normalized || 'group',
    tag: normalized || 'group',
    children: []
  }
}

export function groupsFromTags(tags: string[]): GroupItem[] {
  return tags.map(groupFromTag)
}

export function defaultGroups(prompts: PromptItem[] = []): ResourceGroups {
  return {
    prompts: groupsFromTags(allTags(prompts)),
    skills: [],
    workflows: [],
    mcps: [],
    quickCalls: groupsFromTags(allTags(prompts)),
    learning: groupsFromTags(['hermes', '对话审查', '工程控制论学习用户习惯'])
  }
}

export function tagsToText(tags: string[]): string {
  return tags.join(', ')
}

export function createPrompt(overrides: Partial<PromptItem> = {}): PromptItem {
  const timestamp = nowIso()
  return {
    id: newId('prompt'),
    title: '新的提示词',
    summary: '一句话说明这个提示词的用途。',
    content: '任务目标：\n\n输入材料：\n\n输出要求：\n',
    tags: [],
    variables: [],
    preferredSkillIds: [],
    version: 1,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

export function clonePromptToGroup(prompt: PromptItem, targetTag: string, title = `${prompt.title} 副本`): PromptItem {
  const timestamp = nowIso()
  const normalizedTag = normalizeTag(targetTag)
  return {
    ...prompt,
    id: newId('prompt'),
    title,
    tags: normalizedTag ? [normalizedTag] : [],
    variables: extractPromptVariables(prompt.content),
    version: 1,
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

export function createPromptFromText(content: string, sourceName = 'Imported Prompt'): PromptItem {
  const cleanContent = content.trim()
  const title =
    cleanContent.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    sourceName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') ||
    'Imported Prompt'
  const summary = trimSummary(firstPlainParagraph(cleanContent) || 'Imported prompt')

  return createPrompt({
    title,
    summary,
    content: cleanContent || sourceName,
    tags: ['imported'],
    variables: extractPromptVariables(cleanContent)
  })
}

export function parsePromptImport(content: string, sourceName = 'backup'): PromptItem[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  const embeddedBackup = parseEmbeddedPromptMarkdownBackup(trimmed, sourceName)
  if (embeddedBackup.length > 0) return embeddedBackup

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.prompts)
        ? parsed.prompts
        : []

    if (candidates.length > 0) {
      return promptItemsFromRecords(candidates, sourceName)
    }
  } catch {
    // Try the readable Markdown export format before falling back to a single prompt.
  }

  const markdownPrompts = parsePromptMarkdownExport(trimmed, sourceName)
  if (markdownPrompts.length > 0) return markdownPrompts

  return [createPromptFromText(trimmed, sourceName)]
}

export function analyzePromptImport(existing: PromptItem[], imported: PromptItem[]): PromptImportAnalysis {
  const usedIds = new Set(existing.map((prompt) => prompt.id))
  const knownByKey = new Map(existing.map((prompt) => [promptDuplicateKey(prompt), prompt]))
  const additions: PromptItem[] = []
  const identical: PromptImportAnalysis['identical'] = []
  const conflicts: PromptDuplicateConflict[] = []

  for (const rawPrompt of imported) {
    let id = rawPrompt.id
    if (!id || usedIds.has(id)) id = newId('prompt')
    usedIds.add(id)
    const prompt = { ...rawPrompt, id, updatedAt: nowIso() }
    const key = promptDuplicateKey(prompt)
    const duplicate = knownByKey.get(key)
    if (!duplicate) {
      additions.push(prompt)
      knownByKey.set(key, prompt)
      continue
    }
    if (normalizePromptBody(duplicate.content) === normalizePromptBody(prompt.content)) {
      identical.push({ existing: duplicate, imported: prompt })
      continue
    }
    conflicts.push({ id: newId('prompt-conflict'), existing: duplicate, imported: prompt })
  }

  return { additions, identical, conflicts }
}

export function findPromptDuplicateGroups(prompts: PromptItem[]): PromptDuplicateGroup[] {
  const grouped = new Map<string, PromptItem[]>()
  for (const prompt of prompts) {
    const key = promptDuplicateKey(prompt)
    grouped.set(key, [...(grouped.get(key) || []), prompt])
  }

  return Array.from(grouped.values())
    .filter((items) => items.length > 1)
    .map((items, index) => ({
      id: `prompt-duplicate-${index}`,
      items,
      identicalContent: new Set(items.map((prompt) => normalizePromptBody(prompt.content))).size === 1
    }))
}

function promptDuplicateKey(prompt: Pick<PromptItem, 'title' | 'summary'>): string {
  return `${prompt.title.trim()}\u0000${prompt.summary.trim()}`
}

function normalizePromptBody(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

function promptItemsFromRecords(candidates: unknown[], sourceName: string): PromptItem[] {
  return candidates.filter(isRecord).map((item) => {
    const promptContent = stringOr(item.content, '')
    return createPrompt({
      id: typeof item.id === 'string' ? item.id : newId('prompt'),
      title: stringOr(item.title, sourceName.replace(/\.[^.]+$/, '') || 'Imported Prompt'),
      summary: stringOr(item.summary, 'Imported prompt'),
      content: promptContent,
      tags: Array.isArray(item.tags) ? item.tags.map(String).map(normalizeTag).filter(Boolean) : ['imported'],
      variables: Array.isArray(item.variables) ? item.variables.map(String) : extractPromptVariables(promptContent),
      preferredSkillIds: Array.isArray(item.preferredSkillIds)
        ? item.preferredSkillIds.map(String).filter(Boolean)
        : Array.isArray(item.preselectedSkillIds)
          ? item.preselectedSkillIds.map(String).filter(Boolean)
          : [],
      version: numberOr(item.version, 1),
      favorite: Boolean(item.favorite),
      createdAt: stringOr(item.createdAt, nowIso()),
      updatedAt: stringOr(item.updatedAt, nowIso())
    })
  })
}

function parseEmbeddedPromptMarkdownBackup(content: string, sourceName: string): PromptItem[] {
  const match = content.match(/<!--\s*format-flow-prompts-json\s+([A-Za-z0-9+/=\s]+?)\s*-->/)
  if (!match) return []

  try {
    const decoded = decodeBase64Utf8(match[1])
    const parsed = JSON.parse(decoded) as unknown
    const candidates = isRecord(parsed) && Array.isArray(parsed.prompts) ? parsed.prompts : []
    return candidates.length > 0 ? promptItemsFromRecords(candidates, sourceName) : []
  } catch {
    return []
  }
}

function parsePromptMarkdownExport(content: string, sourceName: string): PromptItem[] {
  if (!/^#\s+Format Flow Prompts\s*$/m.test(content)) return []

  const sectionMatches = Array.from(content.matchAll(/^##\s+(?:\d+\.\s*)?(.+?)\s*$/gm))
  if (sectionMatches.length === 0) return []

  const prompts: PromptItem[] = []
  for (let index = 0; index < sectionMatches.length; index += 1) {
    const match = sectionMatches[index]
    const title = match[1]?.trim() || sourceName.replace(/\.[^.]+$/, '') || 'Imported Prompt'
    const sectionStart = (match.index ?? 0) + match[0].length
    const sectionEnd = index + 1 < sectionMatches.length ? sectionMatches[index + 1].index ?? content.length : content.length
    const section = content.slice(sectionStart, sectionEnd).trim()
    const promptContent = extractFirstMarkdownCodeBlock(section).trim()
    if (!promptContent) continue

    const summary = markdownMetaValue(section, 'Summary') || trimSummary(firstPlainParagraph(promptContent) || 'Imported prompt')
    const tags = parseExportedList(markdownMetaValue(section, 'Tags')).map(normalizeTag).filter(Boolean)
    const variables = parseExportedList(markdownMetaValue(section, 'Variables'))
    const preferredSkillIds = parseExportedList(markdownMetaValue(section, 'Preferred Skill IDs'))
    const versionValue = Number.parseInt(markdownMetaValue(section, 'Version') || '', 10)
    const updatedAt = markdownMetaValue(section, 'Updated')

    prompts.push(
      createPrompt({
        title,
        summary,
        content: promptContent,
        tags,
        variables: variables.length > 0 ? variables : extractPromptVariables(promptContent),
        preferredSkillIds,
        version: Number.isFinite(versionValue) ? versionValue : 1,
        updatedAt: updatedAt || nowIso()
      })
    )
  }

  return prompts
}

function extractFirstMarkdownCodeBlock(section: string): string {
  const match = section.match(/(?:^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1[ \t]*(?:\n|$)/)
  return match?.[2] || ''
}

function markdownMetaValue(section: string, key: string): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = section.match(new RegExp(`^-\\s+${escapedKey}:\\s*(.*)$`, 'm'))
  return match?.[1]?.trim() || ''
}

function parseExportedList(value: string): string[] {
  if (!value || value === '-') return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function decodeBase64Utf8(value: string): string {
  const normalized = value.replace(/\s/g, '')
  if (typeof Buffer !== 'undefined') return Buffer.from(normalized, 'base64').toString('utf8')
  const binary = atob(normalized)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function createMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  const timestamp = nowIso()
  return {
    id: newId('mcp'),
    name: 'new-mcp-server',
    command: '',
    args: [],
    env: {},
    cwd: '',
    url: '',
    transport: 'stdio',
    enabled: true,
    tags: [],
    source: 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

export function parseMcpConfig(content: string, sourceName = 'mcp-config'): McpServer[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  try {
    return parseMcpJson(JSON.parse(trimmed) as unknown)
  } catch {
    return parseMcpToml(trimmed, sourceName)
  }
}

export function createWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  const timestamp = nowIso()
  return {
    id: newId('workflow'),
    title: '新的工作流',
    description: '把提示词、Skill 和人工审查节点排成可执行工作流。',
    tags: [],
    variables: [],
    favorite: false,
    nodes: [],
    edges: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  }
}

export function defaultStore(): AppStore {
  const promptA = createPrompt({
    id: 'prompt_preflight_review',
    title: '修改前检查',
    summary: '先检查代码结构、风险和验收标准，再决定实现步骤。',
    content:
      '请先检查当前工作区结构和相关文件，不要直接修改代码。\n\n输出：\n- 现有实现摘要\n- 关键风险\n- 推荐实现路径\n- 可验证的验收标准\n',
    tags: ['codex', 'review', 'preflight']
  })

  const promptB = createPrompt({
    id: 'prompt_safe_implementation',
    title: '安全实现',
    summary: '在不覆盖用户无关修改的前提下实现功能并验证。',
    content:
      '请实现本节点目标。\n\n约束：\n- 不要回退或覆盖用户无关修改。\n- 修改前先理解现有结构。\n- 完成后运行可用测试或构建。\n- 汇报修改内容、验证结果和剩余风险。\n',
    tags: ['codex', 'implementation', 'safe']
  })

  const firstNode = { ...nodeFromPrompt(promptA, 0), id: 'node_prompt_preflight_review' }
  const secondNode = { ...nodeFromPrompt(promptB, 1), id: 'node_prompt_safe_implementation' }
  const approval = {
    ...approvalNode(2),
    id: 'node_default_approval',
    title: '人工审查',
    summary: '人工检查执行结果，决定是否继续或停止。'
  }

  return {
    version: STORE_VERSION,
    prompts: [promptA, promptB],
    skillIndex: {},
    groups: defaultGroups([promptA, promptB]),
    mcpServers: [],
    workflows: [
      createWorkflow({
        id: 'workflow_default_codex_change',
        title: 'Codex 变更工作流',
        description: '先审查，再实现，最后由人工确认输出。',
        tags: ['codex', 'default'],
        nodes: [firstNode, secondNode, approval],
        edges: [
          { id: 'edge_default_1', source: 'node_prompt_preflight_review', target: 'node_prompt_safe_implementation' },
          { id: 'edge_default_2', source: 'node_prompt_safe_implementation', target: 'node_default_approval' }
        ]
      })
    ],
    runs: [],
    tagRecoveries: [],
    settings: {
      shortcut: DEFAULT_SHORTCUT,
      skillDirectories: [],
      dataDirectory: '',
      dataDirectories: {},
      backupDirectory: '',
      temporaryWordDirectory: '',
      temporaryWordRetentionHours: 24,
      gitBackupRemote: '',
      gitBackupBranch: 'main',
      gitBackupUserEmail: '2878705044@qq.com',
      discoverySources: []
    }
  }
}

export function normalizeStore(value: Partial<AppStore> | null | undefined): AppStore {
  const base = defaultStore()
  if (!value) return base
  const rawPrompts = Array.isArray(value.prompts) ? value.prompts : base.prompts
  const groups = normalizeGroups(value.groups, rawPrompts)
  const prompts = repairSplitGroupTags(
    rawPrompts.map((prompt) => ({
      ...prompt,
      preferredSkillIds: Array.isArray(prompt.preferredSkillIds) ? prompt.preferredSkillIds.map(String).filter(Boolean) : []
    })),
    groups.prompts
  )

  return {
    version: STORE_VERSION,
    prompts,
    skillIndex: value.skillIndex && typeof value.skillIndex === 'object' ? value.skillIndex : {},
    groups: normalizeGroups(value.groups, prompts),
    mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers : [],
    workflows: Array.isArray(value.workflows) ? value.workflows.map(normalizeWorkflow) : base.workflows,
    runs: Array.isArray(value.runs) ? value.runs : [],
    tagRecoveries: Array.isArray(value.tagRecoveries)
      ? value.tagRecoveries.filter((item): item is AppStore['tagRecoveries'][number] => Boolean(item && typeof item === 'object'))
      : [],
    settings: {
      shortcut: value.settings?.shortcut || DEFAULT_SHORTCUT,
      skillDirectories: Array.isArray(value.settings?.skillDirectories) ? value.settings.skillDirectories : [],
      dataDirectory: typeof value.settings?.dataDirectory === 'string' ? value.settings.dataDirectory : '',
      dataDirectories: normalizeDataDirectoryOverrides(value.settings?.dataDirectories),
      backupDirectory: typeof value.settings?.backupDirectory === 'string' ? value.settings.backupDirectory : '',
      temporaryWordDirectory:
        typeof value.settings?.temporaryWordDirectory === 'string' ? value.settings.temporaryWordDirectory : '',
      temporaryWordRetentionHours: normalizeTemporaryWordRetentionHours(
        value.settings?.temporaryWordRetentionHours
      ),
      gitBackupRemote: typeof value.settings?.gitBackupRemote === 'string' ? value.settings.gitBackupRemote : '',
      gitBackupBranch: typeof value.settings?.gitBackupBranch === 'string' ? value.settings.gitBackupBranch : 'main',
      gitBackupUserEmail:
        typeof value.settings?.gitBackupUserEmail === 'string' ? value.settings.gitBackupUserEmail : '2878705044@qq.com',
      discoverySources: normalizeDiscoverySources(value.settings?.discoverySources)
    }
  }
}

function normalizeDataDirectoryOverrides(value: unknown): DataDirectoryOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const result: DataDirectoryOverrides = {}
  for (const key of ['prompts', 'workflows', 'skillMetadata', 'managedSkills'] as const) {
    if (typeof record[key] === 'string' && record[key].trim()) result[key] = record[key].trim()
  }
  return result
}

function normalizeTemporaryWordRetentionHours(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 24
  return Math.min(720, Math.max(1, Math.round(value)))
}

function repairSplitGroupTags(prompts: PromptItem[], groups: GroupItem[]): PromptItem[] {
  const splittableGroups = flattenGroupItems(groups)
    .map((group) => ({
      tag: normalizeTag(group.tag),
      parts: normalizeTag(group.tag)
        .split(/\s+/)
        .map(normalizeTag)
        .filter(Boolean)
    }))
    .filter((group) => group.tag && group.parts.length > 1)

  if (splittableGroups.length === 0) return prompts

  return prompts.map((prompt) => {
    let tags = prompt.tags.map(normalizeTag).filter(Boolean)
    let changed = false

    for (const group of splittableGroups) {
      const tagSet = new Set(tags)
      if (tagSet.has(group.tag) || !group.parts.every((part) => tagSet.has(part))) continue
      tags = tags.filter((tag) => !group.parts.includes(tag))
      tags.push(group.tag)
      changed = true
    }

    return changed ? { ...prompt, tags: Array.from(new Set(tags)) } : prompt
  })
}

function flattenGroupItems(groups: GroupItem[]): GroupItem[] {
  return groups.flatMap((group) => [group, ...flattenGroupItems(group.children)])
}

export function nodeFromPrompt(prompt: PromptItem, index: number, skill?: SkillItem, mcp?: McpServer): WorkflowNode {
  return {
    id: `node_${prompt.id}_${Date.now()}_${index}`.replace(/[^a-zA-Z0-9_]/g, '_'),
    type: 'prompt',
    refId: prompt.id,
    skillRefId: skill?.id,
    mcpRefId: mcp?.id,
    title: prompt.title,
    summary: [prompt.summary, skill ? `调用 Skill：${skill.title || skill.name}` : '', mcp ? `使用 MCP：${mcp.name}` : '']
      .filter(Boolean)
      .join('；'),
    tags: prompt.tags,
    inputs: {},
    outputs: ['prompt_output'],
    requiresReview: true,
    position: { x: index * 280, y: 80 }
  }
}

export function nodeFromSkill(skill: SkillItem, index: number): WorkflowNode {
  return {
    id: `node_${hashText(skill.id)}_${Date.now()}_${index}`,
    type: 'skill',
    refId: skill.id,
    title: skill.title || skill.name,
    summary: skill.summary,
    tags: skill.tags,
    inputs: {},
    outputs: ['skill_output'],
    requiresReview: true,
    position: { x: index * 280, y: 80 }
  }
}

export function nodeFromMcp(mcp: McpServer, index: number): WorkflowNode {
  return {
    id: `node_${hashText(mcp.id)}_${Date.now()}_${index}`,
    type: 'mcp',
    refId: mcp.id,
    title: mcp.name,
    summary: `${mcp.transport.toUpperCase()} MCP${mcp.enabled ? '' : '（未启用）'}`,
    tags: mcp.tags,
    inputs: {},
    outputs: ['mcp_output'],
    requiresReview: true,
    position: { x: index * 280, y: 80 }
  }
}

export function approvalNode(index: number): WorkflowNode {
  return {
    id: newId('approval'),
    type: 'approval',
    title: '人工审查',
    summary: '检查上一步输出，确认后继续。',
    tags: ['approval'],
    inputs: {},
    outputs: ['review_decision'],
    requiresReview: true,
    position: { x: index * 280, y: 80 }
  }
}

export function rebuildLinearEdges(nodes: WorkflowNode[]): WorkflowEdge[] {
  return nodes.slice(0, -1).map((node, index) => ({
    id: `edge_${node.id}_${nodes[index + 1].id}`,
    source: node.id,
    target: nodes[index + 1].id
  }))
}

export function matchesTextAndTags(
  item: { title?: string; name?: string; summary?: string; content?: string; tags?: string[] },
  query: string,
  selectedTags: string[]
): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  const searchable = [item.title, item.name, item.summary, item.content, item.tags?.join(' ')]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  const textOk = !normalizedQuery || searchable.includes(normalizedQuery)
  const itemTags = new Set((item.tags || []).map(normalizeTag))
  const tagsOk = selectedTags.every((tag) => itemTags.has(normalizeTag(tag)))
  return textOk && tagsOk
}

export function allTags(items: Array<{ tags: string[] }>): string[] {
  return Array.from(new Set(items.flatMap((item) => item.tags.map(normalizeTag)).filter(Boolean))).sort()
}

export function skillIdFromPath(filePath: string): string {
  return `skill:${filePath.replace(/\\/g, '/')}`
}

const LEARNING_GENERATOR_TAG_LABELS: Record<string, string> = {
  'conversation-review': '对话审查',
  'engineering-cybernetics': '工程控制论学习用户习惯'
}
const LEARNING_GENERATOR_TAGS = new Set(Object.values(LEARNING_GENERATOR_TAG_LABELS).map(normalizeTag))
const TEMPLATE_MANAGED_SKILL_NAMES = new Set(['engineering-cybernetics-user-habit-learning'])

type SmartSkillGroupDefinition = {
  name: string
  tag: string
  children: Array<{ name: string; tag: string }>
}

const SMART_SKILL_GROUP_DEFINITIONS: SmartSkillGroupDefinition[] = [
  {
    name: '代码工程',
    tag: '代码工程',
    children: [
      { name: '代码实现', tag: '代码实现' },
      { name: '审查测试', tag: '审查测试' },
      { name: 'Skill 与插件', tag: 'skill 与插件' },
      { name: '文档处理', tag: '文档处理' }
    ]
  },
  {
    name: '科研实验',
    tag: '科研实验',
    children: [
      { name: '实验运行', tag: '实验运行' },
      { name: '结果分析', tag: '结果分析' }
    ]
  },
  {
    name: '科研写作',
    tag: '科研写作',
    children: [
      { name: '文献选题', tag: '文献选题' },
      { name: '公式证明', tag: '公式证明' },
      { name: '基金申请', tag: '基金申请' },
      { name: '论文写作', tag: '论文写作' },
      { name: '学术审查', tag: '学术审查' }
    ]
  },
  {
    name: '内容创作',
    tag: '内容创作',
    children: [
      { name: '图像设计', tag: '图像设计' },
      { name: '图表可视化', tag: '图表可视化' },
      { name: '演示发布', tag: '演示发布' },
      { name: '内容运营', tag: '内容运营' }
    ]
  },
  {
    name: '自动化集成',
    tag: '自动化集成',
    children: [
      { name: '工作流自动化', tag: '工作流自动化' },
      { name: '通知采集', tag: '通知采集' }
    ]
  },
  {
    name: '学习分析',
    tag: '学习分析',
    children: [
      { name: '对话审查', tag: '对话审查' },
      { name: '用户习惯学习', tag: '用户习惯学习' },
      { name: '思维方法', tag: '思维方法' }
    ]
  },
  {
    name: '行业专业',
    tag: '行业专业',
    children: [{ name: '财务合规', tag: '财务合规' }]
  },
  { name: '其他 Skill', tag: '其他 skill', children: [] }
]
const SMART_SKILL_CATEGORY_TAGS = new Set(
  SMART_SKILL_GROUP_DEFINITIONS.flatMap((group) => [group.tag, ...group.children.map((child) => child.tag)]).map(normalizeTag)
)

const SMART_SKILL_NAME_RULES: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: '结果分析', patterns: [/^(analyze-results|ablation-planner|result-to-claim)$/] },
  { tag: '基金申请', patterns: [/^grant-proposal$/] },
  { tag: '学术审查', patterns: [/^(auto-review-loop(?:-llm|-minimax)?|auto-paper-improvement-loop|research-review|rebuttal)$/] },
  { tag: '论文写作', patterns: [/^(paper-(?:plan|write|writing|compile)|research-writing-five-steps)$/] },
  { tag: '工作流自动化', patterns: [/^(research-pipeline|research-refine-pipeline)$/] },
  { tag: 'skill 与插件', patterns: [/nuwa-skill|skill造人术/] }
]

const SMART_SKILL_RULES: Array<{ tag: string; patterns: RegExp[] }> = [
  {
    tag: '财务合规',
    patterns: [/\b(fiscal|fiscaliste|tax|taxation|comptable|accounting)\b/, /audit l[eé]gal/, /luxembourg/, /税务|税收|会计|审计|财务合规/]
  },
  {
    tag: '用户习惯学习',
    patterns: [/engineering-cybernetics/, /user habit/, /用户习惯|工程控制论|控制论学习/]
  },
  {
    tag: '对话审查',
    patterns: [/conversation-review/, /review camp/, /conversation result/, /对话审查|对话复盘/]
  },
  {
    tag: '思维方法',
    patterns: [/-perspective\b/, /\bmentor\b/, /thinking framework/, /思维框架|思维操作系统|表达方式|行为逻辑/]
  },
  {
    tag: 'skill 与插件',
    patterns: [/^(plugin-creator|skill-creator|skill-installer)\b/, /resource-duplicate-merge/, /create (?:a |new )?(?:codex )?skill/, /install codex skills/, /plugin directories/]
  },
  {
    tag: '审查测试',
    patterns: [/^review-agent\b/, /michelle-diagnose/, /harden-ready/, /code review|code change/, /debug|diagnos|root-cause/, /代码审查|代码测试|故障诊断|安全审查/]
  },
  {
    tag: '文档处理',
    patterns: [/^openai-docs\b/, /^pdf\b/, /documentation/, /docs mcp/, /ocr|watermark|extracting text/, /文档处理|文档转换/]
  },
  {
    tag: '通知采集',
    patterns: [/feishu|lark/, /notify|notification/, /live-session-fetcher/, /browser session/, /serial pdf downloading/, /active alerts/, /通知|采集|下载/]
  },
  {
    tag: '文献选题',
    patterns: [/^(arxiv|research-lit|comm-lit-review|novelty-check|idea-creator|idea-discovery|idea-discovery-robot|research-refine)\b/, /literature review|related work|prior art/, /research ideas?/, /文献|选题|查新|研究方向/]
  },
  {
    tag: '公式证明',
    patterns: [/formula-derivation|proof-writer/, /mathematical proof|theorem|lemma|proposition/, /公式推导|数学证明|定理|引理/]
  },
  {
    tag: '基金申请',
    patterns: [/grant-proposal/, /grant proposal|funding application/, /基金申请|科研费|项目申请/]
  },
  {
    tag: '图表可视化',
    patterns: [/mermaid-diagram|paper-figure/, /diagram|flowchart|visualization/, /comparison tables?/, /图表|流程图|可视化/]
  },
  {
    tag: '图像设计',
    patterns: [/^imagegen\b|pixel-art|paper-illustration/, /image generation|raster image|illustration/, /图像生成|像素图|插图/]
  },
  {
    tag: '演示发布',
    patterns: [/paper-(poster|slides)/, /conference poster|presentation slides|beamer/, /海报|幻灯片|演示文稿/]
  },
  {
    tag: '结果分析',
    patterns: [/analyze-results|result-to-claim|ablation-planner/, /analy[sz]e .*results?|compute statistics|ablation stud/, /结果分析|消融实验|统计分析/]
  },
  {
    tag: '实验运行',
    patterns: [/experiment-(bridge|plan)|run-experiment|monitor-experiment|training-check|dse-loop/, /run .*experiments?|training is running|deploy .*gpu|design space exploration/, /运行实验|实验计划|训练监控|参数搜索/]
  },
  {
    tag: '学术审查',
    patterns: [/auto-review-loop|research-review|rebuttal|auto-paper-improvement/, /reviewer|submission rebuttal|review my research/, /论文审查|同行评审|审稿|答辩回复/]
  },
  {
    tag: '论文写作',
    patterns: [/paper-(plan|write|writing|compile)|research-writing-five-steps/, /latex paper|write paper|paper outline|manuscript/, /论文写作|论文大纲|编译论文/]
  },
  {
    tag: '内容运营',
    patterns: [/content creat|content operat|twitter|social media|内容创作|内容运营/]
  },
  {
    tag: '工作流自动化',
    patterns: [/research-pipeline|refine-pipeline|orchestrat|autonomous .*loop|workflow/, /工作流|自动化流程|编排/]
  },
  {
    tag: '代码实现',
    patterns: [/format-flow-development|context-engineering|repo[_ -]?map/, /software|electron|repository|implementation|coding|code map/, /软件开发|代码实现|代码仓库|上下文工程/]
  }
]

export function parseSkillMarkdown(content: string, filePath: string): SkillItem {
  const frontmatter = parseFrontmatter(content)
  const fallbackName = filePath.split(/[\\/]/).slice(-2, -1)[0] || 'skill'
  const name = frontmatter.name || fallbackName
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const summary = frontmatter.description || firstParagraph(content) || 'Codex Skill'
  const timestamp = nowIso()
  const generatedBy = frontmatter['generate by'] || frontmatter.generate_by || ''
  const generatedByTags = generatedBy
    .split(',')
    .map(normalizeTag)
    .filter(Boolean)
    .map((tag) => LEARNING_GENERATOR_TAG_LABELS[tag] || tag)
  const explicitCategoryTags = parseSkillFrontmatterTags(frontmatter, ['category', 'categories', 'group', 'groups'])
  const explicitTags = parseSkillFrontmatterTags(frontmatter, ['tags'])
    .filter((tag) => !['skill', 'skills', 'codex'].includes(tag))
  const smartTag = generatedByTags[0] || explicitCategoryTags[0] || inferSmartSkillTag(name, heading || name, summary)
  const tags = Array.from(new Set([...explicitCategoryTags, ...explicitTags, ...generatedByTags, smartTag].map(normalizeTag).filter(Boolean)))

  return {
    id: skillIdFromPath(filePath),
    name,
    title: heading || name,
    summary,
    tags,
    variables: extractPromptVariables(content),
    favorite: false,
    path: filePath,
    source: /[\\/]\.codex[\\/]skills[\\/]/.test(filePath) ? 'codex' : 'custom',
    contentPreview: content.slice(0, 12000),
    contentFingerprint: hashText(content.replace(/\r\n/g, '\n').trim()),
    updatedAt: timestamp
  }
}

export function analyzeSkillImport(existing: SkillItem[], imported: SkillItem[]): SkillImportAnalysis {
  const knownByName = new Map(existing.map((skill) => [normalizeTag(skill.name), skill]))
  const additions: SkillItem[] = []
  const identical: SkillImportAnalysis['identical'] = []
  const conflicts: SkillDuplicateConflict[] = []

  for (const skill of imported) {
    const duplicate = knownByName.get(normalizeTag(skill.name))
    if (!duplicate) {
      additions.push(skill)
      knownByName.set(normalizeTag(skill.name), skill)
      continue
    }
    const sameContent = duplicate.contentFingerprint && skill.contentFingerprint
      ? duplicate.contentFingerprint === skill.contentFingerprint
      : normalizeSkillBody(duplicate.contentPreview) === normalizeSkillBody(skill.contentPreview)
    if (sameContent) {
      identical.push({ existing: duplicate, imported: skill })
      continue
    }
    conflicts.push({ id: newId('skill-conflict'), existing: duplicate, imported: skill })
  }

  return { additions, identical, conflicts }
}

export function findSkillDuplicateGroups(skills: SkillItem[]): SkillDuplicateGroup[] {
  const grouped = new Map<string, SkillItem[]>()
  for (const skill of skills) {
    const key = normalizeTag(skill.name)
    grouped.set(key, [...(grouped.get(key) || []), skill])
  }

  return Array.from(grouped.values())
    .filter((items) => items.length > 1)
    .map((items, index) => ({
      id: `skill-duplicate-${index}`,
      items,
      identicalContent: new Set(items.map((skill) => skill.contentFingerprint || normalizeSkillBody(skill.contentPreview))).size === 1
    }))
}

function normalizeSkillBody(content: string): string {
  return content.replace(/\r\n/g, '\n').trim()
}

export function mergeSkillMetadata(
  skill: SkillItem,
  metadata?: Partial<SkillMetadata>,
  manualGroupTags: string[] = []
): SkillItem {
  const manualTags = new Set(manualGroupTags.map(normalizeTag).filter(Boolean))
  const assignedTags = new Set(metadata?.assignedTags?.map(normalizeTag).filter(Boolean) || [])
  const legacyInferredTags = new Set(inferLegacySkillTags(skill.name, skill.path))
  const metadataTags =
    metadata?.tags
      ?.map(normalizeTag)
      .filter(Boolean)
      .filter((tag) => manualTags.has(tag) || assignedTags.has(tag) || !legacyInferredTags.has(tag)) || []
  const reusableMetadataTags = metadataTags.filter((tag) => assignedTags.has(tag) || !SMART_SKILL_CATEGORY_TAGS.has(tag))
  const learningGeneratorTags = skill.tags.map(normalizeTag).filter((tag) => LEARNING_GENERATOR_TAGS.has(tag))
  const summaryOverride = TEMPLATE_MANAGED_SKILL_NAMES.has(skill.name) ? '' : metadata?.summaryOverride?.trim()
  return {
    ...skill,
    summary: summaryOverride || skill.summary,
    tags: assignedTags.size
      ? Array.from(new Set([...reusableMetadataTags, ...learningGeneratorTags]))
      : Array.from(new Set([...skill.tags, ...reusableMetadataTags])),
    variables: metadata?.variables?.length ? metadata.variables.map(String).filter(Boolean) : skill.variables,
    favorite: Boolean(metadata?.favorite)
  }
}

export function deduplicateSkillGroupTags(skills: SkillItem[], manualGroups: GroupItem[] = []): string[] {
  const manualTags = new Set(flattenGroupItems(manualGroups).map((group) => normalizeTag(group.tag)).filter(Boolean))
  const membersByTag = new Map<string, Set<string>>()

  for (const skill of skills) {
    for (const tag of new Set(skill.tags.map(normalizeTag).filter(Boolean))) {
      const members = membersByTag.get(tag) || new Set<string>()
      members.add(skill.id)
      membersByTag.set(tag, members)
    }
  }

  const membershipSignature = (members: Set<string>): string => JSON.stringify(Array.from(members).sort())
  const claimedSignatures = new Set(
    Array.from(manualTags)
      .map((tag) => membersByTag.get(tag))
      .filter((members): members is Set<string> => Boolean(members?.size))
      .map(membershipSignature)
  )
  const uniqueAutomaticTags: string[] = []

  const preferredAutomaticTags = Array.from(membersByTag.keys())
    .filter((tag) => !manualTags.has(tag))
    .sort((left, right) => skillGroupTagPriority(left) - skillGroupTagPriority(right) || left.localeCompare(right))

  for (const tag of preferredAutomaticTags) {
    const signature = membershipSignature(membersByTag.get(tag)!)
    if (claimedSignatures.has(signature)) continue
    claimedSignatures.add(signature)
    uniqueAutomaticTags.push(tag)
  }
  return uniqueAutomaticTags
}

export function buildSmartSkillGroups(skills: SkillItem[], manualGroups: GroupItem[] = []): GroupItem[] {
  const remainingTags = new Set(deduplicateSkillGroupTags(skills, manualGroups))
  const groups: GroupItem[] = []

  for (const definition of SMART_SKILL_GROUP_DEFINITIONS) {
    const normalizedRootTag = normalizeTag(definition.tag)
    if (definition.children.length === 0) {
      if (!remainingTags.delete(normalizedRootTag)) continue
      groups.push(smartSkillGroup(definition.name, normalizedRootTag))
      continue
    }

    const children = definition.children
      .map((child) => ({ ...child, tag: normalizeTag(child.tag) }))
      .filter((child) => remainingTags.delete(child.tag))
      .map((child) => smartSkillGroup(child.name, child.tag))
    if (children.length > 0) groups.push(smartSkillGroup(definition.name, normalizedRootTag, children))
  }

  for (const tag of Array.from(remainingTags).sort((left, right) => left.localeCompare(right))) {
    groups.push(smartSkillGroup(tag, tag))
  }

  return groups
}
export function createRunSteps(workflow: Workflow): RunStep[] {
  return workflow.nodes.map((node) => ({
    id: newId('step'),
    nodeId: node.id,
    title: node.title,
    summary: node.summary,
    type: node.type,
    status: 'pending',
    reviewedByHuman: false,
    inputSnapshot: '',
    output: ''
  }))
}

export function buildExecutionPrompt(
  node: WorkflowNode,
  prompts: PromptItem[],
  skills: SkillItem[],
  previousOutput: string,
  mcps: McpServer[] = []
): string {
  const prompt = node.type === 'prompt' && node.refId ? prompts.find((item) => item.id === node.refId) : undefined
  const directSkill = node.type === 'skill' && node.refId ? skills.find((item) => item.id === node.refId) : undefined
  const calledSkill = node.skillRefId ? skills.find((item) => item.id === node.skillRefId) : undefined
  const skill = calledSkill || directSkill
  const mcpRefId = node.type === 'mcp' ? node.refId : node.mcpRefId
  const mcp = mcpRefId ? mcps.find((item) => item.id === mcpRefId) : undefined

  if (node.type === 'approval') {
    return [
      `工作流节点：${node.title}`,
      '',
      '请人工审查上一节点输出，确认是否继续。',
      '',
      '上一节点输出：',
      previousOutput || '(无)'
    ].join('\n')
  }

  if (node.type === 'skill') {
    return [
      `工作流节点：${node.title}`,
      '节点类型：Skill',
      `摘要：${node.summary}`,
      `标签：${node.tags.join(', ') || '(无)'}`,
      '',
      '任务目标：',
      node.inputs.goal || `按此 Skill 的说明完成当前步骤：${skill?.title || node.title}`,
      '',
      skill
        ? [
            'Skill 信息：',
            `- 名称：${skill.name}`,
            `- 路径：${skill.path}`,
            `- 摘要：${skill.summary}`,
            '',
            'Skill 内容预览：',
            skill.contentPreview || '(无)'
          ].join('\n')
        : 'Skill 信息：未找到引用的 Skill',
      '',
      '上一步输出：',
      previousOutput || '(无)',
      '',
      '输出要求：',
      '- 给出可审查的结果。',
      '- 如果需要修改文件，说明修改范围和验证方式。',
      '- 如果发现风险或信息不足，先说明风险并停止在该节点。',
      '',
      '约束：',
      '- 不要修改无关文件。',
      '- 不要覆盖用户未要求修改的内容。',
      '- 每一步完成后等待人工审查。'
    ].join('\n')
  }

  if (node.type === 'mcp') {
    return [
      `工作流节点：${node.title}`,
      '节点类型：MCP',
      `摘要：${node.summary}`,
      `标签：${node.tags.join(', ') || '(无)'}`,
      '',
      '任务目标：',
      node.inputs.goal || `使用此 MCP 服务完成当前步骤：${mcp?.name || node.title}`,
      '',
      mcp
        ? [
            'MCP 信息：',
            `- 名称：${mcp.name}`,
            `- 启用：${mcp.enabled ? '是' : '否'}`,
            `- Transport：${mcp.transport}`,
            `- Command：${[mcp.command, ...mcp.args].filter(Boolean).join(' ') || '(无)'}`,
            `- CWD：${mcp.cwd || '(无)'}`,
            `- URL：${mcp.url || '(无)'}`,
            `- Env：${Object.keys(mcp.env).length ? Object.keys(mcp.env).join(', ') : '(无)'}`
          ].join('\n')
        : 'MCP 信息：未找到引用的 MCP 服务',
      '',
      '上一步输出：',
      previousOutput || '(无)',
      '',
      '输出要求：',
      '- 给出可审查的结果。',
      '- 如果需要调用工具，说明调用意图和结果。',
      '- 如果发现风险或信息不足，先说明风险并停止在该节点。',
      '',
      '约束：',
      '- 不要修改无关文件。',
      '- 不要覆盖用户未要求修改的内容。',
      '- 每一步完成后等待人工审查。'
    ].join('\n')
  }

  return [
    `工作流节点：${node.title}`,
    `节点类型：${node.type}`,
    `摘要：${node.summary}`,
    `标签：${node.tags.join(', ') || '(无)'}`,
    '',
    '任务目标：',
    prompt?.content || node.inputs.goal || '按节点摘要完成任务。',
    '',
    skill
      ? ['调用的 Skill：', `- 名称：${skill.name}`, `- 路径：${skill.path}`, `- 摘要：${skill.summary}`].join('\n')
      : '调用的 Skill：(无)',
    '',
    mcp
      ? [
          '使用的 MCP：',
          `- 名称：${mcp.name}`,
          `- Transport：${mcp.transport}`,
          `- Command：${[mcp.command, ...mcp.args].filter(Boolean).join(' ') || '(无)'}`,
          `- URL：${mcp.url || '(无)'}`
        ].join('\n')
      : '使用的 MCP：(无)',
    '',
    '上一步输出：',
    previousOutput || '(无)',
    '',
    '输出要求：',
    '- 给出可审查的结果。',
    '- 如果需要修改文件，说明修改范围和验证方式。',
    '- 如果发现风险或信息不足，先说明风险并停止在该节点。',
    '',
    '约束：',
    '- 不要修改无关文件。',
    '- 不要覆盖用户未要求修改的内容。',
    '- 每一步完成后等待人工审查。'
  ].join('\n')
}

function normalizeGroups(value: unknown, prompts: PromptItem[]): ResourceGroups {
  if (!isRecord(value)) return defaultGroups(prompts)
  return {
    prompts: normalizeGroupList(value.prompts, allTags(prompts)),
    skills: normalizeGroupList(value.skills, []),
    workflows: normalizeGroupList(value.workflows, []),
    mcps: normalizeGroupList(value.mcps, []),
    quickCalls: normalizeGroupList(value.quickCalls, allTags(prompts)),
    learning: normalizeGroupList(value.learning, ['hermes', '对话审查', '工程控制论学习用户习惯'])
  }
}

function normalizeGroupList(value: unknown, fallbackTags: string[]): GroupItem[] {
  if (!Array.isArray(value)) return groupsFromTags(fallbackTags)
  return value.filter(isRecord).map((item) => ({
    id: stringOr(item.id, newId('group')),
    name: stringOr(item.name, stringOr(item.tag, 'group')),
    tag: normalizeTag(stringOr(item.tag, stringOr(item.name, 'group'))),
    children: normalizeGroupList(item.children, [])
  }))
}

function normalizeWorkflow(workflow: Workflow): Workflow {
  return {
    ...workflow,
    title: workflow.title?.replaceAll('流程图', '工作流').replaceAll('流程', '工作流') || '工作流',
    description: workflow.description?.replaceAll('流程图', '工作流').replaceAll('流程', '工作流') || '',
    tags: Array.isArray(workflow.tags) ? workflow.tags.map(normalizeTag).filter(Boolean) : [],
    variables: Array.isArray(workflow.variables) ? workflow.variables.map(String).filter(Boolean) : [],
    favorite: Boolean(workflow.favorite),
    nodes: Array.isArray(workflow.nodes) ? workflow.nodes : [],
    edges: Array.isArray(workflow.edges) ? workflow.edges : []
  }
}

function parseMcpJson(parsed: unknown): McpServer[] {
  if (!isRecord(parsed)) return []

  if (Array.isArray(parsed.mcpServers)) {
    return parsed.mcpServers
      .filter(isRecord)
      .map((value) => mcpFromRecord(stringOr(value.name, 'imported-mcp'), value, 'imported'))
  }

  if (Array.isArray(parsed.mcp_servers)) {
    return parsed.mcp_servers
      .filter(isRecord)
      .map((value) => mcpFromRecord(stringOr(value.name, 'imported-mcp'), value, 'imported'))
  }

  const source = isRecord(parsed.mcpServers)
    ? parsed.mcpServers
    : isRecord(parsed.mcp_servers)
      ? parsed.mcp_servers
      : isRecord(parsed.servers)
        ? parsed.servers
        : undefined
  if (!source) return []

  return Object.entries(source)
    .filter(([, value]) => isRecord(value))
    .map(([name, value]) => mcpFromRecord(name, value as Record<string, unknown>, 'imported'))
}

function parseMcpToml(content: string, sourceName: string): McpServer[] {
  const servers: Record<string, Record<string, unknown>> = {}
  let activeName = ''

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const section = line.match(/^\[(?:mcpServers|mcp_servers)\.([^\]]+)\]$/)
    if (section) {
      activeName = section[1].replace(/^['"]|['"]$/g, '')
      servers[activeName] = servers[activeName] || {}
      continue
    }

    if (!activeName) continue
    const keyValue = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (keyValue) servers[activeName][keyValue[1]] = parseTomlValue(keyValue[2])
  }

  const parsed = Object.entries(servers).map(([name, value]) => mcpFromRecord(name, value, 'imported'))
  if (parsed.length > 0) return parsed

  return [createMcpServer({ name: sourceName.replace(/\.[^.]+$/, '') || 'imported-mcp', source: 'imported' })]
}

function mcpFromRecord(name: string, value: Record<string, unknown>, source: 'manual' | 'imported'): McpServer {
  const env = isRecord(value.env)
    ? Object.fromEntries(Object.entries(value.env).map(([key, envValue]) => [key, String(envValue)]))
    : {}
  const args = Array.isArray(value.args) ? value.args.map(String) : parseArgsText(stringOr(value.args, ''))
  const transportValue = stringOr(value.transport, value.url ? 'http' : 'stdio')
  const transport = transportValue === 'sse' || transportValue === 'http' ? transportValue : 'stdio'

  return createMcpServer({
    name,
    command: stringOr(value.command, ''),
    args,
    env,
    cwd: stringOr(value.cwd, ''),
    url: stringOr(value.url, ''),
    transport,
    enabled: value.enabled === undefined ? !Boolean(value.disabled) : Boolean(value.enabled),
    tags: ['imported'],
    source
  })
}

function parseTomlValue(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^["'].*["']$/.test(trimmed)) return trimmed.slice(1, -1)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const body = trimmed.slice(1, -1).trim()
    if (!body) return []
    return splitCsvLike(body).map((part) => String(parseTomlValue(part)))
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const result: Record<string, string> = {}
    for (const pair of splitCsvLike(trimmed.slice(1, -1))) {
      const match = pair.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
      if (match) result[match[1]] = String(parseTomlValue(match[2]))
    }
    return result
  }
  return trimmed
}

function splitCsvLike(value: string): string[] {
  const result: string[] = []
  let current = ''
  let quote = ''

  for (const char of value) {
    if ((char === '"' || char === "'") && !quote) {
      quote = char
      current += char
      continue
    }
    if (char === quote) {
      quote = ''
      current += char
      continue
    }
    if (char === ',' && !quote) {
      result.push(current.trim())
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) result.push(current.trim())
  return result
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) return {}
  const end = content.indexOf('\n---', 3)
  if (end === -1) return {}
  const block = content.slice(3, end).split(/\r?\n/)
  const result: Record<string, string> = {}

  for (const line of block) {
    const match = line.match(/^([A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)*):\s*(.*)$/)
    if (match) result[match[1].trim()] = match[2].replace(/^['"]|['"]$/g, '').trim()
  }

  return result
}

function firstParagraph(content: string): string {
  return (
    content
      .replace(/^---[\s\S]*?\n---/, '')
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith('#')) || ''
  )
}

function firstPlainParagraph(content: string): string {
  return (
    content
      .replace(/^---[\s\S]*?\n---/, '')
      .split(/\n\s*\n/)
      .map((part) => part.trim().replace(/^#+\s*/, ''))
      .find(Boolean) || ''
  )
}

function trimSummary(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > 180 ? `${singleLine.slice(0, 177)}...` : singleLine
}

function inferSmartSkillTag(name: string, title: string, summary: string): string {
  const normalizedName = name.toLowerCase()
  const matchedNameRule = SMART_SKILL_NAME_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(normalizedName)))
  if (matchedNameRule) return normalizeTag(matchedNameRule.tag)
  const profile = [name, title, summary].join('\n').toLowerCase()
  const matchedRule = SMART_SKILL_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(profile)))
  return normalizeTag(matchedRule?.tag || '其他 Skill')
}

function parseSkillFrontmatterTags(frontmatter: Record<string, string>, keys: string[]): string[] {
  return Array.from(
    new Set(
      keys
        .flatMap((key) => {
          const value = frontmatter[key]
          if (!value) return []
          return value
            .replace(/^\s*\[/, '')
            .replace(/\]\s*$/, '')
            .split(/[,，;；|]+/)
        })
        .map((tag) => normalizeTag(tag.replace(/^['"]|['"]$/g, '').trim()))
        .filter(Boolean)
    )
  )
}

function smartSkillGroup(name: string, tag: string, children: GroupItem[] = []): GroupItem {
  let hash = 2166136261
  for (const character of tag) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return {
    id: `smart_skill_group_${(hash >>> 0).toString(36)}`,
    name,
    tag,
    children
  }
}

function skillGroupTagPriority(tag: string): number {
  if (LEARNING_GENERATOR_TAGS.has(tag)) return 0
  return /[\u3400-\u9fff]/.test(tag) ? 1 : 2
}

function inferLegacySkillTags(name: string, filePath: string): string[] {
  const raw = `${name} ${filePath}`
  const tags = new Set<string>()
  for (const token of raw.split(/[^A-Za-z0-9\u4e00-\u9fa5]+/)) {
    const normalized = normalizeTag(token)
    if (normalized && normalized.length > 2 && normalized.length < 24) tags.add(normalized)
  }
  tags.add('skill')
  return Array.from(tags).slice(0, 8)
}

function extractPromptVariables(content: string): string[] {
  return Array.from(
    new Set([
      ...Array.from(content.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g)).map((match) => match[1]),
      ...Array.from(content.matchAll(/【\s*请填写\s*[:：]\s*([^】]+?)\s*】/g)).map((match) => match[1].replace(/\s+/g, ' ').trim())
    ].filter(Boolean))
  )
}

function parseArgsText(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function hashText(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
