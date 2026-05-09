const AI_TARGETS = [
  { name: 'Format Flow Test AI', icon: 'T', domains: ['127.0.0.1', 'localhost'], pathPrefixes: ['/extension-test-ai'] },
  { name: 'ChatGPT', icon: '◎', domains: ['chatgpt.com', 'chat.openai.com'] },
  { name: 'Claude', icon: '✦', domains: ['claude.ai'] },
  { name: 'Gemini', icon: '✧', domains: ['gemini.google.com'] },
  { name: 'DeepSeek', icon: '深', domains: ['chat.deepseek.com'] },
  { name: 'Kimi', icon: 'K', domains: ['kimi.moonshot.cn'] },
  { name: 'Qwen', icon: 'Q', domains: ['chat.qwen.ai'] },
  { name: 'Perplexity', icon: 'P', domains: ['www.perplexity.ai'] },
  { name: 'Poe', icon: 'Poe', domains: ['poe.com'] },
  { name: 'Grok', icon: 'G', domains: ['grok.com'] }
]

const appTabs = new Map()
const aiStatuses = new Map()
const LOCAL_BRIDGE_BASE = 'http://127.0.0.1:48174/format-flow-bridge'
let localBridgePolling = false

startLocalBridgePolling()

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false

  if (message.type === 'FORMAT_FLOW_REGISTER_APP' || message.type === 'FORMAT_FLOW_QUERY_STATUS') {
    registerAppTab(sender.tab?.id)
    resolveConnectedStatus()
      .then((status) => sendResponse({ ok: true, status }))
      .catch((error) => sendResponse({ ok: false, status: disconnectedStatus(error.message || String(error)) }))
    return true
  }

  if (message.type === 'FORMAT_FLOW_SEND_TASK') {
    registerAppTab(sender.tab?.id)
    deliverTask(message.payload)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, message: error.message || String(error), status: disconnectedStatus() }))
    return true
  }

  if (message.type === 'FORMAT_FLOW_AI_STATUS') {
    updateAiStatus(sender.tab, message.payload)
    void notifyAppTabsStatus()
    sendResponse({ ok: true })
    return false
  }

  if (message.type === 'FORMAT_FLOW_AI_OUTPUT') {
    const status = updateAiStatus(sender.tab, message.payload)
    void postLocalBridgeOutput({
      ...status,
      text: message.payload?.text || '',
      updatedAt: Date.now()
    })
    void forwardToAppTabs('FORMAT_FLOW_OUTPUT_SYNC', {
      ...status,
      text: message.payload?.text || '',
      updatedAt: Date.now()
    })
    sendResponse({ ok: true })
    return false
  }

  return false
})

chrome.tabs.onRemoved.addListener((tabId) => {
  appTabs.delete(tabId)
  aiStatuses.delete(tabId)
  void notifyAppTabsStatus()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && !isAiUrl(tab.url || '')) {
    aiStatuses.delete(tabId)
    void notifyAppTabsStatus()
  }
})

async function deliverTask(payload) {
  const aiTabs = await findOpenAiTabs()
  const activeAiTab = chooseAiTab(aiTabs)

  if (!activeAiTab?.id) {
    const status = disconnectedStatus(
      '没有找到已打开的受支持 AI 网页。请先打开 ChatGPT、Claude、Gemini、DeepSeek、Kimi、Qwen、Perplexity、Poe 或 Grok。'
    )
    await notifyAppTabsStatus(status)
    return { ok: false, message: status.message, status }
  }

  const response = await sendToAiTab(activeAiTab.id, {
    type: 'FORMAT_FLOW_INJECT_TASK',
    payload
  })
  await chrome.tabs.update(activeAiTab.id, { active: true })
  const status = tabToStatus(activeAiTab)
  await notifyAppTabsStatus(status)
  return {
    ...response,
    status,
    message:
      response?.message ||
      `已自动发送到 ${status.aiName}。`
  }
}

async function sendToAiTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['targets.js', 'ai-injector.js']
    })
    await sleep(120)
    return chrome.tabs.sendMessage(tabId, message)
  }
}

async function findOpenAiTabs() {
  const tabs = await chrome.tabs.query({})
  return tabs.filter((tab) => isAiUrl(tab.url || ''))
}

