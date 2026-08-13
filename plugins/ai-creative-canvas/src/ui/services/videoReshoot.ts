import type { Card, StoryboardShotV2, VideoReshootRequestV1 } from '../types'
import { useGraph } from '../store/graphStore'
import { useProviders } from '../store/providerStore'
import { toast } from '../store/toastStore'
import { ensureFfmpeg, frameAt, probeResolution } from './mediaVideo'
import { toFileUrl } from './media'
import { resolveVideoCapabilities } from './providers/config'
import { readStoryboardDoc, storyboardBacklink } from './storyboardV2'
import { createOp, type EditRecipe, type EditStack } from './videoEdit/types'
import { exportStudio } from './videoEdit/run'
import { readCardMediaVersions } from './mediaVersions'

const composing = new Set<string>()

function finite(value: unknown, fallback = 0): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function normalizeReshootRange(start: number, end: number, duration: number): { start: number; end: number } {
  const max = Math.max(0.2, duration)
  const a = Math.max(0, Math.min(max - 0.1, finite(start)))
  const b = Math.max(a + 0.1, Math.min(max, finite(end, a + 1)))
  return { start: Number(a.toFixed(3)), end: Number(b.toFixed(3)) }
}

function storyboardContext(card: Card): { storyboardId?: string; shotId?: string; shot?: StoryboardShotV2 } {
  const backlink = storyboardBacklink(card)
  if (!backlink) return {}
  const graph = useGraph.getState()
  for (const board of graph.project.boards) {
    for (const owner of Object.values(board.cards)) {
      const doc = readStoryboardDoc(owner)
      if (doc?.id !== backlink.storyboardId) continue
      return { storyboardId: doc.id, shotId: backlink.shotId, shot: doc.shots.find((shot) => shot.id === backlink.shotId) }
    }
  }
  return { storyboardId: backlink.storyboardId, shotId: backlink.shotId }
}

function promptForReshoot(card: Card, shot: StoryboardShotV2 | undefined, instruction: string, start: number, end: number): string {
  const meta = card.meta as Record<string, any>
  const sent = typeof meta.videoGeneration?.sentPrompt === 'string' ? meta.videoGeneration.sentPrompt : ''
  const director = typeof meta.directorPrompt?.compiledPrompt === 'string' ? meta.directorPrompt.compiledPrompt : ''
  const original = [shot?.videoPrompt, shot?.desc, sent, director, card.prompt].find((value) => typeof value === 'string' && value.trim()) || ''
  return [
    `局部重拍原视频 ${start.toFixed(1)}s–${end.toFixed(1)}s 区间。`,
    '严格承接首帧与尾帧中的人物身份、服装、场景、光线、镜头方向和动作连续性；不要重新设计画面。',
    instruction.trim() ? `本段修改要求：${instruction.trim()}` : '本段修改要求：修复动作与画面问题，使衔接自然。',
    original ? `原镜头语境：${original}` : ''
  ].filter(Boolean).join('\n')
}

