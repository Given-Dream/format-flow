import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const root = path.resolve(import.meta.dirname, '..')
const source = fs.readFileSync(path.join(root, 'targets.js'), 'utf8')
const context = { globalThis: {} }
context.globalThis = context
vm.runInNewContext(source, context)

const targets = context.FORMAT_FLOW_AI_TARGETS
assert.ok(Array.isArray(targets), 'targets must be an array')

const required = ['Format Flow Test AI', 'ChatGPT', 'Claude', 'Gemini', 'DeepSeek', 'Kimi', 'Qwen', 'Perplexity']
for (const name of required) {
  const target = targets.find((item) => item.name === name)
  assert.ok(target, `${name} target is missing`)
  assert.ok(target.domains.length > 0, `${name} must define domains`)
  assert.ok(target.selectors.length > 0, `${name} must define selectors`)
  assert.ok(target.outputSelectors.length > 0, `${name} must define output selectors`)
}

for (const target of targets) {
  assert.equal(new Set(target.domains).size, target.domains.length, `${target.name} has duplicate domains`)
  assert.equal(new Set(target.selectors).size, target.selectors.length, `${target.name} has duplicate selectors`)
  assert.equal(new Set(target.outputSelectors).size, target.outputSelectors.length, `${target.name} has duplicate output selectors`)
}

console.log(`Validated ${targets.length} AI browser-extension targets.`)
