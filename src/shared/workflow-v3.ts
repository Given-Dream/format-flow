import type {
  ApplicabilityCondition,
  ApplicabilityDecision,
  ApplicabilityOutcome,
  ApplicabilityRule,
  DeliveryMode,
  DeliveryRecord,
  ProjectFlowState,
  ReviewAttempt,
  Workflow,
  WorkflowNode
} from './types'
import { newId, nowIso } from './domain'

export const REVIEW_OUTPUT_CONFIRMATION_KEY = 'output-outline-confirmed'

export type WorkflowValidationIssue = {
  severity: 'error' | 'warning'
  code: string
  message: string
  nodeKey?: string
}

export type WorkflowPathStep = {
  nodeKey: string
  title: string
  outcome: ApplicabilityOutcome
  reason: string
}

export type WorkflowPathPreview = {
  status: 'completed' | 'blocked' | 'not-recommended' | 'waiting' | 'invalid'
  steps: WorkflowPathStep[]
  issues: WorkflowValidationIssue[]
}

export type WorkflowTemplateDiff = {
  fromVersion: string
  toVersion: string
  addedNodeKeys: string[]
  removedNodeKeys: string[]
  renamedNodeKeys: string[]
  changedNodeKeys: string[]
  addedCheckpointKeys: string[]
  removedCheckpointKeys: string[]
  compatible: boolean
}

export type ProjectMigrationPreview = WorkflowTemplateDiff & {
  projectId: string
  migrationMap: Record<string, string>
  unmappedNodeKeys: string[]
  canMigrate: boolean
}

const outcomeStatus: Record<ApplicabilityOutcome, ApplicabilityDecision['status']> = {
  enable: 'highly-applicable',
  route: 'highly-applicable',
  review: 'conditionally-applicable',
  skip: 'not-recommended',
  block: 'blocked'
}

export function readProjectField(fields: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((value, key) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
      return (value as Record<string, unknown>)[key]
    }, fields)
}

export function evaluateCondition(condition: ApplicabilityCondition, fields: Record<string, unknown>): boolean {
  if (condition.kind === 'all') return condition.conditions.every((item) => evaluateCondition(item, fields))
  if (condition.kind === 'any') return condition.conditions.some((item) => evaluateCondition(item, fields))
  if (condition.kind === 'not') return !evaluateCondition(condition.condition, fields)

  const actual = readProjectField(fields, condition.field)
  const expected = condition.value
  switch (condition.operator) {
    case 'equals':
      return comparable(actual) === comparable(expected)
    case 'notEquals':
      return comparable(actual) !== comparable(expected)
    case 'contains':
      return contains(actual, expected)
    case 'notContains':
      return !contains(actual, expected)
    case 'in':
      return Array.isArray(expected) && expected.some((item) => comparable(item) === comparable(actual))
    case 'exists':
      return expected === false ? isMissing(actual) : !isMissing(actual)
    case 'gt':
      return asNumber(actual) > asNumber(expected)
    case 'gte':
      return asNumber(actual) >= asNumber(expected)
    case 'lt':
      return asNumber(actual) < asNumber(expected)
    case 'lte':
      return asNumber(actual) <= asNumber(expected)
    case 'range': {
      const value = asNumber(actual)
      return Number.isFinite(value) && value >= (condition.min ?? -Infinity) && value <= (condition.max ?? Infinity)
    }
  }
}

function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => comparable(item) === comparable(expected))
  if (typeof actual === 'string') return actual.includes(String(expected ?? ''))
  return false
}

function comparable(value: unknown): string {
  if (typeof value === 'string') return value.trim().toLocaleLowerCase()
  if (value === null || value === undefined) return String(value)
  return JSON.stringify(value)
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim()) return Number(value)
  return Number.NaN
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

export function evaluateRules(
  rules: ApplicabilityRule[],
  fields: Record<string, unknown>,
  fallback: Pick<ApplicabilityDecision, 'outcome' | 'reason'> = {
    outcome: 'enable',
    reason: '未命中限制规则，允许执行。'
  }
): ApplicabilityDecision {
  const matched = [...rules]
    .filter((rule) => rule.enabled)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .find((rule) => evaluateCondition(rule.condition, fields))
  const inputSnapshot = structuredCloneSafe(fields)
  if (!matched) {
    return {
      ...fallback,
      status: outcomeStatus[fallback.outcome],
      evaluatedAt: nowIso(),
      inputSnapshot
    }
  }
  return {
    status: outcomeStatus[matched.outcome],
    outcome: matched.outcome,
    reason: matched.reason,
    ruleId: matched.id,
    ruleVersion: matched.version,
    routeTargetNodeKey: matched.routeTargetNodeKey,
    evaluatedAt: nowIso(),
    inputSnapshot
  }
}

