import { describe, expect, it } from 'vitest'
import type { WorkflowSkillPackageEntry } from '../shared/types'
import {
  extractWorkflowSkillFrontmatterName,
  safeManagedSkillDirectoryName,
  validateWorkflowSkillInventoryEntries,
  validateWorkflowSkillPackageEntries
} from '../shared/workflow-skill-package'

function entry(order: number, name: string): WorkflowSkillPackageEntry {
  return {
    order,
    directoryName: `${String(order).padStart(2, '0')}-${name}`,
    frontmatterName: name,
    title: name,
    sourcePath: `D:\\source\\${String(order).padStart(2, '0')}-${name}`,
    installedPath: `C:\\Users\\tester\\.codex\\skills\\${String(order).padStart(2, '0')}-${name}`,
    skillFileRelativePath: 'SKILL.md',
    fingerprint: 'a'.repeat(64)
  }
}

describe('workflow Skill package preparation', () => {
  it('accepts contiguous zero-based or one-based ordered directories', () => {
    expect(validateWorkflowSkillPackageEntries([entry(1, 'alpha'), entry(2, 'beta')])).toBe('')
    expect(validateWorkflowSkillPackageEntries([entry(0, 'controller'), entry(1, 'alpha'), entry(2, 'beta')])).toBe('')
  })

  it('reports missing, duplicate and malformed ordering metadata', () => {
    expect(validateWorkflowSkillPackageEntries([entry(1, 'alpha'), entry(3, 'beta')])).toMatch(/编号断档.*02/)
    expect(validateWorkflowSkillPackageEntries([entry(1, 'alpha'), entry(1, 'beta')])).toMatch(/编号重复.*01/)
    expect(validateWorkflowSkillPackageEntries([entry(1, 'alpha'), entry(2, 'alpha')])).toMatch(/frontmatter name 重复.*alpha/)
    expect(validateWorkflowSkillPackageEntries([{ ...entry(1, 'alpha'), order: Number.NaN, directoryName: 'alpha' }])).toMatch(/缺少两位数字前缀/)
    expect(validateWorkflowSkillPackageEntries([{ ...entry(1, 'alpha'), frontmatterName: '' }])).toMatch(/缺少 frontmatter name/)
  })

  it('allows duplicate sequence numbers in a source inventory for manual workflow selection', () => {
    expect(validateWorkflowSkillInventoryEntries([
      entry(1, 'common-start'),
      entry(2, 'route-a'),
      entry(2, 'route-b'),
      entry(4, 'optional-end')
    ])).toBe('')
    expect(validateWorkflowSkillInventoryEntries([entry(1, 'same'), entry(2, 'same')])).toMatch(/frontmatter name 重复.*same/)
  })

  it('reads the declared frontmatter name without falling back to the directory name', () => {
    expect(extractWorkflowSkillFrontmatterName('---\nname: workflow-alpha\ndescription: test\n---\n')).toBe('workflow-alpha')
    expect(extractWorkflowSkillFrontmatterName('\uFEFF---\r\nname: "中文 Skill"\r\n---\r\n')).toBe('中文 Skill')
    expect(extractWorkflowSkillFrontmatterName('# no frontmatter')).toBe('')
  })

  it('preserves the numeric prefix and Chinese label for the managed Skill copy', () => {
    expect(safeManagedSkillDirectoryName('01-文献检索器')).toBe('01-文献检索器')
    expect(safeManagedSkillDirectoryName('02-invalid<>name')).toBe('02-invalid-name')
  })
})
