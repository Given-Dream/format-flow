import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const customSitesSource = await fs.readFile(path.join(root, 'custom-sites.js'), 'utf8')
const backgroundSource = await fs.readFile(path.join(root, 'background.js'), 'utf8')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'))
const popup = await fs.readFile(path.join(root, 'popup.html'), 'utf8')

const helperContext = vm.createContext({ URL })
vm.runInContext(customSitesSource, helperContext)
const api = helperContext.FORMAT_FLOW_CUSTOM_SITES

const normalized = api.normalizeSiteInput('https://AI.Example.com/chat?model=1')
assert.equal(normalized.domain, 'ai.example.com')
assert.equal(normalized.pattern, 'https://ai.example.com/*')
assert.equal(normalized.protocol, 'https:')

const defaultProtocol = api.normalizeSiteInput('assistant.example.org')
assert.equal(defaultProtocol.pattern, 'https://assistant.example.org/*')
assert.equal(api.matchesUrl(defaultProtocol, 'https://assistant.example.org/chat'), true)
assert.equal(api.matchesUrl(defaultProtocol, 'https://sub.assistant.example.org/chat'), false)

const deduplicated = api.normalizeStoredSites([normalized, normalized, { domain: '', protocol: 'https:' }])
assert.equal(deduplicated.length, 1)
assert.equal(api.siteToTarget(normalized).exactDomains, true)

assert.ok(manifest.optional_host_permissions.includes('https://*/*'))
assert.ok(manifest.content_scripts.some((entry) => entry.js?.includes('custom-sites.js')))
assert.match(popup, /id="custom-site-form"/)
assert.match(popup, /src="custom-sites\.js"/)
assert.match(popup, /src="popup\.js"/)

let runtimeListener
let registeredScripts = []
const appTab = { id: 1, active: false, title: 'Format Flow', url: 'http://127.0.0.1:5174/' }
const customTab = { id: 2, active: true, title: 'Custom AI', url: 'https://ai.example.com/chat' }
const backgroundContext = vm.createContext({
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListener = listener
        }
      }
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: [normalized] }
        }
      },
      onChanged: { addListener() {} }
    },
    permissions: {
      async contains() {
        return true
      },
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} }
    },
    scripting: {
      async unregisterContentScripts() {},
      async registerContentScripts(entries) {
        registeredScripts = entries
      },
      async executeScript() {}
    },
    tabs: {
      onRemoved: { addListener() {} },
      onUpdated: { addListener() {} },
      async query() {
        return [appTab, customTab]
      },
      async sendMessage() {
        return { ok: true }
      },
      async update() {}
    }
  },
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
vm.runInContext(customSitesSource, backgroundContext)
vm.runInContext(backgroundSource, backgroundContext)

const status = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out waiting for custom site status')), 1000)
  runtimeListener({ type: 'FORMAT_FLOW_QUERY_STATUS' }, { tab: appTab }, (response) => {
    clearTimeout(timer)
    resolve(response?.status)
  })
})

assert.equal(registeredScripts.length, 1)
assert.deepEqual(Array.from(registeredScripts[0].matches), ['https://ai.example.com/*'])
assert.ok(registeredScripts[0].js.includes('custom-sites.js'))
assert.equal(status?.connected, true)
assert.equal(status?.aiName, 'ai.example.com')

console.log('Validated custom website permissions, registration, and background detection.')
