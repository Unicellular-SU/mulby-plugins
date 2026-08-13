import type {
  Board,
  Card,
  Shot,
  VideoAnalysisFrame,
  VideoAnalysisFrameRole,
  VideoAnalysisReport,
  VideoAnalysisShot
} from '../types'
import { uid } from '../util'
import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { toast } from '../store/toastStore'
import { buildMaterials } from './references'
import { backlinkFor, createStoryboardDoc, readStoryboardDoc } from './storyboardV2'
import { frameAt, probeDuration, timedSceneFrames, toFileUrl } from './mediaVideo'

export interface VideoAnalysisRange { start: number; end: number }
export interface TranscriptCue { start: number; end: number; text: string }
export interface VideoAnalysisProgress { phase: 'detecting' | 'sampling' | 'analyzing' | 'saving'; current: number; total: number; message: string }

const inflight = new Map<string, AbortController>()

function roundTime(value: number): number {
  return Math.round(value * 1000) / 1000
}

function sameJson(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
    }
    return JSON.stringify(value)
  }
  try { return stable(a) === stable(b) } catch { return a === b }
}

function parseTimecode(value: string): number | null {
  const match = value.trim().match(/(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/)
  if (!match) return null
  const hours = Number(match[1] || 0)
  const minutes = Number(match[2] || 0)
  const seconds = Number(match[3] || 0)
  const millis = Number((match[4] || '').padEnd(3, '0') || 0)
  return hours * 3600 + minutes * 60 + seconds + millis / 1000
}

/** SRT / VTT；普通文本不伪造时间轴，返回空数组并在报告中标“未转写”。 */
export function parseTimedTranscript(value: string): TranscriptCue[] {
  const text = String(value || '').replace(/\r/g, '').replace(/^WEBVTT[^\n]*\n+/, '')
  const cues: TranscriptCue[] = []
  for (const block of text.split(/\n\s*\n+/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const timelineIndex = lines.findIndex((line) => line.includes('-->'))
    if (timelineIndex < 0) continue
    const [left, rightRaw] = lines[timelineIndex].split('-->')
    const start = parseTimecode(left)
    const end = parseTimecode((rightRaw || '').trim().split(/\s+/)[0])
    const cueText = lines.slice(timelineIndex + 1).join(' ').replace(/<[^>]+>/g, '').trim()
    if (start != null && end != null && end > start && cueText) cues.push({ start, end, text: cueText })
  }
  return cues.sort((a, b) => a.start - b.start)
}

function mergeShortestRanges(ranges: VideoAnalysisRange[], limit: number): VideoAnalysisRange[] {
  const next = ranges.map((range) => ({ ...range }))
  while (next.length > limit) {
    let index = 0
    let best = Infinity
    for (let i = 0; i < next.length - 1; i++) {
      const combined = next[i + 1].end - next[i].start
      if (combined < best) { best = combined; index = i }
    }
    next.splice(index, 2, { start: next[index].start, end: next[index + 1].end })
  }
  return next
}

/** 切点归一化并把超长无切点区间按最大分析跨度拆开。 */
export function normalizeSceneRanges(
  duration: number,
  cutTimes: number[],
  options: { minDuration?: number; maxDuration?: number; maxShots?: number } = {}
): VideoAnalysisRange[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const minDuration = Math.max(0.1, options.minDuration ?? 0.45)
  const maxDuration = Math.max(minDuration, options.maxDuration ?? 15)
  const maxShots = Math.max(1, Math.floor(options.maxShots ?? 100))
  const clean: number[] = []
  for (const raw of [...cutTimes].sort((a, b) => a - b)) {
    const value = Math.max(0, Math.min(duration, Number(raw)))
    if (!Number.isFinite(value) || value <= minDuration || duration - value <= minDuration) continue
    if (!clean.length || value - clean[clean.length - 1] >= minDuration) clean.push(value)
  }
  const boundaries = [0, ...clean, duration]
  const ranges: VideoAnalysisRange[] = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    const pieces = Math.max(1, Math.ceil((end - start) / maxDuration))
    for (let piece = 0; piece < pieces; piece++) {
      ranges.push({ start: roundTime(start + (end - start) * piece / pieces), end: roundTime(start + (end - start) * (piece + 1) / pieces) })
    }
  }
  return mergeShortestRanges(ranges, maxShots)
}

export function analysisSampleTimes(range: VideoAnalysisRange): Array<{ role: VideoAnalysisFrameRole; time: number }> {
  const duration = Math.max(0.001, range.end - range.start)
  const edge = Math.min(0.12, duration * 0.18)
  return [
    { role: 'start', time: roundTime(range.start + edge) },
    { role: 'middle', time: roundTime(range.start + duration / 2) },
    { role: 'end', time: roundTime(Math.max(range.start + edge, range.end - edge)) }
  ]
}

export function cuesForRange(cues: TranscriptCue[], range: VideoAnalysisRange): string {
  return cues.filter((cue) => cue.end > range.start && cue.start < range.end).map((cue) => cue.text).join(' / ')
}

function emptyShot(index: number, range: VideoAnalysisRange, frames: VideoAnalysisFrame[], dialogue = ''): VideoAnalysisShot {
  const middle = frames.find((frame) => frame.role === 'middle') || frames[0]
  return {
    id: uid('analysis-shot'),
    index,
    start: range.start,
    end: range.end,
    frames,
    representativeFramePath: middle?.path,
    representativeFrameUrl: middle?.url,
    scene: '', shotSize: '', composition: '', characters: '', action: '', camera: '', color: '', mood: '', learnablePrompt: '',
    dialogue,
    transcriptStatus: dialogue ? 'matched' : 'untranscribed'
  }
}

function readReportValue(raw: any, keys: string[]): string {
  for (const key of keys) {
    const value = raw?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function mergeAnalysisBatch(shots: VideoAnalysisShot[], raw: unknown): VideoAnalysisShot[] {
  const value = raw && typeof raw === 'object' ? raw as any : {}
  const items = Array.isArray(value.shots) ? value.shots : Array.isArray(value) ? value : []
  const byIndex = new Map<number, any>()
  items.forEach((item: any, offset: number) => {
    const index = Number(item?.index ?? item?.shotIndex ?? offset)
    if (Number.isFinite(index)) byIndex.set(index, item)
  })
  return shots.map((shot) => {
    const item = byIndex.get(shot.index)
    if (!item) return shot
    return {
      ...shot,
      scene: readReportValue(item, ['scene', '场景']),
      shotSize: readReportValue(item, ['shotSize', '景别']),
      composition: readReportValue(item, ['composition', '构图']),
      characters: readReportValue(item, ['characters', 'character', '人物']),
      action: readReportValue(item, ['action', '动作']),
      camera: readReportValue(item, ['camera', 'cameraObservation', '镜头变化']),
      color: readReportValue(item, ['color', 'lighting', '色彩光线']),
      mood: readReportValue(item, ['mood', 'emotion', '情绪节奏']),
      learnablePrompt: readReportValue(item, ['learnablePrompt', 'prompt', '可学习提示词'])
    }
  })
}

function parseJson(content: unknown): unknown {
  let text = typeof content === 'string'
    ? content.trim()
    : Array.isArray(content)
      ? content.flatMap((item: any) => item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []).join('').trim()
      : ''
  const match = text.match(/\{[\s\S]*\}/)
  if (match) text = match[0]
  try { return JSON.parse(text) } catch { throw new Error('视觉拉片结果不是合法 JSON，请重试') }
}

const VIDEO_ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['index', 'scene', 'shotSize', 'composition', 'characters', 'action', 'camera', 'color', 'mood', 'learnablePrompt'],
        properties: {
          index: { type: 'integer', minimum: 0 },
          scene: { type: 'string' },
          shotSize: { type: 'string' },
          composition: { type: 'string' },
          characters: { type: 'string' },
          action: { type: 'string' },
          camera: { type: 'string' },
          color: { type: 'string' },
          mood: { type: 'string' },
          learnablePrompt: { type: 'string' }
        }
      }
    }
  }
} as const

