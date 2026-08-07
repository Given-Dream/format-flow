import type { DiscoveryKind, DiscoverySource, GithubSearchResult } from './types'

const DEFAULT_GITHUB_QUERIES: Record<DiscoveryKind, string> = {
  skill: 'codex skill',
  prompt: 'prompt template'
}

const STANDARD_SKILL_DIRECTORIES = new Set(['agent', 'agents', 'scripts', 'references', 'assets', 'extras'])

export const RECOMMENDED_DISCOVERY_SOURCES = [
  {
    source: {
      id: 'recommended-prompts-chat',
      name: 'prompts.chat',
      kind: 'prompt',
      searchUrlTemplate: 'https://prompts.chat/prompts?q={query}',
      resultLinkMatch: '/prompts/',
      enabled: true
    },
    websiteUrl: 'https://prompts.chat/prompts',
    description: '公开 Prompt 目录，支持按关键词直接检索结果。'
  },
  {
    source: {
      id: 'recommended-skillsmp',
      name: 'SkillsMP',
      kind: 'skill',
      searchUrlTemplate: 'https://skillsmp.com/search?q={query}',
      resultLinkMatch: '/creators/',
      enabled: true
    },
    websiteUrl: 'https://skillsmp.com/',
    description: '公开 Agent Skill 目录，可按关键词检索 Skill 页面。'
  }
] satisfies Array<{ source: DiscoverySource; websiteUrl: string; description: string }>

export function buildGithubRepositorySearchQuery(kind: DiscoveryKind, query: string): string {
  const terms = query.trim() || DEFAULT_GITHUB_QUERIES[kind]
  return `${terms} in:name,description,readme`
}

export function buildGithubRepositorySearchUrl(kind: DiscoveryKind, query: string): string {
  const params = new URLSearchParams({
    q: buildGithubRepositorySearchQuery(kind, query),
    per_page: '8'
  })
  if (!query.trim()) params.set('sort', 'updated')
  return `https://api.github.com/search/repositories?${params.toString()}`
}

export function normalizeDiscoverySources(value: unknown): DiscoverySource[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const sources: DiscoverySource[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const searchUrlTemplate = typeof record.searchUrlTemplate === 'string' ? record.searchUrlTemplate.trim() : ''
    const kind = record.kind === 'prompt' || record.kind === 'skill' || record.kind === 'both' ? record.kind : 'both'
    if (!name || !isValidDiscoverySearchTemplate(searchUrlTemplate)) continue
    const identity = `${name.toLowerCase()}|${searchUrlTemplate.toLowerCase()}|${kind}`
    if (seen.has(identity)) continue
    seen.add(identity)
    sources.push({
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `discovery-${sources.length + 1}`,
      name,
      kind,
      searchUrlTemplate,
      resultLinkMatch: typeof record.resultLinkMatch === 'string' ? record.resultLinkMatch.trim() : '',
      enabled: record.enabled !== false
    })
  }

  return sources
}

export function isValidDiscoverySearchTemplate(value: string): boolean {
  if (!value.includes('{query}')) return false
  try {
    const url = new URL(value.replaceAll('{query}', 'format-flow'))
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function buildWebsiteSearchUrl(source: DiscoverySource, query: string): string {
  if (!isValidDiscoverySearchTemplate(source.searchUrlTemplate)) throw new Error('发现来源必须使用有效的 HTTP(S) 地址并包含 {query}')
  return source.searchUrlTemplate.replaceAll('{query}', encodeURIComponent(query.trim()))
}

export function discoverySourceSupports(source: DiscoverySource, kind: DiscoveryKind): boolean {
  return source.enabled && (source.kind === 'both' || source.kind === kind)
}

export function githubSkillRootPath(skillPath: string): string {
  const normalized = skillPath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!/(^|\/)skill\.md$/i.test(normalized)) throw new Error('GitHub Skill 条目必须指向 SKILL.md')
  const directory = normalized.split('/').slice(0, -1).join('/')
  return directory === '.' ? '' : directory
}

export function shouldIncludeGithubSkillEntry(
  skillRootPath: string,
  relativePath: string,
  type: 'file' | 'dir'
): boolean {
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return false
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => ['.git', 'node_modules', 'dist', 'out'].includes(segment.toLowerCase()))) return false
  if (skillRootPath) return true
  if (type === 'dir') return segments.length === 1 && STANDARD_SKILL_DIRECTORIES.has(segments[0].toLowerCase())
  return segments.length === 1 || STANDARD_SKILL_DIRECTORIES.has(segments[0].toLowerCase())
}

export function createWebsiteSearchPageResult(
  source: DiscoverySource,
  kind: DiscoveryKind,
  query: string,
  description = '该网站未提供可直接聚合的公开结果，点击后在原网站继续查看。'
): GithubSearchResult {
  const htmlUrl = buildWebsiteSearchUrl(source, query)
  return {
    id: `website:${source.id}:${kind}:${query.trim().toLowerCase()}`,
    name: `在 ${source.name} 搜索`,
    repository: new URL(htmlUrl).hostname,
    description,
    path: htmlUrl,
    htmlUrl,
    rawUrl: htmlUrl,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: 'website',
    resultType: 'search-page'
  }
}
