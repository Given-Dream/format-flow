import type { ApplicabilityProfile, SkillItem, Workflow, WorkflowNode, WorkflowSkillPackageMetadata, WorkflowStage } from './types'

export type WorkflowBlueprint = {
  templateKey: string
  legacyTemplateKeys: string[]
  title: string
  family: Workflow['family']
  researchType: string
  /** `all-numbered` consumes every Skill in the selected package; `named` retains custom/legacy template compatibility. */
  skillSelection: 'all-numbered' | 'named'
  /** Stable SKILL.md frontmatter names used only by `named` templates. Final order always comes from directory prefixes. */
  skillNames: string[]
  orderStrategy: 'skill-directory-prefix'
  sourceHint: string
  stageTitles: string[]
  stageRules: {
    assignment: 'balanced' | 'counts' | 'breakpoints' | 'first-stage'
    /** Number of Skills assigned to each stage; the last stage receives any remainder. */
    skillCounts: number[]
    /** One-based Skill orders that close a stage. */
    breakAfterSkillOrders: number[]
  }
  nodeRules: {
    reviewMode: 'after-each-skill' | 'stage-end' | 'selected-skills' | 'none'
    reviewAfterSkillOrders: number[]
    reviewChecklistLabel: string
    waitAfterStage: boolean
  }
  checkpointRules: {
    mode: 'after-review' | 'after-each-skill' | 'stage-end' | 'workflow-end' | 'selected-skills' | 'none'
    afterSkillOrders: number[]
    titlePattern: string
    requiredArtifacts: 'trigger-output' | 'stage-outputs' | 'workflow-outputs' | 'none'
  }
}

export type WorkflowBlueprintResolution = {
  blueprint: WorkflowBlueprint
  resolved: Array<{ name: string; skill: SkillItem; order: number; directoryName: string }>
  missingNames: string[]
  duplicateNames: Array<{ name: string; paths: string[] }>
  unnumberedSkills: Array<{ name: string; path: string }>
  duplicateOrders: Array<{ order: number; skills: Array<{ name: string; path: string }> }>
  missingOrders: number[]
  emptySelection: boolean
  canGenerate: boolean
}

export type WorkflowBuildContext = {
  workflowTitle?: string
  sourcePackageName?: string
  sourcePackagePath?: string
}

export type WorkflowBlueprintCatalog = {
  kind: typeof WORKFLOW_BLUEPRINT_CATALOG_KIND
  schemaVersion: typeof WORKFLOW_BLUEPRINT_SCHEMA_VERSION
  name: string
  blueprints: WorkflowBlueprint[]
}

export function defaultBlueprintStageRules(): WorkflowBlueprint['stageRules'] {
  return {
    assignment: 'balanced',
    skillCounts: [],
    breakAfterSkillOrders: []
  }
}

export function defaultBlueprintNodeRules(): WorkflowBlueprint['nodeRules'] {
  return {
    reviewMode: 'after-each-skill',
    reviewAfterSkillOrders: [],
    reviewChecklistLabel: '已核对上一 Skill 的要求输出',
    waitAfterStage: false
  }
}

export function defaultBlueprintCheckpointRules(): WorkflowBlueprint['checkpointRules'] {
  return {
    mode: 'after-review',
    afterSkillOrders: [],
    titlePattern: '通过：{skill}',
    requiredArtifacts: 'trigger-output'
  }
}

const COMMON_RESEARCH_SKILLS = [
  'sci-research-paper-controller',
  'sci-research-project-initializer',
  'sci-discipline-study-type-router'
]

const EXPERIMENT_SKILLS = [
  'sci-experiment-03',
  'sci-experiment-literature-search-query',
  'sci-experiment-literature-export',
  'sci-experiment-literature-screening',
  'sci-experiment-evidence-extraction',
  'sci-experiment-gap-identifier',
  'sci-experiment-hypothesis-builder',
  'sci-experiment-innovation-feasibility',
  'sci-experiment-design-planner',
  'sci-experiment-ethics-compliance',
  'sci-experiment-raw-data-manager',
  'sci-experiment-statistical-analysis',
  'sci-experiment-figure-maker',
  'sci-experiment-image-figure-compliance',
  'sci-experiment-result-storyline',
  'sci-experiment-results-writer',
  'sci-experiment-discussion-writer',
  'sci-experiment-methods-writer',
  'sci-experiment-introduction-writer',
  'sci-experiment-22-title-abstract-keywords',
  'sci-experiment-23-fulltext-citation-check',
  'sci-experiment-24-target-journal-selector',
  'sci-experiment-25-target-journal-deep-learner',
  'sci-experiment-26-deep-polisher',
  'sci-experiment-27-submission-materials',
  'sci-experiment-28-reviewer-response'
]

const REVIEW_SKILLS = [
  'sci-review-expert',
  'sci-project-initializer',
  'sci-search-query-generator',
  'sci-literature-search-exporter',
  'sci-topic-gap-identifier',
  'sci-benchmark-review-library-deep-learning',
  'sci-literature-screening-organizer',
  'sci-pdf-literature-acquisition-organizer',
  'sci-literature-intensive-reader',
  'sci-review-framework-builder',
  'sci-review-figure-layout-citation-planner',
  'sci-review-chapter-one-writer',
  'sci-review-chapter-two-writer',
  'sci-review-subsequent-chapters-writer',
  'sci-target-journal-selector',
  'sci-target-journal-deep-learner',
  'sci-review-deep-polisher',
  'sci-figure-permission-requester',
  'cover-letter-writer',
  'sci-submission-guide',
  'reviewer-response-writer'
]

const PATENT_SKILLS = Array.from({ length: 12 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  const suffixes = [
    'controller',
    'initialization',
    'status',
    'topic',
    'search',
    'innovation',
    'abstract',
    'claims',
    'image',
    'drawing-validator',
    'specification',
    'word'
  ]
  return `patent-invention-standalone-${number}-${suffixes[index]}`
})

const researchDefinitions: WorkflowBlueprint[] = [
  {
    templateKey: 'source-research-experiment',
    legacyTemplateKeys: ['official-research-experiment'],
    title: '原创研究论文｜实验研究',
    family: 'research',
    researchType: '实验研究',
    skillSelection: 'named',
    skillNames: [...COMMON_RESEARCH_SKILLS, ...EXPERIMENT_SKILLS],
    orderStrategy: 'skill-directory-prefix',
    sourceHint: '原创研究型论文 Skill',
    stageTitles: ['项目与选题', '检索与证据', '设计与合规', '分析与成图', '写作与投稿'],
    stageRules: defaultBlueprintStageRules(),
    nodeRules: defaultBlueprintNodeRules(),
    checkpointRules: defaultBlueprintCheckpointRules()
  },
  researchDefinition('simulation', '数值模拟研究', 29),
  researchDefinition('bioinformatics', '生物信息学研究', 29),
  researchDefinition('clinical', '临床研究', 29),
  researchDefinition('management-empirical', '管理学实证研究', 28),
  researchDefinition('retrospective', '回顾性研究', 29)
]

