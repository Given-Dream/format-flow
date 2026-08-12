import { describe, expect, it } from 'vitest'
import {
  buildWorkflowFromBlueprint,
  buildSourcePackageWorkflowTemplates,
  createPredefinedWorkflowBlueprintCatalog,
  createWorkflowBlueprintCatalog,
  createSourcePackageWorkflowImportBundle,
  defaultWorkflowSkillSelection,
  hydrateImportedWorkflowResources,
  normalizeImportedSourceWorkflow,
  parseWorkflowBlueprintCatalog,
  parseWorkflowImportDocument,
  PREDEFINED_WORKFLOW_BLUEPRINTS,
  resolveWorkflowBlueprint,
  selectNewWorkflowImports,
  SOURCE_PACKAGE_SKILL_COUNT,
  SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS,
  sourceWorkflowTemplateId
} from './workflow-import-templates'
import type { SkillItem } from './types'
import { previewWorkflowPath, validateWorkflow } from './workflow-v3'

function skillFor(name: string, pathRoot = 'D:\\reorganized-skills', order = 1): SkillItem {
  const directoryName = `${String(order).padStart(2, '0')}-${name}`
  return {
    id: `skill:${name}`,
    name,
    title: `${name} title`,
    summary: `${name} summary`,
    tags: [],
    variables: [],
    favorite: false,
    path: `${pathRoot}\\${directoryName}\\SKILL.md`,
    source: 'custom',
    contentPreview: `---\nname: ${name}\n---`,
    contentFingerprint: 'a'.repeat(64),
    updatedAt: '2026-08-12T00:00:00.000Z'
  }
}

