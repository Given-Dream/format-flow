export const zipFilenameDecoder = {
  efs: true,
  encode: (value: string): Buffer => Buffer.from(value, 'utf8'),
  decode: decodeZipEntryName
}

export function decodeZipEntryName(value: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(value)
  }
}
