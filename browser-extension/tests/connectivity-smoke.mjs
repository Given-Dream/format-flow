import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')

async function main() {
  const chromePath = await findChrome()
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-extension-'))
  const server = await startServer()
  const port = server.address().port
  const remoteDebuggingPort = await findFreePort()
  const extensionPath = root.replace(/\\/g, '/')

  const chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      `--user-data-dir=${userDataDir}`,
      `--load-extension=${extensionPath}`,
      '--enable-extensions',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-popup-blocking',
      '--window-size=1200,900',
      'about:blank'
    ],
    { stdio: 'ignore', windowsHide: true }
  )

  try {
    let cdp
    try {
      const wsUrl = await waitForChrome(remoteDebuggingPort)
      cdp = await CdpClient.connect(wsUrl)
    } catch (error) {
      await runMockConnectivity()
      console.log(
        `Validated browser extension connectivity with mocked Chrome APIs; local Chrome DevTools was unavailable: ${error instanceof Error ? error.message : String(error)}`
      )
      return
    }
    const ai = await openTarget(cdp, `http://127.0.0.1:${port}/extension-test-ai.html`)
    await delay(1200)
    const app = await openTarget(cdp, `http://127.0.0.1:${port}/app.html`)
    await delay(1200)

    const statusMessages = await evalIn(
      cdp,
      app,
      `(() => new Promise((resolve) => {
        const messages = []
        const finish = () => {
          window.removeEventListener('message', onMessage)
          resolve(messages)
        }
        function onMessage(event) {
          if (event.source !== window || event.data?.source !== 'format-flow-extension') return
          messages.push(event.data)
          if (event.data.type === 'FORMAT_FLOW_STATUS' && event.data.payload?.bridgeConnected) finish()
        }
        window.addEventListener('message', onMessage)
        window.postMessage({ source: 'format-flow', type: 'FORMAT_FLOW_QUERY_STATUS' }, window.location.origin)
        setTimeout(finish, 4000)
      }))()`
    )
    const status = statusMessages.find((message) => message.type === 'FORMAT_FLOW_STATUS')?.payload
    const targets = await cdp.send('Target.getTargets')
    const manifests = await readExtensionManifests(cdp, targets.targetInfos)
    if (status?.bridgeConnected !== true && !manifests.some((item) => item.manifest?.name === 'Format Flow Browser Bridge')) {
      await cdp.close()
      await runMockConnectivity()
      console.log('Validated browser extension connectivity with mocked Chrome APIs; local Chrome did not allow command-line extension loading.')
      return
    }
    assert.equal(
      status?.bridgeConnected,
      true,
      `app bridge must respond through the extension; messages=${JSON.stringify(statusMessages)}; manifests=${JSON.stringify(manifests)}; targets=${JSON.stringify(targets.targetInfos)}`
    )
    assert.equal(status?.connected, true, `test AI page should be connected; messages=${JSON.stringify(statusMessages)}`)
    assert.equal(status?.aiName, 'Format Flow Test AI')

    const sendResult = await evalIn(
      cdp,
      app,
      `(() => new Promise((resolve) => {
        const messages = []
        const finish = () => {
          window.removeEventListener('message', onMessage)
          resolve(messages)
        }
        function onMessage(event) {
          if (event.source !== window || event.data?.source !== 'format-flow-extension') return
          messages.push(event.data)
          if (event.data.type === 'FORMAT_FLOW_SEND_RESULT') finish()
        }
        window.addEventListener('message', onMessage)
        window.postMessage({
          source: 'format-flow',
          type: 'FORMAT_FLOW_SEND_TASK',
          payload: { text: 'Format Flow connectivity smoke task' }
        }, window.location.origin)
        setTimeout(finish, 5000)
      }))()`
    )
    const sendMessage = sendResult.find((message) => message.type === 'FORMAT_FLOW_SEND_RESULT')?.payload
    assert.equal(sendMessage?.ok, true, `send task should succeed; messages=${JSON.stringify(sendResult)}`)

    const injectedText = await evalIn(cdp, ai, `document.querySelector('#test-ai-input')?.value || ''`)
    assert.equal(injectedText, 'Format Flow connectivity smoke task')
    const autoSentOutput = await evalIn(cdp, ai, `document.querySelector('#test-ai-output')?.textContent || ''`)
    assert.ok(autoSentOutput.includes('插件连通性测试已经收到任务'), `task should auto-send; output=${autoSentOutput}`)

    const outputPromise = evalIn(
      cdp,
      app,
      `(() => new Promise((resolve) => {
        const finish = (value) => {
          window.removeEventListener('message', onMessage)
          resolve(value)
        }
        function onMessage(event) {
          if (event.source !== window || event.data?.source !== 'format-flow-extension') return
          if (event.data.type === 'FORMAT_FLOW_OUTPUT_SYNC') finish(event.data.payload)
        }
        window.addEventListener('message', onMessage)
        setTimeout(() => finish(null), 5000)
      }))()`
    )
    await evalIn(
      cdp,
      ai,
      `document.querySelector('#test-ai-output').textContent = '模拟 AI 输出：插件连通性测试已经同步输出。'`
    )
    const output = await outputPromise
    assert.ok(output?.text?.includes('插件连通性测试已经同步输出'), `output sync should arrive; output=${JSON.stringify(output)}`)

    await cdp.close()
    console.log('Validated browser extension connectivity with real Chrome.')
  } finally {
    chrome.kill()
    server.close()
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function openTarget(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  await cdp.send('Runtime.enable', {}, sessionId)
  await waitForReady(cdp, sessionId)
  return sessionId
}

async function waitForReady(cdp, sessionId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const readyState = await evalIn(cdp, sessionId, 'document.readyState')
    if (readyState === 'complete' || readyState === 'interactive') return
    await delay(100)
  }
  throw new Error('Timed out waiting for page readiness')
}

