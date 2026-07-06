(function () {
  if (globalThis.__FORMAT_FLOW_AI_INJECTOR_READY__) return
  globalThis.__FORMAT_FLOW_AI_INJECTOR_READY__ = true

  let lastOutput = ''
  let outputTimer = 0

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'FORMAT_FLOW_INJECT_TASK') return false

    injectTask(message.payload || '')
      .then((result) => {
        sendStatus()
        sendResponse(result)
      })
      .catch((error) => {
        sendResponse({ ok: false, message: error.message || String(error) })
      })

    return true
  })

  if (detectTarget()) {
    sendStatus()
    window.setInterval(sendStatus, 3000)
    startOutputObserver()
  }

  async function injectTask(payload) {
    const text = typeof payload === 'string' ? payload : payload?.text || ''
    const shouldSubmit = typeof payload === 'object' ? payload.submit !== false : true
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

    const fillResult = await setInputValue(input, text)
    if (!fillResult.ok) {
      return {
        ok: false,
        message: fillResult.message || `未能填入 ${target?.name || 'AI 页面'} 输入框。`
      }
    }

    if (!shouldSubmit) {
      return {
        ok: true,
        message: `已填入 ${target?.name || 'AI 页面'} 输入框。`
      }
    }

    const submitResult = await submitInput(target, input)
    if (!submitResult.ok) {
      return {
        ok: false,
        message: `已填入 ${target?.name || 'AI 页面'} 输入框，但自动发送失败：${submitResult.message}`
      }
    }

    return {
      ok: true,
      message: `已自动发送到 ${target?.name || 'AI 页面'}。`
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

  async function setInputValue(element, text) {
    element.focus()
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      setNativeInputValue(element, text)
      element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }))
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
      await sleep(50)

      if (element.value !== text) {
        return { ok: false, message: '输入框拒绝了写入内容，页面可能拦截了自动填入。' }
      }
      return { ok: true }
    }

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.execCommand('insertText', false, text)
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }))
    await sleep(50)
    const currentText = element.innerText || element.textContent || ''
    if (!currentText.includes(text)) {
      element.textContent = text
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }))
    }
    return { ok: true }
  }

  function setNativeInputValue(element, text) {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (valueSetter) {
      valueSetter.call(element, text)
    } else {
      element.value = text
    }
  }

  async function submitInput(target, input) {
    const button = await waitForSendButton(target, input)
    if (button) {
      clickElement(button)
      return { ok: true, method: 'button' }
    }

    if (pressEnter(input)) return { ok: true, method: 'enter' }
    return { ok: false, message: '未找到可用发送按钮，也无法触发 Enter 发送。' }
  }

  async function waitForSendButton(target, input) {
    for (let index = 0; index < 12; index += 1) {
      const button = findSendButton(target, input)
      if (button) return button
      await sleep(150)
    }
    return null
  }

  function findSendButton(target, input) {
    const selectors = target?.sendSelectors || defaultSendSelectors()
    const candidates = []
    for (const root of candidateRoots(input)) {
      for (const selector of selectors) {
        for (const element of safeQueryAll(root, selector)) {
          const button = normalizeButton(element)
          if (button && isUsableSendButton(button)) candidates.push(button)
        }
      }
    }

    if (candidates.length > 0) return rankSendButtons(uniqueElements(candidates), input)[0]

    const genericButtons = Array.from(document.querySelectorAll('button,[role="button"]'))
      .map(normalizeButton)
      .filter(Boolean)
      .filter((button) => isUsableSendButton(button) && looksLikeSendButton(button))
    if (genericButtons.length > 0) return rankSendButtons(uniqueElements(genericButtons), input)[0]

    const nearbyIconButtons = Array.from(document.querySelectorAll('button,[role="button"]'))
      .map(normalizeButton)
      .filter(Boolean)
      .filter((button) => isUsableSendButton(button) && isNearInput(button, input))
    return rankSendButtons(uniqueElements(nearbyIconButtons), input)[0] || null
  }

  function defaultSendSelectors() {
    return [
      'button[type="submit"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="发送"]',
      '[role="button"][aria-label*="Send"]',
      '[role="button"][aria-label*="发送"]',
      '[data-testid*="send"]'
    ]
  }

  function candidateRoots(input) {
    const roots = []
    const selectors = ['form', '[data-testid*="composer"]', '[class*="composer"]', '[class*="input"]', '[class*="chat"]', 'main']
    for (const selector of selectors) {
      const root = input.closest?.(selector)
      if (root) roots.push(root)
    }
    roots.push(document)
    return uniqueElements(roots)
  }

  function safeQueryAll(root, selector) {
    try {
      return Array.from(root.querySelectorAll(selector))
    } catch {
      return []
    }
  }

  function normalizeButton(element) {
    if (!(element instanceof HTMLElement)) return null
    return element.closest('button,[role="button"]') || element
  }

  function isUsableSendButton(element) {
    const rect = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const disabled =
      element.disabled ||
      element.getAttribute('aria-disabled') === 'true' ||
      element.getAttribute('disabled') !== null ||
      element.closest('[aria-disabled="true"],[disabled]')
    if (disabled || rect.width < 8 || rect.height < 8 || style.visibility === 'hidden' || style.display === 'none') return false

    const label = buttonLabel(element).toLowerCase()
    if (/(stop|停止|cancel|取消|abort|中止|pause|暂停|voice|语音|attach|附件|upload|上传|new chat|新建)/i.test(label)) return false
    return true
  }

  function looksLikeSendButton(element) {
    const label = buttonLabel(element)
    return /(send|submit|发送|提交|发送消息|send message)/i.test(label)
  }

  function buttonLabel(element) {
    return [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('data-testid'),
      element.textContent,
      element.className && typeof element.className === 'string' ? element.className : ''
    ]
      .filter(Boolean)
      .join(' ')
  }

  function rankSendButtons(buttons, input) {
    const inputRect = input.getBoundingClientRect()
    const inputCenterY = inputRect.top + inputRect.height / 2
    const inputRight = inputRect.right
    return buttons
      .filter((button) => isNearInput(button, input))
      .sort((left, right) => scoreSendButton(left, inputCenterY, inputRight, inputRect) - scoreSendButton(right, inputCenterY, inputRight, inputRect))
  }

  function scoreSendButton(button, inputCenterY, inputRight, inputRect) {
    const rect = button.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    let score = Math.abs(centerY - inputCenterY) + Math.abs(centerX - inputRight)
    if (rect.left < inputRect.left) score += 300
    if (rect.top < inputRect.top - 80 || rect.top > inputRect.bottom + 120) score += 500
    if (looksLikeSendButton(button)) score -= 200
    return score
  }

  function isNearInput(button, input) {
    const buttonRect = button.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()
    return buttonRect.bottom >= inputRect.top - 80 && buttonRect.top <= inputRect.bottom + 140 && buttonRect.right >= inputRect.left
  }

  function clickElement(element) {
    element.focus?.()
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    }
    element.click?.()
  }

  function pressEnter(input) {
    input.focus?.()
    for (const type of ['keydown', 'keypress', 'keyup']) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true
        })
      )
    }
    return true
  }

  function uniqueElements(elements) {
    return Array.from(new Set(elements))
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms))
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
      url: location.href,
      capabilities: {
        quickCallFillOnly: true
      }
    }
  }
})()
