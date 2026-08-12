export type NodeKind =
  | 'prompt'
  | 'skill'
  | 'mcp'
  | 'review'
  | 'adapter'
  | 'wait'
  | 'route'
  /** @deprecated v2 data is normalized to `review` on load. */
  | 'approval'

export type DeliveryMode = 'copy-all' | 'copy-one-by-one' | 'browser-plugin'

export type ApplicabilityOutcome = 'enable' | 'skip' | 'block' | 'review' | 'route'

export type ApplicabilityOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'in'
  | 'exists'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'range'

export type ApplicabilityCondition =
  | {
      kind: 'predicate'
      field: string
      operator: ApplicabilityOperator
      value?: unknown
      min?: number
      max?: number
    }
  | { kind: 'all'; conditions: ApplicabilityCondition[] }
  | { kind: 'any'; conditions: ApplicabilityCondition[] }
  | { kind: 'not'; condition: ApplicabilityCondition }

export type ApplicabilityRule = {
  id: string
  version: number
  priority: number
  outcome: ApplicabilityOutcome
  reason: string
  condition: ApplicabilityCondition
  routeTargetNodeKey?: string
  enabled: boolean
}

export type ApplicabilityProfile = {
  researchTypes: string[]
  scenarios: string[]
  targetArtifacts: string[]
  requiredInputs: string[]
  optionalInputs: string[]
  prerequisites: string[]
  exclusions: string[]
  requiredPromptKeys: string[]
  requiredSkillKeys: string[]
  requiredMcpKeys: string[]
  externalSoftware: string[]
  humanPermissions: string[]
  supportedOperatingSystems: string[]
  supportedAiPlatforms: string[]
  supportedDeliveryModes: DeliveryMode[]
  /** Compatibility metadata retained for imported templates; not shown in the primary workflow UI. */
  riskLevel: 'low' | 'medium' | 'high'
  /** Compatibility metadata retained for imported templates; not shown in the primary workflow UI. */
  maturity: 'draft' | 'pilot' | 'stable'
  maintainer: string
  rules: ApplicabilityRule[]
}

export type ApplicabilityDecision = {
  status: 'highly-applicable' | 'conditionally-applicable' | 'not-recommended' | 'blocked'
  outcome: ApplicabilityOutcome
  reason: string
  ruleId?: string
  ruleVersion?: number
  routeTargetNodeKey?: string
  evaluatedAt: string
  inputSnapshot: Record<string, unknown>
}

export type WorkflowFormField = {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'multiselect' | 'path' | 'file'
  required: boolean
  description?: string
  defaultValue?: unknown
  options?: Array<{ label: string; value: string }>
}

export type WorkflowStage = {
  stageKey: string
  title: string
  description: string
  order: number
}

export type ResourceReference = {
  resourceKey: string
  type: 'prompt' | 'skill' | 'mcp'
  expectedVersion: string
  fingerprint: string
  locator: string
}

export type ReviewChecklistItem = {
  key: string
  label: string
  description?: string
  required: boolean
}

export type CheckpointBlueprint = {
  checkpointKey: string
  title: string
  afterNodeKey: string
  requiredArtifacts: string[]
}

export type ApplicabilityTestCase = {
  id: string
  title: string
  projectFields: Record<string, unknown>
  expectedStatus: ApplicabilityDecision['status']
  expectedNodeKeys?: string[]
}

export type WorkflowChangeLogEntry = {
  version: string
  publishedAt: string
  summary: string
}

export type PromptItem = {
  id: string
  title: string
  summary: string
  content: string
  tags: string[]
  variables: string[]
  preferredSkillIds: string[]
  version: number
  favorite: boolean
  createdAt: string
  updatedAt: string
}

export type PromptDuplicateConflict = {
  id: string
  existing: PromptItem
  imported: PromptItem
}

export type PromptImportAnalysis = {
  additions: PromptItem[]
  identical: Array<{ existing: PromptItem; imported: PromptItem }>
  conflicts: PromptDuplicateConflict[]
}

