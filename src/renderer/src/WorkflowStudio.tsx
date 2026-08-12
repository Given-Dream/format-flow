import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, JSX, ReactNode } from 'react'
import {
  createMcpServer,
  createPrompt,
  createWorkflow,
  defaultWorkflowGroups,
  newId,
  nodeFromMcp,
  nodeFromPrompt,
  nodeFromSkill,
  nowIso,
  rebuildLinearEdges
} from '@shared/domain'
import {
  buildWorkflowFromBlueprint,
  createWorkflowBlueprintCatalog,
  defaultBlueprintCheckpointRules,
  defaultBlueprintNodeRules,
  defaultBlueprintStageRules,
  defaultWorkflowSkillSelection,
  hydrateImportedWorkflowResources,
  importedWorkflowResourceStats,
  isSourcePackageWorkflow,
  parseWorkflowBlueprintCatalog,
  parseWorkflowImportDocument,
  PREDEFINED_WORKFLOW_BLUEPRINTS,
  resolveWorkflowBlueprint,
  selectNewWorkflowImports,
  skillsFromWorkflowPackageMetadata,
  workflowSkillDirectorySequence,
  type WorkflowBlueprint
} from '@shared/workflow-import-templates'
import { sha256Text } from '@shared/sha256'
import { skillResourceMatchesReference } from '@shared/skill-resource-sync'
import type {
  AppStore,
  AppPaths,
  DeliveryMode,
  GroupItem,
  ProjectFlowState,
  PromptItem,
  ResourceReference,
  SkillDirectorySnapshot,
  SkillItem,
  Workflow,
  WorkflowNode
} from '@shared/types'
import {
  completeControlNode,
  diffWorkflowTemplates,
  recordDelivery,
  REVIEW_OUTPUT_CONFIRMATION_KEY,
  submitReview,
  updateProjectSetup,
  validateWorkflow
} from '@shared/workflow-v3'

type CommitStore = (mutation: (store: AppStore) => AppStore) => Promise<void>

export type WorkflowOpenRequest = {
  workflowId: string
  nonce: number
}

export type WorkflowResourceGroupManagerProps = {
  title: string
  detail: string
  allLabel: string
  allCount: number
  groups: GroupItem[]
  readOnlyGroups?: GroupItem[]
  selectedTag: string
  countForTag: (tag: string) => number
  countForTags?: (tags: string[]) => number
  onSelect: (tag: string) => void
  onChange: (groups: GroupItem[]) => Promise<void>
  onCreate?: (parent: GroupItem | null, group: GroupItem, groups: GroupItem[]) => Promise<void>
  onRename?: (group: GroupItem, renamedGroup: GroupItem, groups: GroupItem[]) => Promise<void>
  onDelete: (group: GroupItem) => Promise<void>
  renderGroupContextActions?: (group: GroupItem, closeMenu: () => void) => ReactNode
  footer?: ReactNode
}

export type WorkflowLibraryUi = {
  ResourceGroupManager: (props: WorkflowResourceGroupManagerProps) => JSX.Element
  PanelHeader: (props: { title: string; detail: string }) => JSX.Element
  SearchBox: (props: { query: string; setQuery: (query: string) => void; placeholder: string }) => JSX.Element
}

type WorkflowStudioProps = {
  store: AppStore
  skills: SkillItem[]
  paths: AppPaths | null
  commit: CommitStore
  setNotice: (message: string) => void
  refreshSkills: () => Promise<void>
  editSkill?: (skill: SkillItem) => void
  openRequest?: WorkflowOpenRequest | null
  libraryUi: WorkflowLibraryUi
}

type StudioTab = 'compose' | 'resources' | 'execute'
type LayoutMode = 'tree' | 'canvas' | 'compact'
type ProjectRecordDraft = {
  mode: 'create' | 'edit'
  stateId: string
  workflowId: string
  title: string
  topic: string
}

const workflowFamilyLabels: Record<Workflow['family'], string> = {
  research: '原创研究',
  review: 'SCI 综述',
  patent: '发明专利',
  custom: '自定义'
}

const deliveryModeLabels: Record<DeliveryMode, string> = {
  'copy-all': '复制文本＋全部附件',
  'copy-one-by-one': '复制文本＋逐个附件',
  'browser-plugin': '浏览器插件填充'
}

const standardReviewItems = [
  { key: REVIEW_OUTPUT_CONFIRMATION_KEY, label: '已核对上一 Skill 的要求输出', required: true }
]

