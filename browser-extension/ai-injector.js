(function () {
  if (globalThis.__FORMAT_FLOW_AI_INJECTOR_READY__) return
  globalThis.__FORMAT_FLOW_AI_INJECTOR_READY__ = true

  const LOCAL_BRIDGE_BASE = 'http://127.0.0.1:48174/format-flow-bridge'
  const customSiteApi = globalThis.FORMAT_FLOW_CUSTOM_SITES
  let lastOutput = ''
  let outputTimer = 0
  let localBridgePolling = false
  let customTargets = []
  let targetMonitoring = false
  let initialization = initializeCustomTargets()

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'FORMAT_FLOW_INJECT_TASK') return false

    initialization
      .then(() => injectTask(message.payload || ''))
      .then((result) => {
        sendStatus()
        sendResponse(result)
      })
      .catch((error) => {
        sendResponse({ ok: false, message: error.message || String(error) })
      })

    return true
  })

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !customSiteApi || !changes[customSiteApi.STORAGE_KEY]) return
    initialization = refreshCustomTargets(changes[customSiteApi.STORAGE_KEY].newValue).then(startTargetMonitoring)
  })

  initialization.then(startTargetMonitoring)

  function startTargetMonitoring() {
    if (targetMonitoring || !detectTarget()) return
    targetMonitoring = true
    sendStatus()
    window.setInterval(sendStatus, 3000)
    startOutputObserver()
    startLocalBridgePolling()
  }

  async function initializeCustomTargets() {
    if (!customSiteApi || !chrome.storage?.local) return
    const stored = await chrome.storage.local.get(customSiteApi.STORAGE_KEY)
    await refreshCustomTargets(stored?.[customSiteApi.STORAGE_KEY])
  }

  async function refreshCustomTargets(value) {
    if (!customSiteApi) {
      customTargets = []
      return
    }
    customTargets = customSiteApi.normalizeStoredSites(value).map(customSiteApi.siteToTarget)
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

    // Text input can rerender the composer. Attach files afterward so the selected
    // FileList is assigned to the current upload input and is not discarded.
    const attachmentResult = await injectAttachments(
      target,
      payload && typeof payload === 'object' ? payload.attachments : [],
      input
    )
    if (!attachmentResult.ok) return attachmentResult

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
    return [...(globalThis.FORMAT_FLOW_AI_TARGETS || []), ...customTargets].find((target) =>
      target.domains.some((domain) => hostname === domain || (!target.exactDomains && hostname.endsWith(`.${domain}`))) &&
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

  function findFileInput(target, textInput) {
    const selectors = target?.fileSelectors || ['input[type="file"]']
    const candidates = selectors.flatMap((selector) => safeQueryAll(document, selector))
      .filter((element) => element instanceof HTMLInputElement && element.type === 'file' && !element.disabled)
    if (candidates.length === 0) return null

    const roots = textInput ? candidateRoots(textInput).filter((root) => root !== document) : []
    return candidates
      .map((candidate, index) => {
        const rootIndex = roots.findIndex((root) => root.contains(candidate))
        const usable = isUsable(candidate) ? 1 : 0
        const sameForm = textInput && candidate.form && textInput.form && candidate.form === textInput.form ? 1 : 0
        const sameRoot = rootIndex >= 0 ? roots.length - rootIndex : 0
        return { candidate, score: sameForm * 10000 + sameRoot * 100 + usable * 10 - index / 1000 }
      })
      .sort((left, right) => right.score - left.score)[0].candidate
  }

  async function injectAttachments(target, attachments, textInput) {
    if (!Array.isArray(attachments) || attachments.length === 0) return { ok: true }
    const input = await waitForFileInput(target, textInput)
    if (!input) {
      return {
        ok: false,
        message: `未找到 ${target?.name || '当前 AI 页面'} 当前对话的文件上传控件。请先打开网页的附件菜单后重试。`
      }
    }
    try {
      if (attachments.length > 1 && !input.multiple) input.multiple = true
      const transfer = new DataTransfer()
      for (const attachment of attachments) {
        if (!attachment || typeof attachment.name !== 'string' || typeof attachment.data !== 'string') {
          return { ok: false, message: '浏览器插件收到的附件数据无效。' }
        }
        const binary = atob(attachment.data)
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
        transfer.items.add(new File([bytes], attachment.name, { type: attachment.mimeType || 'application/octet-stream' }))
      }
      input.files = transfer.files
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
      await sleep(200)
      const currentInput = findFileInput(target, textInput)
      const currentCount = currentInput?.files?.length || input.files?.length || 0
      if (currentCount < attachments.length) {
        return {
          ok: false,
          message: `网页只接收了 ${currentCount}/${attachments.length} 个附件。请先打开当前对话的附件菜单后重试。`
        }
      }
      return { ok: true, count: currentCount }
    } catch (error) {
      return { ok: false, message: `注入附件失败：${error?.message || String(error)}` }
    }
  }

  async function waitForFileInput(target, textInput) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const input = findFileInput(target, textInput)
      if (input) return input
      await sleep(150)
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
    void postLocalBridgeOutput({
      ...statusPayload(target),
      text,
      updatedAt: Date.now()
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
    void postLocalBridgeStatus(statusPayload(target))
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

  function startLocalBridgePolling() {
    if (localBridgePolling || typeof fetch !== 'function') return
    localBridgePolling = true
    window.setInterval(() => {
      void pollLocalBridgeTask()
    }, 1500)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void pollLocalBridgeTask()
    })
    void pollLocalBridgeTask()
  }

  async function pollLocalBridgeTask() {
    const target = detectTarget()
    if (!target) return

    await postLocalBridgeStatus(statusPayload(target))

    if (document.visibilityState && document.visibilityState !== 'visible') return

    try {
      const response = await fetch(`${LOCAL_BRIDGE_BASE}/tasks/next`, { cache: 'no-store' })
      if (!response.ok) return
      const data = await response.json()
      const task = data?.task
      if (!task?.id || !task.payload) return

      const result = await injectTask(task.payload)
      await postLocalBridgeTaskResult(task.id, {
        ...result,
        status: statusPayload(detectTarget())
      })
    } catch {
      // The desktop app may be closed; keep the page-side bridge quiet.
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
})()
