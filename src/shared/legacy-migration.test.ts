import { describe, expect, it } from 'vitest'
import { createPrompt, normalizeStore } from './domain'
import { sha256Text } from './sha256'

describe('Store v2 workflow migration', () => {
  it('moves the legacy default workflow and every run into the v3 interface without overwriting history', () => {
    const promptA = createPrompt({ id: 'prompt_preflight_review', title: '修改前检查', content: '先检查。' })
    const promptB = createPrompt({ id: 'prompt_safe_implementation', title: '安全实现', content: '再实现。' })
    const legacyWorkflow = {
      id: 'workflow_default_codex_change',
      title: 'Codex 修改工作流',
      description: '先审查，再实现，最后由人工确认输出。',
      tags: ['codex', 'default'],
      variables: [],
      favorite: false,
      createdAt: '2026-07-28T13:00:00.000Z',
      updatedAt: '2026-07-28T13:00:00.000Z',
      nodes: [
        {
          id: 'node_prompt_preflight_review',
          type: 'prompt',
          refId: promptA.id,
          title: promptA.title,
          summary: '检查',
          tags: [],
          inputs: {},
          outputs: ['prompt_output'],
          requiresReview: true,
          position: { x: 0, y: 80 }
        },
        {
          id: 'node_prompt_safe_implementation',
          type: 'prompt',
          refId: promptB.id,
          title: promptB.title,
          summary: '实现',
          tags: [],
          inputs: {},
          outputs: ['prompt_output'],
          requiresReview: true,
          position: { x: 280, y: 80 }
        },
        {
          id: 'node_default_approval',
          type: 'approval',
          title: '人工审查',
          summary: '最终确认',
          tags: [],
          inputs: {},
          outputs: ['review_decision'],
          requiresReview: true,
          position: { x: 560, y: 80 }
        }
      ],
      edges: [
        { id: 'edge-1', source: 'node_prompt_preflight_review', target: 'node_prompt_safe_implementation' },
        { id: 'edge-2', source: 'node_prompt_safe_implementation', target: 'node_default_approval' }
      ]
    }
    const originalWorkflow = structuredClone(legacyWorkflow)
    const makeRun = (index: number, progressed: boolean) => ({
      id: `run-${index}`,
      workflowId: legacyWorkflow.id,
      workflowTitle: legacyWorkflow.title,
      status: progressed ? 'reviewing' : 'running',
      currentStepIndex: progressed ? 1 : 0,
      createdAt: `2026-07-28T13:0${index}:00.000Z`,
      updatedAt: `2026-07-28T14:0${index}:00.000Z`,
      steps: legacyWorkflow.nodes.map((node, nodeIndex) => ({
        id: `run-${index}-${node.id}`,
        nodeId: node.id,
        title: node.title,
        summary: node.summary,
        type: node.type,
        status: progressed && nodeIndex === 0 ? 'done' : nodeIndex === 0 && !progressed ? 'running' : 'pending',
        reviewedByHuman: nodeIndex === 0,
        inputSnapshot: nodeIndex === 0 ? `input-${index}` : '',
        output: progressed && nodeIndex === 0 ? `output-${index}` : '',
        startedAt: nodeIndex === 0 ? `2026-07-28T13:0${index}:30.000Z` : undefined,
        finishedAt: progressed && nodeIndex === 0 ? `2026-07-28T13:5${index}:00.000Z` : undefined
      }))
    })
    const legacyRuns = [makeRun(1, true), makeRun(2, false), makeRun(3, false), makeRun(4, false)]

    const migrated = normalizeStore({
      version: 2,
      prompts: [promptA, promptB],
      workflows: [legacyWorkflow],
      runs: legacyRuns
    } as unknown as Parameters<typeof normalizeStore>[0])

    const workflow = migrated.workflows.find((item) => item.tags.includes('migrated-v2'))
    expect(workflow).toBeDefined()
    expect(migrated.workflows).toHaveLength(1)
    expect(workflow).toMatchObject({
      id: legacyWorkflow.id,
      templateVersion: '0.1.0-legacy',
      status: 'draft',
      family: 'custom'
    })
    expect(workflow?.nodes.map((node) => node.type)).toEqual(['prompt', 'prompt', 'review'])
    expect(workflow?.nodes[0].resourceRef).toMatchObject({
      resourceKey: `prompt:${promptA.id}`,
      fingerprint: sha256Text(promptA.content)
    })
    expect(workflow?.checkpointBlueprint).toHaveLength(1)

    expect(migrated.projectFlowStates).toHaveLength(4)
    expect(new Set(migrated.projectFlowStates.map((state) => state.id)).size).toBe(4)
    const progressed = migrated.projectFlowStates.find((state) => state.legacyMigration?.sourceRunId === 'run-1')
    expect(progressed?.workflowId).toBe(workflow?.id)
    expect(progressed?.currentNodeKey).toBe(workflow?.nodes[1].nodeKey)
    expect(progressed?.nodeStates[workflow!.nodes[0].nodeKey].status).toBe('completed')
    expect(progressed?.nodeStates[workflow!.nodes[1].nodeKey].status).toBe('ready')
    expect(progressed?.deliveryRecords).toEqual([
      expect.objectContaining({ nodeKey: workflow?.nodes[0].nodeKey, text: 'output-1', source: 'legacy-v2-output' })
    ])
    expect(progressed?.reviewAttempts).toEqual([
      expect.objectContaining({ nodeKey: workflow?.nodes[0].nodeKey, passed: true, source: 'legacy-v2' })
    ])
    expect(progressed?.legacyMigration?.steps[0]).toMatchObject({
      inputSnapshot: 'input-1',
      output: 'output-1',
      reviewedByHuman: true,
      status: 'done'
    })
    expect(progressed?.resourceLocks[`prompt:${promptA.id}`].fingerprint).toBe(sha256Text(promptA.content))
    expect(migrated.legacyWorkflowArchive?.runs).toHaveLength(4)
    expect(migrated.legacyWorkflowArchive?.reason).toContain('已转换到新版工作流界面')
    expect(legacyWorkflow).toEqual(originalWorkflow)
    expect(migrated.prompts.map((prompt) => prompt.content)).toEqual(['先检查。', '再实现。'])
  })
})