export function evaluateWorkflowApplicability(
  workflow: Workflow,
  fields: Record<string, unknown>
): ApplicabilityDecision {
  const missingRequired = workflow.formSchema
    .filter((field) => field.required && isMissing(readProjectField(fields, field.key)))
    .map((field) => field.label)
  if (missingRequired.length > 0) {
    return {
      status: 'blocked',
      outcome: 'block',
      reason: `前置条件不足：缺少 ${missingRequired.join('、')}。`,
      evaluatedAt: nowIso(),
      inputSnapshot: structuredCloneSafe(fields)
    }
  }
  return evaluateRules(workflow.applicability.rules, fields)
}

export function evaluateNodeApplicability(
  node: WorkflowNode,
  fields: Record<string, unknown>
): ApplicabilityDecision {
  return evaluateRules(node.applicabilityRules, fields)
}

export function validateWorkflow(workflow: Workflow): WorkflowValidationIssue[] {
  const issues: WorkflowValidationIssue[] = []
  const keys = new Set<string>()
  const ids = new Set(workflow.nodes.map((node) => node.id))
  const nodeKeys = new Set(workflow.nodes.map((node) => node.nodeKey))
  const stageKeys = new Set(workflow.stages.map((stage) => stage.stageKey))

  for (const node of workflow.nodes) {
    if (!node.nodeKey.trim()) issues.push(error('missing-node-key', '节点缺少稳定 nodeKey。', node.nodeKey))
    if (keys.has(node.nodeKey)) issues.push(error('duplicate-node-key', `重复 nodeKey：${node.nodeKey}`, node.nodeKey))
    keys.add(node.nodeKey)
    if (!stageKeys.has(node.stageKey)) issues.push(error('missing-stage', `节点引用了不存在的阶段：${node.stageKey}`, node.nodeKey))
    if (['prompt', 'skill', 'mcp'].includes(node.type) && !node.resourceRef) {
      issues.push(error('missing-resource', '资源节点没有声明资源引用。', node.nodeKey))
    }
    if (node.resourceRef?.fingerprint === 'unbound') {
      issues.push(warning('unbound-resource', `资源尚未绑定内容指纹：${node.resourceRef.resourceKey}`, node.nodeKey))
    }
    for (const rule of node.applicabilityRules) {
      if (rule.outcome === 'route' && (!rule.routeTargetNodeKey || !nodeKeys.has(rule.routeTargetNodeKey))) {
        issues.push(error('invalid-route', `规则 ${rule.id} 的路由目标无效。`, node.nodeKey))
      }
    }
    if (node.type === 'review' && !(node.reviewChecklist || []).some((item) => item.required)) {
      issues.push(warning('review-without-required-item', 'Review 没有必填审查项。', node.nodeKey))
    }
  }

  for (const edge of workflow.edges) {
    const sourceValid = ids.has(edge.source) || nodeKeys.has(edge.source)
    const targetValid = ids.has(edge.target) || nodeKeys.has(edge.target)
    if (!sourceValid || !targetValid) issues.push(error('broken-edge', `断裂边：${edge.source} → ${edge.target}`))
  }

  if (workflow.nodes.length > 0) {
    const nodesWithOutgoing = new Set(workflow.edges.map((edge) => resolveNode(workflow, edge.source)?.nodeKey).filter(Boolean))
    const exits = workflow.nodes.filter((node) => !nodesWithOutgoing.has(node.nodeKey))
    if (exits.length === 0) issues.push(error('no-exit', '工作流没有出口节点。'))
  }

  const declaredOutputs = new Set(workflow.nodes.flatMap((node) => node.outputs))
  for (const checkpoint of workflow.checkpointBlueprint) {
    if (!nodeKeys.has(checkpoint.afterNodeKey)) {
      issues.push(error('invalid-checkpoint-node', `检查点 ${checkpoint.checkpointKey} 引用了不存在的节点。`))
    }
    for (const artifact of checkpoint.requiredArtifacts) {
      if (!declaredOutputs.has(artifact)) {
        issues.push(warning('undeclared-artifact', `检查点所需交付物未由节点声明：${artifact}`))
      }
    }
  }
  return issues
}