async function resolveVisionModel(preferred?: string): Promise<string | undefined> {
  try {
    const models = await window.mulby.ai.allModels()
    const candidates = models.filter((model) => model.endpointType !== 'image-generation' && model.endpointType !== 'jina-rerank')
    const supportsVision = (model: (typeof candidates)[number]) => model.capabilities?.some((capability) => capability.type === 'vision')
    const selected = preferred ? candidates.find((model) => model.id === preferred) : undefined
    if (selected && (supportsVision(selected) || !selected.capabilities?.length)) return selected.id
    return candidates.find(supportsVision)?.id || selected?.id || candidates[0]?.id
  } catch {
    return preferred
  }
}

async function analyzeBatch(batch: VideoAnalysisShot[], modelId: string | undefined, signal: AbortSignal): Promise<VideoAnalysisShot[]> {
  const imageItems: any[] = []
  const uploadedIds: string[] = []
  try {
    for (const shot of batch) {
      imageItems.push({ type: 'text', text: `镜头索引 ${shot.index}，时间 ${shot.start.toFixed(2)}–${shot.end.toFixed(2)} 秒；以下依次为首帧、中帧、尾帧。${shot.dialogue ? `字幕：${shot.dialogue}` : '没有带时间码的字幕，不要猜台词。'}` })
      for (const frame of shot.frames) {
        if (signal.aborted) throw new DOMException('已取消', 'AbortError')
        const attachment = await window.mulby.ai.attachments.upload({ filePath: frame.path, mimeType: 'image/png', purpose: 'vision' })
        uploadedIds.push(attachment.attachmentId)
        imageItems.push({ type: 'image', attachmentId: attachment.attachmentId, mimeType: 'image/png' })
      }
    }
    const option: any = {
      messages: [
        {
          role: 'system',
          content: '你是专业影视拉片分析师。每个镜头都有首/中/尾三帧，只描述画面可验证的信息；镜头变化只能根据三帧差异谨慎判断，不得把单帧臆测成精确运镜。不要猜对白。输出合法 JSON：{"shots":[{"index":数字,"scene":"场景","shotSize":"景别","composition":"构图与视觉重心","characters":"人物与关键物体","action":"帧间可见动作变化","camera":"可从三帧验证的镜头变化；无法判断则写无法确定","color":"光线与色彩","mood":"情绪与节奏","learnablePrompt":"可复用的中文视频生成提示词"}]}。不要 markdown。'
        },
        { role: 'user', content: imageItems }
      ],
      params: {
        responseFormat: 'json_schema',
        jsonSchema: VIDEO_ANALYSIS_SCHEMA,
        jsonSchemaName: 'video_analysis_report',
        strict: true
      }
    }
    if (modelId) option.model = modelId
    let requestId = ''
    const request = window.mulby.ai.call(option, (chunk: any) => {
      if (chunk?.__requestId) requestId = chunk.__requestId
    })
    const abort = () => { if (requestId) window.mulby.ai.abort(requestId) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await request
      if (signal.aborted) throw new DOMException('已取消', 'AbortError')
      return mergeAnalysisBatch(batch, parseJson(response?.content))
    } finally {
      signal.removeEventListener('abort', abort)
    }
  } finally {
    await Promise.allSettled(uploadedIds.map((id) => window.mulby.ai.attachments.delete(id)))
  }
}

