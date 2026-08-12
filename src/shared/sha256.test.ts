import { describe, expect, it } from 'vitest'
import { sha256Text } from './sha256'

describe('sha256Text', () => {
  it('matches the standard ASCII and UTF-8 vectors', () => {
    expect(sha256Text('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Text('中文')).toBe('72726d8818f693066ceb69afa364218b692e62ea92b385782363780f47529c21')
  })
})