export function createProjectFlowState(
  workflow: Workflow,
  projectId: string,
  projectTitle: string,
  projectFields: Record<string, unknown>
): ProjectFlowState {
  const timestamp = nowIso()
  const ordered = orderedNodes(workflow)
  const resourceLocks = Object.fromEntries(
    workflow.nodes
      .filter((node) => node.resourceRef)
      .map((node) => [
        node.resourceRef!.resourceKey,
        { ...structuredCloneSafe(node.resourceRef!), lockedAt: timestamp }
      ])
  )
  const state: ProjectFlowState = {
    id: `${projectId}:${workflow.id}:${workflow.templateVersion}`,
    projectId,
    projectTitle,
    workflowId: workflow.id,
    templateKey: workflow.templateKey,
    templateVersion: workflow.templateVersion,
    status: 'active',
    projectFields: structuredCloneSafe(projectFields),
    workflowApplicability: executionReadyDecision(projectFields),
    currentNodeKey: ordered[0]?.nodeKey || '',
    nodeStates: Object.fromEntries(
      ordered.map((node) => [
        node.nodeKey,
        {
          nodeKey: node.nodeKey,
          status: 'pending' as const,
          formValues: {},
          deliveryRecordIds: [],
          reviewAttemptIds: []
        }
      ])
    ),
    deliveryRecords: [],
    reviewAttempts: [],
    checkpoints: [],
    resourceLocks,
    createdAt: timestamp,
    updatedAt: timestamp
  }
  return enterNode(workflow, state, state.currentNodeKey)
}

export function updateProjectSetup(
  workflow: Workflow,
  existing: ProjectFlowState | undefined,
  projectId: string,
  projectTitle: string,
  projectFields: Record<string, unknown>
): ProjectFlowState {
  const refreshed = createProjectFlowState(workflow, projectId, projectTitle, projectFields)
  if (!existing) return refreshed

  const hasExecutionProgress = Boolean(existing.legacyMigration) ||
    existing.deliveryRecords.length > 0 ||
    existing.reviewAttempts.length > 0 ||
    existing.checkpoints.length > 0 ||
    Object.values(existing.nodeStates).some((state) =>
      ['completed', 'passed', 'skipped'].includes(state.status)
    )

  if (!hasExecutionProgress) {
    return {
      ...refreshed,
      id: existing.id,
      resourceLocks: existing.resourceLocks,
      createdAt: existing.createdAt,
      updatedAt: nowIso()
    }
  }

  return {
    ...existing,
    projectTitle,
    projectFields: structuredCloneSafe(projectFields),
    workflowApplicability: executionReadyDecision(projectFields),
    updatedAt: nowIso()
  }
}

export function recordDelivery(
  workflow: Workflow,
  state: ProjectFlowState,
  mode: DeliveryMode,
  text: string,
  attachmentPaths: string[]
): ProjectFlowState {
  const node = nodeByKey(workflow, state.currentNodeKey)
  if (!node || ['review', 'adapter', 'wait', 'route'].includes(node.type)) return state
  const timestamp = nowIso()
  const record: DeliveryRecord = {
    id: newId('delivery'),
    projectId: state.projectId,
    workflowId: state.workflowId,
    templateVersion: state.templateVersion,
    nodeKey: node.nodeKey,
    mode,
    text,
    attachmentPaths: [...attachmentPaths],
    createdAt: timestamp
  }
  const next = structuredCloneSafe(state)
  next.deliveryRecords.push(record)
  next.nodeStates[node.nodeKey].deliveryRecordIds.push(record.id)
  next.nodeStates[node.nodeKey].status = 'completed'
  next.nodeStates[node.nodeKey].completedAt = timestamp
  next.updatedAt = timestamp
  appendCheckpointsAfterNode(workflow, next, node, timestamp, [record.id])
  return advanceFrom(workflow, next, node)
}

export function completeControlNode(workflow: Workflow, state: ProjectFlowState): ProjectFlowState {
  const node = nodeByKey(workflow, state.currentNodeKey)
  if (!node || !['adapter', 'wait', 'route'].includes(node.type)) return state
  const next = structuredCloneSafe(state)
  const timestamp = nowIso()
  next.nodeStates[node.nodeKey].status = 'completed'
  next.nodeStates[node.nodeKey].completedAt = timestamp
  next.updatedAt = timestamp
  appendCheckpointsAfterNode(workflow, next, node, timestamp)
  return advanceFrom(workflow, next, node)
}

