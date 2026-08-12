import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { decodeZipEntryName } from './zip-filename'

describe('ZIP filename decoder', () => {
  it('keeps valid UTF-8 filenames', () => {
    expect(decodeZipEntryName(Buffer.from('综述/SKILL.md', 'utf8'))).toBe('综述/SKILL.md')
  })

  it('falls back to GB18030 for legacy Chinese ZIP filenames', () => {
    expect(decodeZipEntryName(Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))).toBe('中文')
  })
})
