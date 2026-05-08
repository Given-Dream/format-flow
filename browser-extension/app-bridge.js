(function () {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname)) return

  chrome.runtime.sendMessage({ type: 'FORMAT_FLOW_REGISTER_APP' }, (response) => {
    postStatus(response?.status)
  })

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'FORMAT_FLOW_STATUS') {
      postStatus(message.payload)
      return
    }

    if (message?.type === 'FORMAT_FLOW_OUTPUT_SYNC') {
      window.postMessage(
        {
          source: 'format-flow-extension',
          type: 'FORMAT_FLOW_OUTPUT_SYNC',
          payload: message.payload
        },
        window.location.origin
      )
    }
  })

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.source !== 'format-flow') return

    if (data.type === 'FORMAT_FLOW_QUERY_STATUS') {
      chrome.runtime.sendMessage({ type: 'FORMAT_FLOW_QUERY_STATUS' }, (response) => {
        postStatus(response?.status)
      })
      return
    }

    if (data.type !== 'FORMAT_FLOW_SEND_TASK') return
    chrome.runtime.sendMessage(
      {
        type: 'FORMAT_FLOW_SEND_TASK',
        payload: data.payload
      },
      (response) => {
        const payload = response || { ok: false, message: chrome.runtime.lastError?.message || 'Bridge did not respond' }
        window.postMessage(
          {
            source: 'format-flow-extension',
            type: 'FORMAT_FLOW_SEND_RESULT',
            payload
          },
          window.location.origin
        )
        if (payload.status) postStatus(payload.status)
      }
    )
  })

  function postStatus(status) {
    const payload = status || { connected: false, message: chrome.runtime.lastError?.message || '浏览器插件未连接' }
    window.postMessage(
      {
        source: 'format-flow-extension',
        type: 'FORMAT_FLOW_STATUS',
        payload: {
          ...payload,
          bridgeConnected: true
        }
      },
      window.location.origin
    )
  }
})()
