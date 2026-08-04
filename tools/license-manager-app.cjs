const { app, BrowserWindow, clipboard, ipcMain } = require('electron')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { createPrivateKey, sign } = require('node:crypto')

const managerHome = process.env.FORMAT_FLOW_LICENSE_MANAGER_HOME || path.join(os.homedir(), '.format-flow-license')
const privateKeyPath = path.join(managerHome, 'private-key.pem')
const schema = 'format-flow-license-v1'

function normalizeMachineCode(value) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function licensePayload(machineCode) {
  return `${schema}|${normalizeMachineCode(machineCode)}|permanent`
}

async function hasPrivateKey() {
  try {
    await fs.access(privateKeyPath)
    return true
  } catch {
    return false
  }
}

async function generatePassword(machineCode) {
  const normalized = normalizeMachineCode(machineCode)
  if (normalized.length < 12) {
    return { ok: false, message: '请输入完整的机器码。' }
  }

  let privateKey
  try {
    privateKey = createPrivateKey(await fs.readFile(privateKeyPath, 'utf8'))
  } catch {
    return {
      ok: false,
      message: `找不到管理员私钥：${privateKeyPath}。请恢复原私钥后再生成密码。`
    }
  }

  const password = sign(null, Buffer.from(licensePayload(normalized), 'utf8'), privateKey).toString('base64url')
  return { ok: true, machineCode: normalized, password, message: '密码已生成，可复制给用户。' }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 620,
    height: 680,
    minWidth: 520,
    minHeight: 560,
    title: 'Format Flow License Manager',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'license-manager-preload.cjs')
    }
  })
  void window.loadFile(path.join(__dirname, 'license-manager.html'))
}

ipcMain.handle('license-manager:status', async () => ({
  privateKeyPath,
  ready: await hasPrivateKey()
}))
ipcMain.handle('license-manager:generate', (_event, machineCode) => generatePassword(String(machineCode || '')))
ipcMain.handle('license-manager:copy', (_event, text) => {
  clipboard.writeText(String(text || ''))
  return { ok: true }
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
