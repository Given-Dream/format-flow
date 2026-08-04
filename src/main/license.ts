import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID, sign, verify } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

// Only the public key is shipped with the application. The matching private key stays with the owner license manager.
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAdFtec1pPYJDMamV40UnwNod+parq6IyPHFeBFtL3mzo=
-----END PUBLIC KEY-----
`

const LICENSE_SCHEMA = 'format-flow-license-v1'
const MACHINE_CODE_PREFIX = 'FF'

export type LicenseStatus = {
  activated: boolean
  machineCode: string
  activatedAt?: string
  message: string
}

type StoredLicense = {
  schema: string
  machineCode: string
  password: string
  activatedAt: string
}

export function normalizeMachineCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function licensePayload(machineCode: string): string {
  return `${LICENSE_SCHEMA}|${normalizeMachineCode(machineCode)}|permanent`
}

export function formatMachineCode(source: string): string {
  const digest = createHash('sha256').update(`${LICENSE_SCHEMA}|machine|${source}`).digest('hex').toUpperCase()
  return `${MACHINE_CODE_PREFIX}-${digest.slice(0, 8)}-${digest.slice(8, 16)}-${digest.slice(16, 24)}-${digest.slice(24, 32)}`
}

export function createLicensePassword(machineCode: string, privateKey: string): string {
  const signature = sign(null, Buffer.from(licensePayload(machineCode), 'utf8'), privateKey)
  return signature.toString('base64url')
}

export function verifyLicensePassword(machineCode: string, password: string, publicKey = LICENSE_PUBLIC_KEY): boolean {
  const normalizedPassword = password.replace(/\s/g, '')
  if (!normalizedPassword) return false
  try {
    return verify(
      null,
      Buffer.from(licensePayload(machineCode), 'utf8'),
      publicKey,
      Buffer.from(normalizedPassword, 'base64url')
    )
  } catch {
    return false
  }
}

async function readWindowsMachineGuid(): Promise<string> {
  if (process.platform !== 'win32') return ''
  try {
    const result = await execFile('reg.exe', [
      'query',
      'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
      '/v',
      'MachineGuid'
    ], { windowsHide: true })
    const match = result.stdout.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i)
    return match?.[1]?.trim() || ''
  } catch {
    return ''
  }
}

async function readOrCreateFallbackIdentity(userDataDirectory: string): Promise<string> {
  const identityPath = path.join(userDataDirectory, 'machine-identity.txt')
  try {
    const value = (await fs.readFile(identityPath, 'utf8')).trim()
    if (value) return value
  } catch {
    // Create the fallback identity below.
  }

  const identity = randomUUID()
  await fs.mkdir(userDataDirectory, { recursive: true })
  await fs.writeFile(identityPath, `${identity}\n`, 'utf8')
  return identity
}

export async function getMachineCode(userDataDirectory: string): Promise<string> {
  const machineGuid = await readWindowsMachineGuid()
  const identity = machineGuid || await readOrCreateFallbackIdentity(userDataDirectory)
  return formatMachineCode(identity)
}

function licenseFilePath(userDataDirectory: string): string {
  return path.join(userDataDirectory, 'license.json')
}

export async function getLicenseStatus(userDataDirectory: string): Promise<LicenseStatus> {
  const machineCode = await getMachineCode(userDataDirectory)
  try {
    const raw = await fs.readFile(licenseFilePath(userDataDirectory), 'utf8')
    const stored = JSON.parse(raw) as Partial<StoredLicense>
    if (
      stored.schema === LICENSE_SCHEMA &&
      typeof stored.machineCode === 'string' &&
      normalizeMachineCode(stored.machineCode) === normalizeMachineCode(machineCode) &&
      typeof stored.password === 'string' &&
      verifyLicensePassword(machineCode, stored.password)
    ) {
      return {
        activated: true,
        machineCode,
        activatedAt: typeof stored.activatedAt === 'string' ? stored.activatedAt : undefined,
        message: '已激活，可永久使用'
      }
    }
  } catch {
    // The application remains locked until a valid license is entered.
  }

  return { activated: false, machineCode, message: '请输入与此机器码匹配的永久授权密码' }
}

export async function activateLicense(userDataDirectory: string, password: string): Promise<LicenseStatus> {
  const machineCode = await getMachineCode(userDataDirectory)
  if (!verifyLicensePassword(machineCode, password)) {
    return { activated: false, machineCode, message: '授权密码无效，或不匹配当前机器码' }
  }

  const activatedAt = new Date().toISOString()
  const stored: StoredLicense = {
    schema: LICENSE_SCHEMA,
    machineCode,
    password: password.replace(/\s/g, ''),
    activatedAt
  }
  await fs.mkdir(userDataDirectory, { recursive: true })
  await fs.writeFile(licenseFilePath(userDataDirectory), `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  return { activated: true, machineCode, activatedAt, message: '授权成功，之后无需再次输入' }
}

export function fallbackIdentityDescription(): string {
  return `${os.platform()}-${os.arch()}`
}