export default function WorkflowStudio({
  store,
  skills,
  paths,
  commit,
  setNotice,
  refreshSkills,
  editSkill,
  openRequest,
  libraryUi
}: WorkflowStudioProps): JSX.Element {
  const {
    ResourceGroupManager: SharedResourceGroupManager,
    PanelHeader: SharedPanelHeader,
    SearchBox: SharedSearchBox
  } = libraryUi
  const [workflowId, setWorkflowId] = useState(store.workflows[0]?.id || '')
  const [activeTab, setActiveTab] = useState<StudioTab>('compose')
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('tree')
  const [selectedNodeKey, setSelectedNodeKey] = useState('')
  const [nodeQuery, setNodeQuery] = useState('')
  const [selectedNodeKeys, setSelectedNodeKeys] = useState<string[]>([])
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardDraft, setWizardDraft] = useState<Workflow | null>(null)
  const [projectTitle, setProjectTitle] = useState('')
  const [projectKey, setProjectKey] = useState(() => newId('project'))
  const [projectFields, setProjectFields] = useState<Record<string, unknown>>({})
  const [activeProjectStateId, setActiveProjectStateId] = useState('')
  const [viewedNodeKey, setViewedNodeKey] = useState('')
  const [projectEditorOpen, setProjectEditorOpen] = useState(true)
  const [projectDraftDirty, setProjectDraftDirty] = useState(false)
  const [projectSaveStatus, setProjectSaveStatus] = useState<'idle' | 'pending' | 'saved' | 'error'>('idle')
  const projectSaveRevision = useRef(0)
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('copy-all')
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([])
  const [copyStep, setCopyStep] = useState(0)
  const [reviewChecklist, setReviewChecklist] = useState<Record<string, boolean>>({})
  const [reviewReason, setReviewReason] = useState('')
  const [reviewAttachmentPaths, setReviewAttachmentPaths] = useState<string[]>([])
  const [resourceContent, setResourceContent] = useState('')
  const [resourceOriginalContent, setResourceOriginalContent] = useState('')
  const [resourceLoading, setResourceLoading] = useState(false)
  const [nodeAdditionalInfo, setNodeAdditionalInfo] = useState('')
  const [executionSkillContent, setExecutionSkillContent] = useState('')
  const [executionSkillDirectory, setExecutionSkillDirectory] = useState('')
  const [executionSkillLoading, setExecutionSkillLoading] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)
  const [overviewQuery, setOverviewQuery] = useState('')
  const [selectedWorkflowGroup, setSelectedWorkflowGroup] = useState('all')
  const [templateImporterOpen, setTemplateImporterOpen] = useState(false)
  const [templateExporterOpen, setTemplateExporterOpen] = useState(false)
  const [templateImporterBlueprints, setTemplateImporterBlueprints] = useState<WorkflowBlueprint[]>(() => [...PREDEFINED_WORKFLOW_BLUEPRINTS])
  const [templateImporterLabel, setTemplateImporterLabel] = useState('通用中间模板')
  const [templateImporterSkills, setTemplateImporterSkills] = useState<SkillItem[]>([])
  const [templateImporterPackageName, setTemplateImporterPackageName] = useState('')
  const [templateImporterPackagePath, setTemplateImporterPackagePath] = useState('')
  const [templateImporterMetadataPath, setTemplateImporterMetadataPath] = useState('')
  const [selectedBlueprintKeys, setSelectedBlueprintKeys] = useState<string[]>([])
  const [selectedTemplateSkillIds, setSelectedTemplateSkillIds] = useState<string[]>([])

  const workflow = store.workflows.find((item) => item.id === workflowId) || store.workflows[0]
  const workflowGroups = store.groups.workflows
  const visibleWorkflows = useMemo(() => {
    const query = overviewQuery.trim().toLowerCase()
    const selectedTags = selectedWorkflowGroup === 'all'
      ? null
      : workflowGroupTags(findWorkflowGroupByTag(workflowGroups, selectedWorkflowGroup))
    return store.workflows.filter((item) => {
      if (selectedTags && !item.tags.some((tag) => selectedTags.includes(tag))) return false
      if (!query) return true
      const searchable = [
        item.title,
        item.description,
        item.templateKey,
        workflowFamilyLabels[item.family],
        ...item.tags
      ].join(' ').toLowerCase()
      return searchable.includes(query)
    })
  }, [overviewQuery, selectedWorkflowGroup, store.workflows, workflowGroups])
  const orderedNodes = useMemo(
    () => [...(workflow?.nodes || [])].sort((left, right) => left.order - right.order),
    [workflow]
  )
  const selectedNode = orderedNodes.find((node) => node.nodeKey === selectedNodeKey) || orderedNodes[0]
  const selectedSkill = selectedNode?.type === 'skill' ? resolveSkill(selectedNode, skills) : undefined
  const selectedSkillMatchesLock = Boolean(
    selectedSkill && selectedNode?.resourceRef && skillResourceMatchesReference(selectedNode.resourceRef, selectedSkill)
  )
  const projectStates = store.projectFlowStates.filter(
    (state) => state.workflowId === workflow?.id && state.templateVersion === workflow?.templateVersion
  )
  const activeProject = store.projectFlowStates.find((state) => state.id === activeProjectStateId)
  const actualCurrentNode = workflow?.nodes.find((node) => node.nodeKey === activeProject?.currentNodeKey)
  const latestProjectNode = actualCurrentNode || [...orderedNodes].reverse().find((node) => ['completed', 'passed'].includes(activeProject?.nodeStates[node.nodeKey]?.status || ''))
  const viewedNode = workflow?.nodes.find((node) => node.nodeKey === viewedNodeKey)
  const currentNode = viewedNode || actualCurrentNode
  const isViewingHistoricalNode = Boolean(viewedNode && viewedNode.nodeKey !== actualCurrentNode?.nodeKey)
  const previousSkillNode = currentNode?.type === 'review'
    ? [...orderedNodes].reverse().find((node) => node.type === 'skill' && node.order < currentNode.order)
    : undefined
  const executionSkillNode = currentNode?.type === 'skill' ? currentNode : previousSkillNode
  const executionSkill = executionSkillNode ? resolveSkill(executionSkillNode, skills) : undefined
  const validation = workflow ? validateWorkflow(workflow) : []
  const resourceStats = importedWorkflowResourceStats(store.workflows)

  useEffect(() => {
    if (!workflow) return
    if (!selectedNodeKey || !workflow.nodes.some((node) => node.nodeKey === selectedNodeKey)) {
      setSelectedNodeKey(orderedNodes[0]?.nodeKey || '')
    }
  }, [workflow?.id, orderedNodes, selectedNodeKey])

  useEffect(() => {
    if (!workflow) return
    prepareNewProject(workflow)
  }, [workflow?.id])

  useEffect(() => {
    setViewedNodeKey('')
  }, [activeProjectStateId, workflow?.id])

  useEffect(() => {
    if (store.groups.workflows.length > 0) return
    void commit((current) => current.groups.workflows.length > 0
      ? current
      : { ...current, groups: { ...current.groups, workflows: defaultWorkflowGroups() } })
  }, [store.groups.workflows.length])

  useEffect(() => {
    if (!openRequest) return
    const target = store.workflows.find((item) => item.id === openRequest.workflowId)
    if (!target) return
    setWorkflowId(target.id)
    setActiveTab('execute')
    prepareNewProject(target)
    setWorkspaceOpen(true)
  }, [openRequest?.nonce])

  useEffect(() => {
    if (!workflow || !projectEditorOpen || !projectDraftDirty) return
    const revision = projectSaveRevision.current
    const timer = window.setTimeout(() => {
      void autoSaveProjectDraft(revision)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [workflow?.id, projectEditorOpen, projectDraftDirty, projectKey, projectTitle, projectFields])

  useEffect(() => {
    if (!workspaceOpen && !projectManagerOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (projectManagerOpen) {
        setProjectManagerOpen(false)
        return
      }
      if (!wizardDraft) setWorkspaceOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [workspaceOpen, projectManagerOpen, wizardDraft])

  useEffect(() => {
    if (!workflow || !selectedNode) return
    void loadResourceBody(selectedNode)
  }, [workflow?.id, selectedNode?.nodeKey, skills])

  useEffect(() => {
    setAttachmentPaths([])
    setCopyStep(0)
    const savedValue = currentNode
      ? activeProject?.nodeStates[currentNode.nodeKey]?.formValues.additionalInfo
      : ''
    setNodeAdditionalInfo(typeof savedValue === 'string' ? savedValue : '')
  }, [activeProject?.id, currentNode?.nodeKey])

  useEffect(() => {
    let cancelled = false
    if (!executionSkillNode) {
      setExecutionSkillContent('')
      setExecutionSkillDirectory('')
      setExecutionSkillLoading(false)
      return
    }

    const skillPath = executionSkill?.path || executionSkillNode.resourceRef?.locator || ''
    setExecutionSkillContent(executionSkill?.contentPreview || '')
    setExecutionSkillDirectory(skillDirectoryPath(skillPath))
    if (!skillPath || !window.formatFlow?.getSkillDirectorySnapshot) {
      setExecutionSkillLoading(false)
      return
    }

    setExecutionSkillLoading(true)
    void window.formatFlow.getSkillDirectorySnapshot(skillPath)
      .then((snapshot: SkillDirectorySnapshot) => {
        if (cancelled) return
        setExecutionSkillContent(snapshot.skillMd.content || executionSkill?.contentPreview || '')
        setExecutionSkillDirectory(snapshot.root || skillDirectoryPath(skillPath))
      })
      .catch(() => {
        if (!cancelled) setExecutionSkillContent(executionSkill?.contentPreview || '')
      })
      .finally(() => {
        if (!cancelled) setExecutionSkillLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [executionSkillNode?.nodeKey, executionSkillNode?.resourceRef?.locator, executionSkill?.path, executionSkill?.contentFingerprint])

  useEffect(() => {
    if (skills.length === 0) return
    const hydrated = hydrateImportedWorkflowResources(store.workflows, skills)
    if (hydrated === store.workflows || JSON.stringify(hydrated) === JSON.stringify(store.workflows)) return
    void commit((current) => ({
      ...current,
      workflows: hydrateImportedWorkflowResources(current.workflows, skills),
      resourceVersions: mergeImportedResourceVersions(current, skills)
    })).catch(() => undefined)
  }, [skills, store.workflows])

  function prepareNewProject(target: Workflow): void {
    projectSaveRevision.current += 1
    setProjectKey(newId('project'))
    setProjectTitle('')
    setProjectFields(defaultProjectFields(target))
    setDeliveryMode('copy-all')
    setActiveProjectStateId('')
    setProjectEditorOpen(true)
    setProjectDraftDirty(false)
    setProjectSaveStatus('idle')
  }

  function markProjectDraftDirty(): void {
    projectSaveRevision.current += 1
    setProjectDraftDirty(true)
    setProjectSaveStatus('pending')
  }

  function editSavedProject(state: ProjectFlowState): void {
    projectSaveRevision.current += 1
    setActiveProjectStateId(state.id)
    setProjectKey(state.projectId)
    setProjectTitle(state.projectTitle)
    setProjectFields(state.projectFields)
    setDeliveryMode((state.projectFields.deliveryMode as DeliveryMode) || 'copy-all')
    setProjectDraftDirty(false)
    setProjectSaveStatus('saved')
    setProjectEditorOpen(true)
  }

  function openSavedProject(state: ProjectFlowState): void {
    setActiveProjectStateId(state.id)
    setDeliveryMode((state.projectFields.deliveryMode as DeliveryMode) || 'copy-all')
    setProjectEditorOpen(false)
  }

  async function autoSaveProjectDraft(revision: number): Promise<void> {
    if (!workflow || !projectKey.trim()) return
    const projectId = projectKey.trim()
    const title = projectTitle.trim() || suggestedProjectTitle(projectFields)
    let savedStateId = `${projectId}:${workflow.id}:${workflow.templateVersion}`
    try {
      await commit((current) => {
        const existing = current.projectFlowStates.find(
          (state) => state.id === activeProjectStateId ||
            (state.projectId === projectId && state.workflowId === workflow.id && state.templateVersion === workflow.templateVersion)
        )
        const next = updateProjectSetup(workflow, existing, projectId, title, projectFields)
        savedStateId = next.id
        return {
          ...current,
          projectFlowStates: existing
            ? current.projectFlowStates.map((state) => (state.id === existing.id ? next : state))
            : [next, ...current.projectFlowStates]
        }
      })
      setActiveProjectStateId(savedStateId)
      setDeliveryMode((projectFields.deliveryMode as DeliveryMode) || 'copy-all')
      if (projectSaveRevision.current === revision) {
        setProjectDraftDirty(false)
        setProjectSaveStatus('saved')
      }
    } catch {
      if (projectSaveRevision.current === revision) setProjectSaveStatus('error')
    }
  }

  async function enterProjectExecution(): Promise<void> {
    if (!workflow) return
    if (projectDraftDirty || !activeProject) {
      await autoSaveProjectDraft(projectSaveRevision.current)
    }
    setProjectEditorOpen(false)
  }

  function changeDeliveryMode(mode: DeliveryMode): void {
    setDeliveryMode(mode)
    setProjectFields((current) => ({ ...current, deliveryMode: mode }))
    if (projectEditorOpen) {
      markProjectDraftDirty()
      return
    }
    if (activeProject) {
      void replaceProjectState({
        ...activeProject,
        projectFields: { ...activeProject.projectFields, deliveryMode: mode },
        updatedAt: nowIso()
      })
    }
  }

  function openWorkflowWorkspace(target: Workflow, tab: StudioTab): void {
    setWorkflowId(target.id)
    setActiveTab(tab)
    if (tab === 'execute') {
      prepareNewProject(target)
    }
    setWorkspaceOpen(true)
  }

  function openProjectManager(target: Workflow): void {
    setWorkflowId(target.id)
    setProjectManagerOpen(true)
  }

  async function createManagedProject(targetWorkflowId: string, title: string, topic: string): Promise<ProjectFlowState | undefined> {
    const target = store.workflows.find((item) => item.id === targetWorkflowId)
    if (!target || !title.trim() || !topic.trim()) return undefined
    const projectId = newId('project')
    const created = updateProjectSetup(
      target,
      undefined,
      projectId,
      title.trim(),
      { ...defaultProjectFields(target), topic: topic.trim() }
    )
    await commit((current) => ({ ...current, projectFlowStates: [created, ...current.projectFlowStates] }))
    setNotice(`已创建项目记录“${created.projectTitle}”。`)
    return created
  }

  async function updateManagedProject(state: ProjectFlowState, title: string, topic: string): Promise<ProjectFlowState | undefined> {
    if (!title.trim() || !topic.trim()) return undefined
    const updated: ProjectFlowState = {
      ...state,
      projectTitle: title.trim(),
      projectFields: { ...state.projectFields, topic: topic.trim() },
      updatedAt: nowIso()
    }
    await commit((current) => ({
      ...current,
      projectFlowStates: current.projectFlowStates.map((item) => item.id === state.id ? updated : item)
    }))
    if (activeProjectStateId === state.id) {
      setProjectTitle(updated.projectTitle)
      setProjectFields(updated.projectFields)
    }
    setNotice(`已更新项目记录“${updated.projectTitle}”。`)
    return updated
  }

  async function deleteManagedProject(state: ProjectFlowState): Promise<boolean> {
    const confirmed = window.confirm(
      `确认删除项目记录“${state.projectTitle}”？\n\n将删除 Format Flow Store 中的记录及 projects 目录中的受管 JSON；不会删除附件、论文文件、Prompt、Skill 或 SKILL.md。`
    )
    if (!confirmed) return false
    await commit((current) => ({
      ...current,
      projectFlowStates: current.projectFlowStates.filter((item) => item.id !== state.id)
    }))
    if (activeProjectStateId === state.id) {
      setActiveProjectStateId('')
      if (workflow) prepareNewProject(workflow)
    }
    setNotice(`已删除项目记录“${state.projectTitle}”及其受管 JSON；外部附件和成果文件未删除，可从已有备份恢复记录。`)
    return true
  }

  function openManagedProject(state: ProjectFlowState): void {
    const target = store.workflows.find((item) => item.id === state.workflowId) || store.workflows.find(
      (item) => item.templateKey === state.templateKey && item.templateVersion === state.templateVersion
    )
    if (!target) {
      setNotice('该项目引用的工作流已不存在，当前只能查看或修改项目资料。')
      return
    }
    setWorkflowId(target.id)
    setActiveProjectStateId(state.id)
    setDeliveryMode((state.projectFields.deliveryMode as DeliveryMode) || 'copy-all')
    setProjectEditorOpen(false)
    setActiveTab('execute')
    setWorkspaceOpen(true)
    setProjectManagerOpen(false)
  }

  async function updateWorkflowGroups(groups: GroupItem[]): Promise<void> {
    await commit((current) => ({ ...current, groups: { ...current.groups, workflows: groups } }))
  }

  async function renameWorkflowGroup(source: GroupItem, renamed: GroupItem, groups: GroupItem[]): Promise<void> {
    await commit((current) => ({
      ...current,
      groups: { ...current.groups, workflows: groups },
      workflows: current.workflows.map((item) => ({
        ...item,
        tags: Array.from(new Set(item.tags.map((tag) => tag === source.tag ? renamed.tag : tag)))
      }))
    }))
  }

  async function deleteWorkflowGroup(group: GroupItem): Promise<void> {
    if (!window.confirm(`确认删除工作流分组“${group.name}”？工作流本身不会删除。`)) return
    const removedTags = workflowGroupTags(group)
    let groups = removeWorkflowGroupById(workflowGroups, group.id)
    if (groups.length === 0) groups = [defaultWorkflowGroups().find((item) => item.tag === 'custom')!]
    await commit((current) => ({
      ...current,
      groups: { ...current.groups, workflows: groups },
      workflows: current.workflows.map((item) => ({ ...item, tags: item.tags.filter((tag) => !removedTags.includes(tag)) }))
    }))
    if (removedTags.includes(selectedWorkflowGroup)) setSelectedWorkflowGroup('all')
  }

  async function deleteSingleWorkflow(target: Workflow): Promise<void> {
    const projectCount = store.projectFlowStates.filter((state) => state.workflowId === target.id).length
    if (projectCount > 0) {
      setNotice(`无法删除“${target.title}”：仍有 ${projectCount} 个项目记录。请先在“项目记录”中删除这些项目。`)
      return
    }
    const confirmed = window.confirm(
      `确认删除工作流“${target.title}”？\n\n只删除当前工作流及其受管模板文件；不会删除 Prompt、Skill、SKILL.md 或其他工作流。此操作无法在软件内撤销。`
    )
    if (!confirmed) return
    const nextWorkflow = store.workflows.find((item) => item.id !== target.id)
    await commit((current) => removeUnusedWorkflow(current, target.id))
    if (workflowId === target.id) setWorkflowId(nextWorkflow?.id || '')
    setNotice(`已删除工作流“${target.title}”。`)
  }

  async function mutateWorkflow(mutation: (draft: Workflow) => Workflow): Promise<void> {
    if (!workflow) return
    let targetId = workflow.id
    await commit((current) => {
      const source = current.workflows.find((item) => item.id === workflow.id)
      if (!source) return current
      if (source.status === 'published') {
        const existingDraft = current.workflows.find(
          (item) => item.templateKey === source.templateKey && item.status === 'draft'
        )
        const draft = existingDraft || cloneAsDraft(source)
        targetId = draft.id
        return {
          ...current,
          workflows: existingDraft
            ? current.workflows.map((item) => (item.id === existingDraft.id ? mutation(existingDraft) : item))
            : [mutation(draft), ...current.workflows]
        }
      }
      return {
        ...current,
        workflows: current.workflows.map((item) => (item.id === source.id ? mutation(item) : item))
      }
    })
    setWorkflowId(targetId)
  }

  async function loadResourceBody(node: WorkflowNode): Promise<void> {
    setResourceLoading(true)
    try {
      if (node.type === 'prompt') {
        const content = store.prompts.find((prompt) => prompt.id === node.refId)?.content || ''
        setResourceContent(content)
        setResourceOriginalContent(content)
      } else if (node.type === 'skill') {
        const skill = resolveSkill(node, skills)
        if (!skill) {
          setResourceContent('')
          setResourceOriginalContent('')
        }
        else {
          const snapshot = window.formatFlow?.getSkillDirectorySnapshot
            ? await window.formatFlow.getSkillDirectorySnapshot(skill.path)
            : undefined
          const content = snapshot?.skillMd.content || skill.contentPreview || ''
          setResourceContent(content)
          setResourceOriginalContent(content)
        }
      } else if (node.type === 'mcp') {
        const mcp = store.mcpServers.find((item) => item.id === node.refId)
        const content = mcp ? JSON.stringify(mcp, null, 2) : ''
        setResourceContent(content)
        setResourceOriginalContent(content)
      } else {
        const content = JSON.stringify(node, null, 2)
        setResourceContent(content)
        setResourceOriginalContent(content)
      }
    } catch (error) {
      setResourceContent('')
      setNotice(error instanceof Error ? error.message : '无法读取资源全文。')
    } finally {
      setResourceLoading(false)
    }
  }

  async function saveResourceVersion(): Promise<void> {
    if (!workflow || !selectedNode?.resourceRef) return
    if (selectedNode.type === 'prompt') {
      const prompt = store.prompts.find((item) => item.id === selectedNode.refId)
      if (!prompt) return
      const nextVersion = prompt.version + 1
      const nextFingerprint = sha256Text(resourceContent)
      let nextWorkflowId = workflow.id
      await commit((current) => {
        const workflows = updateDraftResourceReference(current.workflows, workflow, selectedNode, {
          ...selectedNode.resourceRef!,
          expectedVersion: String(nextVersion),
          fingerprint: nextFingerprint
        })
        nextWorkflowId = workflows.find((item) => item.templateKey === workflow.templateKey && item.status === 'draft')?.id || workflow.id
        return {
          ...current,
          prompts: current.prompts.map((item) =>
            item.id === prompt.id ? { ...item, content: resourceContent, version: nextVersion, updatedAt: nowIso() } : item
          ),
          resourceVersions: appendResourceSnapshot(current, selectedNode.resourceRef!, prompt.content),
          workflows
        }
      })
      setWorkflowId(nextWorkflowId)
      setNotice('已保存新的 Prompt 资源版本；已有工作流和项目仍锁定原资源。')
      return
    }

    if (selectedNode.type === 'skill') {
      const skill = resolveSkill(selectedNode, skills)
      if (!skill) return
      const shouldSnapshotCurrentFile = skillResourceMatchesReference(selectedNode.resourceRef, skill)
      if (!window.formatFlow?.writeSkillTextFile) {
        setNotice('浏览器预览模式不会写入本地 SKILL.md。')
        return
      }
      const result = await window.formatFlow.writeSkillTextFile({
        skillPath: skill.path,
        relativePath: 'SKILL.md',
        content: resourceContent
      })
      if (!result.ok) {
        setNotice(result.message)
        return
      }
      const fingerprint = sha256Text(resourceContent)
      let nextWorkflowId = workflow.id
      await commit((current) => {
        const workflows = updateDraftResourceReference(current.workflows, workflow, selectedNode, {
          ...selectedNode.resourceRef!,
          expectedVersion: 'sha256',
          fingerprint,
          locator: skill.path
        })
        nextWorkflowId = workflows.find((item) => item.templateKey === workflow.templateKey && item.status === 'draft')?.id || workflow.id
        return {
          ...current,
          resourceVersions: shouldSnapshotCurrentFile
            ? appendResourceSnapshot(current, selectedNode.resourceRef!, resourceOriginalContent)
            : current.resourceVersions,
          workflows
        }
      })
      setWorkflowId(nextWorkflowId)
      await refreshSkills()
      setNotice('已保存新的 SKILL.md 资源版本；旧快照和项目资源锁未改变。')
    }
  }

  async function installSourceSkills(): Promise<void> {
    if (!window.formatFlow?.installSkillZip) {
      setNotice('浏览器预览模式不能安装 ZIP；请在桌面版中执行。')
      return
    }
    const result = await window.formatFlow.installSkillZip()
    setNotice(result.message)
    if (result.ok) await refreshSkills()
  }

  async function deliverCurrentNode(): Promise<void> {
    if (!workflow || !activeProject || !currentNode) return
    const payload = buildNodePayload(
      currentNode,
      store,
      skills,
      attachmentPaths,
      nodeAdditionalInfo,
      executionSkillDirectory
    )
    if (deliveryMode === 'copy-all') {
      const result = attachmentPaths.length
        ? await copyWorkflowPayload(payload, attachmentPaths)
        : await writeWorkflowClipboard(payload)
      setNotice(result.message)
      if (!result.ok) return
    } else if (deliveryMode === 'browser-plugin') {
      const result = await queueWorkflowBrowserTask({
        text: payload,
        attachmentPaths,
        submit: false,
        workflowId: workflow.id,
        projectId: activeProject.projectId,
        nodeKey: currentNode.nodeKey
      })
      setNotice(result.message)
      if (!result.ok) return
    } else {
      if (copyStep === 0) {
        const result = await writeWorkflowClipboard(payload)
        setNotice(result.message)
        if (result.ok) setCopyStep(1)
        return
      }
      const attachmentIndex = copyStep - 1
      if (attachmentIndex < attachmentPaths.length) {
        const result = await copyWorkflowAttachmentFiles([attachmentPaths[attachmentIndex]])
        setNotice(result.message)
        if (result.ok) setCopyStep((value) => value + 1)
        return
      }
    }

    const projectWithNodeInput = withNodeAdditionalInfo(activeProject, currentNode.nodeKey, nodeAdditionalInfo)
    const nextState = recordDelivery(workflow, projectWithNodeInput, deliveryMode, payload, attachmentPaths)
    await replaceProjectState(nextState)
    setAttachmentPaths([])
    setNodeAdditionalInfo('')
    setCopyStep(0)
    setReviewChecklist({})
    setReviewReason('')
    setReviewAttachmentPaths([])
  }

  async function finishOneByOneDelivery(): Promise<void> {
    if (!workflow || !activeProject || !currentNode) return
    const payload = buildNodePayload(
      currentNode,
      store,
      skills,
      attachmentPaths,
      nodeAdditionalInfo,
      executionSkillDirectory
    )
    const projectWithNodeInput = withNodeAdditionalInfo(activeProject, currentNode.nodeKey, nodeAdditionalInfo)
    await replaceProjectState(recordDelivery(workflow, projectWithNodeInput, deliveryMode, payload, attachmentPaths))
    setAttachmentPaths([])
    setNodeAdditionalInfo('')
    setCopyStep(0)
  }

  async function submitCurrentReview(): Promise<void> {
    if (!workflow || !activeProject || !currentNode || currentNode.type !== 'review') return
    const result = submitReview(workflow, activeProject, reviewChecklist, reviewReason, reviewAttachmentPaths)
    if (result.error) {
      setNotice(result.error)
      return
    }
    await replaceProjectState(result.state)
    setReviewChecklist({})
    setReviewReason('')
    setReviewAttachmentPaths([])
    setNotice(result.passed ? '审查通过，已写入检查点并进入下一节点。' : '审查未通过；历史已保存，新清单已清空并停留在本节点。')
  }

  async function replaceProjectState(next: ProjectFlowState): Promise<void> {
    await commit((current) => ({
      ...current,
      projectFlowStates: current.projectFlowStates.map((state) => (state.id === next.id ? next : state))
    }))
  }

  async function completeCurrentControl(): Promise<void> {
    if (!workflow || !activeProject) return
    await replaceProjectState(completeControlNode(workflow, activeProject))
  }

  function viewProjectNode(nodeKey: string): void {
    if (!workflow || !activeProject) return
    const node = workflow.nodes.find((item) => item.nodeKey === nodeKey)
    if (!node) return
    const role = projectNodeNavigationRole(workflow, activeProject, nodeKey)
    if (!role) {
      setNotice('只能查看已经完成的节点，或返回项目的最新节点。')
      return
    }
    setViewedNodeKey(role === 'current' ? '' : nodeKey)
    setAttachmentPaths([])
    setNodeAdditionalInfo('')
    setCopyStep(0)
    setReviewChecklist({})
    setReviewReason('')
    setReviewAttachmentPaths([])
    setProjectEditorOpen(false)
    setNotice(role === 'current' ? `已返回最新节点“${node.title}”。` : role === 'latest' ? `正在查看最新完成节点“${node.title}”；项目状态未改变。` : `正在查看已完成节点“${node.title}”；项目状态未改变。`)
  }

  async function publishDraft(): Promise<void> {
    if (!workflow || workflow.status !== 'draft') return
    const issues = validateWorkflow(workflow)
    const errors = issues.filter((issue) => issue.severity === 'error')
    if (errors.length > 0) {
      setNotice(`无法保存工作流更新：${errors[0].message}`)
      return
    }
    const version = normalizePublishVersion(workflow.templateVersion)
    const timestamp = nowIso()
    await commit((current) => ({
      ...current,
      workflows: current.workflows.map((item) =>
        item.id === workflow.id
          ? {
              ...item,
              id: `${item.templateKey}@${version}`,
              templateVersion: version,
              status: 'published',
              changeLog: [...item.changeLog, { version, publishedAt: timestamp, summary: '保存工作流更新。' }],
              updatedAt: timestamp
            }
          : item
      )
    }))
    setWorkflowId(`${workflow.templateKey}@${version}`)
    setNotice('已保存工作流更新。')
  }

  async function cloneWorkflow(): Promise<void> {
    if (!workflow) return
    const clone = {
      ...deepClone(workflow),
      id: newId('workflow'),
      templateKey: newId('template'),
      templateVersion: '0.1.0-draft',
      status: 'draft' as const,
      title: `${workflow.title} 副本`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      changeLog: []
    }
    await commit((current) => ({ ...current, workflows: [clone, ...current.workflows] }))
    setWorkflowId(clone.id)
    setActiveTab('compose')
    setWorkspaceOpen(true)
  }

  async function exportWorkflow(target?: Workflow): Promise<void> {
    const exportTarget = target || workflow
    if (!exportTarget) return
    if (!window.formatFlow?.exportTextFile) {
      downloadJsonInBrowser(`${exportTarget.templateKey}.json`, exportTarget)
      setNotice('已在浏览器预览模式导出模板 JSON。')
      return
    }
    const result = await window.formatFlow.exportTextFile({
      fileName: `${exportTarget.templateKey}.json`,
      content: `${JSON.stringify(exportTarget, null, 2)}\n`,
      filters: [{ name: 'Format Flow 工作流', extensions: ['json'] }]
    })
    setNotice(result.message)
  }

  async function exportWorkflowBlueprints(templateKeys: string[]): Promise<void> {
    const selected = templateImporterBlueprints.filter((blueprint) => templateKeys.includes(blueprint.templateKey))
    if (selected.length === 0) {
      setNotice('请至少选择一个中间模板。')
      return
    }
    const catalog = createWorkflowBlueprintCatalog(selected, 'Format Flow 中间模板')
    if (!window.formatFlow?.exportTextFile) {
      downloadJsonInBrowser('format-flow-intermediate-templates.json', catalog)
      setNotice(`已导出 ${selected.length} 个中间模板。`)
      return
    }
    const result = await window.formatFlow.exportTextFile({
      fileName: 'format-flow-intermediate-templates.json',
      content: `${JSON.stringify(catalog, null, 2)}\n`,
      filters: [{ name: 'Format Flow 中间模板', extensions: ['json'] }]
    })
    setNotice(result.message)
  }

  async function addImportedWorkflowTemplates(
    candidates: Workflow[],
    sourceLabel: string,
    options: { createIndependent?: boolean } = {}
  ): Promise<void> {
    for (const candidate of candidates) {
      const errors = validateWorkflow(candidate).filter((issue) => issue.severity === 'error')
      if (errors.length > 0) throw new Error(`${candidate.title || '未命名工作流'}：${errors[0].message}`)
    }

    const importedIds: string[] = []
    let skipped = 0
    await commit((current) => {
      const selection = options.createIndependent
        ? { imports: candidates, skipped: [] }
        : selectNewWorkflowImports(current.workflows, candidates)
      skipped += selection.skipped.length
      const usedIds = new Set(current.workflows.map((item) => item.id))
      const usedTitles = new Set(current.workflows.map((item) => item.title))
      const additions: Workflow[] = []
      for (const candidate of selection.imports) {
        const timestamp = nowIso()
        const independent = Boolean(options.createIndependent)
        let id = independent ? newId('workflow') : isSourcePackageWorkflow(candidate) ? candidate.id : newId('workflow-import')
        if (usedIds.has(id)) id = newId('workflow-import')
        usedIds.add(id)
        const title = independent ? uniqueWorkflowTitle(candidate.title, usedTitles) : candidate.title
        usedTitles.add(title)
        const imported: Workflow = {
          ...deepClone(candidate),
          id,
          templateKey: independent ? newId('workflow-template') : candidate.templateKey,
          title,
          status: isSourcePackageWorkflow(candidate) ? candidate.status : 'draft',
          sourcePackage: candidate.sourcePackage
            ? { ...candidate.sourcePackage, origin: 'imported', importedAt: candidate.sourcePackage.importedAt || timestamp }
            : undefined,
          createdAt: candidate.createdAt || timestamp,
          updatedAt: timestamp
        }
        additions.push(imported)
        importedIds.push(imported.id)
      }
      return additions.length > 0 ? { ...current, workflows: [...additions, ...current.workflows] } : current
    })

    if (importedIds.length > 0) setWorkflowId(importedIds[0])
    setNotice(options.createIndependent
      ? `${sourceLabel}：已生成 ${importedIds.length} 条新工作流。`
      : `${sourceLabel}：已添加 ${importedIds.length} 条工作流${skipped > 0 ? `，跳过 ${skipped} 条已存在模板` : ''}。`)
  }

  function openTemplateImporter(): void {
    setTemplateImporterBlueprints([...PREDEFINED_WORKFLOW_BLUEPRINTS])
    setTemplateImporterLabel('通用中间模板')
    setTemplateImporterSkills([])
    setTemplateImporterPackageName('')
    setTemplateImporterPackagePath('')
    setTemplateImporterMetadataPath('')
    setSelectedBlueprintKeys([])
    setSelectedTemplateSkillIds([])
    setTemplateImporterOpen(true)
  }

  async function selectAndPrepareWorkflowSkills(): Promise<void> {
    if (!window.formatFlow?.prepareWorkflowSkillPackage) {
      setNotice('浏览器预览模式不能整理本地 Skill 目录。')
      return
    }
    const result = await window.formatFlow.prepareWorkflowSkillPackage()
    setNotice(result.message)
    if (!result.ok || !result.metadata) return
    const preparedSkills = skillsFromWorkflowPackageMetadata(result.metadata)
    setTemplateImporterSkills(preparedSkills)
    setTemplateImporterPackageName(result.metadata.name)
    setTemplateImporterPackagePath(result.metadata.installedPackageDirectory)
    setTemplateImporterMetadataPath(result.metadataPath || '')
    const defaultSkillIds = defaultWorkflowSkillSelection(preparedSkills)
    const defaultSkills = preparedSkills.filter((skill) => defaultSkillIds.includes(skill.id))
    setSelectedTemplateSkillIds(defaultSkillIds)
    setSelectedBlueprintKeys(templateImporterBlueprints
      .filter((blueprint) => resolveWorkflowBlueprint(blueprint, defaultSkills).canGenerate)
      .map((blueprint) => blueprint.templateKey))
    await refreshSkills()
  }

  async function importTemplateFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      try {
        const blueprints = parseWorkflowBlueprintCatalog(parsed)
        setTemplateImporterBlueprints(blueprints)
        setTemplateImporterLabel(file.name)
        setSelectedBlueprintKeys([])
        setTemplateImporterOpen(true)
        setNotice(`已载入中间模板“${file.name}”，请选择要生成的工作流。`)
      } catch (blueprintError) {
        if (isBlueprintDocument(parsed)) throw blueprintError
        const candidates = parseWorkflowImportDocument(parsed)
        await addImportedWorkflowTemplates(candidates, file.name)
        setTemplateImporterOpen(false)
        if (candidates.length === 1) {
          setActiveTab('compose')
          setWorkspaceOpen(true)
        }
      }
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : '无效模板'}`)
    }
  }

  async function generateSelectedBlueprints(): Promise<void> {
    const selected = templateImporterBlueprints.filter((blueprint) => selectedBlueprintKeys.includes(blueprint.templateKey))
    if (selected.length === 0) {
      setNotice('请至少选择一个可生成的工作流模板。')
      return
    }
    const selectedSkills = templateImporterSkills.filter((skill) => selectedTemplateSkillIds.includes(skill.id))
    if (selectedSkills.length === 0) {
      setNotice('请先选择用户指定的 Skill 目录并生成本次 JSON 元数据。')
      return
    }
    try {
      const timestamp = nowIso()
      const workflows = selected.map((blueprint) => buildWorkflowFromBlueprint(
        blueprint,
        selectedSkills,
        timestamp,
        {
          workflowTitle: blueprint.skillSelection === 'all-numbered' ? templateImporterPackageName : undefined,
          sourcePackageName: templateImporterPackageName,
          sourcePackagePath: templateImporterPackagePath
        }
      ))
      await addImportedWorkflowTemplates(workflows, templateImporterPackageName || templateImporterLabel, { createIndependent: true })
      setTemplateImporterOpen(false)
    } catch (error) {
      setNotice(`生成失败：${error instanceof Error ? error.message : '无法生成工作流'}`)
    }
  }

  function beginWizard(): void {
    const next = createWorkflow({
      templateKey: newId('template'),
      templateVersion: '0.1.0-draft',
      title: '新工作流模板',
      tags: selectedWorkflowGroup === 'all' ? ['custom'] : [selectedWorkflowGroup],
      formSchema: [
        { key: 'topic', label: '主题', type: 'textarea', required: true },
        { key: 'deliveryMode', label: '交付方式', type: 'select', required: true, defaultValue: 'copy-all', options: Object.entries(deliveryModeLabels).map(([value, label]) => ({ value, label })) }
      ]
    })
    setWizardDraft(next)
    setWizardStep(1)
  }

  async function finishWizard(): Promise<void> {
    if (!wizardDraft) return
    await commit((current) => ({ ...current, workflows: [wizardDraft, ...current.workflows] }))
    setWorkflowId(wizardDraft.id)
    setActiveTab('compose')
    setWorkspaceOpen(true)
    setWizardDraft(null)
    setWizardStep(0)
    setNotice('工作流已创建，可继续维护并保存更新。')
  }

  async function addNode(kind: 'prompt' | 'skill' | 'mcp' | 'review' | 'adapter' | 'wait'): Promise<void> {
    if (!workflow) return
    await mutateWorkflow((draft) => {
      const index = draft.nodes.length
      let node: WorkflowNode
      if (kind === 'prompt') node = nodeFromPrompt(store.prompts[0] || createPrompt(), index)
      else if (kind === 'skill') node = nodeFromSkill(skills[0] || placeholderSkill(), index)
      else if (kind === 'mcp') node = nodeFromMcp(store.mcpServers[0] || createMcpServer(), index)
      else {
        node = {
          id: newId(kind),
          nodeKey: `${kind}-${Date.now()}`,
          type: kind,
          title: kind === 'review' ? '人工审查' : kind === 'adapter' ? '交付物适配' : '等待外部状态',
          summary: '',
          tags: [kind],
          inputs: {},
          outputs: [],
          requiresReview: kind === 'review',
          stageKey: draft.stages[0]?.stageKey || 'main',
          order: index + 1,
          applicabilityRules: [],
          reviewChecklist: kind === 'review' ? standardReviewItems : undefined,
          position: { x: (index % 8) * 260, y: Math.floor(index / 8) * 170 }
        }
      }
      node.stageKey = draft.stages[0]?.stageKey || 'main'
      const nodes = [...draft.nodes, node].map((item, itemIndex) => ({ ...item, order: itemIndex + 1 }))
      setSelectedNodeKey(node.nodeKey)
      return { ...draft, nodes, edges: rebuildLinearEdges(nodes), updatedAt: nowIso() }
    })
  }

  async function batchGenerateReviews(): Promise<void> {
    if (!workflow) return
    await mutateWorkflow((draft) => {
      const selected = new Set(selectedNodeKeys)
      const nodes: WorkflowNode[] = []
      for (const node of draft.nodes) {
        nodes.push(node)
        if (node.type !== 'skill' || !selected.has(node.nodeKey)) continue
        const next = draft.nodes[draft.nodes.indexOf(node) + 1]
        if (next?.type === 'review') continue
        nodes.push({
          id: newId('review'),
          nodeKey: `${node.nodeKey}-review`,
          type: 'review',
          title: `审查 ${node.title}`,
          summary: '通过后保存检查点并前进；不通过时停留本节点。',
          tags: ['review'],
          inputs: {},
          outputs: [],
          requiresReview: true,
          stageKey: node.stageKey,
          order: 0,
          applicabilityRules: [],
          reviewChecklist: standardReviewItems,
          checkpointKey: `${node.nodeKey}-approved`,
          position: { x: 0, y: 0 }
        })
      }
      nodes.forEach((node, index) => { node.order = index + 1 })
      return { ...draft, nodes, edges: rebuildLinearEdges(nodes), updatedAt: nowIso() }
    })
  }

  async function batchMoveStage(stageKey: string): Promise<void> {
    if (!workflow || !stageKey) return
    const selected = new Set(selectedNodeKeys)
    await mutateWorkflow((draft) => ({
      ...draft,
      nodes: draft.nodes.map((node) => (selected.has(node.nodeKey) ? { ...node, stageKey } : node)),
      updatedAt: nowIso()
    }))
  }

  async function deleteWorkflowStage(stageKey: string): Promise<void> {
    if (!workflow) return
    if (workflow.stages.length <= 1) {
      setNotice('工作流至少需要保留一个阶段。')
      return
    }
    const stage = workflow.stages.find((item) => item.stageKey === stageKey)
    const fallback = workflow.stages.find((item) => item.stageKey !== stageKey)
    if (!stage || !fallback) return
    const nodeCount = workflow.nodes.filter((node) => node.stageKey === stageKey).length
    if (nodeCount > 0 && !window.confirm(`“${stage.title}”中有 ${nodeCount} 个节点。删除阶段后，这些节点将移动到“${fallback.title}”。是否继续？`)) return
    await mutateWorkflow((draft) => ({
      ...draft,
      stages: draft.stages
        .filter((item) => item.stageKey !== stageKey)
        .map((item, index) => ({ ...item, order: index + 1 })),
      nodes: draft.nodes.map((node) => node.stageKey === stageKey ? { ...node, stageKey: fallback.stageKey } : node),
      updatedAt: nowIso()
    }))
  }

  async function deleteWorkflowNode(nodeKey: string): Promise<void> {
    if (!workflow) return
    const node = workflow.nodes.find((item) => item.nodeKey === nodeKey)
    if (!node || !window.confirm(`删除节点“${node.title}”？关联到该节点的检查点也会删除。`)) return
    const remaining = workflow.nodes.filter((item) => item.nodeKey !== nodeKey)
    await mutateWorkflow((draft) => {
      const nodes = draft.nodes
        .filter((item) => item.nodeKey !== nodeKey)
        .map((item, index) => ({ ...item, order: index + 1 }))
      return {
        ...draft,
        nodes,
        edges: rebuildLinearEdges(nodes),
        checkpointBlueprint: draft.checkpointBlueprint.filter((checkpoint) => checkpoint.afterNodeKey !== nodeKey),
        updatedAt: nowIso()
      }
    })
    setSelectedNodeKeys((current) => current.filter((key) => key !== nodeKey))
    setSelectedNodeKey(remaining[0]?.nodeKey || '')
  }

  async function addCheckpoint(): Promise<void> {
    if (!workflow || workflow.nodes.length === 0) {
      setNotice('请先添加节点，再创建检查点。')
      return
    }
    const afterNodeKey = selectedNode?.nodeKey || orderedNodes[orderedNodes.length - 1]?.nodeKey || ''
    await mutateWorkflow((draft) => ({
      ...draft,
      checkpointBlueprint: [...draft.checkpointBlueprint, {
        checkpointKey: newId('checkpoint'),
        title: '新检查点',
        afterNodeKey,
        requiredArtifacts: []
      }],
      updatedAt: nowIso()
    }))
  }

  async function deleteCheckpoint(checkpointKey: string): Promise<void> {
    if (!workflow) return
    const checkpoint = workflow.checkpointBlueprint.find((item) => item.checkpointKey === checkpointKey)
    if (!checkpoint || !window.confirm(`删除检查点“${checkpoint.title}”？`)) return
    await mutateWorkflow((draft) => ({
      ...draft,
      checkpointBlueprint: draft.checkpointBlueprint.filter((item) => item.checkpointKey !== checkpointKey),
      updatedAt: nowIso()
    }))
  }

  if (!workflow) {
    return (
      <section className="panel workflow-studio empty-workflow">
        <h2>工作流</h2>
        <p>当前没有工作流。可以选择中间模板并按当前 Skill 目录生成，也可以导入已有模板文件或自行创建。</p>
        <div className="import-strip">
          <button className="primary-action" type="button" onClick={openTemplateImporter}>导入模板</button>
          <button type="button" onClick={() => setTemplateExporterOpen(true)}>导出模板</button>
          <button type="button" onClick={beginWizard}>创建工作流</button>
        </div>
        {templateImporterOpen && (
          <WorkflowTemplateImporter
            blueprints={templateImporterBlueprints}
            sourceLabel={templateImporterLabel}
            preparedSkills={templateImporterSkills}
            packageName={templateImporterPackageName}
            packagePath={templateImporterPackagePath}
            metadataPath={templateImporterMetadataPath}
            selectedKeys={selectedBlueprintKeys}
            onSelectedKeys={setSelectedBlueprintKeys}
            selectedSkillIds={selectedTemplateSkillIds}
            onSelectedSkillIds={setSelectedTemplateSkillIds}
            onBlueprints={setTemplateImporterBlueprints}
            onFile={importTemplateFile}
            onPrepareSkills={selectAndPrepareWorkflowSkills}
            onCancel={() => setTemplateImporterOpen(false)}
            onGenerate={() => void generateSelectedBlueprints()}
          />
        )}
        {templateExporterOpen && (
          <WorkflowTemplateExporter
            workflows={store.workflows}
            blueprints={templateImporterBlueprints}
            currentWorkflowId=""
            onCancel={() => setTemplateExporterOpen(false)}
            onExportWorkflow={(targetId) => void exportWorkflow(store.workflows.find((item) => item.id === targetId))}
            onExportBlueprints={async (keys) => {
              await exportWorkflowBlueprints(keys)
              setTemplateExporterOpen(false)
            }}
          />
        )}
      </section>
    )
  }

  const versions = store.workflows.filter((item) => item.templateKey === workflow.templateKey && item.id !== workflow.id)

  return (
    <section className="panel library-layout workflow-library">
      <SharedResourceGroupManager
        title="工作流分组"
        detail="分组可排序，也可建立小类"
        allLabel="全部工作流"
        allCount={store.workflows.length}
        groups={workflowGroups}
        selectedTag={selectedWorkflowGroup}
        countForTag={(tag) => store.workflows.filter((item) => item.tags.includes(tag)).length}
        countForTags={(tags) => store.workflows.filter((item) => item.tags.some((tag) => tags.includes(tag))).length}
        onSelect={setSelectedWorkflowGroup}
        onChange={updateWorkflowGroups}
        onRename={renameWorkflowGroup}
        onDelete={deleteWorkflowGroup}
      />

      <main className="library-main workflow-library-main">
        <SharedPanelHeader
          title="工作流管理"
          detail={`${visibleWorkflows.length} / ${store.workflows.length} 个工作流`}
        />
        <div className="toolbar-grid">
          <SharedSearchBox query={overviewQuery} setQuery={setOverviewQuery} placeholder="搜索名称、说明或标签" />
          <div className="group-selection-note">
            当前分组：{selectedWorkflowGroup === 'all'
              ? '全部工作流'
              : findWorkflowGroupByTag(workflowGroups, selectedWorkflowGroup)?.name || selectedWorkflowGroup}
          </div>
          <button className="primary-action" type="button" onClick={beginWizard}>创建工作流</button>
        </div>
        <div className="import-strip workflow-library-actions">
          <button type="button" onClick={openTemplateImporter}>导入模板</button>
          <button type="button" onClick={() => setTemplateExporterOpen(true)}>导出模板</button>
          <span className="workflow-project-summary">{store.projectFlowStates.length} 个项目记录</span>
        </div>

        <div className="resource-card-grid tile-grid workflow-card-grid" aria-live="polite">
            {visibleWorkflows.map((item) => {
              const projects = store.projectFlowStates.filter(
                (state) => state.workflowId === item.id && state.templateVersion === item.templateVersion
              )
              return (
                <article className="resource-card workflow-info-card" key={item.id}>
                  <div className="workflow-card-title">
                    <h3>{item.title}</h3>
                    <p>{item.description || '暂未填写工作流说明。'}</p>
                  </div>
                  <div className="workflow-card-stats">
                    <span><strong>{item.stages.length}</strong> 阶段</span>
                    <span><strong>{item.nodes.length}</strong> 节点</span>
                    <span><strong>{item.checkpointBlueprint.length}</strong> 检查点</span>
                    <span><strong>{projects.length}</strong> 项目</span>
                  </div>
                  <footer>
                    <div className="workflow-card-actions">
                      <button type="button" onClick={() => openProjectManager(item)}>项目记录</button>
                      <button type="button" onClick={() => openWorkflowWorkspace(item, 'compose')}>维护工作流</button>
                      <button className="primary-action" type="button" onClick={() => openWorkflowWorkspace(item, 'execute')}>打开执行</button>
                      <button className="danger-action" type="button" onClick={() => void deleteSingleWorkflow(item)}>删除工作流</button>
                    </div>
                  </footer>
                </article>
              )
            })}
            {visibleWorkflows.length === 0 && (
              <div className="workflow-overview-empty">
                <h3>当前分组没有匹配的工作流</h3>
                <p>切换分组、调整搜索条件，或创建一个新工作流。</p>
                <button type="button" onClick={() => { setOverviewQuery(''); setSelectedWorkflowGroup('all') }}>显示全部</button>
              </div>
            )}
        </div>
      </main>

      {workspaceOpen && (
        <div className="workflow-workbench-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkspaceOpen(false) }}>
          <section className="panel workflow-studio workflow-workbench-modal" role="dialog" aria-modal="true" aria-label={`${workflow.title} 工作台`} onMouseDown={(event) => event.stopPropagation()}>
      <header className="workflow-studio-header">
        <div>
          {workflow.tags.includes('migrated-v2') && <span className="legacy-migration-badge">Store v2 已迁移</span>}
          <h2>{workflow.title}</h2>
          <p>{workflow.description}</p>
        </div>
        <div className="workflow-header-actions">
          <button type="button" onClick={() => openProjectManager(workflow)}>项目记录</button>
          <button type="button" onClick={() => void cloneWorkflow()}>克隆</button>
          <button type="button" onClick={() => void exportWorkflow()}>导出</button>
          {workflow.status === 'draft' && <button className="primary-action" type="button" onClick={() => void publishDraft()}>保存工作流更新</button>}
          <button className="workflow-workbench-close" type="button" onClick={() => setWorkspaceOpen(false)} aria-label="关闭工作台">关闭</button>
        </div>
      </header>

      <div className="workflow-studio-tabs" role="tablist">
        <button className={activeTab === 'compose' ? 'active' : ''} onClick={() => setActiveTab('compose')}>编排</button>
        <button className={activeTab === 'resources' ? 'active' : ''} onClick={() => setActiveTab('resources')}>资源</button>
        <button className={activeTab === 'execute' ? 'active' : ''} onClick={() => setActiveTab('execute')}>执行</button>
      </div>

      {activeTab === 'compose' && (
        <div className="workflow-compose-grid">
          <aside className="workflow-side-card">
            <h3>基本信息</h3>
            <label>模板名称<input value={workflow.title} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, title: event.target.value, updatedAt: nowIso() }))} /></label>
            <label>模板说明<textarea value={workflow.description} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, description: event.target.value, updatedAt: nowIso() }))} /></label>
            <div className="meta-grid">
              <span>内部标识：{workflow.templateKey}</span>
            </div>
            <div className="workflow-section-heading"><div><h3>阶段</h3><small>节点按阶段分区；删除阶段时会先确认节点去向。</small></div></div>
            <div className="workflow-stage-editor-list">
              {workflow.stages.map((stage) => (
                <section className="workflow-stage-editor" key={stage.stageKey}>
                  <div className="workflow-stage-editor-heading"><strong>阶段 {stage.order}</strong><span>{workflow.nodes.filter((node) => node.stageKey === stage.stageKey).length} 节点</span></div>
                  <label>名称<input value={stage.title} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, stages: draft.stages.map((item) => item.stageKey === stage.stageKey ? { ...item, title: event.target.value } : item), updatedAt: nowIso() }))} /></label>
                  <label>说明<textarea value={stage.description} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, stages: draft.stages.map((item) => item.stageKey === stage.stageKey ? { ...item, description: event.target.value } : item), updatedAt: nowIso() }))} /></label>
                  <button className="danger-action compact-action" type="button" disabled={workflow.stages.length <= 1} onClick={() => void deleteWorkflowStage(stage.stageKey)}>删除阶段</button>
                </section>
              ))}
            </div>
            <button type="button" onClick={() => void mutateWorkflow((draft) => ({ ...draft, stages: [...draft.stages, { stageKey: newId('stage'), title: '新阶段', description: '', order: draft.stages.length + 1 }] }))}>＋ 阶段</button>
            <div className="workflow-section-heading"><div><h3>检查点</h3><small>记录完成指定节点后的交付状态。</small></div><button type="button" onClick={() => void addCheckpoint()}>＋ 添加</button></div>
            <div className="workflow-checkpoint-editor-list">
              {workflow.checkpointBlueprint.map((checkpoint, index) => (
                <section className="workflow-checkpoint-editor" key={checkpoint.checkpointKey}>
                  <strong>检查点 {index + 1}</strong>
                  <label>名称<input value={checkpoint.title} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, checkpointBlueprint: draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, title: event.target.value } : item), updatedAt: nowIso() }))} /></label>
                  <label>完成节点后<select value={checkpoint.afterNodeKey} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, checkpointBlueprint: draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, afterNodeKey: event.target.value } : item), updatedAt: nowIso() }))}>{orderedNodes.map((node) => <option key={node.nodeKey} value={node.nodeKey}>{node.order}. {node.title}</option>)}</select></label>
                  <label>必需交付物（每行一项）<textarea value={checkpoint.requiredArtifacts.join('\n')} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, checkpointBlueprint: draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, requiredArtifacts: linesFromText(event.target.value) } : item), updatedAt: nowIso() }))} /></label>
                  <button className="danger-action compact-action" type="button" onClick={() => void deleteCheckpoint(checkpoint.checkpointKey)}>删除检查点</button>
                </section>
              ))}
              {workflow.checkpointBlueprint.length === 0 && <p className="hint">尚未添加检查点。</p>}
            </div>
          </aside>

          <main className="workflow-compose-main">
            <div className="workflow-toolbar">
              <input placeholder="搜索 nodeKey、标题或资源" value={nodeQuery} onChange={(event) => setNodeQuery(event.target.value)} />
              <div className="segmented">
                {(['tree', 'canvas', 'compact'] as LayoutMode[]).map((mode) => <button key={mode} className={layoutMode === mode ? 'active' : ''} onClick={() => setLayoutMode(mode)}>{mode === 'tree' ? '阶段树' : mode === 'canvas' ? '完整画布' : '紧凑列表'}</button>)}
              </div>
              <span>{workflow.nodes.length} 节点 · {workflow.checkpointBlueprint.length} 检查点</span>
            </div>
            <div className="node-add-row">
              {(['prompt', 'skill', 'mcp', 'review', 'adapter', 'wait'] as const).map((kind) => <button key={kind} type="button" onClick={() => void addNode(kind)}>＋ {kind}</button>)}
            </div>
            <NodeLayout
              mode={layoutMode}
              workflow={workflow}
              query={nodeQuery}
              selectedNodeKey={selectedNode?.nodeKey || ''}
              selectedNodeKeys={selectedNodeKeys}
              onSelect={setSelectedNodeKey}
              onToggle={(nodeKey) => setSelectedNodeKeys((current) => current.includes(nodeKey) ? current.filter((key) => key !== nodeKey) : [...current, nodeKey])}
            />
            {selectedNode && (
              <div className="node-contract-editor">
                <div><strong>节点设置</strong><span className={`node-kind kind-${selectedNode.type}`}>{selectedNode.type}</span></div>
                <label>稳定节点标识<input readOnly value={selectedNode.nodeKey} /></label>
                <label>显示名称<input value={selectedNode.title} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, nodes: draft.nodes.map((node) => node.nodeKey === selectedNode.nodeKey ? { ...node, title: event.target.value } : node) }))} /></label>
                <label>所属阶段<select value={selectedNode.stageKey} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, nodes: draft.nodes.map((node) => node.nodeKey === selectedNode.nodeKey ? { ...node, stageKey: event.target.value } : node), updatedAt: nowIso() }))}>{workflow.stages.map((stage) => <option key={stage.stageKey} value={stage.stageKey}>{stage.order}. {stage.title}</option>)}</select></label>
                <label>节点说明<textarea value={selectedNode.summary} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, nodes: draft.nodes.map((node) => node.nodeKey === selectedNode.nodeKey ? { ...node, summary: event.target.value } : node), updatedAt: nowIso() }))} /></label>
                <label>声明交付物（每行一项）<textarea value={selectedNode.outputs.join('\n')} onChange={(event) => void mutateWorkflow((draft) => ({ ...draft, nodes: draft.nodes.map((node) => node.nodeKey === selectedNode.nodeKey ? { ...node, outputs: linesFromText(event.target.value) } : node), updatedAt: nowIso() }))} /></label>
                <button className="danger-action" type="button" onClick={() => void deleteWorkflowNode(selectedNode.nodeKey)}>删除当前节点</button>
              </div>
            )}
            <div className="bulk-bar">
              <strong>已选 {selectedNodeKeys.length}</strong>
              <button onClick={() => void batchGenerateReviews()}>批量生成 Review</button>
              <select defaultValue="" onChange={(event) => { void batchMoveStage(event.target.value); event.target.value = '' }}><option value="">批量移动到阶段…</option>{workflow.stages.map((stage) => <option value={stage.stageKey} key={stage.stageKey}>{stage.title}</option>)}</select>
              <button onClick={() => setSelectedNodeKeys([])}>清空</button>
            </div>
          </main>

          <aside className="workflow-side-card diagnostics-card">
            <h3>工作流检查</h3>
            {validation.length === 0 ? <p className="ok-text">没有发现契约问题。</p> : validation.map((issue) => <div key={`${issue.code}-${issue.nodeKey || ''}`} className={`diagnostic ${issue.severity}`}><strong>{issue.code}</strong><span>{issue.message}</span></div>)}
            <h3>更新差异</h3>
            {versions.map((version) => {
              const diff = diffWorkflowTemplates(version, workflow)
              return <div className="version-diff" key={version.id}><strong>{new Date(version.updatedAt).toLocaleString()} 的历史更新</strong><span>+{diff.addedNodeKeys.length} / −{diff.removedNodeKeys.length} / 改 {diff.changedNodeKeys.length}</span></div>
            })}
            {versions.length === 0 && <p className="hint">暂无可比较的历史更新。</p>}
          </aside>
        </div>
      )}

      {activeTab === 'resources' && (
        <div className="workflow-resource-grid">
          <aside className="workflow-side-card">
            <h3>模板资源绑定</h3>
            <p>{resourceStats.bound}/{resourceStats.total} 个 Skill 节点已绑定 SHA-256。通用中间模板可以读取任意用户指定目录中的全部编号 Skill。</p>
            <button className="primary-action" type="button" onClick={() => void installSourceSkills()}>添加或更新 Skill ZIP</button>
            <small>整理或重新安装 Skill 后，可按 01-xx、02-xx 编号目录，再使用同一中间模板重新生成工作流。</small>
            <div className="resource-node-list">{orderedNodes.filter((node) => node.resourceRef).map((node) => <button key={node.nodeKey} className={selectedNode?.nodeKey === node.nodeKey ? 'active' : ''} onClick={() => setSelectedNodeKey(node.nodeKey)}><strong>{node.title}</strong><small>{node.resourceRef?.fingerprint.slice(0, 12) || '未绑定'}</small></button>)}</div>
          </aside>
          <main className="resource-editor-main">
            {selectedNode?.resourceRef ? (
              <>
                <header>
                  <div><span className="eyebrow">{selectedNode.resourceRef.type}</span><h3>{selectedNode.title}</h3></div>
                  <div className="resource-editor-actions">
                    {selectedSkill && editSkill && <button type="button" onClick={() => editSkill(selectedSkill)}>打开完整 Skill 编辑器</button>}
                    <button disabled={resourceLoading} className="primary-action" onClick={() => void saveResourceVersion()}>
                      {selectedNode.type === 'skill' ? '保存并绑定新 Skill 版本' : '保存为新资源版本'}
                    </button>
                  </div>
                </header>
                <ResourceContract resource={selectedNode.resourceRef} projectLocks={store.projectFlowStates.filter((state) => Boolean(state.resourceLocks[selectedNode.resourceRef!.resourceKey])).length} />
                {selectedSkill && (
                  <p className={`resource-sync-note${selectedSkillMatchesLock ? ' is-current' : ' is-changed'}`}>
                    Skills → 工作流 Skill 分组与这里编辑的是同一个本地目录。
                    {selectedSkillMatchesLock
                      ? ' 当前文件与本工作流资源锁一致。'
                      : ' 当前本地文件已变化；已有项目仍使用旧锁，点击“保存并绑定新 Skill 版本”只会让新的工作流草稿采用当前内容。'}
                  </p>
                )}
                <textarea className="full-resource-editor" value={resourceContent} onChange={(event) => setResourceContent(event.target.value)} spellCheck={false} />
                <p className="hint">这是用户明确的资源编辑操作：先保存旧资源快照，再写入新资源。工作流普通更新不会触碰正文；已有工作流和项目继续使用其资源锁。</p>
              </>
            ) : <div className="empty-state"><h3>当前节点没有外部资源</h3><p>Review、Adapter、Wait 和 Route 只保存控制契约。</p></div>}
          </main>
          <aside className="workflow-side-card">
            <h3>资源版本</h3>
            {store.resourceVersions.filter((version) => version.resourceKey === selectedNode?.resourceRef?.resourceKey).map((version) => <div className="resource-version" key={version.id}><strong>{version.version}</strong><code>{version.fingerprint.slice(0, 16)}</code><small>{new Date(version.createdAt).toLocaleString()}</small></div>)}
            <h3>隔离保证</h3>
            <ul><li>模板只保存 resourceKey、版本、指纹和 locator。</li><li>项目上下文不写入原 Prompt 或 SKILL.md。</li><li>已有项目不会自动提升资源版本。</li><li>重命名显示标题不改变 nodeKey。</li></ul>
          </aside>
        </div>
      )}

      {activeTab === 'execute' && (
        <div className="workflow-execute-grid">
          <aside className="workflow-side-card project-list">
            <h3>项目</h3>
            <button className={!activeProject && projectEditorOpen ? 'active' : ''} onClick={() => prepareNewProject(workflow)}>＋ 新项目</button>
            {projectStates.map((state) => <button key={state.id} className={activeProject?.id === state.id ? 'active' : ''} onClick={() => openSavedProject(state)}><strong>{state.projectTitle}</strong><small>{state.status} · {state.currentNodeKey || '完成'}{state.legacyMigration ? ' · v2 迁移' : ''}</small></button>)}
            {store.projectFlowStates.some((state) => state.templateKey === workflow.templateKey && state.workflowId !== workflow.id) && <p className="hint">历史工作流更新所创建的项目会隔离保存，不会互相覆盖。</p>}
          </aside>

          <main className="execution-main">
            {projectEditorOpen ? (
              <div className="project-form-card">
                <span className="eyebrow">快捷调用直接打开这里</span>
                <h3>项目资料</h3>
                <p>无需创建或提交首表单。填写项目名称和主题后会自动保存；交付方式进入节点后选择。</p>
                <div className={`project-autosave-status save-${projectSaveStatus}`}>
                  <strong>{projectSaveStatus === 'pending' ? '正在自动保存…' : projectSaveStatus === 'saved' ? '项目已自动保存' : projectSaveStatus === 'error' ? '自动保存失败' : '填写后自动保存'}</strong>
                  <span>位置：{paths?.projectDirectory || paths?.defaultDataDirectories.projects || '设置 → 数据保存位置 → 工作流项目'}</span>
                </div>
                <label>项目名称<input value={projectTitle} onChange={(event) => { setProjectTitle(event.target.value); markProjectDraftDirty() }} /></label>
                <label>主题<textarea value={String(projectFields.topic || '')} onChange={(event) => { setProjectFields((current) => ({ ...current, topic: event.target.value })); markProjectDraftDirty() }} /></label>
                <button className="primary-action" disabled={projectSaveStatus === 'idle' || projectSaveStatus === 'pending' || projectSaveStatus === 'error' || !projectTitle.trim() || !String(projectFields.topic || '').trim()} onClick={() => void enterProjectExecution()}>进入当前节点</button>
              </div>
            ) : activeProject ? (
              <>
                <header className="execution-project-header"><div><span className="eyebrow">{String(activeProject.projectFields.topic || '未填写主题')}</span><h3>{activeProject.projectTitle}</h3></div><div className="execution-project-actions"><button type="button" onClick={() => editSavedProject(activeProject)}>编辑项目资料</button><strong>{activeProject.status}</strong></div></header>
                {activeProject.legacyMigration && <LegacyMigrationCard migration={activeProject.legacyMigration} />}
                {currentNode ? (
                  <div className="current-node-card">
                    <div className="current-node-heading"><span className={`node-kind kind-${currentNode.type}`}>{currentNode.type}</span><div><h3>{currentNode.title}</h3><code>{currentNode.nodeKey}</code></div>{isViewingHistoricalNode && <span className="historical-node-badge">历史查看</span>}</div>
                    {isViewingHistoricalNode ? (
                      <HistoricalNodeView
                        node={currentNode}
                        project={activeProject}
                        projectStatus={projectStatusLabel(activeProject.status)}
                        skillPreview={currentNode.type === 'skill' ? {
                          name: executionSkill?.name || currentNode.resourceRef?.resourceKey.replace(/^skill:/, '') || currentNode.title,
                          directory: executionSkillDirectory || skillDirectoryPath(executionSkill?.path || currentNode.resourceRef?.locator || ''),
                          content: executionSkillContent,
                          loading: executionSkillLoading
                        } : undefined}
                        latestNode={latestProjectNode?.nodeKey !== currentNode.nodeKey ? latestProjectNode : undefined}
                        onLatest={() => latestProjectNode && viewProjectNode(latestProjectNode.nodeKey)}
                      />
                    ) : currentNode.type === 'review' ? (
                      <ReviewNodeEditor
                        node={currentNode}
                        project={activeProject}
                        sourceSkillName={executionSkill?.title || executionSkill?.name || previousSkillNode?.title || '上一 Skill'}
                        outputOutline={extractSkillOutputOutline(executionSkillContent, previousSkillNode?.outputs || [])}
                        outlineLoading={executionSkillLoading}
                        checklist={reviewChecklist}
                        reason={reviewReason}
                        attachmentPaths={reviewAttachmentPaths}
                        onChecklist={setReviewChecklist}
                        onReason={setReviewReason}
                        onFiles={(event) => {
                          const selectedPaths = Array.from(event.target.files || [])
                            .map((file) => window.formatFlow?.getPathForFile?.(file) || file.name)
                            .filter(Boolean)
                          setReviewAttachmentPaths((current) => Array.from(new Set([...current, ...selectedPaths])))
                          event.target.value = ''
                        }}
                        onRemoveAttachment={(filePath) => setReviewAttachmentPaths((current) => current.filter((item) => item !== filePath))}
                        onSubmit={() => void submitCurrentReview()}
                      />
                    ) : ['adapter', 'wait', 'route'].includes(currentNode.type) ? (
                      <div className="control-node"><p>{currentNode.summary}</p><button className="primary-action" onClick={() => void completeCurrentControl()}>{currentNode.type === 'wait' ? '外部状态已就绪，继续' : '确认控制节点并继续'}</button></div>
                    ) : (
                      <DeliveryStepper
                        mode={deliveryMode}
                        onMode={changeDeliveryMode}
                        payload={buildNodePayload(currentNode, store, skills, attachmentPaths, nodeAdditionalInfo, executionSkillDirectory)}
                        attachmentPaths={attachmentPaths}
                        onFiles={(event) => setAttachmentPaths(Array.from(event.target.files || []).map((file) => window.formatFlow?.getPathForFile?.(file) || file.name).filter(Boolean))}
                        additionalInfo={nodeAdditionalInfo}
                        onAdditionalInfo={setNodeAdditionalInfo}
                        skillPreview={currentNode.type === 'skill' ? {
                          name: executionSkill?.name || currentNode.resourceRef?.resourceKey.replace(/^skill:/, '') || currentNode.title,
                          directory: executionSkillDirectory || skillDirectoryPath(executionSkill?.path || currentNode.resourceRef?.locator || ''),
                          content: executionSkillContent,
                          loading: executionSkillLoading
                        } : undefined}
                        copyStep={copyStep}
                        onDeliver={() => void deliverCurrentNode()}
                        onFinishOneByOne={() => void finishOneByOneDelivery()}
                      />
                    )}
                  </div>
                ) : <div className="complete-card"><h3>项目流程已完成</h3><p>全部节点状态、审查历史、检查点与交付记录已保留。</p></div>}
              </>
            ) : <div className="empty-state"><h3>项目尚未保存</h3><p>返回项目资料并开始填写。</p></div>}
          </main>

          <aside className="workflow-side-card progress-card">
            <h3>项目进度</h3>
            {activeProject ? <>
              <ProgressSummary workflow={workflow} project={activeProject} viewedNodeKey={viewedNodeKey} onSelect={viewProjectNode} />
              <h3>检查点</h3>
              {activeProject.checkpoints.length ? activeProject.checkpoints.map((checkpoint) => <div className="checkpoint" key={`${checkpoint.checkpointKey}-${checkpoint.createdAt}`}><strong>{checkpoint.checkpointKey}</strong><small>{new Date(checkpoint.createdAt).toLocaleString()}</small></div>) : <p>尚无检查点。</p>}
            </> : <p>开始填写项目资料后自动显示项目进度。</p>}
          </aside>
        </div>
      )}

          </section>
        </div>
      )}

      {projectManagerOpen && (
        <ProjectHistoryModal
          key={workflow.templateKey}
          workflow={workflow}
          workflows={store.workflows}
          projects={store.projectFlowStates}
          projectDirectory={paths?.projectDirectory || paths?.defaultDataDirectories.projects || ''}
          onClose={() => setProjectManagerOpen(false)}
          onCreate={createManagedProject}
          onUpdate={updateManagedProject}
          onDelete={deleteManagedProject}
          onOpen={openManagedProject}
        />
      )}

      {wizardDraft && wizardStep > 0 && (
        <WizardModal draft={wizardDraft} step={wizardStep} prompts={store.prompts} skills={skills} mcpServers={store.mcpServers} onDraft={setWizardDraft} onStep={setWizardStep} onCancel={() => { setWizardDraft(null); setWizardStep(0) }} onFinish={() => void finishWizard()} />
      )}
      {templateImporterOpen && (
        <WorkflowTemplateImporter
          blueprints={templateImporterBlueprints}
          sourceLabel={templateImporterLabel}
          preparedSkills={templateImporterSkills}
          packageName={templateImporterPackageName}
          packagePath={templateImporterPackagePath}
          metadataPath={templateImporterMetadataPath}
          selectedKeys={selectedBlueprintKeys}
          onSelectedKeys={setSelectedBlueprintKeys}
          selectedSkillIds={selectedTemplateSkillIds}
          onSelectedSkillIds={setSelectedTemplateSkillIds}
          onBlueprints={setTemplateImporterBlueprints}
          onFile={importTemplateFile}
          onPrepareSkills={selectAndPrepareWorkflowSkills}
          onCancel={() => setTemplateImporterOpen(false)}
          onGenerate={() => void generateSelectedBlueprints()}
        />
      )}
      {templateExporterOpen && (
        <WorkflowTemplateExporter
          workflows={store.workflows}
          blueprints={templateImporterBlueprints}
          currentWorkflowId={workflow.id}
          onCancel={() => setTemplateExporterOpen(false)}
          onExportWorkflow={async (targetId) => {
            const target = store.workflows.find((item) => item.id === targetId)
            if (!target) return
            await exportWorkflow(target)
            setTemplateExporterOpen(false)
          }}
          onExportBlueprints={async (keys) => {
            await exportWorkflowBlueprints(keys)
            setTemplateExporterOpen(false)
          }}
        />
      )}
    </section>
  )
}

export function WorkflowTemplateExporter({ workflows, blueprints, currentWorkflowId, onCancel, onExportWorkflow, onExportBlueprints }: { workflows: Workflow[]; blueprints: WorkflowBlueprint[]; currentWorkflowId: string; onCancel: () => void; onExportWorkflow: (workflowId: string) => Promise<void> | void; onExportBlueprints: (templateKeys: string[]) => Promise<void> | void }): JSX.Element {
  const initialId = workflows.some((item) => item.id === currentWorkflowId) ? currentWorkflowId : workflows[0]?.id || ''
  const [mode, setMode] = useState<'workflow' | 'blueprint'>(workflows.length > 0 ? 'workflow' : 'blueprint')
  const [selectedId, setSelectedId] = useState(initialId)
  const [selectedBlueprintKeys, setSelectedBlueprintKeys] = useState(blueprints.map((item) => item.templateKey))
  const [query, setQuery] = useState('')
  const [exporting, setExporting] = useState(false)
  const visibleWorkflows = workflows.filter((item) => {
    const normalized = query.trim().toLocaleLowerCase()
    return !normalized || `${item.title} ${item.description} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(normalized)
  })
  const visibleBlueprints = blueprints.filter((item) => {
    const normalized = query.trim().toLocaleLowerCase()
    return !normalized || `${item.title} ${item.stageTitles.join(' ')}`.toLocaleLowerCase().includes(normalized)
  })

  async function submit(): Promise<void> {
    if (exporting || (mode === 'workflow' ? !selectedId : selectedBlueprintKeys.length === 0)) return
    setExporting(true)
    try {
      if (mode === 'workflow') await onExportWorkflow(selectedId)
      else await onExportBlueprints(selectedBlueprintKeys)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="workflow-template-exporter" role="dialog" aria-modal="true" aria-label="导出模板">
        <header><div><h2>导出模板</h2><p>选择一个工作流，保存为可再次导入的 JSON 模板。</p></div><button type="button" onClick={onCancel}>关闭</button></header>
        <div className="workflow-template-export-tabs">
          <button className={mode === 'workflow' ? 'active' : ''} type="button" disabled={workflows.length === 0} onClick={() => { setMode('workflow'); setQuery('') }}>工作流 JSON</button>
          <button className={mode === 'blueprint' ? 'active' : ''} type="button" disabled={blueprints.length === 0} onClick={() => { setMode('blueprint'); setQuery('') }}>中间模板 JSON</button>
        </div>
        <label>搜索模板<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或阶段" /></label>
        <div className="workflow-template-export-list">
          {mode === 'workflow' && visibleWorkflows.map((item) => <label key={item.id} className={selectedId === item.id ? 'is-selected' : ''}>
            <input type="radio" name="workflow-export-target" value={item.id} checked={selectedId === item.id} onChange={() => setSelectedId(item.id)} />
            <span><strong>{item.title}</strong><small>{item.stages.length} 阶段 · {item.nodes.length} 节点 · {item.checkpointBlueprint.length} 检查点</small></span>
          </label>)}
          {mode === 'blueprint' && visibleBlueprints.map((item) => <label key={item.templateKey} className={selectedBlueprintKeys.includes(item.templateKey) ? 'is-selected' : ''}>
            <input type="checkbox" checked={selectedBlueprintKeys.includes(item.templateKey)} onChange={() => setSelectedBlueprintKeys((current) => current.includes(item.templateKey) ? current.filter((key) => key !== item.templateKey) : [...current, item.templateKey])} />
            <span><strong>{item.title}</strong><small>{item.stageTitles.length} 阶段 · {blueprintNodeRuleSummary(item)} · {blueprintCheckpointRuleSummary(item)}</small></span>
          </label>)}
          {mode === 'workflow' && visibleWorkflows.length === 0 && <p>没有匹配的工作流。</p>}
          {mode === 'blueprint' && visibleBlueprints.length === 0 && <p>没有匹配的中间模板。</p>}
        </div>
        <footer><span>{mode === 'workflow' ? '工作流 JSON 保留完整编排，可直接再次导入。' : '中间模板 JSON 可配合重新整理后的编号 Skill 目录生成新工作流。'}</span><div><button type="button" onClick={onCancel}>取消</button><button className="primary-action" type="button" disabled={(mode === 'workflow' ? !selectedId : selectedBlueprintKeys.length === 0) || exporting} onClick={() => void submit()}>{exporting ? '正在导出…' : '导出所选模板'}</button></div></footer>
      </section>
    </div>
  )
}

export type WorkflowTemplateImporterProps = { blueprints: WorkflowBlueprint[]; sourceLabel: string; preparedSkills: SkillItem[]; packageName: string; packagePath: string; metadataPath: string; selectedKeys: string[]; onSelectedKeys: (keys: string[]) => void; selectedSkillIds: string[]; onSelectedSkillIds: (ids: string[]) => void; onBlueprints: (blueprints: WorkflowBlueprint[]) => void; onFile: (event: ChangeEvent<HTMLInputElement>) => void; onPrepareSkills: () => Promise<void>; onCancel: () => void; onGenerate: () => void }

type WorkflowRulePreset = 'step-quality-gate' | 'stage-gate' | 'external-collaboration' | 'lightweight'

function parsePositiveOrders(value: string): number[] {
  return Array.from(new Set(value.split(/[，,、;；\s]+/).map(Number).filter((item) => Number.isSafeInteger(item) && item > 0))).sort((a, b) => a - b)
}

function parsePositiveCounts(value: string): number[] {
  return value.split(/[，,、;；\s]+/).map(Number).filter((item) => Number.isSafeInteger(item) && item > 0)
}

function blueprintStageRuleSummary(blueprint: WorkflowBlueprint): string {
  const rule = blueprint.stageRules
  if (rule.assignment === 'counts') return `按阶段数量分配（${rule.skillCounts.join(' / ') || '未填写'}）`
  if (rule.assignment === 'breakpoints') return `按 Skill 断点分段（${rule.breakAfterSkillOrders.join(' / ') || '未填写'}）`
  return rule.assignment === 'first-stage' ? '全部放入首阶段' : '按目录顺序均衡分配阶段'
}

function blueprintNodeRuleSummary(blueprint: WorkflowBlueprint): string {
  const rule = blueprint.nodeRules
  const review = rule.reviewMode === 'after-each-skill' ? '每个 Skill 后审查'
    : rule.reviewMode === 'stage-end' ? '阶段末审查'
      : rule.reviewMode === 'selected-skills' ? `指定 Skill 后审查（${rule.reviewAfterSkillOrders.join('、') || '未填写'}）`
        : '不自动审查'
  return `${review}${rule.waitAfterStage ? '，阶段末等待确认' : ''}`
}

function blueprintCheckpointRuleSummary(blueprint: WorkflowBlueprint): string {
  const rule = blueprint.checkpointRules
  return rule.mode === 'after-review' ? '审查后检查点'
    : rule.mode === 'after-each-skill' ? '每个 Skill 后检查点'
      : rule.mode === 'stage-end' ? '阶段末检查点'
        : rule.mode === 'workflow-end' ? '流程结束检查点'
          : rule.mode === 'selected-skills' ? `指定 Skill 后检查点（${rule.afterSkillOrders.join('、') || '未填写'}）`
            : '无自动检查点'
}

export function WorkflowTemplateImporter({ blueprints, sourceLabel, preparedSkills, packageName, packagePath, metadataPath, selectedKeys, onSelectedKeys, selectedSkillIds, onSelectedSkillIds, onBlueprints, onFile, onPrepareSkills, onCancel, onGenerate }: WorkflowTemplateImporterProps): JSX.Element {
  const [skillQuery, setSkillQuery] = useState('')
  const [previewKey, setPreviewKey] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualStages, setManualStages] = useState('执行流程')
  const defaultStageRules = defaultBlueprintStageRules()
  const defaultNodeRules = defaultBlueprintNodeRules()
  const defaultCheckpointRules = defaultBlueprintCheckpointRules()
  const [manualStageAssignment, setManualStageAssignment] = useState<WorkflowBlueprint['stageRules']['assignment']>(defaultStageRules.assignment)
  const [manualStageCounts, setManualStageCounts] = useState('')
  const [manualStageBreakpoints, setManualStageBreakpoints] = useState('')
  const [manualReviewMode, setManualReviewMode] = useState<WorkflowBlueprint['nodeRules']['reviewMode']>(defaultNodeRules.reviewMode)
  const [manualReviewOrders, setManualReviewOrders] = useState('')
  const [manualReviewChecklistLabel, setManualReviewChecklistLabel] = useState(defaultNodeRules.reviewChecklistLabel)
  const [manualWaitAfterStage, setManualWaitAfterStage] = useState(defaultNodeRules.waitAfterStage)
  const [manualCheckpointMode, setManualCheckpointMode] = useState<WorkflowBlueprint['checkpointRules']['mode']>(defaultCheckpointRules.mode)
  const [manualCheckpointOrders, setManualCheckpointOrders] = useState('')
  const [manualCheckpointTitlePattern, setManualCheckpointTitlePattern] = useState(defaultCheckpointRules.titlePattern)
  const [manualCheckpointArtifacts, setManualCheckpointArtifacts] = useState<WorkflowBlueprint['checkpointRules']['requiredArtifacts']>(defaultCheckpointRules.requiredArtifacts)
  const [manualError, setManualError] = useState('')
  const templateFileInputRef = useRef<HTMLInputElement>(null)
  const selectedSkills = preparedSkills.filter((skill) => selectedSkillIds.includes(skill.id))
  const resolutions = blueprints.map((blueprint) => resolveWorkflowBlueprint(blueprint, selectedSkills))
  const selectableKeys = selectedSkills.length > 0
    ? resolutions.filter((item) => item.canGenerate).map((item) => item.blueprint.templateKey)
    : []
  const selectedReadyCount = selectedKeys.filter((key) => selectableKeys.includes(key)).length
  const allReadySelected = selectableKeys.length > 0 && selectableKeys.every((key) => selectedKeys.includes(key))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (manualOpen) setManualOpen(false)
      else onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [manualOpen, onCancel])

  function toggle(key: string): void {
    onSelectedKeys(selectedKeys.includes(key) ? selectedKeys.filter((item) => item !== key) : [...selectedKeys, key])
  }

  const visibleSkills = preparedSkills.filter((skill) => {
    const query = skillQuery.trim().toLocaleLowerCase()
    if (!query) return true
    const sequence = workflowSkillDirectorySequence(skill)
    return `${sequence?.directoryName || ''} ${skill.name} ${skill.title}`.toLocaleLowerCase().includes(query)
  }).sort((left, right) => {
    const a = workflowSkillDirectorySequence(left)
    const b = workflowSkillDirectorySequence(right)
    return (a?.order ?? Number.MAX_SAFE_INTEGER) - (b?.order ?? Number.MAX_SAFE_INTEGER) || (a?.directoryName || left.name).localeCompare(b?.directoryName || right.name, 'zh-CN')
  })

  function toggleSkill(id: string): void {
    onSelectedSkillIds(selectedSkillIds.includes(id) ? selectedSkillIds.filter((item) => item !== id) : [...selectedSkillIds, id])
  }

  function addManualBlueprint(): void {
    const title = manualTitle.trim()
    const stageTitles = manualStages.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    const stageCounts = parsePositiveCounts(manualStageCounts)
    const stageBreakpoints = parsePositiveOrders(manualStageBreakpoints)
    const reviewOrders = parsePositiveOrders(manualReviewOrders)
    const checkpointOrders = parsePositiveOrders(manualCheckpointOrders)
    if (!title || stageTitles.length === 0) return
    if (manualStageAssignment === 'counts' && stageCounts.length !== Math.max(0, stageTitles.length - 1)) {
      setManualError(`按数量分配时，只填写前 ${Math.max(0, stageTitles.length - 1)} 个阶段的 Skill 数量，末阶段自动接收剩余项。`)
      return
    }
    if (manualStageAssignment === 'breakpoints' && stageBreakpoints.length < Math.max(0, stageTitles.length - 1)) {
      setManualError(`按断点分段时，请填写前 ${Math.max(0, stageTitles.length - 1)} 个阶段的结束 Skill 序号。`)
      return
    }
    if (manualStageAssignment === 'breakpoints' && stageBreakpoints.length > Math.max(0, stageTitles.length - 1)) {
      setManualError(`按断点分段时，只需填写前 ${Math.max(0, stageTitles.length - 1)} 个阶段的结束序号；末阶段自动接收剩余 Skill。`)
      return
    }
    const selectedSkillCount = selectedSkills.length
    const invalidSelectedOrder = [...reviewOrders, ...checkpointOrders].find((value) => selectedSkillCount > 0 && value > selectedSkillCount)
    if (invalidSelectedOrder) {
      setManualError(`Skill 序号 ${invalidSelectedOrder} 超出本次已选择的 ${selectedSkillCount} 个 Skill。`)
      return
    }
    const invalidBreakpoint = stageBreakpoints.find((value) => selectedSkillCount > 0 && value >= selectedSkillCount)
    if (invalidBreakpoint) {
      setManualError(`阶段断点 ${invalidBreakpoint} 必须小于本次已选择的 Skill 总数 ${selectedSkillCount}。`)
      return
    }
    if (manualStageAssignment === 'counts' && selectedSkillCount > 0 && stageCounts.slice(0, Math.max(0, stageTitles.length - 1)).reduce((sum, value) => sum + value, 0) >= selectedSkillCount) {
      setManualError('前置阶段已用完全部 Skill，末阶段将为空；请减少阶段数量。')
      return
    }
    if (manualReviewMode === 'selected-skills' && reviewOrders.length === 0) {
      setManualError('指定 Skill 后审查时，必须填写至少一个 Skill 序号。')
      return
    }
    if (manualCheckpointMode === 'selected-skills' && checkpointOrders.length === 0) {
      setManualError('指定 Skill 后检查点时，必须填写至少一个 Skill 序号。')
      return
    }
    const templateKey = `manual-numbered-${Date.now().toString(36)}`
    const blueprint: WorkflowBlueprint = {
      templateKey,
      legacyTemplateKeys: [],
      title,
      family: 'custom',
      researchType: '',
      skillSelection: 'all-numbered',
      skillNames: [],
      orderStrategy: 'skill-directory-prefix',
      sourceHint: '用户指定 Skill 包',
      stageTitles,
      stageRules: {
        assignment: manualStageAssignment,
        skillCounts: stageCounts,
        breakAfterSkillOrders: stageBreakpoints
      },
      nodeRules: {
        reviewMode: manualReviewMode,
        reviewAfterSkillOrders: reviewOrders,
        reviewChecklistLabel: manualReviewChecklistLabel.trim() || defaultNodeRules.reviewChecklistLabel,
        waitAfterStage: manualWaitAfterStage
      },
      checkpointRules: {
        mode: manualCheckpointMode,
        afterSkillOrders: checkpointOrders,
        titlePattern: manualCheckpointTitlePattern.trim() || defaultCheckpointRules.titlePattern,
        requiredArtifacts: manualCheckpointArtifacts
      }
    }
    onBlueprints([...blueprints, blueprint])
    onSelectedKeys([...selectedKeys, templateKey])
    setManualTitle('')
    setManualStages('执行流程')
    setManualStageAssignment(defaultStageRules.assignment)
    setManualStageCounts('')
    setManualStageBreakpoints('')
    setManualReviewMode(defaultNodeRules.reviewMode)
    setManualReviewOrders('')
    setManualReviewChecklistLabel(defaultNodeRules.reviewChecklistLabel)
    setManualWaitAfterStage(defaultNodeRules.waitAfterStage)
    setManualCheckpointMode(defaultCheckpointRules.mode)
    setManualCheckpointOrders('')
    setManualCheckpointTitlePattern(defaultCheckpointRules.titlePattern)
    setManualCheckpointArtifacts(defaultCheckpointRules.requiredArtifacts)
    setManualError('')
    setManualOpen(false)
    setPreviewKey(templateKey)
  }

  function applyManualPreset(preset: WorkflowRulePreset): void {
    setManualStageAssignment('balanced')
    setManualStageCounts('')
    setManualStageBreakpoints('')
    setManualReviewOrders('')
    setManualCheckpointOrders('')
    setManualError('')
    if (preset === 'step-quality-gate') {
      setManualReviewMode('after-each-skill')
      setManualWaitAfterStage(false)
      setManualCheckpointMode('after-review')
      setManualCheckpointArtifacts('trigger-output')
      setManualCheckpointTitlePattern('通过：{skill}')
    } else if (preset === 'stage-gate') {
      setManualReviewMode('stage-end')
      setManualWaitAfterStage(false)
      setManualCheckpointMode('stage-end')
      setManualCheckpointArtifacts('stage-outputs')
      setManualCheckpointTitlePattern('{stage}完成')
    } else if (preset === 'external-collaboration') {
      setManualReviewMode('stage-end')
      setManualWaitAfterStage(true)
      setManualCheckpointMode('stage-end')
      setManualCheckpointArtifacts('stage-outputs')
      setManualCheckpointTitlePattern('{stage}确认完成')
    } else {
      setManualReviewMode('none')
      setManualWaitAfterStage(false)
      setManualCheckpointMode('workflow-end')
      setManualCheckpointArtifacts('workflow-outputs')
      setManualCheckpointTitlePattern('{node}完成')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !manualOpen) onCancel() }}>
      <section className="workflow-template-importer" role="dialog" aria-modal="true" aria-label="导入模板" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><h2>导入模板</h2><p>整理 Skill 后，可预览目录并手动选择本次工作流节点。</p></div>
          <button type="button" onClick={onCancel}>关闭</button>
        </header>
        <div className="workflow-template-importer-tools">
          <div>
            <strong>{sourceLabel}</strong>
            {preparedSkills.length > 0 ? (
              <span>
                工作流名称：{packageName}<br />
                已识别 {preparedSkills.length} 个 Skill<br />
                托管 Skill 包：{packagePath}<br />
                JSON 元数据：{metadataPath}
              </span>
            ) : <span>尚未选择本次工作流的 Skill 目录。</span>}
          </div>
          <button className="primary-action" type="button" onClick={() => void onPrepareSkills()}>选择并整理 Skill 目录</button>
          <button type="button" onClick={() => templateFileInputRef.current?.click()}>选择模板文件</button>
          <input ref={templateFileInputRef} type="file" accept="application/json,.json" onChange={onFile} hidden aria-label="模板 JSON 文件" />
          <button type="button" onClick={() => setManualOpen(true)}>手动创建中间模板</button>
        </div>
        <div className="workflow-template-resolution-summary">
          <span><strong>{preparedSkills.length}</strong> 已列出</span>
          <span><strong>{selectedSkills.length}</strong> 本次选择</span>
          {preparedSkills.length > 0 ? <><span><strong>{selectableKeys.length}</strong> 可生成</span><span><strong>{resolutions.length - selectableKeys.length}</strong> 需整理</span></> : <span>等待选择目录</span>}
        </div>
        {preparedSkills.length > 0 && <section className="workflow-skill-inventory">
          <header>
            <strong>Skill 目录</strong>
            <input value={skillQuery} onChange={(event) => setSkillQuery(event.target.value)} placeholder="搜索目录或 Skill 名称" />
            <button type="button" onClick={() => onSelectedSkillIds(Array.from(new Set([...selectedSkillIds, ...visibleSkills.map((skill) => skill.id)])))}>选择当前列表</button>
            <button type="button" onClick={() => onSelectedSkillIds([])}>清空</button>
          </header>
          <div>
            {visibleSkills.map((skill) => {
              const sequence = workflowSkillDirectorySequence(skill)
              return <label key={skill.id}>
                <input type="checkbox" checked={selectedSkillIds.includes(skill.id)} onChange={() => toggleSkill(skill.id)} />
                <span><strong>{sequence?.directoryName || skill.name}</strong><small>{skill.name}</small></span>
              </label>
            })}
          </div>
        </section>}
        {blueprints.length > 1 && <label className="workflow-template-select-all">
          <input type="checkbox" checked={allReadySelected} disabled={preparedSkills.length === 0 || selectableKeys.length === 0} onChange={() => onSelectedKeys(allReadySelected ? selectedKeys.filter((key) => !selectableKeys.includes(key)) : Array.from(new Set([...selectedKeys, ...selectableKeys])))} />
          选择全部可生成模板
        </label>}
        <main className="workflow-template-resolution-list">
          {resolutions.map((resolution) => (
            <article className={preparedSkills.length === 0 ? '' : resolution.canGenerate ? 'is-ready' : 'is-blocked'} key={resolution.blueprint.templateKey}>
              <label>
                <input type="checkbox" checked={selectedKeys.includes(resolution.blueprint.templateKey)} disabled={preparedSkills.length === 0 || !resolution.canGenerate} onChange={() => toggle(resolution.blueprint.templateKey)} />
                <span><strong>{resolution.blueprint.title}</strong><small>{resolution.blueprint.skillSelection === 'all-numbered' ? '使用本次勾选的 Skill' : `${resolution.blueprint.skillNames.length} 个指定 Skill`} · {resolution.blueprint.stageTitles.length} 个默认阶段</small></span>
              </label>
              <button className="workflow-template-preview-button" type="button" onClick={() => setPreviewKey(previewKey === resolution.blueprint.templateKey ? '' : resolution.blueprint.templateKey)}>{previewKey === resolution.blueprint.templateKey ? '收起预览' : '预览'}</button>
              {preparedSkills.length === 0 ? (
                <p>选择目录后，可从完整清单中确定本次生成顺序。</p>
              ) : resolution.canGenerate ? (
                <p className="ok-text">Skill 名称与目录编号均有效，将按 {resolution.resolved[0]?.directoryName} → {resolution.resolved.at(-1)?.directoryName} 的顺序生成。</p>
              ) : (
                <div className="workflow-template-resolution-errors">
                  {resolution.missingNames.length > 0 && <p>缺少：{resolution.missingNames.join('、')}</p>}
                  {resolution.duplicateNames.map((item) => <p key={item.name}>重名：{item.name}（{item.paths.length} 个目录）</p>)}
                  {resolution.unnumberedSkills.map((item) => <p key={item.name}>无编号目录：{item.name}（目录名应为 01-xx、02-xx）</p>)}
                  {resolution.duplicateOrders.map((item) => <p key={item.order}>重复编号：{String(item.order).padStart(2, '0')}（{item.skills.map((skill) => skill.name).join('、')}）</p>)}
                  {resolution.missingOrders.length > 0 && <p>编号断档：缺少 {resolution.missingOrders.map((value) => String(value).padStart(2, '0')).join('、')}</p>}
                </div>
              )}
              {previewKey === resolution.blueprint.templateKey && <div className="workflow-template-preview">
                <p><strong>阶段：</strong>{resolution.blueprint.stageTitles.join(' → ')}</p>
                <p><strong>阶段规则：</strong>{blueprintStageRuleSummary(resolution.blueprint)}。</p>
                <p><strong>节点规则：</strong>{blueprintNodeRuleSummary(resolution.blueprint)}；审查项为“{resolution.blueprint.nodeRules.reviewChecklistLabel}”。</p>
                <p><strong>检查点：</strong>{blueprintCheckpointRuleSummary(resolution.blueprint)}；标题“{resolution.blueprint.checkpointRules.titlePattern}”。</p>
                {resolution.resolved.length > 0 && <ol>{resolution.resolved.map((item) => <li key={item.skill.id}>{item.directoryName}</li>)}</ol>}
              </div>}
            </article>
          ))}
        </main>
        <footer>
          <span>已选择 {selectedReadyCount} 条。生成的是新工作流，不修改已有工作流或项目。</span>
          <div><button type="button" onClick={onCancel}>取消</button><button className="primary-action" type="button" disabled={selectedReadyCount === 0} onClick={onGenerate}>生成工作流</button></div>
        </footer>
      </section>
      {manualOpen && <div className="workflow-template-manual" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setManualOpen(false) }}>
        <section role="dialog" aria-modal="true" aria-label="手动创建中间模板" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><h3>手动创建中间模板</h3><p>模板只保存通用编排规则，不预存研究类型或 Skill 名称。</p></div><button type="button" autoFocus onClick={() => setManualOpen(false)} aria-label="关闭手动创建中间模板">关闭</button></header>
          <div className="workflow-template-manual-body">
              <div className="workflow-rule-presets" aria-label="规则预设">
                <button type="button" onClick={() => applyManualPreset('step-quality-gate')}><strong>逐步质量门</strong><small>每个 Skill 审查并留检查点</small></button>
                <button type="button" onClick={() => applyManualPreset('stage-gate')}><strong>阶段门禁</strong><small>只在阶段末审查与归档</small></button>
                <button type="button" onClick={() => applyManualPreset('external-collaboration')}><strong>外部协作</strong><small>阶段末审查后等待人工确认</small></button>
                <button type="button" onClick={() => applyManualPreset('lightweight')}><strong>轻量执行</strong><small>不中断，仅流程末归档</small></button>
              </div>
              <div className="workflow-template-manual-grid">
              <fieldset>
                <legend>基本信息与阶段</legend>
                <label>模板名称<input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="例如：通用多阶段流程" /></label>
                <label>阶段名称（每行一个）<textarea value={manualStages} onChange={(event) => setManualStages(event.target.value)} rows={6} /></label>
                <label>Skill 分配到阶段
                  <select value={manualStageAssignment} onChange={(event) => setManualStageAssignment(event.target.value as WorkflowBlueprint['stageRules']['assignment'])}>
                    <option value="balanced">按目录顺序均衡分配</option>
                    <option value="counts">按各阶段 Skill 数量分配</option>
                    <option value="breakpoints">按 Skill 序号断点分段</option>
                    <option value="first-stage">全部放入首阶段</option>
                  </select>
                </label>
                {manualStageAssignment === 'counts' && <label>前置阶段 Skill 数量<input value={manualStageCounts} onChange={(event) => setManualStageCounts(event.target.value)} placeholder="例如：3, 5（末阶段自动接收剩余项）" /></label>}
                {manualStageAssignment === 'breakpoints' && <label>阶段结束 Skill 序号<input value={manualStageBreakpoints} onChange={(event) => setManualStageBreakpoints(event.target.value)} placeholder="例如：3, 8, 12" /></label>}
              </fieldset>
              <fieldset>
                <legend>节点规则</legend>
                <label>自动审查位置
                  <select value={manualReviewMode} onChange={(event) => setManualReviewMode(event.target.value as WorkflowBlueprint['nodeRules']['reviewMode'])}>
                    <option value="after-each-skill">每个 Skill 后</option>
                    <option value="stage-end">每个阶段末</option>
                    <option value="selected-skills">指定 Skill 序号后</option>
                    <option value="none">不自动创建</option>
                  </select>
                </label>
                {manualReviewMode === 'selected-skills' && <label>审查 Skill 序号<input value={manualReviewOrders} onChange={(event) => setManualReviewOrders(event.target.value)} placeholder="例如：3, 8, 12" /></label>}
                <label>审查唯一确认项<input value={manualReviewChecklistLabel} disabled={manualReviewMode === 'none'} onChange={(event) => setManualReviewChecklistLabel(event.target.value)} /></label>
                <label className="checkbox-row"><input type="checkbox" checked={manualWaitAfterStage} onChange={(event) => setManualWaitAfterStage(event.target.checked)} />非末阶段结束后添加等待节点</label>
                <small>等待节点适合外部审批、实验或材料补充，由用户确认后继续。</small>
              </fieldset>
              <fieldset>
                <legend>检查点规则</legend>
                <label>自动检查点位置
                  <select value={manualCheckpointMode} onChange={(event) => setManualCheckpointMode(event.target.value as WorkflowBlueprint['checkpointRules']['mode'])}>
                    <option value="after-review">每个审查通过后</option>
                    <option value="after-each-skill">每个 Skill 完成后</option>
                    <option value="stage-end">每个阶段末</option>
                    <option value="workflow-end">工作流结束时</option>
                    <option value="selected-skills">指定 Skill 序号后</option>
                    <option value="none">不自动创建</option>
                  </select>
                </label>
                {manualCheckpointMode === 'selected-skills' && <label>检查点 Skill 序号<input value={manualCheckpointOrders} onChange={(event) => setManualCheckpointOrders(event.target.value)} placeholder="例如：3, 8, 12" /></label>}
                <label>检查点标题<input value={manualCheckpointTitlePattern} disabled={manualCheckpointMode === 'none'} onChange={(event) => setManualCheckpointTitlePattern(event.target.value)} /></label>
                <small>可用占位符：{'{skill}'}、{'{review}'}、{'{step}'}、{'{stage}'}、{'{node}'}</small>
                <label>必需交付物
                  <select value={manualCheckpointArtifacts} disabled={manualCheckpointMode === 'none'} onChange={(event) => setManualCheckpointArtifacts(event.target.value as WorkflowBlueprint['checkpointRules']['requiredArtifacts'])}>
                    <option value="trigger-output">触发节点或上一 Skill 的输出</option>
                    <option value="stage-outputs">当前阶段全部 Skill 输出</option>
                    <option value="workflow-outputs">此前工作流全部 Skill 输出</option>
                    <option value="none">不要求</option>
                  </select>
                </label>
              </fieldset>
              </div>
              <aside className="workflow-rule-summary"><strong>当前方案</strong><span>{manualStages.split(/\r?\n/).filter((item) => item.trim()).length} 个阶段 · {manualStageAssignment === 'balanced' ? '均衡分段' : manualStageAssignment === 'counts' ? '按数量分段' : manualStageAssignment === 'breakpoints' ? '按断点分段' : '首阶段'} · {manualReviewMode === 'none' ? '无审查' : '含审查'} · {manualCheckpointMode === 'none' ? '无检查点' : '含检查点'}</span></aside>
            {manualError && <p className="form-error" role="alert">{manualError}</p>}
          </div>
          <footer><span>创建后仍可导出 JSON，并与以后重新整理的编号 Skill 目录复用。</span><div><button type="button" onClick={() => setManualOpen(false)}>取消</button><button className="primary-action" type="button" disabled={!manualTitle.trim() || !manualStages.trim()} onClick={addManualBlueprint}>创建</button></div></footer>
        </section>
      </div>}
    </div>
  )
}