const definitions: WorkflowBlueprint[] = [
  ...researchDefinitions,
  {
    templateKey: 'source-sci-review',
    legacyTemplateKeys: ['official-sci-review'],
    title: 'SCI 综述从 0 到 1 可投稿',
    family: 'review',
    researchType: 'SCI综述',
    skillSelection: 'named',
    skillNames: REVIEW_SKILLS,
    orderStrategy: 'skill-directory-prefix',
    sourceHint: 'SCI 综述 Skill',
    stageTitles: ['项目与检索', '文献库与证据', '综合与写稿', '期刊与投稿', '编辑决定与修回'],
    stageRules: defaultBlueprintStageRules(),
    nodeRules: defaultBlueprintNodeRules(),
    checkpointRules: defaultBlueprintCheckpointRules()
  },
  {
    templateKey: 'source-invention-patent-v2',
    legacyTemplateKeys: ['official-invention-patent-v2'],
    title: '发明专利 v2',
    family: 'patent',
    researchType: '发明专利',
    skillSelection: 'named',
    skillNames: PATENT_SKILLS,
    orderStrategy: 'skill-directory-prefix',
    sourceHint: '发明专利 Skill 第二版',
    stageTitles: ['项目初始化', '检索与创新', '文本与权利要求', '附图与定稿'],
    stageRules: defaultBlueprintStageRules(),
    nodeRules: defaultBlueprintNodeRules(),
    checkpointRules: defaultBlueprintCheckpointRules()
  }
]

export const WORKFLOW_BLUEPRINT_CATALOG_KIND = 'format-flow-workflow-blueprints'
export const WORKFLOW_BLUEPRINT_SCHEMA_VERSION = 4
export const WORKFLOW_IMPORT_BUNDLE_KIND = 'format-flow-workflow-template-bundle'
export const WORKFLOW_IMPORT_BUNDLE_SCHEMA_VERSION = 1
export const SOURCE_TEMPLATE_REVISION = 'source'
/** All SKILL.md files in the three source packages, including shared helpers not placed on a visible route. */
export const SOURCE_PACKAGE_SKILL_COUNT = 205
export const SOURCE_REFERENCED_SKILL_COUNT = new Set(definitions.flatMap((definition) => definition.skillNames)).size

const genericWorkflowBlueprint: WorkflowBlueprint = {
  templateKey: 'generic-numbered-skill-workflow',
  legacyTemplateKeys: [],
  title: '通用编号 Skill 工作流',
  family: 'custom',
  researchType: '',
  skillSelection: 'all-numbered',
  skillNames: [],
  orderStrategy: 'skill-directory-prefix',
  sourceHint: '用户指定 Skill 包',
  stageTitles: ['执行流程'],
  stageRules: defaultBlueprintStageRules(),
  nodeRules: defaultBlueprintNodeRules(),
  checkpointRules: defaultBlueprintCheckpointRules()
}

/** Retained for migration/tests of the eight source-package workflows; not shown as predefined intermediate templates. */
export const SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS: readonly WorkflowBlueprint[] = definitions
/** The built-in intermediate template is intentionally domain-neutral and contains no Skill names. */
export const PREDEFINED_WORKFLOW_BLUEPRINTS: readonly WorkflowBlueprint[] = [genericWorkflowBlueprint]

export function createWorkflowBlueprintCatalog(
  blueprints: readonly WorkflowBlueprint[],
  name = 'Format Flow 通用编号 Skill 中间模板'
): WorkflowBlueprintCatalog {
  return {
    kind: WORKFLOW_BLUEPRINT_CATALOG_KIND,
    schemaVersion: WORKFLOW_BLUEPRINT_SCHEMA_VERSION,
    name,
    blueprints: blueprints.map(cloneBlueprint)
  }
}

export function createPredefinedWorkflowBlueprintCatalog(): WorkflowBlueprintCatalog {
  return createWorkflowBlueprintCatalog(PREDEFINED_WORKFLOW_BLUEPRINTS)
}

export function parseWorkflowBlueprintCatalog(value: unknown): WorkflowBlueprint[] {
  if (!isRecord(value) || value.kind !== WORKFLOW_BLUEPRINT_CATALOG_KIND) {
    throw new Error('文件不是 Format Flow 中间模板。')
  }
  if (![1, 2, 3, WORKFLOW_BLUEPRINT_SCHEMA_VERSION].includes(Number(value.schemaVersion))) {
    throw new Error(`不支持的中间模板版本：${String(value.schemaVersion ?? '未知')}`)
  }
  if (!Array.isArray(value.blueprints) || value.blueprints.length === 0) {
    throw new Error('中间模板中没有工作流定义。')
  }
  const blueprints = value.blueprints.map(parseBlueprint)
  const seen = new Set<string>()
  for (const blueprint of blueprints) {
    const key = blueprint.templateKey.toLocaleLowerCase()
    if (seen.has(key)) throw new Error(`中间模板包含重复 templateKey：${blueprint.templateKey}`)
    seen.add(key)
  }
  return blueprints
}

export function resolveWorkflowBlueprint(
  blueprint: WorkflowBlueprint,
  skills: SkillItem[]
): WorkflowBlueprintResolution {
  const byName = new Map<string, SkillItem[]>()
  for (const skill of skills) {
    const key = normalizeSkillName(skill.name)
    if (!key) continue
    const matches = byName.get(key) || []
    matches.push(skill)
    byName.set(key, matches)
  }
  const resolved: WorkflowBlueprintResolution['resolved'] = []
  const missingNames: string[] = []
  const duplicateNames: WorkflowBlueprintResolution['duplicateNames'] = []
  const unnumberedSkills: WorkflowBlueprintResolution['unnumberedSkills'] = []
  const selectedNames = blueprint.skillSelection === 'all-numbered'
    ? Array.from(byName.values()).map((matches) => matches[0].name)
    : blueprint.skillNames
  for (const name of selectedNames) {
    const matches = byName.get(normalizeSkillName(name)) || []
    if (matches.length === 0) missingNames.push(name)
    else if (matches.length > 1) duplicateNames.push({ name, paths: matches.map((skill) => skill.path) })
    else {
      const sequence = skillDirectorySequence(matches[0].path)
      if (!sequence) unnumberedSkills.push({ name, path: matches[0].path })
      else resolved.push({ name, skill: matches[0], ...sequence })
    }
  }
  const byOrder = new Map<number, WorkflowBlueprintResolution['resolved']>()
  for (const item of resolved) {
    const matches = byOrder.get(item.order) || []
    matches.push(item)
    byOrder.set(item.order, matches)
  }
  const duplicateOrders = Array.from(byOrder)
    .filter(([, matches]) => matches.length > 1)
    .map(([order, matches]) => ({
      order,
      skills: matches.map((item) => ({ name: item.name, path: item.skill.path }))
    }))
    .sort((left, right) => left.order - right.order)
  const ordered = [...resolved].sort(compareResolvedSkills)
  const missingOrders = missingSequenceNumbers(ordered.map((item) => item.order))
  const emptySelection = selectedNames.length === 0
  return {
    blueprint,
    resolved: ordered,
    missingNames,
    duplicateNames,
    unnumberedSkills,
    duplicateOrders,
    missingOrders,
    emptySelection,
    canGenerate:
      !emptySelection &&
      missingNames.length === 0 &&
      duplicateNames.length === 0 &&
      unnumberedSkills.length === 0 &&
      duplicateOrders.length === 0 &&
      missingOrders.length === 0
  }
}

