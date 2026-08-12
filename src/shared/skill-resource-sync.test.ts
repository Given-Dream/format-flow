import { describe, expect, it } from 'vitest'
import { createWorkflow, defaultStore } from './domain'
import {
  appendWorkflowSkillSnapshots,
  skillResourceMatchesReference,
  workflowNodeReferencesSkill
} from './skill-resource-sync'
import type { ResourceReference, SkillItem, WorkflowNode } from './types'

describe('shared workflow Skill editing', () => {
  const skill = createSkill()
  const reference: ResourceReference = {
    resourceKey: 'skill:shared-skill',
    type: 'skill',
    expectedVersion: 'sha256',
    fingerprint: 'old-fingerprint',
    locator: skill.path
  }
  const node = createSkillNode(reference)

  it('resolves the workflow node to the same canonical Skill', () => {
    expect(workflowNodeReferencesSkill(node, skill)).toBe(true)
    expect(workflowNodeReferencesSkill({ ...node, refId: skill.id, resourceRef: undefined }, skill)).toBe(true)
  })

  it('stores one immutable old-content snapshot before either editor overwrites SKILL.md', () => {
    const workflow = createWorkflow({ id: 'workflow-shared-skill', nodes: [node] })
    const store = { ...defaultStore(), workflows: [workflow], resourceVersions: [] }

    const first = appendWorkflowSkillSnapshots(store, skill, '# old content')
    const second = appendWorkflowSkillSnapshots({ ...store, resourceVersions: first }, skill, '# old content')

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      resourceKey: reference.resourceKey,
      fingerprint: reference.fingerprint,
      contentSnapshot: '# old content',
      metadata: { source: 'shared-skill-editor', skillId: skill.id }
    })
    expect(second).toBe(first)
  })

  it('detects whether a workflow still locks the current local Skill content', () => {
    expect(skillResourceMatchesReference(reference, { ...skill, contentFingerprint: 'old-fingerprint' })).toBe(true)
    expect(skillResourceMatchesReference(reference, { ...skill, contentFingerprint: 'new-fingerprint' })).toBe(false)
  })
})

function createSkill(): SkillItem {
  return {
    id: 'skill-shared',
    name: 'shared-skill',
    title: '共享 Skill',
    summary: '',
    tags: [],
    variables: [],
    favorite: false,
    path: 'C:\\skills\\shared-skill\\SKILL.md',
    source: 'custom',
    contentPreview: '# old content',
    contentFingerprint: 'old-fingerprint',
    updatedAt: '2026-08-11T00:00:00.000Z'
  }
}

function createSkillNode(resourceRef: ResourceReference): WorkflowNode {
  return {
    id: 'node-shared-skill',
    nodeKey: 's01-skill',
    type: 'skill',
    refId: 'skill-shared',
    title: '共享 Skill',
    summary: '',
    tags: [],
    inputs: {},
    outputs: [],
    requiresReview: false,
    stageKey: 'main',
    order: 1,
    resourceRef,
    applicabilityRules: [],
    position: { x: 0, y: 0 }
  }
}
