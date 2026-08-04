import { generateKeyPairSync } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  activateLicense,
  createLicensePassword,
  formatMachineCode,
  getLicenseStatus,
  verifyLicensePassword
} from './license'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('offline machine-bound license', () => {
  it('creates a stable formatted machine code', () => {
    expect(formatMachineCode('machine-guid')).toMatch(/^FF-[A-F0-9]{8}(-[A-F0-9]{8}){3}$/)
    expect(formatMachineCode('machine-guid')).toBe(formatMachineCode('machine-guid'))
  })

  it('accepts a signed permanent password only for the matching machine', () => {
    const pair = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' }
    })
    const machineCode = formatMachineCode('machine-guid')
    const password = createLicensePassword(machineCode, pair.privateKey)
    expect(verifyLicensePassword(machineCode, password, pair.publicKey)).toBe(true)
    expect(verifyLicensePassword(formatMachineCode('other-machine'), password, pair.publicKey)).toBe(false)
    expect(verifyLicensePassword(machineCode, `${password}x`, pair.publicKey)).toBe(false)
  })

  it('persists a valid activation and rejects an invalid one', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-license-'))
    temporaryDirectories.push(root)
    const first = await getLicenseStatus(root)
    expect(first.activated).toBe(false)
    const invalid = await activateLicense(root, 'invalid-password')
    expect(invalid.activated).toBe(false)
    const next = await getLicenseStatus(root)
    expect(next.activated).toBe(false)
  })
})
