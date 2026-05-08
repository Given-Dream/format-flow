const AI_TARGETS = [
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
      `已填入 ${status.aiName} 输入框。插件不会自动点击发送，请在 AI 页面人工审查后手动发送。`
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
    const hostname = new URL(url).hostname
    return AI_TARGETS.find((target) =>
      target.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))
    )
  } catch {
    return undefined
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