export function ProjectHistoryModal({ workflow, workflows, projects, projectDirectory, onClose, onCreate, onUpdate, onDelete, onOpen }: { workflow: Workflow; workflows: Workflow[]; projects: ProjectFlowState[]; projectDirectory: string; onClose: () => void; onCreate: (workflowId: string, title: string, topic: string) => Promise<ProjectFlowState | undefined>; onUpdate: (state: ProjectFlowState, title: string, topic: string) => Promise<ProjectFlowState | undefined>; onDelete: (state: ProjectFlowState) => Promise<boolean>; onOpen: (state: ProjectFlowState) => void }): JSX.Element {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<ProjectRecordDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const familyProjects = useMemo(
    () => projects.filter((state) => state.templateKey === workflow.templateKey).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [projects, workflow.templateKey]
  )
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return familyProjects.filter((state) => {
      if (statusFilter !== 'all' && state.status !== statusFilter) return false
      if (!normalized) return true
      const searchable = [
        state.projectTitle,
        state.projectId,
        state.status,
        String(state.projectFields.topic || '')
      ].join('\n').toLocaleLowerCase()
      return searchable.includes(normalized)
    })
  }, [familyProjects, query, statusFilter])
  const selectedProject = filteredProjects.find((state) => state.id === selectedId) || filteredProjects[0]

  useEffect(() => {
    if (!selectedProject) {
      setSelectedId('')
      return
    }
    if (selectedId !== selectedProject.id) setSelectedId(selectedProject.id)
  }, [selectedId, selectedProject?.id])

  function beginCreate(): void {
    setDraft({ mode: 'create', stateId: '', workflowId: workflow.id, title: '', topic: '' })
    setFormError('')
  }

  function beginEdit(state: ProjectFlowState): void {
    setSelectedId(state.id)
    setDraft({
      mode: 'edit',
      stateId: state.id,
      workflowId: state.workflowId,
      title: state.projectTitle,
      topic: String(state.projectFields.topic || '')
    })
    setFormError('')
  }

  async function saveDraft(): Promise<void> {
    if (!draft) return
    if (!draft.title.trim() || !draft.topic.trim()) {
      setFormError('项目名称和主题均不能为空。')
      return
    }
    setSaving(true)
    try {
      const existing = draft.mode === 'edit' ? projects.find((state) => state.id === draft.stateId) : undefined
      if (draft.mode === 'edit' && !existing) {
        setFormError('保存失败：项目记录已不存在。')
        return
      }
      const saved = draft.mode === 'create'
        ? await onCreate(draft.workflowId, draft.title, draft.topic)
        : await onUpdate(existing!, draft.title, draft.topic)
      if (!saved) {
        setFormError('保存失败：工作流或项目记录不存在。')
        return
      }
      setSelectedId(saved.id)
      setDraft(null)
      setFormError('')
    } finally {
      setSaving(false)
    }
  }

  async function removeSelected(state: ProjectFlowState): Promise<void> {
    setSaving(true)
    try {
      if (await onDelete(state)) {
        setSelectedId('')
        setDraft(null)
      }
    } finally {
      setSaving(false)
    }
  }

  const selectedWorkflow = selectedProject
    ? workflows.find((item) => item.id === selectedProject.workflowId) || workflows.find((item) => item.templateKey === selectedProject.templateKey && item.templateVersion === selectedProject.templateVersion)
    : undefined
  const completedNodes = selectedProject
    ? Object.values(selectedProject.nodeStates).filter((state) => ['completed', 'passed', 'skipped'].includes(state.status)).length
    : 0
  const totalNodes = selectedProject ? Object.keys(selectedProject.nodeStates).length : 0
  const currentNodeTitle = selectedProject?.currentNodeKey
    ? selectedWorkflow?.nodes.find((node) => node.nodeKey === selectedProject.currentNodeKey)?.title || selectedProject.currentNodeKey
    : '流程已完成'

  return (
    <div className="modal-backdrop project-history-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="project-history-modal" role="dialog" aria-modal="true" aria-label={`${workflow.title} 项目记录`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="project-history-header">
          <div><span className="eyebrow">历史项目增删改查</span><h2>{workflow.title} · 项目记录</h2><p>同一工作流的历史项目集中管理，执行状态和资源锁相互隔离。</p></div>
          <div><button className="primary-action" type="button" onClick={beginCreate}>＋ 新建项目</button><button type="button" onClick={onClose}>关闭</button></div>
        </header>
        <div className="project-history-body">
          <aside className="project-history-sidebar">
            <div className="project-history-filters">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、主题或项目 ID" aria-label="搜索项目记录" />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="筛选项目状态">
                <option value="all">全部状态</option><option value="active">进行中</option><option value="waiting">等待中</option><option value="blocked">已阻断</option><option value="completed">已完成</option>
              </select>
            </div>
            <div className="project-history-count">{filteredProjects.length} / {familyProjects.length} 个项目</div>
            <div className="project-history-list">
              {filteredProjects.map((state) => (
                <button key={state.id} type="button" className={selectedProject?.id === state.id && !draft ? 'active' : ''} onClick={() => { setSelectedId(state.id); setDraft(null); setFormError('') }}>
                  <strong>{state.projectTitle}</strong>
                  <span>{String(state.projectFields.topic || '未填写主题')}</span>
                  <small>{projectStatusLabel(state.status)} · {new Date(state.updatedAt).toLocaleString()}</small>
                </button>
              ))}
              {filteredProjects.length === 0 && <div className="project-history-empty"><strong>没有匹配的项目</strong><span>调整搜索条件，或新建一条项目记录。</span></div>}
            </div>
          </aside>

          <main className="project-history-detail">
            {draft ? (
              <div className="project-record-form">
                <header><div><span className="eyebrow">{draft.mode === 'create' ? '新增' : '修改'}</span><h3>{draft.mode === 'create' ? '新建项目记录' : '编辑项目资料'}</h3></div><button type="button" onClick={() => { setDraft(null); setFormError('') }}>取消</button></header>
                <label>项目名称<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
                <label>主题<textarea value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value })} /></label>
                {formError && <p className="error-text">{formError}</p>}
                <button className="primary-action" type="button" disabled={saving} onClick={() => void saveDraft()}>{saving ? '正在保存…' : '保存项目记录'}</button>
              </div>
            ) : selectedProject ? (
              <div className="project-record-view">
                <header><div><span className="eyebrow">{projectStatusLabel(selectedProject.status)}</span><h3>{selectedProject.projectTitle}</h3><p>{String(selectedProject.projectFields.topic || '未填写主题')}</p></div><div><button type="button" onClick={() => beginEdit(selectedProject)}>修改</button><button className="primary-action" type="button" onClick={() => onOpen(selectedProject)}>打开执行</button></div></header>
                <div className="project-record-progress"><div><i style={{ width: `${totalNodes ? Math.round((completedNodes / totalNodes) * 100) : 0}%` }} /></div><span>{completedNodes} / {totalNodes} 个节点完成</span></div>
                <dl className="project-record-metadata">
                  <div><dt>项目 ID</dt><dd><code>{selectedProject.projectId}</code></dd></div>
                  <div><dt>当前节点</dt><dd>{currentNodeTitle}</dd></div>
                  <div><dt>交付记录</dt><dd>{selectedProject.deliveryRecords.length} 条</dd></div>
                  <div><dt>审查记录</dt><dd>{selectedProject.reviewAttempts.length} 轮</dd></div>
                  <div><dt>检查点</dt><dd>{selectedProject.checkpoints.length} 个</dd></div>
                  <div><dt>创建时间</dt><dd>{new Date(selectedProject.createdAt).toLocaleString()}</dd></div>
                  <div><dt>更新时间</dt><dd>{new Date(selectedProject.updatedAt).toLocaleString()}</dd></div>
                  <div><dt>保存目录</dt><dd><code>{projectDirectory || '设置 → 数据保存位置 → 工作流项目'}</code></dd></div>
                </dl>
                <div className="project-record-danger"><div><strong>删除项目记录</strong><span>删除 Store 状态和受管 JSON，不删除外部附件、成果文件或资源。</span></div><button type="button" disabled={saving} onClick={() => void removeSelected(selectedProject)}>删除</button></div>
              </div>
            ) : <div className="project-history-empty project-history-empty-main"><strong>尚无项目记录</strong><span>点击“新建项目”添加第一条记录。</span></div>}
          </main>
        </div>
      </section>
    </div>
  )
}