function transcriptCues(card: Card, board: Board): TranscriptCue[] {
  const cues: TranscriptCue[] = []
  for (const material of buildMaterials(card, board, useGraph.getState().project)) {
    if (material.kind !== 'text' || !material.text) continue
    cues.push(...parseTimedTranscript(material.text))
  }
  return cues.sort((a, b) => a.start - b.start)
}

async function unlink(paths: string[]): Promise<void> {
  await Promise.allSettled([...new Set(paths)].map((path) => window.mulby.filesystem.unlink(path)))
}

export async function createVideoAnalysisReport(
  cardId: string,
  options: { threshold?: number; maxShots?: number; maxSegmentDuration?: number; modelId?: string } = {},
  onProgress?: (progress: VideoAnalysisProgress) => void,
  externalSignal?: AbortSignal
): Promise<VideoAnalysisReport> {
  const graph = useGraph.getState()
  const boardId = graph.boardIdOfCard(cardId)
  const board = graph.project.boards.find((item) => item.id === boardId)
  const card = board?.cards[cardId]
  if (!board || !card || card.kind !== 'video' || !card.assetLocalPath || !card.assetUrl) throw new Error('请先为视频卡关联本地视频文件')
  if (inflight.has(cardId)) throw new Error('该视频正在拉片')
  const controller = new AbortController()
  inflight.set(cardId, controller)
  const relayAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', relayAbort, { once: true })
  const threshold = Math.max(0.1, Math.min(0.9, Number(options.threshold ?? 0.4)))
  const maxShots = Math.max(1, Math.min(100, Math.floor(options.maxShots ?? 60)))
  const createdPaths: string[] = []
  useTask.getState().inc()
  try {
    onProgress?.({ phase: 'detecting', current: 0, total: 1, message: '探测时长与场景切点…' })
    const duration = await probeDuration(card.assetLocalPath, controller.signal)
    if (!duration) throw new Error('无法读取视频时长')
    const cutFrames = await timedSceneFrames(graph.project.id, card.assetLocalPath, threshold, Math.max(1, maxShots - 1), controller.signal)
    const ranges = normalizeSceneRanges(duration, cutFrames.map((item) => item.time), { maxDuration: options.maxSegmentDuration ?? 15, maxShots })
    await unlink(cutFrames.map((item) => item.path))
    if (!ranges.length) throw new Error('没有可分析的视频区间')
    const cues = transcriptCues(card, board)
    const shots: VideoAnalysisShot[] = []
    for (let index = 0; index < ranges.length; index++) {
      if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      const range = ranges[index]
      const frames: VideoAnalysisFrame[] = []
      for (const sample of analysisSampleTimes(range)) {
        onProgress?.({ phase: 'sampling', current: index * 3 + frames.length, total: ranges.length * 3, message: `抽取镜头 ${index + 1}/${ranges.length} 的${sample.role === 'start' ? '首' : sample.role === 'middle' ? '中' : '尾'}帧…` })
        const path = await frameAt(graph.project.id, card.assetLocalPath, sample.time, controller.signal)
        createdPaths.push(path)
        frames.push({ ...sample, path, url: toFileUrl(path) })
      }
      const dialogue = cuesForRange(cues, range)
      shots.push(emptyShot(index, range, frames, dialogue))
    }
    let analyzed = shots
    const modelId = await resolveVisionModel(options.modelId || graph.project.defaultTextModel || undefined)
    const batchSize = 4
    for (let start = 0; start < shots.length; start += batchSize) {
      if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      const end = Math.min(shots.length, start + batchSize)
      onProgress?.({ phase: 'analyzing', current: start, total: shots.length, message: `视觉分析镜头 ${start + 1}–${end}/${shots.length}…` })
      const result = await analyzeBatch(analyzed.slice(start, end), modelId, controller.signal)
      analyzed = [...analyzed.slice(0, start), ...result, ...analyzed.slice(end)]
    }
    const now = Date.now()
    const report: VideoAnalysisReport = {
      version: 1,
      id: uid('video-analysis'),
      sourceCardId: card.id,
      sourceAssetUrl: card.assetUrl,
      sourcePath: card.assetLocalPath,
      duration,
      threshold,
      sampleStrategy: 'start-middle-end',
      shots: analyzed,
      modelId,
      createdAt: now,
      updatedAt: now
    }
    onProgress?.({ phase: 'saving', current: 1, total: 1, message: '保存拉片报告…' })
    const current = useGraph.getState().getCard(cardId)
    if (!current || current.assetUrl !== report.sourceAssetUrl) throw new Error('源视频已变化，拉片结果未写入')
    useGraph.getState().updateCard(cardId, { meta: { ...(current.meta || {}), videoAnalysisV1: report } })
    return report
  } catch (error) {
    await unlink(createdPaths)
    throw error
  } finally {
    externalSignal?.removeEventListener('abort', relayAbort)
    inflight.delete(cardId)
    useTask.getState().dec()
  }
}

