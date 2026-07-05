import type { Episode, ProjectDoc } from '../../domain/types'

export type AgentEpisodeTargetMatch = 'index' | 'title' | 'id'

export interface AgentEpisodeTarget {
  episode: Episode
  match: AgentEpisodeTargetMatch
  value: string
}

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

function parseChineseInteger(input: string): number | undefined {
  const text = input.trim()
  if (!text) return undefined
  let total = 0
  let current = 0
  let seen = false
  for (const ch of text) {
    if (ch in CHINESE_DIGITS) {
      current = CHINESE_DIGITS[ch]
      seen = true
      continue
    }
    if (ch === '十' || ch === '百') {
      const unit = ch === '十' ? 10 : 100
      total += (current || 1) * unit
      current = 0
      seen = true
      continue
    }
    return undefined
  }
  const value = total + current
  return seen && value > 0 ? value : undefined
}

export function parseEpisodeOrdinal(input: string): number | undefined {
  const text = input.trim()
  if (/^\d+$/.test(text)) {
    const value = Number(text)
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }
  return parseChineseInteger(text)
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function findEpisodeByOrdinal(episodes: Episode[], token: string): Episode | undefined {
  const ordinal = parseEpisodeOrdinal(token)
  if (!ordinal) return undefined
  return episodes.find((episode) => episode.index === ordinal - 1)
}

function findEpisodeById(episodes: Episode[], text: string): AgentEpisodeTarget | undefined {
  for (const episode of episodes) {
    if (!episode.id || episode.id.length < 4) continue
    const escaped = episode.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|\\s|["'“”‘’「」])${escaped}($|\\s|["'“”‘’「」])`, 'i').test(text)) {
      return { episode, match: 'id', value: episode.id }
    }
  }
  return undefined
}

function findEpisodeByTitle(episodes: Episode[], text: string): AgentEpisodeTarget | undefined {
  const matches = episodes.filter((episode) => {
    const title = episode.title.trim()
    return title.length >= 2 && text.includes(title)
  })
  if (matches.length !== 1) return undefined
  return { episode: matches[0], match: 'title', value: matches[0].title }
}

export function resolveAgentEpisodeTarget(doc: ProjectDoc, userText: string): AgentEpisodeTarget | undefined {
  const text = userText.trim()
  if (!text) return undefined
  const episodes = sortedEpisodes(doc)
  if (!episodes.length) return undefined

  const ordinalPatterns = [
    /第\s*([0-9]{1,3}|[零〇一二两三四五六七八九十百]+)\s*(?:集|话|回)/,
    /\b(?:e|ep)\s*0*([0-9]{1,3})\b/i,
    /\bepisode\s*0*([0-9]{1,3})\b/i,
  ]
  for (const pattern of ordinalPatterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const episode = findEpisodeByOrdinal(episodes, match[1])
    if (episode) return { episode, match: 'index', value: match[1] }
  }

  return findEpisodeById(episodes, text) ?? findEpisodeByTitle(episodes, text)
}
