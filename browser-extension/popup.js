(function () {
  const api = globalThis.FORMAT_FLOW_CUSTOM_SITES
  const form = document.querySelector('#custom-site-form')
  const input = document.querySelector('#site-domain')
  const addButton = document.querySelector('#add-site')
  const list = document.querySelector('#site-list')
  const emptyState = document.querySelector('#empty-state')
  const status = document.querySelector('#site-status')
  let sites = []

  form.addEventListener('submit', handleAddSite)
  list.addEventListener('click', handleSiteAction)
  void loadSites()

  async function loadSites() {
    try {
      const stored = await chrome.storage.local.get(api.STORAGE_KEY)
      sites = api.normalizeStoredSites(stored?.[api.STORAGE_KEY])
      await renderSites()
    } catch (error) {
      setStatus(error.message || String(error), 'error')
    }
  }

  async function handleAddSite(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const site = api.normalizeSiteInput(input.value)
      if (sites.some((item) => item.id === site.id)) {
        setStatus(`${site.domain} 已在列表中。`)
        return
      }

      const granted = await requestSitePermission(site)
      if (!granted) {
        setStatus(`未获得 ${site.domain} 的网站权限。`, 'error')
        return
      }

      sites = api.normalizeStoredSites([...sites, site])
      await chrome.storage.local.set({ [api.STORAGE_KEY]: sites })
      await injectIntoMatchingTabs(site)
      input.value = ''
      setStatus(`已添加 ${site.domain}。`, 'success')
      await renderSites()
    } catch (error) {
      setStatus(error.message || String(error), 'error')
    } finally {
      setBusy(false)
      input.focus()
    }
  }

  async function handleSiteAction(event) {
    const button = event.target.closest('button[data-site-id]')
    if (!button) return
    const site = sites.find((item) => item.id === button.dataset.siteId)
    if (!site) return

    if (button.dataset.action === 'grant') {
      try {
        const granted = await requestSitePermission(site)
        if (!granted) {
          setStatus(`未获得 ${site.domain} 的网站权限。`, 'error')
          return
        }
        await injectIntoMatchingTabs(site)
        setStatus(`已授权 ${site.domain}。`, 'success')
        await renderSites()
      } catch (error) {
        setStatus(error.message || String(error), 'error')
      }
      return
    }

    if (button.dataset.action !== 'remove') return
    if (!window.confirm(`确定删除自定义网站 ${site.domain} 吗？`)) return

    try {
      sites = sites.filter((item) => item.id !== site.id)
      await chrome.storage.local.set({ [api.STORAGE_KEY]: sites })
      await chrome.permissions.remove({ origins: [site.pattern] }).catch(() => false)
      await reloadMatchingTabs(site)
      setStatus(`已删除 ${site.domain}。`, 'success')
      await renderSites()
    } catch (error) {
      setStatus(error.message || String(error), 'error')
    }
  }

  async function requestSitePermission(site) {
    if (site.protocol === 'http:') return true
    return chrome.permissions.request({ origins: [site.pattern] })
  }

  async function renderSites() {
    list.replaceChildren()
    emptyState.hidden = sites.length > 0

    for (const site of sites) {
      const granted = await chrome.permissions.contains({ origins: [site.pattern] })
      const row = document.createElement('li')
      row.className = 'site-row'

      const info = document.createElement('div')
      info.className = 'site-info'
      const domain = document.createElement('div')
      domain.className = 'site-domain'
      domain.textContent = site.domain
      domain.title = site.domain
      const meta = document.createElement('div')
      meta.className = 'site-meta'
      meta.textContent = granted ? `${site.protocol.replace(':', '').toUpperCase()} · 已授权` : '需要网站权限'
      info.append(domain, meta)

      const actions = document.createElement('div')
      actions.className = 'site-actions'
      if (!granted) {
        const grant = document.createElement('button')
        grant.type = 'button'
        grant.className = 'site-action grant-action'
        grant.dataset.action = 'grant'
        grant.dataset.siteId = site.id
        grant.textContent = '授权'
        actions.append(grant)
      }

      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'site-action'
      remove.dataset.action = 'remove'
      remove.dataset.siteId = site.id
      remove.textContent = '×'
      remove.title = `删除 ${site.domain}`
      remove.setAttribute('aria-label', `删除 ${site.domain}`)
      actions.append(remove)

      row.append(info, actions)
      list.append(row)
    }
  }

  async function injectIntoMatchingTabs(site) {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (!tab.id || !api.matchesUrl(site, tab.url || '')) continue
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['targets.js', 'custom-sites.js', 'ai-injector.js']
        })
      } catch {
        // The background registration will inject on the next page load.
      }
    }
  }

  async function reloadMatchingTabs(site) {
    const tabs = await chrome.tabs.query({})
    await Promise.all(
      tabs
        .filter((tab) => tab.id && api.matchesUrl(site, tab.url || ''))
        .map((tab) => chrome.tabs.reload(tab.id).catch(() => undefined))
    )
  }

  function setBusy(busy) {
    input.disabled = busy
    addButton.disabled = busy
  }

  function setStatus(message, kind = '') {
    status.textContent = message
    status.dataset.kind = kind
  }
})()
