import type { GroupItem, SkillItem, SkillMetadata, Workflow, WorkflowNode } from './types'

export const WORKFLOW_SKILL_ROOT_ID = 'virtual-workflow-skills'
export const WORKFLOW_SKILL_ROOT_TAG = '__workflow-skills__'
export const WORKFLOW_SKILL_TAG_PREFIX = '__workflow-skill__:'

export type WorkflowSkillMembership = {
  workflowId: string
  workflowTitle: string
  workflowVersion: string
  groupTag: string
  skillId: string
  nodeId: string
  nodeKey: string
  nodeTitle: string
  nodeOrder: number
  skillSequence: number
}

export type WorkflowSkillGrouping = {
  root: GroupItem | null
  membershipsByTag: Map<string, WorkflowSkillMembership[]>
}

export function isWorkflowSkillGroupTag(tag: string): boolean {
  return tag === WORKFLOW_SKILL_ROOT_TAG || tag.startsWith(WORKFLOW_SKILL_TAG_PREFIX)
}

export function buildWorkflowSkillGrouping(workflows: Workflow[], skills: SkillItem[]): WorkflowSkillGrouping {
  if (workflows.length === 0) return { root: null, membershipsByTag: new Map() }

  const skillLookup = buildSkillLookup(skills)

  const membershipsByTag = new Map<string, WorkflowSkillMembership[]>()
  const children = workflows.map<GroupItem>((workflow) => {
    const groupTag = `${WORKFLOW_SKILL_TAG_PREFIX}${encodeURIComponent(workflow.id)}`
    const title = workflow.title.trim() || '未命名工作流'
    const memberships: WorkflowSkillMembership[] = []
    const seenSkillIds = new Set<string>()
    let skillSequence = 0

    for (const node of stableNodeOrder(workflow.nodes)) {
      if (node.type !== 'skill') continue
      skillSequence += 1
      const skill = resolveWorkflowSkill(node, skillLookup)
      if (!skill || seenSkillIds.has(skill.id)) continue
      seenSkillIds.add(skill.id)
      memberships.push({
        workflowId: workflow.id,
        workflowTitle: title,
        workflowVersion: workflow.templateVersion,
        groupTag,
        skillId: skill.id,
        nodeId: node.id,
        nodeKey: node.nodeKey,
        nodeTitle: node.title,
        nodeOrder: node.order,
        skillSequence
      })
    }

    membershipsByTag.set(groupTag, memberships)
    return {
      id: `virtual-workflow-skill-${workflow.id}`,
      name: title,
      tag: groupTag,
      children: []
    }
  })

  const rootMemberships: WorkflowSkillMembership[] = []
  const rootSkillIds = new Set<string>()
  for (const child of children) {
    for (const membership of membershipsByTag.get(child.tag) || []) {
      if (rootSkillIds.has(membership.skillId)) continue
      rootSkillIds.add(membership.skillId)
      rootMemberships.push(membership)
    }
  }
  membershipsByTag.set(WORKFLOW_SKILL_ROOT_TAG, rootMemberships)

  return {
    root: {
      id: WORKFLOW_SKILL_ROOT_ID,
      name: '工作流 Skill',
      tag: WORKFLOW_SKILL_ROOT_TAG,
      children
    },
    membershipsByTag
  }
}

/**
 * Workflow-bound Skills live in the virtual “工作流 Skill” tree by default.
 * Only tags explicitly assigned by the user may place them in another Skill group;
 * inferred tags remain on the stored Skill and are suppressed only for presentation.
 */
export function skillItemsForGroupPresentation(
  skills: SkillItem[],
  grouping: WorkflowSkillGrouping,
  skillIndex: Record<string, SkillMetadata>
): SkillItem[] {
  const workflowSkillIds = new Set(
    (grouping.membershipsByTag.get(WORKFLOW_SKILL_ROOT_TAG) || []).map((membership) => membership.skillId)
  )
  return skills.map((skill) => {
    if (!workflowSkillIds.has(skill.id)) return skill
    const explicitTags = Array.from(new Set(
      (skillIndex[skill.id]?.assignedTags || [])
        .map((tag) => tag.trim())
        .filter((tag) => tag && !isWorkflowSkillGroupTag(tag))
    ))
    return { ...skill, tags: explicitTags }
  })
}

export function isWorkflowBoundSkill(skillId: string, grouping: WorkflowSkillGrouping): boolean {
  return (grouping.membershipsByTag.get(WORKFLOW_SKILL_ROOT_TAG) || [])
    .some((membership) => membership.skillId === skillId)
}

type SkillLookup = {
  byId: Map<string, SkillItem>
  byName: Map<string, SkillItem>
  byPath: Map<string, SkillItem>
  byTitle: Map<string, SkillItem | null>
}

function buildSkillLookup(skills: SkillItem[]): SkillLookup {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const byName = new Map(skills.map((skill) => [lookupKey(skill.name), skill]))
  const byPath = new Map(skills.map((skill) => [pathKey(skill.path), skill]))
  const byTitle = new Map<string, SkillItem | null>()
  for (const skill of skills) {
    const key = lookupKey(skill.title)
    if (!key) continue
    byTitle.set(key, byTitle.has(key) ? null : skill)
  }
  return { byId, byName, byPath, byTitle }
}

function resolveWorkflowSkill(node: WorkflowNode, lookup: SkillLookup): SkillItem | undefined {
  const directId = node.refId || node.skillRefId
  if (directId && lookup.byId.has(directId)) return lookup.byId.get(directId)

  const resourceKey = node.resourceRef?.resourceKey || ''
  const resourceName = resourceKey.replace(/^skill:/i, '')
  if (resourceName && lookup.byName.has(lookupKey(resourceName))) return lookup.byName.get(lookupKey(resourceName))

  const locator = node.resourceRef?.locator || ''
  if (locator && lookup.byPath.has(pathKey(locator))) return lookup.byPath.get(pathKey(locator))
  if (locator && lookup.byName.has(lookupKey(locator))) return lookup.byName.get(lookupKey(locator))

  return lookup.byTitle.get(lookupKey(node.title)) || undefined
}

function stableNodeOrder(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((left, right) => left.node.order - right.node.order || left.index - right.index)
    .map(({ node }) => node)
}

function lookupKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function pathKey(value: string): string {
  return lookupKey(value).replace(/\\/g, '/')
}
