/**
 * Toonflow 式重构 · 阶段3（§5.1）：视频段/轨道同步。
 *
 * 时间线由 VideoTrack[] 驱动。本期默认「1 分镜 = 1 段」：syncTracksFromStoryboards 惰性补齐——
 * 保证每个分镜恰好归属一个段，移除空段（保留 kind 标记的素材段如片头/片尾），按分镜 index 排 order。
 * 幂等；在 openProject / 分镜增删改 / Agent 应用方案后调用。多分镜聚合一段作 P2。
 */
import * as P from '../../domain/persistence'
import type { ProjectDoc, VideoTrack } from '../../domain/types'

/** 惰性补齐段。返回是否有改动（便于决定是否落盘）。 */
export function syncTracksFromStoryboards(d: ProjectDoc): boolean {
  const before = JSON.stringify(d.track)
  const sbIds = new Set(d.storyboards.map((s) => s.id))
  // 去除已删分镜的引用；丢弃变空的普通段（保留素材段：有 kind 或 clipAssetId）
  d.track = d.track
    .map((t) => ({ ...t, storyboardIds: t.storyboardIds.filter((id) => sbIds.has(id)) }))
    .filter((t) => t.storyboardIds.length > 0 || !!t.kind || !!t.clipAssetId)
  const assigned = new Set<string>()
  for (const t of d.track) for (const id of t.storyboardIds) assigned.add(id)
  // 未归段分镜按 index 顺序各建 1 段
  for (const s of [...d.storyboards].sort((a, b) => a.index - b.index)) {
    if (assigned.has(s.id)) continue
    d.track.push({ id: P.newId('t_'), storyboardIds: [s.id], clipIds: [], order: d.track.length })
    assigned.add(s.id)
  }
  // 重排 order：按段内首个分镜的 index（素材段无分镜 → 排末尾，保持相对顺序）
  const idxOf = (t: VideoTrack): number => {
    const first = t.storyboardIds[0]
    const sb = first ? d.storyboards.find((s) => s.id === first) : undefined
    return sb ? sb.index : Number.MAX_SAFE_INTEGER
  }
  d.track = d.track.map((t, i) => ({ t, i })).sort((a, b) => idxOf(a.t) - idxOf(b.t) || a.i - b.i).map(({ t }) => t)
  d.track.forEach((t, i) => (t.order = i))
  return JSON.stringify(d.track) !== before
}

/** 取某分镜所属段（syncTracks 后必有） */
export function trackOfStoryboard(d: ProjectDoc, sbId: string): VideoTrack | undefined {
  return d.track.find((t) => t.storyboardIds.includes(sbId))
}

/** 段的选用片段 id（无显式选用则取首个候选） */
export function selectedClipId(t: VideoTrack): string | undefined {
  return t.selectClipId || t.clipIds[0]
}
