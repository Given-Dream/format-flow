import { promises as fs } from 'node:fs'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cleanupTemporaryWordAttachments,
  configureTemporaryWordStorage,
  copyTemporaryWordFiles,
  createTemporaryWordFromFiles,
  getTemporaryWordRoot,
  getTemporaryWordScriptRoot,
  readTemporaryWordFilesForBrowser,
  removeTemporaryWordAttachment
} from './temporary-word'

const temporaryRoots: string[] = []

afterEach(async () => {
  const scriptRoots = temporaryRoots.map((root) => `${root}-scripts`)
  configureTemporaryWordStorage({ temporaryWordDirectory: '', temporaryWordRetentionHours: 24 })
  await Promise.all(
    [...temporaryRoots.splice(0), ...scriptRoots].map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe('temporary file attachments', () => {
  it('stores automation scripts separately and cleans them when the attachment directory is absent', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-storage-'))
    temporaryRoots.push(root)
    configureTemporaryWordStorage({ temporaryWordDirectory: root, temporaryWordRetentionHours: 24 })

    const scriptRoot = getTemporaryWordScriptRoot()
    expect(getTemporaryWordRoot()).toBe(root)
    expect(scriptRoot).toBe(`${root}-scripts`)
    expect(scriptRoot).not.toBe(root)

    const attachmentDirectory = path.join(root, 'FFV-ABC123')
    const attachmentPath = path.join(attachmentDirectory, 'source.xlsx')
    await fs.mkdir(attachmentDirectory, { recursive: true })
    await fs.writeFile(attachmentPath, Buffer.from('browser-attachment'))
    await expect(readTemporaryWordFilesForBrowser([attachmentPath])).resolves.toEqual([
      {
        name: 'source.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: Buffer.from('browser-attachment').toString('base64')
      }
    ])

    await fs.mkdir(scriptRoot, { recursive: true })
    const staleScript = path.join(scriptRoot, '.format-flow-clipboard-0123456789ab.ps1')
    const stalePayload = path.join(scriptRoot, '.format-flow-clipboard-0123456789ab.json')
    const unrelatedFile = path.join(scriptRoot, 'keep.txt')
    await Promise.all([
      fs.writeFile(staleScript, 'script'),
      fs.writeFile(stalePayload, '{}'),
      fs.writeFile(unrelatedFile, 'keep')
    ])
    const oldTime = new Date(0)
    await Promise.all([
      fs.utimes(staleScript, oldTime, oldTime),
      fs.utimes(stalePayload, oldTime, oldTime)
    ])
    await fs.rm(root, { recursive: true, force: true })

    const result = await cleanupTemporaryWordAttachments(1)

    expect(result.ok).toBe(true)
    expect(result.removed).toBe(2)
    await expect(fs.stat(staleScript)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(stalePayload)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(unrelatedFile)).resolves.toBeTruthy()
  })

  it.skipIf(process.platform !== 'win32')('preserves Excel and PowerPoint files instead of converting them to Word', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-attachments-'))
    temporaryRoots.push(root)
    configureTemporaryWordStorage({ temporaryWordDirectory: root, temporaryWordRetentionHours: 24 })

    const excelPath = path.join(root, 'quarterly-report.xlsx')
    const powerPointPath = path.join(root, 'project-brief.pptx')
    const excelBytes = Buffer.from('xlsx-test-bytes')
    const powerPointBytes = Buffer.from('pptx-test-bytes')
    await fs.writeFile(excelPath, excelBytes)
    await fs.writeFile(powerPointPath, powerPointBytes)

    const result = await createTemporaryWordFromFiles('source files', [excelPath, powerPointPath])

    expect(result.ok).toBe(true)
    expect(result.attachment?.filePaths).toHaveLength(2)
    expect(result.attachment?.filePaths?.map((filePath) => path.extname(filePath).toLowerCase())).toEqual([
      '.xlsx',
      '.pptx'
    ])
    expect(result.attachment?.filePaths?.some((filePath) => filePath.toLowerCase().endsWith('.docx'))).toBe(false)
    expect(result.attachment?.filePaths?.map((filePath) => path.basename(filePath))).toEqual([
      'quarterly-report.xlsx',
      'project-brief.pptx'
    ])
    await expect(fs.readFile(result.attachment?.filePaths?.[0] || '')).resolves.toEqual(excelBytes)
    await expect(fs.readFile(result.attachment?.filePaths?.[1] || '')).resolves.toEqual(powerPointBytes)

    const attachmentDirectory = path.dirname(result.attachment?.path || '')
    for (const filePath of result.attachment?.filePaths || []) {
      await removeTemporaryWordAttachment(filePath)
    }
    await expect(fs.stat(attachmentDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform !== 'win32')('copies only the original attachment names without adding a prompt file', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-clipboard-'))
    temporaryRoots.push(root)
    configureTemporaryWordStorage({ temporaryWordDirectory: root, temporaryWordRetentionHours: 24 })

    const sourcePath = path.join(root, '原始报告.docx')
    await fs.writeFile(sourcePath, Buffer.from('word-test-bytes'))
    const attachmentResult = await createTemporaryWordFromFiles('研究资料', [sourcePath])
    const attachmentPaths = attachmentResult.attachment?.filePaths || []

    const copyResult = await copyTemporaryWordFiles(attachmentPaths)
    expect(copyResult.ok).toBe(true)

    const clipboardJson = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-STA',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [PSCustomObject]@{ text = [Windows.Forms.Clipboard]::GetText(); files = @([Windows.Forms.Clipboard]::GetFileDropList()) } | ConvertTo-Json -Compress"
      ],
      { encoding: 'utf8' }
    )
    const clipboard = JSON.parse(clipboardJson.trim()) as { text: string; files: string[] }
    expect(clipboard.text).toBe('')
    expect(clipboard.files.map((filePath) => path.basename(filePath))).toEqual(['原始报告.docx'])
  })
})