export function cancelVideoAnalysis(cardId: string): boolean {
  const controller = inflight.get(cardId)
  if (!controller) return false
  controller.abort()
  return true
}

export function readVideoAnalysisReport(card: Card | undefined): VideoAnalysisReport | null {
  const report = (card?.meta as Record<string, unknown> | undefined)?.videoAnalysisV1 as VideoAnalysisReport | undefined
  if (!report || report.version !== 1 || !Array.isArray(report.shots) || report.sourceCardId !== card?.id) return null
  return report
}

export function updateVideoAnalysisShot(cardId: string, shotId: string, patch: Partial<VideoAnalysisShot>): VideoAnalysisReport | null {
  const current = useGraph.getState().getCard(cardId)
  const report = readVideoAnalysisReport(current)
  if (!current || !report) return null
  let changed = false
  const shots = report.shots.map((shot) => {
    if (shot.id !== shotId) return shot
    changed = true
    return { ...shot, ...patch, id: shot.id, index: shot.index, start: shot.start, end: shot.end, frames: shot.frames }
  })
  if (!changed) return report
  const next = { ...report, shots, updatedAt: Date.now() }
  useGraph.getState().updateCard(cardId, { meta: { ...(current.meta || {}), videoAnalysisV1: next } })
  return next
}

export function formatVideoAnalysisReport(report: VideoAnalysisReport): string {
  return report.shots.map((shot) => [
    `镜头 ${shot.index + 1}｜${shot.start.toFixed(2)}–${shot.end.toFixed(2)}s｜${shot.shotSize || '景别未定'}`,
    shot.scene && `场景：${shot.scene}`,
    shot.characters && `人物/物体：${shot.characters}`,
    shot.composition && `构图：${shot.composition}`,
    shot.action && `动作：${shot.action}`,
    shot.camera && `镜头变化：${shot.camera}`,
    shot.color && `光色：${shot.color}`,
    shot.mood && `情绪节奏：${shot.mood}`,
    `对白：${shot.transcriptStatus === 'matched' ? shot.dialogue : '未转写'}`,
    shot.learnablePrompt && `可学习提示词：${shot.learnablePrompt}`
  ].filter(Boolean).join('\n')).join('\n\n')
}