function projectStatusLabel(status: ProjectFlowState['status']): string {
  return { active: '进行中', waiting: '等待中', blocked: '已阻断', completed: '已完成' }[status]
}

function NodeLayout({ mode, workflow, query, selectedNodeKey, selectedNodeKeys, onSelect, onToggle }: { mode: LayoutMode; workflow: Workflow; query: string; selectedNodeKey: string; selectedNodeKeys: string[]; onSelect: (key: string) => void; onToggle: (key: string) => void }): JSX.Element {
  const normalized = query.trim().toLowerCase()
  const matches = (node: WorkflowNode): boolean => !normalized || [node.nodeKey, node.title, node.resourceRef?.resourceKey].filter(Boolean).join(' ').toLowerCase().includes(normalized)
  const ordered = [...workflow.nodes].sort((a, b) => a.order - b.order)
  const paired = (node: WorkflowNode): boolean => node.type === 'review' && ordered.find((item) => item.order === node.order - 1)?.type === 'skill'
  if (mode === 'tree') return <div className="stage-tree">{workflow.stages.map((stage) => <details key={stage.stageKey} open><summary><strong>{stage.title}</strong><span>{workflow.nodes.filter((node) => node.stageKey === stage.stageKey).length}</span></summary><div>{ordered.filter((node) => node.stageKey === stage.stageKey && matches(node)).map((node) => <NodeRow key={node.nodeKey} node={node} paired={paired(node)} selected={selectedNodeKey === node.nodeKey} checked={selectedNodeKeys.includes(node.nodeKey)} onSelect={onSelect} onToggle={onToggle} />)}</div></details>)}</div>
  if (mode === 'canvas') return <div className="workflow-native-canvas">{ordered.filter(matches).map((node, index) => <div key={node.nodeKey} className={`${selectedNodeKey === node.nodeKey ? 'canvas-node selected' : 'canvas-node'}${paired(node) ? ' paired' : ''}`} onClick={() => onSelect(node.nodeKey)}><span>{index + 1}</span><strong>{node.title}</strong><small>{node.nodeKey}</small>{index < workflow.nodes.length - 1 && <i>→</i>}</div>)}</div>
  return <div className="compact-node-list">{ordered.filter(matches).map((node) => <NodeRow key={node.nodeKey} node={node} paired={paired(node)} selected={selectedNodeKey === node.nodeKey} checked={selectedNodeKeys.includes(node.nodeKey)} onSelect={onSelect} onToggle={onToggle} />)}</div>
}

