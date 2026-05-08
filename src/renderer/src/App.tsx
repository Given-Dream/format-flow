import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, MouseEvent, ReactNode } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange
} from '@xyflow/react'
import {
  allTags,
  approvalNode,
  buildExecutionPrompt,
  createMcpServer,
  createPrompt,
  createPromptFromText,
  createRunSteps,
  createWorkflow,
  defaultStore,
  groupFromTag,
  matchesTextAndTags,
  mergeSkillMetadata,
  newId,
  nodeFromPrompt,
  normalizeStore,
  normalizeTag,
  nowIso,
  parseTags,
  parsePromptImport,
  rebuildLinearEdges,
  tagsToText
} from '@shared/domain'
import type {
  AppPaths,
  AppStore,
  BackupResult,
  GithubSearchResult,
  GroupItem,
  ImportResult,
  McpServer,
  PromptItem,
  RunStep,
  SkillItem,
  SkillMetadata,
  Workflow,
  WorkflowNode
} from '@shared/types'

type TabId = 'prompts' | 'skills' | 'workflows' | 'runner' | 'mcps' | 'settings'
type LauncherMode = 'prompt' | 'skill' | 'workflow'
type FormatFlowApi = Window['formatFlow']
type AiPluginStatus = {
  bridgeConnected?: boolean
  connected: boolean
  aiName?: string
  aiIcon?: string
  tabTitle?: string
  url?: string
  message?: string
}
type AiPluginOutput = {
  text: string
  aiName?: string
  aiIcon?: string
  updatedAt: number
}
type ReviewMessage = {
  id: string
  role: 'human' | 'system'
  text: string
  createdAt: string
}

const formatFlow = getFormatFlowApi()

const tabs: Array<{ id: TabId; label: string; description: string }> = [
  { id: 'prompts', label: '提示词', description: '按分类标签管理、搜索和调用' },
  { id: 'skills', label: 'Skills', description: '扫描、导入、安装和索引 Skill' },
  { id: 'workflows', label: '工作流', description: '提示词节点选择调用哪个 Skill' },
  { id: 'runner', label: '顺序运行', description: '审查后自动发送下一步任务' },
  { id: 'mcps', label: 'MCP', description: '导入和添加 MCP 服务配置' },
  { id: 'settings', label: '设置', description: '快捷键、Skill 路径和数据位置' }
]

export function App(): JSX.Element {
  const [store, setStore] = useState<AppStore | null>(null)
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [rawSkills, setRawSkills] = useState<SkillItem[]>([])
  const [activeTab, setActiveTab] = useState<TabId>('prompts')
  const [notice, setNotice] = useState('正在加载本地数据...')
  const [isBusy, setIsBusy] = useState(true)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [pluginStatus, setPluginStatus] = useState<AiPluginStatus>({
    connected: false,
    message: '浏览器插件未连接'
  })
  const [pluginOutput, setPluginOutput] = useState<AiPluginOutput | null>(null)

  useEffect(() => {
    let cancelled = false

    async function bootstrap(): Promise<void> {
      try {
        const [loadedStore, loadedPaths] = await Promise.all([formatFlow.loadStore(), formatFlow.getPaths()])
        const skillDirectories =
          loadedStore.settings.skillDirectories.length > 0
            ? loadedStore.settings.skillDirectories
            : loadedPaths.defaultSkillDirectories
        const normalizedStore = normalizeStore({
          ...loadedStore,
          settings: {
            ...loadedStore.settings,
            dataDirectory:
              loadedStore.settings.dataDirectory ||
              (loadedPaths.dataDirectory !== loadedPaths.userData ? loadedPaths.dataDirectory : ''),
            skillDirectories
          }
        })
        const scanned = await formatFlow.scanSkills(skillDirectories)

        if (!cancelled) {
          setStore(normalizedStore)
          setPaths(loadedPaths)
          setRawSkills(scanned)
          setNotice(`已载入 ${normalizedStore.prompts.length} 个提示词、${scanned.length} 个 Skill`)
          setIsBusy(false)
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : '加载失败')
          setIsBusy(false)
        }
      }
    }

    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return formatFlow.onOpenLauncher?.(() => setLauncherOpen(true))
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!store) return
      if (eventMatchesShortcut(event, store.settings.shortcut)) {
        event.preventDefault()
        setLauncherOpen(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [store])

  useEffect(() => {
    function onPluginMessage(event: MessageEvent): void {
      if (event.source !== window) return
      const data = event.data as { source?: string; type?: string; payload?: Record<string, unknown> }
      if (data?.source !== 'format-flow-extension') return

      if (data.type === 'FORMAT_FLOW_STATUS') {
        setPluginStatus(normalizePluginStatus(data.payload))
        return
      }

      if (data.type === 'FORMAT_FLOW_OUTPUT_SYNC') {
        const output = normalizePluginOutput(data.payload)
        if (output) {
          setPluginOutput(output)
          setPluginStatus((current) => ({
            ...current,
            connected: true,
            aiName: output.aiName || current.aiName,
            aiIcon: output.aiIcon || current.aiIcon,
            message: `${output.aiName || current.aiName || 'AI'} 输出已同步`
          }))
        }
        return
      }

      if (data.type === 'FORMAT_FLOW_SEND_RESULT') {
        const rawStatus = data.payload?.status
        if (rawStatus && typeof rawStatus === 'object' && !Array.isArray(rawStatus)) {
          setPluginStatus(normalizePluginStatus(rawStatus as Record<string, unknown>))
        }
        setNotice(typeof data.payload?.message === 'string' ? data.payload.message : '浏览器插件已响应')
      }
    }

    window.addEventListener('message', onPluginMessage)
    requestPluginStatus()
    const missingBridgeTimer = window.setTimeout(() => {
      setPluginStatus((current) =>
        current.bridgeConnected
          ? current
          : {
              bridgeConnected: false,
              connected: false,
              message:
                '当前浏览器没有检测到 Format Flow 扩展。请用已加载扩展的 Chrome/Edge 打开 http://127.0.0.1:5174/；Codex 内置浏览器不能加载 Chrome 扩展。'
            }
      )
    }, 1800)
    const timer = window.setInterval(requestPluginStatus, 5000)
    return () => {
      window.removeEventListener('message', onPluginMessage)
      window.clearTimeout(missingBridgeTimer)
      window.clearInterval(timer)
    }
  }, [])

  const skills = useMemo(() => {
    if (!store) return []
    return rawSkills.map((skill) => mergeSkillMetadata(skill, store.skillIndex[skill.id]))
  }, [rawSkills, store])

  async function commit(nextStore: AppStore): Promise<void> {
    const normalized = normalizeStore(nextStore)
    setStore(normalized)
    const saved = await formatFlow.saveStore(normalized)
    setStore(saved)
  }

  async function scanSkills(directories = store?.settings.skillDirectories || []): Promise<void> {
    setNotice('正在扫描 Skill...')
    const scanned = await formatFlow.scanSkills(directories)
    setRawSkills(scanned)
    setNotice(`扫描完成：${scanned.length} 个 Skill`)
  }

  async function copyToClipboard(text: string, success: string): Promise<void> {
    await navigator.clipboard.writeText(text)
    setNotice(success)
  }

  if (!store) {
    return (
      <main className="boot">
        <div className="boot-card">
          <div className="brand-mark">FF</div>
          <h1>Format Flow</h1>
          <p>{notice}</p>
        </div>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">FF</div>
          <div>
            <strong>Format Flow</strong>
            <span>Prompt + Skill 工作台</span>
          </div>
        </div>

        <nav className="tab-list">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'tab active' : 'tab'}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.label}</span>
              <small>{tab.description}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className={isBusy ? 'status-dot busy' : 'status-dot'} />
          <span>{notice}</span>
        </div>
      </aside>

      <main className="workspace">
        {activeTab === 'prompts' && <PromptPanel store={store} commit={commit} setNotice={setNotice} />}
        {activeTab === 'skills' && (
          <SkillPanel
            store={store}
            skills={skills}
            commit={commit}
            scanSkills={scanSkills}
            openPath={(targetPath) => formatFlow.openPath(targetPath)}
            setNotice={setNotice}
          />
        )}
        {activeTab === 'workflows' && <WorkflowPanel store={store} skills={skills} commit={commit} />}
        {activeTab === 'runner' && (
          <RunnerPanel
            store={store}
            skills={skills}
            commit={commit}
            setNotice={setNotice}
            pluginStatus={pluginStatus}
            pluginOutput={pluginOutput}
            requestPluginStatus={requestPluginStatus}
          />
        )}
        {activeTab === 'mcps' && <McpPanel store={store} commit={commit} setNotice={setNotice} />}
        {activeTab === 'settings' && (
          <SettingsPanel
            store={store}
            paths={paths}
            commit={commit}
            scanSkills={scanSkills}
            setNotice={setNotice}
          />
        )}
      </main>

      {launcherOpen && (
        <LauncherModal
          store={store}
          skills={skills}
          close={() => setLauncherOpen(false)}
          setActiveTab={setActiveTab}
          copyToClipboard={copyToClipboard}
        />
      )}
    </div>
  )
}

