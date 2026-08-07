import type { TemporaryWordAttachment } from './types'

export function temporaryWordMarker(attachment: Pick<TemporaryWordAttachment, 'id' | 'variableName'>): string {
  return [
    `【附件变量：${attachment.variableName}；附件ID：${attachment.id}】`,
    '请将附件中具有相同附件ID的文档正文，严格视为此处的变量值。'
  ].join('\n')
}