function NodeRow({ node, selected, checked, paired, onSelect, onToggle }: { node: WorkflowNode; selected: boolean; checked: boolean; paired: boolean; onSelect: (key: string) => void; onToggle: (key: string) => void }): JSX.Element {
  return <div className={`${selected ? 'workflow-node-row selected' : 'workflow-node-row'}${paired ? ' paired' : ''}`}><input type="checkbox" checked={checked} onChange={() => onToggle(node.nodeKey)} /><button onClick={() => onSelect(node.nodeKey)}><span className={`node-kind kind-${node.type}`}>{node.type}</span><strong>{node.title}</strong><code>{node.nodeKey}</code><small>{node.resourceRef?.fingerprint.slice(0, 10) || node.checkpointKey || ''}</small></button></div>
}

function ResourceContract({ resource, projectLocks }: { resource: ResourceReference; projectLocks: number }): JSX.Element {
  return <div className="resource-contract"><span><strong>resourceKey</strong>{resource.resourceKey}</span><span><strong>版本</strong>{resource.expectedVersion}</span><span><strong>SHA-256</strong><code>{resource.fingerprint}</code></span><span><strong>locator</strong>{resource.locator}</span><span><strong>项目锁</strong>{projectLocks}</span></div>
}

type ExecutionSkillPreview = {
  name: string
  directory: string
  content: string
  loading: boolean
}

