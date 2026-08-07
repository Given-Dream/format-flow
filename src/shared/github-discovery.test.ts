import { describe, expect, it } from 'vitest'
import {
  buildGithubRepositorySearchQuery,
  buildGithubRepositorySearchUrl,
  buildWebsiteSearchUrl,
  discoverySourceSupports,
  normalizeDiscoverySources,
  RECOMMENDED_DISCOVERY_SOURCES
} from './github-discovery'

describe('GitHub discovery search', () => {
  it('does not force unrelated Skill terms into an explicit query', () => {
    expect(buildGithubRepositorySearchQuery('skill', '  nuwa  ')).toBe('nuwa in:name,description,readme')
  })

  it('does not force generic Prompt terms into an explicit query', () => {
    expect(buildGithubRepositorySearchQuery('prompt', '  academic writing  ')).toBe(
      'academic writing in:name,description,readme'
    )
  })

  it('uses default discovery terms only for an empty query', () => {
    expect(buildGithubRepositorySearchQuery('skill', '')).toBe('codex skill in:name,description,readme')
    expect(buildGithubRepositorySearchQuery('prompt', '   ')).toBe('prompt template in:name,description,readme')
  })

  it('keeps GitHub relevance ordering for explicit searches', () => {
    const explicitUrl = new URL(buildGithubRepositorySearchUrl('skill', 'nuwa'))
    const defaultUrl = new URL(buildGithubRepositorySearchUrl('skill', ''))

    expect(explicitUrl.searchParams.get('q')).toBe('nuwa in:name,description,readme')
    expect(explicitUrl.searchParams.has('sort')).toBe(false)
    expect(defaultUrl.searchParams.get('sort')).toBe('updated')
  })

  it('normalizes custom sources and rejects unsafe or incomplete templates', () => {
    const sources = normalizeDiscoverySources([
      { id: 'prompts-chat', name: 'prompts.chat', kind: 'prompt', searchUrlTemplate: 'https://prompts.chat/prompts?q={query}' },
      { id: 'duplicate', name: 'prompts.chat', kind: 'prompt', searchUrlTemplate: 'https://prompts.chat/prompts?q={query}' },
      { id: 'missing-query', name: 'Bad', kind: 'both', searchUrlTemplate: 'https://example.com/search' },
      { id: 'unsafe', name: 'Unsafe', kind: 'skill', searchUrlTemplate: 'file:///tmp/{query}' }
    ])

    expect(sources).toHaveLength(1)
    expect(discoverySourceSupports(sources[0], 'prompt')).toBe(true)
    expect(discoverySourceSupports(sources[0], 'skill')).toBe(false)
    expect(buildWebsiteSearchUrl(sources[0], 'creative writing')).toBe('https://prompts.chat/prompts?q=creative%20writing')
  })

  it('excludes disabled sources from both discovery kinds', () => {
    const [source] = normalizeDiscoverySources([
      { name: 'Disabled', kind: 'both', searchUrlTemplate: 'https://example.com/search?q={query}', enabled: false }
    ])

    expect(discoverySourceSupports(source, 'prompt')).toBe(false)
    expect(discoverySourceSupports(source, 'skill')).toBe(false)
  })

  it('provides valid, type-specific recommended discovery interfaces', () => {
    expect(RECOMMENDED_DISCOVERY_SOURCES.map((item) => item.source.name)).toEqual(['prompts.chat', 'SkillsMP'])
    for (const recommendation of RECOMMENDED_DISCOVERY_SOURCES) {
      expect(normalizeDiscoverySources([recommendation.source])).toHaveLength(1)
      expect(buildWebsiteSearchUrl(recommendation.source, 'format flow')).toContain('format%20flow')
      expect(new URL(recommendation.websiteUrl).protocol).toBe('https:')
    }
    expect(discoverySourceSupports(RECOMMENDED_DISCOVERY_SOURCES[0].source, 'prompt')).toBe(true)
    expect(discoverySourceSupports(RECOMMENDED_DISCOVERY_SOURCES[0].source, 'skill')).toBe(false)
    expect(discoverySourceSupports(RECOMMENDED_DISCOVERY_SOURCES[1].source, 'skill')).toBe(true)
    expect(discoverySourceSupports(RECOMMENDED_DISCOVERY_SOURCES[1].source, 'prompt')).toBe(false)
  })
})
