import type { Board, Card, Material, ProjectDoc } from '../types'
import type { ProviderConfig } from './providers/types'
import { resolveVideoCapabilities } from './providers/config'
import { extractMentionTokens, resolveGenerationPrompt, selectedGenMaterials } from './references'
import { getStylePack, videoStyleTag } from './stylePacks'
import { loadImageInput } from './media'
import { effectiveVideoDuration } from './videoSpecs'

export interface CinematicPromptPlan {
  visibleAction: string
  unresolvedState: string
  subjectLocks: string[]
  spatialRelationship: string
  cameraPosition: string
  lensAndScale: string
  visualFlow: string
  temporalArc: string
  subjectMotion: string
  environmentMotion: string
  cameraMotion: string
  practicalLight: string
  colorThesis: string
  opticalConstraints: string[]
  audioDesign: string
  avoid: string[]
}

export interface DirectorPromptContext {
  cardId: string
  localPrompt: string
  resolvedPrompt: string
  hasExplicitMentions: boolean
  textInputs: { label: string; text: string }[]
  imageInputs: { label: string; role: 'reference' | 'first-frame' | 'last-frame'; material: Material }[]
  style: { id: string | null; label: string; prompt: string }
  params: {
    camera: string
    motion: string
    aspect: string
    duration: number
    resolution: string
    refMode: string
  }
  provider: {
    id: string | null
    label: string
    model: string
    textToVideo: boolean
    imageToVideo: boolean
    lastFrame: boolean
    nativeAudio: boolean
  }
  fingerprint: string
}

export interface DirectorPromptDraft {
  version: 1
  createdAt: number
  contextFingerprint: string
  localPrompt: string
  compiledPrompt: string
  plan: CinematicPromptPlan
  contextSummary: {
    textCount: number
    imageCount: number
    imageLabels: string[]
    styleLabel: string
    providerLabel: string
    usedVisualImages: number
  }
  mode: 'next-generation'
}

function ai() {
  return window.mulby.ai
}

