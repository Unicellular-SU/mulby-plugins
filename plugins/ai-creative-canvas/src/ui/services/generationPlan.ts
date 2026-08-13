import type { Card, CardKind, WorkflowRun } from '../types'
import { useGraph } from '../store/graphStore'
import { useProviders } from '../store/providerStore'
import { buildMaterials, isUsableMaterial } from './references'
import { canGenerateCard } from './nodeCapabilities'
import { resolveModelId } from './models'
import { resolveVideoCapabilities, validateProviderConfig } from './providers/config'

export type GenerationPlanIssueLevel = 'error' | 'warning' | 'info'

export interface GenerationPlanIssue {
  level: GenerationPlanIssueLevel
  message: string
  cardId?: string
}

export interface GenerationPlanItem {
  id: string
  cardId?: string
  kind: CardKind
  title: string
  quantity: number
  modelId?: string
  providerId?: string
  duration?: number
  aspect?: string
  resolution?: string
  estimatedTokens?: number
  estimatedCost?: number
  currency?: string
  confirmationThreshold?: number
}

export interface GenerationPlan {
  version: 1
  id: string
  title: string
  source: 'selection' | 'workflow'
  items: GenerationPlanItem[]
  issues: GenerationPlanIssue[]
  taskCount: number
  estimatedTokens?: number
  estimatedCost?: number
  currency?: string
  costStatus: 'known' | 'partial' | 'unknown'
  requiresConfirmation: boolean
  createdAt: number
}

function positiveInt(value: unknown, fallback = 1, max = 20): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? Math.min(max, n) : fallback
}