export function HistoricalNodeView({ node, project, projectStatus, skillPreview, latestNode, onLatest }: { node: WorkflowNode; project: ProjectFlowState; projectStatus: string; skillPreview?: ExecutionSkillPreview; latestNode?: WorkflowNode; onLatest: () => void }): JSX.Element {
  const deliveries = project.deliveryRecords.filter((record) => record.nodeKey === node.nodeKey).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const reviews = project.reviewAttempts.filter((attempt) => attempt.nodeKey === node.nodeKey).sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))
  const nodeState = project.nodeStates[node.nodeKey]
  return (
    <div className="historical-node-view">
      <div className="historical-node-notice"><div><strong>仅查看历史节点</strong><span>项目状态保持为“{projectStatus}”，不会新增或修改执行记录。</span></div>{latestNode && <button type="button" onClick={onLatest}>返回最新节点：{latestNode.title}</button>}</div>
      {skillPreview && (
        <details className="skill-execution-preview" open>
          <summary><strong>SKILL.md 内容预览</strong><small>{skillPreview.loading ? '正在读取…' : `${skillPreview.content.length.toLocaleString()} 字符`}</small></summary>
          <div className="skill-execution-identity"><span><strong>Skill 名称</strong>{skillPreview.name}</span><span><strong>所在目录</strong><code>{skillPreview.directory || '未绑定本地目录'}</code></span></div>
          <textarea className="skill-execution-preview-content" readOnly value={skillPreview.content || '未读取到 SKILL.md 内容，请检查 Skill 绑定路径。'} />
        </details>
      )}
      {deliveries.length > 0 && <section className="historical-record-section"><h4>交付历史</h4>{deliveries.map((record, index) => <details key={record.id} open={index === 0}><summary><strong>{deliveryModeLabels[record.mode]}</strong><span>{new Date(record.createdAt).toLocaleString()}</span></summary><label>交付文本<pre>{record.text}</pre></label><label>附件{record.attachmentPaths.length ? <ul>{record.attachmentPaths.map((filePath) => <li key={filePath}><code>{filePath}</code></li>)}</ul> : <span>无</span>}</label></details>)}</section>}
      {reviews.length > 0 && <section className="historical-record-section"><h4>审查历史</h4>{reviews.map((attempt) => <details key={attempt.id}><summary><strong>第 {attempt.attempt} 轮 · {attempt.passed ? '通过' : '不通过'}</strong><span>{new Date(attempt.reviewedAt).toLocaleString()}</span></summary>{attempt.changeReason && <p><strong>更改原因：</strong>{attempt.changeReason}</p>}{(attempt.attachmentPaths || []).length > 0 && <label>更改附件<ul>{attempt.attachmentPaths!.map((filePath) => <li key={filePath}><code>{filePath}</code></li>)}</ul></label>}</details>)}</section>}
      {deliveries.length === 0 && reviews.length === 0 && <section className="historical-record-empty"><strong>{node.summary || '该节点已完成。'}</strong><span>{nodeState?.completedAt ? `完成时间：${new Date(nodeState.completedAt).toLocaleString()}` : '未记录完成时间'}</span></section>}
    </div>
  )
}

