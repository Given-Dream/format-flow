export type NodeKind = 'prompt' | 'skill' | 'approval'

export type PromptItem = {
  id: string
  title: string
  summary: string
  content: string
  tags: string[]
  variables: string[]
  version: number
  favorite: boolean
  createdAt: string
  updatedAt: string
}

export type SkillItem = {
  id: string
  name: string
  title: string
  summary: string
  tags: string[]
  path: string
  source: 'codex' | 'custom'
  contentPreview: string
  updatedAt: string
}

export type GithubSearchResult = {
  id: string
  name: string
  repository: string
  description: string
  path: string
  htmlUrl: string
  rawUrl: string
}

export type SkillMetadata = {
  tags: string[]
  summaryOverride?: string
  favorite?: boolean
}

export type ResourceKind = 'prompts' | 'skills' | 'mcps' | 'quickCalls' | 'learning'

export type GroupItem = {
  id: string
  name: string
  tag: string
  children: GroupItem[]
}

export type ResourceGroups = Record<ResourceKind, GroupItem[]>

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
  backupDirectory?: string
  gitBackupRemote?: string
  gitBackupBranch?: string
  gitBackupUserEmail?: string
}

export type AppStore = {
  version: number
  prompts: PromptItem[]
  skillIndex: Record<string, SkillMetadata>
  groups: ResourceGroups
  mcpServers: McpServer[]
  workflows: Workflow[]
  runs: WorkflowRun[]
  settings: AppSettings
}

export type AppPaths = {
  userData: string
  dataDirectory: string
  defaultBackupDirectory: string
  storePath: string
  managedSkillDirectory: string
  browserExtensionDirectory?: string
  dataDirectoryPreferencePath?: string
  defaultSkillDirectories: string[]
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