export function submitReview(
  workflow: Workflow,
  state: ProjectFlowState,
  checklist: Record<string, boolean>,
  changeReason: string,
  attachmentPaths: string[] = []
): { state: ProjectFlowState; passed: boolean; error?: string } {
  const node = nodeByKey(workflow, state.currentNodeKey)
  if (!node || node.type !== 'review') return { state, passed: false, error: '当前节点不是 Review。' }
  const required = (node.reviewChecklist || []).filter((item) => item.required)
  const passed = checklist[REVIEW_OUTPUT_CONFIRMATION_KEY] === true || required.every((item) => checklist[item.key] === true)
  if (!passed && !changeReason.trim()) return { state, passed: false, error: '审查不通过时必须填写更改原因。' }

  const timestamp = nowIso()
  const next = structuredCloneSafe(state)
  const attempts = next.reviewAttempts.filter((attempt) => attempt.nodeKey === node.nodeKey)
  const previousNode = previousNodeOf(workflow, node)
  const relatedDeliveries = previousNode
    ? next.deliveryRecords.filter((record) => record.nodeKey === previousNode.nodeKey).map((record) => record.id)
    : []
  const attempt: ReviewAttempt = {
    id: newId('review-attempt'),
    projectId: next.projectId,
    workflowId: next.workflowId,
    templateVersion: next.templateVersion,
    nodeKey: node.nodeKey,
    attempt: attempts.length + 1,
    checklist: structuredCloneSafe(checklist),
    passed,
    changeReason: passed ? '' : changeReason.trim(),
    reviewedAt: timestamp,
    deliveryRecordIds: relatedDeliveries,
    attachmentPaths: passed ? [] : structuredCloneSafe(attachmentPaths.filter((filePath) => filePath.trim()))
  }
  next.reviewAttempts.push(attempt)
  next.nodeStates[node.nodeKey].reviewAttemptIds.push(attempt.id)
  next.updatedAt = timestamp

  if (!passed) {
    next.nodeStates[node.nodeKey].status = 'ready'
    return { state: next, passed: false }
  }

  next.nodeStates[node.nodeKey].status = 'passed'
  next.nodeStates[node.nodeKey].completedAt = timestamp
  appendCheckpointsAfterNode(workflow, next, node, timestamp, relatedDeliveries)
  return { state: advanceFrom(workflow, next, node), passed: true }
}

function appendCheckpointsAfterNode(
  workflow: Workflow,
  state: ProjectFlowState,
  node: WorkflowNode,
  timestamp: string,
  fallbackDeliveryIds: string[] = []
): void {
  const blueprints = workflow.checkpointBlueprint.filter((checkpoint) => checkpoint.afterNodeKey === node.nodeKey)
  for (const blueprint of blueprints) {
    if (state.checkpoints.some((checkpoint) => checkpoint.checkpointKey === blueprint.checkpointKey && checkpoint.nodeKey === node.nodeKey)) continue
    const artifactKeys = new Set(blueprint.requiredArtifacts)
    const artifactNodeKeys = artifactKeys.size > 0
      ? workflow.nodes.filter((candidate) => candidate.outputs.some((output) => artifactKeys.has(output))).map((candidate) => candidate.nodeKey)
      : []
    const matchingDeliveryIds = artifactNodeKeys.length > 0
      ? state.deliveryRecords.filter((record) => artifactNodeKeys.includes(record.nodeKey)).map((record) => record.id)
      : []
    state.checkpoints.push({
      checkpointKey: blueprint.checkpointKey,
      nodeKey: node.nodeKey,
      createdAt: timestamp,
      deliveryRecordIds: matchingDeliveryIds.length > 0 ? matchingDeliveryIds : [...fallbackDeliveryIds]
    })
  }
}

