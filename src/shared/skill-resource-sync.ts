import { newId, nowIso } from './domain'
import type { AppStore, ResourceReference, ResourceVersion, SkillItem, WorkflowNode } from './types'

export function workflowNodeReferencesSkill(node: WorkflowNode, skill: SkillItem): boolean {
  if (node.type !== 'skill') return false
  if (node.refId === skill.id || node.skillRefId === skill.id) return true

  const reference = node.resourceRef
  if (!reference || reference.type !== 'skill') return false
  const resourceName = reference.resourceKey.replace(/^skill:/i, '')
  const locator = reference.locator || ''
  return lookupKey(resourceName) === lookupKey(skill.name) || pathKey(locator) === pathKey(skill.path)
}

export function appendWorkflowSkillSnapshots(
  store: AppStore,
  skill: SkillItem,
  previousContent: string
): ResourceVersion[] {
  const references = store.workflows.flatMap((workflow) =>
    workflow.nodes
      .filter((node) => workflowNodeReferencesSkill(node, skill))
      .map((node) => node.resourceRef)
      .filter((reference): reference is ResourceReference => Boolean(reference))
  )
  if (references.length === 0) return store.resourceVersions

  const known = new Set(store.resourceVersions.map((version) => resourceVersionKey(version.resourceKey, version.fingerprint)))
  const additions: ResourceVersion[] = []
  for (const reference of references) {
    if (!reference.fingerprint || reference.fingerprint === 'unbound') continue
    const key = resourceVersionKey(reference.resourceKey, reference.fingerprint)
    if (known.has(key)) continue
    known.add(key)
    additions.push({
      id: newId('resource-version'),
      resourceKey: reference.resourceKey,
      type: 'skill',
      version: reference.expectedVersion,
      fingerprint: reference.fingerprint,
      locator: reference.locator || skill.path,
      metadata: {
        source: 'shared-skill-editor',
        skillId: skill.id,
        skillName: skill.name
      },
      contentSnapshot: previousContent,
      createdAt: nowIso()
    })
  }
  return additions.length > 0 ? [...store.resourceVersions, ...additions] : store.resourceVersions
}

export function skillResourceMatchesReference(reference: ResourceReference, skill: SkillItem): boolean {
  return Boolean(
    reference.fingerprint &&
    reference.fingerprint !== 'unbound' &&
    skill.contentFingerprint &&
    reference.fingerprint.toLowerCase() === skill.contentFingerprint.toLowerCase()
  )
}

function resourceVersionKey(resourceKey: string, fingerprint: string): string {
  return `${lookupKey(resourceKey)}:${fingerprint.toLowerCase()}`
}

function lookupKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function pathKey(value: string): string {
  return lookupKey(value).replace(/\\/g, '/')
}
