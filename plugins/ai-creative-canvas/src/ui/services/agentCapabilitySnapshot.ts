import type { AssetRole, Card, CardKind, MaterialKind, ProjectDoc, WorkflowRecipeId } from '../types'
import type { ProviderConfig, VideoProviderCapabilities } from './providers/types'
import { materialKindOfCard } from './nodeCapabilities'
import { NODE_SPEC_REGISTRY_VERSION, resolveNodeSpec, type AgentNodeAction } from './nodeSpecs'
import { resolveVideoCapabilities } from './providers/config'
import { assetAnchorsForBoard } from './semanticAssets'
import { getWorkflowRecipe } from './workflowRecipes'

export const MAX_AGENT_CAPABILITY_RESOURCES = 64
export const MAX_AGENT_CAPABILITY_BYTES = 32_000

export interface AgentCapabilityNodeV1 {
  kind: CardKind
  purpose: string
  agentActions: AgentNodeAction[]
  inputs: Array<{
    slot: string
    accepts: MaterialKind[]
    min: number
    max?: number
    orderMeaning?: string[]
  }>
  params: Array<{
    key: string
    required: boolean
    default?: unknown
    allowed?: Array<string | number>
  }>
  output: {
    kind?: MaterialKind
    cardinality: 'none' | 'one' | 'parameter'
    cardinalityParam?: string
  }
}

export interface AgentCapabilitySnapshotV1 {
  version: 1
  registryVersion: string
  board: {
    id: string
    aspect?: string
    style?: string
  }
  nodes: AgentCapabilityNodeV1[]
  providers: Array<{
    kind: 'image' | 'video' | 'audio' | 'text'
    available: boolean
    modelId?: string
    capabilities?: Record<string, unknown>
  }>
  currentBoardResources: Array<{
    id: string
    kind: CardKind
    title: string
    outputKind?: MaterialKind
    outputAvailable: boolean
    semanticRole?: AssetRole
    locked?: boolean
  }>
  limits: {
    maxPlannedNodes: number
    maxGenerationTasks: number
    crossBoardAutomaticReferences: false
  }
}

export interface AgentCapabilitySnapshotInput {
  recipe: WorkflowRecipeId
  project?: ProjectDoc
  sourceBoardId: string
  sourceCardId?: string
  aspect?: string
  textModelId?: string | null
  imageModelId?: string | null
  videoProvider?: ProviderConfig | null
  audioProvider?: ProviderConfig | null
}

export interface AgentCapabilitySnapshotResult {
  snapshot: AgentCapabilitySnapshotV1
  hash: string
  bytes: number
}

