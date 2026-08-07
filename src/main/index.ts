import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, Notification, shell } from 'electron'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { migrateTemplateDirectory, syncTemplateDirectory } from './builtin-skills'
import { activateLicense, getLicenseStatus } from './license'
import {
  captureWordSelection,
  cleanupTemporaryWordAttachments,
  copyTemporaryWordFiles,
  copyTemporaryWordPayload,
  createTemporaryWordFromFiles,
  removeTemporaryWordAttachment
} from './temporary-word'
import { createPromptFromText, normalizeStore, parseMcpConfig, parsePromptImport, parseSkillMarkdown } from '../shared/domain'
import type {
  AppPaths,
  AppStore,
  BackupResult,
  ExportResult,
  ExportTextFileRequest,
  GithubSearchResult,
  ImportResult,
  McpServer,
  PromptItem,
  ShortcutResult,
  SkillEntryCreateRequest,
  SkillFileWriteRequest,
  SkillDirectoryNode,
  SkillDirectorySnapshot,
  SkillItem,
  TemporaryWordClipboardRequest,
  TemporaryWordFilesRequest
} from '../shared/types'

const SKILL_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.ini',
  '.ts',
  '.js',
  '.tsx',
  '.jsx',
  '.css',
  '.scss',
  '.less',
  '.py',
  '.sh',
  '.bat',
  '.cmd'
])

const BUILT_IN_LEARNING_SKILLS = [
  {
    name: 'conversation-review',
    title: '对话审查',
    description: 'Use when a conversation result needs structured review, error signals, corrective rules, and human approval.',
    instructions: [
      'Separate satisfied examples from error examples.',
      'Convert feedback into explicit rules, privacy-safe summaries, and a human-review checkpoint.'
    ]
  },
  {
    name: 'engineering-cybernetics-user-habit-learning',
    title: '工程控制论学习用户习惯',
    legacyNames: ['qian-xuesen-engineering-cybernetics'],
    description: '从工程控制论角度分析对话，识别稳定的用户习惯并形成可审查的候选 Skill。',
    instructions: [
      '明确目标、状态、反馈、控制动作、约束、扰动和退出条件。',
      '执行能够产生清晰反馈的最小动作，根据结果修正下一步。'
    ],
    templateDirectory: 'engineering-cybernetics-user-habit-learning'
  }
] as const

let mainWindow: BrowserWindow | null = null
let isQuitting = false
const execFile = promisify(execFileCallback)
const browserBridgePort = 48174
let browserBridgeServer: http.Server | null = null
let browserBridgeLastSeen = 0
let browserBridgeStatus: Record<string, unknown> = disconnectedBrowserBridgeStatus()
let browserBridgeOutput: Record<string, unknown> | null = null
let lastExternalForegroundWindow = ''
let registeredShortcut = ''
let mouseShortcutProcess: ChildProcess | null = null
let mouseShortcutAccelerator = ''
let shortcutCaptureActive = false
let captureAltSpaceRegistered = false
let lastLauncherOpenAt = 0
let releaseForegroundTimer: NodeJS.Timeout | null = null
let temporaryWordCleanupTimer: NodeJS.Timeout | null = null
const browserBridgeTasks: Array<{ id: string; payload: Record<string, unknown>; createdAt: number }> = []

function getDataDirectoryPreferencePath(): string {
  return path.join(app.getPath('userData'), 'data-location.json')
}

function readDataDirectoryPreference(): string {
  try {
    const content = fsSync.readFileSync(getDataDirectoryPreferencePath(), 'utf8')
    const parsed = JSON.parse(content) as { dataDirectory?: string }
    return typeof parsed.dataDirectory === 'string' ? parsed.dataDirectory : ''
  } catch {
    return ''
  }
}

async function writeDataDirectoryPreference(dataDirectory: string): Promise<void> {
  const preferencePath = getDataDirectoryPreferencePath()
  await fs.mkdir(path.dirname(preferencePath), { recursive: true })
  await fs.writeFile(preferencePath, `${JSON.stringify({ dataDirectory }, null, 2)}\n`, 'utf8')
}

function getDataRoot(): string {
  return readDataDirectoryPreference() || app.getPath('userData')
}

function getStorePath(): string {
  return path.join(getDataRoot(), 'format-flow-store.json')
}

function getManagedSkillDirectory(): string {
  return path.join(getDataRoot(), 'managed-skills')
}

function getPromptDirectory(): string {
  return path.join(getDataRoot(), 'prompts')
}

function getWorkflowDirectory(): string {
  return path.join(getDataRoot(), 'workflows')
}

function getSkillMetadataDirectory(): string {
  return path.join(getDataRoot(), 'skills')
}

function getSkillMetadataPath(): string {
  return path.join(getSkillMetadataDirectory(), 'metadata.json')
}

function getDefaultBackupDirectory(): string {
  return path.join(getDataRoot(), 'backups')
}

function getBrowserExtensionDirectory(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'browser-extension') : path.join(__dirname, '../../browser-extension')
}

function getBuiltInSkillTemplateDirectory(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'built-in-skills') : path.join(__dirname, '../../resources/built-in-skills')
}

function browserExecutableCandidates(): string[] {
  if (process.platform !== 'win32') return []
  return [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean)
}

async function openBrowserExtensionInstaller(): Promise<{ ok: boolean; message: string; path: string }> {
  const extensionPath = getBrowserExtensionDirectory()
  if (!fsSync.existsSync(extensionPath)) {
    return { ok: false, message: `Browser extension directory not found: ${extensionPath}`, path: extensionPath }
  }

  await shell.openPath(extensionPath)
  const browserPath = browserExecutableCandidates().find((candidate) => fsSync.existsSync(candidate))
  if (browserPath) {
    try {
      await execFile(browserPath, ['chrome://extensions'])
    } catch {
      // Opening the folder is still enough for manual loading.
    }
  }

  return {
    ok: true,
    message: '已打开浏览器插件目录；在 Chrome/Edge 扩展页开启开发者模式后，选择“加载已解压的扩展程序”并选中该目录。',
    path: extensionPath
  }
}

async function exportTextFile(request: ExportTextFileRequest): Promise<ExportResult> {
  const fileName = typeof request.fileName === 'string' && request.fileName.trim() ? request.fileName.trim() : 'format-flow-export.txt'
  const content = typeof request.content === 'string' ? request.content : ''
  if (!content.trim()) return { ok: false, message: '没有可导出的内容' }

  const saveOptions = {
    title: '导出 Format Flow 内容',
    defaultPath: fileName,
    filters: request.filters?.length
      ? request.filters
      : [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'JSON', extensions: ['json'] }
        ]
  }
  const result = mainWindow ? await dialog.showSaveDialog(mainWindow, saveOptions) : await dialog.showSaveDialog(saveOptions)
  if (result.canceled || !result.filePath) return { ok: false, message: '已取消导出' }

  await fs.mkdir(path.dirname(result.filePath), { recursive: true })
  await fs.writeFile(result.filePath, content, 'utf8')
  return { ok: true, message: `已导出：${result.filePath}`, path: result.filePath }
}

function defaultSkillDirectories(): string[] {
  const candidates = [
    process.env.CODEX_HOME ? path.join(process.env.CODEX_HOME, 'skills') : '',
    path.join(os.homedir(), '.codex', 'skills'),
    getManagedSkillDirectory()
  ].filter(Boolean)

  return Array.from(new Set(candidates))
}

function disconnectedBrowserBridgeStatus(message = '未检测到浏览器扩展本地桥接。请确认 Chrome/Edge 已加载 Format Flow Browser Bridge 扩展，并打开一个受支持的 AI 页面。'): Record<string, unknown> {
  return {
    bridgeConnected: false,
    connected: false,
    aiName: '',
    aiIcon: '',
    tabTitle: '',
    url: '',
    bridgePort: browserBridgePort,
    message
  }
}

function normalizeBrowserBridgeStatus(payload: Record<string, unknown> = {}): Record<string, unknown> {
  const connected = Boolean(payload.connected)
  const aiName = typeof payload.aiName === 'string' ? payload.aiName : ''
  const capabilities = typeof payload.capabilities === 'object' && payload.capabilities ? (payload.capabilities as Record<string, unknown>) : {}
  return {
    bridgeConnected: true,
    connected,
    aiName,
    aiIcon: typeof payload.aiIcon === 'string' ? payload.aiIcon : '',
    tabTitle: typeof payload.tabTitle === 'string' ? payload.tabTitle : '',
    url: typeof payload.url === 'string' ? payload.url : '',
    quickCallFillOnly: Boolean(capabilities.quickCallFillOnly || payload.quickCallFillOnly),
    bridgePort: browserBridgePort,
    message:
      typeof payload.message === 'string'
        ? payload.message
        : connected
          ? `已连接 ${aiName || 'AI'}`
          : '扩展已连接，未找到已打开的受支持 AI 页面'
  }
}

function getBrowserBridgeStatus(): Record<string, unknown> {
  if (!browserBridgeServer) {
    return disconnectedBrowserBridgeStatus(`本地桥接服务未启动，端口 ${browserBridgePort} 可能被占用。`)
  }

  if (!browserBridgeLastSeen || Date.now() - browserBridgeLastSeen > 10000) {
    return disconnectedBrowserBridgeStatus()
  }

  return {
    ...browserBridgeStatus,
    bridgeConnected: true,
    bridgePort: browserBridgePort
  }
}