function DeliveryStepper({ mode, onMode, payload, attachmentPaths, onFiles, additionalInfo, onAdditionalInfo, skillPreview, copyStep, onDeliver, onFinishOneByOne }: { mode: DeliveryMode; onMode: (mode: DeliveryMode) => void; payload: string; attachmentPaths: string[]; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; additionalInfo: string; onAdditionalInfo: (value: string) => void; skillPreview?: ExecutionSkillPreview; copyStep: number; onDeliver: () => void; onFinishOneByOne: () => void }): JSX.Element {
  const finishedCopies = mode === 'copy-one-by-one' && copyStep > attachmentPaths.length
  return (
    <div className="delivery-stepper">
      <div className="delivery-mode-tabs">
        {(Object.keys(deliveryModeLabels) as DeliveryMode[]).map((item) => (
          <button key={item} className={mode === item ? 'active' : ''} onClick={() => onMode(item)}>{deliveryModeLabels[item]}</button>
        ))}
      </div>
      {skillPreview && (
        <details className="skill-execution-preview" open>
          <summary><strong>SKILL.md 内容预览</strong><small>{skillPreview.loading ? '正在读取…' : `${skillPreview.content.length.toLocaleString()} 字符`}</small></summary>
          <div className="skill-execution-identity">
            <span><strong>Skill 名称</strong>{skillPreview.name}</span>
            <span><strong>所在目录</strong><code>{skillPreview.directory || '未绑定本地目录'}</code></span>
          </div>
          <textarea className="skill-execution-preview-content" readOnly value={skillPreview.content || '未读取到 SKILL.md 内容，请检查 Skill 绑定路径。'} />
        </details>
      )}
      <label className="file-drop">附件<input type="file" multiple onChange={onFiles} /><span>{attachmentPaths.length ? attachmentPaths.join('\n') : '选择本节点附件（不写入原资源）'}</span></label>
      <label>用户附加信息（可选）<textarea className="node-additional-info" value={additionalInfo} onChange={(event) => onAdditionalInfo(event.target.value)} placeholder="填写本节点需要补充给 AI 的要求、背景或输出说明；随本次交付保存。" /></label>
      <label>复制预览<textarea className="delivery-payload-preview" readOnly value={payload} /></label>
      {mode === 'copy-one-by-one' && <div className="copy-progress"><strong>{copyStep === 0 ? '第 1 步：复制文本' : copyStep <= attachmentPaths.length ? `第 ${copyStep + 1} 步：复制附件 ${copyStep}/${attachmentPaths.length}` : '全部复制完成'}</strong></div>}
      <button className="primary-action" onClick={finishedCopies ? onFinishOneByOne : onDeliver}>{finishedCopies ? '记录交付并进入下一节点' : mode === 'browser-plugin' ? '填充并记录交付' : mode === 'copy-all' ? '复制并记录交付' : '执行当前复制步骤'}</button>
    </div>
  )
}

function LegacyMigrationCard({ migration }: { migration: NonNullable<ProjectFlowState['legacyMigration']> }): JSX.Element {
  const outputCount = migration.steps.filter((step) => Boolean(step.output)).length
  const reviewedCount = migration.steps.filter((step) => step.reviewedByHuman).length
  return (
    <section className="legacy-migration-card">
      <header>
        <div>
          <span className="eyebrow">Store v{migration.sourceStoreVersion} 只读迁移记录</span>
          <h4>{migration.sourceWorkflowTitle}</h4>
        </div>
        <span>{migration.sourceStatus} · 原位置 {migration.sourceCurrentStepIndex + 1}/{migration.steps.length}</span>
      </header>
      <p>原运行 ID：<code>{migration.sourceRunId}</code>。输入快照、输出、人工确认和时间均原样保留；后续执行从迁移后的当前位置继续。</p>
      <div className="legacy-migration-summary">
        <span>{migration.steps.length} 个旧步骤</span>
        <span>{outputCount} 份旧输出</span>
        <span>{reviewedCount} 次人工确认</span>
        <span>{new Date(migration.migratedAt).toLocaleString()} 迁移</span>
      </div>
      <div className="legacy-step-history">
        {migration.steps.map((step, index) => (
          <details key={step.sourceStepId} open={Boolean(step.output)}>
            <summary>
              <strong>{index + 1}. {step.title}</strong>
              <span>{step.status}{step.reviewedByHuman ? ' · 已人工确认' : ''}</span>
            </summary>
            <div className="legacy-step-meta">
              <code>{step.nodeKey}</code>
              <span>{step.startedAt ? `开始：${new Date(step.startedAt).toLocaleString()}` : '未记录开始时间'}</span>
              <span>{step.finishedAt ? `结束：${new Date(step.finishedAt).toLocaleString()}` : '未记录结束时间'}</span>
            </div>
            {step.inputSnapshot && <label>原输入快照<pre>{step.inputSnapshot}</pre></label>}
            {step.output && <label>原输出<pre>{step.output}</pre></label>}
            {!step.inputSnapshot && !step.output && <p>该步骤没有保存文本。</p>}
          </details>
        ))}
      </div>
    </section>
  )
}

