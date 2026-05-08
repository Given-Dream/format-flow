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
  setShortcut: (accelerator: string): Promise<ShortcutResult> => ipcRenderer.invoke('shortcut:set', accelerator),
  openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('shell:openPath', targetPath),
  onOpenLauncher: (listener: () => void): (() => void) => {
    const wrapped = (): void => listener()
    ipcRenderer.on('launcher:open', wrapped)
    return () => ipcRenderer.removeListener('launcher:open', wrapped)
  }
}

contextBridge.exposeInMainWorld('formatFlow', api)

export type FormatFlowApi = typeof api
