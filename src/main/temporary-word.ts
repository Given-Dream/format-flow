import { randomBytes } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  ExportResult,
  TemporaryWordAttachment,
  TemporaryWordCleanupResult,
  TemporaryWordResult
} from '../shared/types'

const execFile = promisify(execFileCallback)
const retentionMilliseconds = 24 * 60 * 60 * 1000
const maximumFileBytes = 100 * 1024 * 1024
const maximumTotalBytes = 250 * 1024 * 1024
const wordExtensions = new Set(['.doc', '.docx', '.docm', '.rtf', '.odt'])
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp'])
const textExtensions = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.log',
  '.ini',
  '.toml'
])

const wordAutomationScript = String.raw`
param(
  [Parameter(Mandatory=$true)][string]$Mode,
  [Parameter(Mandatory=$true)][string]$OutputPath,
  [Parameter(Mandatory=$true)][string]$AttachmentId,
  [Parameter(Mandatory=$true)][string]$VariableName,
  [string]$FilesBase64,
  [string]$PreferredWindowHandle = '0'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$word = $null
$document = $null
$createdWord = $false

function End-Range($doc) {
  return $doc.Range($doc.Content.End - 1, $doc.Content.End - 1)
}

function Add-Paragraph($doc, [string]$text) {
  $range = End-Range $doc
  $range.InsertAfter($text + [Environment]::NewLine)
}

function Initialize-WordWindowResolver {
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class FormatFlowWordWindowResolver
{
    private const uint OBJID_NATIVEOM = 0xFFFFFFF0;
    private const uint GA_ROOT = 2;
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hwnd);

    [DllImport("oleacc.dll")]
    private static extern int AccessibleObjectFromWindow(
        IntPtr hwnd,
        uint objectId,
        ref Guid interfaceId,
        [MarshalAs(UnmanagedType.Interface)] out object nativeObject);

    public static bool IsWordWindow(long rawHandle)
    {
        IntPtr hwnd = new IntPtr(rawHandle);
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return false;
        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        return IsWordProcess(root == IntPtr.Zero ? hwnd : root);
    }

    public static object Resolve(long rawHandle)
    {
        IntPtr hwnd = new IntPtr(rawHandle);
        if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) return null;
        IntPtr root = GetAncestor(hwnd, GA_ROOT);
        if (root != IntPtr.Zero) hwnd = root;
        if (!IsWordProcess(hwnd)) return null;

        object nativeObject = ResolveCandidate(hwnd);
        if (nativeObject != null) return nativeObject;
        foreach (IntPtr child in Descendants(hwnd))
        {
            nativeObject = ResolveCandidate(child);
            if (nativeObject != null) return nativeObject;
        }
        return null;
    }

    public static long[] EnumerateWordWindows()
    {
        var handles = new List<long>();
        EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
        {
            if (IsWordProcess(hwnd)) handles.Add(hwnd.ToInt64());
            return true;
        }, IntPtr.Zero);
        return handles.ToArray();
    }

    private static object ResolveCandidate(IntPtr hwnd)
    {
        var className = new StringBuilder(256);
        GetClassName(hwnd, className, className.Capacity);
        if (!String.Equals(className.ToString(), "_WwG", StringComparison.OrdinalIgnoreCase)) return null;

        Guid dispatchId = new Guid("00020400-0000-0000-C000-000000000046");
        object nativeObject;
        int result = AccessibleObjectFromWindow(hwnd, OBJID_NATIVEOM, ref dispatchId, out nativeObject);
        return result == 0 ? nativeObject : null;
    }

    private static List<IntPtr> Descendants(IntPtr parent)
    {
        var handles = new List<IntPtr>();
        EnumChildWindows(parent, delegate(IntPtr hwnd, IntPtr lParam)
        {
            var className = new StringBuilder(256);
            GetClassName(hwnd, className, className.Capacity);
            if (String.Equals(className.ToString(), "_WwG", StringComparison.OrdinalIgnoreCase)) handles.Add(hwnd);
            return true;
        }, IntPtr.Zero);
        return handles;
    }

    private static bool IsWordProcess(IntPtr hwnd)
    {
        uint processId;
        GetWindowThreadProcessId(hwnd, out processId);
        if (processId == 0) return false;
        try
        {
            return String.Equals(Process.GetProcessById((int)processId).ProcessName, "WINWORD", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }
}
'@
}

function Get-ComProperty($instance, [string]$propertyName) {
  if ($null -eq $instance) { return $null }
  try { return $instance.$propertyName } catch { return $null }
}

function Resolve-WordCaptureContext($nativeObject) {
  if ($null -eq $nativeObject) { return $null }

  $applicationCandidates = @(
    $nativeObject,
    (Get-ComProperty $nativeObject 'Application'),
    (Get-ComProperty (Get-ComProperty $nativeObject 'Document') 'Application'),
    (Get-ComProperty (Get-ComProperty $nativeObject 'Parent') 'Application')
  )
  $application = $null
  foreach ($candidate in $applicationCandidates) {
    if ($null -eq $candidate) { continue }
    $documents = Get-ComProperty $candidate 'Documents'
    $protectedViewWindows = Get-ComProperty $candidate 'ProtectedViewWindows'
    if ($null -ne $documents -or $null -ne $protectedViewWindows) {
      $application = $candidate
      break
    }
  }
  if ($null -eq $application) { return $null }

  $documentCandidates = @(
    (Get-ComProperty $nativeObject 'Document'),
    (Get-ComProperty $application 'ActiveDocument'),
    (Get-ComProperty (Get-ComProperty $application 'ActiveProtectedViewWindow') 'Document')
  )
  $selectionCandidates = @(
    (Get-ComProperty $nativeObject 'Selection'),
    (Get-ComProperty $application 'Selection'),
    (Get-ComProperty (Get-ComProperty $nativeObject 'ActiveWindow') 'Selection'),
    (Get-ComProperty (Get-ComProperty $documentCandidates[0] 'ActiveWindow') 'Selection'),
    (Get-ComProperty (Get-ComProperty $documentCandidates[1] 'ActiveWindow') 'Selection'),
    (Get-ComProperty (Get-ComProperty $documentCandidates[2] 'ActiveWindow') 'Selection')
  )

  $document = $documentCandidates | Where-Object { $null -ne $_ } | Select-Object -First 1
  $selection = $selectionCandidates | Where-Object { $null -ne $_ } | Select-Object -First 1
  if ($null -eq $document -and $null -eq $selection) { return $null }

  return [PSCustomObject]@{
    Application = $application
    Document = $document
    Selection = $selection
  }
}

function Resolve-WordContextFromWindow([Int64]$windowHandle) {
  if ($windowHandle -le 0) { return $null }
  $nativeObject = [FormatFlowWordWindowResolver]::Resolve($windowHandle)
  return Resolve-WordCaptureContext $nativeObject
}

try {
  if ($Mode -eq 'capture-selection') {
    Initialize-WordWindowResolver
    $preferredHandle = 0L
    [void][Int64]::TryParse($PreferredWindowHandle, [ref]$preferredHandle)
    $preferredWasWord = $preferredHandle -gt 0 -and [FormatFlowWordWindowResolver]::IsWordWindow($preferredHandle)
    $context = Resolve-WordContextFromWindow $preferredHandle

    if ($null -eq $context) {
      try {
        $activeWord = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
        $context = Resolve-WordCaptureContext $activeWord
      } catch {}
    }

    if ($null -eq $context) {
      foreach ($wordWindowHandle in [FormatFlowWordWindowResolver]::EnumerateWordWindows()) {
        $context = Resolve-WordContextFromWindow $wordWindowHandle
        if ($null -ne $context -and $null -ne $context.Selection) { break }
      }
    }

    if ($null -eq $context) {
      if ($preferredHandle -gt 0 -and -not $preferredWasWord) { throw 'FORMAT_FLOW_PREVIOUS_WINDOW_NOT_WORD' }
      if ([FormatFlowWordWindowResolver]::EnumerateWordWindows().Count -gt 0) { throw 'FORMAT_FLOW_NO_ACTIVE_DOCUMENT' }
      throw 'FORMAT_FLOW_NO_ACTIVE_WORD'
    }

    $word = $context.Application
    $selection = $context.Selection
    $selectionRange = Get-ComProperty $selection 'Range'
    if ($null -eq $selectionRange -or $selectionRange.Start -eq $selectionRange.End) {
      throw 'FORMAT_FLOW_EMPTY_SELECTION'
    }
  } else {
    try {
      $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')
    } catch {
      $word = New-Object -ComObject Word.Application
      $word.Visible = $false
      $createdWord = $true
    }
  }

  $document = $word.Documents.Add()
  $header = $document.Range(0, 0)
  $headerText = @(
    'Format Flow Temporary Attachment',
    "Attachment ID: $AttachmentId",
    "Variable: $VariableName",
    "Created: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))",
    '',
    ''
  ) -join [Environment]::NewLine
  $header.InsertAfter($headerText)
  $header.Font.Bold = 1

  if ($Mode -eq 'capture-selection') {
    $target = End-Range $document
    $target.FormattedText = $selection.Range.FormattedText
  } else {
    if ([string]::IsNullOrWhiteSpace($FilesBase64)) { throw 'FORMAT_FLOW_NO_FILES' }
    $filesJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($FilesBase64))
    $files = @($filesJson | ConvertFrom-Json)
    foreach ($filePath in $files) {
      if (-not [IO.File]::Exists($filePath)) { throw "FORMAT_FLOW_FILE_NOT_FOUND:$filePath" }
      $fileName = [IO.Path]::GetFileName($filePath)
      $extension = [IO.Path]::GetExtension($filePath).ToLowerInvariant()
      Add-Paragraph $document "Source file: $fileName"
      $target = End-Range $document

      if (@('.doc', '.docx', '.docm', '.rtf', '.odt') -contains $extension) {
        $target.InsertFile($filePath)
      } elseif (@('.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.webp') -contains $extension) {
        $null = $target.InlineShapes.AddPicture($filePath, $false, $true)
      } elseif (@('.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.log', '.ini', '.toml') -contains $extension) {
        $content = [IO.File]::ReadAllText($filePath, [Text.Encoding]::UTF8)
        $target.InsertAfter($content)
      } else {
        try {
          $null = $target.InlineShapes.AddOLEObject('', $filePath, $false, $true, '', 0, $fileName)
        } catch {
          Add-Paragraph $document "The original binary file could not be embedded. Source path: $filePath"
        }
      }
      Add-Paragraph $document ""
      Add-Paragraph $document "-----"
      Add-Paragraph $document ""
    }
  }

  $document.SaveAs2($OutputPath, 12)
  $document.Close(0)
  $document = $null
  if ($createdWord) {
    $word.Quit()
    $word = $null
  }
  Write-Output $OutputPath
} catch {
  if ($null -ne $document) {
    try { $document.Close(0) } catch {}
  }
  if ($createdWord -and $null -ne $word) {
    try { $word.Quit() } catch {}
  }
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
} finally {
  if ($null -ne $document) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($document) }
  if ($null -ne $word) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word) }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
`.trim()

