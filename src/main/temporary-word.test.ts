import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configureTemporaryWordStorage,
  createTemporaryWordFromFiles,
  removeTemporaryWordAttachment
} from './temporary-word'

const temporaryRoots: string[] = []

afterEach(async () => {
  configureTemporaryWordStorage({ temporaryWordDirectory: '', temporaryWordRetentionHours: 24 })
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('temporary file attachments', () => {
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
    await expect(fs.readFile(result.attachment?.filePaths?.[0] || '')).resolves.toEqual(excelBytes)
    await expect(fs.readFile(result.attachment?.filePaths?.[1] || '')).resolves.toEqual(powerPointBytes)

    for (const filePath of result.attachment?.filePaths || []) {
      await removeTemporaryWordAttachment(filePath)
    }
  })
})