describe('source-package workflow import templates', () => {
  const workflows = buildSourcePackageWorkflowTemplates([], '2026-08-12T00:00:00.000Z')

  it('creates six research, one review and only patent v2 templates', () => {
    expect(workflows).toHaveLength(8)
    expect(workflows.filter((workflow) => workflow.family === 'research')).toHaveLength(6)
    expect(workflows.filter((workflow) => workflow.family === 'review')).toHaveLength(1)
    expect(workflows.filter((workflow) => workflow.family === 'patent')).toHaveLength(1)
    expect(workflows.some((workflow) => /v1|第一版/i.test(workflow.title))).toBe(false)
    expect(SOURCE_PACKAGE_SKILL_COUNT).toBe(205)
    expect(workflows.every((workflow) => workflow.sourcePackage?.origin === 'imported')).toBe(true)
    expect(workflows.every((workflow) => !workflow.tags.includes('imported'))).toBe(true)
    expect(workflows.every((workflow) => !workflow.tags.includes('official'))).toBe(true)
    expect(workflows.every((workflow) => !workflow.description.includes('内置'))).toBe(true)
    expect(workflows.every((workflow) => !workflow.description.includes('导入'))).toBe(true)
  })

  it('keeps backward-compatible workflow bundle parsing without source-path metadata', () => {
    const bundle = createSourcePackageWorkflowImportBundle([], '2026-08-12T00:00:00.000Z')
    expect(bundle.sourcePackages).toEqual([])
    expect(parseWorkflowImportDocument(JSON.parse(JSON.stringify(bundle)))).toHaveLength(8)
  })

  it('round-trips reusable intermediate templates without Skill paths or fingerprints', () => {
    const catalog = createPredefinedWorkflowBlueprintCatalog()
    const serialized = JSON.stringify(catalog)
    expect(parseWorkflowBlueprintCatalog(JSON.parse(serialized))).toHaveLength(1)
    expect(serialized).toContain('all-numbered')
    expect(serialized).not.toContain('sci-research-paper-controller')
    expect(serialized).not.toContain('发明专利')
    expect(catalog.blueprints[0].researchType).toBe('')
    expect(serialized).not.toContain('fingerprint')
    expect(serialized).not.toContain('locator')
    expect(serialized).not.toMatch(/[A-Z]:\\\\/)
  })

  it('keeps ambiguous branch numbers available for manual selection', () => {
    const skills = [
      skillFor('common', 'D:\\skills', 1),
      skillFor('branch-a', 'D:\\skills', 2),
      skillFor('branch-b', 'D:\\skills', 2)
    ]
    expect(defaultWorkflowSkillSelection(skills)).toEqual([skills[0].id])
    const manual = { ...PREDEFINED_WORKFLOW_BLUEPRINTS[0], templateKey: 'manual', title: '我的模板' }
    expect(createWorkflowBlueprintCatalog([manual]).blueprints[0].title).toBe('我的模板')
  })

  it('generates from one manually selected branch while leaving the reusable blueprint generic', () => {
    const common = skillFor('common', 'D:\\skills', 1)
    const branchA = skillFor('branch-a', 'D:\\skills', 2)
    const branchB = skillFor('branch-b', 'D:\\skills', 2)
    const workflow = buildWorkflowFromBlueprint(PREDEFINED_WORKFLOW_BLUEPRINTS[0], [common, branchA])
    expect(workflow.nodes.filter((node) => node.type === 'skill').map((node) => node.resourceRef?.resourceKey)).toEqual([
      'skill:common',
      'skill:branch-a'
    ])
    expect(PREDEFINED_WORKFLOW_BLUEPRINTS[0].skillNames).toEqual([])
    expect(branchB.name).toBe('branch-b')
  })

  it('continues to read schema v1 named templates without changing their selection contract', () => {
    const legacy = {
      kind: 'format-flow-workflow-blueprints',
      schemaVersion: 1,
      name: 'legacy custom template',
      blueprints: [{
        templateKey: 'legacy-named-template',
        legacyTemplateKeys: [],
        title: 'Legacy named template',
        family: 'custom',
        researchType: 'custom',
        skillNames: ['legacy-alpha'],
        orderStrategy: 'skill-directory-prefix',
        sourceHint: '',
        stageTitles: ['阶段一']
      }]
    }
    const [parsed] = parseWorkflowBlueprintCatalog(legacy)
    expect(parsed.skillSelection).toBe('named')
    expect(parsed.skillNames).toEqual(['legacy-alpha'])
    expect(parsed.stageRules).toEqual({
      assignment: 'balanced',
      skillCounts: [],
      breakAfterSkillOrders: []
    })
    expect(parsed.nodeRules).toEqual({
      reviewMode: 'after-each-skill',
      reviewAfterSkillOrders: [],
      reviewChecklistLabel: '已核对上一 Skill 的要求输出',
      waitAfterStage: false
    })
    expect(parsed.checkpointRules).toEqual({
      mode: 'after-review',
      afterSkillOrders: [],
      titlePattern: '通过：{skill}',
      requiredArtifacts: 'trigger-output'
    })
  })

  it('migrates schema v3 rule switches without changing their behavior', () => {
    const legacy = {
      kind: 'format-flow-workflow-blueprints',
      schemaVersion: 3,
      name: 'legacy v3 custom template',
      blueprints: [{
        templateKey: 'legacy-v3-template',
        legacyTemplateKeys: [],
        title: 'Legacy v3 template',
        family: 'custom',
        researchType: '',
        skillSelection: 'all-numbered',
        skillNames: [],
        orderStrategy: 'skill-directory-prefix',
        sourceHint: '',
        stageTitles: ['阶段一', '阶段二'],
        nodeRules: { reviewAfterEachSkill: false, reviewChecklistLabel: '旧审查项', stageAssignment: 'first-stage' },
        checkpointRules: { afterEachReview: false, titlePattern: '旧：{skill}', requiredArtifacts: 'skill-output' }
      }]
    }
    const [parsed] = parseWorkflowBlueprintCatalog(legacy)
    expect(parsed.stageRules.assignment).toBe('first-stage')
    expect(parsed.nodeRules.reviewMode).toBe('none')
    expect(parsed.nodeRules.reviewChecklistLabel).toBe('旧审查项')
    expect(parsed.checkpointRules).toMatchObject({ mode: 'none', requiredArtifacts: 'trigger-output' })
  })

  it('uses manual node and checkpoint rules when generating a reusable workflow', () => {
    const skills = [skillFor('controller', 'D:\manual-rules', 1), skillFor('writer', 'D:\manual-rules', 2)]
    const withoutReviews = {
      ...PREDEFINED_WORKFLOW_BLUEPRINTS[0],
      templateKey: 'manual-without-review',
      stageTitles: ['阶段一', '阶段二'],
      stageRules: {
        assignment: 'first-stage' as const,
        skillCounts: [],
        breakAfterSkillOrders: []
      },
      nodeRules: {
        reviewMode: 'none' as const,
        reviewAfterSkillOrders: [],
        reviewChecklistLabel: '本项不会使用',
        waitAfterStage: false
      },
      checkpointRules: {
        mode: 'none' as const,
        afterSkillOrders: [],
        titlePattern: '{skill}',
        requiredArtifacts: 'none' as const
      }
    }
    const plain = buildWorkflowFromBlueprint(withoutReviews, skills)
    expect(plain.nodes.map((node) => node.type)).toEqual(['skill', 'skill'])
    expect(new Set(plain.nodes.map((node) => node.stageKey))).toEqual(new Set(['stage-1']))
    expect(plain.checkpointBlueprint).toEqual([])

    const withRules = {
      ...withoutReviews,
      templateKey: 'manual-with-review',
      stageRules: {
        assignment: 'balanced' as const,
        skillCounts: [],
        breakAfterSkillOrders: []
      },
      nodeRules: {
        reviewMode: 'after-each-skill' as const,
        reviewAfterSkillOrders: [],
        reviewChecklistLabel: '确认交付大纲',
        waitAfterStage: false
      },
      checkpointRules: {
        mode: 'after-review' as const,
        afterSkillOrders: [],
        titlePattern: '步骤 {step}：{skill}',
        requiredArtifacts: 'none' as const
      }
    }
    const reviewed = buildWorkflowFromBlueprint(withRules, skills)
    expect(reviewed.nodes.filter((node) => node.type === 'review')).toHaveLength(2)
    expect(reviewed.nodes.find((node) => node.type === 'review')?.reviewChecklist?.[0].label).toBe('确认交付大纲')
    expect(reviewed.checkpointBlueprint.map((item) => item.title)).toEqual([
      '步骤 01：controller title',
      '步骤 02：writer title'
    ])
    expect(reviewed.checkpointBlueprint.every((item) => item.requiredArtifacts.length === 0)).toBe(true)
  })

  it('supports explicit stage boundaries, stage reviews, waits and stage checkpoints', () => {
    const skills = Array.from({ length: 6 }, (_, index) => skillFor(`step-${index + 1}`, 'D:\\stage-rules', index + 1))
    const blueprint = {
      ...PREDEFINED_WORKFLOW_BLUEPRINTS[0],
      templateKey: 'manual-stage-gates',
      stageTitles: ['准备', '执行', '交付'],
      stageRules: { assignment: 'breakpoints' as const, skillCounts: [], breakAfterSkillOrders: [2, 5] },
      nodeRules: {
        reviewMode: 'stage-end' as const,
        reviewAfterSkillOrders: [],
        reviewChecklistLabel: '确认阶段输出大纲',
        waitAfterStage: true
      },
      checkpointRules: {
        mode: 'stage-end' as const,
        afterSkillOrders: [],
        titlePattern: '{stage}：{node}',
        requiredArtifacts: 'stage-outputs' as const
      }
    }
    const workflow = buildWorkflowFromBlueprint(blueprint, skills)
    expect(workflow.nodes.filter((node) => node.type === 'review').map((node) => node.nodeKey)).toEqual(['s02-review', 's05-review', 's06-review'])
    expect(workflow.nodes.filter((node) => node.type === 'wait').map((node) => node.nodeKey)).toEqual(['stage-1-wait', 'stage-2-wait'])
    expect(workflow.nodes.filter((node) => node.type === 'skill').map((node) => node.stageKey)).toEqual([
      'stage-1', 'stage-1', 'stage-2', 'stage-2', 'stage-2', 'stage-3'
    ])
    expect(workflow.checkpointBlueprint.map((item) => item.afterNodeKey)).toEqual(['stage-1-wait', 'stage-2-wait', 's06-review'])
    expect(workflow.checkpointBlueprint.map((item) => item.requiredArtifacts.length)).toEqual([2, 3, 1])
  })

  it('preserves explicit stage-count order and assigns remaining Skills to the last stage', () => {
    const skills = Array.from({ length: 7 }, (_, index) => skillFor(`counted-${index + 1}`, 'D:\\counted-rules', index + 1))
    const blueprint = {
      ...PREDEFINED_WORKFLOW_BLUEPRINTS[0],
      templateKey: 'manual-counted-stages',
      stageTitles: ['一', '二', '三'],
      stageRules: { assignment: 'counts' as const, skillCounts: [3, 1], breakAfterSkillOrders: [] },
      nodeRules: { ...PREDEFINED_WORKFLOW_BLUEPRINTS[0].nodeRules, reviewMode: 'none' as const },
      checkpointRules: { ...PREDEFINED_WORKFLOW_BLUEPRINTS[0].checkpointRules, mode: 'none' as const }
    }
    const catalog = createWorkflowBlueprintCatalog([blueprint])
    const [roundTripped] = parseWorkflowBlueprintCatalog(JSON.parse(JSON.stringify(catalog)))
    expect(roundTripped.stageRules.skillCounts).toEqual([3, 1])
    const workflow = buildWorkflowFromBlueprint(roundTripped, skills)
    expect(workflow.nodes.map((node) => node.stageKey)).toEqual([
      'stage-1', 'stage-1', 'stage-1', 'stage-2', 'stage-3', 'stage-3', 'stage-3'
    ])
  })

  it('supports selected review and selected checkpoint Skill orders independently', () => {
    const skills = Array.from({ length: 4 }, (_, index) => skillFor(`selected-${index + 1}`, 'D:\\selected-rules', index + 1))
    const blueprint = {
      ...PREDEFINED_WORKFLOW_BLUEPRINTS[0],
      templateKey: 'manual-selected-gates',
      nodeRules: {
        reviewMode: 'selected-skills' as const,
        reviewAfterSkillOrders: [2, 4],
        reviewChecklistLabel: '确认选定输出',
        waitAfterStage: false
      },
      checkpointRules: {
        mode: 'selected-skills' as const,
        afterSkillOrders: [1, 3],
        titlePattern: 'S{step} {skill}',
        requiredArtifacts: 'trigger-output' as const
      }
    }
    const workflow = buildWorkflowFromBlueprint(blueprint, skills)
    expect(workflow.nodes.filter((node) => node.type === 'review').map((node) => node.nodeKey)).toEqual(['s02-review', 's04-review'])
    expect(workflow.checkpointBlueprint.map((item) => item.afterNodeKey)).toEqual(['s01-skill', 's03-skill'])
    expect(workflow.checkpointBlueprint.map((item) => item.title)).toEqual(['S01 selected-1 title', 'S03 selected-3 title'])
  })

  it('rejects invalid reusable rule ranges before generating an empty or unreachable structure', () => {
    const skills = Array.from({ length: 3 }, (_, index) => skillFor(`invalid-${index + 1}`, 'D:\\invalid-rules', index + 1))
    const invalidCounts = {
      ...PREDEFINED_WORKFLOW_BLUEPRINTS[0],
      templateKey: 'invalid-counts',
      stageTitles: ['一', '二', '三'],
      stageRules: { assignment: 'counts' as const, skillCounts: [2, 1], breakAfterSkillOrders: [] }
    }
    expect(() => buildWorkflowFromBlueprint(invalidCounts, skills)).toThrow(/末阶段将为空/)

    const invalidSelected = {
      ...PREDEFINED_WORKFLOW_BLUEPRINTS[0],
      templateKey: 'invalid-selected',
      nodeRules: { ...PREDEFINED_WORKFLOW_BLUEPRINTS[0].nodeRules, reviewMode: 'selected-skills' as const, reviewAfterSkillOrders: [4] }
    }
    expect(() => buildWorkflowFromBlueprint(invalidSelected, skills)).toThrow(/序号 4 超出/)
  })

  it('rejects duplicate workflow identities in an edited intermediate template', () => {
    const catalog = createPredefinedWorkflowBlueprintCatalog()
    catalog.blueprints = [catalog.blueprints[0], { ...catalog.blueprints[0] }]
    expect(() => parseWorkflowBlueprintCatalog(catalog)).toThrow(/重复 templateKey/)
  })

  it('resolves a predefined template by current frontmatter name after directories are reorganized', () => {
    const blueprint = PREDEFINED_WORKFLOW_BLUEPRINTS[0]
    const names = ['alpha-controller', 'beta-writer', 'gamma-exporter']
    const skills = names.map((name, index) => skillFor(name, 'D:\\reorganized-skills', index + 1))
    const resolution = resolveWorkflowBlueprint(blueprint, skills)
    expect(resolution.canGenerate).toBe(true)

    const workflow = buildWorkflowFromBlueprint(blueprint, skills, '2026-08-12T00:00:00.000Z', {
      workflowTitle: '我的通用工作流',
      sourcePackageName: '任意 Skill 包',
      sourcePackagePath: 'C:\\managed\\任意 Skill 包'
    })
    const first = workflow.nodes.find((node) => node.type === 'skill')!
    expect(first.resourceRef?.locator).toBe('D:\\reorganized-skills\\01-alpha-controller\\SKILL.md')
    expect(first.resourceRef?.fingerprint).toBe('a'.repeat(64))
    expect(workflow.title).toBe('我的通用工作流')
    expect(workflow.sourcePackage?.name).toBe('任意 Skill 包')
    expect(workflow.sourcePackage?.path).toBe('C:\\managed\\任意 Skill 包')
    expect(workflow.nodes.filter((node) => node.type === 'skill')).toHaveLength(3)
    expect(workflow.nodes.filter((node) => node.type === 'review')).toHaveLength(3)
  })

  it('consumes every Skill in an arbitrary package and orders only by directory prefix', () => {
    const blueprint = PREDEFINED_WORKFLOW_BLUEPRINTS[0]
    const skills = [
      skillFor('unrelated-finalizer', 'D:\\arbitrary-package', 3),
      skillFor('completely-custom-controller', 'D:\\arbitrary-package', 1),
      skillFor('domain-specific-analysis', 'D:\\arbitrary-package', 2)
    ]
    const resolution = resolveWorkflowBlueprint(blueprint, skills)
    expect(resolution.canGenerate).toBe(true)
    expect(resolution.resolved.map((item) => item.name)).toEqual([
      'completely-custom-controller',
      'domain-specific-analysis',
      'unrelated-finalizer'
    ])
    expect(blueprint.skillNames).toEqual([])
  })

  it('blocks the generic template until a numbered Skill package is selected', () => {
    const resolution = resolveWorkflowBlueprint(PREDEFINED_WORKFLOW_BLUEPRINTS[0], [])
    expect(resolution.emptySelection).toBe(true)
    expect(resolution.canGenerate).toBe(false)
    expect(() => buildWorkflowFromBlueprint(PREDEFINED_WORKFLOW_BLUEPRINTS[0], [])).toThrow(/没有可用 Skill/)
  })

  it('blocks generation when a frontmatter name is missing or duplicated', () => {
    const blueprint = SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS[0]
    const complete = blueprint.skillNames.map((name, index) => skillFor(name, 'D:\\reorganized-skills', index + 1))
    const missing = resolveWorkflowBlueprint(blueprint, complete.slice(1))
    expect(missing.canGenerate).toBe(false)
    expect(missing.missingNames).toEqual([blueprint.skillNames[0]])

    const duplicated = resolveWorkflowBlueprint(blueprint, [
      ...complete,
      skillFor(blueprint.skillNames[0], 'E:\\another-skill-root', 1)
    ])
    expect(duplicated.canGenerate).toBe(false)
    expect(duplicated.duplicateNames[0]).toEqual({
      name: blueprint.skillNames[0],
      paths: [
        `D:\\reorganized-skills\\01-${blueprint.skillNames[0]}\\SKILL.md`,
        `E:\\another-skill-root\\01-${blueprint.skillNames[0]}\\SKILL.md`
      ]
    })
  })

  it('uses directory-number order instead of skillNames array order', () => {
    const base = SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS[0]
    const blueprint = { ...base, skillNames: base.skillNames.slice(0, 3) }
    const skills = [
      skillFor(blueprint.skillNames[0], 'D:\\ordered', 2),
      skillFor(blueprint.skillNames[1], 'D:\\ordered', 3),
      skillFor(blueprint.skillNames[2], 'D:\\ordered', 1)
    ]
    const resolution = resolveWorkflowBlueprint(blueprint, skills)
    expect(resolution.resolved.map((item) => item.name)).toEqual([
      blueprint.skillNames[2],
      blueprint.skillNames[0],
      blueprint.skillNames[1]
    ])
    const workflow = buildWorkflowFromBlueprint(blueprint, skills, '2026-08-12T00:00:00.000Z')
    expect(workflow.nodes.filter((node) => node.type === 'skill').map((node) => node.resourceRef?.resourceKey)).toEqual([
      `skill:${blueprint.skillNames[2]}`,
      `skill:${blueprint.skillNames[0]}`,
      `skill:${blueprint.skillNames[1]}`
    ])
  })

  it('supports all predefined workflows with their zero-based or one-based directory series', () => {
    for (const blueprint of SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS) {
      const start = blueprint.family === 'patent' ? 1 : 0
      const skills = blueprint.skillNames.map((name, index) => skillFor(name, `D:\\${blueprint.templateKey}`, index + start))
      const resolution = resolveWorkflowBlueprint(blueprint, skills)
      expect(resolution.canGenerate, blueprint.title).toBe(true)
      expect(resolution.resolved.map((item) => item.order), blueprint.title).toEqual(
        Array.from({ length: blueprint.skillNames.length }, (_, index) => index + start)
      )
    }
  })

  it('blocks unnumbered, duplicated and discontinuous directory prefixes', () => {
    const base = SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS[0]
    const blueprint = { ...base, skillNames: base.skillNames.slice(0, 4) }
    const skills = [
      { ...skillFor(blueprint.skillNames[0], 'D:\\bad-order', 1), path: `D:\\bad-order\\plain-${blueprint.skillNames[0]}\\SKILL.md` },
      skillFor(blueprint.skillNames[1], 'D:\\bad-order', 2),
      skillFor(blueprint.skillNames[2], 'D:\\bad-order', 2),
      skillFor(blueprint.skillNames[3], 'D:\\bad-order', 4)
    ]
    const resolution = resolveWorkflowBlueprint(blueprint, skills)
    expect(resolution.canGenerate).toBe(false)
    expect(resolution.unnumberedSkills.map((item) => item.name)).toEqual([blueprint.skillNames[0]])
    expect(resolution.duplicateOrders.map((item) => item.order)).toEqual([2])
    expect(resolution.missingOrders).toEqual([1, 3])
    expect(() => buildWorkflowFromBlueprint(blueprint, skills)).toThrow(/无编号目录.*重复编号.*缺少目录编号 01、03/)
  })

  it('resolves an imported template back to the scanned source-package directory', () => {
    const skill = {
      id: 'skill:sci-research-paper-controller',
      name: 'sci-research-paper-controller',
      title: 'SCI原创研究论文总控专家',
      summary: '总控',
      tags: [],
      variables: [],
      favorite: false,
      path: 'C:\\skills\\research-pack\\skills\\00-SCI原创研究论文总控专家',
      source: 'custom' as const,
      contentPreview: '# 总控',
      contentFingerprint: 'a'.repeat(64),
      updatedAt: '2026-08-12T00:00:00.000Z'
    }
    const [hydrated] = hydrateImportedWorkflowResources([workflows[0]], [skill])
    expect(hydrated.sourcePackage?.path).toBe('C:\\skills\\research-pack')
    expect(hydrated.nodes[0].resourceRef?.fingerprint).toBe('a'.repeat(64))
  })

  it('recognizes existing compatibility ids as the same imported source templates', () => {
    const legacy = {
      ...workflows[0],
      id: 'official-research-experiment@1.0.0',
      templateKey: 'official-research-experiment',
      description: '内置工作流：原创研究论文｜实验研究。',
      tags: ['official', 'research'],
      sourcePackage: { name: '杨师兄原创研究型论文Skiil-第一版.zip', path: 'source.zip' }
    }
    const normalized = normalizeImportedSourceWorkflow(legacy)
    expect(sourceWorkflowTemplateId(normalized)).toBe('source-research-experiment')
    expect(normalized.id).toBe(legacy.id)
    expect(normalized.description).toBe('原创研究论文｜实验研究。')
    expect(normalized.tags).toEqual(['research'])
    expect(normalized.sourcePackage?.origin).toBe('imported')
    const selection = selectNewWorkflowImports([normalized], [workflows[0]])
    expect(selection.imports).toEqual([])
    expect(selection.skipped).toHaveLength(1)
  })

  it('never rebinds an already generated workflow when the same Skill name moves or changes', () => {
    const blueprint = SOURCE_PACKAGE_WORKFLOW_BLUEPRINTS[0]
    const originalSkills = blueprint.skillNames.map((name, index) => skillFor(name, 'D:\\old-root', index + 1))
    const generated = buildWorkflowFromBlueprint(blueprint, originalSkills, '2026-08-12T00:00:00.000Z')
    const reorganizedSkills = blueprint.skillNames.map((name, index) => ({
      ...skillFor(name, 'E:\\new-root', index + 1),
      contentFingerprint: 'b'.repeat(64)
    }))
    const [unchanged] = hydrateImportedWorkflowResources([generated], reorganizedSkills)
    const first = unchanged.nodes.find((node) => node.type === 'skill')!
    expect(first.resourceRef?.locator).toContain('D:\\old-root')
    expect(first.resourceRef?.fingerprint).toBe('a'.repeat(64))
  })

  it('uses 58-60 research nodes, 45 review nodes and 24 patent nodes', () => {
    expect(workflows.filter((workflow) => workflow.family === 'research').map((workflow) => workflow.nodes.length).sort()).toEqual([
      58, 58, 60, 60, 60, 60
    ])
    expect(workflows.find((workflow) => workflow.family === 'review')?.nodes).toHaveLength(45)
    expect(workflows.find((workflow) => workflow.family === 'patent')?.nodes).toHaveLength(24)
  })

  it('places a Review directly after every real Skill', () => {
    for (const workflow of workflows) {
      for (let index = 0; index < workflow.nodes.length; index += 1) {
        if (workflow.nodes[index].type !== 'skill') continue
        expect(workflow.nodes[index + 1]?.type, `${workflow.title}: ${workflow.nodes[index].nodeKey}`).toBe('review')
      }
    }
  })

  it('uses only topic and delivery mode in the execution project form', () => {
    for (const workflow of workflows) {
      expect(workflow.formSchema.map((field) => field.key)).toEqual(['topic', 'deliveryMode'])
    }
  })

  it('passes template contract validation', () => {
    for (const workflow of workflows) {
      expect(validateWorkflow(workflow).filter((issue) => issue.severity === 'error'), workflow.title).toEqual([])
    }
  })

  it('routes patent S03 to the selected earliest required step', () => {
    const patent = workflows.find((workflow) => workflow.family === 'patent')!
    const preview = previewWorkflowPath(patent, {
      researchType: '发明专利',
      topic: '示例',
      projectDirectory: 'D:/project',
      hasRequiredInputs: true,
      hasHumanAuthorization: true,
      operatingSystem: 'Windows',
      aiPlatform: 'Codex',
      deliveryMode: 'copy-all',
      startStep: '08'
    })
    const keys = preview.steps.map((step) => step.nodeKey)
    expect(keys).toContain('s08-skill')
    expect(preview.steps.find((step) => step.nodeKey === 's04-skill')?.outcome).toBe('skip')
    expect(preview.steps.find((step) => step.nodeKey === 's07-review')?.outcome).toBe('skip')
  })
})