export function skillsFromWorkflowPackageMetadata(metadata: WorkflowSkillPackageMetadata): SkillItem[] {
  return metadata.entries.map((entry) => ({
    id: `skill:${entry.installedPath || entry.sourcePath}`,
    name: entry.frontmatterName,
    title: entry.title,
    summary: '',
    tags: [],
    variables: [],
    favorite: false,
    path: `${entry.installedPath || entry.sourcePath}\\${entry.skillFileRelativePath}`,
    source: 'codex',
    contentPreview: '',
    contentFingerprint: entry.fingerprint,
    updatedAt: metadata.createdAt
  }))
}

export function workflowSkillDirectorySequence(skill: Pick<SkillItem, 'path'>): { order: number; directoryName: string } | null {
  return skillDirectorySequence(skill.path)
}

/** Preselect only unambiguous sequence numbers; branching packages stay available for manual choice. */
export function defaultWorkflowSkillSelection(skills: SkillItem[]): string[] {
  const byOrder = new Map<number, SkillItem[]>()
  for (const skill of skills) {
    const sequence = workflowSkillDirectorySequence(skill)
    if (!sequence) continue
    byOrder.set(sequence.order, [...(byOrder.get(sequence.order) || []), skill])
  }
  return Array.from(byOrder.values()).filter((matches) => matches.length === 1).map((matches) => matches[0].id)
}

export type WorkflowImportBundle = {
  kind: typeof WORKFLOW_IMPORT_BUNDLE_KIND
  schemaVersion: typeof WORKFLOW_IMPORT_BUNDLE_SCHEMA_VERSION
  name: string
  generatedAt: string
  sourcePackages: Array<{ name: string; path: string }>
  workflows: Workflow[]
}

export function buildSourcePackageWorkflowTemplates(
  skills: SkillItem[] = [],
  importedAt = new Date().toISOString()
): Workflow[] {
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  return definitions.map((blueprint) => buildWorkflow(blueprint, byName, importedAt))
}

export function buildWorkflowFromBlueprint(
  blueprint: WorkflowBlueprint,
  skills: SkillItem[],
  createdAt = new Date().toISOString(),
  context: WorkflowBuildContext = {}
): Workflow {
  const resolution = resolveWorkflowBlueprint(blueprint, skills)
  if (!resolution.canGenerate) {
    const parts = [
      resolution.emptySelection ? '没有可用 Skill' : '',
      resolution.missingNames.length > 0 ? `缺少 ${resolution.missingNames.length} 个 Skill` : '',
      resolution.duplicateNames.length > 0 ? `存在 ${resolution.duplicateNames.length} 个重名 Skill` : '',
      resolution.unnumberedSkills.length > 0 ? `存在 ${resolution.unnumberedSkills.length} 个无编号目录` : '',
      resolution.duplicateOrders.length > 0 ? `存在 ${resolution.duplicateOrders.length} 个重复编号` : '',
      resolution.missingOrders.length > 0 ? `缺少目录编号 ${formatSequenceList(resolution.missingOrders)}` : ''
    ].filter(Boolean)
    throw new Error(`${blueprint.title}：${parts.join('，')}。请先整理 Skill 后重试。`)
  }
  const ruleError = validateBlueprintRules(blueprint, resolution.resolved.length)
  if (ruleError) throw new Error(`${blueprint.title}：${ruleError}`)
  const orderedBlueprint: WorkflowBlueprint = {
    ...blueprint,
    skillNames: resolution.resolved.map((item) => item.name)
  }
  return buildWorkflow(
    orderedBlueprint,
    new Map(resolution.resolved.map((item) => [item.name, item.skill])),
    createdAt,
    context
  )
}

export function validateBlueprintRules(blueprint: WorkflowBlueprint, skillCount: number): string {
  const stageCount = blueprint.stageTitles.length
  if (blueprint.stageRules.assignment === 'counts') {
    const required = Math.max(0, stageCount - 1)
    if (blueprint.stageRules.skillCounts.length !== required) return `按数量分配只需填写前 ${required} 个阶段的 Skill 数量，末阶段自动接收剩余项。`
    const allocated = blueprint.stageRules.skillCounts.slice(0, required).reduce((sum, value) => sum + value, 0)
    if (skillCount > 0 && allocated >= skillCount) return '前置阶段已用完全部 Skill，末阶段将为空。'
  }
  if (blueprint.stageRules.assignment === 'breakpoints') {
    const required = Math.max(0, stageCount - 1)
    const boundaries = blueprint.stageRules.breakAfterSkillOrders
    if (boundaries.length !== required) return `按断点分段需要填写前 ${required} 个阶段的结束 Skill 序号。`
    if (boundaries.some((value) => value >= skillCount)) return `阶段断点必须小于 Skill 总数 ${skillCount}。`
  }
  if (blueprint.nodeRules.reviewMode === 'selected-skills' && blueprint.nodeRules.reviewAfterSkillOrders.length === 0) {
    return '指定 Skill 后审查时必须填写至少一个 Skill 序号。'
  }
  if (blueprint.checkpointRules.mode === 'selected-skills' && blueprint.checkpointRules.afterSkillOrders.length === 0) {
    return '指定 Skill 后检查点时必须填写至少一个 Skill 序号。'
  }
  const invalidOrder = [...blueprint.nodeRules.reviewAfterSkillOrders, ...blueprint.checkpointRules.afterSkillOrders]
    .find((order) => order > skillCount)
  if (invalidOrder) return `Skill 序号 ${invalidOrder} 超出本次 ${skillCount} 个 Skill。`
  return ''
}

export function createSourcePackageWorkflowImportBundle(
  skills: SkillItem[] = [],
  generatedAt = new Date().toISOString()
): WorkflowImportBundle {
  const workflows = buildSourcePackageWorkflowTemplates(skills, generatedAt)
  return {
    kind: WORKFLOW_IMPORT_BUNDLE_KIND,
    schemaVersion: WORKFLOW_IMPORT_BUNDLE_SCHEMA_VERSION,
    name: '研究、综述与发明专利 v2 工作流',
    generatedAt,
    sourcePackages: [],
    workflows
  }
}