function analysisShotAsStoryboard(shot: VideoAnalysisShot): Shot {
  return {
    shotNumber: shot.index + 1,
    desc: [shot.composition, shot.characters, shot.action].filter(Boolean).join('；') || shot.scene || `视频镜头 ${shot.index + 1}`,
    scene: shot.scene,
    character: shot.characters,
    action: shot.action,
    emotion: shot.mood,
    shotSize: shot.shotSize,
    camera: shot.camera,
    duration: roundTime(shot.end - shot.start),
    dialogue: shot.transcriptStatus === 'matched' ? shot.dialogue : undefined,
    imagePrompt: [shot.scene, shot.characters, shot.composition, shot.color, shot.mood].filter(Boolean).join('，'),
    videoPrompt: shot.learnablePrompt || [shot.shotSize, shot.action, shot.camera, shot.mood].filter(Boolean).join('，'),
    sourceRange: { start: shot.start, end: shot.end }
  } as Shot & { sourceRange: { start: number; end: number } }
}

function analysisBacklink(report: VideoAnalysisReport, shot: VideoAnalysisShot) {
  return { reportId: report.id, sourceCardId: report.sourceCardId, shotId: shot.id }
}

export function materializeVideoAnalysisFrames(cardId: string, report: VideoAnalysisReport): string[] {
  const graph = useGraph.getState()
  const boardId = graph.boardIdOfCard(cardId)
  const board = graph.project.boards.find((item) => item.id === boardId)
  const source = board?.cards[cardId]
  if (!boardId || !board || !source) return []
  let result: string[] = []
  graph.applyGraphTransaction('落地拉片代表帧', (tx) => {
    const ids: string[] = []
    report.shots.forEach((shot, index) => {
      if (!shot.representativeFramePath || !shot.representativeFrameUrl) return
      const existing = Object.values(board.cards).find((candidate) => {
        const link = (candidate.meta as any)?.videoAnalysisBacklink
        return candidate.kind === 'image' && link?.reportId === report.id && link?.shotId === shot.id
      })
      const x = source.x + source.w + 120 + (index % 4) * 190
      const y = source.y + Math.floor(index / 4) * 150
      if (existing && tx.getCard(existing.id)) {
        tx.updateCard(existing.id, { x, y, title: `${source.title} · 镜头${index + 1}`, assetUrl: shot.representativeFrameUrl, assetLocalPath: shot.representativeFramePath, mime: 'image/png', status: 'done' })
        ids.push(existing.id)
      } else {
        const id = tx.createCard('image', { x: x + 80, y: y + 60 }, {
          w: 160, h: 120, title: `${source.title} · 镜头${index + 1}`, prompt: shot.scene || shot.learnablePrompt,
          status: 'done', refIds: [source.id],
          assetUrl: shot.representativeFrameUrl, assetLocalPath: shot.representativeFramePath, mime: 'image/png',
          meta: { resourceRole: 'source', videoAnalysisBacklink: analysisBacklink(report, shot) }
        })
        tx.updateCard(id, { x, y })
        ids.push(id)
      }
    })
    tx.select(ids)
    result = ids
  }, boardId)
  return result
}

