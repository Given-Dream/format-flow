import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppPaths,
  AppStore,
  BackupResult,
  GithubSearchResult,
  ImportResult,
  McpServer,
  PromptItem,
  ShortcutResult,
  SkillItem
} from '../shared/types'

const api = {
  loadStore: (): Promise<AppStore> => ipcRenderer.invoke('store:load'),
  saveStore: (store: AppStore): Promise<AppStore> => ipcRenderer.invoke('store:save', store),
  getPaths: (): Promise<AppPaths> => ipcRenderer.invoke('paths:get'),
  chooseDataDirectory: (): Promise<{ ok: boolean; path: string; message: string }> =>
    ipcRenderer.invoke('paths:chooseDataDirectory'),
  chooseBackupDirectory: (): Promise<{ ok: boolean; path: string; message: string }> =>
    ipcRenderer.invoke('paths:chooseBackupDirectory'),
  createBackup: (store: AppStore): Promise<BackupResult> => ipcRenderer.invoke('backup:create', store),
  createGitBackup: (store: AppStore): Promise<BackupResult> => ipcRenderer.invoke('backup:createGit', store),
  scanSkills: (directories: string[]): Promise<SkillItem[]> => ipcRenderer.invoke('skills:scan', directories),
  importExistingSkills: (): Promise<ImportResult<SkillItem>> => ipcRenderer.invoke('skills:importExisting'),
  restoreSkillsFromBackup: (): Promise<ImportResult<SkillItem>> => ipcRenderer.invoke('skills:restoreBackup'),
  installSkillZip: (): Promise<ImportResult<SkillItem>> => ipcRenderer.invoke('skills:installZip'),
  installGeneratedSkill: (name: string, content: string): Promise<ImportResult<SkillItem>> =>
    ipcRenderer.invoke('skills:installGenerated', name, content),
  searchGithubSkills: (query: string): Promise<GithubSearchResult[]> => ipcRenderer.invoke('github:searchSkills', query),
  installGithubSkill: (result: GithubSearchResult): Promise<ImportResult<SkillItem>> =>
    ipcRenderer.invoke('github:installSkill', result),
  importExistingPrompts: (): Promise<ImportResult<PromptItem>> => ipcRenderer.invoke('prompts:importExisting'),
  restorePromptsFromBackup: (): Promise<ImportResult<PromptItem>> => ipcRenderer.invoke('prompts:restoreBackup'),
  searchGithubPrompts: (query: string): Promise<GithubSearchResult[]> => ipcRenderer.invoke('github:searchPrompts', query),
  importGithubPrompt: (result: GithubSearchResult): Promise<ImportResult<PromptItem>> =>
    ipcRenderer.invoke('github:importPrompt', result),
  importMcpConfig: (): Promise<ImportResult<McpServer>> => ipcRenderer.invoke('mcps:importConfig'),
  restoreMcpFromBackup: (): Promise<ImportResult<McpServer>> => ipcRenderer.invoke('mcps:restoreBackup'),
  writeClipboardText: (text: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('clipboard:writeText', text),
  writeClipboardTextAndPaste: (text: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('clipboard:writeTextAndPaste', text),
  getBrowserBridgeStatus: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('browserBridge:getStatus'),
  getBrowserBridgeOutput: (): Promise<Record<string, unknown> | null> => ipcRenderer.invoke('browserBridge:getOutput'),
  queueBrowserBridgeTask: (payload: Record<string, unknown>): Promise<{ ok: boolean; message: string; status?: Record<string, unknown> }> =>
    ipcRenderer.invoke('browserBridge:queueTask', payload),
  openBrowserExtensionInstaller: (): Promise<{ ok: boolean; message: string; path: string }> =>
    ipcRenderer.invoke('browserExtension:openInstaller'),
  setShortcut: (accelerator: string): Promise<ShortcutResult> => ipcRenderer.invoke('shortcut:set', accelerator),
  setShortcutCaptureActive: (active: boolean): Promise<void> => ipcRenderer.invoke('shortcut:captureActive', active),
  onShortcutCaptureInput: (listener: (input: Record<string, unknown>) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, input: Record<string, unknown>): void => listener(input)
    ipcRenderer.on('shortcut:captureInput', wrapped)
    return () => ipcRenderer.removeListener('shortcut:captureInput', wrapped)
  },
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', targetPath),
  onOpenLauncher: (listener: () => void): (() => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('launcher:open', wrapped)
    return () => ipcRenderer.removeListener('launcher:open', wrapped)
  }
}

contextBridge.exposeInMainWorld('formatFlow', api)

export type FormatFlowApi = typeof api
