import { describe, expect, it } from 'vitest'
import {
  approvalNode,
  analyzePromptImport,
  analyzeSkillImport,
  buildExecutionPrompt,
  buildSmartSkillGroups,
  deduplicateSkillGroupTags,
  findPromptDuplicateGroups,
  findSkillDuplicateGroups,
  createMcpServer,
  clonePromptToGroup,
  createPrompt,
  createRunSteps,
  createWorkflow,
  matchesTextAndTags,
  mergeSkillMetadata,
  nodeFromMcp,
  nodeFromPrompt,
  nodeFromSkill,
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
        workflows: [],
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

  it('normalizes temporary Word retention settings', () => {
    expect(
      normalizeStore({ settings: { shortcut: 'Alt+Space', skillDirectories: [], temporaryWordRetentionHours: 0 } })
        .settings.temporaryWordRetentionHours
    ).toBe(1)
    expect(
      normalizeStore({ settings: { shortcut: 'Alt+Space', skillDirectories: [], temporaryWordRetentionHours: 999 } })
        .settings.temporaryWordRetentionHours
    ).toBe(720)
    expect(
      normalizeStore({ settings: { shortcut: 'Alt+Space', skillDirectories: [] } }).settings.temporaryWordRetentionHours
    ).toBe(24)
  })

  it('keeps deleted prompt tag recovery records and initializes older stores', () => {
    expect(normalizeStore({}).tagRecoveries).toEqual([])

    const recovery = {
      id: 'tag-recovery-1',
      resource: 'prompts' as const,
      group: { id: 'group-1', name: '研究', tag: '研究', children: [] },
      promptTags: { 'prompt-1': ['研究'] },
      deletedAt: '2026-08-07T00:00:00.000Z'
    }
    expect(normalizeStore({ tagRecoveries: [recovery] }).tagRecoveries).toEqual([recovery])
  })

  it('deduplicates imported prompts by title and summary and reports body conflicts', () => {
    const existing = createPrompt({ id: 'prompt-existing', title: '代码审查', summary: '检查风险', content: '现有正文' })
    const same = createPrompt({ id: 'prompt-same', title: '代码审查', summary: '检查风险', content: '现有正文\r\n' })
    const changed = createPrompt({ id: 'prompt-changed', title: '代码审查', summary: '检查风险', content: '导入正文' })
    const newPrompt = createPrompt({ id: 'prompt-new', title: '测试计划', summary: '覆盖主要流程', content: '新正文' })

    const result = analyzePromptImport([existing], [same, changed, newPrompt])
    expect(result.identical).toHaveLength(1)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ existing: { id: 'prompt-existing' }, imported: { content: '导入正文' } })
    expect(result.additions).toHaveLength(1)
    expect(result.additions[0].title).toBe('测试计划')
  })

  it('groups historical prompt duplicates while preserving every version', () => {
    const first = createPrompt({ id: 'prompt-first', title: '代码审查', summary: '检查风险', content: '第一版' })
    const identical = createPrompt({ id: 'prompt-identical', title: ' 代码审查 ', summary: '检查风险 ', content: '第一版\r\n' })
    const changed = createPrompt({ id: 'prompt-changed', title: '代码审查', summary: '检查风险', content: '第二版' })
    const unique = createPrompt({ id: 'prompt-unique', title: '测试计划', summary: '覆盖流程', content: '正文' })

    const groups = findPromptDuplicateGroups([first, identical, changed, unique])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((item) => item.id)).toEqual(['prompt-first', 'prompt-identical', 'prompt-changed'])
    expect(groups[0].identicalContent).toBe(false)
  })
})