export type PromptDuplicateGroup = {
  id: string
  items: PromptItem[]
  identicalContent: boolean
}

export type SkillItem = {
  id: string
  name: string
  title: string
  summary: string
  tags: string[]
  variables: string[]
  favorite: boolean
  path: string
  source: 'codex' | 'custom'
  contentPreview: string
  contentFingerprint?: string
  updatedAt: string
}

export type SkillDuplicateConflict = {
  id: string
  existing: SkillItem
  imported: SkillItem
}

export type SkillImportAnalysis = {
  additions: SkillItem[]
  identical: Array<{ existing: SkillItem; imported: SkillItem }>
  conflicts: SkillDuplicateConflict[]
}

export type SkillDuplicateGroup = {
  id: string
  items: SkillItem[]
  identicalContent: boolean
}

export type SkillDirectoryNode = {
  name: string
  kind: 'file' | 'directory' | 'none'
  path?: string
  content?: string
  isText?: boolean
  children?: SkillDirectoryNode[]
}

export type SkillDirectorySnapshot = {
  root: string
  skillMd: SkillDirectoryNode
  agentOpenAiYaml: SkillDirectoryNode
  scripts: SkillDirectoryNode
  references: SkillDirectoryNode
  assets: SkillDirectoryNode
  extras: SkillDirectoryNode[]
}

export type GithubSearchResult = {
  id: string
  name: string
  repository: string
  description: string
  path: string
  htmlUrl: string
  rawUrl: string
  ref?: string
  sourceId?: string
  sourceName?: string
  sourceType?: 'github' | 'website'
  resultType?: 'document' | 'search-page'
}

export type DiscoveryKind = 'prompt' | 'skill'

export type DiscoverySource = {
  id: string
  name: string
  kind: DiscoveryKind | 'both'
  searchUrlTemplate: string
  resultLinkMatch?: string
  enabled: boolean
}

export type DataDirectoryKind = 'data' | 'prompts' | 'workflows' | 'projects' | 'skillMetadata' | 'managedSkills'

export type DataDirectoryOverrides = {
  prompts?: string
  workflows?: string
  projects?: string
  skillMetadata?: string
  managedSkills?: string
}

export type SkillMetadata = {
  tags: string[]
  assignedTags?: string[]
  summaryOverride?: string
  favorite?: boolean
  variables?: string[]
}

export type ResourceKind = 'prompts' | 'skills' | 'workflows' | 'mcps' | 'quickCalls' | 'learning'

export type GroupItem = {
  id: string
  name: string
  tag: string
  children: GroupItem[]
}

export type ResourceGroups = Record<ResourceKind, GroupItem[]>

export type DeletedTagRecovery = {
  id: string
  resource: 'prompts'
  group: GroupItem
  promptTags: Record<string, string[]>
  deletedAt: string
}

export type McpServer = {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  transport: 'stdio' | 'sse' | 'http'
  enabled: boolean
  tags: string[]
  source: 'manual' | 'imported'
  createdAt: string
  updatedAt: string
}

export type WorkflowNode = {
  id: string
  nodeKey: string
  type: NodeKind
  refId?: string
  skillRefId?: string
  mcpRefId?: string
  title: string
  summary: string
  tags: string[]
  inputs: Record<string, string>
  outputs: string[]
  requiresReview: boolean
  stageKey: string
  order: number
  resourceRef?: ResourceReference
  applicabilityRules: ApplicabilityRule[]
  reviewChecklist?: ReviewChecklistItem[]
  checkpointKey?: string
  executionPolicy?: {
    kind: 'single' | 'batch' | 'manual'
    batchField?: string
  }
  position: {
    x: number
    y: number
  }
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
  label?: string
  condition?: ApplicabilityCondition
}

