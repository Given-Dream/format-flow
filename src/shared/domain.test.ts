import { describe, expect, it } from 'vitest'
import {
  approvalNode,
  buildExecutionPrompt,
  clonePromptToGroup,
  createPrompt,
  createRunSteps,
  createWorkflow,
  matchesTextAndTags,
  nodeFromPrompt,
  normalizeStore,
  parseSkillMarkdown,
  parseMcpConfig,
  parsePromptImport,
  parseTags,
  rebuildLinearEdges
} from './domain'

describe('tag parsing and search', () => {
  it('normalizes comma separated tags without splitting spaces inside a tag', () => {
    expect(parseTags('Codex, #Review，safe safe')).toEqual(['codex', 'review', 'safe safe'])
    expect(parseTags('7- 结果')).toEqual(['7- 结果'])
  })

  it('extracts custom fill placeholders from prompt content', () => {
    const [prompt] = parsePromptImport('请分析【请填写：摘要草稿】和 {{source}}。', 'fill.md')
    expect(prompt.variables).toEqual(['source', '摘要草稿'])
  })

  it('repairs tags that were split from an existing spaced group tag', () => {
    const normalized = normalizeStore({
      prompts: [
        createPrompt({
          id: 'prompt_split_tag',
          title: 'Split tag',
          tags: ['7-', '结果']
        })
      ],
      groups: {
        prompts: [
          {
            id: 'group_result',
            name: '7- 结果',
            tag: '7- 结果',
            children: []
          }
        ],
        skills: [],
        mcps: [],
        quickCalls: [],
        learning: []
      }
    })

    expect(normalized.prompts[0].tags).toEqual(['7- 结果'])
  })

  it('matches text query and all selected tags', () => {
    const item = {
      title: '安全实现',
      summary: '实现并验证',
      tags: ['codex', 'safe']
    }

    expect(matchesTextAndTags(item, '验证', ['codex'])).toBe(true)
    expect(matchesTextAndTags(item, '验证', ['missing'])).toBe(false)
  })
})

describe('skill parsing', () => {
  it('extracts skill name, summary and heading from frontmatter', () => {
    const skill = parseSkillMarkdown(
      [
        '---',
        'name: test-skill',
        'description: Use when testing skill parsing.',
        '---',
        '',
        '# Test Skill',
        '',
        'Body content.'
      ].join('\n'),
      'C:\\Users\\admin\\.codex\\skills\\test-skill\\SKILL.md'
    )

    expect(skill.name).toBe('test-skill')
    expect(skill.title).toBe('Test Skill')
    expect(skill.summary).toBe('Use when testing skill parsing.')
    expect(skill.source).toBe('codex')
  })
})

describe('prompt and MCP imports', () => {
  it('clones a prompt into a target group without sharing the original item', () => {
    const prompt = createPrompt({
      id: 'prompt_original',
      title: 'Original',
      content: 'Use {{input}} safely.',
      tags: ['source'],
      version: 7,
      favorite: true
    })

    const cloned = clonePromptToGroup(prompt, 'Target', 'Original 副本')

    expect(cloned.id).not.toBe(prompt.id)
    expect(cloned.title).toBe('Original 副本')
    expect(cloned.content).toBe(prompt.content)
    expect(cloned.tags).toEqual(['target'])
    expect(cloned.variables).toEqual(['input'])
    expect(cloned.version).toBe(1)
    expect(cloned.favorite).toBe(false)
  })

  it('imports prompts from app backup JSON', () => {
    const prompts = parsePromptImport(
      JSON.stringify({
        prompts: [
          {
            id: 'prompt_backup',
            title: 'Backup Prompt',
            summary: 'Restored from backup',
            content: 'Use {{input}} safely.',
            tags: ['Backup']
          }
        ]
      }),
      'backup.json'
    )

    expect(prompts).toHaveLength(1)
    expect(prompts[0].title).toBe('Backup Prompt')
    expect(prompts[0].variables).toEqual(['input'])
    expect(prompts[0].tags).toEqual(['backup'])
  })

  it('imports MCP servers from JSON and TOML configs', () => {
    const jsonServers = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            env: { ROOT: 'G:\\songyu' }
          }
        }
      }),
      'mcp.json'
    )
    const tomlServers = parseMcpConfig(
      [
        '[mcp_servers.node_repl]',
        'command = "node"',
        'args = ["server.js", "--stdio"]',
        'env = { NODE_ENV = "production" }'
      ].join('\n'),
      'config.toml'
    )

    expect(jsonServers[0].name).toBe('filesystem')
    expect(jsonServers[0].args).toContain('@modelcontextprotocol/server-filesystem')
    expect(tomlServers[0].name).toBe('node_repl')
    expect(tomlServers[0].env.NODE_ENV).toBe('production')
  })
})

describe('workflow execution planning', () => {
  it('creates linear edges and run steps from workflow nodes', () => {
    const prompt = createPrompt({ id: 'prompt_a', title: 'A', summary: 'Alpha', tags: ['a'] })
    const first = nodeFromPrompt(prompt, 0)
    const second = approvalNode(1)
    const workflow = createWorkflow({
      nodes: [first, second],
      edges: rebuildLinearEdges([first, second])
    })

    expect(workflow.edges).toEqual([{ id: `edge_${first.id}_${second.id}`, source: first.id, target: second.id }])
    expect(createRunSteps(workflow)).toHaveLength(2)
  })

  it('builds an auditable Codex task for a prompt node', () => {
    const prompt = createPrompt({
      id: 'prompt_task',
      title: '实现功能',
      summary: '实现并测试',
      content: '请实现功能。'
    })
    const node = nodeFromPrompt(prompt, 0)
    const task = buildExecutionPrompt(node, [prompt], [], '上一节点输出')

    expect(task).toContain('工作流节点：实现功能')
    expect(task).toContain('请实现功能。')
    expect(task).toContain('上一节点输出')
    expect(task).toContain('每一步完成后等待人工审查')
  })
})