export function convertVideoAnalysisToStoryboard(cardId: string, report: VideoAnalysisReport, includeFrames = true): { ownerId: string; frameIds: string[] } | null {
  const graph = useGraph.getState()
  const boardId = graph.boardIdOfCard(cardId)
  const board = graph.project.boards.find((item) => item.id === boardId)
  const source = board?.cards[cardId]
  if (!boardId || !board || !source) return null
  let result: { ownerId: string; frameIds: string[] } | null = null
  graph.applyGraphTransaction('拉片转故事板', (tx) => {
    let owner = Object.values(board.cards).find((candidate) => (candidate.meta as any)?.videoAnalysisReportId === report.id)
    let ownerId = owner?.id
    if (!ownerId || !tx.getCard(ownerId)) {
      ownerId = tx.createCard('text', { x: source.x, y: source.y + source.h + 180 }, {
        title: `${source.title} · 拉片故事板`,
        text: formatVideoAnalysisReport(report),
        meta: { videoAnalysisReportId: report.id, videoAnalysisSourceCardId: source.id }
      })
      owner = tx.getCard(ownerId)
    }
    if (!owner) return
    const previous = readStoryboardDoc(owner)
    let doc = createStoryboardDoc(owner, report.shots.map(analysisShotAsStoryboard), previous)
    doc = {
      ...doc,
      shots: doc.shots.map((shot, index) => ({ ...shot, sourceRange: { start: report.shots[index].start, end: report.shots[index].end } }))
    }
    const frameIds: string[] = []
    if (includeFrames) {
      const shots = doc.shots.map((storyShot, index) => {
        const analysisShot = report.shots[index]
        if (!analysisShot?.representativeFramePath || !analysisShot.representativeFrameUrl) return storyShot
        let frameCard = Object.values(board.cards).find((candidate) => {
          const link = (candidate.meta as any)?.videoAnalysisBacklink
          return candidate.kind === 'image' && link?.reportId === report.id && link?.shotId === analysisShot.id
        })
        let frameId = frameCard?.id
        const x = owner!.x + owner!.w + 140
        const y = owner!.y + index * 350
        const candidateMeta = { ...(frameCard?.meta || {}), videoAnalysisBacklink: analysisBacklink(report, analysisShot), storyboardBacklink: backlinkFor(doc, storyShot, 'image') }
        const meta = frameCard && sameJson(frameCard.meta, candidateMeta) ? frameCard.meta : candidateMeta
        if (frameId && tx.getCard(frameId)) {
          tx.updateCard(frameId, { x, y, title: `镜${index + 1}·代表帧`, assetUrl: analysisShot.representativeFrameUrl, assetLocalPath: analysisShot.representativeFramePath, mime: 'image/png', status: 'done', meta })
        } else {
          frameId = tx.createCard('image', { x: x + 140, y: y + 160 }, {
            w: 280, h: 320, title: `镜${index + 1}·代表帧`, prompt: storyShot.imagePrompt || storyShot.desc,
            status: 'done', assetUrl: analysisShot.representativeFrameUrl, assetLocalPath: analysisShot.representativeFramePath,
            mime: 'image/png', refIds: [source.id], meta
          })
          tx.updateCard(frameId, { x, y })
        }
        tx.ensureEdge(ownerId!, frameId)
        frameIds.push(frameId)
        return { ...storyShot, imageCardId: frameId }
      })
      doc = { ...doc, shots, updatedAt: Date.now() }
    }
    if (previous) {
      const candidate = { ...doc, updatedAt: previous.updatedAt }
      if (sameJson(candidate, previous)) doc = previous
    }
    const ownerNow = tx.getCard(ownerId)!
    const candidateMeta = { ...(ownerNow.meta || {}), videoAnalysisReportId: report.id, videoAnalysisSourceCardId: source.id, storyboardV2: doc }
    tx.updateCard(ownerId, {
      text: formatVideoAnalysisReport(report),
      meta: sameJson(ownerNow.meta, candidateMeta) ? ownerNow.meta : candidateMeta
    })
    tx.select([ownerId, ...frameIds])
    result = { ownerId, frameIds }
  }, boardId)
  if (result) toast(includeFrames ? '已转换为故事板并落地代表帧' : '已转换为故事板', 'success')
  return result
}
