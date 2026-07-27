import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mergeSkillMetadata, parseSkillMarkdown } from '../shared/domain'
import { migrateTemplateDirectory, syncTemplateDirectory } from './builtin-skills'

const temporaryDirectories: string[] = []
const templateRoot = path.resolve('resources/built-in-skills/engineering-cybernetics-user-habit-learning')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('built-in learning Skill templates', () => {
  it('provides a Chinese engineering-cybernetics Skill with complete references', async () => {
    const skillContent = await fs.readFile(path.join(templateRoot, 'SKILL.md'), 'utf8')
    const coreReference = await fs.readFile(path.join(templateRoot, 'references/engineering-cybernetics-core.md'), 'utf8')
    const dialogueReference = await fs.readFile(path.join(templateRoot, 'references/dialogue-control-and-habit-learning.md'), 'utf8')
    const generationReference = await fs.readFile(path.join(templateRoot, 'references/skill-generation-spec.md'), 'utf8')
    const skill = parseSkillMarkdown(skillContent, path.join(templateRoot, 'SKILL.md'))

    expect(skill.name).toBe('engineering-cybernetics-user-habit-learning')
    expect(skill.title).toBe('工程控制论学习用户习惯')
    expect(skill.summary).toContain('对话')
    expect(mergeSkillMetadata(skill, { tags: [], summaryOverride: 'Legacy English summary' }).summary).toBe(skill.summary)
    expect(generationReference).toContain('generate by: engineering-cybernetics')
    expect(dialogueReference).toContain('C 级证据不得单独进入长期 Skill')
    expect(dialogueReference).toContain('稳定规则')
    expect(generationReference).toContain('agent/openai.yaml')
    for (let chapter = 1; chapter <= 21; chapter += 1) {
      expect(coreReference).toContain(`第${chapter}章`)
    }
  })

  it('overwrites managed template files while preserving additional user files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-skill-template-'))
    temporaryDirectories.push(root)
    const source = path.join(root, 'source')
    const destination = path.join(root, 'destination')
    await fs.mkdir(path.join(source, 'references'), { recursive: true })
    await fs.mkdir(path.join(destination, 'extras'), { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), 'new template', 'utf8')
    await fs.writeFile(path.join(source, 'references/core.md'), 'core reference', 'utf8')
    await fs.writeFile(path.join(destination, 'SKILL.md'), 'old local template', 'utf8')
    await fs.writeFile(path.join(destination, 'extras/custom.md'), 'keep me', 'utf8')

    await syncTemplateDirectory(source, destination)

    expect(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe('new template')
    expect(await fs.readFile(path.join(destination, 'references/core.md'), 'utf8')).toBe('core reference')
    expect(await fs.readFile(path.join(destination, 'extras/custom.md'), 'utf8')).toBe('keep me')
  })

  it('renames a legacy managed Skill when the destination does not exist', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-skill-migration-'))
    temporaryDirectories.push(root)
    const legacy = path.join(root, 'legacy-skill')
    const destination = path.join(root, 'renamed-skill')
    await fs.mkdir(path.join(legacy, 'extras'), { recursive: true })
    await fs.writeFile(path.join(legacy, 'SKILL.md'), 'legacy template', 'utf8')
    await fs.writeFile(path.join(legacy, 'extras/custom.md'), 'keep me', 'utf8')

    await expect(migrateTemplateDirectory(legacy, destination)).resolves.toBe(true)

    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe('legacy template')
    expect(await fs.readFile(path.join(destination, 'extras/custom.md'), 'utf8')).toBe('keep me')
  })

  it('merges a legacy managed Skill into an existing destination and removes the legacy directory', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'format-flow-skill-migration-'))
    temporaryDirectories.push(root)
    const legacy = path.join(root, 'legacy-skill')
    const destination = path.join(root, 'renamed-skill')
    await fs.mkdir(path.join(legacy, 'extras'), { recursive: true })
    await fs.mkdir(path.join(destination, 'references'), { recursive: true })
    await fs.writeFile(path.join(legacy, 'SKILL.md'), 'legacy template', 'utf8')
    await fs.writeFile(path.join(legacy, 'extras/custom.md'), 'keep me', 'utf8')
    await fs.writeFile(path.join(destination, 'references/new.md'), 'new reference', 'utf8')

    await expect(migrateTemplateDirectory(legacy, destination)).resolves.toBe(true)

    await expect(fs.stat(legacy)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8')).toBe('legacy template')
    expect(await fs.readFile(path.join(destination, 'extras/custom.md'), 'utf8')).toBe('keep me')
    expect(await fs.readFile(path.join(destination, 'references/new.md'), 'utf8')).toBe('new reference')
  })
})
