import { describe, expect, it } from 'vitest'
import type { SkillItem, Workflow, WorkflowNode } from './types'
import {
  buildWorkflowSkillGrouping,
  isWorkflowBoundSkill,
  isWorkflowSkillGroupTag,
  skillItemsForGroupPresentation,
  WORKFLOW_SKILL_ROOT_TAG
} from './workflow-skill-groups'

describe('workflow Skill grouping', () => {
  const alpha = skill('skill-alpha', 'alpha')
  const beta = skill('skill-beta', 'beta')
  const gamma = skill('skill-gamma', 'gamma')

  it('creates one workflow subgroup and preserves Skill node order', () => {
    const workflow = workflowWithNodes('workflow-a', '研究流程 A', '1.0.0', [
      skillNode('node-beta', 's02-skill', 20, beta),
      reviewNode('review-alpha', 15),
      skillNode('node-alpha', 's01-skill', 10, alpha)
    ])

    const grouping = buildWorkflowSkillGrouping([workflow], [alpha, beta])
    const child = grouping.root?.children[0]
    const memberships = grouping.membershipsByTag.get(child!.tag)

    expect(grouping.root?.name).toBe('工作流 Skill')
    expect(child?.name).toBe('研究流程 A')
    expect(memberships?.map((item) => item.skillId)).toEqual([alpha.id, beta.id])
    expect(memberships?.map((item) => item.skillSequence)).toEqual([1, 2])
    expect(isWorkflowSkillGroupTag(child!.tag)).toBe(true)
    expect(isWorkflowBoundSkill(alpha.id, grouping)).toBe(true)
    expect(isWorkflowBoundSkill('not-linked', grouping)).toBe(false)
  })

  it('lets a shared Skill appear in multiple workflow subgroups without changing its tags', () => {
    const first = workflowWithNodes('workflow-a', '流程 A', '1.0.0', [
      skillNode('node-alpha', 's01-skill', 1, alpha),
      skillNode('node-beta', 's02-skill', 2, beta)
    ])
    const second = workflowWithNodes('workflow-b', '流程 B', '1.0.0', [
      skillNode('node-gamma', 's01-skill', 1, gamma),
      skillNode('node-alpha-again', 's02-skill', 2, alpha)
    ])

    const grouping = buildWorkflowSkillGrouping([first, second], [alpha, beta, gamma])
    const [firstGroup, secondGroup] = grouping.root!.children

    expect(grouping.membershipsByTag.get(firstGroup.tag)?.map((item) => item.skillId)).toEqual([alpha.id, beta.id])
    expect(grouping.membershipsByTag.get(secondGroup.tag)?.map((item) => item.skillId)).toEqual([gamma.id, alpha.id])
    expect(grouping.membershipsByTag.get(WORKFLOW_SKILL_ROOT_TAG)?.map((item) => item.skillId)).toEqual([
      alpha.id,
      beta.id,
      gamma.id
    ])
    expect(alpha.tags).toEqual(['原始标签'])
  })

  it('resolves unbound workflow nodes by resource key and distinguishes duplicate workflow names by version', () => {
    const first = workflowWithNodes('workflow-a', '同名流程', '1.0.0', [
      skillNode('node-alpha', 's01-skill', 1, undefined, 'skill:alpha')
    ])
    const second = workflowWithNodes('workflow-b', '同名流程', '2.0.0', [
      skillNode('node-beta', 's01-skill', 1, undefined, 'skill:beta')
    ])

    const grouping = buildWorkflowSkillGrouping([first, second], [alpha, beta])

    expect(grouping.root?.children.map((group) => group.name)).toEqual(['同名流程', '同名流程'])
    expect(grouping.membershipsByTag.get(grouping.root!.children[0].tag)?.[0].skillId).toBe(alpha.id)
  })

  it('shows repeated Skill nodes once at their earliest position', () => {
    const workflow = workflowWithNodes('workflow-a', '重复节点流程', '1.0.0', [
      skillNode('node-alpha-1', 's01-skill', 1, alpha),
      skillNode('node-beta', 's02-skill', 2, beta),
      skillNode('node-alpha-2', 's03-skill', 3, alpha)
    ])

    const grouping = buildWorkflowSkillGrouping([workflow], [alpha, beta])
    const memberships = grouping.membershipsByTag.get(grouping.root!.children[0].tag)

    expect(memberships?.map((item) => item.skillId)).toEqual([alpha.id, beta.id])
    expect(memberships?.map((item) => item.nodeKey)).toEqual(['s01-skill', 's02-skill'])
  })

  it('suppresses inferred groups for workflow Skills but keeps explicit user assignments', () => {
    const workflow = workflowWithNodes('workflow-a', '研究流程 A', '1.0.0', [
      skillNode('node-alpha', 's01-skill', 1, alpha)
    ])
    const grouping = buildWorkflowSkillGrouping([workflow], [alpha, gamma])
    const withoutAssignment = skillItemsForGroupPresentation([alpha, gamma], grouping, {})
    const withAssignment = skillItemsForGroupPresentation([alpha, gamma], grouping, {
      [alpha.id]: { tags: ['原始标签', '用户分组'], assignedTags: ['用户分组'] }
    })

    expect(withoutAssignment.find((item) => item.id === alpha.id)?.tags).toEqual([])
    expect(withoutAssignment.find((item) => item.id === gamma.id)?.tags).toEqual(['原始标签'])
    expect(withAssignment.find((item) => item.id === alpha.id)?.tags).toEqual(['用户分组'])
    expect(alpha.tags).toEqual(['原始标签'])
  })
})