export function getTemporaryWordRoot(): string {
  return path.join(os.tmpdir(), 'Format Flow', 'word-attachments')
}

export async function captureWordSelection(
  variableName: string,
  preferredWindowHandle = '0'
): Promise<TemporaryWordResult> {
  if (process.platform !== 'win32') {
    return { ok: false, message: '读取 Word 当前选区目前仅支持 Windows。' }
  }

  const attachment = await createAttachmentRecord(variableName, 'word-selection', ['Word 当前选区'], [])
  return runWordAutomation('capture-selection', attachment, [], preferredWindowHandle)
}

export async function createTemporaryWordFromFiles(variableName: string, filePaths: string[]): Promise<TemporaryWordResult> {
  if (process.platform !== 'win32') {
    return { ok: false, message: '生成临时 Word 文档目前仅支持 Windows。' }
  }

  const uniquePaths = Array.from(new Set(filePaths.filter(Boolean).map((filePath) => path.resolve(filePath))))
  if (uniquePaths.length === 0) return { ok: false, message: '没有收到可导入的文件。' }

  let totalBytes = 0
  for (const filePath of uniquePaths) {
    let stat
    try {
      stat = await fs.stat(filePath)
    } catch {
      return { ok: false, message: `文件不存在或无法读取：${filePath}` }
    }
    if (!stat.isFile()) return { ok: false, message: `只能导入文件：${filePath}` }
    if (stat.size > maximumFileBytes) return { ok: false, message: `单个文件不能超过 100 MB：${path.basename(filePath)}` }
    totalBytes += stat.size
  }
  if (totalBytes > maximumTotalBytes) return { ok: false, message: '一次导入的文件总大小不能超过 250 MB。' }

  const warnings = uniquePaths.flatMap(fileWarning)
  const attachment = await createAttachmentRecord(
    variableName,
    'files',
    uniquePaths.map((filePath) => path.basename(filePath)),
    warnings
  )
  return runWordAutomation('files', attachment, uniquePaths)
}

