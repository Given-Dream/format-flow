#!/usr/bin/env node

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPrivateKey, sign } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

const schema = 'format-flow-license-v1'
const managerHome = process.env.FORMAT_FLOW_LICENSE_MANAGER_HOME || path.join(os.homedir(), '.format-flow-license')
const privateKeyPath = path.join(managerHome, 'private-key.pem')

function payload(machineCode) {
  return `${schema}|${machineCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}|permanent`
}

async function loadOrCreatePrivateKey() {
  try {
    return await fs.readFile(privateKeyPath, 'utf8')
  } catch {
    throw new Error(`Missing owner private key: ${privateKeyPath}. Restore the original key before issuing passwords.`)
  }
}

async function main() {
  const argument = process.argv.slice(2).find((value) => !value.startsWith('-'))
  let input = argument
  if (!input) {
    const readline = createInterface({ input: process.stdin, output: process.stdout })
    try {
      input = await readline.question('Machine code: ')
    } finally {
      readline.close()
    }
  }
  const machineCode = input.trim()
  if (!machineCode) throw new Error('A machine code is required.')

  const privateKey = createPrivateKey(await loadOrCreatePrivateKey())
  const password = sign(null, Buffer.from(payload(machineCode), 'utf8'), privateKey).toString('base64url')
  console.log(`Machine code: ${machineCode}`)
  console.log(`Permanent password: ${password}`)
  console.log('This password is bound to this machine code and can be entered once in Format Flow.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
