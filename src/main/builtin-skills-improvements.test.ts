import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve('resources/built-in-skills/engineering-cybernetics-user-habit-learning')

describe('engineering-cybernetics Skill improvements', () => {
  it('turns control theory into an operational model', async () => {
    const skill = await fs.readFile(path.join(root, 'SKILL.md'), 'utf8')
    const operationalModel = await fs.readFile(path.join(root, 'references/operational-control-model.md'), 'utf8')

    expect(skill).toContain('references/operational-control-model.md')
    for (const term of ['目标状态', '状态变量', '观测量', '控制动作', '扰动', '时滞', '稳定条件', '兜底路径']) {
      expect(operationalModel).toContain(term)
    }
    expect(operationalModel).toContain('禁止伪精确')
  })

  it('separates knowledge types and records rule lifecycle', async () => {
    const dialogue = await fs.readFile(path.join(root, 'references/dialogue-control-and-habit-learning.md'), 'utf8')
    const lifecycle = await fs.readFile(path.join(root, 'references/evidence-and-lifecycle.md'), 'utf8')
    const generation = await fs.readFile(path.join(root, 'references/skill-generation-spec.md'), 'utf8')

    for (const type of ['preference', 'product-rule', 'architecture', 'safety-policy', 'hypothesis']) {
      expect(dialogue).toContain(type)
      expect(lifecycle).toContain(type)
    }
    expect(lifecycle).toContain('generation-manifest.json')
    expect(lifecycle).toContain('candidate -> reviewed -> active -> stale -> deprecated')
    expect(generation).toContain('extras/generation-manifest.json')
    expect(generation).toContain('目标平台')
    expect(generation).toContain('真实图标')
  })

  it('requires forward evaluation beyond format validation', async () => {
    const evaluation = await fs.readFile(path.join(root, 'references/forward-evaluation.md'), 'utf8')

    expect(evaluation).toContain('行为前向测试')
    expect(evaluation).toContain('未验证声明')
    expect(evaluation).toContain('规则误固化')
    expect(evaluation).toContain('基线比较')
  })
})