export async function prepareVideoReshoot(
  sourceCardId: string,
  start: number,
  end: number,
  instruction: string,
  originalDuration: number,
  signal?: AbortSignal
): Promise<string> {
  const graph = useGraph.getState()
  const source = graph.getCard(sourceCardId)
  const boardId = graph.boardIdOfCard(sourceCardId)
  if (!source || source.kind !== 'video' || !source.assetLocalPath || !boardId) throw new Error('原视频卡不可用')
  if (!(await ensureFfmpeg())) throw new Error('FFmpeg 未就绪')
  const range = normalizeReshootRange(start, end, originalDuration)
  const provider = useProviders.getState().activeFor('video')
  if (!provider) throw new Error('请先配置视频 Provider')
  const capabilities = resolveVideoCapabilities(provider)
  if (!capabilities.imageToVideo) throw new Error(`Provider「${provider.label}」不支持参考图生视频，无法约束重拍边界`)
  const projectId = graph.project.id
  const middle = (range.start + range.end) / 2
  const [startPath, middlePath, endPath] = await Promise.all([
    frameAt(projectId, source.assetLocalPath, range.start, signal),
    frameAt(projectId, source.assetLocalPath, middle, signal),
    frameAt(projectId, source.assetLocalPath, Math.max(range.start, range.end - 0.04), signal)
  ])
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  const context = storyboardContext(source)
  const prompt = promptForReshoot(source, context.shot, instruction, range.start, range.end)
  const board = graph.project.boards.find((item) => item.id === boardId)!
  const style = board.style ?? graph.project.style
  const stylePackId = board.stylePackId ?? graph.project.stylePackId
  const sourceMeta = source.meta as Record<string, any>
  const ids = graph.applyGraphTransaction('创建局部重拍分支', (transaction) => {
    const frameX = source.x + source.w + 140
    const y = source.y
    const makeFrame = (label: string, path: string, offset: number) => transaction.createCard('image', { x: frameX, y: y + offset }, {
      title: `${source.title} · ${label}`,
      status: 'done', progress: 1,
      assetUrl: toFileUrl(path), assetLocalPath: path, mime: 'image/png',
      refIds: [source.id],
      meta: { reshootBoundaryV1: { sourceCardId: source.id, role: label, time: label === '首帧' ? range.start : label === '尾帧' ? range.end : middle } }
    })
    const startCardId = makeFrame('首帧', startPath, 0)
    const middleCardId = makeFrame('代表帧', middlePath, 190)
    const endCardId = makeFrame('尾帧', endPath, 380)
    const request: VideoReshootRequestV1 = {
      version: 1,
      sourceCardId: source.id,
      sourceBoardId: boardId,
      range,
      originalDuration,
      boundary: { startCardId, middleCardId, endCardId, startPath, middlePath, endPath },
      context: {
        sourcePrompt: source.prompt,
        sentPrompt: typeof sourceMeta.videoGeneration?.sentPrompt === 'string' ? sourceMeta.videoGeneration.sentPrompt : undefined,
        directorPrompt: typeof sourceMeta.directorPrompt?.compiledPrompt === 'string' ? sourceMeta.directorPrompt.compiledPrompt : undefined,
        anchorIds: [...new Set([...(source.anchorRefs || []).map((ref) => ref.anchorId), ...(context.shot?.anchorIds || [])])],
        style, stylePackId, storyboardId: context.storyboardId, shotId: context.shotId
      },
      status: 'awaiting-generation',
      createdAt: Date.now()
    }
    const replacementCardId = transaction.createCard('video', { x: frameX + 360, y: y + 135 }, {
      title: `${source.title} · 重拍 ${range.start.toFixed(1)}–${range.end.toFixed(1)}s`,
      prompt,
      modelId: source.modelId || provider.model || null,
      providerId: provider.id,
      params: {
        ...source.params,
        duration: Math.max(1, Math.round(range.end - range.start)),
        refMode: capabilities.lastFrame ? 'keyframe' : 'omni'
      },
      status: 'idle',
      refIds: capabilities.lastFrame ? [startCardId, endCardId] : [startCardId, middleCardId, endCardId],
      anchorRefs: source.anchorRefs ? [...source.anchorRefs] : undefined,
      meta: { videoReshootV1: request }
    })
    transaction.ensureEdge(source.id, replacementCardId, 'flow')
    transaction.ensureEdge(startCardId, replacementCardId, 'ref')
    if (!capabilities.lastFrame) transaction.ensureEdge(middleCardId, replacementCardId, 'ref')
    transaction.ensureEdge(endCardId, replacementCardId, 'ref')
    transaction.select([replacementCardId])
    return replacementCardId
  }, boardId)
  if (!ids) throw new Error('创建局部重拍卡片失败')
  return ids
}

