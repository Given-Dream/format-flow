import { describe, expect, it } from 'vitest'
import type { Workflow } from './types'
import {
  createProjectFlowState,
  evaluateCondition,
  evaluateRules,
  previewProjectMigration,
  previewWorkflowPath,
  recordDelivery,
  REVIEW_OUTPUT_CONFIRMATION_KEY,
  submitReview,
  updateProjectSetup,
  validateWorkflow
} from './workflow-v3'

function makeWorkflow(): Workflow {
  return {
    id: 'workflow-a-v1',
    templateKey: 'workflow-a',
    templateVersion: '1.0.0',
    status: 'published',
    family: 'custom',
    title: '测试工作流',
    description: '测试',
    tags: [],
    variables: [],
    favorite: false,
    formSchema: [{ key: 'topic', label: '研究主题', type: 'text', required: true }],
    stages: [{ stageKey: 'draft', title: '起草', description: '', order: 1 }],
    checkpointBlueprint: [
      { checkpointKey: 'skill-reviewed', title: '技能审查通过', afterNodeKey: 'review-s01', requiredArtifacts: ['draft.md'] }
    ],
    applicability: {
      researchTypes: ['测试'],
      scenarios: [],
      targetArtifacts: ['draft.md'],
      requiredInputs: ['topic'],
      optionalInputs: [],
      prerequisites: [],
      exclusions: [],
      requiredPromptKeys: [],
      requiredSkillKeys: ['skill:test'],
      requiredMcpKeys: [],
      externalSoftware: [],
      humanPermissions: [],
      supportedOperatingSystems: ['Windows'],
      supportedAiPlatforms: ['Codex'],
      supportedDeliveryModes: ['copy-all', 'copy-one-by-one', 'browser-plugin'],
      riskLevel: 'low',
      maturity: 'stable',
      maintainer: 'Format Flow',
      rules: []
    },
    applicabilityTests: [],
    changeLog: [{ version: '1.0.0', publishedAt: '2026-01-01T00:00:00.000Z', summary: '初版' }],
    nodes: [
      {
        id: 'skill-s01',
        nodeKey: 'skill-s01',
        type: 'skill',
        title: 'S01',
        summary: '',
        tags: [],
        inputs: {},
        outputs: ['draft.md'],
        requiresReview: false,
        stageKey: 'draft',
        order: 1,
        resourceRef: {
          resourceKey: 'skill:test',
          type: 'skill',
          expectedVersion: '1',
          fingerprint: 'abc',
          locator: 'skills/test/SKILL.md'
        },
        applicabilityRules: [],
        position: { x: 0, y: 0 }
      },
      {
        id: 'review-s01',
        nodeKey: 'review-s01',
        type: 'review',
        title: '审查 S01',
        summary: '',
        tags: [],
        inputs: {},
        outputs: [],
        requiresReview: true,
        stageKey: 'draft',
        order: 2,
        applicabilityRules: [],
        reviewChecklist: [
          { key: 'complete', label: '交付物完整', required: true },
          { key: 'style', label: '格式合适', required: false }
        ],
        checkpointKey: 'skill-reviewed',
        position: { x: 240, y: 0 }
      }
    ],
    edges: [{ id: 'e1', source: 'skill-s01', target: 'review-s01' }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

describe('workflow v3 applicability', () => {
  it('evaluates only the fixed declarative operators', () => {
    const fields = { research: { kind: '实验', sampleSize: 32 }, software: ['Zotero', 'Word'] }
    expect(evaluateCondition({ kind: 'predicate', field: 'research.kind', operator: 'equals', value: '实验' }, fields)).toBe(true)
    expect(evaluateCondition({ kind: 'predicate', field: 'research.sampleSize', operator: 'range', min: 20, max: 40 }, fields)).toBe(true)
    expect(evaluateCondition({ kind: 'predicate', field: 'software', operator: 'contains', value: 'Zotero' }, fields)).toBe(true)
    expect(
      evaluateCondition(
        {
          kind: 'all',
          conditions: [
            { kind: 'predicate', field: 'research.kind', operator: 'equals', value: '实验' },
            { kind: 'not', condition: { kind: 'predicate', field: 'research.sampleSize', operator: 'lt', value: 10 } }
          ]
        },
        fields
      )
    ).toBe(true)
  })

  it('stores the matched rule version, snapshot and reason deterministically', () => {
    const decision = evaluateRules(
      [
        {
          id: 'needs-approval',
          version: 3,
          priority: 50,
          outcome: 'review',
          reason: '需要人工确认授权。',
          condition: { kind: 'predicate', field: 'authorized', operator: 'equals', value: false },
          enabled: true
        }
      ],
      { authorized: false }
    )
    expect(decision).toMatchObject({ outcome: 'review', ruleId: 'needs-approval', ruleVersion: 3, reason: '需要人工确认授权。' })
    expect(decision.inputSnapshot).toEqual({ authorized: false })
  })
})

describe('workflow v3 execution', () => {
  it('autosaves a project without an applicability gate and preserves its identity on edit', () => {
    const workflow = makeWorkflow()
    const draft = createProjectFlowState(workflow, 'p-auto', '自动保存项目', { topic: '' })
    expect(draft.status).toBe('active')
    expect(draft.nodeStates['skill-s01'].status).toBe('ready')

    const ready = updateProjectSetup(workflow, draft, 'p-auto', '自动保存项目', { topic: '测试' })
    expect(ready.id).toBe(draft.id)
    expect(ready.createdAt).toBe(draft.createdAt)
    expect(ready.resourceLocks).toEqual(draft.resourceLocks)
    expect(ready.status).toBe('active')
    expect(ready.currentNodeKey).toBe('skill-s01')
    expect(ready.nodeStates['skill-s01'].status).toBe('ready')
  })

  it('updates project fields without resetting established execution history', () => {
    const workflow = makeWorkflow()
    const delivered = recordDelivery(
      workflow,
      createProjectFlowState(workflow, 'p-progress', '进行中项目', { topic: '原主题' }),
      'copy-all',
      '$test',
      []
    )
    const updated = updateProjectSetup(workflow, delivered, 'p-progress', '进行中项目（已更新）', { topic: '新主题' })

    expect(updated.projectFields.topic).toBe('新主题')
    expect(updated.projectTitle).toBe('进行中项目（已更新）')
    expect(updated.deliveryRecords).toEqual(delivered.deliveryRecords)
    expect(updated.currentNodeKey).toBe('review-s01')
  })

  it('locks resources when a project is first autosaved and advances delivery to Review', () => {
    const workflow = makeWorkflow()
    const project = createProjectFlowState(workflow, 'p1', '项目一', { topic: '测试' })
    expect(project.currentNodeKey).toBe('skill-s01')
    expect(project.resourceLocks['skill:test'].fingerprint).toBe('abc')

    const delivered = recordDelivery(workflow, project, 'copy-all', '$test', ['input.docx'])
    expect(delivered.currentNodeKey).toBe('review-s01')
    expect(delivered.deliveryRecords).toHaveLength(1)
  })

  it('writes a checkpoint directly after a Skill when the blueprint targets that node', () => {
    const workflow = makeWorkflow()
    workflow.checkpointBlueprint = [{ checkpointKey: 'skill-complete', title: 'Skill 完成', afterNodeKey: 'skill-s01', requiredArtifacts: ['draft.md'] }]
    const delivered = recordDelivery(
      workflow,
      createProjectFlowState(workflow, 'p-skill-checkpoint', 'Skill 检查点项目', { topic: '测试' }),
      'copy-all',
      '$test',
      []
    )
    expect(delivered.checkpoints).toHaveLength(1)
    expect(delivered.checkpoints[0]).toMatchObject({ checkpointKey: 'skill-complete', nodeKey: 'skill-s01' })
    expect(delivered.checkpoints[0].deliveryRecordIds).toEqual([delivered.deliveryRecords[0].id])
  })

  it('keeps an immutable failed Review attempt, requires a reason and stays on the Review', () => {
    const workflow = makeWorkflow()
    const project = recordDelivery(
      workflow,
      createProjectFlowState(workflow, 'p1', '项目一', { topic: '测试' }),
      'copy-all',
      '$test',
      []
    )
    const missingReason = submitReview(workflow, project, { complete: false }, '')
    expect(missingReason.error).toContain('更改原因')
    expect(missingReason.state.reviewAttempts).toHaveLength(0)

    const rejected = submitReview(workflow, project, { complete: false, style: true }, '补齐交付物', ['C:\\projects\\修改说明.docx', 'C:\\projects\\补充数据.xlsx'])
    expect(rejected.passed).toBe(false)
    expect(rejected.state.currentNodeKey).toBe('review-s01')
    expect(rejected.state.reviewAttempts[0]).toMatchObject({ attempt: 1, passed: false, changeReason: '补齐交付物' })
    expect(rejected.state.reviewAttempts[0].checklist).toEqual({ complete: false, style: true })
    expect(rejected.state.reviewAttempts[0].attachmentPaths).toEqual(['C:\\projects\\修改说明.docx', 'C:\\projects\\补充数据.xlsx'])
  })

  it('passes Review only when required items pass, writes a checkpoint and completes', () => {
    const workflow = makeWorkflow()
    const project = recordDelivery(
      workflow,
      createProjectFlowState(workflow, 'p1', '项目一', { topic: '测试' }),
      'copy-all',
      '$test',
      []
    )
    const accepted = submitReview(workflow, project, { [REVIEW_OUTPUT_CONFIRMATION_KEY]: true }, '不会保存的原因', ['C:\\projects\\不会保存.docx'])
    expect(accepted.passed).toBe(true)
    expect(accepted.state.status).toBe('completed')
    expect(accepted.state.checkpoints).toHaveLength(1)
    expect(accepted.state.reviewAttempts[0].checklist).toEqual({ [REVIEW_OUTPUT_CONFIRMATION_KEY]: true })
    expect(accepted.state.reviewAttempts[0].changeReason).toBe('')
    expect(accepted.state.reviewAttempts[0].attachmentPaths).toEqual([])
  })

  it('isolates form values, progress and resource locks for projects using the same template', () => {
    const workflow = makeWorkflow()
    const first = createProjectFlowState(workflow, 'p1', '项目一', { topic: '甲' })
    const second = createProjectFlowState(workflow, 'p2', '项目二', { topic: '乙' })
    const progressed = recordDelivery(workflow, first, 'copy-all', '$test', [])

    expect(progressed.currentNodeKey).toBe('review-s01')
    expect(second.currentNodeKey).toBe('skill-s01')
    expect(second.projectFields.topic).toBe('乙')
    expect(second.deliveryRecords).toHaveLength(0)
    const { lockedAt: firstLockedAt, ...firstResourceLock } = first.resourceLocks['skill:test']
    const { lockedAt: secondLockedAt, ...secondResourceLock } = second.resourceLocks['skill:test']
    expect(secondResourceLock).toEqual(firstResourceLock)
    expect(firstLockedAt).toBeTruthy()
    expect(secondLockedAt).toBeTruthy()

    const changedTemplate = makeWorkflow()
    changedTemplate.nodes[0].resourceRef = { ...changedTemplate.nodes[0].resourceRef!, fingerprint: 'new-fingerprint' }
    expect(first.resourceLocks['skill:test'].fingerprint).toBe('abc')
    expect(changedTemplate.nodes[0].resourceRef.fingerprint).toBe('new-fingerprint')
  })
})

describe('workflow v3 maintenance', () => {
  it('validates contracts and previews a stable path', () => {
    const workflow = makeWorkflow()
    expect(validateWorkflow(workflow).filter((issue) => issue.severity === 'error')).toEqual([])
    expect(previewWorkflowPath(workflow, { topic: '测试' }).steps.map((step) => step.nodeKey)).toEqual([
      'skill-s01',
      'review-s01'
    ])
  })

  it('does not permit a project migration when a used node is removed without a mapping', () => {
    const from = makeWorkflow()
    const state = createProjectFlowState(from, 'p1', '项目一', { topic: '测试' })
    const to = { ...makeWorkflow(), id: 'workflow-a-v2', templateVersion: '2.0.0', nodes: makeWorkflow().nodes.slice(1) }
    const blocked = previewProjectMigration(state, from, to, {})
    expect(blocked.canMigrate).toBe(false)
    expect(blocked.unmappedNodeKeys).toContain('skill-s01')
    const mapped = previewProjectMigration(state, from, to, { 'skill-s01': 'review-s01' })
    expect(mapped.canMigrate).toBe(true)
  })
})
