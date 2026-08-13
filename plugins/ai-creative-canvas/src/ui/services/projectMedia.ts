import type { Card, ProjectDoc } from '../types'

export interface ProjectMediaEntry {
  id: string
  path: string
  mime: string | null
}

export interface RestoredProjectMedia {
  path: string
  url: string
  mime?: string | null
}

export interface ProjectMediaRewriteSummary {
  restoredReferences: number
  missingReferences: number
  restoredCards: number
  missingCards: number
}

export interface ProjectMediaCollectOptions {
  /** 缩略图/视频封面可重建，便携导出不带；磁盘 GC 则必须把仍在使用的派生文件算作引用。 */
  includeDerived?: boolean
}

interface GeneratedResult {
  url?: string
  localPath?: string
  mime?: string
}

interface PathRef {
  path: string
  mime: string | null
}

function generatedResults(card: Card): GeneratedResult[] {
  const value = (card.meta as { results?: unknown }).results
  return Array.isArray(value) ? value.filter((item): item is GeneratedResult => !!item && typeof item === 'object') : []
}

export function localPathFromFileUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('file:')) return null
  try {
    const url = new URL(value)
    let path = `${url.hostname ? `//${url.hostname}` : ''}${decodeURIComponent(url.pathname)}`
    if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
    return path || null
  } catch {
    let path = value.replace(/^file:\/\/+/, '/')
    try { path = decodeURIComponent(path) } catch { /* 保留原字符串 */ }
    if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
    return path || null
  }
}

function cardPathRefs(card: Card, options: ProjectMediaCollectOptions): PathRef[] {
  const refs: PathRef[] = []
  const add = (path: unknown, mime: unknown = null) => {
    if (typeof path !== 'string' || !path.trim()) return
    refs.push({ path: path.trim(), mime: typeof mime === 'string' && mime ? mime : null })
  }

  add(card.assetLocalPath, card.mime)
  for (const asset of card.assets || []) add(asset.localPath, asset.mime)
  for (const result of generatedResults(card)) add(result.localPath, result.mime || card.mime)

  const meta = card.meta as Record<string, any>
  for (const version of Array.isArray(meta.mediaVersionsV1?.items) ? meta.mediaVersionsV1.items : []) add(version?.localPath, version?.mime || card.mime)
  add(meta.sourcePath, card.mime)
  const reshoot = meta.videoReshootV1
  if (reshoot?.version === 1) {
    add(reshoot.boundary?.startPath, 'image/png')
    add(reshoot.boundary?.middlePath, 'image/png')
    add(reshoot.boundary?.endPath, 'image/png')
  }
  const analysis = meta.videoAnalysisV1
  if (analysis && analysis.version === 1) {
    add(analysis.sourcePath, card.mime || 'video/*')
    for (const shot of Array.isArray(analysis.shots) ? analysis.shots : []) {
      add(shot?.representativeFramePath, 'image/png')
      for (const frame of Array.isArray(shot?.frames) ? shot.frames : []) add(frame?.path, 'image/png')
    }
  }
  const recipe = meta.editRecipe
  if (recipe && Array.isArray(recipe.ops)) {
    for (const op of recipe.ops) {
      if (!op || typeof op !== 'object') continue
      if (op.kind === 'color') add(op.params?.lutPath, 'application/x-cube')
      if (op.kind === 'audio') add(op.params?.bgm?.path, 'audio/*')
      if (op.kind === 'replace') for (const segment of Array.isArray(op.params?.segments) ? op.params.segments : []) add(segment?.replacementPath, 'video/*')
    }
  }

  if (options.includeDerived) {
    if (meta.thumbFor === card.assetUrl) add(localPathFromFileUrl(meta.thumb), 'image/webp')
    if (meta.posterFor === card.assetUrl) add(localPathFromFileUrl(meta.poster), 'image/webp')
  }
  return refs
}