function chooseAiTab(aiTabs) {
  return aiTabs.find((tab) => tab.active) || aiTabs[0]
}

async function resolveConnectedStatus() {
  const aiTabs = await findOpenAiTabs()
  const activeAiTab = chooseAiTab(aiTabs)
  const status = activeAiTab ? tabToStatus(activeAiTab) : disconnectedStatus()
  await notifyAppTabsStatus(status)
  return status
}

async function notifyAppTabsStatus(status) {
  const nextStatus = status || (await resolveStatusWithoutNotify())
  await postLocalBridgeStatus(nextStatus)
  await forwardToAppTabs('FORMAT_FLOW_STATUS', nextStatus)
}

async function resolveStatusWithoutNotify() {
  const aiTabs = await findOpenAiTabs()
  const activeAiTab = chooseAiTab(aiTabs)
  return activeAiTab ? tabToStatus(activeAiTab) : disconnectedStatus()
}

async function forwardToAppTabs(type, payload) {
  for (const tabId of Array.from(appTabs.keys())) {
    try {
      await chrome.tabs.sendMessage(Number(tabId), { type, payload })
    } catch {
      appTabs.delete(tabId)
    }
  }
}

function registerAppTab(tabId) {
  if (typeof tabId === 'number') appTabs.set(tabId, Date.now())
}

function updateAiStatus(tab, payload = {}) {
  if (!tab?.id) return disconnectedStatus()
  const fromUrl = targetFromUrl(tab.url || '')
  const status = {
    connected: true,
    aiName: payload.aiName || fromUrl?.name || 'AI',
    aiIcon: payload.aiIcon || fromUrl?.icon || 'AI',
    tabTitle: payload.tabTitle || tab.title || '',
    url: tab.url || '',
    message: `已连接 ${payload.aiName || fromUrl?.name || 'AI'}`
  }
  aiStatuses.set(tab.id, status)
  return status
}

function tabToStatus(tab) {
  const cached = tab.id ? aiStatuses.get(tab.id) : undefined
  const target = targetFromUrl(tab.url || '')
  return {
    connected: true,
    aiName: cached?.aiName || target?.name || 'AI',
    aiIcon: cached?.aiIcon || target?.icon || 'AI',
    tabTitle: cached?.tabTitle || tab.title || '',
    url: cached?.url || tab.url || '',
    message: `已连接 ${cached?.aiName || target?.name || 'AI'}`
  }
}

function disconnectedStatus(message = '未连接已打开的 AI 页面') {
  return {
    bridgeConnected: true,
    connected: false,
    aiName: '',
    aiIcon: '',
    tabTitle: '',
    url: '',
    message
  }
}

function isAiUrl(url) {
  return Boolean(targetFromUrl(url))
}

function targetFromUrl(url) {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname
    return AI_TARGETS.find((target) =>
      target.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) &&
      (!target.pathPrefixes || target.pathPrefixes.some((prefix) => parsed.pathname.startsWith(prefix)))
    )
  } catch {
    return undefined
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function startLocalBridgePolling() {
  if (localBridgePolling || typeof globalThis.setInterval !== 'function') return
  localBridgePolling = true
  globalThis.setInterval(() => {
    void pollLocalBridgeTask()
  }, 1500)
  void pollLocalBridgeTask()
}

async function pollLocalBridgeTask() {
  if (typeof fetch !== 'function') return
  try {
    await postLocalBridgeStatus(await resolveStatusWithoutNotify())
    const response = await fetch(`${LOCAL_BRIDGE_BASE}/tasks/next`, { cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json()
    const task = data?.task
    if (!task?.id || !task.payload) return
    const result = await deliverTask(task.payload)
    await postLocalBridgeTaskResult(task.id, result)
  } catch {
    // The desktop app may be closed; keep polling silently.
  }
}

async function postLocalBridgeStatus(status) {
  await postLocalBridge('/extension/status', status)
}

async function postLocalBridgeOutput(output) {
  await postLocalBridge('/extension/output', output)
}

async function postLocalBridgeTaskResult(taskId, result) {
  await postLocalBridge('/tasks/result', { taskId, result })
}

async function postLocalBridge(path, payload) {
  if (typeof fetch !== 'function') return
  try {
    await fetch(`${LOCAL_BRIDGE_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload || {})
    })
  } catch {
    // No desktop app is listening.
  }
}
