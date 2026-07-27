import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function syncTemplateDirectory(source: string, destination: string): Promise<void> {
  const sourceStat = await fs.stat(source)
  if (!sourceStat.isDirectory()) throw new Error(`Built-in Skill template is not a directory: ${source}`)

  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      await syncTemplateDirectory(sourcePath, destinationPath)
      continue
    }
    if (!entry.isFile()) continue

    const sourceContent = await fs.readFile(sourcePath)
    const destinationContent = await fs.readFile(destinationPath).catch(() => null)
    if (destinationContent?.equals(sourceContent)) continue
    await fs.mkdir(path.dirname(destinationPath), { recursive: true })
    await fs.writeFile(destinationPath, sourceContent)
  }
}

export async function migrateTemplateDirectory(legacyDirectory: string, destination: string): Promise<boolean> {
  const legacyStat = await fs.stat(legacyDirectory).catch(() => null)
  if (!legacyStat?.isDirectory()) return false

  const destinationStat = await fs.stat(destination).catch(() => null)
  if (!destinationStat) {
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.rename(legacyDirectory, destination)
    return true
  }
  if (!destinationStat.isDirectory()) throw new Error(`Managed Skill destination is not a directory: ${destination}`)

  await syncTemplateDirectory(legacyDirectory, destination)
  await fs.rm(legacyDirectory, { recursive: true, force: true })
  return true
}