export function previewWorkflowPath(workflow: Workflow, projectFields: Record<string, unknown>): WorkflowPathPreview {
  const issues = validateWorkflow(workflow)
  if (issues.some((issue) => issue.severity === 'error')) return { status: 'invalid', steps: [], issues }
  const workflowDecision = evaluateWorkflowApplicability(workflow, projectFields)
  if (workflowDecision.outcome === 'block' || workflowDecision.outcome === 'skip') {
    return {
      status: workflowDecision.outcome === 'block' ? 'blocked' : 'not-recommended',
      steps: [{
        nodeKey: '$workflow',
        title: workflow.title,
        outcome: workflowDecision.outcome,
        reason: workflowDecision.reason
      }],
      issues
    }
  }
  const first = orderedNodes(workflow)[0]
  if (!first) return { status: 'completed', steps: [], issues }
  const steps: WorkflowPathStep[] = []
  const visited = new Set<string>()
  let current: WorkflowNode | undefined = first
  while (current && steps.length <= workflow.nodes.length * 2) {
    if (visited.has(current.nodeKey)) {
      issues.push(error('route-loop', `路径预演检测到循环：${current.nodeKey}`, current.nodeKey))
      return { status: 'invalid', steps, issues }
    }
    visited.add(current.nodeKey)
    const decision = evaluateNodeApplicability(current, projectFields)
    steps.push({ nodeKey: current.nodeKey, title: current.title, outcome: decision.outcome, reason: decision.reason })
    if (decision.outcome === 'block') return { status: 'blocked', steps, issues }
    if (current.type === 'wait') return { status: 'waiting', steps, issues }
    const next: WorkflowNode | undefined = decision.outcome === 'route' && decision.routeTargetNodeKey
      ? nodeByKey(workflow, decision.routeTargetNodeKey)
      : nextNodeOf(workflow, current, projectFields)
    if (next && next.order > current.order + 1) {
      for (const skipped of orderedNodes(workflow).filter((node) => node.order > current!.order && node.order < next.order)) {
        visited.add(skipped.nodeKey)
        steps.push({
          nodeKey: skipped.nodeKey,
          title: skipped.title,
          outcome: 'skip',
          reason: `路由从 ${current.nodeKey} 进入 ${next.nodeKey}，本节点不在实际路径中。`
        })
      }
    }
    current = next
  }
  return { status: current ? 'invalid' : 'completed', steps, issues }
}

export function diffWorkflowTemplates(from: Workflow, to: Workflow): WorkflowTemplateDiff {
  const fromByKey = new Map(from.nodes.map((node) => [node.nodeKey, node]))
  const toByKey = new Map(to.nodes.map((node) => [node.nodeKey, node]))
  const addedNodeKeys = [...toByKey.keys()].filter((key) => !fromByKey.has(key))
  const removedNodeKeys = [...fromByKey.keys()].filter((key) => !toByKey.has(key))
  const shared = [...fromByKey.keys()].filter((key) => toByKey.has(key))
  const renamedNodeKeys = shared.filter((key) => fromByKey.get(key)!.title !== toByKey.get(key)!.title)
  const changedNodeKeys = shared.filter(
    (key) => JSON.stringify(withoutDisplayName(fromByKey.get(key)!)) !== JSON.stringify(withoutDisplayName(toByKey.get(key)!))
  )
  const fromCheckpoints = new Set(from.checkpointBlueprint.map((item) => item.checkpointKey))
  const toCheckpoints = new Set(to.checkpointBlueprint.map((item) => item.checkpointKey))
  const addedCheckpointKeys = [...toCheckpoints].filter((key) => !fromCheckpoints.has(key))
  const removedCheckpointKeys = [...fromCheckpoints].filter((key) => !toCheckpoints.has(key))
  return {
    fromVersion: from.templateVersion,
    toVersion: to.templateVersion,
    addedNodeKeys,
    removedNodeKeys,
    renamedNodeKeys,
    changedNodeKeys,
    addedCheckpointKeys,
    removedCheckpointKeys,
    compatible: removedNodeKeys.length === 0 && removedCheckpointKeys.length === 0
  }
}

export function previewProjectMigration(
  state: ProjectFlowState,
  from: Workflow,
  to: Workflow,
  migrationMap: Record<string, string>
): ProjectMigrationPreview {
  const diff = diffWorkflowTemplates(from, to)
  const targetKeys = new Set(to.nodes.map((node) => node.nodeKey))
  const usedKeys = Object.keys(state.nodeStates)
  const unmappedNodeKeys = usedKeys.filter((key) => !targetKeys.has(key) && !targetKeys.has(migrationMap[key]))
  return {
    ...diff,
    projectId: state.projectId,
    migrationMap: { ...migrationMap },
    unmappedNodeKeys,
    canMigrate: unmappedNodeKeys.length === 0
  }
}