export async function removeTemporaryWordAttachment(filePath: string): Promise<TemporaryWordCleanupResult> {
  if (!isManagedTemporaryDocument(filePath)) {
    return { ok: false, message: '拒绝删除临时文档目录之外的文件。', removed: 0 }
  }
  try {
    await fs.unlink(filePath)
    return { ok: true, message: '已删除临时 Word 文档。', removed: 1 }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { ok: true, message: '临时 Word 文档已经不存在。', removed: 0 }
    return { ok: false, message: `删除临时 Word 文档失败：${errorMessage(error)}`, removed: 0 }
  }
}

export async function cleanupTemporaryWordAttachments(maxAgeMilliseconds = retentionMilliseconds): Promise<TemporaryWordCleanupResult> {
  const root = getTemporaryWordRoot()
  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return { ok: true, message: '没有需要清理的临时 Word 文档。', removed: 0 }
    return { ok: false, message: `读取临时文档目录失败：${errorMessage(error)}`, removed: 0 }
  }

  const cutoff = Date.now() - Math.max(0, maxAgeMilliseconds)
  let removed = 0
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.docx') continue
    const filePath = path.join(root, entry.name)
    try {
      const stat = await fs.stat(filePath)
      if (stat.mtimeMs > cutoff) continue
      await fs.unlink(filePath)
      removed += 1
    } catch {
      // Locked documents are retried during the next cleanup pass.
    }
  }
  return { ok: true, message: removed > 0 ? `已清理 ${removed} 个过期临时 Word 文档。` : '没有需要清理的过期文档。', removed }
}