function PromptPanel({
  store,
  commit,
  setNotice
}: {
  store: AppStore
  commit: (store: AppStore) => Promise<void>
  setNotice: (notice: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [editing, setEditing] = useState<PromptItem | null>(null)
  const [githubQuery, setGithubQuery] = useState('codex prompt')
  const [githubResults, setGithubResults] = useState<GithubSearchResult[]>([])
  const [githubBusy, setGithubBusy] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptGroups = mergeGroupsWithTags(store.groups.prompts, allTags(store.prompts))
  const effectiveTags = selectedGroup === 'all' ? [] : [selectedGroup]
  const visiblePrompts = store.prompts.filter((prompt) => matchesTextAndTags(prompt, query, effectiveTags))

  async function savePrompt(prompt: PromptItem): Promise<void> {
    const nextPrompt = {
      ...prompt,
      variables: extractVariables(prompt.content),
      version: prompt.version + 1,
      updatedAt: nowIso()
    }
    await commit({
      ...store,
      prompts: store.prompts.map((item) => (item.id === nextPrompt.id ? nextPrompt : item))
    })
    setEditing(null)
  }

  async function createNewPrompt(): Promise<void> {
    const prompt = createPrompt()
    await commit({ ...store, prompts: [prompt, ...store.prompts] })
    setEditing(prompt)
  }

  async function deletePrompt(prompt: PromptItem): Promise<void> {
    await commit({ ...store, prompts: store.prompts.filter((item) => item.id !== prompt.id) })
    setEditing(null)
  }

  async function updateGroups(groups: GroupItem[]): Promise<void> {
    await commit({ ...store, groups: { ...store.groups, prompts: groups } })
  }

  async function deleteGroup(group: GroupItem): Promise<void> {
    const tags = collectGroupTags(group)
    await commit({
      ...store,
      prompts: store.prompts.map((prompt) => ({
        ...prompt,
        tags: prompt.tags.filter((tag) => !tags.includes(tag)),
        updatedAt: nowIso()
      })),
      groups: {
        ...store.groups,
        prompts: removeGroupById(store.groups.prompts, group.id)
      }
    })
    if (tags.includes(selectedGroup)) setSelectedGroup('all')
  }

  async function runPromptImport(loader: () => Promise<ImportResult<PromptItem>>): Promise<void> {
    try {
      const result = await loader()
      setNotice(result.message)
      if (!result.ok) return
      const { merged, added } = mergePromptItems(store.prompts, result.items)
      await commit({ ...store, prompts: merged })
      if (added[0]) setEditing(added[0])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Prompt 导入失败')
    }
  }

  async function importPromptFilesFromBrowser(files: FileList | null, label: string): Promise<void> {
    if (!files || files.length === 0) return
    try {
      const imported: PromptItem[] = []
      for (const file of Array.from(files)) {
        imported.push(...parsePromptImport(await file.text(), file.name))
      }
      const { merged, added } = mergePromptItems(store.prompts, imported)
      await commit({ ...store, prompts: merged })
      setNotice(`${label}：导入 ${added.length} 个提示词`)
      if (added[0]) setEditing(added[0])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${label}失败`)
    }
  }

  async function discoverGithubPrompts(): Promise<void> {
    setGithubBusy(true)
    try {
      const results = await formatFlow.searchGithubPrompts(githubQuery)
      setGithubResults(results)
      setNotice(`GitHub 找到 ${results.length} 个 Prompt 候选`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'GitHub Prompt 搜索失败')
    } finally {
      setGithubBusy(false)
    }
  }

  async function importGithubPrompt(result: GithubSearchResult): Promise<void> {
    try {
      const imported = await formatFlow.importGithubPrompt(result)
      setNotice(imported.message)
      const { merged, added } = mergePromptItems(store.prompts, imported.items)
      await commit({ ...store, prompts: merged })
      if (added[0]) setEditing(added[0])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'GitHub Prompt 导入失败')
    }
  }

  return (
    <section className="panel library-layout">
      <ResourceGroupManager
        title="提示词分组"
        detail="分组可排序，也可建立小类"
        allLabel="全部提示词"
        allCount={store.prompts.length}
        groups={promptGroups}
        selectedTag={selectedGroup}
        countForTag={(tag) => store.prompts.filter((prompt) => prompt.tags.includes(tag)).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onDelete={deleteGroup}
      />

      <div className="library-main">
        <PanelHeader title="提示词管理" detail={`${visiblePrompts.length} / ${store.prompts.length} 个模板`} />
        <div className="toolbar-grid">
          <SearchBox query={query} setQuery={setQuery} placeholder="搜索标题、摘要、正文或标签" />
          <div className="group-selection-note">
            当前分组：{selectedGroup === 'all' ? '全部提示词' : selectedGroup}
          </div>
          <button className="primary-action" type="button" onClick={() => void createNewPrompt()}>
            新建提示词
          </button>
        </div>

        <div className="import-strip">
          <button type="button" onClick={() => (isBrowserReviewMode() ? restoreInputRef.current?.click() : void runPromptImport(formatFlow.restorePromptsFromBackup))}>
            从备份恢复
          </button>
          <button type="button" onClick={() => (isBrowserReviewMode() ? importInputRef.current?.click() : void runPromptImport(formatFlow.importExistingPrompts))}>
            导入已有
          </button>
          <input
            ref={restoreInputRef}
            className="hidden-file-input"
            type="file"
            accept=".json,.md,.txt"
            multiple
            onChange={(event) => {
              void importPromptFilesFromBrowser(event.currentTarget.files, '从备份恢复')
              event.currentTarget.value = ''
            }}
          />
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept=".json,.md,.txt"
            multiple
            onChange={(event) => {
              void importPromptFilesFromBrowser(event.currentTarget.files, '导入已有')
              event.currentTarget.value = ''
            }}
          />
          <input value={githubQuery} onChange={(event) => setGithubQuery(event.target.value)} aria-label="GitHub Prompt 查询" />
          <button type="button" disabled={githubBusy} onClick={() => void discoverGithubPrompts()}>
            {githubBusy ? '搜索中...' : '从 GitHub 发现 Prompt'}
          </button>
        </div>

        {githubResults.length > 0 && (
          <div className="github-results horizontal">
            {githubResults.map((result) => (
              <button key={result.id} type="button" onClick={() => void importGithubPrompt(result)}>
                <strong>{result.repository}</strong>
                <span>{result.path}</span>
              </button>
            ))}
          </div>
        )}

        <div className="tile-grid">
          {visiblePrompts.map((prompt) => (
            <article key={prompt.id} className="tile-card">
              <div>
                <strong>{prompt.title}</strong>
                <p>{prompt.summary}</p>
              </div>
              <TagRow tags={prompt.tags} />
              <div className="inline-actions">
                <button type="button" onClick={() => setEditing(prompt)}>
                  编辑
                </button>
                <button type="button" onClick={() => void navigator.clipboard.writeText(prompt.content)}>
                  复制
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {editing && (
        <PromptEditorModal
          prompt={editing}
          close={() => setEditing(null)}
          save={savePrompt}
          deletePrompt={deletePrompt}
        />
      )}
    </section>
  )
}

function SkillPanel({
  store,
  skills,
  commit,
  scanSkills,
  openPath,
  setNotice
}: {
  store: AppStore
  skills: SkillItem[]
  commit: (store: AppStore) => Promise<void>
  scanSkills: (directories?: string[]) => Promise<void>
  openPath: (path: string) => Promise<string>
  setNotice: (notice: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [editing, setEditing] = useState<SkillItem | null>(null)
  const [githubQuery, setGithubQuery] = useState('codex skill')
  const [githubResults, setGithubResults] = useState<GithubSearchResult[]>([])
  const [githubBusy, setGithubBusy] = useState(false)
  const skillGroups = mergeGroupsWithTags(store.groups.skills, allTags(skills))
  const effectiveTags = selectedGroup === 'all' ? [] : [selectedGroup]
  const visibleSkills = skills.filter((skill) => matchesTextAndTags(skill, query, effectiveTags))

  async function saveMetadata(skill: SkillItem, metadata: SkillMetadata): Promise<void> {
    await commit({
      ...store,
      skillIndex: {
        ...store.skillIndex,
        [skill.id]: metadata
      }
    })
    setEditing(null)
  }

  async function updateGroups(groups: GroupItem[]): Promise<void> {
    await commit({ ...store, groups: { ...store.groups, skills: groups } })
  }

  async function deleteGroup(group: GroupItem): Promise<void> {
    const tags = collectGroupTags(group)
    const nextSkillIndex = { ...store.skillIndex }
    for (const skill of skills) {
      const metadata = nextSkillIndex[skill.id] || { tags: skill.tags }
      nextSkillIndex[skill.id] = {
        ...metadata,
        tags: (metadata.tags || skill.tags).filter((tag) => !tags.includes(tag))
      }
    }
    await commit({
      ...store,
      skillIndex: nextSkillIndex,
      groups: {
        ...store.groups,
        skills: removeGroupById(store.groups.skills, group.id)
      }
    })
    if (tags.includes(selectedGroup)) setSelectedGroup('all')
  }

  async function applySkillImport(result: ImportResult<SkillItem>): Promise<void> {
    setNotice(result.message)
    if (!result.ok) return
    const directories = Array.from(
      new Set([...store.settings.skillDirectories, result.managedDirectory || '', ...(result.installedPaths || [])].filter(Boolean))
    )
    await commit({ ...store, settings: { ...store.settings, skillDirectories: directories } })
    await scanSkills(directories)
  }

  async function runSkillImport(loader: () => Promise<ImportResult<SkillItem>>): Promise<void> {
    try {
      await applySkillImport(await loader())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Skill 导入失败')
    }
  }

  async function discoverGithubSkills(): Promise<void> {
    setGithubBusy(true)
    try {
      const results = await formatFlow.searchGithubSkills(githubQuery)
      setGithubResults(results)
      setNotice(`GitHub 找到 ${results.length} 个 Skill 候选`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'GitHub Skill 搜索失败')
    } finally {
      setGithubBusy(false)
    }
  }

  async function installGithubSkill(result: GithubSearchResult): Promise<void> {
    try {
      await applySkillImport(await formatFlow.installGithubSkill(result))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'GitHub Skill 安装失败')
    }
  }

  return (
    <section className="panel library-layout">
      <ResourceGroupManager
        title="Skill 分组"
        detail="Skill 分组可排序，也可建立小类"
        allLabel="全部 Skill"
        allCount={skills.length}
        groups={skillGroups}
        selectedTag={selectedGroup}
        countForTag={(tag) => skills.filter((skill) => skill.tags.includes(tag)).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onDelete={deleteGroup}
        footer={
          <button className="primary-action" type="button" onClick={() => void scanSkills()}>
            重新扫描 Skill
          </button>
        }
      />

      <div className="library-main">
        <PanelHeader title="Skill 管理" detail={`${visibleSkills.length} / ${skills.length} 个 Skill`} />
        <SearchBox query={query} setQuery={setQuery} placeholder="搜索 Skill 名称、摘要或标签" />
        <div className="import-strip">
          <button type="button" onClick={() => void runSkillImport(formatFlow.restoreSkillsFromBackup)}>
            从备份恢复
          </button>
          <button type="button" onClick={() => void runSkillImport(formatFlow.installSkillZip)}>
            从 ZIP 安装
          </button>
          <button type="button" onClick={() => void runSkillImport(formatFlow.importExistingSkills)}>
            导入已有
          </button>
          <input value={githubQuery} onChange={(event) => setGithubQuery(event.target.value)} aria-label="GitHub Skill 查询" />
          <button type="button" disabled={githubBusy} onClick={() => void discoverGithubSkills()}>
            {githubBusy ? '搜索中...' : '从 GitHub 发现 Skill'}
          </button>
        </div>

        {githubResults.length > 0 && (
          <div className="github-results horizontal">
            {githubResults.map((result) => (
              <button key={result.id} type="button" onClick={() => void installGithubSkill(result)}>
                <strong>{result.repository}</strong>
                <span>{result.path}</span>
              </button>
            ))}
          </div>
        )}

        <div className="tile-grid">
          {visibleSkills.map((skill) => (
            <article key={skill.id} className="tile-card">
              <div>
                <strong>{skill.title}</strong>
                <p>{skill.summary}</p>
              </div>
              <TagRow tags={skill.tags} />
              <div className="inline-actions">
                <button type="button" onClick={() => setEditing(skill)}>
                  编辑
                </button>
                <button type="button" onClick={() => void openPath(skill.path)}>
                  打开
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {editing && (
        <SkillEditorModal
          skill={editing}
          close={() => setEditing(null)}
          save={saveMetadata}
        />
      )}
    </section>
  )
}

function WorkflowPanel({
  store,
  skills,
  commit
}: {
  store: AppStore
  skills: SkillItem[]
  commit: (store: AppStore) => Promise<void>
}): JSX.Element {
  const [workflowId, setWorkflowId] = useState(store.workflows[0]?.id || '')
  const workflow = store.workflows.find((item) => item.id === workflowId) || store.workflows[0]
  const [selectedNodeId, setSelectedNodeId] = useState(workflow?.nodes[0]?.id || '')
  const [promptToAdd, setPromptToAdd] = useState(store.prompts[0]?.id || '')
  const [skillToCall, setSkillToCall] = useState('')
  const [mcpToCall, setMcpToCall] = useState('')
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId)

  useEffect(() => {
    if (!workflowId && store.workflows[0]) setWorkflowId(store.workflows[0].id)
  }, [workflowId, store.workflows])

  async function updateWorkflow(nextWorkflow: Workflow): Promise<void> {
    await commit({
      ...store,
      workflows: store.workflows.map((item) => (item.id === nextWorkflow.id ? nextWorkflow : item))
    })
  }

  async function createNewWorkflow(): Promise<void> {
    const next = createWorkflow()
    await commit({ ...store, workflows: [next, ...store.workflows] })
    setWorkflowId(next.id)
  }

  async function appendPromptNode(): Promise<void> {
    if (!workflow) return
    const prompt = store.prompts.find((item) => item.id === promptToAdd)
    const skill = skills.find((item) => item.id === skillToCall)
    const mcp = store.mcpServers.find((item) => item.id === mcpToCall)
    if (!prompt) return
    const nodes = [...workflow.nodes, nodeFromPrompt(prompt, workflow.nodes.length, skill, mcp)]
    await updateWorkflow({ ...workflow, nodes, edges: rebuildLinearEdges(nodes), updatedAt: nowIso() })
  }

  async function appendApprovalNode(): Promise<void> {
    if (!workflow) return
    const nodes = [...workflow.nodes, approvalNode(workflow.nodes.length)]
    await updateWorkflow({ ...workflow, nodes, edges: rebuildLinearEdges(nodes), updatedAt: nowIso() })
  }

  async function removeNode(nodeId: string): Promise<void> {
    if (!workflow) return
    const nodes = workflow.nodes.filter((node) => node.id !== nodeId)
    await updateWorkflow({ ...workflow, nodes, edges: rebuildLinearEdges(nodes), updatedAt: nowIso() })
  }

  async function updateSelectedNode(patch: Partial<WorkflowNode>): Promise<void> {
    if (!workflow || !selectedNode) return
    await updateWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((node) => (node.id === selectedNode.id ? { ...node, ...patch } : node)),
      updatedAt: nowIso()
    })
  }

  async function moveNode(nodeId: string, direction: -1 | 1): Promise<void> {
    if (!workflow) return
    const index = workflow.nodes.findIndex((node) => node.id === nodeId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= workflow.nodes.length) return
    const nodes = [...workflow.nodes]
    const [node] = nodes.splice(index, 1)
    nodes.splice(target, 0, node)
    const positioned = nodes.map((item, itemIndex) => ({ ...item, position: { x: itemIndex * 280, y: item.position.y } }))
    await updateWorkflow({ ...workflow, nodes: positioned, edges: rebuildLinearEdges(positioned), updatedAt: nowIso() })
  }

  function onNodeChanges(changes: NodeChange[]): void {
    if (!workflow) return
    const positions = new Map<string, { x: number; y: number }>()
    for (const change of changes) {
      if (change.type === 'position' && change.position) positions.set(change.id, change.position)
    }
    if (positions.size === 0) return
    void updateWorkflow({
      ...workflow,
      nodes: workflow.nodes.map((node) => (positions.has(node.id) ? { ...node, position: positions.get(node.id) || node.position } : node)),
      updatedAt: nowIso()
    })
  }

  function onConnect(connection: Connection): void {
    if (!workflow || !connection.source || !connection.target) return
    const edge = { id: `edge_${connection.source}_${connection.target}`, source: connection.source, target: connection.target }
    void updateWorkflow({ ...workflow, edges: [...workflow.edges.filter((item) => item.id !== edge.id), edge], updatedAt: nowIso() })
  }

  if (!workflow) {
    return (
      <section className="panel centered">
        <EmptyState title="还没有工作流" detail="创建一个工作流后开始编排。" />
        <button className="primary-action" type="button" onClick={() => void createNewWorkflow()}>
          新建工作流
        </button>
      </section>
    )
  }

  const flowNodes: FlowNode[] = workflow.nodes.map((node) => ({
    id: node.id,
    position: node.position,
    data: {
      label: (
        <FlowNodeCard
          node={node}
          skill={skills.find((skill) => skill.id === node.skillRefId)}
          mcp={store.mcpServers.find((mcp) => mcp.id === node.mcpRefId)}
        />
      )
    },
    style: {
      border: selectedNodeId === node.id ? '2px solid #165dff' : '1px solid rgba(18,18,18,0.14)',
      borderRadius: 18,
      background: node.type === 'approval' ? '#fff7df' : '#ffffff',
      color: '#121212',
      width: 240
    }
  }))

  const flowEdges: FlowEdge[] = workflow.edges.map((edge) => ({
    ...edge,
    animated: true,
    style: { stroke: '#165dff', strokeWidth: 2 }
  }))

  return (
    <section className="panel workflow-layout">
      <div className="workflow-toolbar">
        <div>
          <PanelHeader title="工作流编排" detail="提示词节点可选择调用哪个 Skill" />
          <div className="inline-actions">
            <select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>
              {store.workflows.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => void createNewWorkflow()}>
              新建工作流
            </button>
          </div>
        </div>

        <div className="node-adders workflow-adders">
          <select value={promptToAdd} onChange={(event) => setPromptToAdd(event.target.value)}>
            {store.prompts.map((prompt) => (
              <option key={prompt.id} value={prompt.id}>
                {prompt.title}
              </option>
            ))}
          </select>
          <select value={skillToCall} onChange={(event) => setSkillToCall(event.target.value)}>
            <option value="">不调用 Skill</option>
            {skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                调用：{skill.title}
              </option>
            ))}
          </select>
          <select value={mcpToCall} onChange={(event) => setMcpToCall(event.target.value)}>
            <option value="">不使用 MCP</option>
            {store.mcpServers.map((mcp) => (
              <option key={mcp.id} value={mcp.id}>
                MCP：{mcp.name}
              </option>
            ))}
          </select>
          <button className="primary-action" type="button" onClick={() => void appendPromptNode()}>
            添加提示词步骤
          </button>
          <button type="button" onClick={() => void appendApprovalNode()}>
            添加审查节点
          </button>
        </div>
      </div>

      <div className="workflow-main">
        <div className="flow-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            onNodesChange={onNodeChanges}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
          >
            <MiniMap pannable zoomable />
            <Controls />
            <Background gap={26} color="rgba(22, 93, 255, 0.09)" />
          </ReactFlow>
        </div>
        <aside className="inspector">
          <label>
            工作流标题
            <input value={workflow.title} onChange={(event) => void updateWorkflow({ ...workflow, title: event.target.value, updatedAt: nowIso() })} />
          </label>
          <label>
            工作流说明
            <textarea value={workflow.description} onChange={(event) => void updateWorkflow({ ...workflow, description: event.target.value, updatedAt: nowIso() })} />
          </label>
          <h3>执行顺序</h3>
          <div className="sequence-list">
            {workflow.nodes.map((node, index) => (
              <button key={node.id} type="button" className={node.id === selectedNodeId ? 'sequence-item active' : 'sequence-item'} onClick={() => setSelectedNodeId(node.id)}>
                <span>{index + 1}</span>
                <strong>{node.title}</strong>
              </button>
            ))}
          </div>
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              prompt={store.prompts.find((prompt) => prompt.id === selectedNode.refId)}
              skills={skills}
              mcps={store.mcpServers}
              updateNode={updateSelectedNode}
              removeNode={removeNode}
              moveNode={moveNode}
            />
          ) : (
            <EmptyState title="未选择节点" detail="点击工作流中的节点查看详情。" />
          )}
        </aside>
      </div>
    </section>
  )
}

function RunnerPanel({
  store,
  skills,
  commit,
  setNotice,
  pluginStatus,
  pluginOutput,
  requestPluginStatus
}: {
  store: AppStore
  skills: SkillItem[]
  commit: (store: AppStore) => Promise<void>
  setNotice: (notice: string) => void
  pluginStatus: AiPluginStatus
  pluginOutput: AiPluginOutput | null
  requestPluginStatus: () => void
}): JSX.Element {
  const [workflowId, setWorkflowId] = useState(store.workflows[0]?.id || '')
  const [targetKind, setTargetKind] = useState<'clipboard' | 'browser-plugin'>('clipboard')
  const [outputDraft, setOutputDraft] = useState('')
  const [reviewDraft, setReviewDraft] = useState('')
  const [reviewDialog, setReviewDialog] = useState<ReviewMessage[]>([])
  const lastPluginOutputRef = useRef<number>(0)
  const workflow = store.workflows.find((item) => item.id === workflowId) || store.workflows[0]
  const activeRun =
    store.runs.find((run) => run.workflowId === workflow?.id && run.status !== 'completed') ||
    store.runs.find((run) => run.workflowId === workflow?.id)
  const currentStep = activeRun?.steps[activeRun.currentStepIndex]
  const currentNode = workflow?.nodes.find((node) => node.id === currentStep?.nodeId)
  const previousOutput = activeRun && activeRun.currentStepIndex > 0 ? activeRun.steps[activeRun.currentStepIndex - 1].output : ''
  const executionPrompt = currentNode ? buildExecutionPrompt(currentNode, store.prompts, skills, previousOutput, store.mcpServers) : ''

  useEffect(() => {
    setOutputDraft(currentStep?.output || '')
    setReviewDraft('')
    setReviewDialog([])
    lastPluginOutputRef.current = 0
  }, [activeRun?.id, currentStep?.id])

  useEffect(() => {
    if (!pluginOutput || pluginOutput.updatedAt <= lastPluginOutputRef.current) return
    lastPluginOutputRef.current = pluginOutput.updatedAt
    setOutputDraft(pluginOutput.text)
  }, [pluginOutput])

  async function startRun(): Promise<void> {
    if (!workflow) return
    const timestamp = nowIso()
    const run = {
      id: `run_${Date.now()}`,
      workflowId: workflow.id,
      workflowTitle: workflow.title,
      status: 'reviewing' as const,
      currentStepIndex: 0,
      steps: createRunSteps(workflow),
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await commit({ ...store, runs: [run, ...store.runs] })
  }

  async function updateRun(steps: RunStep[], patch: Partial<typeof activeRun> = {}): Promise<void> {
    if (!activeRun) return
    const nextRun = { ...activeRun, ...patch, steps, updatedAt: nowIso() }
    await commit({ ...store, runs: store.runs.map((run) => (run.id === activeRun.id ? nextRun : run)) })
  }

  async function sendCurrentTask(): Promise<void> {
    if (!executionPrompt) return
    await navigator.clipboard.writeText(executionPrompt)
    if (targetKind === 'browser-plugin') {
      window.postMessage(
        {
          source: 'format-flow',
          type: 'FORMAT_FLOW_SEND_TASK',
          payload: {
            text: executionPrompt,
            workflowId: workflow?.id,
            workflowTitle: workflow?.title,
            stepTitle: currentStep?.title
          }
        },
        window.location.origin
      )
      setNotice('任务已发送给浏览器插件，同时已复制到剪贴板。若未安装插件，请先加载 browser-extension。')
    } else {
      setNotice('当前任务已复制到剪贴板')
    }
    await markCurrentRunning()
  }

  async function markCurrentRunning(): Promise<void> {
    if (!activeRun || !currentStep) return
    const steps = activeRun.steps.map((step, index) => {
      if (index !== activeRun.currentStepIndex) return step
      return {
        ...step,
        status: 'running' as const,
        reviewedByHuman: true,
        inputSnapshot: executionPrompt,
        startedAt: step.startedAt || nowIso()
      }
    })
    await updateRun(steps, { status: 'running' })
  }

  async function sendReviewMessage(): Promise<void> {
    const reviewText = reviewDraft.trim()
    if (!reviewText) return
    const message: ReviewMessage = {
      id: newId('review'),
      role: 'human',
      text: reviewText,
      createdAt: nowIso()
    }
    const linkedPrompt = [
      '人工审查意见：',
      reviewText,
      '',
      '请基于当前任务、上一轮输出和这条审查意见继续修正或补充。完成后输出可直接进入 Format Flow 的节点输出。'
    ].join('\n')

    setReviewDialog((items) => [...items, message])
    setReviewDraft('')
    await navigator.clipboard.writeText(linkedPrompt)
    if (targetKind === 'browser-plugin') {
      window.postMessage(
        {
          source: 'format-flow',
          type: 'FORMAT_FLOW_SEND_TASK',
          payload: {
            text: linkedPrompt,
            mode: 'review',
            workflowId: workflow?.id,
            workflowTitle: workflow?.title,
            stepTitle: currentStep?.title
          }
        },
        window.location.origin
      )
      setNotice('人工审查意见已发送给浏览器插件，同时已复制到剪贴板。')
      return
    }
    setNotice('人工审查意见已复制到剪贴板')
  }

  async function completeCurrent(): Promise<void> {
    if (!activeRun || !currentStep) return
    const isLast = activeRun.currentStepIndex >= activeRun.steps.length - 1
    const steps = activeRun.steps.map((step, index) =>
      index === activeRun.currentStepIndex ? { ...step, status: 'done' as const, output: outputDraft, finishedAt: nowIso() } : step
    )
    await updateRun(steps, {
      status: isLast ? 'completed' : 'reviewing',
      currentStepIndex: isLast ? activeRun.currentStepIndex : activeRun.currentStepIndex + 1
    })
    setOutputDraft('')
  }

  async function failCurrent(): Promise<void> {
    if (!activeRun || !currentStep) return
    const steps = activeRun.steps.map((step, index) =>
      index === activeRun.currentStepIndex ? { ...step, status: 'failed' as const, output: outputDraft, finishedAt: nowIso() } : step
    )
    await updateRun(steps, { status: 'failed' })
  }

  return (
    <section className="panel runner-layout">
      <div className="runner-left">
        <PanelHeader title="顺序运行" detail="不再手动重复输入提示词；审查后自动生成并发送下一步" />
        <label>
          选择工作流
          <select value={workflow?.id || ''} onChange={(event) => setWorkflowId(event.target.value)}>
            {store.workflows.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          连接方式
          <select value={targetKind} onChange={(event) => setTargetKind(event.target.value as 'clipboard' | 'browser-plugin')}>
            <option value="clipboard">剪贴板连接</option>
            <option value="browser-plugin">浏览器插件连接</option>
          </select>
        </label>
        <p className="hint">
          剪贴板连接只复制当前任务；浏览器插件连接会把任务发给已加载的 Format Flow Browser Bridge 插件，由插件注入已打开的 AI 网页输入框。
        </p>
        {targetKind === 'browser-plugin' && (
          <div className={pluginStatus.connected ? 'plugin-status connected' : 'plugin-status'}>
            <span className="ai-icon">{pluginStatus.connected ? pluginStatus.aiIcon || 'AI' : 'AI'}</span>
            <div>
              <strong>
                {pluginStatus.connected
                  ? `已连接 ${pluginStatus.aiName || 'AI'}`
                  : pluginStatus.bridgeConnected
                    ? '插件已连接，未找到已打开的 AI 页面'
                    : '当前浏览器未连接扩展'}
              </strong>
              <small>
                {pluginStatus.message ||
                  pluginStatus.tabTitle ||
                  '请在已加载 browser-extension 的 Chrome/Edge 中打开当前地址，并打开受支持的 AI 网页。'}
              </small>
            </div>
            <button type="button" onClick={requestPluginStatus}>
              刷新
            </button>
            <button type="button" onClick={() => window.open('/extension-test-ai.html', '_blank', 'noopener,noreferrer')}>
              打开测试 AI 页
            </button>
          </div>
        )}
        <button className="primary-action" type="button" disabled={!workflow?.nodes.length} onClick={() => void startRun()}>
          创建运行记录
        </button>
        {activeRun ? (
          <div className="run-card">
            <strong>{activeRun.workflowTitle}</strong>
            <span>状态：{activeRun.status}</span>
            <div className="run-steps">
              {activeRun.steps.map((step, index) => (
                <div key={step.id} className={index === activeRun.currentStepIndex ? 'run-step active' : 'run-step'}>
                  <span>{index + 1}</span>
                  <strong>{step.title}</strong>
                  <small>{step.status}</small>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="暂无运行记录" detail="选择一个工作流并创建运行记录。" />
        )}
      </div>

      <div className="runner-right">
        {currentStep && currentNode ? (
          <>
            <PanelHeader title={currentStep.title} detail={currentStep.summary} />
            <label className="grow">
              待执行任务
              <textarea className="content-editor readonly" readOnly value={executionPrompt} />
            </label>
            <div className="review-dialog-panel">
              <div className="review-dialog-header">
                <strong>人工审查意见</strong>
                <span>第一次结果不满意时，在这里继续给已连接 AI 发修改意见。</span>
              </div>
              <div className="review-thread">
                {reviewDialog.length > 0 ? (
                  reviewDialog.map((message) => (
                    <div key={message.id} className={`review-message ${message.role}`}>
                      <strong>{message.role === 'human' ? '人工审查' : '系统'}</strong>
                      <p>{message.text}</p>
                    </div>
                  ))
                ) : (
                  <span>暂无审查对话。节点输出会由插件同步到下方文本框，也可手动编辑。</span>
                )}
              </div>
              <textarea
                value={reviewDraft}
                onChange={(event) => setReviewDraft(event.target.value)}
                placeholder="输入给 AI 的追加审查意见，例如：结果不够具体，请补充可执行步骤和风险说明。"
              />
              <div className="inline-actions">
                <button type="button" onClick={() => void sendReviewMessage()}>
                  发送审查意见
                </button>
              </div>
            </div>
            <label className="grow">
              节点输出
              <textarea
                value={outputDraft}
                onChange={(event) => setOutputDraft(event.target.value)}
                placeholder="浏览器插件同步的 AI 输出会写入这里；也可以人工修订后再标记完成。"
              />
            </label>
            <div className="inline-actions">
              <button type="button" onClick={() => void sendCurrentTask()}>
                发送当前任务
              </button>
              <button type="button" onClick={() => void completeCurrent()}>
                标记完成并进入下一步
              </button>
              <button className="danger" type="button" onClick={() => void failCurrent()}>
                标记失败
              </button>
            </div>
          </>
        ) : (
          <EmptyState title="没有可运行节点" detail="请先在工作流里添加节点。" />
        )}
      </div>
    </section>
  )
}

function McpPanel({
  store,
  commit,
  setNotice
}: {
  store: AppStore
  commit: (store: AppStore) => Promise<void>
  setNotice: (notice: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const [editing, setEditing] = useState<McpServer | null>(null)
  const mcpGroups = mergeGroupsWithTags(store.groups.mcps, allTags(store.mcpServers))
  const effectiveTags = selectedGroup === 'all' ? [] : [selectedGroup]
  const visibleServers = store.mcpServers.filter((server) =>
    matchesTextAndTags({ name: server.name, summary: `${server.command} ${server.url} ${server.transport}`, tags: server.tags }, query, effectiveTags)
  )

  async function saveMcp(server: McpServer): Promise<void> {
    const next = { ...server, updatedAt: nowIso() }
    await commit({ ...store, mcpServers: store.mcpServers.map((item) => (item.id === next.id ? next : item)) })
    setEditing(null)
  }

  async function createNewMcp(): Promise<void> {
    const server = createMcpServer()
    await commit({ ...store, mcpServers: [server, ...store.mcpServers] })
    setEditing(server)
  }

  async function deleteMcp(server: McpServer): Promise<void> {
    await commit({ ...store, mcpServers: store.mcpServers.filter((item) => item.id !== server.id) })
    setEditing(null)
  }

  async function updateGroups(groups: GroupItem[]): Promise<void> {
    await commit({ ...store, groups: { ...store.groups, mcps: groups } })
  }

  async function deleteGroup(group: GroupItem): Promise<void> {
    const tags = collectGroupTags(group)
    await commit({
      ...store,
      mcpServers: store.mcpServers.map((server) => ({
        ...server,
        tags: server.tags.filter((tag) => !tags.includes(tag)),
        updatedAt: nowIso()
      })),
      groups: {
        ...store.groups,
        mcps: removeGroupById(store.groups.mcps, group.id)
      }
    })
    if (tags.includes(selectedGroup)) setSelectedGroup('all')
  }

  async function importExistingMcp(): Promise<void> {
    try {
      const result = await formatFlow.importMcpConfig()
      setNotice(result.message)
      if (!result.ok) return
      const { merged, added } = mergeMcpItems(store.mcpServers, result.items)
      await commit({ ...store, mcpServers: merged })
      if (added[0]) setEditing(added[0])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'MCP 导入失败')
    }
  }

  async function restoreMcpFromBackup(): Promise<void> {
    try {
      const result = await formatFlow.restoreMcpFromBackup()
      setNotice(result.message)
      if (!result.ok) return
      const { merged, added } = mergeMcpItems(store.mcpServers, result.items)
      await commit({ ...store, mcpServers: merged })
      if (added[0]) setEditing(added[0])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'MCP 备份恢复失败')
    }
  }

  return (
    <section className="panel library-layout">
      <ResourceGroupManager
        title="MCP 分组"
        detail="MCP 分组可排序，也可建立小类"
        allLabel="全部 MCP"
        allCount={store.mcpServers.length}
        groups={mcpGroups}
        selectedTag={selectedGroup}
        countForTag={(tag) => store.mcpServers.filter((server) => server.tags.includes(tag)).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onDelete={deleteGroup}
        footer={
          <>
            <SearchBox query={query} setQuery={setQuery} placeholder="搜索 MCP 名称、命令、URL 或标签" />
            <button className="primary-action" type="button" onClick={() => void createNewMcp()}>
              添加 MCP
            </button>
            <button type="button" onClick={() => void importExistingMcp()}>
              导入已有 MCP
            </button>
            <button type="button" onClick={() => void restoreMcpFromBackup()}>
              从备份恢复 MCP
            </button>
          </>
        }
      />
      <div className="library-main">
        <PanelHeader title="MCP 服务" detail={`${visibleServers.length} / ${store.mcpServers.length} 个配置`} />
        <div className="tile-grid">
          {visibleServers.map((server) => (
            <article key={server.id} className="tile-card">
              <div>
                <strong>{server.name}</strong>
                <p>{server.url || [server.command, ...server.args].filter(Boolean).join(' ') || '未配置启动方式'}</p>
              </div>
              <TagRow tags={[server.transport, ...server.tags]} />
              <button type="button" onClick={() => setEditing(server)}>
                编辑
              </button>
            </article>
          ))}
        </div>
      </div>
      {editing && <McpEditorModal server={editing} close={() => setEditing(null)} save={saveMcp} deleteServer={deleteMcp} />}
    </section>
  )
}

function SettingsPanel({
  store,
  paths,
  commit,
  scanSkills,
  setNotice
}: {
  store: AppStore
  paths: AppPaths | null
  commit: (store: AppStore) => Promise<void>
  scanSkills: (directories: string[]) => Promise<void>
  setNotice: (notice: string) => void
}): JSX.Element {
  const [directoriesText, setDirectoriesText] = useState(store.settings.skillDirectories.join('\n'))
  const [shortcut, setShortcut] = useState(store.settings.shortcut)
  const [dataDirectory, setDataDirectory] = useState(store.settings.dataDirectory || '')
  const [backupDirectory, setBackupDirectory] = useState(store.settings.backupDirectory || '')
  const [gitBackupRemote, setGitBackupRemote] = useState(store.settings.gitBackupRemote || '')
  const [gitBackupBranch, setGitBackupBranch] = useState(store.settings.gitBackupBranch || 'main')
  const [gitBackupUserEmail, setGitBackupUserEmail] = useState(store.settings.gitBackupUserEmail || '2878705044@qq.com')
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return

    function onKeyDown(event: KeyboardEvent): void {
      event.preventDefault()
      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }
      setShortcut(shortcutFromKeyboardEvent(event))
      setCapturing(false)
    }

    function onPointerDown(event: PointerEvent): void {
      event.preventDefault()
      setShortcut(`MouseButton${event.button + 1}`)
      setCapturing(false)
      setNotice('已识别鼠标按键；Electron 全局快捷键注册主要支持键盘组合，鼠标键会作为记录保存。')
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [capturing, setNotice])

  async function saveDirectories(): Promise<void> {
    const directories = directoriesText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    await commit({ ...store, settings: { ...store.settings, skillDirectories: directories } })
    await scanSkills(directories)
  }

  async function saveShortcut(): Promise<void> {
    const result = await formatFlow.setShortcut(shortcut)
    if (result.ok) {
      await commit({ ...store, settings: { ...store.settings, shortcut: result.accelerator } })
    }
    setNotice(result.message)
  }

  async function chooseDataDirectory(): Promise<void> {
    if (isBrowserReviewMode() || !formatFlow.chooseDataDirectory) {
      setNotice('浏览器审查模式不能选择本地数据目录；桌面版中会打开目录选择器。')
      return
    }
    const result = await formatFlow.chooseDataDirectory()
    setNotice(result.message)
    if (!result.ok) return
    setDataDirectory(result.path)
    await commit({ ...store, settings: { ...store.settings, dataDirectory: result.path } })
  }

  async function saveDataDirectory(): Promise<void> {
    await commit({ ...store, settings: { ...store.settings, dataDirectory } })
    setNotice(dataDirectory ? '数据保存目录已保存' : '数据保存目录已恢复默认')
  }

  async function chooseBackupDirectory(): Promise<void> {
    if (isBrowserReviewMode() || !formatFlow.chooseBackupDirectory) {
      setNotice('浏览器审查模式不能选择本地备份目录；桌面版中会打开目录选择器。')
      return
    }
    const result = await formatFlow.chooseBackupDirectory()
    setNotice(result.message)
    if (!result.ok) return
    setBackupDirectory(result.path)
    await commit({ ...store, settings: { ...store.settings, backupDirectory: result.path } })
  }

  async function saveBackupDirectory(): Promise<void> {
    await commit({ ...store, settings: { ...store.settings, backupDirectory } })
    setNotice(backupDirectory ? '备份目录已保存' : '备份目录已恢复默认')
  }

  async function createBackupNow(): Promise<void> {
    const nextStore = backupSettingsStore(store, backupDirectory, gitBackupRemote, gitBackupBranch, gitBackupUserEmail)
    const result = await formatFlow.createBackup(nextStore)
    setNotice(result.message)
    if (result.ok) await commit(nextStore)
  }

  async function createGitBackupNow(): Promise<void> {
    const nextStore = backupSettingsStore(store, backupDirectory, gitBackupRemote, gitBackupBranch, gitBackupUserEmail)
    const result = await formatFlow.createGitBackup(nextStore)
    setNotice(result.message)
    if (result.ok) await commit(nextStore)
  }

  return (
    <section className="panel settings-layout">
      <div className="settings-card">
        <PanelHeader title="全局快捷键" detail="选中捕获框后按键，自动识别组合键" />
        <div className={capturing ? 'capture-box active' : 'capture-box'} onClick={() => setCapturing(true)} role="button" tabIndex={0}>
          {capturing ? '请按键盘组合键或鼠标键，Esc 取消' : shortcut}
        </div>
        <div className="inline-actions">
          <button type="button" onClick={() => setCapturing(true)}>
            开始捕获
          </button>
          <button className="primary-action" type="button" onClick={() => void saveShortcut()}>
            保存快捷键
          </button>
        </div>
        <p className="hint">按下快捷键后会弹出启动器：调用提示词 / 调用 Skill / 调用工作流。</p>
      </div>

      <div className="settings-card">
        <PanelHeader title="Skill 目录" detail="每行一个目录，扫描其中的 SKILL.md" />
        <textarea className="directory-editor" value={directoriesText} onChange={(event) => setDirectoriesText(event.target.value)} />
        <button className="primary-action" type="button" onClick={() => void saveDirectories()}>
          保存并重新扫描
        </button>
      </div>

      <div className="settings-card">
        <PanelHeader title="数据保存位置" detail="桌面版可选择数据保存目录；安装包阶段会保留这个选择入口" />
        <label>
          数据目录
          <input value={dataDirectory} onChange={(event) => setDataDirectory(event.target.value)} placeholder="留空使用默认 userData 目录" />
        </label>
        <div className="inline-actions">
          <button type="button" onClick={() => void chooseDataDirectory()}>
            选择目录
          </button>
          <button className="primary-action" type="button" onClick={() => void saveDataDirectory()}>
            保存数据目录
          </button>
        </div>
        <dl className="path-list">
          <dt>默认用户数据目录</dt>
          <dd>{paths?.userData}</dd>
          <dt>当前数据目录</dt>
          <dd>{paths?.dataDirectory}</dd>
          <dt>当前数据文件</dt>
          <dd>{paths?.storePath}</dd>
          <dt>托管 Skill 目录</dt>
          <dd>{paths?.managedSkillDirectory}</dd>
          <dt>数据目录偏好文件</dt>
          <dd>{paths?.dataDirectoryPreferencePath || '浏览器审查模式无本地偏好文件'}</dd>
        </dl>
      </div>

      <div className="settings-card">
        <PanelHeader title="备份目录" detail="用于备份提示词、Skill、MCP、分组和工作流；安装包阶段保留这个配置入口" />
        <label>
          备份目录
          <input value={backupDirectory} onChange={(event) => setBackupDirectory(event.target.value)} placeholder={paths?.defaultBackupDirectory || '留空使用默认 backups 目录'} />
        </label>
        <div className="inline-actions">
          <button type="button" onClick={() => void chooseBackupDirectory()}>
            选择备份目录
          </button>
          <button type="button" onClick={() => void saveBackupDirectory()}>
            保存备份目录
          </button>
          <button className="primary-action" type="button" onClick={() => void createBackupNow()}>
            立即备份
          </button>
        </div>
        <label>
          Git 远程仓库 URL
          <input
            value={gitBackupRemote}
            onChange={(event) => setGitBackupRemote(event.target.value)}
            placeholder="例如：https://github.com/账号/format-flow-backups.git"
          />
        </label>
        <div className="two-column compact">
          <label>
            Git 分支
            <input value={gitBackupBranch} onChange={(event) => setGitBackupBranch(event.target.value)} placeholder="main" />
          </label>
          <label>
            Git 邮箱
            <input value={gitBackupUserEmail} onChange={(event) => setGitBackupUserEmail(event.target.value)} placeholder="2878705044@qq.com" />
          </label>
        </div>
        <button type="button" onClick={() => void createGitBackupNow()}>
          通过 Git 备份
        </button>
        <p className="hint">
          生成的 JSON 可用于提示词恢复、MCP 恢复，以及 Skill 的“从备份恢复”。Git 备份会先提交到本地备份仓库；填写远程 URL 后再尝试 push。
        </p>
      </div>
    </section>
  )
}

function PromptEditorModal({
  prompt,
  close,
  save,
  deletePrompt
}: {
  prompt: PromptItem
  close: () => void
  save: (prompt: PromptItem) => Promise<void>
  deletePrompt: (prompt: PromptItem) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState(prompt)
  const [tagText, setTagText] = useState(tagsToText(prompt.tags))

  return (
    <Modal title="编辑提示词" close={close}>
      <label>
        标题
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        摘要
        <input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
      </label>
      <label>
        分类标签
        <input value={tagText} onChange={(event) => setTagText(event.target.value)} placeholder="codex, review" />
      </label>
      <label className="grow">
        正文
        <textarea className="content-editor" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
      </label>
      <div className="inline-actions">
        <button className="primary-action" type="button" onClick={() => void save({ ...draft, tags: parseTags(tagText) })}>
          保存
        </button>
        <button type="button" onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}>
          {draft.favorite ? '取消收藏' : '收藏'}
        </button>
        <button className="danger" type="button" onClick={() => void deletePrompt(draft)}>
          删除
        </button>
      </div>
    </Modal>
  )
}

function SkillEditorModal({
  skill,
  close,
  save
}: {
  skill: SkillItem
  close: () => void
  save: (skill: SkillItem, metadata: SkillMetadata) => Promise<void>
}): JSX.Element {
  const [summaryOverride, setSummaryOverride] = useState(skill.summary)
  const [tagText, setTagText] = useState(tagsToText(skill.tags))

  return (
    <Modal title={`编辑 Skill：${skill.title}`} close={close}>
      <label>
        摘要覆盖
        <input value={summaryOverride} onChange={(event) => setSummaryOverride(event.target.value)} />
      </label>
      <label>
        分类标签
        <input value={tagText} onChange={(event) => setTagText(event.target.value)} />
      </label>
      <div className="path-box">
        <span>{skill.path}</span>
      </div>
      <label className="grow">
        SKILL.md 预览
        <textarea className="content-editor readonly" readOnly value={skill.contentPreview} />
      </label>
      <div className="inline-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => void save(skill, { tags: parseTags(tagText), summaryOverride: summaryOverride.trim() })}
        >
          保存
        </button>
      </div>
    </Modal>
  )
}

function McpEditorModal({
  server,
  close,
  save,
  deleteServer
}: {
  server: McpServer
  close: () => void
  save: (server: McpServer) => Promise<void>
  deleteServer: (server: McpServer) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState(server)
  const [argsText, setArgsText] = useState(server.args.join('\n'))
  const [envText, setEnvText] = useState(envToText(server.env))
  const [tagText, setTagText] = useState(tagsToText(server.tags))

  return (
    <Modal title="编辑 MCP" close={close}>
      <label>
        名称
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label>
        Transport
        <select value={draft.transport} onChange={(event) => setDraft({ ...draft, transport: event.target.value as McpServer['transport'] })}>
          <option value="stdio">stdio</option>
          <option value="sse">sse</option>
          <option value="http">http</option>
        </select>
      </label>
      <label>
        Command
        <input value={draft.command} onChange={(event) => setDraft({ ...draft, command: event.target.value })} />
      </label>
      <label>
        URL
        <input value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} />
      </label>
      <label>
        工作目录
        <input value={draft.cwd} onChange={(event) => setDraft({ ...draft, cwd: event.target.value })} />
      </label>
      <label>
        Args（每行一个）
        <textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} />
      </label>
      <label>
        Env（KEY=VALUE，每行一个）
        <textarea value={envText} onChange={(event) => setEnvText(event.target.value)} />
      </label>
      <label>
        标签
        <input value={tagText} onChange={(event) => setTagText(event.target.value)} />
      </label>
      <div className="inline-actions">
        <button
          className="primary-action"
          type="button"
          onClick={() => void save({ ...draft, args: parseLines(argsText), env: parseEnvText(envText), tags: parseTags(tagText) })}
        >
          保存 MCP
        </button>
        <button type="button" onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}>
          {draft.enabled ? '禁用' : '启用'}
        </button>
        <button className="danger" type="button" onClick={() => void deleteServer(draft)}>
          删除
        </button>
      </div>
    </Modal>
  )
}

function NodeInspector({
  node,
  prompt,
  skills,
  mcps,
  updateNode,
  removeNode,
  moveNode
}: {
  node: WorkflowNode
  prompt?: PromptItem
  skills: SkillItem[]
  mcps: McpServer[]
  updateNode: (patch: Partial<WorkflowNode>) => Promise<void>
  removeNode: (nodeId: string) => Promise<void>
  moveNode: (nodeId: string, direction: -1 | 1) => Promise<void>
}): JSX.Element {
  const [tagText, setTagText] = useState(tagsToText(node.tags))
  const fullContent = prompt?.content || node.summary

  useEffect(() => {
    setTagText(tagsToText(node.tags))
  }, [node.id, node.tags])

  return (
    <div className="node-inspector">
      <h3>节点详情</h3>
      <label>
        标题
        <input value={node.title} onChange={(event) => void updateNode({ title: event.target.value })} />
      </label>
      {node.type === 'prompt' && (
        <>
          <label>
            调用 Skill
            <select value={node.skillRefId || ''} onChange={(event) => void updateNode({ skillRefId: event.target.value || undefined })}>
              <option value="">不调用 Skill</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            使用 MCP
            <select value={node.mcpRefId || ''} onChange={(event) => void updateNode({ mcpRefId: event.target.value || undefined })}>
              <option value="">不使用 MCP</option>
              {mcps.map((mcp) => (
                <option key={mcp.id} value={mcp.id}>
                  {mcp.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label>
        摘要
        <textarea value={node.summary} onChange={(event) => void updateNode({ summary: event.target.value })} />
      </label>
      <label>
        标签
        <input value={tagText} onChange={(event) => setTagText(event.target.value)} onBlur={() => void updateNode({ tags: parseTags(tagText) })} />
      </label>
      <label>
        完整内容
        <textarea className="node-preview readonly" readOnly value={fullContent} />
      </label>
      <div className="inline-actions wrap">
        <button type="button" onClick={() => void moveNode(node.id, -1)}>
          上移
        </button>
        <button type="button" onClick={() => void moveNode(node.id, 1)}>
          下移
        </button>
        <button className="danger" type="button" onClick={() => void removeNode(node.id)}>
          删除节点
        </button>
      </div>
    </div>
  )
}

function LauncherModal({
  store,
  skills,
  close,
  setActiveTab,
  copyToClipboard
}: {
  store: AppStore
  skills: SkillItem[]
  close: () => void
  setActiveTab: (tab: TabId) => void
  copyToClipboard: (text: string, success: string) => Promise<void>
}): JSX.Element {
  const [mode, setMode] = useState<LauncherMode>('prompt')
  const [query, setQuery] = useState('')
  const promptItems = store.prompts.filter((prompt) => matchesTextAndTags(prompt, query, []))
  const skillItems = skills.filter((skill) => matchesTextAndTags(skill, query, []))
  const workflowItems = store.workflows.filter((workflow) =>
    matchesTextAndTags({ title: workflow.title, summary: workflow.description, tags: workflow.tags }, query, [])
  )

  return (
    <Modal title="快捷调用" close={close}>
      <div className="launcher-tabs">
        <button className={mode === 'prompt' ? 'active' : ''} type="button" onClick={() => setMode('prompt')}>
          调用提示词
        </button>
        <button className={mode === 'skill' ? 'active' : ''} type="button" onClick={() => setMode('skill')}>
          调用 Skill
        </button>
        <button className={mode === 'workflow' ? 'active' : ''} type="button" onClick={() => setMode('workflow')}>
          调用工作流
        </button>
      </div>
      <SearchBox query={query} setQuery={setQuery} placeholder="搜索要调用的内容" />
      <div className="launcher-list">
        {mode === 'prompt' &&
          promptItems.map((prompt) => (
            <button key={prompt.id} type="button" onClick={() => void copyToClipboard(prompt.content, `已复制提示词：${prompt.title}`).then(close)}>
              <strong>{prompt.title}</strong>
              <span>{prompt.summary}</span>
            </button>
          ))}
        {mode === 'skill' &&
          skillItems.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() =>
                void copyToClipboard(`使用 Skill：${skill.name}\n路径：${skill.path}\n摘要：${skill.summary}`, `已复制 Skill 调用信息：${skill.title}`).then(close)
              }
            >
              <strong>{skill.title}</strong>
              <span>{skill.summary}</span>
            </button>
          ))}
        {mode === 'workflow' &&
          workflowItems.map((workflow) => (
            <button
              key={workflow.id}
              type="button"
              onClick={() => {
                const firstNode = workflow.nodes[0]
                const task = firstNode
                  ? buildExecutionPrompt(firstNode, store.prompts, skills, '', store.mcpServers)
                  : `调用工作流：${workflow.title}\n${workflow.description}`
                void copyToClipboard(task, `已复制工作流首个顺序运行任务：${workflow.title}`)
                setActiveTab('runner')
                close()
              }}
            >
              <strong>{workflow.title}</strong>
              <span>{workflow.description}</span>
            </button>
          ))}
      </div>
    </Modal>
  )
}

function FlowNodeCard({ node, skill, mcp }: { node: WorkflowNode; skill?: SkillItem; mcp?: McpServer }): JSX.Element {
  return (
    <div className="flow-node-card">
      <div className="node-kind">{node.type === 'prompt' ? 'prompt step' : node.type}</div>
      <strong>{node.title}</strong>
      <span>{node.summary}</span>
      {skill && <small>调用 Skill：{skill.title}</small>}
      {mcp && <small>使用 MCP：{mcp.name}</small>}
      <TagRow tags={node.tags.slice(0, 3)} />
    </div>
  )
}

function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }): JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" onClick={close}>
            关闭
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  )
}

function PanelHeader({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <header className="panel-header">
      <h2>{title}</h2>
      <p>{detail}</p>
    </header>
  )
}

function SearchBox({
  query,
  setQuery,
  placeholder
}: {
  query: string
  setQuery: (query: string) => void
  placeholder: string
}): JSX.Element {
  return (
    <label className="search-box">
      搜索
      <input value={query} placeholder={placeholder} onChange={(event) => setQuery(event.target.value)} />
    </label>
  )
}

function TagPicker({
  tags,
  selected,
  setSelected
}: {
  tags: string[]
  selected: string[]
  setSelected: (tags: string[]) => void
}): JSX.Element {
  if (tags.length === 0) return <div className="tag-picker empty">暂无标签</div>

  return (
    <div className="tag-picker">
      {tags.map((tag) => {
        const normalized = normalizeTag(tag)
        const active = selected.includes(normalized)
        return (
          <button
            key={normalized}
            className={active ? 'tag-chip active' : 'tag-chip'}
            type="button"
            onClick={() => setSelected(active ? selected.filter((item) => item !== normalized) : [...selected, normalized])}
          >
            {normalized}
          </button>
        )
      })}
    </div>
  )
}

function TagRow({ tags }: { tags: string[] }): JSX.Element {
  return (
    <div className="tag-row">
      {tags.slice(0, 5).map((tag) => (
        <span key={tag}>{tag}</span>
      ))}
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }): JSX.Element {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  )
}

function ResourceGroupManager({
  title,
  detail,
  allLabel,
  allCount,
  groups,
  selectedTag,
  countForTag,
  onSelect,
  onChange,
  onDelete,
  footer
}: {
  title: string
  detail: string
  allLabel: string
  allCount: number
  groups: GroupItem[]
  selectedTag: string
  countForTag: (tag: string) => number
  onSelect: (tag: string) => void
  onChange: (groups: GroupItem[]) => Promise<void>
  onDelete: (group: GroupItem) => Promise<void>
  footer?: ReactNode
}): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ group: GroupItem; x: number; y: number } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    function closeMenu(): void {
      setContextMenu(null)
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('keydown', closeMenu)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('keydown', closeMenu)
    }
  }, [contextMenu])

  async function addRootGroup(): Promise<void> {
    const name = window.prompt('新分组名称')
    if (!name?.trim()) return
    await onChange([...groups, groupFromTag(name)])
  }

  async function addChildGroup(parent: GroupItem): Promise<void> {
    const name = window.prompt(`给「${parent.name}」添加小类`)
    if (!name?.trim()) return
    await onChange(updateGroupById(groups, parent.id, (group) => ({ ...group, children: [...group.children, groupFromTag(name)] })))
  }

  async function moveGroup(group: GroupItem, direction: -1 | 1): Promise<void> {
    await onChange(moveGroupById(groups, group.id, direction))
  }

  return (
    <div className="library-sidebar">
      <PanelHeader title={title} detail={detail} />
      <button className={selectedTag === 'all' ? 'category active' : 'category'} type="button" onClick={() => onSelect('all')}>
        {allLabel}
        <span>{allCount}</span>
      </button>
      <div className="group-tree">
        {groups.map((group) => (
          <GroupTreeItem
            key={group.id}
            group={group}
            selectedTag={selectedTag}
            countForTag={countForTag}
            onSelect={onSelect}
            addChild={addChildGroup}
            moveGroup={moveGroup}
            deleteGroup={onDelete}
            openMenu={(menuGroup, event) => {
              event.preventDefault()
              setContextMenu({ group: menuGroup, x: event.clientX, y: event.clientY })
            }}
          />
        ))}
      </div>
      <button type="button" onClick={() => void addRootGroup()}>
        添加分组
      </button>
      {footer && <div className="group-footer">{footer}</div>}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => void moveGroup(contextMenu.group, -1).then(() => setContextMenu(null))}>
            上移
          </button>
          <button type="button" onClick={() => void moveGroup(contextMenu.group, 1).then(() => setContextMenu(null))}>
            下移
          </button>
          <button type="button" onClick={() => void addChildGroup(contextMenu.group).then(() => setContextMenu(null))}>
            添加小类
          </button>
          <button className="danger" type="button" onClick={() => void onDelete(contextMenu.group).then(() => setContextMenu(null))}>
            删除分组/小类
          </button>
        </div>
      )}
    </div>
  )
}

function GroupTreeItem({
  group,
  selectedTag,
  countForTag,
  onSelect,
  addChild,
  moveGroup,
  deleteGroup,
  openMenu,
  depth = 0
}: {
  group: GroupItem
  selectedTag: string
  countForTag: (tag: string) => number
  onSelect: (tag: string) => void
  addChild: (group: GroupItem) => Promise<void>
  moveGroup: (group: GroupItem, direction: -1 | 1) => Promise<void>
  deleteGroup: (group: GroupItem) => Promise<void>
  openMenu: (group: GroupItem, event: MouseEvent) => void
  depth?: number
}): JSX.Element {
  return (
    <div className="group-tree-item" style={{ marginLeft: depth * 14 }}>
      <div
        className={selectedTag === group.tag ? 'category group-row active' : 'category group-row'}
        onContextMenu={(event) => openMenu(group, event)}
        title="右键管理分组"
      >
        <button className="group-main" type="button" onClick={() => onSelect(group.tag)}>
          <span>{depth > 0 ? '└ ' : ''}{group.name}</span>
          <strong>{countForTag(group.tag)}</strong>
        </button>
        <button className="group-menu-trigger" type="button" onClick={(event) => openMenu(group, event)} aria-label="打开分组菜单">
          ⋯
        </button>
      </div>
      {group.children.map((child) => (
        <GroupTreeItem
          key={child.id}
          group={child}
          selectedTag={selectedTag}
          countForTag={countForTag}
          onSelect={onSelect}
          addChild={addChild}
          moveGroup={moveGroup}
          deleteGroup={deleteGroup}
          openMenu={openMenu}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

function mergeGroupsWithTags(groups: GroupItem[], tags: string[]): GroupItem[] {
  const existing = new Set(flattenGroups(groups).map((group) => group.tag))
  const missing = tags.filter((tag) => !existing.has(tag)).map(groupFromTag)
  return [...groups, ...missing]
}

function flattenGroups(groups: GroupItem[]): GroupItem[] {
  return groups.flatMap((group) => [group, ...flattenGroups(group.children)])
}

function collectGroupTags(group: GroupItem): string[] {
  return [group.tag, ...group.children.flatMap(collectGroupTags)]
}

function updateGroupById(groups: GroupItem[], id: string, update: (group: GroupItem) => GroupItem): GroupItem[] {
  return groups.map((group) =>
    group.id === id ? update(group) : { ...group, children: updateGroupById(group.children, id, update) }
  )
}

function removeGroupById(groups: GroupItem[], id: string): GroupItem[] {
  return groups
    .filter((group) => group.id !== id)
    .map((group) => ({ ...group, children: removeGroupById(group.children, id) }))
}

function moveGroupById(groups: GroupItem[], id: string, direction: -1 | 1): GroupItem[] {
  const index = groups.findIndex((group) => group.id === id)
  if (index >= 0) {
    const target = index + direction
    if (target < 0 || target >= groups.length) return groups
    const next = [...groups]
    const [group] = next.splice(index, 1)
    next.splice(target, 0, group)
    return next
  }
  return groups.map((group) => ({ ...group, children: moveGroupById(group.children, id, direction) }))
}

function mergePromptItems(existing: PromptItem[], imported: PromptItem[]): { merged: PromptItem[]; added: PromptItem[] } {
  const existingIds = new Set(existing.map((prompt) => prompt.id))
  const added = imported.map((prompt) => {
    const id = existingIds.has(prompt.id) ? newId('prompt') : prompt.id
    existingIds.add(id)
    return { ...prompt, id, updatedAt: nowIso() }
  })
  return { merged: [...added, ...existing], added }
}

function mergeMcpItems(existing: McpServer[], imported: McpServer[]): { merged: McpServer[]; added: McpServer[] } {
  const existingIds = new Set(existing.map((server) => server.id))
  const added = imported.map((server) => {
    const id = existingIds.has(server.id) ? newId('mcp') : server.id
    existingIds.add(id)
    return { ...server, id, updatedAt: nowIso() }
  })
  return { merged: [...added, ...existing], added }
}

function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function envToText(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    env[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim()
  }
  return env
}

function extractVariables(content: string): string[] {
  return Array.from(new Set(Array.from(content.matchAll(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g)).map((match) => match[1])))
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const key = normalizeShortcutKey(event.key)
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) parts.push(key)
  return parts.length ? parts.join('+') : key
}

function normalizeShortcutKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  return key.replace(/^Arrow/, '')
}

function eventMatchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  if (shortcut.startsWith('MouseButton')) return false
  const parts = shortcut.split('+')
  const key = parts.at(-1)
  const wantsCtrl = parts.includes('CommandOrControl') || parts.includes('Control')
  const wantsAlt = parts.includes('Alt')
  const wantsShift = parts.includes('Shift')
  return (
    Boolean(key) &&
    normalizeShortcutKey(event.key) === key &&
    (event.ctrlKey || event.metaKey) === wantsCtrl &&
    event.altKey === wantsAlt &&
    event.shiftKey === wantsShift
  )
}

function requestPluginStatus(): void {
  window.postMessage({ source: 'format-flow', type: 'FORMAT_FLOW_QUERY_STATUS' }, window.location.origin)
}

function normalizePluginStatus(payload?: Record<string, unknown>): AiPluginStatus {
  if (!payload) return { connected: false, message: '浏览器插件未连接' }
  return {
    bridgeConnected: Boolean(payload.bridgeConnected),
    connected: Boolean(payload.connected),
    aiName: typeof payload.aiName === 'string' ? payload.aiName : undefined,
    aiIcon: typeof payload.aiIcon === 'string' ? payload.aiIcon : undefined,
    tabTitle: typeof payload.tabTitle === 'string' ? payload.tabTitle : undefined,
    url: typeof payload.url === 'string' ? payload.url : undefined,
    message: typeof payload.message === 'string' ? payload.message : undefined
  }
}

function normalizePluginOutput(payload?: Record<string, unknown>): AiPluginOutput | null {
  if (!payload || typeof payload.text !== 'string' || !payload.text.trim()) return null
  return {
    text: payload.text,
    aiName: typeof payload.aiName === 'string' ? payload.aiName : undefined,
    aiIcon: typeof payload.aiIcon === 'string' ? payload.aiIcon : undefined,
    updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now()
  }
}

function backupSettingsStore(
  store: AppStore,
  backupDirectory: string,
  gitBackupRemote: string,
  gitBackupBranch: string,
  gitBackupUserEmail: string
): AppStore {
  return {
    ...store,
    settings: {
      ...store.settings,
      backupDirectory,
      gitBackupRemote,
      gitBackupBranch,
      gitBackupUserEmail
    }
  }
}

function getFormatFlowApi(): FormatFlowApi {
  if (window.formatFlow) return window.formatFlow
  return createBrowserFallbackApi() as FormatFlowApi
}

function isBrowserReviewMode(): boolean {
  return !window.formatFlow
}

function createBrowserFallbackApi(): Partial<FormatFlowApi> {
  let cachedStore = normalizeStore(readBrowserStore())
  const paths: AppPaths = {
    userData: 'browser-localStorage',
    dataDirectory: 'browser-localStorage',
    defaultBackupDirectory: 'browser-downloads',
    storePath: 'localStorage:format-flow-store',
    managedSkillDirectory: 'browser-review-mode',
    dataDirectoryPreferencePath: '',
    defaultSkillDirectories: []
  }

  return {
    loadStore: async () => cachedStore,
    saveStore: async (store: AppStore) => {
      cachedStore = normalizeStore(store)
      localStorage.setItem('format-flow-store', JSON.stringify(cachedStore))
      return cachedStore
    },
    getPaths: async () => paths,
    chooseDataDirectory: async () => ({
      ok: false,
      path: '',
      message: '浏览器审查模式不能选择本地数据目录；桌面版中会打开目录选择器。'
    }),
    chooseBackupDirectory: async () => ({
      ok: false,
      path: '',
      message: '浏览器审查模式不能选择本地备份目录；桌面版中会打开目录选择器。'
    }),
    createBackup: async (store: AppStore) => createBrowserBackup(store),
    createGitBackup: async (store: AppStore) => createBrowserBackup(store, true),
    scanSkills: async () => [],
    importExistingSkills: async () => desktopOnly('浏览器审查模式不能导入本地 Skill'),
    restoreSkillsFromBackup: async () => desktopOnly('浏览器审查模式不能恢复本地 Skill 备份'),
    installSkillZip: async () => desktopOnly('浏览器审查模式不能安装本地 ZIP'),
    searchGithubSkills: (query: string) => searchGithubFallback('skill', query),
    installGithubSkill: async (result: GithubSearchResult) => {
      const content = await fetchText(result.rawUrl)
      const skill: SkillItem = {
        id: `skill:${result.repository}/${result.path}`,
        name: result.name.replace(/\.md$/i, ''),
        title: result.name,
        summary: result.description,
        tags: ['github', 'skill'],
        path: result.htmlUrl,
        source: 'custom',
        contentPreview: content.slice(0, 12000),
        updatedAt: nowIso()
      }
      return { ok: true, message: `已导入 GitHub Skill 预览：${skill.title}`, items: [skill] }
    },
    importExistingPrompts: async () => desktopOnly('浏览器审查模式不能读取本地 Prompt 文件'),
    restorePromptsFromBackup: async () => desktopOnly('浏览器审查模式不能读取本地 Prompt 备份'),
    searchGithubPrompts: (query: string) => searchGithubFallback('prompt', query),
    importGithubPrompt: async (result: GithubSearchResult) => {
      const content = await fetchText(result.rawUrl)
      return { ok: true, message: `已导入 GitHub Prompt：${result.path}`, items: [createPromptFromText(content, result.path)] }
    },
    importMcpConfig: async () => desktopOnly('浏览器审查模式不能读取本地 MCP 配置'),
    restoreMcpFromBackup: async () => desktopOnly('浏览器审查模式不能读取本地 MCP 备份'),
    setShortcut: async (accelerator: string) => ({ ok: !accelerator.startsWith('MouseButton'), accelerator, message: '浏览器审查模式已保存快捷键预览' }),
    openPath: async () => '',
    onOpenLauncher: () => () => undefined
  }
}

function readBrowserStore(): Partial<AppStore> {
  const raw = localStorage.getItem('format-flow-store')
  if (!raw) return defaultStore()
  try {
    return JSON.parse(raw) as Partial<AppStore>
  } catch {
    return defaultStore()
  }
}

async function createBrowserBackup(store: AppStore, gitRequested = false): Promise<BackupResult> {
  const normalized = normalizeStore(store)
  const createdAt = nowIso()
  const payload = {
    format: 'format-flow-backup',
    version: 1,
    createdAt,
    prompts: normalized.prompts,
    skills: [],
    skillIndex: normalized.skillIndex,
    groups: normalized.groups,
    mcpServers: normalized.mcpServers,
    workflows: normalized.workflows,
    settings: normalized.settings
  }
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const fileName = `format-flow-backup-${createdAt.replace(/[:.]/g, '-')}.json`
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
  return {
    ok: true,
    message: gitRequested
      ? `浏览器审查模式已下载备份：${fileName}；Git 提交和 push 需要桌面版执行。`
      : `浏览器审查模式已下载备份：${fileName}`,
    path: fileName,
    pushed: false,
    remote: normalized.settings.gitBackupRemote
  }
}

async function desktopOnly<T>(message: string): Promise<ImportResult<T>> {
  return { ok: false, message, items: [] }
}

async function searchGithubFallback(kind: 'skill' | 'prompt', query: string): Promise<GithubSearchResult[]> {
  const repoQuery =
    kind === 'skill'
      ? `${query || 'codex skill'} codex skill in:name,description,readme`
      : `${query || 'prompt template'} prompt template in:name,description,readme`
  const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(repoQuery)}&sort=updated&per_page=8`, {
    headers: { Accept: 'application/vnd.github+json' }
  })
  if (!response.ok) throw new Error(`GitHub search failed: ${response.status} ${response.statusText}`)
  const payload = (await response.json()) as {
    items?: Array<{ id: number; full_name: string; description?: string; default_branch?: string; html_url: string }>
  }
  const results: GithubSearchResult[] = []
  for (const repo of payload.items || []) {
    const branch = repo.default_branch || 'main'
    const treeResponse = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${encodeURIComponent(branch)}?recursive=1`)
    if (!treeResponse.ok) continue
    const treePayload = (await treeResponse.json()) as { tree?: Array<{ path: string; type: string; sha: string }> }
    const files = (treePayload.tree || [])
      .filter((entry) => entry.type === 'blob')
      .filter((entry) => (kind === 'skill' ? /(^|\/)skill\.md$/i.test(entry.path) : /prompt|template|instruction/i.test(entry.path) && /\.(md|txt|json)$/i.test(entry.path)))
      .slice(0, 3)
    for (const file of files) {
      results.push({
        id: `${repo.id}:${file.sha}:${file.path}`,
        name: file.path.split('/').pop() || file.path,
        repository: repo.full_name,
        description: repo.description || file.path,
        path: file.path,
        htmlUrl: `${repo.html_url}/blob/${branch}/${file.path}`,
        rawUrl: `https://raw.githubusercontent.com/${repo.full_name}/${branch}/${file.path}`
      })
    }
    if (results.length >= 20) break
  }
  return results.slice(0, 20)
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  return response.text()
}
