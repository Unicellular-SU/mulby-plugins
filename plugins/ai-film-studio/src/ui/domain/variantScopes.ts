import type { ProjectDoc } from './types'

export interface RemovedVariantScopeReferences {
  episodeIds?: Iterable<string>
  storyboardIds?: Iterable<string>
}

function removeScopeIds(ids: string[] | undefined, removed: Set<string>): { ids?: string[]; changed: boolean } {
  if (!ids?.length || !removed.size) return { ids, changed: false }
  const next = ids.filter((id) => !removed.has(id))
  return { ids: next.length ? next : undefined, changed: next.length !== ids.length }
}

export function removeVariantScopeReferences(doc: ProjectDoc, refs: RemovedVariantScopeReferences): number {
  const episodeIds = new Set(refs.episodeIds ?? [])
  const storyboardIds = new Set(refs.storyboardIds ?? [])
  if (!episodeIds.size && !storyboardIds.size) return 0
  let changed = 0
  for (const asset of doc.assets) {
    for (const variant of asset.variants ?? []) {
      const episodes = removeScopeIds(variant.appliesToEpisodeIds, episodeIds)
      if (episodes.changed) {
        variant.appliesToEpisodeIds = episodes.ids
        changed += 1
      }
      const storyboards = removeScopeIds(variant.appliesToStoryboardIds, storyboardIds)
      if (storyboards.changed) {
        variant.appliesToStoryboardIds = storyboards.ids
        changed += 1
      }
    }
  }
  return changed
}
