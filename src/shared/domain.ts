import type {
  AppStore,
  GroupItem,
  McpServer,
  PromptItem,
  ResourceGroups,
  RunStep,
  SkillItem,
  Workflow,
  WorkflowEdge,
  WorkflowNode
} from './types'

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
    mcps: [],
    quickCalls: groupsFromTags(allTags(prompts)),
    learning: groupsFromTags(['hermes', '对话审查', '钱学森工程控制论'])
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

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.prompts)
        ? parsed.prompts
        : []

    if (candidates.length > 0) {
      return candidates.filter(isRecord).map((item) =>
        createPrompt({
          id: typeof item.id === 'string' ? item.id : newId('prompt'),
          title: stringOr(item.title, sourceName.replace(/\.[^.]+$/, '') || 'Imported Prompt'),
          summary: stringOr(item.summary, 'Imported prompt'),
          content: stringOr(item.content, ''),
          tags: Array.isArray(item.tags) ? item.tags.map(String).map(normalizeTag).filter(Boolean) : ['imported'],
          variables: Array.isArray(item.variables)
            ? item.variables.map(String)
            : extractPromptVariables(stringOr(item.content, '')),
          version: numberOr(item.version, 1),
          favorite: Boolean(item.favorite)
        })
      )
    }
  } catch {
    // Non-JSON prompt files are imported as a single prompt.
  }

  return [createPromptFromText(trimmed, sourceName)]
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
    settings: {
      shortcut: DEFAULT_SHORTCUT,
      skillDirectories: [],
      dataDirectory: '',
      backupDirectory: '',
      gitBackupRemote: '',
      gitBackupBranch: 'main',
      gitBackupUserEmail: '2878705044@qq.com'
    }
  }
}

export function normalizeStore(value: Partial<AppStore> | null | undefined): AppStore {
  const base = defaultStore()
  if (!value) return base
  const rawPrompts = Array.isArray(value.prompts) ? value.prompts : base.prompts
  const groups = normalizeGroups(value.groups, rawPrompts)
  const prompts = repairSplitGroupTags(rawPrompts, groups.prompts)

  return {
    version: STORE_VERSION,
    prompts,
    skillIndex: value.skillIndex && typeof value.skillIndex === 'object' ? value.skillIndex : {},
    groups: normalizeGroups(value.groups, prompts),
    mcpServers: Array.isArray(value.mcpServers) ? value.mcpServers : [],
    workflows: Array.isArray(value.workflows) ? value.workflows.map(normalizeWorkflow) : base.workflows,
    runs: Array.isArray(value.runs) ? value.runs : [],
    settings: {
      shortcut: value.settings?.shortcut || DEFAULT_SHORTCUT,
      skillDirectories: Array.isArray(value.settings?.skillDirectories) ? value.settings.skillDirectories : [],
      dataDirectory: typeof value.settings?.dataDirectory === 'string' ? value.settings.dataDirectory : '',
      backupDirectory: typeof value.settings?.backupDirectory === 'string' ? value.settings.backupDirectory : '',
      gitBackupRemote: typeof value.settings?.gitBackupRemote === 'string' ? value.settings.gitBackupRemote : '',
      gitBackupBranch: typeof value.settings?.gitBackupBranch === 'string' ? value.settings.gitBackupBranch : 'main',
      gitBackupUserEmail:
        typeof value.settings?.gitBackupUserEmail === 'string' ? value.settings.gitBackupUserEmail : '2878705044@qq.com'
    }
  }
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

export function parseSkillMarkdown(content: string, filePath: string): SkillItem {
  const frontmatter = parseFrontmatter(content)
  const fallbackName = filePath.split(/[\\/]/).slice(-2, -1)[0] || 'skill'
  const name = frontmatter.name || fallbackName
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const summary = frontmatter.description || firstParagraph(content) || 'Codex Skill'
  const timestamp = nowIso()

  return {
    id: skillIdFromPath(filePath),
    name,
    title: heading || name,
    summary,
    tags: inferSkillTags(name, filePath),
    path: filePath,
    source: /[\\/]\.codex[\\/]skills[\\/]/.test(filePath) ? 'codex' : 'custom',
    contentPreview: content.slice(0, 12000),
    updatedAt: timestamp
  }
}

export function mergeSkillMetadata(skill: SkillItem, metadata?: { tags?: string[]; summaryOverride?: string; favorite?: boolean }): SkillItem {
  return {
    ...skill,
    summary: metadata?.summaryOverride?.trim() || skill.summary,
    tags: metadata?.tags?.length ? metadata.tags.map(normalizeTag) : skill.tags
  }
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
  const prompt = node.refId ? prompts.find((item) => item.id === node.refId) : undefined
  const directSkill = node.refId ? skills.find((item) => item.id === node.refId) : undefined
  const calledSkill = node.skillRefId ? skills.find((item) => item.id === node.skillRefId) : undefined
  const skill = calledSkill || directSkill
  const mcp = node.mcpRefId ? mcps.find((item) => item.id === node.mcpRefId) : undefined

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
    mcps: normalizeGroupList(value.mcps, []),
    quickCalls: normalizeGroupList(value.quickCalls, allTags(prompts)),
    learning: normalizeGroupList(value.learning, ['hermes', '对话审查', '钱学森工程控制论'])
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
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (match) result[match[1]] = match[2].replace(/^['"]|['"]$/g, '').trim()
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

function inferSkillTags(name: string, filePath: string): string[] {
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
