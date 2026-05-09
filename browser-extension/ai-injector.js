(function () {
  if (globalThis.__FORMAT_FLOW_AI_INJECTOR_READY__) return
  globalThis.__FORMAT_FLOW_AI_INJECTOR_READY__ = true

  let lastOutput = ''
  let outputTimer = 0

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'FORMAT_FLOW_INJECT_TASK') return false

    try {
      const result = injectTask(message.payload?.text || '')
      sendStatus()
      sendResponse(result)
    } catch (error) {
      sendResponse({ ok: false, message: error.message || String(error) })
    }

    return false
  })

  if (detectTarget()) {
    sendStatus()
    window.setInterval(sendStatus, 3000)
    startOutputObserver()
  }

  function injectTask(text) {
    if (!text.trim()) return { ok: false, message: '任务内容为空' }
    const target = detectTarget()
    if (!target) return { ok: false, message: '当前页面不是 Format Flow 支持的 AI 页面。' }
    const input = findInput(target)
    if (!input) {
      return {
        ok: false,
        message: `未找到 ${target?.name || '当前 AI 页面'} 的输入框。请点击输入框后重试，或使用剪贴板连接。`
      }
    }

    setInputValue(input, text)
    return {
      ok: true,
      message: `已填入 ${target?.name || 'AI 页面'} 输入框。插件不会自动点击发送，请人工审查后手动发送。`
    }
  }

  function detectTarget() {
    const hostname = location.hostname
    const pathname = location.pathname
    return (globalThis.FORMAT_FLOW_AI_TARGETS || []).find((target) =>
      target.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)) &&
      (!target.pathPrefixes || target.pathPrefixes.some((prefix) => pathname.startsWith(prefix)))
    )
  }

  function findInput(target) {
    const selectors = target?.selectors || ['textarea', '[contenteditable="true"]']
    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter(isUsable)
      const candidate = candidates.at(-1)
      if (candidate) return candidate
    }
    return null
  }

  function isUsable(element) {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 20 && rect.height > 12 && style.visibility !== 'hidden' && style.display !== 'none'
  }

  function setInputValue(element, text) {
    element.focus()
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      element.value = text
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      return
    }

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.execCommand('insertText', false, text)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }

  function startOutputObserver() {
    const observer = new MutationObserver(scheduleOutputSync)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    })
    window.addEventListener('focus', scheduleOutputSync)
    window.setTimeout(scheduleOutputSync, 1500)
  }

  function scheduleOutputSync() {
    window.clearTimeout(outputTimer)
    outputTimer = window.setTimeout(syncLatestOutput, 900)
  }

  function syncLatestOutput() {
    const text = extractLatestOutput()
    if (!text || text === lastOutput) return
    lastOutput = text
    const target = detectTarget()
    chrome.runtime.sendMessage({
      type: 'FORMAT_FLOW_AI_OUTPUT',
      payload: {
        ...statusPayload(target),
        text
      }
    })
  }

  function extractLatestOutput() {
    const target = detectTarget()
    const selectors = target?.outputSelectors || [
      '[data-message-author-role="assistant"]',
      '[data-testid*="assistant"]',
      '.markdown',
      '.prose',
      'article'
    ]

    for (const selector of selectors) {
      const candidates = Array.from(document.querySelectorAll(selector))
        .filter(isVisibleTextBlock)
        .map((element) => normalizeText(element.innerText || element.textContent || ''))
        .filter((text) => text.length > 20)
      const latest = candidates.at(-1)
      if (latest) return latest
    }

    return ''
  }

  function isVisibleTextBlock(element) {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    return rect.width > 30 && rect.height > 12 && style.visibility !== 'hidden' && style.display !== 'none'
  }

  function normalizeText(text) {
    return text.replace(/\n{3,}/g, '\n\n').trim()
  }

  function sendStatus() {
    const target = detectTarget()
    chrome.runtime.sendMessage({
      type: 'FORMAT_FLOW_AI_STATUS',
      payload: statusPayload(target)
    })
  }

  function statusPayload(target) {
    return {
      connected: true,
      aiName: target?.name || 'AI',
      aiIcon: target?.icon || 'AI',
      tabTitle: document.title,
      url: location.href
    }
  }
})()