export function ReviewNodeEditor({ node, project, sourceSkillName, outputOutline, outlineLoading, checklist, reason, attachmentPaths, onChecklist, onReason, onFiles, onRemoveAttachment, onSubmit }: { node: WorkflowNode; project: ProjectFlowState; sourceSkillName: string; outputOutline: string[]; outlineLoading: boolean; checklist: Record<string, boolean>; reason: string; attachmentPaths: string[]; onChecklist: (value: Record<string, boolean>) => void; onReason: (value: string) => void; onFiles: (event: ChangeEvent<HTMLInputElement>) => void; onRemoveAttachment: (filePath: string) => void; onSubmit: () => void }): JSX.Element {
  const history = project.reviewAttempts.filter((attempt) => attempt.nodeKey === node.nodeKey).sort((a, b) => b.attempt - a.attempt)
  const confirmed = checklist[REVIEW_OUTPUT_CONFIRMATION_KEY] === true
  return (
    <div className="review-node-editor">
      <section className="review-output-outline">
        <header><span>上一 Skill 要求输出</span><strong>{sourceSkillName}</strong></header>
        {outlineLoading && <p>正在读取上一 Skill 的 SKILL.md…</p>}
        {outputOutline.length
          ? <ol>{outputOutline.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>
          : !outlineLoading && <p>未提取到明确的输出条目，请按上一 Skill 的完整 SKILL.md 核对。</p>}
      </section>
      <label className="review-check review-check-single">
        <input type="checkbox" checked={confirmed} onChange={(event) => onChecklist({ [REVIEW_OUTPUT_CONFIRMATION_KEY]: event.target.checked })} />
        <span>以上输出已按上一 Skill 的要求完成，可以进入下一节点。</span>
      </label>
      {!confirmed && <>
        <label>更改原因（不通过时必填）<textarea value={reason} onChange={(event) => onReason(event.target.value)} /></label>
        <section className="review-change-attachments">
          <label className="file-drop">更改原因附件（可选，可多选）<input type="file" multiple onChange={onFiles} /><span>可上传修改说明、补充数据、截图或其他佐证文件。</span></label>
          {attachmentPaths.length > 0 && <div className="review-attachment-list">{attachmentPaths.map((filePath) => <div key={filePath}><code>{filePath}</code><button type="button" onClick={() => onRemoveAttachment(filePath)}>移除</button></div>)}</div>}
        </section>
      </>}
      <button className="primary-action" disabled={!confirmed && !reason.trim()} onClick={onSubmit}>{confirmed ? '通过并进入下一节点' : '记录不通过并重填新清单'}</button>
      <h4>审查历史</h4>
      {history.length ? history.map((attempt) => (
        <details key={attempt.id}>
          <summary>第 {attempt.attempt} 轮 · {attempt.passed ? '通过' : '不通过'} · {new Date(attempt.reviewedAt).toLocaleString()}</summary>
          <div className="review-history-detail">
            <p><strong>确认结果：</strong>{attempt.passed ? '上一 Skill 输出已确认' : '未通过'}</p>
            {attempt.changeReason && <p><strong>更改原因：</strong>{attempt.changeReason}</p>}
            {(attempt.attachmentPaths || []).length > 0 && <div className="review-history-attachments"><strong>更改附件：</strong><ul>{attempt.attachmentPaths!.map((filePath) => <li key={filePath}><code>{filePath}</code></li>)}</ul></div>}
            <p><strong>关联交付：</strong>{attempt.deliveryRecordIds.length} 条</p>
          </div>
        </details>
      )) : <p>暂无历史。</p>}
    </div>
  )
}

export function extractSkillOutputOutline(content: string, declaredOutputs: string[] = []): string[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const collected: string[] = []
  let inOutputSection = false
  let outputHeadingLevel = 0
  let inFence = false

  for (const rawLine of lines) {
    const heading = rawLine.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (heading) {
      const level = heading[1].length
      const title = cleanOutlineItem(heading[2])
      if (inOutputSection && level <= outputHeadingLevel) inOutputSection = false
      if (isOutputHeading(title)) {
        inOutputSection = true
        outputHeadingLevel = level
        inFence = false
        continue
      }
      if (inOutputSection && level > outputHeadingLevel) collected.push(title)
      continue
    }
    if (!inOutputSection) continue

    if (/^\s*```/.test(rawLine)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      const treeItem = rawLine.match(/[├└]──\s+(.+?\.[a-zA-Z0-9]{1,10})\s*$/)
      if (treeItem) collected.push(cleanOutlineItem(treeItem[1]))
      continue
    }

    const listItem = rawLine.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (listItem) {
      collected.push(cleanOutlineItem(listItem[1]))
      continue
    }

    if (/^\s*\|.+\|\s*$/.test(rawLine) && !/^\s*\|?[\s:|-]+\|?\s*$/.test(rawLine)) {
      const cells = rawLine.split('|').map(cleanOutlineItem).filter(Boolean)
      if (cells.length) collected.push(cells.join(' · '))
    }
  }

  if (collected.length === 0) {
    for (const line of lines) {
      const summary = line.match(/完成后(?:你|用户)?会得到[:：]\s*(.+)$/)
      if (!summary) continue
      collected.push(...summary[1].split(/[；;、]/).map(cleanOutlineItem))
    }
  }

  if (collected.length === 0) collected.push(...declaredOutputs.map(cleanOutlineItem))
  return Array.from(new Set(collected.filter(Boolean))).slice(0, 12)
}

function isOutputHeading(title: string): boolean {
  return /(?:output(?:\s+files?)?|deliverables?|输出(?:文件|内容|结果|要求)?|交付(?:物|内容|要求)?|核心产物|最终产物|产出)/i.test(title)
}

function cleanOutlineItem(value: string): string {
  return value
    .replace(/^\s*[-*+]\s*/, '')
    .replace(/^\s*\[[ xX]\]\s*/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[＊*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function linesFromText(value: string): string[] {
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
}

function isBlueprintDocument(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'kind' in value && (value as { kind?: unknown }).kind === 'format-flow-workflow-blueprints')
}

export function projectNodeNavigationRole(workflow: Workflow, project: ProjectFlowState, nodeKey: string): 'current' | 'latest' | 'history' | null {
  if (project.currentNodeKey === nodeKey) return 'current'
  if (!['completed', 'passed'].includes(project.nodeStates[nodeKey]?.status)) return null
  const latestCompletedNode = [...workflow.nodes].sort((left, right) => right.order - left.order).find((node) => ['completed', 'passed'].includes(project.nodeStates[node.nodeKey]?.status))
  return latestCompletedNode?.nodeKey === nodeKey ? 'latest' : 'history'
}

export function ProgressSummary({ workflow, project, viewedNodeKey, onSelect }: { workflow: Workflow; project: ProjectFlowState; viewedNodeKey: string; onSelect: (nodeKey: string) => void }): JSX.Element {
  const statuses = Object.values(project.nodeStates)
  const done = statuses.filter((state) => ['completed', 'passed', 'skipped'].includes(state.status)).length
  const percent = workflow.nodes.length ? Math.round((done / workflow.nodes.length) * 100) : 100
  const hasHistoricalNode = statuses.some((state) => ['completed', 'passed'].includes(state.status))
  return <><div className="progress-meter"><i style={{ width: `${percent}%` }} /></div><p>{done}/{workflow.nodes.length} 节点 · {percent}%</p><div className="progress-nodes">{[...workflow.nodes].sort((a, b) => a.order - b.order).map((node) => {
    const status = project.nodeStates[node.nodeKey]?.status || 'pending'
    const navigationRole = projectNodeNavigationRole(workflow, project, node.nodeKey)
    const title = navigationRole === 'current' ? `${node.title}（最新节点）` : navigationRole === 'latest' ? `${node.title}（最新完成节点）` : navigationRole === 'history' ? `${node.title}（查看已完成节点）` : node.title
    const ariaLabel = navigationRole === 'current' ? `返回最新节点：${node.title}` : navigationRole === 'latest' ? `查看最新完成节点：${node.title}` : navigationRole === 'history' ? `查看已完成节点：${node.title}` : node.title
    return <button type="button" key={node.nodeKey} className={`state-${status}${viewedNodeKey === node.nodeKey ? ' is-viewed' : ''}${navigationRole === 'latest' ? ' is-latest' : ''}`} disabled={!navigationRole} title={title} aria-label={ariaLabel} onClick={() => onSelect(node.nodeKey)}>{node.order}</button>
  })}</div>{(hasHistoricalNode || project.currentNodeKey) && <small className="progress-return-hint">绿色节点用于查看历史；蓝色节点可返回项目最新位置。浏览不会改变项目状态。</small>}</>
}

export function WizardModal({ draft, step, prompts, skills, mcpServers, onDraft, onStep, onCancel, onFinish }: { draft: Workflow; step: number; prompts: PromptItem[]; skills: SkillItem[]; mcpServers: AppStore['mcpServers']; onDraft: (draft: Workflow) => void; onStep: (step: number) => void; onCancel: () => void; onFinish: () => void }): JSX.Element {
  const titles = ['', '基本信息', '阶段设置', '节点设置', '检查点设置', '检查并保存']
  const issues = validateWorkflow(draft)
  const errors = issues.filter((issue) => issue.severity === 'error')
  const stepReady = step === 1
    ? Boolean(draft.title.trim())
    : step === 2
      ? draft.stages.length > 0 && draft.stages.every((stage) => Boolean(stage.stageKey.trim() && stage.title.trim()))
      : step === 3
        ? draft.nodes.length > 0 && draft.nodes.every((node) => Boolean(node.nodeKey.trim() && node.title.trim() && draft.stages.some((stage) => stage.stageKey === node.stageKey)))
        : true

  return (
    <div className="modal-backdrop">
      <div className="workflow-wizard" role="dialog" aria-modal="true" aria-label="创建工作流">
        <header>
          <div><span>步骤 {step}/5</span><h3>{titles[step]}</h3></div>
          <button type="button" onClick={onCancel}>关闭</button>
        </header>
        <div className="wizard-progress" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} className={index + 1 <= step ? 'active' : ''} />)}</div>
        <main>
          {step === 1 && (
            <div className="wizard-basic-step">
              <label>工作流名称<input autoFocus value={draft.title} onChange={(event) => onDraft({ ...draft, title: event.target.value })} /></label>
              <label>工作流说明<textarea value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} /></label>
              <p className="hint">这里只定义工作流本身。项目执行时仅填写项目名称和主题，交付方式在具体节点中选择。</p>
            </div>
          )}
          {step === 2 && <WizardStagesStep draft={draft} onDraft={onDraft} />}
          {step === 3 && <WizardNodesStep draft={draft} prompts={prompts} skills={skills} mcpServers={mcpServers} onDraft={onDraft} />}
          {step === 4 && <WizardCheckpointsStep draft={draft} onDraft={onDraft} />}
          {step === 5 && (
            <div className="wizard-validation">
              <div className="wizard-summary-grid">
                <span><strong>{draft.stages.length}</strong> 阶段</span>
                <span><strong>{draft.nodes.length}</strong> 节点</span>
                <span><strong>{draft.checkpointBlueprint.length}</strong> 检查点</span>
              </div>
              <strong>{errors.length} 错误 / {issues.length - errors.length} 警告</strong>
              {issues.map((issue) => <p key={`${issue.code}-${issue.nodeKey || ''}`}>{issue.severity === 'error' ? '错误' : '提示'}：{issue.message}</p>)}
              {issues.length === 0 && <p className="ok-text">结构校验通过，可以保存工作流。</p>}
            </div>
          )}
        </main>
        <footer>
          <button type="button" disabled={step === 1} onClick={() => onStep(step - 1)}>上一步</button>
          {step < 5
            ? <button className="primary-action" type="button" disabled={!stepReady} onClick={() => onStep(step + 1)}>下一步</button>
            : <button className="primary-action" type="button" disabled={errors.length > 0} onClick={onFinish}>保存工作流</button>}
        </footer>
      </div>
    </div>
  )
}

function WizardStagesStep({ draft, onDraft }: { draft: Workflow; onDraft: (draft: Workflow) => void }): JSX.Element {
  function updateStages(stages: Workflow['stages'], nodes = draft.nodes): void {
    onDraft({ ...draft, stages: stages.map((stage, index) => ({ ...stage, order: index + 1 })), nodes, updatedAt: nowIso() })
  }

  function moveStage(index: number, offset: number): void {
    const nextIndex = index + offset
    if (nextIndex < 0 || nextIndex >= draft.stages.length) return
    const stages = [...draft.stages]
    const [stage] = stages.splice(index, 1)
    stages.splice(nextIndex, 0, stage)
    updateStages(stages)
  }

  function removeStage(stageKey: string): void {
    if (draft.stages.length <= 1) return
    const stage = draft.stages.find((item) => item.stageKey === stageKey)
    const fallback = draft.stages.find((item) => item.stageKey !== stageKey)
    if (!stage || !fallback) return
    const nodeCount = draft.nodes.filter((node) => node.stageKey === stageKey).length
    if (nodeCount > 0 && !window.confirm(`“${stage.title}”中有 ${nodeCount} 个节点。删除后将移动到“${fallback.title}”。是否继续？`)) return
    updateStages(
      draft.stages.filter((item) => item.stageKey !== stageKey),
      draft.nodes.map((node) => node.stageKey === stageKey ? { ...node, stageKey: fallback.stageKey } : node)
    )
  }

  return (
    <div className="wizard-structured-step">
      <div className="wizard-step-intro"><div><h4>按执行顺序建立阶段</h4><p>阶段用于组织节点。名称和说明可直接编辑，顺序可调整。</p></div><button type="button" onClick={() => updateStages([...draft.stages, { stageKey: newId('stage'), title: '新阶段', description: '', order: draft.stages.length + 1 }])}>＋ 添加阶段</button></div>
      <div className="wizard-item-list">
        {draft.stages.map((stage, index) => (
          <section className="wizard-item-card" key={stage.stageKey}>
            <header><div><span className="wizard-number">{index + 1}</span><strong>{stage.title || '未命名阶段'}</strong></div><div className="wizard-item-actions"><button type="button" disabled={index === 0} onClick={() => moveStage(index, -1)}>上移</button><button type="button" disabled={index === draft.stages.length - 1} onClick={() => moveStage(index, 1)}>下移</button><button className="danger-action" type="button" disabled={draft.stages.length <= 1} onClick={() => removeStage(stage.stageKey)}>删除</button></div></header>
            <div className="wizard-fields two-columns">
              <label>阶段名称<input value={stage.title} onChange={(event) => updateStages(draft.stages.map((item) => item.stageKey === stage.stageKey ? { ...item, title: event.target.value } : item))} /></label>
              <label>稳定标识<input value={stage.stageKey} onChange={(event) => updateStages(draft.stages.map((item) => item.stageKey === stage.stageKey ? { ...item, stageKey: event.target.value } : item), draft.nodes.map((node) => node.stageKey === stage.stageKey ? { ...node, stageKey: event.target.value } : node))} /></label>
              <label className="span-two">阶段说明<textarea value={stage.description} onChange={(event) => updateStages(draft.stages.map((item) => item.stageKey === stage.stageKey ? { ...item, description: event.target.value } : item))} /></label>
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

const wizardNodeKinds = ['prompt', 'skill', 'mcp', 'review', 'adapter', 'wait', 'route'] as const
type WizardNodeKind = typeof wizardNodeKinds[number]

function WizardNodesStep({ draft, prompts, skills, mcpServers, onDraft }: { draft: Workflow; prompts: PromptItem[]; skills: SkillItem[]; mcpServers: AppStore['mcpServers']; onDraft: (draft: Workflow) => void }): JSX.Element {
  const [selectedKey, setSelectedKey] = useState(draft.nodes[0]?.nodeKey || '')
  const [newKind, setNewKind] = useState<WizardNodeKind>(skills.length ? 'skill' : 'review')
  const ordered = [...draft.nodes].sort((left, right) => left.order - right.order)
  const selected = ordered.find((node) => node.nodeKey === selectedKey) || ordered[0]

  useEffect(() => {
    if (!selected) setSelectedKey('')
    else if (selected.nodeKey !== selectedKey) setSelectedKey(selected.nodeKey)
  }, [selected?.nodeKey, selectedKey])

  function saveNodes(nodes: WorkflowNode[], checkpoints = draft.checkpointBlueprint): void {
    const normalized = nodes.map((node, index) => ({ ...node, order: index + 1, position: { x: (index % 8) * 260, y: Math.floor(index / 8) * 170 } }))
    onDraft({ ...draft, nodes: normalized, edges: rebuildLinearEdges(normalized), checkpointBlueprint: checkpoints, updatedAt: nowIso() })
  }

  function addWizardNode(): void {
    const node = wizardNodeForKind(newKind, draft.nodes.length, prompts, skills, mcpServers)
    node.stageKey = draft.stages[0]?.stageKey || 'main'
    saveNodes([...ordered, node])
    setSelectedKey(node.nodeKey)
  }

  function updateSelected(patch: Partial<WorkflowNode>): void {
    if (!selected) return
    const checkpoints = typeof patch.nodeKey === 'string' && patch.nodeKey !== selected.nodeKey
      ? draft.checkpointBlueprint.map((checkpoint) => checkpoint.afterNodeKey === selected.nodeKey ? { ...checkpoint, afterNodeKey: patch.nodeKey! } : checkpoint)
      : draft.checkpointBlueprint
    saveNodes(ordered.map((node) => node.id === selected.id ? { ...node, ...patch } : node), checkpoints)
    if (typeof patch.nodeKey === 'string') setSelectedKey(patch.nodeKey)
  }

  function changeKind(kind: WizardNodeKind): void {
    if (!selected) return
    const replacement = wizardNodeForKind(kind, selected.order - 1, prompts, skills, mcpServers)
    updateSelected({
      ...replacement,
      id: selected.id,
      nodeKey: selected.nodeKey,
      stageKey: selected.stageKey,
      order: selected.order,
      position: selected.position
    })
  }

  function bindResource(resourceId: string): void {
    if (!selected) return
    let replacement: WorkflowNode | undefined
    if (selected.type === 'prompt') {
      const resource = prompts.find((item) => item.id === resourceId)
      if (resource) replacement = nodeFromPrompt(resource, selected.order - 1)
    } else if (selected.type === 'skill') {
      const resource = skills.find((item) => item.id === resourceId)
      if (resource) replacement = nodeFromSkill(resource, selected.order - 1)
    } else if (selected.type === 'mcp') {
      const resource = mcpServers.find((item) => item.id === resourceId)
      if (resource) replacement = nodeFromMcp(resource, selected.order - 1)
    }
    if (!replacement) return
    updateSelected({ ...replacement, id: selected.id, nodeKey: selected.nodeKey, stageKey: selected.stageKey, order: selected.order, position: selected.position })
  }

  function moveNode(offset: number): void {
    if (!selected) return
    const index = ordered.findIndex((node) => node.id === selected.id)
    const nextIndex = index + offset
    if (nextIndex < 0 || nextIndex >= ordered.length) return
    const nodes = [...ordered]
    const [node] = nodes.splice(index, 1)
    nodes.splice(nextIndex, 0, node)
    saveNodes(nodes)
  }

  function removeNode(): void {
    if (!selected || !window.confirm(`删除节点“${selected.title}”？关联到该节点的检查点也会删除。`)) return
    const index = ordered.findIndex((node) => node.id === selected.id)
    const nodes = ordered.filter((node) => node.id !== selected.id)
    saveNodes(nodes, draft.checkpointBlueprint.filter((checkpoint) => checkpoint.afterNodeKey !== selected.nodeKey))
    setSelectedKey(nodes[Math.min(index, nodes.length - 1)]?.nodeKey || '')
  }

  const resourceOptions = selected?.type === 'prompt'
    ? prompts.map((item) => ({ id: item.id, label: item.title }))
    : selected?.type === 'skill'
      ? skills.map((item) => ({ id: item.id, label: item.title || item.name }))
      : selected?.type === 'mcp'
        ? mcpServers.map((item) => ({ id: item.id, label: item.name }))
        : []

  return (
    <div className="wizard-structured-step wizard-node-step">
      <div className="wizard-step-intro"><div><h4>逐个设置执行节点</h4><p>先选择节点类型，再绑定资源、指定阶段和声明交付物。Review 默认只有一个输出确认项。</p></div><div className="wizard-add-control"><select value={newKind} onChange={(event) => setNewKind(event.target.value as WizardNodeKind)}>{wizardNodeKinds.map((kind) => <option key={kind} value={kind}>{nodeKindLabel(kind)}</option>)}</select><button type="button" onClick={addWizardNode}>＋ 添加节点</button></div></div>
      <div className="wizard-node-layout">
        <nav className="wizard-node-list" aria-label="节点列表">
          {ordered.map((node) => <button type="button" key={node.id} className={selected?.id === node.id ? 'active' : ''} onClick={() => setSelectedKey(node.nodeKey)}><span>{node.order}</span><div><strong>{node.title || '未命名节点'}</strong><small>{nodeKindLabel(node.type as WizardNodeKind)} · {draft.stages.find((stage) => stage.stageKey === node.stageKey)?.title || '未分配阶段'}</small></div></button>)}
          {ordered.length === 0 && <p>尚无节点，请先添加。</p>}
        </nav>
        {selected ? (
          <section className="wizard-node-editor">
            <header><div><span className={`node-kind kind-${selected.type}`}>{nodeKindLabel(selected.type as WizardNodeKind)}</span><strong>节点 {selected.order}</strong></div><div className="wizard-item-actions"><button type="button" disabled={selected.order === 1} onClick={() => moveNode(-1)}>上移</button><button type="button" disabled={selected.order === ordered.length} onClick={() => moveNode(1)}>下移</button><button className="danger-action" type="button" onClick={removeNode}>删除</button></div></header>
            <div className="wizard-fields two-columns">
              <label>节点类型<select value={selected.type} onChange={(event) => changeKind(event.target.value as WizardNodeKind)}>{wizardNodeKinds.map((kind) => <option key={kind} value={kind}>{nodeKindLabel(kind)}</option>)}</select></label>
              <label>所属阶段<select value={selected.stageKey} onChange={(event) => updateSelected({ stageKey: event.target.value })}>{draft.stages.map((stage) => <option key={stage.stageKey} value={stage.stageKey}>{stage.order}. {stage.title}</option>)}</select></label>
              <label>显示名称<input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} /></label>
              <label>稳定节点标识<input value={selected.nodeKey} onChange={(event) => updateSelected({ nodeKey: event.target.value })} /></label>
              {['prompt', 'skill', 'mcp'].includes(selected.type) && (
                <label className="span-two">绑定资源<select value={selected.refId || ''} onChange={(event) => bindResource(event.target.value)}><option value="" disabled>选择资源…</option>{resourceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{resourceOptions.length === 0 && <small className="error-text">当前没有可绑定的 {nodeKindLabel(selected.type as WizardNodeKind)} 资源。</small>}</label>
              )}
              <label className="span-two">节点说明<textarea value={selected.summary} onChange={(event) => updateSelected({ summary: event.target.value })} /></label>
              <label className="span-two">声明交付物（每行一项）<textarea value={selected.outputs.join('\n')} onChange={(event) => updateSelected({ outputs: linesFromText(event.target.value) })} /></label>
            </div>
          </section>
        ) : <div className="wizard-empty-editor">添加节点后在这里设置详细信息。</div>}
      </div>
    </div>
  )
}

function WizardCheckpointsStep({ draft, onDraft }: { draft: Workflow; onDraft: (draft: Workflow) => void }): JSX.Element {
  function save(checkpoints: Workflow['checkpointBlueprint']): void {
    onDraft({ ...draft, checkpointBlueprint: checkpoints, updatedAt: nowIso() })
  }

  function add(): void {
    if (draft.nodes.length === 0) return
    const lastNode = [...draft.nodes].sort((left, right) => left.order - right.order).at(-1)!
    save([...draft.checkpointBlueprint, { checkpointKey: newId('checkpoint'), title: '新检查点', afterNodeKey: lastNode.nodeKey, requiredArtifacts: [] }])
  }

  return (
    <div className="wizard-structured-step">
      <div className="wizard-step-intro"><div><h4>定义需要留痕的位置</h4><p>检查点在指定节点完成后写入；必需交付物应与节点声明的交付物名称一致。</p></div><button type="button" disabled={draft.nodes.length === 0} onClick={add}>＋ 添加检查点</button></div>
      <div className="wizard-item-list">
        {draft.checkpointBlueprint.map((checkpoint, index) => (
          <section className="wizard-item-card" key={checkpoint.checkpointKey}>
            <header><div><span className="wizard-number">{index + 1}</span><strong>{checkpoint.title || '未命名检查点'}</strong></div><button className="danger-action" type="button" onClick={() => save(draft.checkpointBlueprint.filter((item) => item.checkpointKey !== checkpoint.checkpointKey))}>删除</button></header>
            <div className="wizard-fields two-columns">
              <label>检查点名称<input value={checkpoint.title} onChange={(event) => save(draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, title: event.target.value } : item))} /></label>
              <label>稳定标识<input value={checkpoint.checkpointKey} onChange={(event) => save(draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, checkpointKey: event.target.value } : item))} /></label>
              <label className="span-two">在此节点完成后<select value={checkpoint.afterNodeKey} onChange={(event) => save(draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, afterNodeKey: event.target.value } : item))}>{[...draft.nodes].sort((left, right) => left.order - right.order).map((node) => <option key={node.nodeKey} value={node.nodeKey}>{node.order}. {node.title}</option>)}</select></label>
              <label className="span-two">必需交付物（每行一项）<textarea value={checkpoint.requiredArtifacts.join('\n')} onChange={(event) => save(draft.checkpointBlueprint.map((item) => item.checkpointKey === checkpoint.checkpointKey ? { ...item, requiredArtifacts: linesFromText(event.target.value) } : item))} /></label>
            </div>
          </section>
        ))}
        {draft.checkpointBlueprint.length === 0 && <div className="wizard-empty-editor"><strong>暂不设置检查点</strong><span>可以直接进入下一步，也可以现在添加。</span></div>}
      </div>
    </div>
  )
}

function wizardNodeForKind(kind: WizardNodeKind, index: number, prompts: PromptItem[], skills: SkillItem[], mcpServers: AppStore['mcpServers']): WorkflowNode {
  if (kind === 'prompt') return nodeFromPrompt(prompts[0] || createPrompt({ id: 'unbound-prompt', title: '未绑定 Prompt' }), index)
  if (kind === 'skill') return nodeFromSkill(skills[0] || placeholderSkill(), index)
  if (kind === 'mcp') return nodeFromMcp(mcpServers[0] || createMcpServer({ id: 'unbound-mcp', name: '未绑定 MCP' }), index)
  return {
    id: newId(kind),
    nodeKey: `${kind}-${index + 1}`,
    type: kind,
    title: nodeKindLabel(kind),
    summary: kind === 'review' ? '核对上一 Skill 要求的输出；通过后继续，不通过时记录原因并停留。' : '',
    tags: [kind],
    inputs: {},
    outputs: [],
    requiresReview: kind === 'review',
    stageKey: 'main',
    order: index + 1,
    applicabilityRules: [],
    reviewChecklist: kind === 'review' ? standardReviewItems : undefined,
    position: { x: (index % 8) * 260, y: Math.floor(index / 8) * 170 }
  }
}

function nodeKindLabel(kind: WizardNodeKind): string {
  return { prompt: 'Prompt', skill: 'Skill', mcp: 'MCP', review: '审查节点', adapter: '适配节点', wait: '等待节点', route: '路由节点' }[kind]
}

export function buildNodePayload(node: WorkflowNode, store: AppStore, skills: SkillItem[], attachmentPaths: string[] = [], additionalInfo = '', skillDirectoryOverride = ''): string {
  const userInput = buildUserInputSections(attachmentPaths, additionalInfo)
  if (node.type === 'skill') {
    const skill = resolveSkill(node, skills)
    const name = skill?.name || node.resourceRef?.resourceKey.replace(/^skill:/, '') || node.title
    const directory = skillDirectoryOverride || skillDirectoryPath(skill?.path || node.resourceRef?.locator || '')
    return [`Skill 名称：$${name}`, `Skill 所在目录：${directory || '未绑定本地目录'}`, '', userInput].join('\n')
  }
  if (node.type === 'prompt') {
    const prompt = store.prompts.find((item) => item.id === node.refId)
    return ['[原始 Prompt 正文｜保持原样]', prompt?.content || '未找到 Prompt', '', userInput].join('\n')
  }
  const mcp = store.mcpServers.find((item) => item.id === node.refId)
  return ['[MCP 资源引用]', mcp ? JSON.stringify({ name: mcp.name, transport: mcp.transport, command: mcp.command, args: mcp.args, url: mcp.url }, null, 2) : node.resourceRef?.locator || node.title, '', userInput].join('\n')
}

function buildUserInputSections(attachmentPaths: string[], additionalInfo: string): string {
  const attachments = attachmentPaths.length
    ? attachmentPaths.map((filePath, index) => `${index + 1}. ${filePath}`).join('\n')
    : '未添加'
  return ['附件：', attachments, '', '用户附加信息：', additionalInfo.trim() || '无'].join('\n')
}

function skillDirectoryPath(skillPath: string): string {
  const normalized = skillPath.trim().replace(/[\\/]+$/, '')
  if (/^SKILL\.md$/i.test(normalized)) return '.'
  return normalized.replace(/[\\/]SKILL\.md$/i, '')
}

function withNodeAdditionalInfo(project: ProjectFlowState, nodeKey: string, additionalInfo: string): ProjectFlowState {
  const nodeState = project.nodeStates[nodeKey]
  if (!nodeState) return project
  return {
    ...project,
    nodeStates: {
      ...project.nodeStates,
      [nodeKey]: {
        ...nodeState,
        formValues: { ...nodeState.formValues, additionalInfo }
      }
    },
    updatedAt: nowIso()
  }
}

function resolveSkill(node: WorkflowNode, skills: SkillItem[]): SkillItem | undefined {
  const name = node.resourceRef?.resourceKey.replace(/^skill:/, '')
  return skills.find((skill) => skill.id === node.refId || skill.name === name)
}

function workflowGroupTags(group: GroupItem | undefined): string[] {
  return group ? [group.tag, ...group.children.flatMap(workflowGroupTags)] : []
}

function findWorkflowGroupByTag(groups: GroupItem[], tag: string): GroupItem | undefined {
  for (const group of groups) {
    if (group.tag === tag) return group
    const child = findWorkflowGroupByTag(group.children, tag)
    if (child) return child
  }
  return undefined
}

function removeWorkflowGroupById(groups: GroupItem[], id: string): GroupItem[] {
  return groups
    .filter((group) => group.id !== id)
    .map((group) => ({ ...group, children: removeWorkflowGroupById(group.children, id) }))
}

export function removeUnusedWorkflow(store: AppStore, workflowId: string): AppStore {
  if (store.projectFlowStates.some((state) => state.workflowId === workflowId)) return store
  return { ...store, workflows: store.workflows.filter((workflow) => workflow.id !== workflowId) }
}

function defaultProjectFields(_workflow: Workflow): Record<string, unknown> {
  return { topic: '', deliveryMode: 'copy-all' }
}

function suggestedProjectTitle(fields: Record<string, unknown>): string {
  for (const key of ['projectTitle', 'topic', 'title', 'inventionTitle', 'researchQuestion']) {
    const value = fields[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return '未命名项目'
}

function cloneAsDraft(workflow: Workflow): Workflow {
  const draft = deepClone(workflow)
  const timestamp = Date.now()
  return { ...draft, id: `${workflow.templateKey}@draft-${timestamp}`, templateVersion: `${workflow.templateVersion}-draft.${timestamp}`, status: 'draft', updatedAt: nowIso() }
}

function normalizePublishVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!match) return '1.0.0'
  if (!version.includes('draft')) return `${match[1]}.${Number(match[2]) + 1}.0`
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
}

function appendResourceSnapshot(store: AppStore, ref: ResourceReference, content: string) {
  if (store.resourceVersions.some((version) => version.resourceKey === ref.resourceKey && version.fingerprint === ref.fingerprint)) return store.resourceVersions
  return [...store.resourceVersions, { id: newId('resource-version'), resourceKey: ref.resourceKey, type: ref.type, version: ref.expectedVersion, fingerprint: ref.fingerprint, locator: ref.locator, metadata: {}, contentSnapshot: content, createdAt: nowIso() }]
}

function updateDraftResourceReference(workflows: Workflow[], source: Workflow, node: WorkflowNode, ref: ResourceReference): Workflow[] {
  const update = (workflow: Workflow): Workflow => ({ ...workflow, nodes: workflow.nodes.map((item) => item.nodeKey === node.nodeKey ? { ...item, resourceRef: ref } : item), updatedAt: nowIso() })
  if (source.status === 'draft') return workflows.map((workflow) => workflow.id === source.id ? update(workflow) : workflow)
  const existingDraft = workflows.find((workflow) => workflow.templateKey === source.templateKey && workflow.status === 'draft')
  if (existingDraft) return workflows.map((workflow) => workflow.id === existingDraft.id ? update(workflow) : workflow)
  const draft = update(cloneAsDraft(source))
  return [draft, ...workflows]
}

function mergeImportedResourceVersions(store: AppStore, skills: SkillItem[]) {
  const known = new Set(store.resourceVersions.map((version) => `${version.resourceKey}:${version.fingerprint}`))
  const additions = skills.filter((skill) => skill.contentFingerprint && !known.has(`skill:${skill.name}:${skill.contentFingerprint}`)).map((skill) => ({ id: newId('resource-version'), resourceKey: `skill:${skill.name}`, type: 'skill' as const, version: 'sha256', fingerprint: skill.contentFingerprint!, locator: skill.path, metadata: { title: skill.title, summary: skill.summary }, createdAt: nowIso() }))
  return [...store.resourceVersions, ...additions]
}

function placeholderSkill(): SkillItem {
  return { id: 'unbound-skill', name: 'unbound-skill', title: '未绑定 Skill', summary: '', tags: [], variables: [], favorite: false, path: '', source: 'custom', contentPreview: '', contentFingerprint: 'unbound', updatedAt: nowIso() }
}

async function writeWorkflowClipboard(text: string): Promise<{ ok: boolean; message: string }> {
  if (window.formatFlow?.writeClipboardText) return window.formatFlow.writeClipboardText(text)
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, message: '浏览器预览：文本已复制。' }
  } catch {
    return { ok: false, message: '浏览器预览无法访问剪贴板。' }
  }
}

async function copyWorkflowPayload(text: string, filePaths: string[]): Promise<{ ok: boolean; message: string }> {
  if (window.formatFlow?.copyTemporaryWordPayload) {
    return window.formatFlow.copyTemporaryWordPayload({ text, filePaths })
  }
  return writeWorkflowClipboard(text)
}

async function copyWorkflowAttachmentFiles(filePaths: string[]): Promise<{ ok: boolean; message: string }> {
  if (window.formatFlow?.copyTemporaryWordFiles) return window.formatFlow.copyTemporaryWordFiles(filePaths)
  return { ok: false, message: '浏览器预览不能复制本地附件。' }
}

async function queueWorkflowBrowserTask(payload: Record<string, unknown>): Promise<{ ok: boolean; message: string }> {
  if (window.formatFlow?.queueBrowserBridgeTask) return window.formatFlow.queueBrowserBridgeTask(payload)
  return { ok: false, message: '浏览器预览未连接桌面插件桥。' }
}

function downloadJsonInBrowser(fileName: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

export function uniqueWorkflowTitle(title: string, usedTitles: Set<string>): string {
  if (!usedTitles.has(title)) return title
  let copy = 2
  while (usedTitles.has(`${title} (${copy})`)) copy += 1
  return `${title} (${copy})`
}

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)) as T
}