function enterNode(workflow: Workflow, state: ProjectFlowState, nodeKey: string): ProjectFlowState {
  const next = structuredCloneSafe(state)
  let node = nodeByKey(workflow, nodeKey)
  const visited = new Set<string>()
  while (node) {
    if (visited.has(node.nodeKey)) {
      next.status = 'blocked'
      next.currentNodeKey = node.nodeKey
      return next
    }
    visited.add(node.nodeKey)
    next.currentNodeKey = node.nodeKey
    next.nodeStates[node.nodeKey].enteredAt ||= nowIso()
    next.nodeStates[node.nodeKey].status = 'ready'
    next.status = node.type === 'wait' ? 'waiting' : 'active'
    return next
  }
  next.currentNodeKey = ''
  next.status = 'completed'
  return next
}

function executionReadyDecision(fields: Record<string, unknown>): ApplicabilityDecision {
  return {
    status: 'highly-applicable',
    outcome: 'enable',
    reason: '项目可直接执行；适用性不参与项目阻断。',
    evaluatedAt: nowIso(),
    inputSnapshot: structuredCloneSafe(fields)
  }
}

function advanceFrom(workflow: Workflow, state: ProjectFlowState, node: WorkflowNode): ProjectFlowState {
  const next = nextNodeOf(workflow, node, state.projectFields)
  if (next && next.order > node.order + 1) {
    const timestamp = nowIso()
    for (const skipped of orderedNodes(workflow).filter((item) => item.order > node.order && item.order < next.order)) {
      const nodeState = state.nodeStates[skipped.nodeKey]
      if (!nodeState || nodeState.status !== 'pending') continue
      nodeState.status = 'skipped'
      nodeState.completedAt = timestamp
      nodeState.applicability = {
        status: 'not-recommended',
        outcome: 'skip',
        reason: `路由从 ${node.nodeKey} 进入 ${next.nodeKey}，本节点不在实际路径中。`,
        evaluatedAt: timestamp,
        inputSnapshot: structuredCloneSafe(state.projectFields)
      }
    }
  }
  return next ? enterNode(workflow, state, next.nodeKey) : { ...state, currentNodeKey: '', status: 'completed', updatedAt: nowIso() }
}

function nextNodeOf(workflow: Workflow, node: WorkflowNode, fields: Record<string, unknown>): WorkflowNode | undefined {
  const edges = workflow.edges.filter((edge) => resolveNode(workflow, edge.source)?.nodeKey === node.nodeKey)
  const matched = edges.find((edge) => !edge.condition || evaluateCondition(edge.condition, fields))
  if (matched) return resolveNode(workflow, matched.target)
  const nodes = orderedNodes(workflow)
  return nodes[nodes.findIndex((item) => item.nodeKey === node.nodeKey) + 1]
}

function previousNodeOf(workflow: Workflow, node: WorkflowNode): WorkflowNode | undefined {
  const incoming = workflow.edges.find((edge) => resolveNode(workflow, edge.target)?.nodeKey === node.nodeKey)
  if (incoming) return resolveNode(workflow, incoming.source)
  const nodes = orderedNodes(workflow)
  return nodes[nodes.findIndex((item) => item.nodeKey === node.nodeKey) - 1]
}

function resolveNode(workflow: Workflow, idOrKey: string): WorkflowNode | undefined {
  return workflow.nodes.find((node) => node.id === idOrKey || node.nodeKey === idOrKey)
}

function nodeByKey(workflow: Workflow, nodeKey: string): WorkflowNode | undefined {
  return workflow.nodes.find((node) => node.nodeKey === nodeKey)
}

function orderedNodes(workflow: Workflow): WorkflowNode[] {
  return [...workflow.nodes].sort((left, right) => left.order - right.order || left.nodeKey.localeCompare(right.nodeKey))
}

function error(code: string, message: string, nodeKey?: string): WorkflowValidationIssue {
  return { severity: 'error', code, message, nodeKey }
}

function warning(code: string, message: string, nodeKey?: string): WorkflowValidationIssue {
  return { severity: 'warning', code, message, nodeKey }
}

function withoutDisplayName(node: WorkflowNode): Omit<WorkflowNode, 'title' | 'summary'> {
  const { title: _title, summary: _summary, ...rest } = node
  return rest
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}