export type Workflow = {
  id: string
  templateKey: string
  templateVersion: string
  /** Internal lifecycle compatibility field; not presented as workflow card information. */
  status: 'draft' | 'published' | 'archived'
  family: 'research' | 'review' | 'patent' | 'custom'
  title: string
  description: string
  tags: string[]
  variables: string[]
  favorite: boolean
  formSchema: WorkflowFormField[]
  stages: WorkflowStage[]
  checkpointBlueprint: CheckpointBlueprint[]
  applicability: ApplicabilityProfile
  applicabilityTests: ApplicabilityTestCase[]
  changeLog: WorkflowChangeLogEntry[]
  sourcePackage?: {
    name: string
    path: string
    excluded?: boolean
    /** Distinguishes user-imported workflow packages from application defaults. */
    origin?: 'imported' | 'legacy'
    /** Stable recipe identity used to make source-package imports idempotent. */
    templateId?: string
    importedAt?: string
  }
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

export type AppSettings = {
  shortcut: string
  skillDirectories: string[]
  dataDirectory?: string
  dataDirectories?: DataDirectoryOverrides
  backupDirectory?: string
  temporaryWordDirectory?: string
  temporaryWordRetentionHours?: number
  gitBackupRemote?: string
  gitBackupBranch?: string
  gitBackupUserEmail?: string
  discoverySources?: DiscoverySource[]
}

export type WorkflowTemplate = Workflow

export type ReviewAttempt = {
  id: string
  projectId: string
  workflowId: string
  templateVersion: string
  nodeKey: string
  attempt: number
  checklist: Record<string, boolean>
  passed: boolean
  changeReason: string
  reviewedAt: string
  deliveryRecordIds: string[]
  /** Files supplied with a Review change reason. Optional for legacy project records. */
  attachmentPaths?: string[]
  source?: 'workflow-v3' | 'legacy-v2'
}

export type DeliveryRecord = {
  id: string
  projectId: string
  workflowId: string
  templateVersion: string
  nodeKey: string
  mode: DeliveryMode
  text: string
  attachmentPaths: string[]
  createdAt: string
  source?: 'workflow-v3' | 'legacy-v2-output'
}

export type NodeExecutionState = {
  nodeKey: string
  status: 'pending' | 'ready' | 'delivered' | 'waiting-review' | 'passed' | 'skipped' | 'blocked' | 'completed'
  applicability?: ApplicabilityDecision
  formValues: Record<string, unknown>
  deliveryRecordIds: string[]
  reviewAttemptIds: string[]
  enteredAt?: string
  completedAt?: string
}

export type ProjectCheckpoint = {
  checkpointKey: string
  nodeKey: string
  createdAt: string
  deliveryRecordIds: string[]
}

export type ResourceLock = ResourceReference & {
  lockedAt: string
}

export type LegacyRunStepSnapshot = {
  sourceStepId: string
  sourceNodeId: string
  nodeKey: string
  title: string
  type: string
  status: string
  reviewedByHuman: boolean
  inputSnapshot: string
  output: string
  startedAt?: string
  finishedAt?: string
}

export type LegacyRunMigration = {
  sourceStoreVersion: number
  sourceRunId: string
  sourceWorkflowId: string
  sourceWorkflowTitle: string
  sourceStatus: string
  sourceCurrentStepIndex: number
  migratedAt: string
  steps: LegacyRunStepSnapshot[]
}

export type ProjectFlowState = {
  id: string
  projectId: string
  projectTitle: string
  workflowId: string
  templateKey: string
  templateVersion: string
  status: 'active' | 'blocked' | 'waiting' | 'completed'
  projectFields: Record<string, unknown>
  workflowApplicability: ApplicabilityDecision
  currentNodeKey: string
  nodeStates: Record<string, NodeExecutionState>
  deliveryRecords: DeliveryRecord[]
  reviewAttempts: ReviewAttempt[]
  checkpoints: ProjectCheckpoint[]
  resourceLocks: Record<string, ResourceLock>
  legacyMigration?: LegacyRunMigration
  createdAt: string
  updatedAt: string
}

export type LegacyWorkflowArchive = {
  storeVersion: number
  workflows: Workflow[]
  runs: unknown[]
  archivedAt: string
  reason: string
}

export type ResourceVersion = {
  id: string
  resourceKey: string
  type: 'prompt' | 'skill' | 'mcp'
  version: string
  fingerprint: string
  locator: string
  metadata: Record<string, unknown>
  contentSnapshot?: string
  createdAt: string
}

export type AppStore = {
  version: number
  prompts: PromptItem[]
  skillIndex: Record<string, SkillMetadata>
  groups: ResourceGroups
  mcpServers: McpServer[]
  workflows: Workflow[]
  projectFlowStates: ProjectFlowState[]
  resourceVersions: ResourceVersion[]
  legacyWorkflowArchive?: LegacyWorkflowArchive
  tagRecoveries: DeletedTagRecovery[]
  settings: AppSettings
}

export type AppPaths = {
  userData: string
  dataDirectory: string
  defaultBackupDirectory: string
  storePath: string
  promptDirectory?: string
  workflowDirectory?: string
  projectDirectory?: string
  skillMetadataPath?: string
  managedSkillDirectory: string
  browserExtensionDirectory?: string
  dataDirectoryPreferencePath?: string
  temporaryWordDirectory?: string
  temporaryWordScriptDirectory?: string
  defaultSkillDirectories: string[]
  defaultDataDirectories: Record<DataDirectoryKind, string>
}

export type ShortcutResult = {
  ok: boolean
  accelerator: string
  message: string
}

export type ImportResult<T> = {
  ok: boolean
  message: string
  items: T[]
  installedPaths?: string[]
  managedDirectory?: string
}

export type WorkflowSkillPackageEntry = {
  order: number
  directoryName: string
  frontmatterName: string
  title: string
  sourcePath: string
  installedPath?: string
  skillFileRelativePath: string
  fingerprint: string
}

export type WorkflowSkillPackageMetadata = {
  format: 'format-flow-workflow-skill-package'
  schemaVersion: 1
  packageId: string
  name: string
  sourceDirectory: string
  sourceArchivePath?: string
  managedDirectory: string
  installedPackageDirectory: string
  createdAt: string
  entries: WorkflowSkillPackageEntry[]
}

export type WorkflowSkillPackageResult = {
  ok: boolean
  message: string
  metadata?: WorkflowSkillPackageMetadata
  metadataPath?: string
  installedSkills: SkillItem[]
  installedPaths: string[]
}

export type BackupResult = {
  ok: boolean
  message: string
  path?: string
  commit?: string
  pushed?: boolean
  remote?: string
}

export type ExportTextFileRequest = {
  fileName: string
  content: string
  filters?: Array<{
    name: string
    extensions: string[]
  }>
}

export type ExportResult = {
  ok: boolean
  message: string
  path?: string
}

export type GithubPreviewResult = {
  ok: boolean
  message: string
  content: string
}

export type TemporaryWordAttachment = {
  id: string
  variableName: string
  path: string
  filePaths?: string[]
  fileName: string
  createdAt: string
  expiresAt: string
  source: 'word-selection' | 'files'
  sourceFileNames: string[]
  warnings: string[]
}

export type TemporaryWordResult = {
  ok: boolean
  message: string
  attachment?: TemporaryWordAttachment
}

export type TemporaryWordFilesRequest = {
  variableName: string
  filePaths: string[]
}

export type TemporaryWordClipboardRequest = {
  text: string
  filePaths: string[]
}

export type TemporaryWordCleanupResult = {
  ok: boolean
  message: string
  removed: number
}

export type SkillFileWriteRequest = {
  skillPath: string
  relativePath: string
  content: string
}

export type SkillEntryCreateRequest = {
  skillPath: string
  parentRelativePath: string
  name: string
  kind: 'file' | 'directory'
  content?: string
}
