export type NodeKind = 'prompt' | 'skill' | 'mcp' | 'approval'

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

export type DataDirectoryKind = 'data' | 'prompts' | 'workflows' | 'skillMetadata' | 'managedSkills'

export type DataDirectoryOverrides = {
  prompts?: string
  workflows?: string
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
  position: {
    x: number
    y: number
  }
}

export type WorkflowEdge = {
  id: string
  source: string
  target: string
}

export type Workflow = {
  id: string
  title: string
  description: string
  tags: string[]
  variables: string[]
  favorite: boolean
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

export type RunStepStatus = 'pending' | 'approved' | 'running' | 'done' | 'failed'

export type RunStep = {
  id: string
  nodeId: string
  title: string
  summary: string
  type: NodeKind
  status: RunStepStatus
  reviewedByHuman: boolean
  inputSnapshot: string
  output: string
  startedAt?: string
  finishedAt?: string
}

export type WorkflowRun = {
  id: string
  workflowId: string
  workflowTitle: string
  status: 'reviewing' | 'running' | 'completed' | 'failed'
  currentStepIndex: number
  steps: RunStep[]
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

export type AppStore = {
  version: number
  prompts: PromptItem[]
  skillIndex: Record<string, SkillMetadata>
  groups: ResourceGroups
  mcpServers: McpServer[]
  workflows: Workflow[]
  runs: WorkflowRun[]
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