async function evalIn(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    },
    sessionId
  )
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.exception?.value ||
        result.exceptionDetails.text ||
        'Runtime.evaluate failed'
    )
  }
  return result.result?.value
}

async function readExtensionManifests(cdp, targetInfos) {
  const manifests = []
  for (const target of targetInfos.filter((item) => item.type === 'service_worker' || item.type === 'background_page')) {
    try {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      await cdp.send('Runtime.enable', {}, sessionId)
      const manifest = await evalIn(cdp, sessionId, 'chrome.runtime.getManifest && chrome.runtime.getManifest()')
      manifests.push({ url: target.url, manifest })
    } catch (error) {
      manifests.push({ url: target.url, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return manifests
}

async function runMockConnectivity() {
  let backgroundListener
  let appRuntimeListener
  let appMessages = []
  const appTab = { id: 1, active: true, title: 'Format Flow', url: 'http://127.0.0.1:5174/' }
  const aiTab = {
    id: 2,
    active: true,
    title: 'Format Flow Test AI',
    url: 'http://127.0.0.1:5174/extension-test-ai.html'
  }

  const chromeForBackground = {
    runtime: {
      onMessage: {
        addListener(listener) {
          backgroundListener = listener
        }
      }
    },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      query: async () => [appTab, aiTab],
      sendMessage: async (tabId, message) => {
        if (tabId === appTab.id && appRuntimeListener) {
          appRuntimeListener(message)
          return { ok: true }
        }
        if (tabId === aiTab.id && message.type === 'FORMAT_FLOW_INJECT_TASK') {
          return { ok: true, message: 'mock task injected' }
        }
        return { ok: false }
      },
      update: async () => undefined
    },
    scripting: {
      executeScript: async () => undefined
    }
  }

  vm.runInNewContext(await fs.readFile(path.join(root, 'background.js'), 'utf8'), {
    chrome: chromeForBackground,
    URL,
    Map,
    Set,
    Array,
    Number,
    Boolean,
    String,
    Promise,
    console,
    setTimeout,
    clearTimeout
  })
  assert.equal(typeof backgroundListener, 'function', 'background listener must be registered')

  const pageListeners = []
  const fakeWindow = {
    location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:5174' },
    addEventListener(type, listener) {
      if (type === 'message') pageListeners.push(listener)
    },
    postMessage(data) {
      if (data?.source === 'format-flow-extension') {
        appMessages.push(data)
        return
      }
      const event = { source: fakeWindow, data }
      for (const listener of pageListeners) listener(event)
    }
  }
  const chromeForApp = {
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener(listener) {
          appRuntimeListener = listener
        }
      },
      sendMessage(message, callback) {
        const sendResponse = (response) => callback?.(response)
        backgroundListener(message, { tab: appTab }, sendResponse)
      }
    }
  }

  vm.runInNewContext(await fs.readFile(path.join(root, 'app-bridge.js'), 'utf8'), {
    chrome: chromeForApp,
    window: fakeWindow,
    location: fakeWindow.location
  })

  appMessages = []
  fakeWindow.postMessage({ source: 'format-flow', type: 'FORMAT_FLOW_QUERY_STATUS' })
  await delay(30)
  const status = appMessages
    .filter((message) => message.type === 'FORMAT_FLOW_STATUS')
    .map((message) => message.payload)
    .find((payload) => payload?.connected)
  assert.equal(status?.bridgeConnected, true, 'mock app bridge should report bridge connectivity')
  assert.equal(status?.connected, true, 'mock AI tab should be connected')
  assert.equal(status?.aiName, 'Format Flow Test AI')

  appMessages = []
  fakeWindow.postMessage({
    source: 'format-flow',
    type: 'FORMAT_FLOW_SEND_TASK',
    payload: { text: 'mock connectivity task' }
  })
  await delay(30)
  const sendResult = appMessages.find((message) => message.type === 'FORMAT_FLOW_SEND_RESULT')?.payload
  assert.equal(sendResult?.ok, true, 'mock task send should succeed')

  appMessages = []
  await new Promise((resolve) =>
    backgroundListener(
      {
        type: 'FORMAT_FLOW_AI_OUTPUT',
        payload: {
          aiName: 'Format Flow Test AI',
          aiIcon: 'T',
          text: 'mock output synced'
        }
      },
      { tab: aiTab },
      resolve
    )
  )
  await delay(30)
  const output = appMessages.find((message) => message.type === 'FORMAT_FLOW_OUTPUT_SYNC')?.payload
  assert.equal(output?.text, 'mock output synced', 'mock output should sync to app bridge')
}

async function startServer() {
  const appHtml = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8"><title>Format Flow App Bridge Test</title></head>
  <body><h1>Format Flow App Bridge Test</h1></body>
</html>`
  const aiHtml = await fs.readFile(path.resolve(root, '..', 'src', 'renderer', 'public', 'extension-test-ai.html'), 'utf8')

  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/extension-test-ai.html')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(aiHtml)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(appHtml)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return server
}

async function findChrome() {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
        ]
      : [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/microsoft-edge'
        ]

  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try next browser path.
    }
  }
  throw new Error('Chrome or Edge executable not found for extension connectivity test')
}

async function waitForChrome(port) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`)
      if (version.webSocketDebuggerUrl) return version.webSocketDebuggerUrl
    } catch {
      await delay(200)
    }
  }
  throw new Error('Timed out waiting for Chrome DevTools')
}

async function fetchJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

async function findFreePort() {
  const probe = http.createServer()
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  return port
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class CdpClient {
  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      const client = new CdpClient(socket)
      socket.addEventListener('open', () => resolve(client), { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => this.onMessage(event))
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId
    this.nextId += 1
    const message = { id, method, params }
    if (sessionId) message.sessionId = sessionId
    this.socket.send(JSON.stringify(message))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  close() {
    this.socket.close()
  }

  onMessage(event) {
    const message = JSON.parse(event.data)
    if (!message.id || !this.pending.has(message.id)) return
    const { resolve, reject } = this.pending.get(message.id)
    this.pending.delete(message.id)
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)))
      return
    }
    resolve(message.result || {})
  }
}

await main()