export async function finalizeVideoReshoot(replacementCardId: string): Promise<string | null> {
  if (composing.has(replacementCardId)) return null
  const graph = useGraph.getState()
  const replacement = graph.getCard(replacementCardId)
  const request = (replacement?.meta as Record<string, any> | undefined)?.videoReshootV1 as VideoReshootRequestV1 | undefined
  if (!replacement || replacement.kind !== 'video' || replacement.status !== 'done' || !replacement.assetLocalPath || !request || request.status === 'completed') return null
  const source = graph.getCard(request.sourceCardId)
  if (!source?.assetLocalPath) return null
  composing.add(replacementCardId)
  const patchRequest = (patch: Partial<VideoReshootRequestV1>) => {
    const current = useGraph.getState().getCard(replacementCardId)
    if (!current) return
    useGraph.getState().updateCard(replacementCardId, { meta: { ...current.meta, videoReshootV1: { ...(current.meta as any).videoReshootV1, ...patch } } })
  }
  patchRequest({ status: 'composing', error: undefined })
  try {
    if (!(await ensureFfmpeg())) throw new Error('FFmpeg 未就绪')
    const resolution = await probeResolution(graph.project.id, source.assetLocalPath)
    const replace = createOp('replace', { segments: [{ start: request.range.start, end: request.range.end, replacementCardId, replacementPath: replacement.assetLocalPath }] })
    const exp = createOp('export', { format: 'mp4' })
    const stack: EditStack = {
      version: 1,
      baseDuration: request.originalDuration,
      baseW: resolution?.width || 1920,
      baseH: resolution?.height || 1080,
      ops: [replace, exp]
    }
    const { finalOut } = await exportStudio(stack, { inPath: source.assetLocalPath, projectId: graph.project.id }, {})
    const recipe: EditRecipe = { version: 1, baseDuration: request.originalDuration, ops: stack.ops }
    const boardId = graph.boardIdOfCard(source.id) || request.sourceBoardId
    const outputId = graph.addCard('video', { x: replacement.x + replacement.w + 180, y: replacement.y }, {
      title: `${source.title} · 局部重拍成片`,
      prompt: replacement.prompt,
      modelId: replacement.modelId,
      providerId: replacement.providerId,
      params: { ...replacement.params },
      status: 'done', progress: 1,
      assetUrl: toFileUrl(finalOut), assetLocalPath: finalOut, mime: 'video/mp4',
      refIds: [source.id, replacement.id],
      anchorRefs: source.anchorRefs ? [...source.anchorRefs] : undefined,
      meta: {
        editRecipe: recipe,
        sourcePath: source.assetLocalPath,
        recipeSource: source.id,
        localReshootV1: { sourceCardId: source.id, replacementCardId: replacement.id, range: request.range, createdAt: Date.now() }
      }
    }, boardId)
    const output = graph.getCard(outputId)
    if (output) graph.updateCard(outputId, { meta: { ...output.meta, mediaVersionsV1: readCardMediaVersions(output, 'reshoot') } })
    patchRequest({ status: 'completed', outputCardId: outputId })
    graph.setSelection([outputId])
    toast('局部重拍已非破坏式回填为新成片，原视频仍保留', 'success')
    return outputId
  } catch (error: any) {
    patchRequest({ status: 'error', error: error?.message || String(error) })
    toast(`重拍片段生成成功，但自动回填失败：${error?.message || String(error)}`, 'error')
    return null
  } finally {
    composing.delete(replacementCardId)
  }
}

export function resumePendingVideoReshoots(): void {
  for (const board of useGraph.getState().project.boards) {
    for (const card of Object.values(board.cards)) {
      const request = (card.meta as Record<string, any>).videoReshootV1 as VideoReshootRequestV1 | undefined
      if (card.kind === 'video' && card.status === 'done' && request && request.status !== 'completed') void finalizeVideoReshoot(card.id)
    }
  }
}