function clip(value: unknown, max = 6000): string {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max)}\n…` : text
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function fingerprint(value: unknown): string {
  const text = stable(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `dp1-${(hash >>> 0).toString(36)}`
}

function materialVersion(material: Material, board: Board): Record<string, unknown> {
  const source = material.cardId ? board.cards[material.cardId] : undefined
  const generation = source?.meta?.imageGeneration as { completedAt?: unknown } | undefined
  return {
    id: material.matId,
    kind: material.kind,
    label: material.label,
    text: material.text || '',
    url: material.assetUrl || '',
    thumbUrl: material.thumbUrl || '',
    localPath: material.assetLocalPath || '',
    mime: material.mime || '',
    sourceCompletedAt: generation?.completedAt || ''
  }
}

/** 与真实视频生成输入同源；任何会改变最终语义的字段都进入 fingerprint。 */
export function buildDirectorPromptContext(
  card: Card,
  board: Board,
  project: ProjectDoc,
  provider?: ProviderConfig | null
): DirectorPromptContext {
  if (card.kind !== 'video') throw new Error('导演增强目前仅支持视频卡片')
  const materials = selectedGenMaterials(card, board, undefined, project)
  const resolved = resolveGenerationPrompt(card, board, 'media', project)
  const imageMaterials = materials.filter((material) => material.kind === 'image').slice(0, 2)
  const refMode = String(card.params?.refMode || 'omni')
  const imageInputs = imageMaterials.map((material, index) => ({
    label: material.label,
    role: (refMode === 'keyframe' ? index === 0 ? 'first-frame' : 'last-frame' : 'reference') as 'reference' | 'first-frame' | 'last-frame',
    material
  }))
  const styleId = board.stylePackId ?? project.stylePackId ?? null
  const pack = getStylePack(styleId)
  const stylePrompt = videoStyleTag(styleId, board.style ?? project.style)
  const capabilities = resolveVideoCapabilities(provider)
  const durationModelId = card.modelId || provider?.model
  const params = {
    camera: String(card.params?.camera || ''),
    motion: String(card.params?.motion || ''),
    aspect: String(card.params?.aspect || capabilities.aspects?.[0] || '16:9'),
    duration: effectiveVideoDuration(durationModelId, card.params?.duration, capabilities.durations),
    resolution: String(card.params?.resolution || capabilities.resolutions?.[0] || ''),
    refMode
  }
  const providerInfo = {
    id: provider?.id || null,
    label: provider?.label || '未配置视频 Provider',
    model: card.modelId || provider?.model || '',
    textToVideo: capabilities.textToVideo,
    imageToVideo: capabilities.imageToVideo,
    lastFrame: capabilities.lastFrame,
    nativeAudio: capabilities.nativeAudio
  }
  const source = {
    localPrompt: card.prompt || '',
    resolvedPrompt: resolved.text,
    hasExplicitMentions: resolved.hasExplicitMentions,
    materials: materials.map((material) => materialVersion(material, board)),
    styleId,
    stylePrompt,
    params,
    provider: providerInfo
  }
  return {
    cardId: card.id,
    localPrompt: card.prompt || '',
    resolvedPrompt: resolved.text,
    hasExplicitMentions: resolved.hasExplicitMentions,
    textInputs: resolved.inputs.texts.map((item) => ({ label: item.label, text: item.text })),
    imageInputs,
    style: { id: styleId, label: pack?.label || (stylePrompt ? '自定义风格' : '无'), prompt: stylePrompt },
    params,
    provider: providerInfo,
    fingerprint: fingerprint(source)
  }
}

function stringField(value: unknown, max = 800): string {
  return clip(typeof value === 'string' ? value : '', max)
}

function stringList(value: unknown, maxItems = 8): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => stringField(item, 220)).filter(Boolean))].slice(0, maxItems)
}

export function parseDirectorPromptResponse(value: unknown): { localPrompt: string; plan: CinematicPromptPlan } {
  let raw = typeof value === 'string' ? value : JSON.stringify(value)
  const match = raw.match(/\{[\s\S]*\}/)
  if (match) raw = match[0]
  let data: any
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('导演增强结果不是有效 JSON，请重试')
  }
  const source = data?.plan && typeof data.plan === 'object' ? data.plan : data
  const plan: CinematicPromptPlan = {
    visibleAction: stringField(source.visibleAction),
    unresolvedState: stringField(source.unresolvedState),
    subjectLocks: stringList(source.subjectLocks),
    spatialRelationship: stringField(source.spatialRelationship),
    cameraPosition: stringField(source.cameraPosition),
    lensAndScale: stringField(source.lensAndScale),
    visualFlow: stringField(source.visualFlow),
    temporalArc: stringField(source.temporalArc),
    subjectMotion: stringField(source.subjectMotion),
    environmentMotion: stringField(source.environmentMotion),
    cameraMotion: stringField(source.cameraMotion),
    practicalLight: stringField(source.practicalLight),
    colorThesis: stringField(source.colorThesis),
    opticalConstraints: stringList(source.opticalConstraints),
    audioDesign: stringField(source.audioDesign),
    avoid: stringList(source.avoid)
  }
  const useful = [plan.visibleAction, plan.cameraPosition, plan.temporalArc, plan.practicalLight, plan.colorThesis].filter(Boolean)
  if (useful.length < 3) throw new Error('导演增强结果信息不完整，请重试')
  return { localPrompt: stringField(data?.localPrompt, 2400), plan }
}

function joinLabeled(label: string, values: string[]): string {
  const items = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
  return items.length ? `${label}：${items.join('；')}` : ''
}

export function compileDirectorPrompt(
  card: Card,
  board: Board,
  context: DirectorPromptContext,
  localPrompt: string,
  plan: CinematicPromptPlan,
  project?: ProjectDoc
): string {
  const rewritten = resolveGenerationPrompt({ ...card, prompt: localPrompt }, board, 'media', project)
  // 用户原本用 @ 精确缩小了素材集时，模型误删任意一个 token 都不得改变素材集。
  // 比如原本有 @主角 + @场景，只保住 @主角 也必须回退到原解析结果。
  const lostExplicitMention = context.hasExplicitMentions && (
    !rewritten.hasExplicitMentions || missingDirectorMentionTokens(card.prompt || '', localPrompt).length > 0
  )
  const effective = lostExplicitMention ? context.resolvedPrompt : rewritten.text
  const refs = context.imageInputs.length
    ? context.params.refMode === 'keyframe' && context.imageInputs.length > 1
      ? '参考约束：第一张图是首帧，第二张图是尾帧，保持主体身份、核心结构与时空连续性，中间变化必须可解释'
      : '参考约束：保持参考图中主体身份、关键外观和起始空间关系，从现有画面自然启动运动'
    : ''
  const explicitParams = joinLabeled('生成约束', [
    context.params.aspect && `画幅 ${context.params.aspect}`,
    context.params.duration ? `时长约 ${context.params.duration} 秒` : '',
    context.params.resolution && `分辨率 ${context.params.resolution}`,
    context.params.motion && `运动幅度 ${context.params.motion}`
  ])
  const parts = [
    effective,
    joinLabeled('可见行动', [plan.visibleAction]),
    joinLabeled('未解决状态', [plan.unresolvedState]),
    joinLabeled('主体锁定', plan.subjectLocks),
    joinLabeled('空间与关系', [plan.spatialRelationship]),
    joinLabeled('构图与视线', [plan.visualFlow]),
    joinLabeled('摄影机', [plan.cameraPosition, plan.lensAndScale]),
    joinLabeled('时间变化', [plan.temporalArc]),
    joinLabeled('运动设计', [plan.subjectMotion, plan.environmentMotion, plan.cameraMotion]),
    joinLabeled('实景光线', [plan.practicalLight]),
    joinLabeled('色彩命题', [plan.colorThesis]),
    joinLabeled('成像限制', plan.opticalConstraints),
    context.provider.nativeAudio ? joinLabeled('声音', [plan.audioDesign]) : '',
    refs,
    context.style.prompt ? `风格约束：${context.style.prompt}` : '',
    explicitParams,
    joinLabeled('避免', plan.avoid)
  ].map((part) => part.trim()).filter(Boolean)
  return [...new Set(parts)].join('\n\n')
}

export function missingDirectorMentionTokens(originalPrompt: string, nextPrompt: string): string[] {
  const next = new Set(extractMentionTokens(nextPrompt))
  return [...new Set(extractMentionTokens(originalPrompt))].filter((token) => !next.has(token))
}

function modelContext(context: DirectorPromptContext): Record<string, unknown> {
  return {
    resolvedPrompt: clip(context.resolvedPrompt, 10000),
    localPrompt: clip(context.localPrompt, 3000),
    hasExplicitMentions: context.hasExplicitMentions,
    upstreamTexts: context.textInputs.map((item) => ({ label: item.label, text: clip(item.text, 5000) })),
    referenceImages: context.imageInputs.map((item) => ({ label: item.label, role: item.role })),
    style: context.style,
    params: context.params,
    provider: context.provider
  }
}

export async function generateDirectorPrompt(
  card: Card,
  board: Board,
  project: ProjectDoc,
  provider?: ProviderConfig | null
): Promise<DirectorPromptDraft> {
  const context = buildDirectorPromptContext(card, board, project, provider)
  if (!context.resolvedPrompt.trim() && !context.imageInputs.length) throw new Error('请先输入视频内容、连接上游文本或添加参考图')
  const imageContents: any[] = []
  for (const image of context.imageInputs) {
    try {
      const buffer = await loadImageInput({
        url: image.material.assetUrl || image.material.thumbUrl,
        localPath: image.material.assetLocalPath
      })
      if (!buffer) continue
      const attachment = await ai().attachments.upload({ buffer, mimeType: image.material.mime || 'image/png', purpose: 'vision' })
      imageContents.push({ type: 'image', attachmentId: attachment.attachmentId, mimeType: image.material.mime || 'image/png' })
    } catch {
      // 单张参考图读取失败不应阻断文本规划；预览会如实显示实际视觉输入数。
    }
  }
  const system = [
    '你是电影视频提示词导演和编译器。你的任务不是堆叠“电影感”形容词，而是把现有剧情、参考图和参数转换为可执行的单段视频镜头设计。',
    '先判断可见行动、人物与空间的压力关系、观众位置和视线路径，再决定机位、焦段与运镜。',
    '视频必须有可解释的时间变化：分开主体运动、环境运动和摄影机运动，只保留一个主导运动，避免所有东西同时激烈运动。',
    '光线必须有场景内的物理来源；色彩必须服务叙事；使用适量的真实光学限制，避免油亮、过度 HDR、每处同样清晰和无意义烟雾。',
    '参考图是内容和连续性约束：保护主体身份、外观、关键结构与起始空间关系，不要把它只改写成一串形容词。',
    'localPrompt 只写适合放回“本节点补充要求”的内容，不要复制上游文本或风格包原文。如原始 localPrompt 含 @素材 token，必须原样保留每个 token，不得改名或删除。',
    '只输出合法 JSON，不要 Markdown、解释或引号包裹。'
  ].join('\n')
  const schema = {
    localPrompt: '改进后的本节点补充要求',
    plan: {
      visibleAction: '镜头中能被看见的具体行动',
      unresolvedState: '当下无法立即解决的状态',
      subjectLocks: ['必须保持的主体特征'],
      spatialRelationship: '人物、道具与空间的关系',
      cameraPosition: '摄影机的物理位置与观众立场',
      lensAndScale: '焦段、景别、距离',
      visualFlow: '视线从哪进入、被什么改变、落在哪、从哪离开',
      temporalArc: '在给定时长内的起始、变化、结尾',
      subjectMotion: '主体运动',
      environmentMotion: '环境中少量有意义的运动',
      cameraMotion: '一个主导运镜',
      practicalLight: '可解释的实景光源与曝光',
      colorThesis: '主色、强调色及其场景来源',
      opticalConstraints: ['真实光学或成像限制'],
      audioDesign: '仅 Provider 支持原生音频时给出的环境声与关键声音',
      avoid: ['与当前题材相关的具体失败模式']
    }
  }
  const userText = `请根据下列实际生成上下文输出指定 JSON 结构。\n\n上下文：\n${JSON.stringify(modelContext(context), null, 2)}\n\n输出结构：\n${JSON.stringify(schema, null, 2)}`
  const content = imageContents.length ? [{ type: 'text', text: userText }, ...imageContents] : userText
  const option: any = {
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    params: { responseFormat: 'json_object' }
  }
  if (project.defaultTextModel) option.model = project.defaultTextModel
  const response = await ai().call(option)
  const parsed = parseDirectorPromptResponse(response?.content)
  const localPrompt = parsed.localPrompt || context.localPrompt
  const compiledPrompt = compileDirectorPrompt(card, board, context, localPrompt, parsed.plan, project)
  return {
    version: 1,
    createdAt: Date.now(),
    contextFingerprint: context.fingerprint,
    localPrompt,
    compiledPrompt,
    plan: parsed.plan,
    contextSummary: {
      textCount: context.textInputs.length,
      imageCount: context.imageInputs.length,
      imageLabels: context.imageInputs.map((item) => item.label),
      styleLabel: context.style.label,
      providerLabel: context.provider.label,
      usedVisualImages: imageContents.length
    },
    mode: 'next-generation'
  }
}

export function readDirectorPrompt(meta: Record<string, unknown> | null | undefined): DirectorPromptDraft | null {
  const value = meta?.directorPrompt as Partial<DirectorPromptDraft> | undefined
  if (!value || value.version !== 1 || typeof value.contextFingerprint !== 'string' || typeof value.compiledPrompt !== 'string' || !value.plan) return null
  return value as DirectorPromptDraft
}

export function directorPromptStatus(
  card: Card,
  board: Board,
  project: ProjectDoc,
  provider?: ProviderConfig | null
): { status: 'none' | 'ready' | 'stale'; draft: DirectorPromptDraft | null; context: DirectorPromptContext } {
  const context = buildDirectorPromptContext(card, board, project, provider)
  const draft = readDirectorPrompt(card.meta)
  if (!draft) return { status: 'none', draft: null, context }
  return { status: draft.contextFingerprint === context.fingerprint ? 'ready' : 'stale', draft, context }
}