export async function copyTemporaryWordFiles(filePaths: string[]): Promise<ExportResult> {
  const managedPaths = Array.from(new Set(filePaths.filter(isManagedTemporaryDocument).filter((filePath) => fsSync.existsSync(filePath))))
  if (managedPaths.length === 0) return { ok: false, message: '没有可复制的临时 Word 文档。' }

  const jsonBase64 = Buffer.from(JSON.stringify(managedPaths), 'utf8').toString('base64')
  const command = [
    `$pathsJson = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${jsonBase64}'))`,
    '[string[]]$paths = $pathsJson | ConvertFrom-Json',
    'Set-Clipboard -LiteralPath $paths'
  ].join('; ')
  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
  try {
    await execFile('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-EncodedCommand', encodedCommand], {
      windowsHide: true,
      timeout: 15_000
    })
    return { ok: true, message: managedPaths.length > 1 ? `已复制 ${managedPaths.length} 个临时 Word 文件。` : '已复制临时 Word 文件。' }
  } catch (error) {
    return { ok: false, message: `复制临时 Word 文件失败：${errorMessage(error)}` }
  }
}

function fileWarning(filePath: string): string[] {
  const extension = path.extname(filePath).toLowerCase()
  if (wordExtensions.has(extension) || imageExtensions.has(extension) || textExtensions.has(extension)) return []
  return [`${path.basename(filePath)} 将作为嵌入对象放入 Word；部分 AI 网站可能无法解析其中的内容。`]
}