export function parseWorkflowImportDocument(value: unknown): Workflow[] {
  if (!isRecord(value)) throw new Error('模板文件必须是工作流对象或 Format Flow 工作流模板包。')
  if (value.kind === WORKFLOW_IMPORT_BUNDLE_KIND) {
    if (value.schemaVersion !== WORKFLOW_IMPORT_BUNDLE_SCHEMA_VERSION) {
      throw new Error(`不支持的工作流模板包版本：${String(value.schemaVersion ?? '未知')}`)
    }
    if (!Array.isArray(value.workflows) || value.workflows.length === 0) {
      throw new Error('工作流模板包中没有可导入的工作流。')
    }
    return value.workflows as Workflow[]
  }
  return [value as Workflow]
}

export function hydrateImportedWorkflowResources(workflows: Workflow[], skills: SkillItem[]): Workflow[] {
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  return workflows.map((workflow) => {
    if (!isSourcePackageWorkflow(workflow)) return workflow
    // A generated workflow is an immutable binding. Reorganized Skill directories
    // are resolved only when a new workflow is generated from a blueprint. This
    // compatibility hydrator is intentionally limited to legacy unbound nodes.
    const hasUnboundSkill = workflow.nodes.some(
      (node) => node.type === 'skill' && node.resourceRef?.fingerprint === 'unbound'
    )
    if (!hasUnboundSkill) return workflow
    let changed = false
    const templateId = sourceWorkflowTemplateId(workflow)
    const definition = definitions.find((item) => item.templateKey === templateId)
    const inferredSourcePath = definition ? sourcePackageLocator(definition, byName) : undefined
    const sourcePath = definition && inferredSourcePath !== definition.sourceHint
      ? inferredSourcePath
      : workflow.sourcePackage?.path
    const sourcePackage = workflow.sourcePackage && sourcePath && sourcePath !== workflow.sourcePackage.path
      ? { ...workflow.sourcePackage, path: sourcePath }
      : workflow.sourcePackage
    if (sourcePackage !== workflow.sourcePackage) changed = true
    const nodes = workflow.nodes.map((node) => {
      if (node.type !== 'skill' || !node.resourceRef || node.resourceRef.fingerprint !== 'unbound') return node
      const name = node.resourceRef.resourceKey.replace(/^skill:/, '')
      const skill = byName.get(name)
      if (!skill?.contentFingerprint) return node
      changed = true
      return {
        ...node,
        refId: skill.id,
        title: skill.title || skill.name,
        summary: skill.summary,
        resourceRef: {
          ...node.resourceRef,
          expectedVersion: 'sha256',
          fingerprint: skill.contentFingerprint,
          locator: skill.path
        }
      }
    })
    if (!changed) return workflow
    return {
      ...workflow,
      nodes,
      sourcePackage,
      applicability: {
        ...workflow.applicability,
        requiredSkillKeys: nodes
          .filter((node) => node.type === 'skill' && node.resourceRef)
          .map((node) => node.resourceRef!.resourceKey)
      },
      updatedAt: new Date().toISOString()
    }
  })
}

export function importedWorkflowResourceStats(workflows: Workflow[]): { bound: number; total: number } {
  const skillNodes = workflows
    .filter(isSourcePackageWorkflow)
    .flatMap((workflow) => workflow.nodes)
    .filter((node) => node.type === 'skill')
  return {
    bound: skillNodes.filter((node) => node.resourceRef?.fingerprint && node.resourceRef.fingerprint !== 'unbound').length,
    total: skillNodes.length
  }
}

export function sourceWorkflowTemplateId(workflow: Pick<Workflow, 'templateKey' | 'sourcePackage'>): string | null {
  const declared = workflow.sourcePackage?.templateId
  if (declared) return declared
  const definition = definitions.find(
    (item) => item.templateKey === workflow.templateKey || item.legacyTemplateKeys.includes(workflow.templateKey)
  )
  return definition?.templateKey || null
}

export function isSourcePackageWorkflow(workflow: Pick<Workflow, 'templateKey' | 'sourcePackage'>): boolean {
  return sourceWorkflowTemplateId(workflow) !== null
}

export function selectNewWorkflowImports(
  existing: Array<Pick<Workflow, 'templateKey' | 'sourcePackage'>>,
  candidates: Workflow[]
): { imports: Workflow[]; skipped: Workflow[] } {
  const knownSourceIds = new Set(
    existing.map(sourceWorkflowTemplateId).filter((value): value is string => Boolean(value))
  )
  const imports: Workflow[] = []
  const skipped: Workflow[] = []
  for (const candidate of candidates) {
    const sourceId = sourceWorkflowTemplateId(candidate)
    if (sourceId && knownSourceIds.has(sourceId)) {
      skipped.push(candidate)
      continue
    }
    if (sourceId) knownSourceIds.add(sourceId)
    imports.push(candidate)
  }
  return { imports, skipped }
}

export function normalizeImportedSourceWorkflow(workflow: Workflow): Workflow {
  const templateId = sourceWorkflowTemplateId(workflow)
  if (!templateId) return workflow
  const definition = definitions.find((item) => item.templateKey === templateId)
  const sourceName = workflow.sourcePackage?.name || definition?.sourceHint || '工作流模板'
  const description = (workflow.description || `${workflow.title}。每个真实 Skill 后均配置独立 Review。`)
    .replace(/^内置工作流：/, '')
    .replace(/^导入工作流：/, '')
    .replace(/^正式模板：/, '')
  const tags = Array.from(new Set([
    ...(workflow.tags || []).filter((tag) => tag !== 'official'),
    workflow.family
  ].filter((tag) => tag !== 'imported')))
  return {
    ...workflow,
    description,
    tags,
    sourcePackage: {
      name: sourceName,
      path: workflow.sourcePackage?.path || sourceName,
      excluded: workflow.sourcePackage?.excluded,
      origin: 'imported',
      templateId,
      importedAt: workflow.sourcePackage?.importedAt || workflow.createdAt
    },
    applicability: {
      ...workflow.applicability,
      maintainer: workflow.applicability.maintainer === 'Format Flow'
        ? sourceName.replace(/\.zip$/i, '')
        : workflow.applicability.maintainer
    },
    changeLog: workflow.changeLog.map((entry) => ({
      ...entry,
      summary: entry.summary
        .replaceAll('内置工作流', '工作流')
        .replaceAll('导入工作流', '工作流')
        .replaceAll('内置模板', '工作流模板')
        .replaceAll('导入模板', '工作流模板')
    })),
    nodes: workflow.nodes.map((node) => ({
      ...node,
      tags: (node.tags || []).filter((tag) => tag !== 'official' && tag !== 'imported')
    }))
  }
}

