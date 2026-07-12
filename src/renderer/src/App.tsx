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
  NodeKind,
  PromptItem,
  RunStep,
  SkillItem,
  SkillMetadata,
  Workflow,
  WorkflowNode
} from '@shared/types'

type TabId = 'prompts' | 'skills' | 'workflows' | 'runner' | 'mcps' | 'learning' | 'settings'
type LauncherMode = 'prompt' | 'skill' | 'workflow'
type QuickCallType = 'prompt' | 'skill' | 'workflow'
type LearningMethod = 'conversation-review' | 'engineering-cybernetics'
type ExportFormat = 'markdown' | 'txt' | 'json'
type FormatFlowApi = Window['formatFlow']
type AiPluginStatus = {
  bridgeConnected?: boolean
  connected: boolean
  aiName?: string
  aiIcon?: string
  tabTitle?: string
  url?: string
  quickCallFillOnly?: boolean
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
type LearningSource = {
  id: string
  title: string
  sourceName: string
  method: LearningMethod
  tags: string[]
  rawText: string
  sanitizedText: string
  abstractLogic: string
  scenarioLogic: string
  satisfied: boolean
  redactions: string[]
}
type LearningDraft = {
  skillName: string
  title: string
  description: string
  content: string
}
type QuickCallItem = {
  id: string
  type: QuickCallType
  title: string
  summary: string
  tags: string[]
}
type ShortcutCaptureInput = {
  key?: unknown
  code?: unknown
  control?: unknown
  meta?: unknown
  alt?: unknown
  shift?: unknown
}
type RecommendedShortcut = {
  accelerator: string
  title: string
  detail: string
}

const RECOMMENDED_SHORTCUTS: RecommendedShortcut[] = [
  {
    accelerator: 'CommandOrControl+Alt+Space',
    title: 'Ctrl + Alt + Space',
    detail: '推荐。和 Windows 系统菜单冲突少，适合频繁唤起。'
  },
  {
    accelerator: 'CommandOrControl+Shift+Space',
    title: 'Ctrl + Shift + Space',
    detail: '推荐。容易按，也不容易误触系统窗口菜单。'
  },
  {
    accelerator: 'CommandOrControl+Alt+K',
    title: 'Ctrl + Alt + K',
    detail: '推荐。字母键组合稳定，适合避开输入法和系统快捷键。'
  },
  {
    accelerator: 'CommandOrControl+Shift+K',
    title: 'Ctrl + Shift + K',
    detail: '推荐。适合作为第二选择，记忆成本低。'
  },
  {
    accelerator: 'Alt+Space',
    title: 'Alt + Space',
    detail: '可用但不优先推荐。Windows 默认会用它打开窗口系统菜单。'
  }
]

const formatFlow = getFormatFlowApi()
const appVersion = __APP_VERSION__

async function writeClipboardText(text: string): Promise<{ ok: boolean; message: string }> {
  if (!text.trim()) return { ok: false, message: '没有可复制的内容' }
  if (formatFlow.writeClipboardText) return formatFlow.writeClipboardText(text)
  try {
    await navigator.clipboard.writeText(text)
    return { ok: true, message: '已复制到剪贴板' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '写入剪贴板失败'
    }
  }
}

async function writeClipboardTextAndPaste(text: string): Promise<{ ok: boolean; message: string }> {
  if (!text.trim()) return { ok: false, message: '没有可粘贴的内容' }
  if (formatFlow.writeClipboardTextAndPaste) return formatFlow.writeClipboardTextAndPaste(text)
  return writeClipboardText(text)
}

async function queueBrowserPluginTask(payload: Record<string, unknown>): Promise<{ ok: boolean; message: string; status?: Record<string, unknown> }> {
  if (!isBrowserReviewMode() && formatFlow.queueBrowserBridgeTask) {
    return formatFlow.queueBrowserBridgeTask(payload)
  }

  window.postMessage(
    {
      source: 'format-flow',
      type: 'FORMAT_FLOW_SEND_TASK',
      payload
    },
    window.location.origin
  )
  return { ok: true, message: '任务已发送给浏览器插件。' }
}

async function getLiveBrowserPluginStatus(): Promise<AiPluginStatus | null> {
  if (isBrowserReviewMode() || !formatFlow.getBrowserBridgeStatus) return null
  try {
    return normalizePluginStatus(await formatFlow.getBrowserBridgeStatus())
  } catch {
    return null
  }
}

const tabs: Array<{ id: TabId; label: string; description: string }> = [
  { id: 'prompts', label: '提示词', description: '按分类标签管理、搜索和调用' },
  { id: 'skills', label: 'Skills', description: '扫描、导入、安装和索引 Skill' },
  { id: 'workflows', label: '工作流', description: '提示词节点选择调用哪个 Skill' },
  { id: 'runner', label: '顺序运行', description: '审查后自动发送下一步任务' },
  { id: 'mcps', label: 'MCP', description: '导入和添加 MCP 服务配置' },
  { id: 'learning', label: '学习', description: '从满意对话生成 Skill' },
  { id: 'settings', label: '设置', description: '快捷键、Skill 路径和数据位置' }
]

const activeTabStorageKey = 'format-flow-active-tab'

export function App(): JSX.Element {
  const [store, setStore] = useState<AppStore | null>(null)
  const [paths, setPaths] = useState<AppPaths | null>(null)
  const [rawSkills, setRawSkills] = useState<SkillItem[]>([])
  const [activeTab, setActiveTabState] = useState<TabId>(() => {
    const savedTab = localStorage.getItem(activeTabStorageKey)
    return tabs.some((tab) => tab.id === savedTab) ? (savedTab as TabId) : 'prompts'
  })
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
    function applyPluginOutput(payload?: Record<string, unknown> | null): void {
      if (!payload) return
      const output = normalizePluginOutput(payload)
      if (!output) return
      setPluginOutput(output)
      setPluginStatus((current) => ({
        ...current,
        connected: true,
        aiName: output.aiName || current.aiName,
        aiIcon: output.aiIcon || current.aiIcon,
        message: `${output.aiName || current.aiName || 'AI'} 输出已同步`
      }))
    }

    async function refreshPluginStatus(): Promise<void> {
      requestPluginStatus()
      if (isBrowserReviewMode() || !formatFlow.getBrowserBridgeStatus) return
      try {
        const [status, output] = await Promise.all([
          formatFlow.getBrowserBridgeStatus(),
          formatFlow.getBrowserBridgeOutput ? formatFlow.getBrowserBridgeOutput() : Promise.resolve(null)
        ])
        setPluginStatus(normalizePluginStatus(status))
        applyPluginOutput(output)
      } catch {
        setPluginStatus({
          bridgeConnected: false,
          connected: false,
          message: '本地浏览器桥接状态读取失败'
        })
      }
    }

    function onPluginMessage(event: MessageEvent): void {
      if (event.source !== window) return
      const data = event.data as { source?: string; type?: string; payload?: Record<string, unknown> }
      if (data?.source !== 'format-flow-extension') return

      if (data.type === 'FORMAT_FLOW_STATUS') {
        setPluginStatus(normalizePluginStatus(data.payload))
        return
      }

      if (data.type === 'FORMAT_FLOW_OUTPUT_SYNC') {
        applyPluginOutput(data.payload)
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
    void refreshPluginStatus()
    const missingBridgeTimer = window.setTimeout(() => {
      if (!isBrowserReviewMode()) {
        void refreshPluginStatus()
        return
      }
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
    const timer = window.setInterval(() => void refreshPluginStatus(), 3000)
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
  const activeTabMeta = tabs.find((tab) => tab.id === activeTab) || tabs[0]

  function setActiveTab(tab: TabId): void {
    localStorage.setItem(activeTabStorageKey, tab)
    setActiveTabState(tab)
  }

  async function commit(nextStore: AppStore): Promise<void> {
    const normalized = normalizeStore(nextStore)
    setStore(normalized)
    try {
      const saved = await formatFlow.saveStore(normalized)
      setStore(saved)
    } catch (error) {
      setNotice(`保存失败：${error instanceof Error ? error.message : '无法写入数据文件'}`)
      throw error
    }
  }

  async function scanSkills(directories = store?.settings.skillDirectories || []): Promise<void> {
    setNotice('正在扫描 Skill...')
    const scanned = await formatFlow.scanSkills(directories)
    setRawSkills(scanned)
    setNotice(`扫描完成：${scanned.length} 个 Skill`)
  }

  async function refreshPaths(): Promise<void> {
    setPaths(await formatFlow.getPaths())
  }

  async function pasteQuickCall(text: string, success: string): Promise<void> {
    setNotice('正在粘贴到上一个窗口...')
    const result = await writeClipboardTextAndPaste(text)
    if (!result.ok) {
      setNotice(result.message)
      throw new Error(result.message)
    }
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
            <div className="brand-title">
              <strong>Format Flow</strong>
              <span className="version-badge">v{appVersion}</span>
            </div>
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
        <header className="workspace-header">
          <div>
            <h1>{activeTabMeta.label}</h1>
            <p>{activeTabMeta.description}</p>
          </div>
          <div className="workspace-status">
            <span className={isBusy ? 'status-dot busy' : 'status-dot'} />
            <span>{notice}</span>
          </div>
        </header>
        <div className="workspace-content">
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
          {activeTab === 'workflows' && <WorkflowPanel store={store} skills={skills} commit={commit} setNotice={setNotice} />}
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
          {activeTab === 'learning' && (
            <LearningPanel store={store} commit={commit} scanSkills={scanSkills} setNotice={setNotice} />
          )}
          {activeTab === 'settings' && (
            <SettingsPanel
              store={store}
              paths={paths}
              commit={commit}
              scanSkills={scanSkills}
              refreshPaths={refreshPaths}
              setNotice={setNotice}
            />
          )}
        </div>
      </main>

      {launcherOpen && (
        <LauncherModal
          store={store}
          skills={skills}
          close={() => setLauncherOpen(false)}
          setActiveTab={setActiveTab}
          pasteQuickCall={pasteQuickCall}
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown')
  const restoreInputRef = useRef<HTMLInputElement | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const promptGroups = mergeGroupsWithTags(store.groups.prompts, allTags(store.prompts))
  const effectiveTags = selectedGroup === 'all' ? [] : [selectedGroup]
  const visiblePrompts = store.prompts.filter((prompt) => matchesTextAndTags(prompt, query, effectiveTags))
  const activePromptGroupTag = selectedGroup === 'all' ? '' : selectedGroup

  async function savePrompt(prompt: PromptItem): Promise<void> {
    try {
      const nextPrompt = {
        ...prompt,
        variables: extractVariables(prompt.content),
        version: prompt.version + 1,
        updatedAt: nowIso()
      }
      const exists = store.prompts.some((item) => item.id === nextPrompt.id)
      await commit({
        ...store,
        prompts: exists
          ? store.prompts.map((item) => (item.id === nextPrompt.id ? nextPrompt : item))
          : [nextPrompt, ...store.prompts]
      })
      setNotice(`已保存提示词：${nextPrompt.title}`)
      setEditing(null)
    } catch (error) {
      setNotice(error instanceof Error ? `提示词保存失败：${error.message}` : '提示词保存失败')
    }
  }

  async function createNewPrompt(): Promise<void> {
    try {
      const prompt = createPrompt({
        tags: activePromptGroupTag ? [activePromptGroupTag] : []
      })
      await commit({ ...store, prompts: [prompt, ...store.prompts] })
      setNotice(activePromptGroupTag ? `已在“${activePromptGroupTag}”分组中新建提示词，请编辑后保存` : '已创建新提示词，请编辑后保存')
      setEditing(prompt)
    } catch (error) {
      setNotice(error instanceof Error ? `新建提示词失败：${error.message}` : '新建提示词失败')
    }
  }

  async function deletePrompt(prompt: PromptItem): Promise<void> {
    await commit({ ...store, prompts: store.prompts.filter((item) => item.id !== prompt.id) })
    setEditing(null)
  }

  async function updateGroups(groups: GroupItem[]): Promise<void> {
    await commit({ ...store, groups: { ...store.groups, prompts: groups } })
  }

  async function createGroup(parent: GroupItem | null, group: GroupItem, groups: GroupItem[]): Promise<void> {
    await commit({
      ...store,
      prompts: parent
        ? store.prompts.map((prompt) =>
            prompt.tags.includes(parent.tag)
              ? { ...prompt, tags: mergeTags(prompt.tags, [group.tag]), updatedAt: nowIso() }
              : prompt
          )
        : store.prompts,
      groups: { ...store.groups, prompts: groups }
    })
  }

  async function renameGroup(group: GroupItem, renamedGroup: GroupItem, groups: GroupItem[]): Promise<void> {
    const nextTag = renamedGroup.tag
    await commit({
      ...store,
      prompts: store.prompts.map((prompt) => ({
        ...prompt,
        tags: replaceTag(prompt.tags, group.tag, nextTag),
        updatedAt: prompt.tags.includes(group.tag) ? nowIso() : prompt.updatedAt
      })),
      groups: { ...store.groups, prompts: groups }
    })
    if (selectedGroup === group.tag) setSelectedGroup(nextTag)
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
      const { merged, added } = mergePromptItems(store.prompts, addTagToPrompts(result.items, activePromptGroupTag))
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
      const { merged, added } = mergePromptItems(store.prompts, addTagToPrompts(imported, activePromptGroupTag))
      await commit({ ...store, prompts: merged })
      setNotice(`${label}：导入 ${added.length} 个提示词${activePromptGroupTag ? `到“${activePromptGroupTag}”分组` : ''}`)
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
      const { merged, added } = mergePromptItems(store.prompts, addTagToPrompts(imported.items, activePromptGroupTag))
      await commit({ ...store, prompts: merged })
      if (added[0]) setEditing(added[0])
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'GitHub Prompt 导入失败')
    }
  }

  async function exportPromptItems(items: PromptItem[], scope: string): Promise<void> {
    const result = await exportResourceFile({
      kind: 'prompts',
      scope,
      format: exportFormat,
      content: formatPromptsExport(items, exportFormat),
      emptyMessage: '没有可导出的提示词'
    })
    setNotice(result.message)
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
        countForTags={(tags) => store.prompts.filter((prompt) => prompt.tags.some((tag) => tags.includes(tag))).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onCreate={createGroup}
        onRename={renameGroup}
        onDelete={deleteGroup}
      />

      <div className="library-main">
        <PanelHeader title="提示词管理" detail={`${visiblePrompts.length} / ${store.prompts.length} 个模板`} />
        <div className="toolbar-grid">
          <SearchBox query={query} setQuery={setQuery} placeholder="搜索标题、摘要、正文或标签" />
          <div className="group-selection-note">
            当前分组：{selectedGroup === 'all' ? '全部提示词' : groupNameForTag(promptGroups, selectedGroup)}
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

        <div className="export-strip">
          <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)} aria-label="提示词导出格式">
            <option value="markdown">Markdown</option>
            <option value="txt">TXT</option>
            <option value="json">JSON</option>
          </select>
          <button type="button" onClick={() => void exportPromptItems(visiblePrompts, selectedGroup === 'all' && !query.trim() ? 'all' : 'filtered')}>
            导出当前列表
          </button>
          <button type="button" onClick={() => void exportPromptItems(store.prompts, 'all')}>
            导出全部提示词
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
                <button
                  type="button"
                  onClick={() =>
                    void writeClipboardText(prompt.content).then((result) =>
                      setNotice(result.ok ? `已复制提示词：${prompt.title}` : result.message)
                    )
                  }
                >
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
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown')
  const skillGroups = mergeGroupsWithTags(store.groups.skills, allTags(skills))
  const effectiveTags = selectedGroup === 'all' ? [] : [selectedGroup]
  const visibleSkills = skills.filter((skill) => matchesTextAndTags(skill, query, effectiveTags))
  const activeSkillGroupTag = selectedGroup === 'all' ? '' : selectedGroup

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

  async function renameGroup(group: GroupItem, renamedGroup: GroupItem, groups: GroupItem[]): Promise<void> {
    const nextTag = renamedGroup.tag
    const nextSkillIndex = { ...store.skillIndex }
    for (const skill of skills) {
      const metadata = nextSkillIndex[skill.id] || { tags: skill.tags }
      const tags = metadata.tags || skill.tags
      if (!tags.includes(group.tag)) continue
      nextSkillIndex[skill.id] = {
        ...metadata,
        tags: replaceTag(tags, group.tag, nextTag)
      }
    }
    await commit({
      ...store,
      skillIndex: nextSkillIndex,
      groups: { ...store.groups, skills: groups }
    })
    if (selectedGroup === group.tag) setSelectedGroup(nextTag)
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
    await commit({
      ...store,
      skillIndex: addTagToSkillIndex(store.skillIndex, result.items, activeSkillGroupTag),
      settings: { ...store.settings, skillDirectories: directories }
    })
    await scanSkills(directories)
    if (activeSkillGroupTag) setNotice(`${result.message}；已加入“${activeSkillGroupTag}”分组`)
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

  async function exportSkillItems(items: SkillItem[], scope: string): Promise<void> {
    const result = await exportResourceFile({
      kind: 'skills',
      scope,
      format: exportFormat,
      content: formatSkillsExport(items, exportFormat),
      emptyMessage: '没有可导出的 Skill'
    })
    setNotice(result.message)
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
        countForTags={(tags) => skills.filter((skill) => skill.tags.some((tag) => tags.includes(tag))).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onRename={renameGroup}
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

        <div className="export-strip">
          <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)} aria-label="Skill 导出格式">
            <option value="markdown">Markdown</option>
            <option value="txt">TXT</option>
            <option value="json">JSON</option>
          </select>
          <button type="button" onClick={() => void exportSkillItems(visibleSkills, selectedGroup === 'all' && !query.trim() ? 'all' : 'filtered')}>
            导出当前列表
          </button>
          <button type="button" onClick={() => void exportSkillItems(skills, 'all')}>
            导出全部 Skill
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
  commit,
  setNotice
}: {
  store: AppStore
  skills: SkillItem[]
  commit: (store: AppStore) => Promise<void>
  setNotice: (notice: string) => void
}): JSX.Element {
  const [workflowId, setWorkflowId] = useState(store.workflows[0]?.id || '')
  const workflow = store.workflows.find((item) => item.id === workflowId) || store.workflows[0]
  const [selectedNodeId, setSelectedNodeId] = useState(workflow?.nodes[0]?.id || '')
  const [promptToAdd, setPromptToAdd] = useState(store.prompts[0]?.id || '')
  const [skillToCall, setSkillToCall] = useState('')
  const [mcpToCall, setMcpToCall] = useState('')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('markdown')
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId)

  useEffect(() => {
    if (!workflowId && store.workflows[0]) setWorkflowId(store.workflows[0].id)
  }, [workflowId, store.workflows])

  async function updateWorkflow(nextWorkflow: Workflow): Promise<void> {
    const exists = store.workflows.some((item) => item.id === nextWorkflow.id)
    await commit({
      ...store,
      workflows: exists
        ? store.workflows.map((item) => (item.id === nextWorkflow.id ? nextWorkflow : item))
        : [nextWorkflow, ...store.workflows]
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

  async function exportWorkflowItems(items: Workflow[], scope: string): Promise<void> {
    const result = await exportResourceFile({
      kind: 'workflows',
      scope,
      format: exportFormat,
      content: formatWorkflowsExport(items, store, skills, exportFormat),
      emptyMessage: '没有可导出的工作流'
    })
    setNotice(result.message)
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
          <div className="export-strip compact">
            <select value={exportFormat} onChange={(event) => setExportFormat(event.target.value as ExportFormat)} aria-label="工作流导出格式">
              <option value="markdown">Markdown</option>
              <option value="txt">TXT</option>
              <option value="json">JSON</option>
            </select>
            <button type="button" onClick={() => void exportWorkflowItems([workflow], 'current')}>
              导出当前工作流
            </button>
            <button type="button" onClick={() => void exportWorkflowItems(store.workflows, 'all')}>
              导出全部工作流
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

  useEffect(() => {
    if (targetKind !== 'browser-plugin') return
    requestPluginStatus()
    const quickRefresh = window.setInterval(requestPluginStatus, 1200)
    const stopQuickRefresh = window.setTimeout(() => window.clearInterval(quickRefresh), 6000)
    return () => {
      window.clearInterval(quickRefresh)
      window.clearTimeout(stopQuickRefresh)
    }
  }, [targetKind, requestPluginStatus])

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
    const clipboardResult = await writeClipboardText(executionPrompt)
    if (!clipboardResult.ok) {
      setNotice(clipboardResult.message)
      return
    }
    if (targetKind === 'browser-plugin') {
      const result = await queueBrowserPluginTask({
        text: executionPrompt,
        workflowId: workflow?.id,
        workflowTitle: workflow?.title,
        stepTitle: currentStep?.title
      })
      setNotice(result.ok ? `${result.message} 同时已复制到剪贴板。` : result.message)
      if (!result.ok) return
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
    const clipboardResult = await writeClipboardText(linkedPrompt)
    if (!clipboardResult.ok) {
      setNotice(clipboardResult.message)
      return
    }
    if (targetKind === 'browser-plugin') {
      const result = await queueBrowserPluginTask({
        text: linkedPrompt,
        mode: 'review',
        workflowId: workflow?.id,
        workflowTitle: workflow?.title,
        stepTitle: currentStep?.title
      })
      setNotice(result.ok ? `${result.message} 同时已复制到剪贴板。` : result.message)
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

  async function renameGroup(group: GroupItem, renamedGroup: GroupItem, groups: GroupItem[]): Promise<void> {
    const nextTag = renamedGroup.tag
    await commit({
      ...store,
      mcpServers: store.mcpServers.map((server) => ({
        ...server,
        tags: replaceTag(server.tags, group.tag, nextTag),
        updatedAt: server.tags.includes(group.tag) ? nowIso() : server.updatedAt
      })),
      groups: { ...store.groups, mcps: groups }
    })
    if (selectedGroup === group.tag) setSelectedGroup(nextTag)
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
        countForTags={(tags) => store.mcpServers.filter((server) => server.tags.some((tag) => tags.includes(tag))).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onRename={renameGroup}
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

function LearningPanel({
  store,
  commit,
  scanSkills,
  setNotice
}: {
  store: AppStore
  commit: (store: AppStore) => Promise<void>
  scanSkills: (directories?: string[]) => Promise<void>
  setNotice: (notice: string) => void
}): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [sources, setSources] = useState<LearningSource[]>([])
  const [draft, setDraft] = useState<LearningDraft | null>(null)
  const [method, setMethod] = useState<LearningMethod>('conversation-review')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const learningGroups = mergeGroupsWithTags(store.groups.learning || [], allTags(sources))
  const visibleSources = selectedGroup === 'all' ? sources : sources.filter((source) => source.tags.includes(selectedGroup))
  const satisfiedSources = visibleSources.filter((source) => source.satisfied)
  const errorSources = visibleSources.filter((source) => !source.satisfied)
  const redactionCount = visibleSources.reduce((total, source) => total + source.redactions.length, 0)

  async function updateGroups(groups: GroupItem[]): Promise<void> {
    await commit({ ...store, groups: { ...store.groups, learning: groups } })
  }

  async function renameGroup(group: GroupItem, renamedGroup: GroupItem, groups: GroupItem[]): Promise<void> {
    const nextTag = renamedGroup.tag
    setSources((current) =>
      current.map((source) => ({
        ...source,
        tags: replaceTag(source.tags, group.tag, nextTag)
      }))
    )
    await commit({ ...store, groups: { ...store.groups, learning: groups } })
    if (selectedGroup === group.tag) setSelectedGroup(nextTag)
  }

  async function deleteGroup(group: GroupItem): Promise<void> {
    const tags = collectGroupTags(group)
    setSources((current) =>
      current.map((source) => ({
        ...source,
        tags: source.tags.filter((tag) => !tags.includes(tag))
      }))
    )
    await commit({ ...store, groups: { ...store.groups, learning: removeGroupById(store.groups.learning || [], group.id) } })
    if (tags.includes(selectedGroup)) setSelectedGroup('all')
  }

  function sourceTags(): string[] {
    return Array.from(new Set(['hermes', learningMethodTag(method), selectedGroup !== 'all' ? selectedGroup : ''].filter(Boolean)))
  }

  async function importLearningFiles(files: FileList | null): Promise<void> {
    if (!files?.length) return
    const imported: LearningSource[] = []
    for (const file of Array.from(files)) {
      const content = await file.text()
      imported.push(...extractLearningSources(content, file.name, method, sourceTags()))
    }
    setSources((current) => [...imported, ...current])
    setNotice(`已导入 ${imported.length} 条学习样本；默认只学习勾选“满意”的样本。`)
  }

  function importCompletedRuns(): void {
    const runSources = store.runs
      .filter((run) => run.status === 'completed' || run.steps.some((step) => step.output.trim()))
      .map((run) => createLearningSource(run.workflowTitle, '顺序运行记录', runToLearningText(run), run.status === 'completed', method, sourceTags()))
    setSources((current) => [...runSources, ...current])
    setNotice(`已导入 ${runSources.length} 条顺序运行记录；已完成记录默认标记为满意。`)
  }

  function toggleSatisfied(id: string): void {
    setSources((current) => current.map((source) => (source.id === id ? { ...source, satisfied: !source.satisfied } : source)))
  }

  function removeSource(id: string): void {
    setSources((current) => current.filter((source) => source.id !== id))
  }

  function toggleCurrentGroup(id: string): void {
    if (selectedGroup === 'all') return
    setSources((current) =>
      current.map((source) =>
        source.id === id ? { ...source, tags: toggleLearningTag(source.tags, selectedGroup, !source.tags.includes(selectedGroup)) } : source
      )
    )
  }

  function generateDraft(): void {
    if (satisfiedSources.length === 0 && errorSources.length === 0) {
      setNotice('请先导入对话样本，并标记满意或保留误差样本。')
      return
    }
    const nextDraft = buildLearningSkillDraft(satisfiedSources, method, errorSources)
    setDraft(nextDraft)
    setNotice(`Hermes 已基于 ${satisfiedSources.length} 条满意样本和 ${errorSources.length} 条误差样本生成 Skill 草稿，请审查后保存。`)
  }

  async function installDraft(): Promise<void> {
    if (!draft) return
    try {
      const result = await formatFlow.installGeneratedSkill(draft.skillName, draft.content)
      setNotice(result.message)
      if (!result.ok) return
      const directories = Array.from(
        new Set([...store.settings.skillDirectories, result.managedDirectory || '', ...(result.installedPaths || [])].filter(Boolean))
      )
      await commit({ ...store, settings: { ...store.settings, skillDirectories: directories } })
      await scanSkills(directories)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存学习 Skill 失败')
    }
  }

  return (
    <section className="panel learning-layout">
      <ResourceGroupManager
        title="学习分组"
        detail="Hermes 学习样本可按分组和小类管理"
        allLabel="全部学习样本"
        allCount={sources.length}
        groups={learningGroups}
        selectedTag={selectedGroup}
        countForTag={(tag) => sources.filter((source) => source.tags.includes(tag)).length}
        countForTags={(tags) => sources.filter((source) => source.tags.some((tag) => tags.includes(tag))).length}
        onSelect={setSelectedGroup}
        onChange={updateGroups}
        onRename={renameGroup}
        onDelete={deleteGroup}
      />
      <div className="learning-left">
        <PanelHeader
          title="Hermes 学习"
          detail="从满意对话中提炼你的使用习惯，先隐私清理，再生成可审查的 Skill。"
        />
        <div className="import-tools">
          <label>
            学习方式
            <select value={method} onChange={(event) => setMethod(event.target.value as LearningMethod)}>
              <option value="conversation-review">对话审查：学习标记为“满意”的对话</option>
              <option value="engineering-cybernetics">钱学森工程控制论：抽象底层逻辑和场景逻辑</option>
            </select>
          </label>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept=".json,.md,.txt"
            multiple
            onChange={(event) => {
              void importLearningFiles(event.currentTarget.files)
              event.currentTarget.value = ''
            }}
          />
          <button className="primary-action" type="button" onClick={() => fileInputRef.current?.click()}>
            导入 JSON / MD 对话
          </button>
          <button type="button" onClick={importCompletedRuns}>
            导入顺序运行记录
          </button>
          <div className="learning-stats">
            <span>当前分组样本：{visibleSources.length}</span>
            <span>满意：{satisfiedSources.length}</span>
            <span>误差：{errorSources.length}</span>
            <span>隐私替换：{redactionCount}</span>
          </div>
        </div>

        <div className="card-list">
          {visibleSources.length === 0 && <EmptyState title="暂无学习样本" detail="导入 JSON / MD 对话，或从顺序运行记录导入。" />}
          {visibleSources.map((source) => (
            <article key={source.id} className={source.satisfied ? 'learning-card satisfied' : 'learning-card'}>
              <div>
                <strong>{source.title}</strong>
                <span>{source.sourceName} · {learningMethodLabel(source.method)}</span>
              </div>
              <p>{source.sanitizedText.slice(0, 260) || '空样本'}</p>
              {source.method === 'engineering-cybernetics' && <p>{source.scenarioLogic}</p>}
              <TagRow tags={[source.satisfied ? '满意' : '未学习', ...source.tags.slice(0, 3), ...source.redactions.slice(0, 2)]} />
              <div className="inline-actions">
                <button type="button" onClick={() => toggleSatisfied(source.id)}>
                  {source.satisfied ? '取消满意' : '标记满意'}
                </button>
                {selectedGroup !== 'all' && (
                  <button type="button" onClick={() => toggleCurrentGroup(source.id)}>
                    {source.tags.includes(selectedGroup) ? '移出当前分组' : '加入当前分组'}
                  </button>
                )}
                <button className="danger" type="button" onClick={() => removeSource(source.id)}>
                  移除
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="learning-right">
        <PanelHeader title="Skill 草稿" detail="只使用当前分组中的满意样本；保存前可手动修改 Skill 内容。" />
        <div className="learning-rules">
          <strong>{learningMethodLabel(method)}</strong>
          <span>
            {method === 'conversation-review'
              ? '满意对话形成正向策略；不满意对话作为误差样本，形成不要做什么和纠偏规则。'
              : '先内置工程控制论核心思想，再把每次对话压缩为目标、状态、反馈、控制、约束和场景核心逻辑。'}
          </span>
          <span>邮箱、API key/token、密码/密钥字段、本地路径、账号/手机号会被替换为占位符。</span>
        </div>
        <button className="primary-action" type="button" disabled={visibleSources.length === 0} onClick={generateDraft}>
          生成 Skill 草稿
        </button>
        {draft ? (
          <>
            <div className="two-field-grid">
              <label>
                Skill 目录名
                <input value={draft.skillName} onChange={(event) => setDraft({ ...draft, skillName: event.target.value })} />
              </label>
              <label>
                标题
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
            </div>
            <label>
              描述
              <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
            </label>
            <label className="grow">
              SKILL.md 草稿
              <textarea
                className="content-editor"
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              />
            </label>
            <div className="inline-actions">
              <button className="primary-action" type="button" onClick={() => void installDraft()}>
                保存为 Skill
              </button>
              <button type="button" onClick={() => setDraft(null)}>
                丢弃草稿
              </button>
            </div>
          </>
        ) : (
          <EmptyState title="尚未生成草稿" detail="标记满意样本后点击“生成 Skill 草稿”。" />
        )}
      </div>
    </section>
  )
}

function SettingsPanel({
  store,
  paths,
  commit,
  scanSkills,
  refreshPaths,
  setNotice
}: {
  store: AppStore
  paths: AppPaths | null
  commit: (store: AppStore) => Promise<void>
  scanSkills: (directories: string[]) => Promise<void>
  refreshPaths: () => Promise<void>
  setNotice: (notice: string) => void
}): JSX.Element {
  const [skillDirectories, setSkillDirectories] = useState(() => normalizeSkillDirectories(store.settings.skillDirectories))
  const [manualSkillDirectory, setManualSkillDirectory] = useState('')
  const [shortcut, setShortcut] = useState(store.settings.shortcut)
  const [dataDirectory, setDataDirectory] = useState(store.settings.dataDirectory || '')
  const [backupDirectory, setBackupDirectory] = useState(store.settings.backupDirectory || '')
  const [gitBackupRemote, setGitBackupRemote] = useState(store.settings.gitBackupRemote || '')
  const [gitBackupBranch, setGitBackupBranch] = useState(store.settings.gitBackupBranch || 'main')
  const [gitBackupUserEmail, setGitBackupUserEmail] = useState(store.settings.gitBackupUserEmail || '2878705044@qq.com')
  const [capturing, setCapturing] = useState(false)
  const [recommendationsOpen, setRecommendationsOpen] = useState(false)

  useEffect(() => {
    if (!capturing) return

    void formatFlow.setShortcutCaptureActive?.(true)

    function applyShortcutInput(input: ShortcutCaptureInput): void {
      const nextShortcut = shortcutFromCaptureInput(input)
      setShortcut(nextShortcut)
      if (isModifierOnlyShortcut(nextShortcut)) return
      setCapturing(false)
    }

    const removeShortcutCaptureInput = formatFlow.onShortcutCaptureInput?.((input: Record<string, unknown>) => {
      applyShortcutInput(input as ShortcutCaptureInput)
    })

    function onKeyDown(event: KeyboardEvent): void {
      event.preventDefault()
      if (event.key === 'Escape') {
        setCapturing(false)
        return
      }
      applyShortcutInput(captureInputFromKeyboardEvent(event))
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
      void formatFlow.setShortcutCaptureActive?.(false)
      removeShortcutCaptureInput?.()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [capturing, setNotice])

  function addManualSkillDirectory(): void {
    const additions = normalizeSkillDirectories(manualSkillDirectory.split(/\r?\n/))
    if (additions.length === 0) {
      setNotice('请输入要添加的 Skill 目录')
      return
    }
    const nextDirectories = normalizeSkillDirectories([...skillDirectories, ...additions])
    const addedCount = nextDirectories.length - skillDirectories.length
    setSkillDirectories(nextDirectories)
    setManualSkillDirectory('')
    setNotice(addedCount > 0 ? `已添加 ${addedCount} 个 Skill 目录` : '没有新增目录，输入的目录已存在')
  }

  function removeSkillDirectory(directory: string): void {
    setSkillDirectories(skillDirectories.filter((item) => item !== directory))
  }

  function resetSkillDirectories(): void {
    const defaults = normalizeSkillDirectories(paths?.defaultSkillDirectories || [])
    setSkillDirectories(defaults)
    setNotice('已恢复默认 Skill 目录，保存后生效')
  }

  async function saveDirectories(): Promise<void> {
    const directories = normalizeSkillDirectories(skillDirectories)
    await commit({ ...store, settings: { ...store.settings, skillDirectories: directories } })
    await scanSkills(directories)
    setSkillDirectories(directories)
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
    await refreshPaths()
  }

  async function saveDataDirectory(): Promise<void> {
    await commit({ ...store, settings: { ...store.settings, dataDirectory } })
    await refreshPaths()
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

  async function openBrowserExtensionInstaller(): Promise<void> {
    if (!formatFlow.openBrowserExtensionInstaller) {
      setNotice('浏览器插件目录只在桌面安装版中可用。')
      return
    }
    const result = await formatFlow.openBrowserExtensionInstaller()
    setNotice(result.message)
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
          <button type="button" onClick={() => setRecommendationsOpen(true)}>
            推荐快捷键
          </button>
          <button className="primary-action" type="button" onClick={() => void saveShortcut()}>
            保存快捷键
          </button>
        </div>
        <p className="hint">按下快捷键后会弹出启动器：调用提示词 / 调用 Skill / 调用工作流。</p>
        <div className="path-box">
          <code>{paths?.browserExtensionDirectory || 'browser-extension'}</code>
          <button type="button" onClick={() => void openBrowserExtensionInstaller()}>
            安装浏览器插件
          </button>
        </div>
        {recommendationsOpen && (
          <RecommendedShortcutModal
            current={shortcut}
            close={() => setRecommendationsOpen(false)}
            select={(accelerator) => {
              setShortcut(accelerator)
              setRecommendationsOpen(false)
            }}
          />
        )}
      </div>

      <div className="settings-card skill-directory-card">
        <PanelHeader title="Skill 目录" detail="每行一个目录，扫描其中的 SKILL.md" />
        <div className="directory-list" aria-label="Skill 目录列表">
          {skillDirectories.length > 0 ? (
            skillDirectories.map((directory) => (
              <div className="directory-row" key={directory}>
                <code title={directory}>{directory}</code>
                <button type="button" onClick={() => removeSkillDirectory(directory)} aria-label={`移除 ${directory}`}>
                  移除
                </button>
              </div>
            ))
          ) : (
            <div className="directory-empty">尚未添加 Skill 目录</div>
          )}
        </div>
        <label>
          手动添加目录
          <textarea
            className="directory-editor compact"
            value={manualSkillDirectory}
            onChange={(event) => setManualSkillDirectory(event.target.value)}
            placeholder="可粘贴一个或多个目录，每行一个"
          />
        </label>
        <div className="inline-actions wrap">
          <button type="button" onClick={addManualSkillDirectory}>
            添加目录
          </button>
          <button type="button" onClick={resetSkillDirectories}>
            恢复默认
          </button>
        </div>
        <button className="primary-action" type="button" onClick={() => void saveDirectories()}>
          保存并重新扫描
        </button>
      </div>

      <div className="settings-card data-location-card">
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
          <dt>提示词分类目录</dt>
          <dd>{paths?.promptDirectory || '未加载'}</dd>
          <dt>工作流分类目录</dt>
          <dd>{paths?.workflowDirectory || '未加载'}</dd>
          <dt>Skill 元数据文件</dt>
          <dd>{paths?.skillMetadataPath || '未加载'}</dd>
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
  pasteQuickCall
}: {
  store: AppStore
  skills: SkillItem[]
  close: () => void
  setActiveTab: (tab: TabId) => void
  pasteQuickCall: (text: string, success: string) => Promise<void>
}): JSX.Element {
  const [mode, setMode] = useState<LauncherMode>('prompt')
  const [query, setQuery] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('all')
  const quickGroups = mergeGroupsWithTags(store.groups.quickCalls || [], allTags(buildQuickCallItems(store, skills)))
  const groupOptions = flattenGroups(quickGroups)
  const effectiveTags = selectedGroup === 'all' ? [] : [selectedGroup]
  const promptItems = store.prompts.filter((prompt) => matchesTextAndTags(prompt, query, effectiveTags))
  const skillItems = skills.filter((skill) => matchesTextAndTags(skill, query, effectiveTags))
  const workflowItems = store.workflows.filter((workflow) =>
    matchesTextAndTags({ title: workflow.title, summary: workflow.description, tags: workflow.tags }, query, effectiveTags)
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
      <label>
        快捷分组
        <select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}>
          <option value="all">全部快捷调用</option>
          {groupOptions.map((group) => (
            <option key={group.id} value={group.tag}>
              {group.name}
            </option>
          ))}
        </select>
      </label>
      <div className="launcher-list">
        {mode === 'prompt' &&
          promptItems.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onClick={() => void pasteQuickCall(prompt.content, `已粘贴提示词：${prompt.title}`).then(close).catch(() => undefined)}
            >
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
                void pasteQuickCall(`使用 Skill：${skill.name}\n路径：${skill.path}\n摘要：${skill.summary}`, `已粘贴 Skill 调用信息：${skill.title}`)
                  .then(close)
                  .catch(() => undefined)
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
                void pasteQuickCall(task, `已粘贴工作流首个顺序运行任务：${workflow.title}`)
                  .then(() => {
                    setActiveTab('runner')
                    close()
                  })
                  .catch(() => undefined)
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

function RecommendedShortcutModal({
  current,
  close,
  select
}: {
  current: string
  close: () => void
  select: (accelerator: string) => void
}): JSX.Element {
  return (
    <Modal title="推荐快捷键" close={close}>
      <div className="shortcut-recommendations">
        {RECOMMENDED_SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.accelerator}
            className={current === shortcut.accelerator ? 'shortcut-option active' : 'shortcut-option'}
            type="button"
            onClick={() => select(shortcut.accelerator)}
          >
            <strong>{shortcut.title}</strong>
            <span>{shortcut.detail}</span>
          </button>
        ))}
      </div>
    </Modal>
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
  countForTags,
  onSelect,
  onChange,
  onCreate,
  onRename,
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
  countForTags?: (tags: string[]) => number
  onSelect: (tag: string) => void
  onChange: (groups: GroupItem[]) => Promise<void>
  onCreate?: (parent: GroupItem | null, group: GroupItem, groups: GroupItem[]) => Promise<void>
  onRename?: (group: GroupItem, renamedGroup: GroupItem, groups: GroupItem[]) => Promise<void>
  onDelete: (group: GroupItem) => Promise<void>
  footer?: ReactNode
}): JSX.Element {
  const [contextMenu, setContextMenu] = useState<{ group: GroupItem; x: number; y: number } | null>(null)
  const [groupDraft, setGroupDraft] = useState<
    { mode: 'root'; name: string } | { mode: 'child'; parentId: string; parentName: string; name: string } | null
  >(null)
  const [renameDraft, setRenameDraft] = useState<{ group: GroupItem; name: string; error: string } | null>(null)
  const [moveDraft, setMoveDraft] = useState<{ group: GroupItem; targetParentId: string } | null>(null)
  const [draggedGroupId, setDraggedGroupId] = useState('')
  const [dragOverGroupId, setDragOverGroupId] = useState('')
  const rootDropTargetId = '__root__'
  const canDropGroupOnRoot = Boolean(draggedGroupId && !groups.some((group) => group.id === draggedGroupId))
  const isRootDropTarget = dragOverGroupId === rootDropTargetId && canDropGroupOnRoot

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

  async function saveGroupDraft(): Promise<void> {
    if (!groupDraft) return
    const name = groupDraft.name.trim()
    if (!name) return
    const nextGroup = createGroupFromName(name, groups)
    let nextGroups: GroupItem[]
    let parentGroup: GroupItem | null = null
    if (groupDraft.mode === 'root') {
      nextGroups = [...groups, nextGroup]
    } else {
      parentGroup = findGroupById(groups, groupDraft.parentId) || null
      nextGroups = updateGroupById(groups, groupDraft.parentId, (group) => ({
        ...group,
        children: [...group.children, nextGroup]
      }))
    }
    await (onCreate ? onCreate(parentGroup, nextGroup, nextGroups) : onChange(nextGroups))
    onSelect(nextGroup.tag)
    setGroupDraft(null)
  }

  function openChildGroupDialog(parent: GroupItem): void {
    setContextMenu(null)
    setGroupDraft({ mode: 'child', parentId: parent.id, parentName: parent.name, name: '' })
  }

  function openMoveGroupDialog(group: GroupItem): void {
    setContextMenu(null)
    setMoveDraft({ group, targetParentId: '' })
  }

  function openRenameGroupDialog(group: GroupItem): void {
    setContextMenu(null)
    setRenameDraft({ group, name: group.name, error: '' })
  }

  async function saveRenameGroup(): Promise<void> {
    if (!renameDraft) return
    const name = renameDraft.name.trim()
    const tag = normalizeTag(name)
    if (!tag) {
      setRenameDraft({ ...renameDraft, error: '请输入分组名称' })
      return
    }
    const nextGroups = renameGroupById(groups, renameDraft.group.id, tag)
    const renamedGroup = findGroupById(nextGroups, renameDraft.group.id)
    if (!renamedGroup) return
    await (onRename ? onRename(renameDraft.group, renamedGroup, nextGroups) : onChange(nextGroups))
    onSelect(renamedGroup.tag)
    setRenameDraft(null)
  }

  async function saveMoveGroup(): Promise<void> {
    if (!moveDraft) return
    const nextGroups = moveGroupToParent(groups, moveDraft.group.id, moveDraft.targetParentId || null)
    await onChange(nextGroups)
    onSelect(moveDraft.group.tag)
    setMoveDraft(null)
  }

  async function moveGroup(group: GroupItem, direction: -1 | 1): Promise<void> {
    await onChange(moveGroupById(groups, group.id, direction))
  }

  function canDropGroupOnTarget(targetGroup: GroupItem): boolean {
    const draggedGroup = findGroupById(groups, draggedGroupId)
    return Boolean(draggedGroup && draggedGroup.id !== targetGroup.id && !groupContainsId(draggedGroup, targetGroup.id))
  }

  async function dropGroupOnParent(targetParent: GroupItem): Promise<void> {
    const draggedGroup = findGroupById(groups, draggedGroupId)
    setDragOverGroupId('')
    setDraggedGroupId('')
    if (!draggedGroup || draggedGroup.id === targetParent.id || groupContainsId(draggedGroup, targetParent.id)) return
    await onChange(moveGroupToParent(groups, draggedGroup.id, targetParent.id))
    onSelect(draggedGroup.tag)
  }

  async function dropGroupOnRoot(): Promise<void> {
    const draggedGroup = findGroupById(groups, draggedGroupId)
    setDragOverGroupId('')
    setDraggedGroupId('')
    if (!draggedGroup || groups.some((group) => group.id === draggedGroup.id)) return
    await onChange(moveGroupToParent(groups, draggedGroup.id, null))
    onSelect(draggedGroup.tag)
  }

  const moveTargets = moveDraft ? availableGroupMoveTargets(groups, moveDraft.group.id) : []

  return (
    <div className="library-sidebar">
      <PanelHeader title={title} detail={detail} />
      <button
        className={[
          'category',
          selectedTag === 'all' ? 'active' : '',
          isRootDropTarget ? 'root-drop-target' : ''
        ].filter(Boolean).join(' ')}
        type="button"
        onClick={() => onSelect('all')}
        onDragOver={(event) => {
          if (!canDropGroupOnRoot) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDragOverGroupId(rootDropTargetId)
        }}
        onDragLeave={() => {
          if (dragOverGroupId === rootDropTargetId) setDragOverGroupId('')
        }}
        onDrop={(event) => {
          if (!canDropGroupOnRoot) return
          event.preventDefault()
          void dropGroupOnRoot()
        }}
        title="Drop a child group here to move it to the top level"
      >
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
            countForTags={countForTags}
            onSelect={onSelect}
            moveGroup={moveGroup}
            deleteGroup={onDelete}
            draggedGroupId={draggedGroupId}
            dragOverGroupId={dragOverGroupId}
            setDraggedGroupId={setDraggedGroupId}
            setDragOverGroupId={setDragOverGroupId}
            canDropGroupOnTarget={canDropGroupOnTarget}
            dropGroupOnParent={dropGroupOnParent}
            openMenu={(menuGroup, event) => {
              event.preventDefault()
              setContextMenu({ group: menuGroup, x: event.clientX, y: event.clientY })
            }}
          />
        ))}
      </div>
      <button type="button" onClick={() => setGroupDraft({ mode: 'root', name: '' })}>
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
          <button type="button" onClick={() => openChildGroupDialog(contextMenu.group)}>
            添加小类
          </button>
          <button type="button" onClick={() => openRenameGroupDialog(contextMenu.group)}>
            重命名
          </button>
          <button type="button" onClick={() => openMoveGroupDialog(contextMenu.group)}>
            移动到其他分组
          </button>
          <button className="danger" type="button" onClick={() => void onDelete(contextMenu.group).then(() => setContextMenu(null))}>
            删除分组/小类
          </button>
        </div>
      )}
      {groupDraft && (
        <Modal title={groupDraft.mode === 'root' ? '添加分组' : `给「${groupDraft.parentName}」添加小类`} close={() => setGroupDraft(null)}>
          <label className="form-field">
            名称
            <input
              autoFocus
              value={groupDraft.name}
              onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveGroupDraft()
                if (event.key === 'Escape') setGroupDraft(null)
              }}
            />
          </label>
          <div className="inline-actions">
            <button type="button" onClick={() => void saveGroupDraft()}>
              保存
            </button>
            <button type="button" onClick={() => setGroupDraft(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {renameDraft && (
        <Modal title={`重命名「${renameDraft.group.name}」`} close={() => setRenameDraft(null)}>
          <label className="form-field">
            新名称
            <input
              autoFocus
              value={renameDraft.name}
              onChange={(event) => setRenameDraft({ ...renameDraft, name: event.target.value, error: '' })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveRenameGroup()
                if (event.key === 'Escape') setRenameDraft(null)
              }}
            />
          </label>
          {renameDraft.error && <p className="form-error">{renameDraft.error}</p>}
          <div className="inline-actions">
            <button className="primary-action" type="button" onClick={() => void saveRenameGroup()}>
              保存
            </button>
            <button type="button" onClick={() => setRenameDraft(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {moveDraft && (
        <Modal title={`移动「${moveDraft.group.name}」`} close={() => setMoveDraft(null)}>
          <label className="form-field">
            目标位置
            <select
              autoFocus
              value={moveDraft.targetParentId}
              onChange={(event) => setMoveDraft({ ...moveDraft, targetParentId: event.target.value })}
            >
              <option value="">顶层分组</option>
              {moveTargets.map((target) => (
                <option key={target.group.id} value={target.group.id}>
                  {'　'.repeat(target.depth)}{target.group.name}
                </option>
              ))}
            </select>
          </label>
          <div className="inline-actions">
            <button className="primary-action" type="button" onClick={() => void saveMoveGroup()}>
              移动
            </button>
            <button type="button" onClick={() => setMoveDraft(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function GroupTreeItem({
  group,
  selectedTag,
  countForTag,
  countForTags,
  onSelect,
  moveGroup,
  deleteGroup,
  draggedGroupId,
  dragOverGroupId,
  setDraggedGroupId,
  setDragOverGroupId,
  canDropGroupOnTarget,
  dropGroupOnParent,
  openMenu,
  depth = 0
}: {
  group: GroupItem
  selectedTag: string
  countForTag: (tag: string) => number
  countForTags?: (tags: string[]) => number
  onSelect: (tag: string) => void
  moveGroup: (group: GroupItem, direction: -1 | 1) => Promise<void>
  deleteGroup: (group: GroupItem) => Promise<void>
  draggedGroupId: string
  dragOverGroupId: string
  setDraggedGroupId: (id: string) => void
  setDragOverGroupId: (id: string) => void
  canDropGroupOnTarget: (group: GroupItem) => boolean
  dropGroupOnParent: (group: GroupItem) => Promise<void>
  openMenu: (group: GroupItem, event: MouseEvent) => void
  depth?: number
}): JSX.Element {
  const isDragged = draggedGroupId === group.id
  const canDropHere = Boolean(draggedGroupId) && canDropGroupOnTarget(group)
  const isDropTarget = dragOverGroupId === group.id && canDropHere
  const groupTags = collectGroupTags(group)
  const groupCount = countForTags ? countForTags(groupTags) : groupTags.reduce((total, tag) => total + countForTag(tag), 0)

  return (
    <div className="group-tree-item" style={{ marginLeft: depth * 14 }}>
      <div
        className={[
          'category group-row',
          selectedTag === group.tag ? 'active' : '',
          isDragged ? 'dragging' : '',
          isDropTarget ? 'drop-target' : ''
        ].filter(Boolean).join(' ')}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', group.id)
          setDraggedGroupId(group.id)
        }}
        onDragEnd={() => {
          setDraggedGroupId('')
          setDragOverGroupId('')
        }}
        onDragOver={(event) => {
          if (!canDropHere) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDragOverGroupId(group.id)
        }}
        onDragLeave={() => {
          if (dragOverGroupId === group.id) setDragOverGroupId('')
        }}
        onDrop={(event) => {
          if (!canDropHere) return
          event.preventDefault()
          void dropGroupOnParent(group)
        }}
        onContextMenu={(event) => openMenu(group, event)}
        title="可拖动到其他分组下；右键管理分组"
      >
        <button className="group-main" type="button" onClick={() => onSelect(group.tag)}>
          <span>{depth > 0 ? '└ ' : ''}{group.name}</span>
          <strong>{groupCount}</strong>
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
          countForTags={countForTags}
          onSelect={onSelect}
          moveGroup={moveGroup}
          deleteGroup={deleteGroup}
          draggedGroupId={draggedGroupId}
          dragOverGroupId={dragOverGroupId}
          setDraggedGroupId={setDraggedGroupId}
          setDragOverGroupId={setDragOverGroupId}
          canDropGroupOnTarget={canDropGroupOnTarget}
          dropGroupOnParent={dropGroupOnParent}
          openMenu={openMenu}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

function buildQuickCallItems(store: AppStore, skills: SkillItem[]): QuickCallItem[] {
  return [
    ...store.prompts.map((prompt) => ({
      id: prompt.id,
      type: 'prompt' as const,
      title: prompt.title,
      summary: prompt.summary,
      tags: prompt.tags
    })),
    ...skills.map((skill) => ({
      id: skill.id,
      type: 'skill' as const,
      title: skill.title || skill.name,
      summary: skill.summary,
      tags: skill.tags
    })),
    ...store.workflows.map((workflow) => ({
      id: workflow.id,
      type: 'workflow' as const,
      title: workflow.title,
      summary: workflow.description,
      tags: workflow.tags
    }))
  ]
}

function mergeGroupsWithTags(groups: GroupItem[], tags: string[]): GroupItem[] {
  const uniqueGroups = ensureUniqueGroupTags(groups)
  const existing = new Set(flattenGroups(uniqueGroups).map((group) => group.tag))
  const missing = tags.filter((tag) => !existing.has(tag)).map(groupFromTag)
  return [...uniqueGroups, ...missing]
}

function flattenGroups(groups: GroupItem[]): GroupItem[] {
  return groups.flatMap((group) => [group, ...flattenGroups(group.children)])
}

function ensureUniqueGroupTags(groups: GroupItem[], usedTags = new Set<string>()): GroupItem[] {
  return groups.map((group) => {
    const name = normalizeTag(group.name) || normalizeTag(group.tag) || 'group'
    const tag = nextAvailableGroupTag(normalizeTag(group.tag) || name, usedTags)
    usedTags.add(tag)
    return {
      ...group,
      name,
      tag,
      children: ensureUniqueGroupTags(group.children, usedTags)
    }
  })
}

function collectGroupTags(group: GroupItem): string[] {
  return [group.tag, ...group.children.flatMap(collectGroupTags)]
}

function groupNameForTag(groups: GroupItem[], tag: string): string {
  return findGroupByTag(groups, tag)?.name || tag
}

function findGroupByTag(groups: GroupItem[], tag: string): GroupItem | undefined {
  for (const group of groups) {
    if (group.tag === tag) return group
    const child = findGroupByTag(group.children, tag)
    if (child) return child
  }
  return undefined
}

function createGroupFromName(name: string, groups: GroupItem[]): GroupItem {
  const normalizedName = normalizeTag(name) || 'group'
  return {
    id: newId('group'),
    name: normalizedName,
    tag: uniqueGroupTag(normalizedName, groups),
    children: []
  }
}

function uniqueGroupTag(name: string, groups: GroupItem[], excludeId = ''): string {
  const base = normalizeTag(name) || 'group'
  const existingTags = new Set(flattenGroups(groups).filter((group) => group.id !== excludeId).map((group) => group.tag))
  return nextAvailableGroupTag(base, existingTags)
}

function nextAvailableGroupTag(base: string, existingTags: Set<string>): string {
  if (!existingTags.has(base)) return base
  let index = 2
  while (existingTags.has(`${base}-${index}`)) {
    index += 1
  }
  return `${base}-${index}`
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

function renameGroupById(groups: GroupItem[], id: string, name: string): GroupItem[] {
  const normalizedName = normalizeTag(name) || 'group'
  const nextTag = uniqueGroupTag(normalizedName, groups, id)
  return updateGroupById(groups, id, (group) => ({
    ...group,
    name: normalizedName,
    tag: nextTag
  }))
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

function moveGroupToParent(groups: GroupItem[], groupId: string, targetParentId: string | null): GroupItem[] {
  const group = findGroupById(groups, groupId)
  if (!group) return groups
  if (targetParentId && (targetParentId === groupId || groupContainsId(group, targetParentId))) return groups

  const withoutGroup = removeGroupById(groups, groupId)
  if (!targetParentId) return [...withoutGroup, group]

  return updateGroupById(withoutGroup, targetParentId, (parent) => ({
    ...parent,
    children: [...parent.children, group]
  }))
}

function findGroupById(groups: GroupItem[], id: string): GroupItem | undefined {
  for (const group of groups) {
    if (group.id === id) return group
    const child = findGroupById(group.children, id)
    if (child) return child
  }
  return undefined
}

function groupContainsId(group: GroupItem, id: string): boolean {
  return group.children.some((child) => child.id === id || groupContainsId(child, id))
}

function availableGroupMoveTargets(groups: GroupItem[], movingGroupId: string): Array<{ group: GroupItem; depth: number }> {
  const movingGroup = findGroupById(groups, movingGroupId)
  return flattenGroupTargets(groups).filter(
    (target) => target.group.id !== movingGroupId && (!movingGroup || !groupContainsId(movingGroup, target.group.id))
  )
}

function flattenGroupTargets(groups: GroupItem[], depth = 0): Array<{ group: GroupItem; depth: number }> {
  return groups.flatMap((group) => [{ group, depth }, ...flattenGroupTargets(group.children, depth + 1)])
}

function addTagToPrompts(prompts: PromptItem[], tag: string): PromptItem[] {
  const normalizedTag = normalizeTag(tag)
  if (!normalizedTag) return prompts
  return prompts.map((prompt) => ({
    ...prompt,
    tags: mergeTags(prompt.tags, [normalizedTag]),
    updatedAt: nowIso()
  }))
}

function addTagToSkillIndex(skillIndex: Record<string, SkillMetadata>, skills: SkillItem[], tag: string): Record<string, SkillMetadata> {
  const normalizedTag = normalizeTag(tag)
  if (!normalizedTag || skills.length === 0) return skillIndex
  const nextSkillIndex = { ...skillIndex }
  for (const skill of skills) {
    const metadata = nextSkillIndex[skill.id]
    nextSkillIndex[skill.id] = {
      ...metadata,
      tags: mergeTags(metadata?.tags || skill.tags, [normalizedTag])
    }
  }
  return nextSkillIndex
}

function mergeTags(existing: string[], additions: string[]): string[] {
  return Array.from(new Set([...existing, ...additions].map(normalizeTag).filter(Boolean)))
}

function replaceTag(tags: string[], oldTag: string, newTag: string): string[] {
  const normalizedOldTag = normalizeTag(oldTag)
  const normalizedNewTag = normalizeTag(newTag)
  return Array.from(new Set(tags.map((tag) => (normalizeTag(tag) === normalizedOldTag ? normalizedNewTag : normalizeTag(tag))).filter(Boolean)))
}

async function exportResourceFile({
  kind,
  scope,
  format,
  content,
  emptyMessage
}: {
  kind: 'prompts' | 'skills' | 'workflows'
  scope: string
  format: ExportFormat
  content: string
  emptyMessage: string
}): Promise<{ ok: boolean; message: string; path?: string }> {
  if (!content.trim()) return { ok: false, message: emptyMessage }
  const extension = exportExtension(format)
  return formatFlow.exportTextFile({
    fileName: `format-flow-${kind}-${scope}-${exportTimestamp()}.${extension}`,
    content,
    filters: [{ name: exportFormatName(format), extensions: [extension] }]
  })
}

function formatPromptsExport(prompts: PromptItem[], format: ExportFormat): string {
  if (prompts.length === 0) return ''
  if (format === 'json') {
    return `${JSON.stringify({ format: 'format-flow-prompts', exportedAt: nowIso(), prompts }, null, 2)}\n`
  }
  if (format === 'txt') {
    return [
      `Format Flow Prompts`,
      `Exported: ${nowIso()}`,
      `Count: ${prompts.length}`,
      '',
      ...prompts.flatMap((prompt, index) => [
        `${index + 1}. ${prompt.title}`,
        `Summary: ${prompt.summary || ''}`,
        `Tags: ${formatTags(prompt.tags)}`,
        `Variables: ${formatTags(prompt.variables)}`,
        `Version: ${prompt.version}`,
        `Updated: ${prompt.updatedAt}`,
        '',
        prompt.content,
        '',
        '---',
        ''
      ])
    ].join('\n')
  }
  return [
    '# Format Flow Prompts',
    '',
    `- Exported: ${nowIso()}`,
    `- Count: ${prompts.length}`,
    '',
    ...prompts.flatMap((prompt, index) => [
      `## ${index + 1}. ${prompt.title}`,
      '',
      `- Summary: ${prompt.summary || ''}`,
      `- Tags: ${formatTags(prompt.tags)}`,
      `- Variables: ${formatTags(prompt.variables)}`,
      `- Version: ${prompt.version}`,
      `- Updated: ${prompt.updatedAt}`,
      '',
      codeBlock(prompt.content, 'text'),
      ''
    ])
  ].join('\n')
}

function formatSkillsExport(skills: SkillItem[], format: ExportFormat): string {
  if (skills.length === 0) return ''
  if (format === 'json') {
    return `${JSON.stringify({ format: 'format-flow-skills', exportedAt: nowIso(), skills }, null, 2)}\n`
  }
  if (format === 'txt') {
    return [
      `Format Flow Skills`,
      `Exported: ${nowIso()}`,
      `Count: ${skills.length}`,
      '',
      ...skills.flatMap((skill, index) => [
        `${index + 1}. ${skill.title || skill.name}`,
        `Name: ${skill.name}`,
        `Summary: ${skill.summary || ''}`,
        `Tags: ${formatTags(skill.tags)}`,
        `Source: ${skill.source}`,
        `Path: ${skill.path}`,
        `Updated: ${skill.updatedAt}`,
        '',
        skill.contentPreview || '',
        '',
        '---',
        ''
      ])
    ].join('\n')
  }
  return [
    '# Format Flow Skills',
    '',
    `- Exported: ${nowIso()}`,
    `- Count: ${skills.length}`,
    '',
    ...skills.flatMap((skill, index) => [
      `## ${index + 1}. ${skill.title || skill.name}`,
      '',
      `- Name: ${skill.name}`,
      `- Summary: ${skill.summary || ''}`,
      `- Tags: ${formatTags(skill.tags)}`,
      `- Source: ${skill.source}`,
      `- Path: ${skill.path}`,
      `- Updated: ${skill.updatedAt}`,
      '',
      codeBlock(skill.contentPreview || '', 'markdown'),
      ''
    ])
  ].join('\n')
}

function formatWorkflowsExport(workflows: Workflow[], store: AppStore, skills: SkillItem[], format: ExportFormat): string {
  if (workflows.length === 0) return ''
  if (format === 'json') {
    const promptIds = new Set(workflows.flatMap((workflow) => workflow.nodes.map((node) => node.refId).filter(Boolean)))
    const skillIds = new Set(workflows.flatMap((workflow) => workflow.nodes.flatMap((node) => [node.refId, node.skillRefId]).filter(Boolean)))
    const mcpIds = new Set(workflows.flatMap((workflow) => workflow.nodes.map((node) => node.mcpRefId).filter(Boolean)))
    return `${JSON.stringify(
      {
        format: 'format-flow-workflows',
        exportedAt: nowIso(),
        workflows,
        referencedPrompts: store.prompts.filter((prompt) => promptIds.has(prompt.id)),
        referencedSkills: skills.filter((skill) => skillIds.has(skill.id)),
        referencedMcpServers: store.mcpServers.filter((mcp) => mcpIds.has(mcp.id))
      },
      null,
      2
    )}\n`
  }

  const workflowSections = workflows.flatMap((workflow, workflowIndex) => {
    const lines = [
      format === 'markdown' ? `## ${workflowIndex + 1}. ${workflow.title}` : `${workflowIndex + 1}. ${workflow.title}`,
      '',
      `Description: ${workflow.description || ''}`,
      `Tags: ${formatTags(workflow.tags)}`,
      `Updated: ${workflow.updatedAt}`,
      '',
      format === 'markdown' ? '### Steps' : 'Steps',
      ''
    ]
    for (const [nodeIndex, node] of workflow.nodes.entries()) {
      const prompt = store.prompts.find((item) => item.id === node.refId)
      const directSkill = skills.find((item) => item.id === node.refId)
      const callSkill = skills.find((item) => item.id === node.skillRefId)
      const mcp = store.mcpServers.find((item) => item.id === node.mcpRefId)
      lines.push(...formatWorkflowNodeExport(node, nodeIndex, prompt, directSkill, callSkill, mcp, format), '')
    }
    return [...lines, format === 'markdown' ? '' : '---', '']
  })

  if (format === 'txt') {
    return [
      'Format Flow Workflows',
      `Exported: ${nowIso()}`,
      `Count: ${workflows.length}`,
      '',
      ...workflowSections
    ].join('\n')
  }

  return [
    '# Format Flow Workflows',
    '',
    `- Exported: ${nowIso()}`,
    `- Count: ${workflows.length}`,
    '',
    ...workflowSections
  ].join('\n')
}

function formatWorkflowNodeExport(
  node: WorkflowNode,
  index: number,
  prompt: PromptItem | undefined,
  directSkill: SkillItem | undefined,
  callSkill: SkillItem | undefined,
  mcp: McpServer | undefined,
  format: ExportFormat
): string[] {
  const title = `${index + 1}. ${node.title} (${nodeTypeLabel(node.type)})`
  const lines = [
    format === 'markdown' ? `#### ${title}` : title,
    `Summary: ${node.summary || ''}`,
    `Tags: ${formatTags(node.tags)}`,
    `Requires review: ${node.requiresReview ? 'yes' : 'no'}`
  ]
  if (prompt) lines.push(`Prompt: ${prompt.title}`)
  if (directSkill) lines.push(`Skill: ${directSkill.title || directSkill.name}`)
  if (callSkill) lines.push(`Calls Skill: ${callSkill.title || callSkill.name}`)
  if (mcp) lines.push(`Uses MCP: ${mcp.name}`)
  if (Object.keys(node.inputs).length > 0) lines.push(`Inputs: ${JSON.stringify(node.inputs)}`)
  if (node.outputs.length > 0) lines.push(`Outputs: ${node.outputs.join(', ')}`)
  if (prompt?.content) lines.push('', format === 'markdown' ? codeBlock(prompt.content, 'text') : prompt.content)
  if (directSkill?.contentPreview) lines.push('', format === 'markdown' ? codeBlock(directSkill.contentPreview, 'markdown') : directSkill.contentPreview)
  return lines
}

function codeBlock(content: string, language: string): string {
  const fence = content.includes('```') ? '````' : '```'
  return [fence + language, content.trimEnd(), fence].join('\n')
}

function formatTags(tags: string[]): string {
  return tags.length ? tags.join(', ') : '-'
}

function nodeTypeLabel(type: NodeKind): string {
  if (type === 'prompt') return '提示词'
  if (type === 'skill') return 'Skill'
  return '人工审查'
}

function exportExtension(format: ExportFormat): string {
  if (format === 'markdown') return 'md'
  if (format === 'json') return 'json'
  return 'txt'
}

function exportFormatName(format: ExportFormat): string {
  if (format === 'markdown') return 'Markdown'
  if (format === 'json') return 'JSON'
  return 'Text'
}

function exportTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
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

function normalizeSkillDirectories(directories: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const directory of directories) {
    const value = directory.trim().replace(/^["']|["']$/g, '')
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalized.push(value)
  }

  return normalized
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
  return shortcutFromCaptureInput(captureInputFromKeyboardEvent(event))
}

function captureInputFromKeyboardEvent(event: KeyboardEvent): ShortcutCaptureInput {
  return {
    key: event.key,
    code: event.code,
    control: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey
  }
}

function shortcutFromCaptureInput(input: ShortcutCaptureInput): string {
  const parts: string[] = []
  if (input.control || input.meta) parts.push('CommandOrControl')
  if (input.alt) parts.push('Alt')
  if (input.shift) parts.push('Shift')
  const key = normalizeShortcutKey(String(input.key || input.code || ''))
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) parts.push(key)
  return parts.length ? parts.join('+') : key
}

function isModifierOnlyShortcut(shortcut: string): boolean {
  return ['CommandOrControl', 'Control', 'Alt', 'Shift', 'Meta'].includes(shortcut)
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
    quickCallFillOnly: Boolean(payload.quickCallFillOnly),
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

function extractLearningSources(content: string, sourceName: string, method: LearningMethod, tags: string[]): LearningSource[] {
  const trimmed = content.trim()
  if (!trimmed) return []

  if (sourceName.toLowerCase().endsWith('.json')) {
    try {
      return learningRecordsFromJson(JSON.parse(trimmed) as unknown, sourceName, method, tags)
    } catch {
      return [createLearningSource(sourceName.replace(/\.[^.]+$/, ''), sourceName, trimmed, false, method, tags)]
    }
  }

  return [createLearningSource(markdownTitle(trimmed) || sourceName.replace(/\.[^.]+$/, ''), sourceName, trimmed, false, method, tags)]
}

function learningRecordsFromJson(value: unknown, sourceName: string, method: LearningMethod, tags: string[]): LearningSource[] {
  const records = selectLearningRecords(value)
  if (records.length === 0) {
    return [createLearningSource(sourceName.replace(/\.[^.]+$/, ''), sourceName, valueToLearningText(value), false, method, tags)]
  }

  return records.map((record, index) => {
    const title = learningRecordTitle(record, `${sourceName.replace(/\.[^.]+$/, '')} ${index + 1}`)
    const satisfied = isSatisfiedLearningRecord(record)
    return createLearningSource(title, sourceName, valueToLearningText(record), satisfied, method, tags)
  })
}

function selectLearningRecords(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!isPlainRecord(value)) return []

  for (const key of ['conversations', 'conversation', 'runs', 'sessions', 'items', 'records', 'messages']) {
    const candidate = value[key]
    if (Array.isArray(candidate)) {
      if (key === 'messages') return [value]
      return candidate
    }
  }

  return []
}

function learningRecordTitle(value: unknown, fallback: string): string {
  if (!isPlainRecord(value)) return fallback
  for (const key of ['title', 'name', 'workflowTitle', 'summary', 'topic']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim().slice(0, 80)
  }
  return fallback
}

function isSatisfiedLearningRecord(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  const status = typeof value.status === 'string' ? value.status.toLowerCase() : ''
  const rating = typeof value.rating === 'string' ? value.rating.toLowerCase() : ''
  return Boolean(value.satisfied || value.favorite || value.approved || status === 'completed' || rating === 'satisfied')
}

function createLearningSource(
  title: string,
  sourceName: string,
  rawText: string,
  satisfied: boolean,
  method: LearningMethod,
  tags: string[]
): LearningSource {
  const cleaned = sanitizeLearningText(rawText)
  const sanitizedText = cleaned.text
  return {
    id: newId('learn'),
    title: title.trim() || sourceName,
    sourceName,
    method,
    tags: Array.from(new Set(tags.map(normalizeTag).filter(Boolean))),
    rawText,
    sanitizedText,
    abstractLogic: abstractConversationLogic(sanitizedText),
    scenarioLogic: inferScenarioLogic(sanitizedText),
    satisfied,
    redactions: cleaned.redactions
  }
}

function runToLearningText(run: AppStore['runs'][number]): string {
  return [
    `工作流：${run.workflowTitle}`,
    `状态：${run.status}`,
    '',
    ...run.steps.flatMap((step, index) => [
      `## 步骤 ${index + 1}：${step.title}`,
      `摘要：${step.summary}`,
      `输入：\n${step.inputSnapshot || '(无)'}`,
      `输出：\n${step.output || '(无)'}`,
      ''
    ])
  ].join('\n')
}

function valueToLearningText(value: unknown, depth = 0): string {
  if (depth > 5) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map((item) => valueToLearningText(item, depth + 1)).filter(Boolean).join('\n\n')
  if (!isPlainRecord(value)) return ''

  if (Array.isArray(value.messages)) {
    return value.messages
      .map((message) => {
        if (!isPlainRecord(message)) return valueToLearningText(message, depth + 1)
        const role = typeof message.role === 'string' ? message.role : typeof message.author === 'string' ? message.author : 'message'
        const text = message.content || message.text || message.message || message.value
        return `${role}:\n${valueToLearningText(text, depth + 1)}`
      })
      .join('\n\n')
  }

  if (Array.isArray(value.steps)) {
    return value.steps.map((step) => valueToLearningText(step, depth + 1)).join('\n\n')
  }

  return Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null)
    .map(([key, entryValue]) => `${key}:\n${valueToLearningText(entryValue, depth + 1)}`)
    .join('\n\n')
}

function sanitizeLearningText(value: string): { text: string; redactions: string[] } {
  const redactions = new Set<string>()
  let text = value

  function redact(pattern: RegExp, replacement: string, label: string): void {
    const next = text.replace(pattern, replacement)
    if (next !== text) redactions.add(label)
    text = next
  }

  redact(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]', '邮箱')
  redact(
    /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/g,
    '[api-key]',
    'API key'
  )
  redact(
    /\b(api[_-]?key|token|secret|password|passwd|authorization|bearer)\s*[:=]\s*["']?[^"'\s,;，。]+/gi,
    '$1=[secret]',
    '密钥字段'
  )
  redact(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g, '[local-path]', '本地路径')
  redact(/(^|[\s(（])\/(?:Users|home|mnt|var|tmp|etc|opt|root|Volumes)\/[^\s'"，。；;)）]+/g, '$1[local-path]', '本地路径')
  redact(/https?:\/\/[^\s'"<>，。；]+(?:token|key|secret|auth)[^\s'"<>，。；]*/gi, '[sensitive-url]', '敏感链接')
  redact(/\b1[3-9]\d{9}\b/g, '[phone]', '手机号')
  redact(/\b((?:QQ|qq|微信|WeChat|账号|账户|account)\s*[：:：]?\s*)[A-Za-z0-9_.@-]{5,}\b/g, '$1[account]', '账号')

  return {
    text: text.replace(/\n{4,}/g, '\n\n\n').trim(),
    redactions: Array.from(redactions)
  }
}

function learningMethodLabel(method: LearningMethod): string {
  return method === 'engineering-cybernetics' ? '钱学森工程控制论' : '对话审查'
}

function learningMethodTag(method: LearningMethod): string {
  return method === 'engineering-cybernetics' ? '钱学森工程控制论' : '对话审查'
}

function toggleLearningTag(tags: string[], tag: string, enabled: boolean): string[] {
  const normalizedTag = normalizeTag(tag)
  const normalizedTags = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)))
  const exists = normalizedTags.includes(normalizedTag)
  if (enabled && !exists) return [...normalizedTags, normalizedTag]
  if (!enabled && exists) return normalizedTags.filter((item) => item !== normalizedTag)
  return normalizedTags
}

function abstractConversationLogic(text: string): string {
  const scenario = inferScenarioName(text)
  const constraints = inferConstraintSignals(text)
  const feedback = inferFeedbackSignals(text)
  const control = inferControlActions(text)
  return [
    '- 目标：把用户意图转成可验证的工程结果。',
    `- 场景：${scenario}。`,
    `- 状态：已有上下文、当前输出质量、工具连接状态和用户满意度。`,
    `- 控制动作：${control.join('；')}。`,
    `- 反馈信号：${feedback.join('；')}。`,
    `- 约束：${constraints.join('；')}。`,
    '- 稳定条件：结果可复现、可审查、隐私已清理，并且用户明确满意或进入下一轮修正。'
  ].join('\n')
}

function inferScenarioLogic(text: string): string {
  const scenario = inferScenarioName(text)
  if (/插件|浏览器|粘贴|快捷键|自动发送|对话框/.test(text)) {
    return `场景核心逻辑：${scenario} 要把“触发入口、目标窗口、内容载荷、反馈状态、失败兜底”拆开，优先保证用户一次点击后可恢复到原对话流。`
  }
  if (/安装包|打包|dist|build|测试|验证/.test(text)) {
    return `场景核心逻辑：${scenario} 要把实现、验证、打包、版本记录做成闭环，任何发布物都必须能追溯到源码提交。`
  }
  if (/分组|标签|管理|小类|右键/.test(text)) {
    return `场景核心逻辑：${scenario} 要把“数据结构、分组视图、右键操作、排序和删除影响范围”分离，避免把管理入口和调用入口混在一起。`
  }
  if (/学习|满意|隐私|skill|Skill/.test(text)) {
    return `场景核心逻辑：${scenario} 要只学习满意样本，把原始内容抽象为偏好、约束、质量门槛和可复用流程，保存前必须隐私清理和人工审查。`
  }
  return `场景核心逻辑：${scenario} 要先明确目标和反馈，再选择最小可验证控制动作，避免把一次性细节写入长期规则。`
}

function inferScenarioName(text: string): string {
  if (/插件|浏览器|粘贴|快捷键|自动发送|对话框/.test(text)) return '浏览器/桌面联动'
  if (/安装包|打包|dist|build|测试|验证/.test(text)) return '构建发布'
  if (/分组|标签|管理|小类|右键/.test(text)) return '信息管理与分组'
  if (/学习|满意|隐私|skill|Skill/.test(text)) return '对话学习与 Skill 生成'
  if (/MCP|mcp/.test(text)) return '工具接口配置'
  return '通用任务控制'
}

function inferControlActions(text: string): string[] {
  const actions = new Set<string>(['先检查上下文', '执行最小必要修改', '运行验证'])
  if (/安装包|打包|dist/.test(text)) actions.add('重新生成安装包')
  if (/插件|浏览器/.test(text)) actions.add('同步插件和桌面桥接状态')
  if (/学习|满意|隐私/.test(text)) actions.add('只保留满意样本并做隐私清理')
  if (/分组|标签/.test(text)) actions.add('维护分组和标签映射')
  return Array.from(actions)
}

function inferFeedbackSignals(text: string): string[] {
  const signals = new Set<string>(['用户审查意见', '测试/构建结果'])
  if (/连接|插件|浏览器/.test(text)) signals.add('连接状态和 AI 页面响应')
  if (/粘贴|剪贴板/.test(text)) signals.add('剪贴板/粘贴是否成功')
  if (/满意|学习/.test(text)) signals.add('满意标记')
  return Array.from(signals)
}

function inferConstraintSignals(text: string): string[] {
  const constraints = new Set<string>(['不写入隐私信息', '不覆盖无关修改'])
  if (/不必汇报中间|最终版本/.test(text)) constraints.add('减少中间噪声')
  if (/安装包|打包/.test(text)) constraints.add('安装包必须对应已验证源码')
  if (/浏览器|插件/.test(text)) constraints.add('插件只能操作已打开且受支持的 AI 页面')
  return Array.from(constraints)
}

function buildLearningSkillDraft(sources: LearningSource[], method: LearningMethod, errorSources: LearningSource[] = []): LearningDraft {
  const combined = sources.map((source) => `# ${source.title}\n${source.sanitizedText}`).join('\n\n---\n\n')
  const errorCombined = errorSources.map((source) => `# ${source.title}\n${source.sanitizedText}`).join('\n\n---\n\n')
  const title = method === 'engineering-cybernetics' ? 'Hermes Engineering Cybernetics Skill' : inferLearningSkillTitle(sources)
  const skillName = slugifySkillName(title)
  const description =
    method === 'engineering-cybernetics'
      ? `Use when a task should be controlled as a closed-loop engineering system, based on ${sources.length} satisfied sample(s) and ${errorSources.length} error sample(s).`
      : `Use when a task should follow the user's learned working habits from ${sources.length} satisfied sample(s) and avoid patterns from ${errorSources.length} error sample(s).`
  const preferences = inferLearningPreferences(combined)
  const corrections = inferCorrectionRules(errorCombined)
  const examples = sources.slice(0, 3).map((source) => `### ${source.title}\n${compactSnippet(source.sanitizedText, 900)}`)
  const errorExamples = errorSources.slice(0, 3).map((source) => `### ${source.title}\n${compactSnippet(source.sanitizedText, 700)}`)
  const cyberneticsSections =
    method === 'engineering-cybernetics'
      ? [
          '',
          '## 钱学森工程控制论核心思想',
          '- 把任务看成受目标、状态、反馈、控制动作、约束和扰动共同作用的工程系统。',
          '- 先建立可观察状态，再通过反馈闭环持续修正控制动作，而不是一次性给出静态答案。',
          '- 优先识别系统边界、输入输出、稳定性条件、误差来源和停止条件。',
          '- 对复杂任务做分层控制：战略目标、阶段目标、当前动作和验证信号分别管理。',
          '',
          '## Hermes 抽象规则',
          '- 每次对话只保留底层逻辑，不保留具体隐私、一次性路径、账号或临时措辞。',
          '- 把原始对话压缩成：目标、初始状态、输入信号、控制动作、反馈信号、约束、扰动、稳定条件。',
          '- 对应场景只保存可复用的核心逻辑，用于以后快速判断该走哪条控制路径。',
          '',
          '## 场景核心逻辑',
          ...sources.map((source, index) => [
            `### 场景 ${index + 1}：${source.title}`,
            source.abstractLogic,
            '',
            source.scenarioLogic
          ].join('\n'))
        ]
      : []

  const content = [
    '---',
    `name: ${skillName}`,
    `description: ${description}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## Hermes Learning Mode',
    `- ${learningMethodLabel(method)}`,
    method === 'conversation-review'
      ? '- 对话审查不是只做可观测性：满意样本提供目标轨迹，不满意样本提供误差信号，用于形成纠偏控制规则。'
      : '- 工程控制论模式把满意样本作为稳定轨迹，把误差样本作为偏差信号，持续更新控制动作和约束边界。',
    ...cyberneticsSections,
    '',
    '## When to Use',
    '- Use this Skill when the current task resembles the learned satisfied conversations or when the user asks to follow their established working style.',
    '- Prefer this Skill for Format Flow / Codex workflow design, implementation, verification, installation packaging, and browser-extension coordination tasks.',
    '',
    '## User Preferences',
    ...preferences.map((item) => `- ${item}`),
    '',
    '## Error Signals and Corrections',
    ...(corrections.length > 0
      ? corrections.map((item) => `- ${item}`)
      : ['- No explicit error samples were provided; treat future dissatisfaction as feedback and update this section.']),
    '',
    '## Do Not Do',
    ...buildDoNotRules(corrections).map((item) => `- ${item}`),
    '',
    '## Workflow',
    '1. Read the current request and existing project context before changing files.',
    '2. Use satisfied samples as positive control targets and error samples as negative feedback signals.',
    '3. Before acting, check the Do Not Do section and remove any action that matches a known error pattern.',
    '4. Apply the learned preferences below, but do not copy sensitive details from prior conversations.',
    '5. If the task changes code or configuration, implement the change and run the most relevant test/build command available.',
    '6. If output is going to another AI web app, keep the handoff prompt concise and directly executable.',
    '7. Final response should be concise: state what changed, what was verified, and any remaining action the user must take.',
    '',
    '## Privacy Rules',
    '- Never include raw API keys, tokens, passwords, local filesystem paths, email addresses, phone numbers, or account identifiers from learned conversations.',
    '- Preserve reusable preferences and workflow rules; replace private details with placeholders such as `[api-key]`, `[local-path]`, `[email]`, and `[account]`.',
    '',
    '## Quality Gates',
    '- Confirm the result is based only on samples the user marked as satisfied.',
    '- Confirm the plan avoids patterns extracted from error samples.',
    '- Check that generated content does not contain private identifiers.',
    '- Prefer deterministic local actions and explicit verification over vague suggestions.',
    '- Do not silently overwrite unrelated user changes.',
    '',
    '## Learned Examples',
    examples.join('\n\n') || '- No positive examples available.',
    '',
    '## Error Examples',
    errorExamples.join('\n\n') || '- No error examples available.'
  ].join('\n')

  return { skillName, title, description, content }
}

function inferLearningSkillTitle(sources: LearningSource[]): string {
  const common = mostCommonWord(sources.map((source) => source.title).join(' '))
  return common ? `Learned ${capitalizeWord(common)} Workflow` : 'Learned User Workflow'
}

function inferLearningPreferences(text: string): string[] {
  const preferences = new Set<string>()
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const asciiWords = (text.match(/[A-Za-z]{3,}/g) || []).length
  if (chineseChars > asciiWords) preferences.add('默认使用中文沟通，除非代码、命令、文件名或 API 字段需要英文。')
  if (/测试|验证|build|test|dist|安装包|打包/i.test(text)) preferences.add('完成实现后运行可用测试、构建或打包命令，并汇报验证结果。')
  if (/不必汇报中间|最终版本|直到测试|不要.*中间/i.test(text)) preferences.add('减少低价值中间汇报；在关键验证完成后再汇报结果。')
  if (/人工审查|满意|审查意见|顺序运行/i.test(text)) preferences.add('把人工审查作为流程节点；结果不满意时支持追加审查意见继续联动。')
  if (/剪贴板|浏览器插件|浏览器.*AI|自动发送/i.test(text)) preferences.add('浏览器 AI 联动优先走插件连接；失败时保留剪贴板兜底。')
  if (/白底黑字|界面|弹窗|右键|控件|按钮/i.test(text)) preferences.add('界面改动要明确控件位置、交互反馈和可见状态，避免隐藏式操作。')
  if (/GitHub|git|提交|推送|备份/i.test(text)) preferences.add('涉及版本或备份时保持 Git 可追踪，提交信息要对应实际功能。')

  for (const line of extractPreferenceLines(text)) {
    preferences.add(line)
    if (preferences.size >= 12) break
  }

  if (preferences.size === 0) {
    preferences.add('先提炼用户目标，再给出可执行步骤；避免泛泛建议。')
    preferences.add('生成内容前清理隐私信息，保存前让用户审查。')
  }

  return Array.from(preferences).slice(0, 12)
}

function inferCorrectionRules(text: string): string[] {
  if (!text.trim()) return []
  const rules = new Set<string>()
  if (/没有反应|无响应|没反应|点击.*不|失败|报错|error/i.test(text)) {
    rules.add('如果用户指出“没有反应/失败/报错”，不要只解释原因；必须定位触发链路、补反馈提示，并给出可验证修复。')
  }
  if (/不必|不要|不应该|不需要|去掉|不是|误差/.test(text)) {
    rules.add('把用户的否定表达记录为控制边界；后续方案先排除这些做法，再生成替代路径。')
  }
  if (/主界面|不必显示|隐藏|入口/.test(text)) {
    rules.add('不要把临时调用入口暴露到主界面；区分管理界面、弹窗入口和自动化执行入口。')
  }
  if (/粘贴|剪贴板|对话框|快捷键/.test(text)) {
    rules.add('不要停留在“复制到剪贴板”；若用户在对话框中触发快捷调用，应尽量自动粘贴回原输入框，并保留失败兜底。')
  }
  if (/浏览器|插件|连接|图标/.test(text)) {
    rules.add('不要假设浏览器插件已连接；必须显示桥接状态、目标 AI 页面和失败原因。')
  }
  if (/满意|不满意|纠偏|可控/.test(text)) {
    rules.add('不要只学习满意样本；不满意样本必须作为误差信号生成纠偏规则。')
  }
  if (/安装包|打包|测试|验证/.test(text)) {
    rules.add('不要只改源码不打包；面向安装版的问题必须重新构建安装包并说明验证命令。')
  }

  for (const line of extractCorrectionLines(text)) {
    rules.add(`避免：${line}`)
    if (rules.size >= 14) break
  }

  return Array.from(rules).slice(0, 14)
}

function extractCorrectionLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s>]+/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 140)
    .filter((line) => /(不满意|没有反应|失败|错误|不必|不要|不应该|不需要|去掉|不能|不对|问题|误差)/.test(line))
    .slice(0, 18)
}

function buildDoNotRules(corrections: string[]): string[] {
  const defaults = [
    '不要把未审查的历史对话直接写入长期 Skill。',
    '不要保留隐私、路径、账号、密钥或一次性细节。',
    '不要只总结现象而不形成可执行纠偏动作。'
  ]
  return corrections.length > 0 ? [...corrections.slice(0, 8), ...defaults].slice(0, 10) : defaults
}

function extractPreferenceLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s>]+/, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 120)
    .filter((line) => /(不要|不必|必须|需要|默认|优先|改为|支持|保留|避免|直接|自动)/.test(line))
    .slice(0, 16)
}

function compactSnippet(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}\n...` : normalized
}

function markdownTitle(text: string): string {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
}

function slugifySkillName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'learned-user-workflow'
  )
}

function mostCommonWord(value: string): string {
  const stop = new Set(['learned', 'workflow', 'user', 'conversation', '对话', '工作流', '学习'])
  const counts = new Map<string, number>()
  for (const word of value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/)) {
    if (word.length < 3 || stop.has(word)) continue
    counts.set(word, (counts.get(word) || 0) + 1)
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] || ''
}

function capitalizeWord(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
    promptDirectory: 'browser-downloads/prompts',
    workflowDirectory: 'browser-downloads/workflows',
    skillMetadataPath: 'browser-localStorage:skillIndex',
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
    exportTextFile: async ({ fileName, content }: { fileName: string; content: string }) => createBrowserTextExport(fileName, content),
    scanSkills: async () => [],
    importExistingSkills: async () => desktopOnly('浏览器审查模式不能导入本地 Skill'),
    restoreSkillsFromBackup: async () => desktopOnly('浏览器审查模式不能恢复本地 Skill 备份'),
    installSkillZip: async () => desktopOnly('浏览器审查模式不能安装本地 ZIP'),
    installGeneratedSkill: async () => desktopOnly('浏览器审查模式不能保存生成的 Skill，请在桌面版中保存'),
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
    writeClipboardText: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        return { ok: true, message: '已复制到剪贴板' }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : '写入剪贴板失败'
        }
      }
    },
    writeClipboardTextAndPaste: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        return { ok: true, message: '浏览器审查模式已复制到剪贴板；桌面版会自动粘贴到当前对话框。' }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : '写入剪贴板失败'
        }
      }
    },
    getBrowserBridgeStatus: async () => ({
      bridgeConnected: false,
      connected: false,
      message: '网页审查模式会直接通过浏览器扩展 content script 连接。'
    }),
    getBrowserBridgeOutput: async () => null,
    queueBrowserBridgeTask: async (payload: Record<string, unknown>) => {
      window.postMessage({ source: 'format-flow', type: 'FORMAT_FLOW_SEND_TASK', payload }, window.location.origin)
      return { ok: true, message: '任务已发送给浏览器插件。' }
    },
    setShortcut: async (accelerator: string) => ({ ok: !accelerator.startsWith('MouseButton'), accelerator, message: '浏览器审查模式已保存快捷键预览' }),
    setShortcutCaptureActive: async () => undefined,
    onShortcutCaptureInput: () => () => undefined,
    openBrowserExtensionInstaller: async () => ({
      ok: false,
      message: '浏览器插件安装入口只在桌面安装版中可用。',
      path: ''
    }),
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

async function createBrowserTextExport(fileName: string, content: string): Promise<{ ok: boolean; message: string; path?: string }> {
  if (!content.trim()) return { ok: false, message: '没有可导出的内容' }
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const safeName = fileName.trim() || 'format-flow-export.txt'
  anchor.href = url
  anchor.download = safeName
  anchor.click()
  URL.revokeObjectURL(url)
  return { ok: true, message: `浏览器审查模式已下载：${safeName}`, path: safeName }
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