async function createAttachmentRecord(
  variableName: string,
  source: TemporaryWordAttachment['source'],
  sourceFileNames: string[],
  warnings: string[]
): Promise<TemporaryWordAttachment> {
  const root = getTemporaryWordRoot()
  await fs.mkdir(root, { recursive: true })
  const id = await uniqueAttachmentId(root)
  const cleanVariableName = safeFileName(variableName || 'variable')
  const fileName = `${id}__${cleanVariableName}.docx`
  const createdAt = new Date()
  return {
    id,
    variableName: variableName.trim() || '未命名变量',
    path: path.join(root, fileName),
    fileName,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + retentionMilliseconds).toISOString(),
    source,
    sourceFileNames,
    warnings
  }
}

async function uniqueAttachmentId(root: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `FFV-${randomBytes(3).toString('hex').toUpperCase()}`
    const entries = await fs.readdir(root)
    if (!entries.some((entry) => entry.startsWith(`${id}__`))) return id
  }
  throw new Error('无法生成唯一的附件 ID。')
}

async function runWordAutomation(
  mode: 'capture-selection' | 'files',
  attachment: TemporaryWordAttachment,
  filePaths: string[],
  preferredWindowHandle = '0'
): Promise<TemporaryWordResult> {
  const root = getTemporaryWordRoot()
  const scriptPath = path.join(root, '.format-flow-word-automation.ps1')
  await fs.writeFile(scriptPath, `\uFEFF${wordAutomationScript}\r\n`, 'utf8')
  const filesBase64 = Buffer.from(JSON.stringify(filePaths), 'utf8').toString('base64')

  try {
    await execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-Mode',
        mode,
        '-OutputPath',
        attachment.path,
        '-AttachmentId',
        attachment.id,
        '-VariableName',
        attachment.variableName,
        '-FilesBase64',
        filesBase64,
        '-PreferredWindowHandle',
        preferredWindowHandle
      ],
      { windowsHide: true, timeout: mode === 'capture-selection' ? 30_000 : 120_000, maxBuffer: 2 * 1024 * 1024 }
    )
    await fs.access(attachment.path)
    return {
      ok: true,
      message: mode === 'capture-selection' ? '已将 Word 当前选区生成临时文档。' : `已将 ${filePaths.length} 个文件整理到临时 Word 文档。`,
      attachment
    }
  } catch (error) {
    await fs.rm(attachment.path, { force: true }).catch(() => undefined)
    return { ok: false, message: wordAutomationErrorMessage(error) }
  }
}

function wordAutomationErrorMessage(error: unknown): string {
  const detail = errorMessage(error)
  if (detail.includes('FORMAT_FLOW_PREVIOUS_WINDOW_NOT_WORD')) return '快捷调用前的窗口不是 Microsoft Word，已无法确定要读取的 Word 选区。请先在 Word 中选中内容，再打开快捷调用。'
  if (detail.includes('FORMAT_FLOW_NO_ACTIVE_WORD')) return '没有检测到正在运行的 Microsoft Word。请先打开文档并选中内容。'
  if (detail.includes('FORMAT_FLOW_NO_ACTIVE_DOCUMENT')) return 'Microsoft Word 中没有打开的文档。'
  if (detail.includes('FORMAT_FLOW_EMPTY_SELECTION')) return 'Word 当前选区为空。请先选中需要保留的文字、公式、表格或图片。'
  if (detail.includes('FORMAT_FLOW_FILE_NOT_FOUND')) return '生成临时 Word 时有源文件已经不存在。'
  if (/cannot find|not recognized|找不到/i.test(detail) && /powershell|word/i.test(detail)) {
    return '生成临时 Word 需要 Windows PowerShell 和 Microsoft Word 桌面版。'
  }
  return `生成临时 Word 文档失败：${detail}`
}

function isManagedTemporaryDocument(filePath: string): boolean {
  const root = path.resolve(getTemporaryWordRoot())
  const resolved = path.resolve(filePath)
  const relative = path.relative(root, resolved)
  return path.extname(resolved).toLowerCase() === '.docx' && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim()
  return (cleaned || 'variable').slice(0, 70)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const details = [error.message, 'stderr' in error ? String(error.stderr || '') : ''].filter(Boolean)
    return details.join(' ').trim()
  }
  return String(error)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