function researchDefinition(prefix: string, researchType: string, last: number): WorkflowBlueprint {
  return {
    templateKey: `source-research-${prefix}`,
    legacyTemplateKeys: [`official-research-${prefix}`],
    title: `原创研究论文｜${researchType}`,
    family: 'research',
    researchType,
    skillSelection: 'named',
    skillNames: [
      ...COMMON_RESEARCH_SKILLS,
      ...Array.from({ length: last - 2 }, (_, index) => `sci-${prefix}-${String(index + 3).padStart(2, '0')}`)
    ],
    orderStrategy: 'skill-directory-prefix',
    sourceHint: '原创研究型论文 Skill',
    stageTitles: ['项目与选题', '检索与证据', '设计与合规', '分析与成图', '写作与投稿'],
    stageRules: defaultBlueprintStageRules(),
    nodeRules: defaultBlueprintNodeRules(),
    checkpointRules: defaultBlueprintCheckpointRules()
  }
}

function buildWorkflow(
  definition: WorkflowBlueprint,
  skills: Map<string, SkillItem>,
  timestamp: string,
  context: WorkflowBuildContext = {}
): Workflow {
  const workflowTitle = context.workflowTitle?.trim() || definition.title
  const stages = definition.stageTitles.map<WorkflowStage>((title, index) => ({
    stageKey: `stage-${index + 1}`,
    title,
    description: `${title}阶段`,
    order: index + 1
  }))
  const skillStageIndexes = definition.skillNames.map((_name, index) => blueprintStageIndex(definition, index, definition.skillNames.length, stages.length))
  const nodes: WorkflowNode[] = []
  for (let index = 0; index < definition.skillNames.length; index += 1) {
    const step = index + 1
    const stepKey = `s${String(step).padStart(2, '0')}`
    const skillName = definition.skillNames[index]
    const skill = skills.get(skillName)
    const stage = stages[skillStageIndexes[index]] || stages[0]
    const skillNode: WorkflowNode = {
      id: `${definition.templateKey}-${stepKey}-skill`,
      nodeKey: `${stepKey}-skill`,
      type: 'skill',
      refId: skill?.id,
      title: skill?.title || skillName,
      summary: skill?.summary || `调用 $${skillName}，原 SKILL.md 保持独立。`,
      tags: [definition.family],
      inputs: {},
      outputs: [`${stepKey}-delivery`],
      requiresReview: false,
      stageKey: stage.stageKey,
      order: nodes.length + 1,
      resourceRef: {
        resourceKey: `skill:${skillName}`,
        type: 'skill',
        expectedVersion: skill?.contentFingerprint ? 'sha256' : 'unbound',
        fingerprint: skill?.contentFingerprint || 'unbound',
        locator: skill?.path || skillName
      },
      applicabilityRules: patentNodeRules(definition, step),
      executionPolicy:
        definition.family === 'review' && step === 8 ? { kind: 'batch', batchField: 'literatureBatchSize' } : { kind: 'single' },
      position: { x: (nodes.length % 10) * 260, y: Math.floor(nodes.length / 10) * 170 }
    }
    nodes.push(skillNode)
    if (!shouldReviewSkill(definition, index, skillStageIndexes)) {
      appendStageWaitNode(definition, nodes, stages, index, skillStageIndexes)
      continue
    }
    nodes.push({
      id: `${definition.templateKey}-${stepKey}-review`,
      nodeKey: `${stepKey}-review`,
      type: 'review',
      title: `审查 ${skill?.title || skillName}`,
      summary: '审查不通过时记录原因并留在本节点；通过后写入检查点。',
      tags: ['review'],
      inputs: {},
      outputs: [`${stepKey}-review-decision`],
      requiresReview: true,
      stageKey: stage.stageKey,
      order: nodes.length + 1,
      applicabilityRules: patentNodeRules(definition, step),
      reviewChecklist: [
        { key: 'output-outline-confirmed', label: definition.nodeRules.reviewChecklistLabel, required: true }
      ],
      position: { x: (nodes.length % 10) * 260, y: Math.floor(nodes.length / 10) * 170 }
    })
    appendStageWaitNode(definition, nodes, stages, index, skillStageIndexes)
  }

  if (definition.family === 'review') addReviewControlNodes(definition, nodes, stages)
  nodes.forEach((node, index) => {
    node.order = index + 1
    node.position = { x: (index % 10) * 260, y: Math.floor(index / 10) * 170 }
  })
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `${definition.templateKey}-edge-${index + 1}`,
    source: node.nodeKey,
    target: nodes[index + 1].nodeKey
  }))
  if (definition.family === 'patent') configurePatentRouting(edges, nodes)
  const checkpointBlueprint = buildBlueprintCheckpoints(definition, nodes, stages)

  return {
    id: `${definition.templateKey}@${SOURCE_TEMPLATE_REVISION}`,
    templateKey: definition.templateKey,
    templateVersion: SOURCE_TEMPLATE_REVISION,
    status: 'published',
    family: definition.family,
    title: workflowTitle,
    description: `${workflowTitle}工作流。按 Skill 目录编号执行，${blueprintReviewSummary(definition.nodeRules.reviewMode)}。`,
    tags: [definition.family],
    variables: [],
    favorite: true,
    formSchema: commonFormSchema(definition),
    stages,
    checkpointBlueprint,
    applicability: applicabilityProfile(definition),
    applicabilityTests: [
      {
        id: `${definition.templateKey}-happy-path`,
        title: '标准适用项目',
        projectFields: {
          researchType: definition.researchType,
          hasRequiredInputs: true,
          hasHumanAuthorization: true,
          operatingSystem: 'Windows',
          aiPlatform: 'Codex',
          deliveryMode: 'copy-all',
          startStep: '04'
        },
        expectedStatus: 'highly-applicable'
      }
    ],
    changeLog: [{ version: SOURCE_TEMPLATE_REVISION, publishedAt: timestamp, summary: '根据中间模板和当前 Skill 目录生成。' }],
    sourcePackage: {
      name: context.sourcePackageName?.trim() || definition.sourceHint,
      path: context.sourcePackagePath?.trim() || sourcePackageLocator(definition, skills),
      origin: 'imported',
      templateId: definition.templateKey,
      importedAt: timestamp
    },
    nodes,
    edges,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function commonFormSchema(_definition: WorkflowBlueprint): Workflow['formSchema'] {
  return [
    { key: 'topic', label: '主题', type: 'textarea', required: true },
    {
      key: 'deliveryMode',
      label: '交付方式',
      type: 'select',
      required: true,
      defaultValue: 'copy-all',
      options: [
        { label: '复制文本＋全部附件', value: 'copy-all' },
        { label: '复制文本＋逐个附件', value: 'copy-one-by-one' },
        { label: '浏览器插件填充', value: 'browser-plugin' }
      ]
    }
  ]
}

function blueprintStageIndex(definition: WorkflowBlueprint, index: number, skillCount: number, stageCount: number): number {
  if (stageCount <= 1 || definition.stageRules.assignment === 'first-stage') return 0
  if (definition.stageRules.assignment === 'counts') {
    let boundary = 0
    for (let stageIndex = 0; stageIndex < stageCount - 1; stageIndex += 1) {
      boundary += definition.stageRules.skillCounts[stageIndex] || 0
      if (index < boundary) return stageIndex
    }
    return stageCount - 1
  }
  if (definition.stageRules.assignment === 'breakpoints') {
    const order = index + 1
    const boundaryIndex = definition.stageRules.breakAfterSkillOrders.findIndex((boundary) => order <= boundary)
    return boundaryIndex >= 0 ? Math.min(boundaryIndex, stageCount - 1) : stageCount - 1
  }
  return Math.min(stageCount - 1, Math.floor((index * stageCount) / Math.max(skillCount, 1)))
}

function isStageEnd(index: number, stageIndexes: number[]): boolean {
  return index === stageIndexes.length - 1 || stageIndexes[index + 1] !== stageIndexes[index]
}

function shouldReviewSkill(definition: WorkflowBlueprint, index: number, stageIndexes: number[]): boolean {
  const order = index + 1
  switch (definition.nodeRules.reviewMode) {
    case 'after-each-skill': return true
    case 'stage-end': return isStageEnd(index, stageIndexes)
    case 'selected-skills': return definition.nodeRules.reviewAfterSkillOrders.includes(order)
    case 'none': return false
  }
}

function appendStageWaitNode(
  definition: WorkflowBlueprint,
  nodes: WorkflowNode[],
  stages: WorkflowStage[],
  index: number,
  stageIndexes: number[]
): void {
  if (!definition.nodeRules.waitAfterStage || !isStageEnd(index, stageIndexes) || index === stageIndexes.length - 1) return
  const stageIndex = stageIndexes[index]
  const stage = stages[stageIndex]
  nodes.push(controlNode(
    definition,
    `stage-${stageIndex + 1}-wait`,
    'wait',
    `等待确认：${stage.title}`,
    stage.stageKey,
    [`stage-${stageIndex + 1}-confirmation`]
  ))
}

function buildBlueprintCheckpoints(
  definition: WorkflowBlueprint,
  nodes: WorkflowNode[],
  stages: WorkflowStage[]
): Workflow['checkpointBlueprint'] {
  const ordered = [...nodes].sort((left, right) => left.order - right.order)
  const skillNodes = ordered.filter((node) => node.type === 'skill')
  const selectedSkillKeys = new Set(definition.checkpointRules.afterSkillOrders.map((order) => `s${String(order).padStart(2, '0')}-skill`))
  let triggers: WorkflowNode[] = []
  switch (definition.checkpointRules.mode) {
    case 'after-review':
      triggers = ordered.filter((node) => node.type === 'review')
      break
    case 'after-each-skill':
      triggers = skillNodes
      break
    case 'selected-skills':
      triggers = skillNodes.filter((node) => selectedSkillKeys.has(node.nodeKey))
      break
    case 'stage-end':
      triggers = stages.map((stage) => ordered.filter((node) => node.stageKey === stage.stageKey).at(-1)).filter((node): node is WorkflowNode => Boolean(node))
      break
    case 'workflow-end':
      triggers = ordered.length > 0 ? [ordered.at(-1)!] : []
      break
    case 'none':
      triggers = []
      break
  }
  return triggers.map((trigger, index) => {
    const triggerIndex = ordered.indexOf(trigger)
    const relatedSkill = trigger.type === 'skill'
      ? trigger
      : [...ordered.slice(0, triggerIndex + 1)].reverse().find((node) => node.type === 'skill')
    const relatedReview = trigger.type === 'review'
      ? trigger
      : ordered.slice(triggerIndex + 1).find((node) => node.type === 'review' && node.stageKey === trigger.stageKey)
    const stage = stages.find((item) => item.stageKey === trigger.stageKey)
    const step = relatedSkill?.nodeKey.match(/^s(\d+)/)?.[1] || String(index + 1)
    const requiredArtifacts = blueprintCheckpointArtifacts(definition, trigger, ordered, skillNodes)
    const checkpointKey = checkpointKeyForTrigger(definition.checkpointRules.mode, trigger, stage, index)
    trigger.checkpointKey = checkpointKey
    return {
      checkpointKey,
      title: formatBlueprintPattern(definition.checkpointRules.titlePattern, {
        skill: relatedSkill?.title || '',
        review: relatedReview?.title || '',
        step,
        stage: stage?.title || '',
        node: trigger.title
      }),
      afterNodeKey: trigger.nodeKey,
      requiredArtifacts
    }
  })
}

function checkpointKeyForTrigger(
  mode: WorkflowBlueprint['checkpointRules']['mode'],
  trigger: WorkflowNode,
  stage: WorkflowStage | undefined,
  index: number
): string {
  if (mode === 'after-review') return `${trigger.nodeKey.replace(/-review$/, '')}-approved`
  if (mode === 'stage-end') return `${stage?.stageKey || `stage-${index + 1}`}-checkpoint`
  if (mode === 'workflow-end') return 'workflow-complete'
  return `${trigger.nodeKey}-checkpoint`
}

function blueprintCheckpointArtifacts(
  definition: WorkflowBlueprint,
  trigger: WorkflowNode,
  nodes: WorkflowNode[],
  skillNodes: WorkflowNode[]
): string[] {
  switch (definition.checkpointRules.requiredArtifacts) {
    case 'none': return []
    case 'trigger-output': {
      if (trigger.type === 'review') {
        const index = nodes.indexOf(trigger)
        return [...nodes.slice(0, index)].reverse().find((node) => node.type === 'skill')?.outputs || []
      }
      return trigger.outputs
    }
    case 'stage-outputs': return skillNodes.filter((node) => node.stageKey === trigger.stageKey).flatMap((node) => node.outputs)
    case 'workflow-outputs': {
      const triggerIndex = nodes.indexOf(trigger)
      return skillNodes.filter((node) => nodes.indexOf(node) <= triggerIndex).flatMap((node) => node.outputs)
    }
  }
}

function blueprintReviewSummary(mode: WorkflowBlueprint['nodeRules']['reviewMode']): string {
  return mode === 'after-each-skill' ? '每个 Skill 后审查'
    : mode === 'stage-end' ? '阶段末审查'
      : mode === 'selected-skills' ? '指定 Skill 后审查'
        : '不自动创建审查节点'
}

function applicabilityProfile(definition: WorkflowBlueprint): ApplicabilityProfile {
  if (definition.skillSelection === 'all-numbered') {
    return {
      researchTypes: [],
      scenarios: ['按编号 Skill 顺序执行'],
      targetArtifacts: [],
      requiredInputs: ['topic'],
      optionalInputs: [],
      prerequisites: [],
      exclusions: [],
      requiredPromptKeys: [],
      requiredSkillKeys: definition.skillNames.map((name) => `skill:${name}`),
      requiredMcpKeys: [],
      externalSoftware: [],
      humanPermissions: ['审查并批准交付物'],
      supportedOperatingSystems: ['Windows', 'macOS', 'Linux'],
      supportedAiPlatforms: ['Codex', 'ChatGPT', 'Claude', 'Gemini'],
      supportedDeliveryModes: ['copy-all', 'copy-one-by-one', 'browser-plugin'],
      riskLevel: 'medium',
      maturity: 'stable',
      maintainer: definition.sourceHint,
      rules: []
    }
  }
  return {
    researchTypes: [definition.researchType],
    scenarios: ['从项目初始化到正式交付'],
    targetArtifacts: definition.family === 'patent' ? ['发明专利申请文件'] : definition.family === 'review' ? ['可投稿 SCI 综述'] : ['可投稿原创研究论文'],
    requiredInputs: ['topic', 'projectDirectory', 'hasRequiredInputs'],
    optionalInputs: definition.family === 'review' ? ['literatureBatchSize'] : [],
    prerequisites: ['原始材料合法可用', '项目目录可写'],
    exclusions: ['任务类型不匹配', '缺少必要授权'],
    requiredPromptKeys: [],
    requiredSkillKeys: definition.skillNames.map((name) => `skill:${name}`),
    requiredMcpKeys: [],
    externalSoftware: ['支持附件粘贴或浏览器插件的 AI 客户端'],
    humanPermissions: ['读取项目材料', '审查并批准交付物'],
    supportedOperatingSystems: ['Windows', 'macOS', 'Linux'],
    supportedAiPlatforms: ['Codex', 'ChatGPT', 'Claude', 'Gemini'],
    supportedDeliveryModes: ['copy-all', 'copy-one-by-one', 'browser-plugin'],
    riskLevel: definition.family === 'patent' ? 'high' : 'medium',
    maturity: 'stable',
    maintainer: definition.sourceHint,
    rules: [
      {
        id: `${definition.templateKey}-missing-inputs`,
        version: 1,
        priority: 100,
        outcome: 'block',
        reason: '必需输入尚未准备，暂时阻断。',
        condition: { kind: 'predicate', field: 'hasRequiredInputs', operator: 'equals', value: false },
        enabled: true
      },
      {
        id: `${definition.templateKey}-missing-authorization`,
        version: 1,
        priority: 90,
        outcome: 'block',
        reason: '缺少人工权限确认，暂时阻断。',
        condition: { kind: 'predicate', field: 'hasHumanAuthorization', operator: 'equals', value: false },
        enabled: true
      },
      {
        id: `${definition.templateKey}-wrong-type`,
        version: 1,
        priority: 80,
        outcome: 'skip',
        reason: `项目类型不是“${definition.researchType}”，不建议使用此模板。`,
        condition: { kind: 'predicate', field: 'researchType', operator: 'notEquals', value: definition.researchType },
        enabled: true
      }
    ]
  }
}

function patentNodeRules(definition: WorkflowBlueprint, step: number): WorkflowNode['applicabilityRules'] {
  if (definition.family !== 'patent' || step <= 3) return []
  const stepValue = String(step).padStart(2, '0')
  return [
    {
      id: `${definition.templateKey}-skip-before-${stepValue}`,
      version: 1,
      priority: 100,
      outcome: 'skip',
      reason: `S03 状态判断指定从更晚步骤开始，跳过 S${stepValue}。`,
      condition: { kind: 'predicate', field: 'startStep', operator: 'gt', value: step },
      enabled: true
    }
  ]
}

function addReviewControlNodes(definition: WorkflowBlueprint, nodes: WorkflowNode[], stages: WorkflowStage[]): void {
  const insertAfter = (reviewKey: string, node: WorkflowNode): void => {
    const index = nodes.findIndex((item) => item.nodeKey === reviewKey)
    if (index >= 0) nodes.splice(index + 1, 0, node)
  }
  insertAfter('s09-review', controlNode(definition, 'adapter-evidence-matrix', 'adapter', '证据支撑矩阵适配', stages[1].stageKey, ['证据支撑矩阵.csv']))
  insertAfter('s13-review', controlNode(definition, 'adapter-full-draft', 'adapter', '完整综述初稿汇总', stages[2].stageKey, ['完整综述初稿.md']))
  insertAfter('s19-review', controlNode(definition, 'wait-editor-decision', 'wait', '等待并导入编辑决定', stages[4].stageKey, ['编辑决定']))
}

function controlNode(
  definition: WorkflowBlueprint,
  nodeKey: string,
  type: 'adapter' | 'wait',
  title: string,
  stageKey: string,
  outputs: string[]
): WorkflowNode {
  return {
    id: `${definition.templateKey}-${nodeKey}`,
    nodeKey,
    type,
    title,
    summary: type === 'adapter' ? '只登记、映射或汇总交付物，不改写原 Skill。' : '等待外部状态变化后由用户继续。',
    tags: [type],
    inputs: {},
    outputs,
    requiresReview: false,
    stageKey,
    order: 0,
    applicabilityRules: [],
    position: { x: 0, y: 0 }
  }
}

function configurePatentRouting(
  edges: Array<{ id: string; source: string; target: string; condition?: Workflow['edges'][number]['condition'] }>,
  nodes: WorkflowNode[]
): void {
  const source = 's03-review'
  const sequential = edges.findIndex((edge) => edge.source === source)
  if (sequential >= 0) edges.splice(sequential, 1)
  for (let step = 4; step <= 12; step += 1) {
    const value = String(step).padStart(2, '0')
    if (!nodes.some((node) => node.nodeKey === `s${value}-skill`)) continue
    edges.push({
      id: `${nodes[0]?.id.split('-s01-')[0] || 'source-invention-patent-v2'}-route-${value}`,
      source,
      target: `s${value}-skill`,
      condition: { kind: 'predicate', field: 'startStep', operator: 'equals', value }
    })
  }
}

function sourcePackageLocator(definition: WorkflowBlueprint, skills: Map<string, SkillItem>): string {
  for (const name of definition.skillNames) {
    const skillPath = skills.get(name)?.path
    if (!skillPath) continue
    const normalized = skillPath.replaceAll('/', '\\')
    const marker = normalized.toLocaleLowerCase().lastIndexOf('\\skills\\')
    if (marker >= 0) return normalized.slice(0, marker)
  }
  return definition.sourceHint
}

function cloneBlueprint(blueprint: WorkflowBlueprint): WorkflowBlueprint {
  return {
    ...blueprint,
    legacyTemplateKeys: [...blueprint.legacyTemplateKeys],
    skillSelection: blueprint.skillSelection,
    skillNames: [...blueprint.skillNames],
    orderStrategy: 'skill-directory-prefix',
    stageTitles: [...blueprint.stageTitles],
    stageRules: {
      ...blueprint.stageRules,
      skillCounts: [...blueprint.stageRules.skillCounts],
      breakAfterSkillOrders: [...blueprint.stageRules.breakAfterSkillOrders]
    },
    nodeRules: { ...blueprint.nodeRules, reviewAfterSkillOrders: [...blueprint.nodeRules.reviewAfterSkillOrders] },
    checkpointRules: { ...blueprint.checkpointRules, afterSkillOrders: [...blueprint.checkpointRules.afterSkillOrders] }
  }
}

function parseBlueprint(value: unknown): WorkflowBlueprint {
  if (!isRecord(value)) throw new Error('中间模板包含无效的工作流定义。')
  const family = value.family
  if (family !== 'research' && family !== 'review' && family !== 'patent' && family !== 'custom') {
    throw new Error('中间模板的工作流类型无效。')
  }
  const blueprint: WorkflowBlueprint = {
    templateKey: stringField(value.templateKey, 'templateKey'),
    legacyTemplateKeys: stringArray(value.legacyTemplateKeys),
    title: stringField(value.title, 'title'),
    family,
    researchType: typeof value.researchType === 'string' ? value.researchType.trim() : '',
    skillSelection: value.skillSelection === 'all-numbered' ? 'all-numbered' : 'named',
    skillNames: stringArray(value.skillNames),
    orderStrategy: 'skill-directory-prefix',
    sourceHint: typeof value.sourceHint === 'string' ? value.sourceHint : '',
    stageTitles: stringArray(value.stageTitles),
    stageRules: parseBlueprintStageRules(value.stageRules, value.nodeRules),
    nodeRules: parseBlueprintNodeRules(value.nodeRules),
    checkpointRules: parseBlueprintCheckpointRules(value.checkpointRules)
  }
  if ((blueprint.skillSelection === 'named' && blueprint.skillNames.length === 0) || blueprint.stageTitles.length === 0) {
    throw new Error(`${blueprint.title}：命名模板必须包含 Skill 名称，且所有模板都必须包含阶段。`)
  }
  return blueprint
}

function parseBlueprintStageRules(value: unknown, legacyNodeRules: unknown): WorkflowBlueprint['stageRules'] {
  const defaults = defaultBlueprintStageRules()
  if (isRecord(value)) {
    const assignment = ['balanced', 'counts', 'breakpoints', 'first-stage'].includes(String(value.assignment))
      ? value.assignment as WorkflowBlueprint['stageRules']['assignment']
      : defaults.assignment
    return {
      assignment,
      skillCounts: positiveIntegerList(value.skillCounts),
      breakAfterSkillOrders: positiveIntegerArray(value.breakAfterSkillOrders)
    }
  }
  if (isRecord(legacyNodeRules) && legacyNodeRules.stageAssignment === 'first-stage') {
    return { ...defaults, assignment: 'first-stage' }
  }
  return defaults
}

function parseBlueprintNodeRules(value: unknown): WorkflowBlueprint['nodeRules'] {
  const defaults = defaultBlueprintNodeRules()
  if (!isRecord(value)) return defaults
  const legacyMode = typeof value.reviewAfterEachSkill === 'boolean'
    ? value.reviewAfterEachSkill ? 'after-each-skill' : 'none'
    : defaults.reviewMode
  return {
    reviewMode: ['after-each-skill', 'stage-end', 'selected-skills', 'none'].includes(String(value.reviewMode))
      ? value.reviewMode as WorkflowBlueprint['nodeRules']['reviewMode']
      : legacyMode,
    reviewAfterSkillOrders: positiveIntegerArray(value.reviewAfterSkillOrders),
    reviewChecklistLabel:
      typeof value.reviewChecklistLabel === 'string' && value.reviewChecklistLabel.trim()
        ? value.reviewChecklistLabel.trim()
        : defaults.reviewChecklistLabel,
    waitAfterStage: value.waitAfterStage === true
  }
}

function parseBlueprintCheckpointRules(value: unknown): WorkflowBlueprint['checkpointRules'] {
  const defaults = defaultBlueprintCheckpointRules()
  if (!isRecord(value)) return defaults
  const legacyMode = typeof value.afterEachReview === 'boolean'
    ? value.afterEachReview ? 'after-review' : 'none'
    : defaults.mode
  return {
    mode: ['after-review', 'after-each-skill', 'stage-end', 'workflow-end', 'selected-skills', 'none'].includes(String(value.mode))
      ? value.mode as WorkflowBlueprint['checkpointRules']['mode']
      : legacyMode,
    afterSkillOrders: positiveIntegerArray(value.afterSkillOrders),
    titlePattern:
      typeof value.titlePattern === 'string' && value.titlePattern.trim() ? value.titlePattern.trim() : defaults.titlePattern,
    requiredArtifacts: ['trigger-output', 'stage-outputs', 'workflow-outputs', 'none'].includes(String(value.requiredArtifacts))
      ? value.requiredArtifacts as WorkflowBlueprint['checkpointRules']['requiredArtifacts']
      : value.requiredArtifacts === 'none' ? 'none' : 'trigger-output'
  }
}

function formatBlueprintPattern(pattern: string, values: Record<'skill' | 'review' | 'step' | 'stage' | 'node', string>): string {
  return pattern.replace(/\{(skill|review|step|stage|node)\}/g, (_match, key: keyof typeof values) => values[key])
}

function stringField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`中间模板缺少 ${field}。`)
  return value.trim()
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []
}

function positiveIntegerArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0))).sort((a, b) => a - b)
}

function positiveIntegerList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((item) => Number.isSafeInteger(item) && item > 0)
}

function normalizeSkillName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function skillDirectorySequence(filePath: string): { order: number; directoryName: string } | null {
  const parts = filePath.replaceAll('/', '\\').split('\\').filter(Boolean)
  const directoryName = /SKILL\.md$/i.test(parts.at(-1) || '') ? parts.at(-2) || '' : parts.at(-1) || ''
  const match = directoryName.match(/^(\d{2})-/)
  if (!match) return null
  const order = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(order) ? { order, directoryName } : null
}

function compareResolvedSkills(
  left: WorkflowBlueprintResolution['resolved'][number],
  right: WorkflowBlueprintResolution['resolved'][number]
): number {
  return left.order - right.order || left.directoryName.localeCompare(right.directoryName, 'zh-CN') || left.name.localeCompare(right.name)
}

function missingSequenceNumbers(orders: number[]): number[] {
  const unique = Array.from(new Set(orders)).sort((left, right) => left - right)
  if (unique.length === 0) return []
  const missing: number[] = []
  const start = unique.includes(0) ? 0 : 1
  for (let value = start; value <= unique.at(-1)!; value += 1) {
    if (!unique.includes(value)) missing.push(value)
  }
  return missing
}

function formatSequenceList(values: number[]): string {
  return values.map((value) => String(value).padStart(2, '0')).join('、')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