function clipped(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

function clippedStrings(values: unknown, maxItems = 32, maxChars = 80): string[] {
  return Array.isArray(values)
    ? [...new Set(values.map((value) => clipped(value, maxChars)).filter(Boolean))].slice(0, maxItems)
    : []
}

function positiveNumbers(values: unknown, maxItems = 32): number[] {
  return Array.isArray(values)
    ? [...new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b).slice(0, maxItems)
    : []
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function agentCapabilitySnapshotHash(snapshot: AgentCapabilitySnapshotV1): string {
  const text = stable(snapshot)
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `acs1-${(hash >>> 0).toString(36)}`
}

export function agentCapabilitySnapshotBytes(snapshot: AgentCapabilitySnapshotV1): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength
}

function safeVideoCapabilities(provider: ProviderConfig | null | undefined): VideoProviderCapabilities | undefined {
  if (!provider) return undefined
  const capabilities = resolveVideoCapabilities(provider)
  return {
    textToVideo: capabilities.textToVideo,
    imageToVideo: capabilities.imageToVideo,
    lastFrame: capabilities.lastFrame,
    nativeAudio: capabilities.nativeAudio,
    aspects: clippedStrings(capabilities.aspects),
    durations: positiveNumbers(capabilities.durations),
    resolutions: clippedStrings(capabilities.resolutions)
  }
}

function nodeSnapshot(kind: CardKind, videoCapabilities?: VideoProviderCapabilities): AgentCapabilityNodeV1 {
  // 能力快照声明 Provider 可达到的最大图片输入数；实际卡片仍按当前 refMode 由注册表收窄。
  const spec = resolveNodeSpec(kind, {
    videoCapabilities,
    params: kind === 'video' && videoCapabilities?.lastFrame ? { refMode: 'keyframe' } : undefined
  })
  return {
    kind,
    purpose: spec.purpose,
    agentActions: [...spec.agent.actions],
    inputs: spec.inputs.map((input) => ({
      slot: input.id,
      accepts: [...input.accepts],
      min: input.min,
      ...(input.max == null ? {} : { max: input.max }),
      ...(input.orderMeaning?.length ? { orderMeaning: [...input.orderMeaning] } : {})
    })),
    params: spec.params.map((param) => ({
      key: param.key,
      required: param.required,
      ...(param.default === undefined ? {} : { default: param.default }),
      ...(param.enum?.length ? { allowed: param.enum.map((option) => option.value) } : {})
    })),
    output: {
      ...(spec.output.materialKind ? { kind: spec.output.materialKind } : {}),
      cardinality: spec.output.cardinality,
      ...(spec.output.cardinalityParam ? { cardinalityParam: spec.output.cardinalityParam } : {})
    }
  }
}

function cardOutputAvailable(card: Card, kind: MaterialKind | null): boolean {
  if (!kind) return false
  if (kind === 'text') return !!(card.text || card.prompt).trim()
  return !!(card.assetLocalPath || card.assetUrl)
}

function boardResources(input: AgentCapabilitySnapshotInput): AgentCapabilitySnapshotV1['currentBoardResources'] {
  const board = input.project?.boards.find((candidate) => candidate.id === input.sourceBoardId)
  if (!board) return []
  const cards = Object.values(board.cards || {})
  const source = input.sourceCardId ? board.cards[input.sourceCardId] : undefined
  const contextualIds = new Set<string>([
    ...(source?.refIds || []),
    ...Object.values(board.edges || {}).filter((edge) => edge.target === source?.id).map((edge) => edge.source)
  ])
  const anchors = input.project ? assetAnchorsForBoard(input.project, input.sourceBoardId) : []
  const anchorByCardId = new Map<string, (typeof anchors)[number]>()
  for (const anchor of [...anchors].sort((left, right) => Number(right.locked) - Number(left.locked) || right.updatedAt - left.updatedAt)) {
    const cardId = anchor.source?.cardId
    if (cardId && board.cards[cardId] && !anchorByCardId.has(cardId)) anchorByCardId.set(cardId, anchor)
  }
  const priority = (card: Card): number => {
    if (card.id === source?.id) return 0
    if (contextualIds.has(card.id)) return 1
    if (anchorByCardId.get(card.id)?.locked) return 2
    if (cardOutputAvailable(card, materialKindOfCard(card))) return 3
    return 4
  }
  return cards
    .sort((left, right) => priority(left) - priority(right) || left.id.localeCompare(right.id))
    .slice(0, MAX_AGENT_CAPABILITY_RESOURCES)
    .map((card) => {
      const outputKind = materialKindOfCard(card)
      const anchor = anchorByCardId.get(card.id)
      return {
        id: clipped(card.id, 160),
        kind: card.kind,
        title: clipped(card.title || card.kind, 120),
        ...(outputKind ? { outputKind } : {}),
        outputAvailable: cardOutputAvailable(card, outputKind),
        ...(anchor ? { semanticRole: anchor.role, locked: anchor.locked } : {})
      }
    })
}

function providers(input: AgentCapabilitySnapshotInput, videoCapabilities?: VideoProviderCapabilities): AgentCapabilitySnapshotV1['providers'] {
  const textModelId = clipped(input.textModelId, 160)
  const imageModelId = clipped(input.imageModelId, 160)
  const videoModelId = clipped(input.videoProvider?.model, 160)
  const audioModelId = clipped(input.audioProvider?.ttsModel, 160)
  const audioVoice = clipped(input.audioProvider?.ttsVoice, 80)
  const audioFormat = clipped(input.audioProvider?.ttsFormat, 40)
  return [
    { kind: 'image', available: !!imageModelId, ...(imageModelId ? { modelId: imageModelId } : {}) },
    {
      kind: 'video',
      available: !!input.videoProvider,
      ...(videoModelId ? { modelId: videoModelId } : {}),
      ...(videoCapabilities ? { capabilities: { ...videoCapabilities } } : {})
    },
    {
      kind: 'audio',
      available: !!input.audioProvider,
      ...(audioModelId ? { modelId: audioModelId } : {}),
      ...(input.audioProvider ? { capabilities: { voices: audioVoice ? [audioVoice] : [], formats: audioFormat ? [audioFormat] : [] } } : {})
    },
    { kind: 'text', available: !!textModelId, ...(textModelId ? { modelId: textModelId } : {}) }
  ]
}

export function buildAgentCapabilitySnapshot(input: AgentCapabilitySnapshotInput): AgentCapabilitySnapshotResult {
  const recipe = getWorkflowRecipe(input.recipe)
  const board = input.project?.boards.find((candidate) => candidate.id === input.sourceBoardId)
  const videoCapabilities = safeVideoCapabilities(input.videoProvider)
  const snapshot: AgentCapabilitySnapshotV1 = {
    version: 1,
    registryVersion: NODE_SPEC_REGISTRY_VERSION,
    board: {
      id: clipped(input.sourceBoardId, 160),
      ...(clipped(input.aspect, 20) ? { aspect: clipped(input.aspect, 20) } : {}),
      ...(clipped(board?.style || input.project?.style, 400) ? { style: clipped(board?.style || input.project?.style, 400) } : {})
    },
    nodes: recipe.agentNodeKinds.map((kind) => nodeSnapshot(kind, videoCapabilities)),
    providers: providers(input, videoCapabilities),
    currentBoardResources: boardResources(input),
    limits: {
      maxPlannedNodes: 128,
      maxGenerationTasks: 120,
      crossBoardAutomaticReferences: false
    }
  }

  // 大画布只缩减低优先级资源；节点与 Provider 契约永不裁掉。
  while (snapshot.currentBoardResources.length > 1 && agentCapabilitySnapshotBytes(snapshot) > MAX_AGENT_CAPABILITY_BYTES) {
    snapshot.currentBoardResources.pop()
  }
  const bytes = agentCapabilitySnapshotBytes(snapshot)
  return { snapshot, hash: agentCapabilitySnapshotHash(snapshot), bytes }
}