function directorTakeRefs(doc: ProjectDoc): PathRef[] {
  const refs: PathRef[] = []
  for (const shot of doc.director?.shots || []) {
    const seen = new Set<string>()
    for (const value of [shot.take, ...(shot.takes || [])]) {
      const path = localPathFromFileUrl(value)
      if (path && !seen.has(path)) {
        seen.add(path)
        refs.push({ path, mime: 'image/png' })
      }
    }
    for (const version of shot.takeVersions || []) {
      const path = version.localPath || localPathFromFileUrl(version.url)
      if (path && !seen.has(path)) {
        seen.add(path)
        refs.push({ path, mime: version.mime || 'image/png' })
      }
    }
  }
  return refs
}

function anchorPathRefs(doc: ProjectDoc): PathRef[] {
  const refs: PathRef[] = []
  for (const anchor of Object.values(doc.assetAnchors || {})) {
    const path = anchor.pinnedMedia?.assetLocalPath
    if (path) refs.push({ path, mime: anchor.pinnedMedia?.mime || null })
  }
  return refs
}

/** 收集任意卡片集合的路径，供 undo/redo 历史与剪贴板参与引用感知 GC。 */
export function collectCardsMediaPaths(cards: Iterable<Card>, options: ProjectMediaCollectOptions = {}): string[] {
  const paths = new Set<string>()
  for (const card of cards) for (const ref of cardPathRefs(card, options)) paths.add(ref.path)
  return [...paths]
}

/**
 * 收集工程 JSON 内持有的本地媒体路径。除卡片主产物/节点素材/多结果历史外，也覆盖剪辑配方的
 * source、LUT、BGM 与导演台 take；同一物理文件按路径去重，避免便携包重复膨胀。
 */
export function collectProjectMedia(doc: ProjectDoc, options: ProjectMediaCollectOptions = {}): ProjectMediaEntry[] {
  const entries: ProjectMediaEntry[] = []
  const byPath = new Map<string, ProjectMediaEntry>()
  const add = ({ path, mime }: PathRef) => {
    const known = byPath.get(path)
    if (known) {
      if (!known.mime && mime) known.mime = mime
      return
    }
    const entry = { id: `media-${entries.length + 1}`, path, mime }
    byPath.set(path, entry)
    entries.push(entry)
  }

  for (const board of doc.boards) for (const card of Object.values(board.cards)) for (const ref of cardPathRefs(card, options)) add(ref)
  for (const ref of anchorPathRefs(doc)) add(ref)
  for (const ref of directorTakeRefs(doc)) add(ref)
  return entries
}

export function collectProjectMediaPaths(doc: ProjectDoc, options: ProjectMediaCollectOptions = {}): string[] {
  return collectProjectMedia(doc, options).map((entry) => entry.path)
}

function clearDerivedMedia(card: Card): void {
  const meta = card.meta as Record<string, unknown>
  delete meta.thumb
  delete meta.thumbFor
  delete meta.poster
  delete meta.posterFor
  delete meta.fittedFor
}

function fileUrlForPath(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '')
}

/** 导入裸 JSON 时区分“同机路径仍可用”和“跨机真的缺失”，避免把所有绝对路径一律误报为裂图。 */
export async function auditProjectMediaAvailability(doc: ProjectDoc): Promise<ProjectMediaRewriteSummary> {
  const entries = collectProjectMedia(doc)
  const restored = new Map<string, RestoredProjectMedia>()
  const filesystem = window.mulby?.filesystem
  if (!filesystem?.exists) return rewriteProjectMediaPaths(doc, restored, true)
  const batchSize = 32
  for (let start = 0; start < entries.length; start += batchSize) {
    const batch = entries.slice(start, start + batchSize)
    const exists = await Promise.all(batch.map(async (entry) => {
      try { return await filesystem.exists(entry.path) } catch { return false }
    }))
    batch.forEach((entry, index) => {
      if (exists[index]) restored.set(entry.path, { path: entry.path, url: fileUrlForPath(entry.path), mime: entry.mime })
    })
  }
  return rewriteProjectMediaPaths(doc, restored, true)
}

