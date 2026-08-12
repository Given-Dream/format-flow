import type { AppStore, DataDirectoryOverrides } from './types'

export type CategorizedStoreWritePlan = {
  prompts: boolean
  workflows: boolean
  projects: boolean
  skillMetadata: boolean
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function directories(store: AppStore): DataDirectoryOverrides {
  return store.settings.dataDirectories || {}
}

export function planCategorizedStoreWrites(
  previous: AppStore | null,
  next: AppStore
): CategorizedStoreWritePlan {
  if (!previous) {
    return { prompts: true, workflows: true, projects: true, skillMetadata: true }
  }

  const previousDirectories = directories(previous)
  const nextDirectories = directories(next)
  const dataRootChanged = (previous.settings.dataDirectory || '') !== (next.settings.dataDirectory || '')

  return {
    prompts:
      dataRootChanged ||
      (previousDirectories.prompts || '') !== (nextDirectories.prompts || '') ||
      !sameValue(previous.prompts, next.prompts),
    workflows:
      dataRootChanged ||
      (previousDirectories.workflows || '') !== (nextDirectories.workflows || '') ||
      !sameValue(previous.workflows, next.workflows),
    projects:
      dataRootChanged ||
      (previousDirectories.projects || '') !== (nextDirectories.projects || '') ||
      !sameValue(previous.projectFlowStates, next.projectFlowStates),
    skillMetadata:
      dataRootChanged ||
      (previousDirectories.skillMetadata || '') !== (nextDirectories.skillMetadata || '') ||
      (previousDirectories.managedSkills || '') !== (nextDirectories.managedSkills || '') ||
      !sameValue(previous.skillIndex, next.skillIndex) ||
      !sameValue(previous.groups.skills, next.groups.skills) ||
      !sameValue(previous.settings.skillDirectories, next.settings.skillDirectories)
  }
}