function queueBrowserBridgeTask(payload: Record<string, unknown>): { ok: boolean; message: string; status: Record<string, unknown> } {
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!text) {
    return { ok: false, message: '任务内容为空', status: getBrowserBridgeStatus() }
  }

  browserBridgeTasks.push({
    id: `bridge_task_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    payload,
    createdAt: Date.now()
  })

  return {
    ok: true,
    message: '任务已加入浏览器扩展队列；扩展检测到后会自动发送到已打开的 AI 页面。',
    status: getBrowserBridgeStatus()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nativeWindowHandleToString(handle: Buffer | null | undefined): string {
  if (!handle?.length) return ''
  if (handle.length >= 8) return handle.readBigUInt64LE(0).toString()
  return handle.readUInt32LE(0).toString()
}

function mainWindowHandleString(): string {
  return nativeWindowHandleToString(mainWindow?.getNativeWindowHandle())
}

async function getForegroundWindowHandle(): Promise<string> {
  if (process.platform !== 'win32') return ''

  const command = `
Add-Type -Namespace FormatFlow -Name Win32Focus -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern System.IntPtr GetForegroundWindow();
"@
[FormatFlow.Win32Focus]::GetForegroundWindow().ToInt64()
`.trim()

  try {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      timeout: 2500
    })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function rememberExternalForegroundWindow(): Promise<void> {
  const foregroundWindow = await getForegroundWindowHandle()
  if (!foregroundWindow || foregroundWindow === '0' || foregroundWindow === mainWindowHandleString()) return
  lastExternalForegroundWindow = foregroundWindow
}

async function restoreExternalForegroundWindow(): Promise<void> {
  if (process.platform !== 'win32' || !lastExternalForegroundWindow) return

  const command = `
Add-Type -Namespace FormatFlow -Name Win32Focus -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")]
[return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
public static extern bool SetForegroundWindow(System.IntPtr hWnd);
"@
$hwnd = [System.IntPtr]::new([Int64]"${lastExternalForegroundWindow}")
[FormatFlow.Win32Focus]::ShowWindowAsync($hwnd, 9) | Out-Null
[FormatFlow.Win32Focus]::SetForegroundWindow($hwnd) | Out-Null
`.trim()

  try {
    await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true,
      timeout: 2500
    })
  } catch {
    // The clipboard still contains the text, so manual paste remains available if Windows blocks focus restore.
  }
}

function mouseButtonVirtualKey(accelerator: string): number | null {
  const match = accelerator.match(/^MouseButton([1-5])$/)
  if (!match) return null
  const button = Number(match[1])
  if (button === 1) return 0x01
  if (button === 2) return 0x04
  if (button === 3) return 0x02
  if (button === 4) return 0x05
  if (button === 5) return 0x06
  return null
}

function isMouseShortcut(accelerator: string): boolean {
  return mouseButtonVirtualKey(accelerator) !== null
}

function stopMouseShortcutWatcher(): void {
  if (!mouseShortcutProcess) return
  mouseShortcutProcess.removeAllListeners()
  mouseShortcutProcess.kill()
  mouseShortcutProcess = null
  mouseShortcutAccelerator = ''
}

function startMouseShortcutWatcher(accelerator: string): ShortcutResult {
  const virtualKey = mouseButtonVirtualKey(accelerator)
  if (!virtualKey) {
    return { ok: false, accelerator: registeredShortcut || accelerator, message: '无法识别鼠标快捷键。' }
  }
  if (process.platform !== 'win32') {
    return { ok: false, accelerator: registeredShortcut || accelerator, message: '鼠标全局快捷键当前仅支持 Windows。' }
  }
  if (mouseShortcutAccelerator === accelerator && mouseShortcutProcess && !mouseShortcutProcess.killed) {
    return { ok: true, accelerator, message: mouseShortcutWarning(accelerator) || '鼠标快捷键已注册' }
  }

  stopMouseShortcutWatcher()

  const script = [
    'param([Int32]$VirtualKey)',
    'Add-Type -Namespace FormatFlow -Name MouseShortcut -MemberDefinition @"',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern short GetAsyncKeyState(int vKey);',
    '"@',
    '$wasDown = $false',
    'while ($true) {',
    '  $state = [FormatFlow.MouseShortcut]::GetAsyncKeyState($VirtualKey)',
    '  $down = (($state -band 0x8000) -ne 0)',
    '  if ($down -and -not $wasDown) {',
    '    [Console]::Out.WriteLine("TRIGGER")',
    '    [Console]::Out.Flush()',
    '    Start-Sleep -Milliseconds 350',
    '  }',
    '  $wasDown = $down',
    '  Start-Sleep -Milliseconds 25',
    '}'
  ].join('\r\n')

  const command = `& { ${script} } -VirtualKey ${virtualKey}`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (!String(chunk).includes('TRIGGER') || shortcutCaptureActive) return
    void toggleMainWindow()
  })
  child.stderr.on('data', () => undefined)
  child.on('exit', () => {
    if (mouseShortcutProcess === child) {
      mouseShortcutProcess = null
      mouseShortcutAccelerator = ''
    }
  })
  child.on('error', () => {
    if (mouseShortcutProcess === child) {
      mouseShortcutProcess = null
      mouseShortcutAccelerator = ''
    }
  })

  mouseShortcutProcess = child
  mouseShortcutAccelerator = accelerator
  return { ok: true, accelerator, message: mouseShortcutWarning(accelerator) || '鼠标快捷键已注册' }
}

function mouseShortcutWarning(accelerator: string): string {
  if (accelerator === 'MouseButton1' || accelerator === 'MouseButton3') {
    return '鼠标快捷键已保存；左键/右键很容易与正常点击冲突，建议改用 MouseButton4 或 MouseButton5。'
  }
  return ''
}

function showPasteNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return

  try {
    new Notification({ title, body, silent: true }).show()
  } catch {
    // The renderer still receives the paste result if Windows notification delivery is unavailable.
  }
}

async function showPasteFailureDialog(message: string): Promise<void> {
  try {
    if (mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Format Flow',
        message: '自动粘贴失败',
        detail: message,
        buttons: ['知道了']
      })
    } else {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Format Flow',
        message: '自动粘贴失败',
        detail: message,
        buttons: ['知道了']
      })
    }
  } catch {
    // Fall back to the renderer notice if the dialog cannot be shown.
  }
}

async function writeClipboardTextAndPasteWithFeedback(text: string): Promise<{ ok: boolean; message: string }> {
  const cleanText = text.trim()
  if (!cleanText) return { ok: false, message: '没有可粘贴的内容' }
  clipboard.writeText(text)

  if (process.platform !== 'win32') {
    const message = '已复制到剪贴板；自动粘贴当前仅支持 Windows。'
    showPasteNotification('Format Flow', message)
    void showPasteFailureDialog(message)
    return { ok: false, message }
  }

  try {
    await rememberExternalForegroundWindow()
    if (!lastExternalForegroundWindow || lastExternalForegroundWindow === '0') {
      throw new Error('未记录到可粘贴的目标窗口，请先切换到目标应用再调用快捷调用。')
    }
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
      await sleep(120)
    }
    const scriptPath = await getPasteScriptPath()
    await execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, lastExternalForegroundWindow || '0'],
      { windowsHide: true, timeout: 3500 }
    )
    await sleep(120)
    await restoreExternalForegroundWindow()
    await sleep(120)
    const foregroundAfter = await getForegroundWindowHandle()
    if (foregroundAfter && foregroundAfter !== lastExternalForegroundWindow) {
      throw new Error('已执行粘贴快捷键，但目标窗口未成功重新获得焦点。')
    }
    const message = '已尝试粘贴到上一个窗口'
    showPasteNotification('Format Flow', message)
    return { ok: true, message }
  } catch (error) {
    mainWindow?.show()
    mainWindow?.focus()
    const message = `自动粘贴失败，内容已复制到剪贴板：${error instanceof Error ? error.message : '未知错误'}`
    showPasteNotification('Format Flow', message)
    void showPasteFailureDialog(message)
    return { ok: false, message }
  }
}

async function getPasteScriptPath(): Promise<string> {
  const scriptPath = path.join(app.getPath('userData'), 'format-flow-paste.ps1')
  const script = [
    'param([Int64]$TargetWindow = 0)',
    'Add-Type -Namespace FormatFlow -Name Win32Paste -MemberDefinition @"',
    '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]',
    'public struct INPUT { public uint type; public InputUnion U; }',
    '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Explicit)]',
    'public struct InputUnion {',
    '  [System.Runtime.InteropServices.FieldOffset(0)] public MOUSEINPUT mi;',
    '  [System.Runtime.InteropServices.FieldOffset(0)] public KEYBDINPUT ki;',
    '  [System.Runtime.InteropServices.FieldOffset(0)] public HARDWAREINPUT hi;',
    '}',
    '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]',
    'public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public System.IntPtr dwExtraInfo; }',
    '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]',
    'public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public System.IntPtr dwExtraInfo; }',
    '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]',
    'public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern System.IntPtr GetForegroundWindow();',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, System.IntPtr lpdwProcessId);',
    '[System.Runtime.InteropServices.DllImport("kernel32.dll")]',
    'public static extern uint GetCurrentThreadId();',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern bool BringWindowToTop(System.IntPtr hWnd);',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    '[return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]',
    'public static extern bool SetForegroundWindow(System.IntPtr hWnd);',
    '[System.Runtime.InteropServices.DllImport("user32.dll")]',
    'public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);',
    'public static uint SendKeyboard(ushort key, bool keyUp) {',
    '  INPUT input = new INPUT();',
    '  input.type = 1;',
    '  input.U.ki = new KEYBDINPUT();',
    '  input.U.ki.wVk = key;',
    '  input.U.ki.wScan = 0;',
    '  input.U.ki.dwFlags = keyUp ? 0x0002u : 0u;',
    '  input.U.ki.time = 0;',
    '  input.U.ki.dwExtraInfo = System.IntPtr.Zero;',
    '  return SendInput(1, new INPUT[] { input }, System.Runtime.InteropServices.Marshal.SizeOf(typeof(INPUT)));',
    '}',
    '"@',
    'function Send-Key([UInt16]$key, [bool]$up = $false) {',
    '  [FormatFlow.Win32Paste]::SendKeyboard($key, $up) | Out-Null',
    '}',
    '$SW_RESTORE = 9',
    '$VK_CONTROL = 0x11',
    '$VK_MENU = 0x12',
    '$VK_V = 0x56',
    'if ($TargetWindow -ne 0) {',
    '  $hwnd = [System.IntPtr]::new($TargetWindow)',
    '  [FormatFlow.Win32Paste]::ShowWindowAsync($hwnd, $SW_RESTORE) | Out-Null',
    '  Start-Sleep -Milliseconds 80',
    '  Send-Key $VK_MENU',
    '  Send-Key $VK_MENU $true',
    '  Start-Sleep -Milliseconds 40',
    '  $currentThread = [FormatFlow.Win32Paste]::GetCurrentThreadId()',
    '  $targetThread = [FormatFlow.Win32Paste]::GetWindowThreadProcessId($hwnd, [System.IntPtr]::Zero)',
    '  $foregroundThread = [FormatFlow.Win32Paste]::GetWindowThreadProcessId([FormatFlow.Win32Paste]::GetForegroundWindow(), [System.IntPtr]::Zero)',
    '  if ($targetThread -ne 0) { [FormatFlow.Win32Paste]::AttachThreadInput($currentThread, $targetThread, $true) | Out-Null }',
    '  if ($foregroundThread -ne 0 -and $foregroundThread -ne $targetThread) { [FormatFlow.Win32Paste]::AttachThreadInput($currentThread, $foregroundThread, $true) | Out-Null }',
    '  [FormatFlow.Win32Paste]::BringWindowToTop($hwnd) | Out-Null',
    '  [FormatFlow.Win32Paste]::SetForegroundWindow($hwnd) | Out-Null',
    '  if ($foregroundThread -ne 0 -and $foregroundThread -ne $targetThread) { [FormatFlow.Win32Paste]::AttachThreadInput($currentThread, $foregroundThread, $false) | Out-Null }',
    '  if ($targetThread -ne 0) { [FormatFlow.Win32Paste]::AttachThreadInput($currentThread, $targetThread, $false) | Out-Null }',
    '  Start-Sleep -Milliseconds 220',
    '}',
    'Send-Key $VK_CONTROL',
    'Send-Key $VK_V',
    'Start-Sleep -Milliseconds 50',
    'Send-Key $VK_V $true',
    'Send-Key $VK_CONTROL $true'
  ].join('\r\n')
  await fs.mkdir(path.dirname(scriptPath), { recursive: true })
  await fs.writeFile(scriptPath, script, 'utf8')
  return scriptPath
}

async function writeClipboardTextAndPaste(text: string): Promise<{ ok: boolean; message: string }> {
  const cleanText = text.trim()
  if (!cleanText) return { ok: false, message: '没有可粘贴的内容' }
  clipboard.writeText(text)

  if (process.platform !== 'win32') {
    return { ok: false, message: '已复制到剪贴板；自动粘贴当前仅支持 Windows。' }
  }

  try {
    const scriptPath = await getPasteScriptPath()
    await execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, lastExternalForegroundWindow || '0'],
      { windowsHide: true, timeout: 3500 }
    )
    return { ok: true, message: '已自动粘贴到当前对话框' }
  } catch (error) {
    mainWindow?.show()
    mainWindow?.focus()
    return {
      ok: false,
      message: `自动粘贴失败，内容已复制到剪贴板：${error instanceof Error ? error.message : '未知错误'}`
    }
  }
}

function startBrowserBridgeServer(): void {
  if (browserBridgeServer) return

  browserBridgeServer = http.createServer((request, response) => {
    void handleBrowserBridgeRequest(request, response)
  })

  browserBridgeServer.on('error', (error) => {
    browserBridgeStatus = disconnectedBrowserBridgeStatus(error instanceof Error ? error.message : '本地桥接服务启动失败')
    browserBridgeServer = null
  })

  browserBridgeServer.listen(browserBridgePort, '127.0.0.1')
}

async function handleBrowserBridgeRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'content-type')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url || '/', `http://127.0.0.1:${browserBridgePort}`)

  try {
    if (request.method === 'GET' && url.pathname === '/format-flow-bridge/status') {
      sendJson(response, 200, { ok: true, status: getBrowserBridgeStatus() })
      return
    }

    if (request.method === 'POST' && url.pathname === '/format-flow-bridge/extension/status') {
      const payload = await readJsonRequest(request)
      browserBridgeLastSeen = Date.now()
      browserBridgeStatus = normalizeBrowserBridgeStatus(payload)
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && url.pathname === '/format-flow-bridge/extension/output') {
      const payload = await readJsonRequest(request)
      browserBridgeLastSeen = Date.now()
      browserBridgeOutput = {
        ...payload,
        updatedAt: typeof payload.updatedAt === 'number' ? payload.updatedAt : Date.now()
      }
      browserBridgeStatus = normalizeBrowserBridgeStatus({
        ...payload,
        connected: true,
        message: `${typeof payload.aiName === 'string' ? payload.aiName : 'AI'} 输出已同步`
      })
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && url.pathname === '/format-flow-bridge/tasks/next') {
      browserBridgeLastSeen = Date.now()
      sendJson(response, 200, { ok: true, task: browserBridgeTasks.shift() || null })
      return
    }

    if (request.method === 'POST' && url.pathname === '/format-flow-bridge/tasks/result') {
      const payload = await readJsonRequest(request)
      browserBridgeLastSeen = Date.now()
      const result = typeof payload.result === 'object' && payload.result && !Array.isArray(payload.result) ? (payload.result as Record<string, unknown>) : {}
      const status = typeof result.status === 'object' && result.status && !Array.isArray(result.status) ? (result.status as Record<string, unknown>) : undefined
      browserBridgeStatus = normalizeBrowserBridgeStatus({
        ...(status || browserBridgeStatus),
        message: typeof result.message === 'string' ? result.message : browserBridgeStatus.message
      })
      sendJson(response, 200, { ok: true })
      return
    }

    sendJson(response, 404, { ok: false, message: 'Not found' })
  } catch (error) {
    sendJson(response, 500, { ok: false, message: error instanceof Error ? error.message : '本地桥接请求失败' })
  }
}

async function readJsonRequest(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

async function loadStore(): Promise<AppStore> {
  const storePath = getStorePath()
  try {
    const content = await fs.readFile(storePath, 'utf8')
    const normalized = normalizeStore(JSON.parse(content) as Partial<AppStore>)
    await saveCategorizedStoreFiles(normalized)
    return normalized
  } catch {
    const store = normalizeStore(null)
    await saveStore(store)
    return store
  }
}

async function saveStore(store: AppStore): Promise<AppStore> {
  const normalized = normalizeStore(store)
  await writeDataDirectoryPreference(normalized.settings.dataDirectory || '')
  const storePath = getStorePath()
  await fs.mkdir(path.dirname(storePath), { recursive: true })
  await fs.writeFile(storePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  await saveCategorizedStoreFiles(normalized)
  return normalized
}

async function saveCategorizedStoreFiles(store: AppStore): Promise<void> {
  const dataRoot = getDataRoot()
  const promptDirectory = getPromptDirectory()
  const workflowDirectory = getWorkflowDirectory()
  const skillDirectory = getSkillMetadataDirectory()

  await resetManagedDataDirectory(promptDirectory, dataRoot)
  await resetManagedDataDirectory(workflowDirectory, dataRoot)
  await fs.mkdir(skillDirectory, { recursive: true })

  await Promise.all(
    store.prompts.map((prompt) =>
      fs.writeFile(
        path.join(promptDirectory, `${safeSegment(prompt.title)}-${safeSegment(prompt.id)}.json`),
        `${JSON.stringify(prompt, null, 2)}\n`,
        'utf8'
      )
    )
  )

  await Promise.all(
    store.workflows.map((workflow) =>
      fs.writeFile(
        path.join(workflowDirectory, `${safeSegment(workflow.title)}-${safeSegment(workflow.id)}.json`),
        `${JSON.stringify(workflow, null, 2)}\n`,
        'utf8'
      )
    )
  )

  await fs.writeFile(
    getSkillMetadataPath(),
    `${JSON.stringify(
      {
        format: 'format-flow-skill-metadata',
        updatedAt: new Date().toISOString(),
        skillIndex: store.skillIndex,
        groups: store.groups.skills,
        skillDirectories: store.settings.skillDirectories,
        managedSkillDirectory: getManagedSkillDirectory()
      },
      null,
      2
    )}\n`,
    'utf8'
  )
}

async function resetManagedDataDirectory(directory: string, dataRoot: string): Promise<void> {
  if (!isPathInside(directory, dataRoot)) {
    throw new Error(`Refusing to reset data directory outside data root: ${directory}`)
  }
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(directory, { recursive: true })
}

function getPaths(): AppPaths {
  return {
    userData: app.getPath('userData'),
    dataDirectory: getDataRoot(),
    defaultBackupDirectory: getDefaultBackupDirectory(),
    storePath: getStorePath(),
    promptDirectory: getPromptDirectory(),
    workflowDirectory: getWorkflowDirectory(),
    skillMetadataPath: getSkillMetadataPath(),
    managedSkillDirectory: getManagedSkillDirectory(),
    browserExtensionDirectory: getBrowserExtensionDirectory(),
    dataDirectoryPreferencePath: getDataDirectoryPreferencePath(),
    defaultSkillDirectories: defaultSkillDirectories()
  }
}

async function chooseDataDirectory(): Promise<{ ok: boolean; path: string; message: string }> {
  const selection = await dialog.showOpenDialog({
    title: 'Choose Format Flow data directory',
    properties: ['openDirectory', 'createDirectory']
  })
  if (selection.canceled || !selection.filePaths[0]) {
    return { ok: false, path: '', message: 'Data directory selection cancelled' }
  }

  const selectedPath = selection.filePaths[0]
  await fs.mkdir(selectedPath, { recursive: true })
  await writeDataDirectoryPreference(selectedPath)
  return { ok: true, path: selectedPath, message: 'Data directory selected' }
}

async function chooseBackupDirectory(): Promise<{ ok: boolean; path: string; message: string }> {
  const selection = await dialog.showOpenDialog({
    title: 'Choose Format Flow backup directory',
    properties: ['openDirectory', 'createDirectory']
  })
  if (selection.canceled || !selection.filePaths[0]) {
    return { ok: false, path: '', message: 'Backup directory selection cancelled' }
  }

  const selectedPath = selection.filePaths[0]
  await fs.mkdir(selectedPath, { recursive: true })
  return { ok: true, path: selectedPath, message: 'Backup directory selected' }
}

async function ensureBuiltInLearningSkills(): Promise<void> {
  const managedDirectory = getManagedSkillDirectory()
  await fs.mkdir(managedDirectory, { recursive: true })

  for (const definition of BUILT_IN_LEARNING_SKILLS) {
    const destination = path.join(managedDirectory, definition.name)
    const legacyNames = 'legacyNames' in definition ? definition.legacyNames : []
    for (const legacyName of legacyNames) {
      try {
        await migrateTemplateDirectory(path.join(managedDirectory, legacyName), destination)
      } catch (error) {
        console.error('Failed to migrate built-in Skill directory: ' + legacyName, error)
      }
    }
    const skillFile = path.join(destination, 'SKILL.md')
    const agentFile = path.join(destination, 'agent', 'openai.yaml')
    const iconFile = path.join(destination, 'assets', 'icon.txt')
    const templateDirectory = 'templateDirectory' in definition ? definition.templateDirectory : ''
    let templateSynced = false

    if (templateDirectory) {
      try {
        await syncTemplateDirectory(path.join(getBuiltInSkillTemplateDirectory(), templateDirectory), destination)
        templateSynced = true
      } catch (error) {
        console.error('Failed to synchronize built-in Skill template: ' + definition.name, error)
      }
    }

    await fs.mkdir(path.join(destination, 'agent'), { recursive: true })
    await Promise.all(['scripts', 'references', 'assets', 'extras'].map((directory) => fs.mkdir(path.join(destination, directory), { recursive: true })))

    if (!templateSynced && !(await pathExists(skillFile))) {
      const content = [
        '---',
        `name: ${definition.name}`,
        `description: ${definition.description}`,
        '---',
        '',
        `# ${definition.title}`,
        '',
        '## When to Use',
        `- ${definition.description}`,
        '',
        '## Instructions',
        ...definition.instructions.map((instruction) => `- ${instruction}`),
        '',
        '## Directory Layout',
        '- SKILL.md: reusable method instructions.',
        '- agent/openai.yaml: OpenAI model configuration.',
        '- scripts, references, assets, extras: method-specific extensions.',
        ''
      ].join('\n')
      await fs.writeFile(skillFile, content, 'utf8')
    }
    if (!templateSynced && !(await pathExists(agentFile))) {
      await fs.writeFile(agentFile, ['model: gpt-5', 'reasoning:', '  effort: medium', ''].join('\n'), 'utf8')
    }
    if (!templateSynced && !(await pathExists(iconFile))) {
      await fs.writeFile(iconFile, `Format Flow Skill: ${definition.name}\n`, 'utf8')
    }
  }
}
async function scanSkills(directories: string[]): Promise<SkillItem[]> {
  await ensureBuiltInLearningSkills()
  const uniqueDirectories = Array.from(new Set([...directories, getManagedSkillDirectory()].filter(Boolean)))
  const files = (
    await Promise.all(uniqueDirectories.map((directory) => findSkillFiles(directory, 0)))
  ).flat()
  const uniqueFiles = Array.from(new Set(files))
  const skills: SkillItem[] = []

  for (const file of uniqueFiles) {
    try {
      const content = await fs.readFile(file, 'utf8')
      const stat = await fs.stat(file)
      skills.push({
        ...parseSkillMarkdown(content, file),
        updatedAt: stat.mtime.toISOString()
      })
    } catch {
      // Ignore unreadable skills; broken files should not block the manager.
    }
  }

  return skills.sort((left, right) => left.name.localeCompare(right.name))
}

async function findSkillFiles(directory: string, depth: number): Promise<string[]> {
  if (depth > 7) return []

  try {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const directSkill = entries.find((entry) => entry.isFile() && entry.name === 'SKILL.md')
    if (directSkill) return [path.join(directory, directSkill.name)]

    const childDirectories = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !['node_modules', '.git', 'dist', 'out'].includes(entry.name))
      .map((entry) => path.join(directory, entry.name))

    return (await Promise.all(childDirectories.map((child) => findSkillFiles(child, depth + 1)))).flat()
  } catch {
    return []
  }
}

async function importExistingSkills(): Promise<ImportResult<SkillItem>> {
  const selection = await dialog.showOpenDialog({
    title: 'Import existing Skill',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Codex Skill', extensions: ['md'] }]
  })
  if (selection.canceled) return emptyImport('Import cancelled')

  return importSkillTargets(selection.filePaths)
}

async function restoreSkillsFromBackup(): Promise<ImportResult<SkillItem>> {
  const selection = await dialog.showOpenDialog({
    title: 'Restore Skills from backup',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Skill backup', extensions: ['zip', 'md', 'json'] }]
  })
  if (selection.canceled) return emptyImport('Restore cancelled')

  return importSkillTargets(selection.filePaths)
}

async function installSkillZip(): Promise<ImportResult<SkillItem>> {
  const selection = await dialog.showOpenDialog({
    title: 'Install Skill from ZIP',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }]
  })
  if (selection.canceled) return emptyImport('Install cancelled')

  const installed: SkillItem[] = []
  const installedPaths: string[] = []
  for (const zipPath of selection.filePaths) {
    const result = await extractSkillZip(zipPath)
    installed.push(...result.items)
    installedPaths.push(...(result.installedPaths || []))
  }

  return {
    ok: installed.length > 0,
    message: installed.length > 0 ? `Installed ${installed.length} Skill(s)` : 'No SKILL.md found in selected ZIP',
    items: installed,
    installedPaths,
    managedDirectory: getManagedSkillDirectory()
  }
}

async function installGeneratedSkill(name: string, content: string): Promise<ImportResult<SkillItem>> {
  const cleanName = safeSegment(name || 'learned-skill')
  const managedDirectory = getManagedSkillDirectory()
  await fs.mkdir(managedDirectory, { recursive: true })
  const destination = await uniqueDirectory(path.join(managedDirectory, cleanName))
  const skillFile = path.join(destination, 'SKILL.md')
  await fs.mkdir(path.join(destination, 'agent'), { recursive: true })
  await Promise.all(['scripts', 'references', 'assets', 'extras'].map((directory) => fs.mkdir(path.join(destination, directory), { recursive: true })))
  await fs.writeFile(skillFile, content.trimEnd() + '\n', 'utf8')
  await fs.writeFile(path.join(destination, 'agent', 'openai.yaml'), ['model: gpt-5', 'reasoning:', '  effort: medium', ''].join('\n'), 'utf8')
  await fs.writeFile(path.join(destination, 'assets', 'icon.txt'), `Format Flow Skill: ${cleanName}\n`, 'utf8')
  const stat = await fs.stat(skillFile)
  const skill = { ...parseSkillMarkdown(content, skillFile), updatedAt: stat.mtime.toISOString() }

  return {
    ok: true,
    message: `Generated Skill saved: ${skill.title}`,
    items: [skill],
    installedPaths: [destination],
    managedDirectory
  }
}

async function deleteSkill(skill: SkillItem): Promise<ExportResult> {
  const skillFile = path.resolve(skill.path)
  if (path.basename(skillFile).toLowerCase() !== 'skill.md') {
    return { ok: false, message: '只能删除 SKILL.md 对应的单个 Skill' }
  }

  try {
    await fs.access(skillFile)
    const skillDirectory = path.dirname(skillFile)
    await shell.trashItem(skillDirectory)
    return { ok: true, message: `已将 Skill 移到回收站：${skill.title || skill.name}`, path: skillDirectory }
  } catch (error) {
    return { ok: false, message: `删除 Skill 失败：${errorMessage(error)}` }
  }
}

async function importSkillTargets(targets: string[]): Promise<ImportResult<SkillItem>> {
  const installed: SkillItem[] = []
  const installedPaths: string[] = []

  for (const target of targets) {
    const stat = await fs.stat(target)
    if (stat.isFile() && target.toLowerCase().endsWith('.json')) {
      const restored = await restoreSkillsFromJsonBackup(target)
      installed.push(...restored.items)
      installedPaths.push(...(restored.installedPaths || []))
      continue
    }

    if (stat.isFile() && target.toLowerCase().endsWith('.zip')) {
      const result = await extractSkillZip(target)
      installed.push(...result.items)
      installedPaths.push(...(result.installedPaths || []))
      continue
    }

    const skillFiles = stat.isDirectory()
      ? await findSkillFiles(target, 0)
      : path.basename(target).toLowerCase() === 'skill.md'
        ? [target]
        : []

    for (const skillFile of skillFiles) {
      const skill = await copySkillRoot(skillFile)
      installed.push(skill)
      installedPaths.push(path.dirname(skill.path))
    }
  }

  return {
    ok: installed.length > 0,
    message: installed.length > 0 ? `Imported ${installed.length} Skill(s)` : 'No SKILL.md found',
    items: installed,
    installedPaths,
    managedDirectory: getManagedSkillDirectory()
  }
}

async function restoreSkillsFromJsonBackup(filePath: string): Promise<ImportResult<SkillItem>> {
  const content = await fs.readFile(filePath, 'utf8')
  const parsed = JSON.parse(content) as { skills?: Array<{ name?: string; title?: string; path?: string; content?: string }> }
  const skillBackups = Array.isArray(parsed.skills) ? parsed.skills.filter((item) => typeof item.content === 'string') : []
  const managedDirectory = getManagedSkillDirectory()
  const items: SkillItem[] = []
  const installedPaths: string[] = []

  await fs.mkdir(managedDirectory, { recursive: true })
  for (const backup of skillBackups) {
    const name = safeSegment(backup.name || backup.title || path.basename(backup.path || '') || 'restored-skill')
    const destination = await uniqueDirectory(path.join(managedDirectory, name))
    const skillFile = path.join(destination, 'SKILL.md')
    await fs.writeFile(skillFile, backup.content || '', 'utf8')
    const stat = await fs.stat(skillFile)
    items.push({ ...parseSkillMarkdown(backup.content || '', skillFile), updatedAt: stat.mtime.toISOString() })
    installedPaths.push(destination)
  }

  return {
    ok: items.length > 0,
    message: items.length > 0 ? `Restored ${items.length} Skill(s)` : 'No Skill backups found in JSON',
    items,
    installedPaths,
    managedDirectory
  }
}

async function copySkillRoot(skillFile: string): Promise<SkillItem> {
  const managedDirectory = getManagedSkillDirectory()
  await fs.mkdir(managedDirectory, { recursive: true })

  const root = path.dirname(skillFile)
  if (isPathInside(root, managedDirectory)) {
    const content = await fs.readFile(skillFile, 'utf8')
    const stat = await fs.stat(skillFile)
    return { ...parseSkillMarkdown(content, skillFile), updatedAt: stat.mtime.toISOString() }
  }

  const preview = parseSkillMarkdown(await fs.readFile(skillFile, 'utf8'), skillFile)
  const destination = await uniqueDirectory(path.join(managedDirectory, safeSegment(preview.name || path.basename(root))))
  await fs.cp(root, destination, { recursive: true, force: false, errorOnExist: false })
  const copiedSkillFile = path.join(destination, path.relative(root, skillFile))
  const content = await fs.readFile(copiedSkillFile, 'utf8')
  const stat = await fs.stat(copiedSkillFile)
  return { ...parseSkillMarkdown(content, copiedSkillFile), updatedAt: stat.mtime.toISOString() }
}

async function extractSkillZip(zipPath: string): Promise<ImportResult<SkillItem>> {
  const managedDirectory = getManagedSkillDirectory()
  await fs.mkdir(managedDirectory, { recursive: true })
  const destination = await uniqueDirectory(path.join(managedDirectory, safeSegment(path.basename(zipPath, '.zip'))))
  const zip = new AdmZip(zipPath)

  for (const entry of zip.getEntries()) {
    const targetPath = path.resolve(destination, entry.entryName)
    if (!isPathInside(targetPath, destination)) {
      throw new Error(`Unsafe ZIP entry blocked: ${entry.entryName}`)
    }
  }

  zip.extractAllTo(destination, true)
  const skillFiles = await findSkillFiles(destination, 0)
  const items: SkillItem[] = []
  for (const skillFile of skillFiles) {
    const content = await fs.readFile(skillFile, 'utf8')
    const stat = await fs.stat(skillFile)
    items.push({ ...parseSkillMarkdown(content, skillFile), updatedAt: stat.mtime.toISOString() })
  }

  return {
    ok: items.length > 0,
    message: items.length > 0 ? `Installed ${items.length} Skill(s)` : 'No SKILL.md found in ZIP',
    items,
    installedPaths: [destination],
    managedDirectory
  }
}

async function importPromptFiles(): Promise<ImportResult<PromptItem>> {
  return importPromptsWithDialog('Import existing prompts')
}

async function restorePromptsFromBackup(): Promise<ImportResult<PromptItem>> {
  return importPromptsWithDialog('Restore prompts from backup')
}

async function importPromptsWithDialog(title: string): Promise<ImportResult<PromptItem>> {
  const selection = await dialog.showOpenDialog({
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Prompt files', extensions: ['json', 'md', 'txt'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (selection.canceled) return emptyImport('Import cancelled')

  const prompts: PromptItem[] = []
  for (const filePath of selection.filePaths) {
    const content = await fs.readFile(filePath, 'utf8')
    prompts.push(...parsePromptImport(content, path.basename(filePath)))
  }

  return {
    ok: prompts.length > 0,
    message: prompts.length > 0 ? `Imported ${prompts.length} prompt(s)` : 'No prompts found',
    items: prompts
  }
}

async function importMcpConfig(): Promise<ImportResult<McpServer>> {
  return importMcpConfigWithDialog('Import MCP config')
}

async function restoreMcpFromBackup(): Promise<ImportResult<McpServer>> {
  return importMcpConfigWithDialog('Restore MCP from backup')
}

async function importMcpConfigWithDialog(title: string): Promise<ImportResult<McpServer>> {
  const selection = await dialog.showOpenDialog({
    title,
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'MCP config', extensions: ['json', 'toml'] },
      { name: 'All files', extensions: ['*'] }
    ]
  })
  if (selection.canceled) return emptyImport('Import cancelled')

  const servers: McpServer[] = []
  for (const filePath of selection.filePaths) {
    const content = await fs.readFile(filePath, 'utf8')
    servers.push(...parseMcpConfig(content, path.basename(filePath)))
  }

  return {
    ok: servers.length > 0,
    message: servers.length > 0 ? `Imported ${servers.length} MCP server(s)` : 'No MCP servers found',
    items: servers
  }
}

async function createBackup(store: AppStore): Promise<BackupResult> {
  const normalized = normalizeStore(store)
  const backupDirectory = normalized.settings.backupDirectory || getDefaultBackupDirectory()
  await fs.mkdir(backupDirectory, { recursive: true })

  const timestamp = new Date().toISOString()
  const fileStamp = timestamp.replace(/[:.]/g, '-')
  const backupPath = path.join(backupDirectory, `format-flow-backup-${fileStamp}.json`)
  const payload = await buildBackupPayload(normalized, timestamp)
  await fs.writeFile(backupPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return { ok: true, message: `Backup created: ${backupPath}`, path: backupPath }
}

async function createGitBackup(store: AppStore): Promise<BackupResult> {
  const normalized = normalizeStore(store)
  const backup = await createBackup(normalized)
  if (!backup.ok || !backup.path) return backup

  const backupDirectory = normalized.settings.backupDirectory || getDefaultBackupDirectory()
  const branch = safeGitBranch(normalized.settings.gitBackupBranch || 'main')
  const remote = normalized.settings.gitBackupRemote?.trim() || ''
  const userEmail = normalized.settings.gitBackupUserEmail?.trim() || '2878705044@qq.com'

  try {
    await ensureGitRepository(backupDirectory, branch, userEmail, remote)
    await runGit(backupDirectory, ['add', '--all'])
    const status = (await runGit(backupDirectory, ['status', '--porcelain'])).stdout.trim()

    if (!status) {
      return {
        ok: true,
        message: `Git backup has no new changes: ${backup.path}`,
        path: backup.path,
        pushed: false,
        remote
      }
    }

    await runGit(backupDirectory, ['commit', '-m', `Format Flow backup ${new Date().toISOString()}`])
    const commit = (await runGit(backupDirectory, ['rev-parse', '--short', 'HEAD'])).stdout.trim()

    if (!remote) {
      return {
        ok: true,
        message: `Git local backup committed (${commit}). Configure a remote URL to push.`,
        path: backup.path,
        commit,
        pushed: false
      }
    }

    try {
      await runGit(backupDirectory, ['push', '-u', 'origin', branch])
      return {
        ok: true,
        message: `Git backup committed and pushed (${commit}).`,
        path: backup.path,
        commit,
        pushed: true,
        remote
      }
    } catch (error) {
      return {
        ok: true,
        message: `Git local backup committed (${commit}), but push failed: ${errorMessage(error)}`,
        path: backup.path,
        commit,
        pushed: false,
        remote
      }
    }
  } catch (error) {
    return {
      ok: false,
      message: `Git backup failed after writing ${backup.path}: ${errorMessage(error)}`,
      path: backup.path,
      pushed: false,
      remote
    }
  }
}

async function buildBackupPayload(normalized: AppStore, timestamp: string): Promise<Record<string, unknown>> {
  const skills = await collectSkillBackups(normalized.settings.skillDirectories)
  return {
    format: 'format-flow-backup',
    version: 1,
    createdAt: timestamp,
    prompts: normalized.prompts,
    skills,
    skillIndex: normalized.skillIndex,
    groups: normalized.groups,
    mcpServers: normalized.mcpServers,
    workflows: normalized.workflows,
    settings: {
      shortcut: normalized.settings.shortcut,
      skillDirectories: normalized.settings.skillDirectories,
      dataDirectory: normalized.settings.dataDirectory,
      backupDirectory: normalized.settings.backupDirectory,
      gitBackupRemote: normalized.settings.gitBackupRemote,
      gitBackupBranch: normalized.settings.gitBackupBranch,
      gitBackupUserEmail: normalized.settings.gitBackupUserEmail
    }
  }
}

async function ensureGitRepository(directory: string, branch: string, userEmail: string, remote: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  if (!(await pathExists(path.join(directory, '.git')))) {
    await runGit(directory, ['init'])
  }
  await runGit(directory, ['checkout', '-B', branch])
  await runGit(directory, ['config', 'user.email', userEmail])
  await runGit(directory, ['config', 'user.name', 'Format Flow Backup'])

  if (!remote) return
  const currentRemote = await runGit(directory, ['remote', 'get-url', 'origin']).catch(() => ({ stdout: '' }))
  if (currentRemote.stdout.trim()) {
    await runGit(directory, ['remote', 'set-url', 'origin', remote])
  } else {
    await runGit(directory, ['remote', 'add', 'origin', remote])
  }
}

async function runGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFile('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 * 10 })
  return { stdout: result.stdout, stderr: result.stderr }
}

function safeGitBranch(value: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^[-/]+|[-/]+$/g, '')
  return cleaned || 'main'
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function noneSkillNode(name: string): SkillDirectoryNode {
  return { name, kind: 'none' }
}

function fileSkillNode(name: string, filePath: string, content?: string): SkillDirectoryNode {
  return { name, kind: 'file', path: filePath, content, isText: isTextSkillFile(filePath) }
}

function directorySkillNode(name: string, directoryPath: string, children: SkillDirectoryNode[]): SkillDirectoryNode {
  return { name, kind: 'directory', path: directoryPath, children }
}

function isLocalSkillPath(targetPath: string): boolean {
  const trimmed = targetPath.trim()
  return Boolean(trimmed) && (/^[A-Za-z]:[\/]/.test(trimmed) || trimmed.startsWith('\\') || path.isAbsolute(trimmed))
}

function skillRootDirectory(skillPath: string): string {
  const resolved = path.resolve(skillPath)
  return path.basename(resolved).toLowerCase() === 'skill.md' ? path.dirname(resolved) : resolved
}

function isTextSkillFile(filePath: string): boolean {
  const normalized = path.basename(filePath).toLowerCase()
  return normalized === 'skill.md' || SKILL_TEXT_EXTENSIONS.has(path.extname(normalized))
}

async function readSkillFileNode(filePath: string, name: string): Promise<SkillDirectoryNode> {
  if (!(await pathExists(filePath))) return noneSkillNode(name)

  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return noneSkillNode(name)
    const content = isTextSkillFile(filePath) && stat.size <= 512000 ? await fs.readFile(filePath, 'utf8') : undefined
    return fileSkillNode(name, filePath, content)
  } catch {
    return noneSkillNode(name)
  }
}

async function readSkillDirectoryNode(directoryPath: string, name: string): Promise<SkillDirectoryNode> {
  if (!(await pathExists(directoryPath))) return noneSkillNode(name)

  try {
    const stat = await fs.stat(directoryPath)
    if (!stat.isDirectory()) return noneSkillNode(name)
    const entries = await fs.readdir(directoryPath, { withFileTypes: true })
    const children: SkillDirectoryNode[] = []
    for (const entry of entries.filter((entry) => !['.git', 'node_modules', 'dist', 'out'].includes(entry.name)).sort((left, right) => left.name.localeCompare(right.name))) {
      const targetPath = path.join(directoryPath, entry.name)
      children.push(entry.isDirectory() ? await readSkillDirectoryNode(targetPath, entry.name) : await readSkillFileNode(targetPath, entry.name))
    }
    return directorySkillNode(name, directoryPath, children)
  } catch {
    return noneSkillNode(name)
  }
}

async function readSkillDirectorySnapshot(skillPath: string): Promise<SkillDirectorySnapshot> {
  const root = skillRootDirectory(skillPath)
  if (!isLocalSkillPath(root) || !(await pathExists(root))) {
    return {
      root: root || skillPath,
      skillMd: noneSkillNode('SKILL.md'),
      agentOpenAiYaml: noneSkillNode('agent/openai.yaml'),
      scripts: noneSkillNode('scripts'),
      references: noneSkillNode('references'),
      assets: noneSkillNode('assets'),
      extras: []
    }
  }

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const skillMd = await readSkillFileNode(path.join(root, 'SKILL.md'), 'SKILL.md')
  const agentCandidates = ['agent/openai.yaml', 'agent/openai.yml', 'agents/openai.yaml', 'agents/openai.yml', 'openai.yaml', 'openai.yml']
  let agentOpenAiYaml = noneSkillNode('agent/openai.yaml')
  for (const candidate of agentCandidates) {
    const candidatePath = path.join(root, candidate)
    if (await pathExists(candidatePath)) {
      agentOpenAiYaml = await readSkillFileNode(candidatePath, 'agent/openai.yaml')
      break
    }
  }

  const scripts = await readSkillDirectoryNode(path.join(root, 'scripts'), 'scripts')
  const references = await readSkillDirectoryNode(path.join(root, 'references'), 'references')
  const assets = await readSkillDirectoryNode(path.join(root, 'assets'), 'assets')
  const extras: SkillDirectoryNode[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const lower = entry.name.toLowerCase()
    if (['skill.md', 'agent', 'agents', 'scripts', 'references', 'assets'].includes(lower)) continue
    const targetPath = path.join(root, entry.name)
    extras.push(entry.isDirectory() ? await readSkillDirectoryNode(targetPath, entry.name) : await readSkillFileNode(targetPath, entry.name))
  }

  return { root, skillMd, agentOpenAiYaml, scripts, references, assets, extras }
}

function skillRelativePath(root: string, targetPath: string): string {
  const relative = path.relative(root, targetPath).replace(/\\/g, '/')
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : ''
}

function resolveSkillChildPath(skillPath: string, relativePath = ''): { root: string; target: string; relative: string } {
  const root = skillRootDirectory(skillPath)
  const cleanRelative = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const target = path.resolve(root, cleanRelative || '.')
  const actualRelative = path.relative(root, target)
  if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) {
    throw new Error('Path is outside the Skill directory')
  }
  return { root, target, relative: cleanRelative }
}

