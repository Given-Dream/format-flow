(function () {
  const STORAGE_KEY = 'formatFlowCustomSites'
  const CONTENT_SCRIPT_ID = 'format-flow-custom-ai-sites'

  const genericSelectors = ['textarea', '[contenteditable="true"]']
  const genericSendSelectors = [
    'button[type="submit"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    '[role="button"][aria-label*="Send"]',
    '[role="button"][aria-label*="发送"]',
    '[data-testid*="send"]'
  ]
  const genericOutputSelectors = [
    '[data-message-author-role="assistant"]',
    '[data-testid*="assistant"]',
    '.markdown',
    '.prose',
    'article'
  ]

  function normalizeSiteInput(value) {
    const raw = String(value || '').trim()
    if (!raw) throw new Error('请输入网站域名。')

    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
    let parsed
    try {
      parsed = new URL(candidate)
    } catch {
      throw new Error('域名格式无效，请输入 example.com 或完整网址。')
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('仅支持 HTTP 或 HTTPS 网站。')
    }
    if (parsed.username || parsed.password) {
      throw new Error('域名不能包含账号或密码。')
    }

    const domain = parsed.hostname.toLowerCase().replace(/\.$/, '')
    if (!domain) throw new Error('未找到有效域名。')

    return createSite({
      domain,
      protocol: parsed.protocol,
      createdAt: Date.now()
    })
  }

  function normalizeStoredSites(value) {
    if (!Array.isArray(value)) return []
    const unique = new Map()
    for (const item of value) {
      try {
        const site = createSite(item)
        if (!unique.has(site.id)) unique.set(site.id, site)
      } catch {
        // Ignore malformed entries left by older or manually edited storage.
      }
    }
    return Array.from(unique.values()).sort((left, right) => left.domain.localeCompare(right.domain))
  }

  function createSite(value) {
    const protocol = value?.protocol === 'http:' ? 'http:' : 'https:'
    const domain = String(value?.domain || '').trim().toLowerCase().replace(/\.$/, '')
    const parsed = new URL(`${protocol}//${domain}`)
    if (!domain || parsed.hostname !== domain) throw new Error('Invalid custom site')

    return {
      id: `${protocol}//${domain}`,
      name: domain,
      domain,
      protocol,
      pattern: `${protocol}//${domain}/*`,
      createdAt: Number.isFinite(Number(value?.createdAt)) ? Number(value.createdAt) : Date.now()
    }
  }

  function siteToTarget(site) {
    return {
      name: site.name || site.domain,
      icon: (site.domain?.[0] || 'W').toUpperCase(),
      domains: [site.domain],
      exactDomains: true,
      selectors: genericSelectors,
      sendSelectors: genericSendSelectors,
      outputSelectors: genericOutputSelectors
    }
  }

  function matchesUrl(site, value) {
    try {
      const parsed = value instanceof URL ? value : new URL(value)
      return parsed.protocol === site.protocol && parsed.hostname.toLowerCase() === site.domain
    } catch {
      return false
    }
  }

  globalThis.FORMAT_FLOW_CUSTOM_SITES = {
    STORAGE_KEY,
    CONTENT_SCRIPT_ID,
    normalizeSiteInput,
    normalizeStoredSites,
    siteToTarget,
    matchesUrl
  }
})()
