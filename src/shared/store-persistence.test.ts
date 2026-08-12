import { describe, expect, it } from 'vitest'
import { createWorkflow, defaultStore } from './domain'
import { planCategorizedStoreWrites } from './store-persistence'

describe('planCategorizedStoreWrites', () => {
  it('writes every categorized mirror for the initial store', () => {
    expect(planCategorizedStoreWrites(null, defaultStore())).toEqual({
      prompts: true,
      workflows: true,
      projects: true,
      skillMetadata: true
    })
  })

  it('does not rewrite categorized files for MCP-only changes', () => {
    const previous = defaultStore()
    const next = { ...previous, mcpServers: [{ ...previous.mcpServers[0], id: 'mcp-new' }] }

    expect(planCategorizedStoreWrites(previous, next)).toEqual({
      prompts: false,
      workflows: false,
      projects: false,
      skillMetadata: false
    })
  })

  it('only rewrites the category whose resources changed', () => {
    const previous = defaultStore()
    const promptPlan = planCategorizedStoreWrites(previous, {
      ...previous,
      prompts: [...previous.prompts, { ...previous.prompts[0], id: 'prompt-new' }]
    })
    const workflowPlan = planCategorizedStoreWrites(previous, {
      ...previous,
      workflows: [...previous.workflows, createWorkflow({ id: 'workflow-new' })]
    })

    expect(promptPlan).toEqual({ prompts: true, workflows: false, projects: false, skillMetadata: false })
    expect(workflowPlan).toEqual({ prompts: false, workflows: true, projects: false, skillMetadata: false })
  })

  it('rewrites skill metadata for index changes without touching prompt or workflow files', () => {
    const previous = defaultStore()
    const next = {
      ...previous,
      skillIndex: {
        ...previous.skillIndex,
        'skill-new': {
          title: 'New Skill',
          tags: ['manual'],
          favorite: false,
          updatedAt: '2026-08-11T00:00:00.000Z'
        }
      }
    }

    expect(planCategorizedStoreWrites(previous, next)).toEqual({
      prompts: false,
      workflows: false,
      projects: false,
      skillMetadata: true
    })
  })

  it('rebuilds every mirror after the data root changes', () => {
    const previous = defaultStore()
    const next = {
      ...previous,
      settings: { ...previous.settings, dataDirectory: 'D:\\FormatFlowData' }
    }

    expect(planCategorizedStoreWrites(previous, next)).toEqual({
      prompts: true,
      workflows: true,
      projects: true,
      skillMetadata: true
    })
  })

  it('only rebuilds the mirror whose override directory changed', () => {
    const previous = defaultStore()
    const next = {
      ...previous,
      settings: {
        ...previous.settings,
        dataDirectories: { ...(previous.settings.dataDirectories || {}), prompts: 'D:\\FormatFlowPrompts' }
      }
    }

    expect(planCategorizedStoreWrites(previous, next)).toEqual({
      prompts: true,
      workflows: false,
      projects: false,
      skillMetadata: false
    })
  })

  it('rewrites only project files when an autosaved project changes', () => {
    const previous = defaultStore()
    const next = {
      ...previous,
      projectFlowStates: [
        {
          id: 'project-a:workflow-a:1.0.0',
          projectId: 'project-a',
          projectTitle: '自动保存项目',
          workflowId: 'workflow-a',
          templateKey: 'workflow-a',
          templateVersion: '1.0.0',
          status: 'blocked' as const,
          projectFields: { topic: '测试' },
          workflowApplicability: {
            status: 'blocked' as const,
            outcome: 'block' as const,
            reason: '待填写',
            evaluatedAt: '2026-08-11T00:00:00.000Z',
            inputSnapshot: { topic: '测试' }
          },
          currentNodeKey: '',
          nodeStates: {},
          deliveryRecords: [],
          reviewAttempts: [],
          checkpoints: [],
          resourceLocks: {},
          createdAt: '2026-08-11T00:00:00.000Z',
          updatedAt: '2026-08-11T00:00:00.000Z'
        }
      ]
    }

    expect(planCategorizedStoreWrites(previous, next)).toEqual({
      prompts: false,
      workflows: false,
      projects: true,
      skillMetadata: false
    })
  })
})