/**
 * 把导出机的绝对路径统一重写为导入机保存后的路径。
 * 主产物、节点素材、多结果历史、锁定锚点、剪辑配方和导演台 take 必须一起迁移。
 */
export function rewriteProjectMediaPaths(
  doc: ProjectDoc,
  restoredByOldPath: ReadonlyMap<string, RestoredProjectMedia>,
  markUnmapped = true
): ProjectMediaRewriteSummary {
  let restoredReferences = 0
  let missingReferences = 0
  let restoredCards = 0
  let missingCards = 0

  const replace = (oldPath: string | null | undefined, apply: (replacement: RestoredProjectMedia) => void): boolean | null => {
    if (!oldPath) return null
    const replacement = restoredByOldPath.get(oldPath)
    if (!replacement) {
      if (markUnmapped) missingReferences++
      return false
    }
    apply(replacement)
    restoredReferences++
    return true
  }

  for (const board of doc.boards) {
    for (const card of Object.values(board.cards)) {
      const missing: string[] = []
      let restoredOnCard = 0
      let primaryTouched = false
      let primaryPathChanged = false
      const track = (label: string, outcome: boolean | null) => {
        if (outcome === true) restoredOnCard++
        else if (outcome === false && markUnmapped) missing.push(label)
      }

      if (card.assetLocalPath) {
        const oldPrimaryPath = card.assetLocalPath
        primaryTouched = true
        track('primary', replace(card.assetLocalPath, (replacement) => {
          primaryPathChanged = replacement.path !== oldPrimaryPath
          card.assetLocalPath = replacement.path
          card.assetUrl = replacement.url
          if (replacement.mime) card.mime = replacement.mime
        }))
      }

      for (let index = 0; index < (card.assets || []).length; index++) {
        const asset = card.assets[index]
        track(`input:${asset.id || index}`, replace(asset.localPath, (replacement) => {
          asset.localPath = replacement.path
          asset.url = replacement.url
          if (replacement.mime) asset.mime = replacement.mime
        }))
      }

      const results = generatedResults(card)
      for (let index = 0; index < results.length; index++) {
        const result = results[index]
        track(`result:${index}`, replace(result.localPath, (replacement) => {
          result.localPath = replacement.path
          result.url = replacement.url
          if (replacement.mime) result.mime = replacement.mime
        }))
      }

      const meta = card.meta as Record<string, any>
      for (let index = 0; index < (Array.isArray(meta.mediaVersionsV1?.items) ? meta.mediaVersionsV1.items.length : 0); index++) {
        const version = meta.mediaVersionsV1.items[index]
        track(`version:${index}`, replace(version?.localPath, (replacement) => {
          version.localPath = replacement.path
          version.url = replacement.url
          if (replacement.mime) version.mime = replacement.mime
        }))
      }
      track('recipe:source', replace(typeof meta.sourcePath === 'string' ? meta.sourcePath : null, (replacement) => { meta.sourcePath = replacement.path }))
      const reshoot = meta.videoReshootV1
      if (reshoot?.version === 1 && reshoot.boundary) {
        for (const key of ['start', 'middle', 'end'] as const) {
          track(`reshoot:${key}`, replace(reshoot.boundary[`${key}Path`], (replacement) => { reshoot.boundary[`${key}Path`] = replacement.path }))
        }
      }
      const analysis = meta.videoAnalysisV1
      if (analysis && analysis.version === 1) {
        track('analysis:source', replace(analysis.sourcePath, (replacement) => {
          analysis.sourcePath = replacement.path
          analysis.sourceAssetUrl = replacement.url
        }))
        for (let shotIndex = 0; shotIndex < (Array.isArray(analysis.shots) ? analysis.shots.length : 0); shotIndex++) {
          const shot = analysis.shots[shotIndex]
          track(`analysis:representative:${shotIndex}`, replace(shot?.representativeFramePath, (replacement) => {
            shot.representativeFramePath = replacement.path
            shot.representativeFrameUrl = replacement.url
          }))
          for (let frameIndex = 0; frameIndex < (Array.isArray(shot?.frames) ? shot.frames.length : 0); frameIndex++) {
            const frame = shot.frames[frameIndex]
            track(`analysis:frame:${shotIndex}:${frameIndex}`, replace(frame?.path, (replacement) => {
              frame.path = replacement.path
              frame.url = replacement.url
            }))
          }
        }
      }
      if (meta.editRecipe && Array.isArray(meta.editRecipe.ops)) {
        for (let index = 0; index < meta.editRecipe.ops.length; index++) {
          const op = meta.editRecipe.ops[index]
          if (op?.kind === 'color') {
            track(`recipe:lut:${index}`, replace(op.params?.lutPath, (replacement) => { op.params.lutPath = replacement.path }))
          }
          if (op?.kind === 'audio') {
            track(`recipe:bgm:${index}`, replace(op.params?.bgm?.path, (replacement) => { op.params.bgm.path = replacement.path }))
          }
          if (op?.kind === 'replace') {
            for (let segmentIndex = 0; segmentIndex < (Array.isArray(op.params?.segments) ? op.params.segments.length : 0); segmentIndex++) {
              track(`recipe:replace:${index}:${segmentIndex}`, replace(op.params.segments[segmentIndex]?.replacementPath, (replacement) => { op.params.segments[segmentIndex].replacementPath = replacement.path }))
            }
          }
        }
      }

      if (primaryPathChanged) clearDerivedMedia(card)
      if (restoredOnCard) restoredCards++
      if (missing.length) {
        card.meta = { ...card.meta, mediaMissing: true, missingMediaReferences: missing }
        missingCards++
      } else if (primaryTouched || restoredOnCard) {
        const nextMeta = { ...card.meta }
        delete nextMeta.mediaMissing
        delete nextMeta.missingMediaReferences
        card.meta = nextMeta
      }
    }
  }

  for (const anchor of Object.values(doc.assetAnchors || {})) {
    const oldPath = anchor.pinnedMedia?.assetLocalPath
    if (!oldPath || !anchor.pinnedMedia) continue
    const outcome = replace(oldPath, (replacement) => {
      const { thumbUrl: _derivedThumb, ...portableMedia } = anchor.pinnedMedia || {}
      void _derivedThumb
      anchor.pinnedMedia = {
        ...portableMedia,
        assetLocalPath: replacement.path,
        assetUrl: replacement.url,
        mime: replacement.mime || portableMedia.mime
      }
      anchor.mediaMissing = false
    })
    if (outcome === false && markUnmapped) anchor.mediaMissing = true
  }

  for (const shot of doc.director?.shots || []) {
    const remapUrl = (value: string | undefined): string | undefined => {
      const oldPath = localPathFromFileUrl(value)
      if (!oldPath) return value
      const replacement = restoredByOldPath.get(oldPath)
      if (!replacement) {
        if (markUnmapped) missingReferences++
        return value
      }
      restoredReferences++
      return replacement.url || fileUrlForPath(replacement.path)
    }
    shot.take = remapUrl(shot.take)
    if (shot.takes) shot.takes = shot.takes.map((value) => remapUrl(value) || value)
    if (shot.takeVersions) shot.takeVersions = shot.takeVersions.map((version) => {
      const oldPath = version.localPath || localPathFromFileUrl(version.url)
      if (!oldPath) return version
      const replacement = restoredByOldPath.get(oldPath)
      if (!replacement) {
        if (markUnmapped) missingReferences++
        return version
      }
      restoredReferences++
      return { ...version, localPath: replacement.path, url: replacement.url || fileUrlForPath(replacement.path), mime: replacement.mime || version.mime }
    })
  }

  return { restoredReferences, missingReferences, restoredCards, missingCards }
}
