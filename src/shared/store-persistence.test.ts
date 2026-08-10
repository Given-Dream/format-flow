import { describe, expect, it } from 'vitest'
import { defaultStore } from './domain'
import { planCategorizedStoreWrites } from './store-persistence'

describe('planCategorizedStoreWrites', () => {
  it('writes every categorized mirror for the initial store', () => {
    expect(planCategorizedStoreWrites(null, defaultStore())).toEqual({
      prompts: true,
      workflows: true,
      skillMetadata: true
    })
  })

  it('does not rewrite categorized files for MCP-only changes', () => {
    const previous = defaultStore()
    const next = { ...previous, mcpServers: [{ ...previous.mcpServers[0], id: 'mcp-new' }] }

    expect(planCategorizedStoreWrites(previous, next)).toEqual({
      prompts: false,
      workflows: false,
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
      workflows: [...previous.workflows, { ...previous.workflows[0], id: 'workflow-new' }]
    })

    expect(promptPlan).toEqual({ prompts: true, workflows: false, skillMetadata: false })
    expect(workflowPlan).toEqual({ prompts: false, workflows: true, skillMetadata: false })
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
      skillMetadata: false
    })
  })
})
