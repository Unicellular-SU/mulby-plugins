import type { AssetAnchor, Board, Card, ProjectDoc, StoryboardDocV2, StoryboardShotV2 } from '../types'
import { readStoryboardDoc, storyboardStageState, type StoryboardStage, type StoryboardStageState } from './storyboardV2'

export interface ProjectStoryboardEntry {
  board: Board
  boardId: string
  boardName: string
  owner: Card
  doc: StoryboardDocV2
}

export interface StoryboardShotFilter {
  query?: string
  anchorIds?: ReadonlySet<string>
  state?: 'all' | 'needs-attention' | StoryboardStageState
  stage?: StoryboardStage
}

export interface VirtualShotWindow {
  start: number
  end: number
  offset: number
  totalHeight: number
}

export function listProjectStoryboards(project: ProjectDoc): ProjectStoryboardEntry[] {
  const result: ProjectStoryboardEntry[] = []
  for (const board of project.boards) {
    for (const owner of Object.values(board.cards)) {
      if (owner.kind !== 'text') continue
      const doc = readStoryboardDoc(owner)
      if (!doc) continue
      result.push({ board, boardId: board.id, boardName: board.name, owner, doc })
    }
  }
  return result.sort((a, b) => b.doc.updatedAt - a.doc.updatedAt || a.doc.title.localeCompare(b.doc.title))
}

export function storyboardShotSearchText(shot: StoryboardShotV2, anchors: Record<string, AssetAnchor> = {}): string {
  return [
    shot.shotNumber,
    shot.shotSize,
    shot.scene,
    shot.character,
    shot.characterDesc,
    shot.desc,
    shot.action,
    shot.emotion,
    shot.camera,
    shot.imagePrompt,
    shot.videoPrompt,
    shot.dialogue,
    shot.sfx,
    ...shot.anchorIds.flatMap((id) => {
      const anchor = anchors[id]
      return anchor ? [anchor.name, ...anchor.aliases, ...anchor.tags] : []
    })
  ].filter(Boolean).join(' ').toLocaleLowerCase()
}

export function filterStoryboardShots(
  entry: ProjectStoryboardEntry,
  anchors: Record<string, AssetAnchor>,
  filter: StoryboardShotFilter
): StoryboardShotV2[] {
  const query = (filter.query || '').trim().toLocaleLowerCase()
  const selectedAnchors = filter.anchorIds || new Set<string>()
  const stage = filter.stage || 'image'
  return entry.doc.shots.filter((shot) => {
    if (selectedAnchors.size && !shot.anchorIds.some((id) => selectedAnchors.has(id))) return false
    if (query && !storyboardShotSearchText(shot, anchors).includes(query)) return false
    if (filter.state && filter.state !== 'all') {
      const state = storyboardStageState(entry.doc, shot, entry.board, stage)
      if (filter.state === 'needs-attention') {
        if (state === 'done' || state === 'running') return false
      } else if (state !== filter.state) return false
    }
    return true
  })
}

/** 固定行高虚拟窗口；50 镜以上只渲染视口附近行。 */
export function virtualShotWindow(total: number, rowHeight: number, scrollTop: number, viewportHeight: number, overscan = 5): VirtualShotWindow {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, offset: 0, totalHeight: 0 }
  const visible = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight))
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan)
  const end = Math.min(total, start + visible + overscan * 2)
  return { start, end, offset: start * rowHeight, totalHeight: total * rowHeight }
}

export function stagePreview(card: Card | undefined, stage: StoryboardStage): string | undefined {
  if (!card) return undefined
  if (stage === 'video') {
    const meta = card.meta as Record<string, unknown>
    if (meta.posterFor === card.assetUrl && typeof meta.poster === 'string') return meta.poster
  }
  return card.assetUrl || undefined
}