describe('skill parsing', () => {
  it('deduplicates imported Skills by name and reports changed SKILL.md content', () => {
    const existing = parseSkillMarkdown('---\nname: review-skill\ndescription: Review work.\n---\n# Review\nOld', 'C:/skills/review/SKILL.md')
    const same = parseSkillMarkdown('---\nname: review-skill\ndescription: Review work.\n---\n# Review\nOld', 'C:/imports/same/SKILL.md')
    const changed = parseSkillMarkdown('---\nname: review-skill\ndescription: Review work.\n---\n# Review\nNew', 'C:/imports/changed/SKILL.md')
    const added = parseSkillMarkdown('---\nname: new-skill\ndescription: New work.\n---\n# New', 'C:/imports/new/SKILL.md')

    const result = analyzeSkillImport([existing], [same, changed, added])
    expect(result.identical).toHaveLength(1)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0].existing.path).toBe('C:/skills/review/SKILL.md')
    expect(result.additions).toEqual([added])
  })

  it('groups historical Skills by normalized name', () => {
    const first = parseSkillMarkdown('---\nname: review-skill\n---\n# Review\nSame', 'C:/skills/review/SKILL.md')
    const duplicate = parseSkillMarkdown('---\nname: REVIEW-SKILL\n---\n# Review\nSame', 'C:/imports/review/SKILL.md')
    const unique = parseSkillMarkdown('---\nname: another-skill\n---\n# Another', 'C:/skills/another/SKILL.md')

    const groups = findSkillDuplicateGroups([first, duplicate, unique])
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((item) => item.path)).toEqual(['C:/skills/review/SKILL.md', 'C:/imports/review/SKILL.md'])
    expect(groups[0].identicalContent).toBe(false)
  })

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

  it('does not create Skill tags from the installation path or Skill name', () => {
    const skill = parseSkillMarkdown(
      ['---', 'name: chapter-agent', 'description: Path noise test.', '---', '# Chapter Agent'].join('\n'),
      'C:/Users/admin/AppData/Roaming/format-flow/managed-skills/chapter/agent/SKILL.md'
    )

    expect(skill.tags).toEqual(['其他 skill'])
    expect(skill.tags).not.toEqual(expect.arrayContaining(['chapter', 'agent', 'users', 'appdata']))
  })

  it.each([
    ['run-experiment', 'Deploy and run ML experiments on a remote GPU server.', '实验运行'],
    ['paper-write', 'Draft a LaTeX paper section by section from an outline.', '论文写作'],
    ['formula-derivation', 'Structure and derive research formulas from assumptions.', '公式证明'],
    ['imagegen', 'Generate or edit raster images and illustrations.', '图像设计'],
    ['skill-installer', 'Install Codex skills from a curated list or GitHub repository.', 'skill 与插件'],
    ['fiscaliste', 'Fiscalité des particuliers au Luxembourg.', '财务合规'],
    ['ablation-planner', "Design ablations from a reviewer's perspective.", '结果分析'],
    ['grant-proposal', 'Draft a funding application from research ideas and literature.', '基金申请'],
    ['research-review', 'Get a critical reviewer assessment of research ideas.', '学术审查'],
    ['research-refine-pipeline', 'Run an end-to-end research planning pipeline.', '工作流自动化'],
    ['paper-writing', 'Orchestrate paper figures and drafting into a submission-ready PDF.', '论文写作']
  ])('classifies %s from Skill semantics', (name, description, expectedTag) => {
    const skill = parseSkillMarkdown(
      ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`].join('\n'),
      `C:/unrelated/location/${name}/SKILL.md`
    )

    expect(skill.tags).toContain(expectedTag)
  })

  it('uses explicit frontmatter categories and ignores generic Skill tags', () => {
    const skill = parseSkillMarkdown(
      [
        '---',
        'name: custom-tool',
        'description: A reusable custom tool.',
        'category: 团队工具',
        'tags: [GitHub, codex, skill]',
        '---',
        '',
        '# Custom Tool'
      ].join('\n'),
      'D:/skills/custom-tool/SKILL.md'
    )

    expect(skill.tags).toEqual(['团队工具', 'github'])
  })

  it('builds stable parent and child groups for semantic Skill categories', () => {
    const skills = [
      parseSkillMarkdown(
        ['---', 'name: format-flow-development', 'description: Develop an Electron software application.', '---'].join('\n'),
        'D:/skills/format-flow-development/SKILL.md'
      ),
      parseSkillMarkdown(
        ['---', 'name: arxiv', 'description: Search academic literature and related work.', '---'].join('\n'),
        'D:/skills/arxiv/SKILL.md'
      )
    ]
    const groups = buildSmartSkillGroups(skills)
    const codeGroup = groups.find((group) => group.tag === '代码工程')
    const writingGroup = groups.find((group) => group.tag === '科研写作')

    expect(codeGroup?.children.map((group) => group.tag)).toContain('代码实现')
    expect(writingGroup?.children.map((group) => group.tag)).toContain('文献选题')
    expect(buildSmartSkillGroups(skills)).toEqual(groups)
  })

  it('removes legacy path tags while preserving custom manual groups', () => {
    const skill = parseSkillMarkdown(
      ['---', 'name: chapter-agent', 'description: Path noise test.', '---', '# Chapter Agent'].join('\n'),
      'C:/Users/admin/AppData/Roaming/format-flow/managed-skills/chapter/agent/SKILL.md'
    )
    const merged = mergeSkillMetadata(skill, { tags: ['chapter', 'agent', 'users', '团队规范'] }, ['团队规范'])

    expect(merged.tags).toEqual(['其他 skill', '团队规范'])
  })

  it('replaces legacy automatic categories with a fresh semantic category', () => {
    const skill = parseSkillMarkdown(
      ['---', 'name: arxiv', 'description: Search academic literature and related work.', '---', '# arXiv'].join('\n'),
      'D:/skills/arxiv/SKILL.md'
    )
    const merged = mergeSkillMetadata(skill, { tags: ['论文写作'] }, ['论文写作'])

    expect(merged.tags).toEqual(['文献选题'])
  })

  it('preserves an explicitly assigned tag even when it matches a path token', () => {
    const skill = parseSkillMarkdown('# Agent', 'C:/Users/admin/skills/agent/SKILL.md')
    const merged = mergeSkillMetadata(skill, { tags: ['agent'], assignedTags: ['agent'] })

    expect(merged.tags).toEqual(['agent'])
  })

  it('prefers a learning source label when duplicate automatic groups contain the same Skill', () => {
    const skill = {
      ...parseSkillMarkdown('# Review', 'D:/skills/review/SKILL.md'),
      id: 'skill:review',
      tags: ['learning', '对话审查']
    }

    expect(deduplicateSkillGroupTags([skill])).toEqual(['对话审查'])
  })

  it('deduplicates automatic groups with identical Skill membership', () => {
    const first = {
      ...parseSkillMarkdown('# First', 'D:/skills/first/SKILL.md'),
      id: 'skill:first',
      tags: ['alpha', 'alias']
    }
    const second = {
      ...parseSkillMarkdown('# Second', 'D:/skills/second/SKILL.md'),
      id: 'skill:second',
      tags: ['alpha', 'alias']
    }

    expect(deduplicateSkillGroupTags([first, second])).toEqual(['alias'])
  })

  it('keeps a manual group when an automatic tag has the same Skill membership', () => {
    const skill = {
      ...parseSkillMarkdown('# First', 'D:/skills/first/SKILL.md'),
      id: 'skill:first',
      tags: ['alpha', 'alias']
    }
    const manualGroups = [{ id: 'group_alias', name: 'Alias', tag: 'alias', children: [] }]

    expect(deduplicateSkillGroupTags([skill], manualGroups)).toEqual([])
  })
  it('classifies generated learning Skills and preserves the category after metadata is merged', () => {
    const skill = parseSkillMarkdown(
      [
        '---',
        'name: learned-review',
        'description: Learned review behavior.',
        'generate by: conversation-review',
        '---',
        '',
        '# Learned Review'
      ].join('\n'),
      'D:/skills/learned-review/SKILL.md'
    )
    const merged = mergeSkillMetadata(skill, { tags: ['custom'] })

    expect(skill.tags).toContain('对话审查')
    expect(merged.tags).toEqual(expect.arrayContaining(['custom', '对话审查']))
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

  it('imports prompts from exported Markdown as separate prompt items', () => {
    const prompts = parsePromptImport(
      [
        '# Format Flow Prompts',
        '',
        '- Exported: 2026-07-13T00:00:00.000Z',
        '- Count: 2',
        '',
        '## 1. First Prompt',
        '',
        '- Summary: First summary',
        '- Tags: Alpha, Parent/Child',
        '- Variables: input',
        '- Version: 3',
        '- Updated: 2026-07-13T01:00:00.000Z',
        '',
        '```text',
        'Use {{input}} safely.',
        '```',
        '',
        '## 2. Second Prompt',
        '',
        '- Summary: Second summary',
        '- Tags: Beta',
        '- Variables: -',
        '- Version: 1',
        '- Updated: 2026-07-13T02:00:00.000Z',
        '',
        '```text',
        'Summarize this text.',
        '```',
        ''
      ].join('\n'),
      'prompts.md'
    )

    expect(prompts).toHaveLength(2)
    expect(prompts[0].title).toBe('First Prompt')
    expect(prompts[0].content).toBe('Use {{input}} safely.')
    expect(prompts[0].tags).toEqual(['alpha', 'parent/child'])
    expect(prompts[0].variables).toEqual(['input'])
    expect(prompts[0].version).toBe(3)
    expect(prompts[1].title).toBe('Second Prompt')
    expect(prompts[1].content).toBe('Summarize this text.')
    expect(prompts[1].tags).toEqual(['beta'])
  })

  it('imports prompts from the embedded Markdown backup block', () => {
    const payload = {
      format: 'format-flow-prompts',
      prompts: [
        {
          id: 'prompt_embedded',
          title: 'Embedded Prompt',
          summary: 'Exact backup',
          content: 'Keep exact fields.',
          tags: ['Backup'],
          variables: ['field'],
          version: 5,
          favorite: true,
          createdAt: '2026-07-13T00:00:00.000Z',
          updatedAt: '2026-07-13T01:00:00.000Z'
        }
      ]
    }
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')

    const prompts = parsePromptImport(
      ['# Format Flow Prompts', '', '<!-- format-flow-prompts-json', encoded, '-->', '', 'Readable fallback'].join('\n'),
      'prompts.md'
    )

    expect(prompts).toHaveLength(1)
    expect(prompts[0].id).toBe('prompt_embedded')
    expect(prompts[0].title).toBe('Embedded Prompt')
    expect(prompts[0].favorite).toBe(true)
    expect(prompts[0].createdAt).toBe('2026-07-13T00:00:00.000Z')
    expect(prompts[0].updatedAt).toBe('2026-07-13T01:00:00.000Z')
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

  it('builds an auditable Codex task for a skill node', () => {
    const skill = parseSkillMarkdown(
      [
        '---',
        'name: planner',
        'description: 规划下一步',
        '---',
        '# Planner',
        '',
        '请根据上下文拆解任务。'
      ].join('\n'),
      'D:/skills/planner/SKILL.md'
    )
    const node = nodeFromSkill(skill, 0)
    const task = buildExecutionPrompt(node, [], [skill], '需求背景')

    expect(node.type).toBe('skill')
    expect(task).toContain('节点类型：Skill')
    expect(task).toContain('Skill 信息')
    expect(task).toContain('请根据上下文拆解任务。')
    expect(task).toContain('需求背景')
  })

  it('builds an auditable Codex task for an MCP node', () => {
    const mcp = createMcpServer({
      id: 'mcp_files',
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['@modelcontextprotocol/server-filesystem', 'D:/workspace'],
      env: { NODE_ENV: 'production' },
      tags: ['files']
    })
    const node = nodeFromMcp(mcp, 0)
    const task = buildExecutionPrompt(node, [], [], '上一节点结果', [mcp])

    expect(node.type).toBe('mcp')
    expect(task).toContain('节点类型：MCP')
    expect(task).toContain('MCP 信息')
    expect(task).toContain('@modelcontextprotocol/server-filesystem')
    expect(task).toContain('上一节点结果')
  })
})