function safeSkillEntryName(name: string): string {
  const cleanName = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+$/, '').slice(0, 120)
  if (!cleanName) throw new Error('Please enter a valid file or folder name')
  return cleanName
}

async function openSkillPath(skillPath: string, targetRelativePath = ''): Promise<ExportResult> {
  try {
    const { root, target } = resolveSkillChildPath(skillPath, targetRelativePath)
    const candidate = (await pathExists(target)) ? target : path.dirname(target)
    const opened = (await pathExists(candidate)) ? candidate : root
    const message = await shell.openPath(opened)
    return message ? { ok: false, message, path: opened } : { ok: true, message: 'Opened local Skill location', path: opened }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

async function writeSkillTextFile(request: SkillFileWriteRequest): Promise<ExportResult> {
  try {
    const { target, relative } = resolveSkillChildPath(request.skillPath, request.relativePath)
    const normalized = relative.toLowerCase()
    if (!normalized || !isTextSkillFile(target)) {
      return { ok: false, message: 'Only text files in the Skill directory can be edited here', path: target }
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, request.content, 'utf8')
    return { ok: true, message: 'Saved Skill file', path: target }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

async function createSkillEntry(request: SkillEntryCreateRequest): Promise<ExportResult> {
  try {
    const parent = resolveSkillChildPath(request.skillPath, request.parentRelativePath)
    const name = safeSkillEntryName(request.name)
    const target = path.resolve(parent.target, name)
    const relative = path.relative(parent.root, target)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path is outside the Skill directory')
    }
    if (await pathExists(target)) return { ok: false, message: 'File or folder already exists', path: target }
    if (request.kind === 'directory') {
      await fs.mkdir(target, { recursive: true })
      return { ok: true, message: 'Created Skill folder', path: target }
    }
    if (!isTextSkillFile(target)) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await shell.openPath(path.dirname(target))
      return { ok: false, message: 'For non-text files, the folder has been opened. Add the appropriate asset or binary file there.', path: path.dirname(target) }
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, request.content || '', 'utf8')
    return { ok: true, message: 'Created Skill file', path: target }
  } catch (error) {
    return { ok: false, message: errorMessage(error) }
  }
}

async function collectSkillBackups(directories: string[]): Promise<Array<{ name: string; title: string; path: string; content: string; updatedAt: string }>> {
  const skillFiles = Array.from(new Set((await Promise.all(directories.filter(Boolean).map((directory) => findSkillFiles(directory, 0)))).flat()))
  const backups: Array<{ name: string; title: string; path: string; content: string; updatedAt: string }> = []

  for (const skillFile of skillFiles) {
    try {
      const content = await fs.readFile(skillFile, 'utf8')
      const stat = await fs.stat(skillFile)
      const parsed = parseSkillMarkdown(content, skillFile)
      backups.push({
        name: parsed.name,
        title: parsed.title,
        path: skillFile,
        content,
        updatedAt: stat.mtime.toISOString()
      })
    } catch {
      // Skip unreadable skill files; backup should include everything readable instead of failing completely.
    }
  }

  return backups
}

async function searchGithub(kind: 'skill' | 'prompt', query: string): Promise<GithubSearchResult[]> {
  const trimmed = query.trim()
  const repoQuery =
    kind === 'skill'
      ? `${trimmed || 'codex skill'} codex skill in:name,description,readme`
      : `${trimmed || 'prompt template'} prompt template in:name,description,readme`
  const response = await githubFetch(
    `https://api.github.com/search/repositories?q=${encodeURIComponent(repoQuery)}&sort=updated&per_page=8`
  )
  if (!response.ok) throw new Error(`GitHub search failed: ${response.status} ${response.statusText}`)

  const payload = (await response.json()) as {
    items?: Array<{
      id: number
      full_name: string
      description?: string
      default_branch?: string
      html_url: string
    }>
  }

  const results: GithubSearchResult[] = []
  for (const repo of payload.items || []) {
    try {
      const branch = repo.default_branch || 'main'
      const treeResponse = await githubFetch(
        `https://api.github.com/repos/${repo.full_name}/git/trees/${encodeURIComponent(branch)}?recursive=1`
      )
      if (!treeResponse.ok) continue
      const treePayload = (await treeResponse.json()) as {
        tree?: Array<{ path: string; type: string; sha: string }>
      }
      const files = (treePayload.tree || [])
        .filter((entry) => entry.type === 'blob')
        .filter((entry) => isGithubCandidate(kind, entry.path))
        .slice(0, kind === 'skill' ? 4 : 3)

      for (const file of files) {
        results.push({
          id: `${repo.id}:${file.sha}:${file.path}`,
          name: path.basename(file.path),
          repository: repo.full_name,
          description: repo.description || file.path,
          path: file.path,
          htmlUrl: `${repo.html_url}/blob/${branch}/${file.path}`,
          rawUrl: `https://raw.githubusercontent.com/${repo.full_name}/${branch}/${file.path}`
        })
      }
    } catch {
      // Skip repositories that do not expose a tree or hit transient rate limits.
    }
    if (results.length >= 20) break
  }

  return results.slice(0, 20)
}

function isGithubCandidate(kind: 'skill' | 'prompt', filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  if (kind === 'skill') return normalized.endsWith('/skill.md') || normalized === 'skill.md'
  return (
    /\.(md|txt|json)$/.test(normalized) &&
    (normalized.includes('prompt') ||
      normalized.includes('prompts') ||
      normalized.includes('template') ||
      normalized.includes('instructions'))
  )
}

function githubFetch(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'format-flow'
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(url, { headers })
}

async function installGithubSkill(result: GithubSearchResult): Promise<ImportResult<SkillItem>> {
  const content = await fetchText(result.rawUrl)
  const managedDirectory = getManagedSkillDirectory()
  await fs.mkdir(managedDirectory, { recursive: true })
  const destination = await uniqueDirectory(
    path.join(managedDirectory, safeSegment(`${result.repository}-${path.dirname(result.path)}`))
  )
  const skillFile = path.join(destination, 'SKILL.md')
  await fs.writeFile(skillFile, content, 'utf8')
  const stat = await fs.stat(skillFile)
  const skill = { ...parseSkillMarkdown(content, skillFile), updatedAt: stat.mtime.toISOString() }

  return {
    ok: true,
    message: `Installed ${skill.name}`,
    items: [skill],
    installedPaths: [destination],
    managedDirectory
  }
}

async function importGithubPrompt(result: GithubSearchResult): Promise<ImportResult<PromptItem>> {
  const content = await fetchText(result.rawUrl)
  const prompt = createPromptFromText(content, `${result.repository}/${result.path}`)
  return {
    ok: true,
    message: `Imported ${prompt.title}`,
    items: [prompt]
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'format-flow'
    }
  })
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`)
  return response.text()
}

async function uniqueDirectory(basePath: string): Promise<string> {
  let candidate = basePath
  let index = 2
  while (await pathExists(candidate)) {
    candidate = `${basePath}-${index}`
    index += 1
  }
  await fs.mkdir(candidate, { recursive: true })
  return candidate
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function isPathInside(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'imported'
}

function emptyImport<T>(message: string): ImportResult<T> {
  return {
    ok: false,
    message,
    items: []
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: 'Format Flow',
    backgroundColor: '#f7f5ef',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow.setMenu(null)
  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!shortcutCaptureActive || !['keyDown', 'keyUp'].includes(input.type)) return
    event.preventDefault()
    mainWindow?.webContents.send('shortcut:captureInput', {
      key: input.key,
      code: input.code,
      control: input.control,
      meta: input.meta,
      alt: input.alt,
      shift: input.shift
    })
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function showMainWindowInForeground(temporaryAlwaysOnTop = false): void {
  const window = mainWindow
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()

  if (releaseForegroundTimer) {
    clearTimeout(releaseForegroundTimer)
    releaseForegroundTimer = null
  }

  window.setFocusable(true)
  window.show()
  if (temporaryAlwaysOnTop) window.setAlwaysOnTop(true, 'screen-saver')
  window.moveTop()
  window.focus()
  window.flashFrame(false)

  if (temporaryAlwaysOnTop) {
    releaseForegroundTimer = setTimeout(() => {
      releaseForegroundTimer = null
      if (window.isDestroyed()) return
      window.setAlwaysOnTop(false)
      window.flashFrame(false)
    }, 1200)
  }
}

async function toggleMainWindow(): Promise<void> {
  if (!mainWindow) return
  const now = Date.now()
  if (now - lastLauncherOpenAt < 500) return
  lastLauncherOpenAt = now
  await rememberExternalForegroundWindow()
  mainWindow.webContents.send('launcher:open')
  showMainWindowInForeground(true)
}

function focusExistingWindow(): void {
  showMainWindowInForeground(true)
}

async function registerStoredShortcut(): Promise<ShortcutResult> {
  const store = await loadStore()
  return registerShortcut(store.settings.shortcut)
}

function setShortcutCaptureActive(active: boolean): void {
  if (shortcutCaptureActive === active) return
  shortcutCaptureActive = active

  if (active) {
    if (registeredShortcut && !isMouseShortcut(registeredShortcut)) globalShortcut.unregister(registeredShortcut)
    stopMouseShortcutWatcher()
    captureAltSpaceRegistered = globalShortcut.register('Alt+Space', () => {
      mainWindow?.webContents.send('shortcut:captureInput', {
        key: 'Space',
        code: 'Space',
        control: false,
        meta: false,
        alt: true,
        shift: false
      })
    })
    return
  }

  if (captureAltSpaceRegistered) {
    globalShortcut.unregister('Alt+Space')
    captureAltSpaceRegistered = false
  }

  if (registeredShortcut) {
    if (isMouseShortcut(registeredShortcut)) {
      if (!mouseShortcutProcess) startMouseShortcutWatcher(registeredShortcut)
    } else if (!isKeyboardShortcutRegistered(registeredShortcut)) {
      try {
        globalShortcut.register(registeredShortcut, () => {
          void toggleMainWindow()
        })
      } catch {
        // The explicit save flow will surface conflicts or invalid accelerators to the user.
      }
    }
  }
}

function registerShortcut(accelerator: string): ShortcutResult {
  const normalizedAccelerator = accelerator.trim()
  if (!normalizedAccelerator) {
    return { ok: false, accelerator: registeredShortcut, message: '快捷键不能为空。' }
  }

  if (isMouseShortcut(normalizedAccelerator)) {
    const result = startMouseShortcutWatcher(normalizedAccelerator)
    if (result.ok) {
      if (registeredShortcut && !isMouseShortcut(registeredShortcut)) globalShortcut.unregister(registeredShortcut)
      registeredShortcut = normalizedAccelerator
    }
    return result
  }

  if (normalizedAccelerator.startsWith('MouseButton')) {
    return {
      ok: false,
      accelerator: registeredShortcut || normalizedAccelerator,
      message: '无法识别这个鼠标快捷键，请使用 MouseButton4 或 MouseButton5。'
    }
  }

  if (registeredShortcut === normalizedAccelerator && isKeyboardShortcutRegistered(normalizedAccelerator)) {
    return {
      ok: true,
      accelerator: normalizedAccelerator,
      message: '快捷键已注册'
    }
  }

  stopMouseShortcutWatcher()
  let ok = false
  try {
    ok = globalShortcut.register(normalizedAccelerator, () => {
      void toggleMainWindow()
    })
  } catch {
    ok = false
  }
  if (ok) {
    if (registeredShortcut && registeredShortcut !== normalizedAccelerator && !isMouseShortcut(registeredShortcut)) {
      globalShortcut.unregister(registeredShortcut)
    }
    registeredShortcut = normalizedAccelerator
  }
  return {
    ok,
    accelerator: ok ? normalizedAccelerator : registeredShortcut || normalizedAccelerator,
    message: ok ? '快捷键已注册' : `快捷键“${normalizedAccelerator}”注册失败，可能已被系统或其他软件占用，请换一个组合键。`
  }
}

function isKeyboardShortcutRegistered(accelerator: string): boolean {
  try {
    return globalShortcut.isRegistered(accelerator)
  } catch {
    return false
  }
}

function registerIpc(): void {
  ipcMain.handle('license:getStatus', () => getLicenseStatus(app.getPath('userData')))
  ipcMain.handle('license:activate', (_event, password: string) => activateLicense(app.getPath('userData'), password))
  ipcMain.handle('store:load', () => loadStore())
  ipcMain.handle('store:save', (_event, store: AppStore) => saveStore(store))
  ipcMain.handle('paths:get', () => getPaths())
  ipcMain.handle('paths:chooseDataDirectory', () => chooseDataDirectory())
  ipcMain.handle('paths:chooseBackupDirectory', () => chooseBackupDirectory())
  ipcMain.handle('backup:create', (_event, store: AppStore) => createBackup(store))
  ipcMain.handle('backup:createGit', (_event, store: AppStore) => createGitBackup(store))
  ipcMain.handle('export:textFile', (_event, request: ExportTextFileRequest) => exportTextFile(request))
  ipcMain.handle('skills:scan', (_event, directories: string[]) => scanSkills(directories))
  ipcMain.handle('skills:importExisting', () => importExistingSkills())
  ipcMain.handle('skills:restoreBackup', () => restoreSkillsFromBackup())
  ipcMain.handle('skills:installZip', () => installSkillZip())
  ipcMain.handle('skills:installGenerated', (_event, name: string, content: string) => installGeneratedSkill(name, content))
  ipcMain.handle('skills:delete', (_event, skill: SkillItem) => deleteSkill(skill))
  ipcMain.handle('skills:getDirectorySnapshot', (_event, skillPath: string) => readSkillDirectorySnapshot(skillPath))
  ipcMain.handle('skills:openPath', (_event, skillPath: string, targetRelativePath?: string) => openSkillPath(skillPath, targetRelativePath))
  ipcMain.handle('skills:writeTextFile', (_event, request: SkillFileWriteRequest) => writeSkillTextFile(request))
  ipcMain.handle('skills:createEntry', (_event, request: SkillEntryCreateRequest) => createSkillEntry(request))
  ipcMain.handle('github:searchSkills', (_event, query: string) => searchGithub('skill', query))
  ipcMain.handle('github:installSkill', (_event, result: GithubSearchResult) => installGithubSkill(result))
  ipcMain.handle('prompts:importExisting', () => importPromptFiles())
  ipcMain.handle('prompts:restoreBackup', () => restorePromptsFromBackup())
  ipcMain.handle('github:searchPrompts', (_event, query: string) => searchGithub('prompt', query))
  ipcMain.handle('github:importPrompt', (_event, result: GithubSearchResult) => importGithubPrompt(result))
  ipcMain.handle('mcps:importConfig', () => importMcpConfig())
  ipcMain.handle('mcps:restoreBackup', () => restoreMcpFromBackup())
  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    try {
      clipboard.writeText(text)
      return { ok: true, message: '已复制到剪贴板' }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : '写入剪贴板失败'
      }
    }
  })
  ipcMain.handle('clipboard:writeTextAndPaste', (_event, text: string) => writeClipboardTextAndPasteWithFeedback(text))
  ipcMain.handle('temporaryWord:captureSelection', (_event, variableName: string) =>
    captureWordSelection(variableName, lastExternalForegroundWindow)
  )
  ipcMain.handle('temporaryWord:chooseFiles', async (_event, variableName: string) => {
    const selection = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: `选择要放入“${variableName}”临时 Word 的文件`,
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: '所有文件', extensions: ['*'] }]
        })
      : await dialog.showOpenDialog({
          title: `选择要放入“${variableName}”临时 Word 的文件`,
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: '所有文件', extensions: ['*'] }]
        })
    if (selection.canceled || selection.filePaths.length === 0) return { ok: false, message: '已取消选择文件。' }
    return createTemporaryWordFromFiles(variableName, selection.filePaths)
  })
  ipcMain.handle('temporaryWord:createFromFiles', (_event, request: TemporaryWordFilesRequest) =>
    createTemporaryWordFromFiles(request.variableName, request.filePaths)
  )
  ipcMain.handle('temporaryWord:open', (_event, filePath: string) => shell.openPath(filePath))
  ipcMain.handle('temporaryWord:reveal', (_event, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('temporaryWord:copyFiles', (_event, filePaths: string[]) => copyTemporaryWordFiles(filePaths))
  ipcMain.handle('temporaryWord:copyPayload', (_event, request: TemporaryWordClipboardRequest) =>
    copyTemporaryWordPayload(request.text, request.filePaths)
  )
  ipcMain.handle('temporaryWord:remove', (_event, filePath: string) => removeTemporaryWordAttachment(filePath))
  ipcMain.handle('temporaryWord:cleanup', () => cleanupTemporaryWordAttachments())
  ipcMain.handle('browserBridge:getStatus', () => getBrowserBridgeStatus())
  ipcMain.handle('browserBridge:getOutput', () => browserBridgeOutput)
  ipcMain.handle('browserBridge:queueTask', (_event, payload: Record<string, unknown>) => queueBrowserBridgeTask(payload))
  ipcMain.handle('browserExtension:openInstaller', () => openBrowserExtensionInstaller())
  ipcMain.handle('shortcut:set', async (_event, accelerator: string) => {
    const result = registerShortcut(accelerator)
    if (result.ok) {
      const store = await loadStore()
      await saveStore({
        ...store,
        settings: {
          ...store.settings,
          shortcut: result.accelerator
        }
      })
    }
    return result
  })
  ipcMain.handle('shortcut:captureActive', (_event, active: boolean) => {
    setShortcutCaptureActive(active)
  })
  ipcMain.handle('shell:openPath', (_event, targetPath: string) => shell.openPath(targetPath))
}

const singleInstanceLock = app.requestSingleInstanceLock()

if (!singleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    focusExistingWindow()
  })
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) return
  if (process.platform === 'win32') app.setAppUserModelId('com.songyu.formatflow')
  Menu.setApplicationMenu(null)
  registerIpc()
  await cleanupTemporaryWordAttachments()
  temporaryWordCleanupTimer = setInterval(() => {
    void cleanupTemporaryWordAttachments()
  }, 6 * 60 * 60 * 1000)
  startBrowserBridgeServer()
  createWindow()
  await registerStoredShortcut()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', () => {
  shortcutCaptureActive = false
  captureAltSpaceRegistered = false
  stopMouseShortcutWatcher()
  if (temporaryWordCleanupTimer) clearInterval(temporaryWordCleanupTimer)
  temporaryWordCleanupTimer = null
  globalShortcut.unregisterAll()
  browserBridgeServer?.close()
})