function skill(id: string, name: string): SkillItem {
  return {
    id,
    name,
    title: name.toUpperCase(),
    summary: `${name} summary`,
    tags: ['原始标签'],
    variables: [],
    favorite: false,
    path: `C:\\skills\\${name}`,
    source: 'custom',
    contentPreview: `# ${name}`,
    updatedAt: '2026-08-11T00:00:00.000Z'
  }
}

function skillNode(
  id: string,
  nodeKey: string,
  order: number,
  linkedSkill?: SkillItem,
  resourceKey?: string
): WorkflowNode {
  return {
    id,
    nodeKey,
    type: 'skill',
    refId: linkedSkill?.id,
    title: linkedSkill?.title || resourceKey?.replace(/^skill:/, '') || nodeKey,
    summary: '',
    tags: [],
    inputs: {},
    outputs: [],
    requiresReview: false,
    stageKey: 'stage-1',
    order,
    resourceRef: resourceKey
      ? { resourceKey, type: 'skill', expectedVersion: 'unbound', fingerprint: 'unbound', locator: resourceKey.replace(/^skill:/, '') }
      : undefined,
    applicabilityRules: [],
    position: { x: 0, y: 0 }
  }
}

function reviewNode(id: string, order: number): WorkflowNode {
  return {
    id,
    nodeKey: id,
    type: 'review',
    title: id,
    summary: '',
    tags: [],
    inputs: {},
    outputs: [],
    requiresReview: true,
    stageKey: 'stage-1',
    order,
    applicabilityRules: [],
    position: { x: 0, y: 0 }
  }
}

function workflowWithNodes(id: string, title: string, templateVersion: string, nodes: WorkflowNode[]): Workflow {
  return {
    id,
    templateKey: id,
    templateVersion,
    status: 'published',
    family: 'custom',
    title,
    description: '',
    tags: [],
    variables: [],
    favorite: false,
    formSchema: [],
    stages: [{ stageKey: 'stage-1', title: '阶段 1', description: '', order: 1 }],
    checkpointBlueprint: [],
    applicability: {
      researchTypes: [],
      scenarios: [],
      targetArtifacts: [],
      requiredInputs: [],
      optionalInputs: [],
      prerequisites: [],
      exclusions: [],
      requiredPromptKeys: [],
      requiredSkillKeys: [],
      requiredMcpKeys: [],
      externalSoftware: [],
      humanPermissions: [],
      supportedOperatingSystems: [],
      supportedAiPlatforms: [],
      supportedDeliveryModes: [],
      riskLevel: 'low',
      maturity: 'stable',
      maintainer: '',
      rules: []
    },
    applicabilityTests: [],
    changeLog: [],
    nodes,
    edges: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z'
  }
}