function numberValue(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function hasPricedCost(item: GenerationPlanItem): boolean {
  return Number.isFinite(item.estimatedCost) && !!item.currency
}

function finalize(title: string, source: GenerationPlan['source'], items: GenerationPlanItem[], issues: GenerationPlanIssue[]): GenerationPlan {
  const taskCount = items.reduce((sum, item) => sum + item.quantity, 0)
  if (taskCount >= 10) issues.push({ level: 'warning', message: `本次将创建约 ${taskCount} 个生成任务，建议分批确认结果。` })
  const thresholdExceeded = items.some((item) => item.confirmationThreshold != null && item.estimatedCost != null && item.estimatedCost >= item.confirmationThreshold)
  if (thresholdExceeded) issues.push({ level: 'warning', message: '预计费用达到 Provider 设置的确认阈值，请核对后再执行。' })
  const priced = items.filter(hasPricedCost)
  const currencies = [...new Set(priced.map((item) => item.currency!))]
  const costStatus: GenerationPlan['costStatus'] = priced.length === 0 ? 'unknown' : priced.length === items.length && currencies.length === 1 ? 'known' : 'partial'
  const estimatedCost = currencies.length === 1 ? priced.reduce((sum, item) => sum + (item.estimatedCost || 0), 0) : undefined
  const estimatedTokens = items.reduce((sum, item) => sum + (item.estimatedTokens || 0), 0) || undefined
  return {
    version: 1,
    id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title, source, items, issues, taskCount, estimatedTokens, estimatedCost,
    currency: currencies.length === 1 ? currencies[0] : undefined,
    costStatus,
    requiresConfirmation: taskCount > 1 || thresholdExceeded || issues.some((issue) => issue.level === 'error' || issue.level === 'warning'),
    createdAt: Date.now()
  }
}

async function estimateTextTokens(card: Card, modelId?: string): Promise<number | undefined> {
  try {
    const usage = await window.mulby.ai.tokens.estimate({
      ...(modelId ? { model: modelId } : {}),
      messages: [{ role: 'user', content: (card.prompt || card.text || '').slice(0, 30000) }]
    })
    return usage.inputTokens + usage.outputTokens
  } catch {
    return undefined
  }
}

export async function buildCardGenerationPlan(cardIds: string[], title = '批量生成计划'): Promise<GenerationPlan> {
  const graph = useGraph.getState()
  const items: GenerationPlanItem[] = []
  const issues: GenerationPlanIssue[] = []
  for (const cardId of [...new Set(cardIds)]) {
    const boardId = graph.boardIdOfCard(cardId)
    const board = graph.project.boards.find((item) => item.id === boardId)
    const card = board?.cards[cardId]
    if (!board || !card || !canGenerateCard(card)) continue
    if (card.status === 'running' || card.status === 'queued') {
      issues.push({ level: 'info', cardId, message: `「${card.title}」已在生成，将跳过重复提交。` })
      continue
    }
    const quantity = card.kind === 'image' || card.kind === 'pano' ? positiveInt(card.params?.count) : 1
    const item: GenerationPlanItem = { id: `item-${card.id}`, cardId, kind: card.kind, title: card.title, quantity }
    if (card.kind === 'image' || card.kind === 'pano' || card.kind === 'text') {
      const modelId = await resolveModelId(card.kind === 'text' ? 'text' : 'image', card.modelId, card.kind === 'text' ? graph.project.defaultTextModel || null : card.kind === 'pano' ? graph.project.defaultPanoModel || graph.project.defaultImageModel || null : graph.project.defaultImageModel || null)
      if (modelId) item.modelId = modelId
      else issues.push({ level: 'error', cardId, message: `「${card.title}」没有可用的${card.kind === 'text' ? '文本' : '图片'}模型。` })
      if (card.kind === 'text') item.estimatedTokens = await estimateTextTokens(card, modelId || undefined)
    } else {
      const providerKind = card.kind === 'audio' ? 'audio' : 'video'
      const provider = card.providerId
        ? useProviders.getState().providers.find((candidate) => candidate.id === card.providerId)
        : useProviders.getState().activeFor(providerKind)
      if (!provider) {
        issues.push({ level: 'error', cardId, message: `「${card.title}」没有可用的${providerKind === 'video' ? '视频' : '音频'} Provider。` })
      } else {
        item.providerId = provider.id
        item.modelId = card.modelId || provider.model
        for (const issue of validateProviderConfig(provider)) {
          issues.push({ level: issue.level, cardId, message: `「${card.title}」Provider：${issue.message}` })
        }
        if (card.kind === 'video') {
          const capabilities = resolveVideoCapabilities(provider)
          const hasImage = buildMaterials(card, board, graph.project).some((material) => material.kind === 'image' && isUsableMaterial(material))
          if (hasImage && !capabilities.imageToVideo) issues.push({ level: 'error', cardId, message: `「${card.title}」包含首帧/参考图，但当前 Provider 不支持图生视频。` })
          if (!hasImage && !capabilities.textToVideo) issues.push({ level: 'error', cardId, message: `「${card.title}」没有图片输入，而当前 Provider 不支持文生视频。` })
          item.duration = numberValue(card.params?.duration) || capabilities.durations?.[0] || 5
          item.aspect = typeof card.params?.aspect === 'string' ? card.params.aspect : capabilities.aspects?.[0] || '16:9'
          item.resolution = typeof card.params?.resolution === 'string' ? card.params.resolution : capabilities.resolutions?.[0]
          if (capabilities.durations?.length && !capabilities.durations.includes(item.duration)) issues.push({ level: 'warning', cardId, message: `「${card.title}」的 ${item.duration}s 不在 Provider 声明时长中，提交时会自动适配。` })
          if (capabilities.aspects?.length && item.aspect && !capabilities.aspects.includes(item.aspect)) issues.push({ level: 'error', cardId, message: `「${card.title}」的画幅 ${item.aspect} 不受当前 Provider 支持。` })
          if (capabilities.resolutions?.length && item.resolution && !capabilities.resolutions.includes(item.resolution)) issues.push({ level: 'error', cardId, message: `「${card.title}」的分辨率 ${item.resolution} 不受当前 Provider 支持。` })
        }
        if (provider.pricing?.currency && (provider.pricing.perRequest != null || provider.pricing.perSecond != null)) {
          item.currency = provider.pricing.currency
          item.estimatedCost = quantity * ((provider.pricing.perRequest || 0) + (provider.pricing.perSecond || 0) * (item.duration || 0))
          item.confirmationThreshold = provider.pricing.confirmAbove
        }
      }
    }
    items.push(item)
  }
  if (!items.length) issues.push({ level: 'error', message: '没有可执行的生成卡片。' })
  return finalize(title, 'selection', items, issues)
}

export async function buildWorkflowGenerationPlan(run: WorkflowRun): Promise<GenerationPlan> {
  const graph = useGraph.getState()
  const imageModelId = await resolveModelId('image', null, graph.project.defaultImageModel || null)
  const pseudoItems: GenerationPlanItem[] = run.brief.shots.map((shot, index) => ({
    id: `planned-image-${index}`,
    kind: 'image',
    title: `镜 ${shot.shotNumber || index + 1} 静帧`,
    quantity: 1,
    aspect: run.brief.aspect,
    modelId: imageModelId || undefined
  }))
  const videoProvider = useProviders.getState().activeFor('video')
  const issues: GenerationPlanIssue[] = []
  if (!imageModelId) issues.push({ level: 'error', message: '没有可用的图片模型，静帧步骤无法执行。' })
  if (!videoProvider) issues.push({ level: 'error', message: '尚未配置视频 Provider；可先确认并生成静帧，视频步骤会在此暂停。' })
  if (videoProvider) {
    for (const issue of validateProviderConfig(videoProvider)) issues.push({ level: issue.level, message: `视频 Provider：${issue.message}` })
    const capabilities = resolveVideoCapabilities(videoProvider)
    if (!capabilities.imageToVideo) issues.push({ level: 'error', message: '当前视频 Provider 不支持图生视频，无法使用镜头静帧作为首帧。' })
    if (capabilities.aspects?.length && !capabilities.aspects.includes(run.brief.aspect)) issues.push({ level: 'error', message: `当前视频 Provider 不支持计划画幅 ${run.brief.aspect}。` })
    const unsupported = run.brief.shots.map((shot) => shot.duration || 5).filter((duration) => capabilities.durations?.length && !capabilities.durations.includes(duration))
    if (unsupported.length) issues.push({ level: 'warning', message: `部分镜头时长（${[...new Set(unsupported)].join('、')}s）不在 Provider 声明范围，提交时会自动适配。` })
  }
  for (const [index, shot] of run.brief.shots.entries()) {
    const item: GenerationPlanItem = {
      id: `planned-video-${index}`,
      kind: 'video',
      title: `镜 ${shot.shotNumber || index + 1} 视频`,
      quantity: 1,
      duration: shot.duration || 5,
      aspect: run.brief.aspect,
      providerId: videoProvider?.id,
      modelId: videoProvider?.model
    }
    if (videoProvider?.pricing?.currency && (videoProvider.pricing.perRequest != null || videoProvider.pricing.perSecond != null)) {
      item.currency = videoProvider.pricing.currency
      item.estimatedCost = (videoProvider.pricing.perRequest || 0) + (videoProvider.pricing.perSecond || 0) * (item.duration || 0)
      item.confirmationThreshold = videoProvider.pricing.confirmAbove
    }
    pseudoItems.push(item)
  }
  issues.push({ level: 'info', message: '图片模型费用无法从宿主统一获得，相关费用显示为未知；执行前请以模型服务商账单为准。' })
  return finalize(`${run.brief.title} · 生成计划`, 'workflow', pseudoItems, issues)
}

export function generationPlanBlocked(plan: GenerationPlan): boolean {
  return plan.issues.some((issue) => issue.level === 'error')
}
