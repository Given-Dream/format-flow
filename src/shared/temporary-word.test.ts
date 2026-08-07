import { describe, expect, it } from 'vitest'
import { temporaryWordMarker } from './temporary-word'

describe('temporaryWordMarker', () => {
  it('binds an attachment to one named variable with a stable id', () => {
    expect(temporaryWordMarker({ id: 'FFV-8A31', variableName: '研究材料' })).toBe(
      '【附件变量：研究材料；附件ID：FFV-8A31】\n请将附件中具有相同附件ID的文档正文，严格视为此处的变量值。'
    )
  })
})
