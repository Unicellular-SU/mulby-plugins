import type {
  AgentNodePlanV1,
  AgentParamCorrection,
  AgentPlanIssue,
  AgentPlannedInput,
  AgentPlannedNode,
  CompiledAgentOperation,
  CompiledAgentPlanV1,
  MaterialKind,
  ProjectDoc
} from '../types'
import type { AgentCapabilitySnapshotV1 } from './agentCapabilitySnapshot'
import type { ProviderConfig, VideoProviderCapabilities } from './providers/types'
import { materialKindOfCard } from './nodeCapabilities'
import { resolveNodeSpec, type NodeParamSpec } from './nodeSpecs'
import { assetAnchorsForBoard, materialFromAnchor } from './semanticAssets'
import { isUsableMaterial } from './references'

export interface AgentPlanCompileContext {
  snapshot: AgentCapabilitySnapshotV1
  project?: ProjectDoc
  videoProvider?: ProviderConfig | null
  audioProvider?: ProviderConfig | null
}

interface NormalizedNode {
  node: AgentPlannedNode
  params: Record<string, unknown>
  corrections: AgentParamCorrection[]
  dependencies: string[]
}

function issue(issues: AgentPlanIssue[], level: AgentPlanIssue['level'], category: AgentPlanIssue['category'], message: string, nodeId?: string, field?: string, autoFixed?: boolean): void {
  issues.push({ level, category, message, ...(nodeId ? { nodeId } : {}), ...(field ? { field } : {}), ...(autoFixed ? { autoFixed: true } : {}) })
}

function sameValue(left: unknown, right: unknown): boolean {
  return typeof left === 'number' || typeof right === 'number' ? Number(left) === Number(right) : left === right
}

function enumMatch(param: NodeParamSpec, value: unknown): unknown {
  const options = param.enum || []
  const exact = options.find((option) => sameValue(option.value, value))
  if (exact) return exact.value
  if (typeof value === 'string') {
    const wanted = value.trim().toLocaleLowerCase()
    return options.find((option) => String(option.value).trim().toLocaleLowerCase() === wanted)?.value
  }
  return undefined
}

function videoCapabilities(snapshot: AgentCapabilitySnapshotV1): VideoProviderCapabilities | undefined {
  const raw = snapshot.providers.find((provider) => provider.kind === 'video')?.capabilities
  if (!raw) return undefined
  return {
    textToVideo: typeof raw.textToVideo === 'boolean' ? raw.textToVideo : undefined,
    imageToVideo: typeof raw.imageToVideo === 'boolean' ? raw.imageToVideo : undefined,
    lastFrame: typeof raw.lastFrame === 'boolean' ? raw.lastFrame : undefined,
    nativeAudio: typeof raw.nativeAudio === 'boolean' ? raw.nativeAudio : undefined,
    aspects: Array.isArray(raw.aspects) ? raw.aspects.map(String) : undefined,
    durations: Array.isArray(raw.durations) ? raw.durations.map(Number).filter((value) => Number.isFinite(value) && value > 0) : undefined,
    resolutions: Array.isArray(raw.resolutions) ? raw.resolutions.map(String) : undefined
  }
}

function normalizeParams(node: AgentPlannedNode, capabilities: VideoProviderCapabilities | undefined, issues: AgentPlanIssue[]): { params: Record<string, unknown>; corrections: AgentParamCorrection[] } {
  const spec = resolveNodeSpec(node.kind, { params: node.params, videoCapabilities: node.kind === 'video' ? capabilities : undefined })
  const known = new Map(spec.params.map((param) => [param.key, param]))
  const params: Record<string, unknown> = {}
  const corrections: AgentParamCorrection[] = []
  for (const [key, value] of Object.entries(node.params || {})) {
    if (!known.has(key)) {
      corrections.push({ key, planned: value, resolved: undefined, reason: '注册表未声明该参数，已删除' })
      issue(issues, 'warning', 'plan-invalid', `「${node.title}」包含未知参数 ${key}，编译时已删除。`, node.id, key, true)
      continue
    }
    params[key] = value
  }

  for (const param of spec.params) {
    if (params[param.key] === undefined && param.default !== undefined) {
      params[param.key] = param.default
      corrections.push({ key: param.key, planned: undefined, resolved: param.default, reason: '补充注册表默认值' })
    }
  }

  if (node.kind === 'video') {
    const allowedDurations = capabilities?.durations || []
    const planned = Number(params.plannedDuration)
    const requested = Number(params.duration)
    if (Number.isFinite(planned) && planned > 0 && allowedDurations.length) {
      const covering = [...allowedDurations].sort((left, right) => left - right).find((duration) => duration + 0.05 >= planned)
      if (covering == null) {
        issue(issues, 'error', 'capability-mismatch', `「${node.title}」计划使用 ${planned}s，超过当前 Provider 单片最大 ${Math.max(...allowedDurations)}s。`, node.id, 'plannedDuration')
      } else if (!Number.isFinite(requested) || requested !== covering) {
        params.duration = covering
        corrections.push({ key: 'duration', planned: Number.isFinite(requested) ? requested : planned, resolved: covering, reason: covering > planned ? '生成可覆盖剪辑长度的原始素材，时间线自动裁切' : '映射到 Provider 合法时长' })
        issue(issues, 'info', 'capability-mismatch', `「${node.title}」成片使用 ${planned}s，Provider 将生成 ${covering}s 原始素材。`, node.id, 'duration', true)
      }
    } else if (Number.isFinite(planned) && planned > 0 && !Number.isFinite(requested)) {
      params.duration = planned
      corrections.push({ key: 'duration', planned: undefined, resolved: planned, reason: 'Provider 未声明档位，沿用计划时长' })
    }
  }

  for (const param of spec.params) {
    const raw = params[param.key]
    if (raw === undefined) {
      if (param.required) issue(issues, 'error', 'plan-invalid', `「${node.title}」缺少必填参数 ${param.key}。`, node.id, param.key)
      continue
    }
    let resolved = raw
    if (param.type === 'number') {
      const numeric = Number(raw)
      if (!Number.isFinite(numeric)) {
        issue(issues, 'error', 'plan-invalid', `「${node.title}」的参数 ${param.key} 必须是数字。`, node.id, param.key)
        continue
      }
      resolved = numeric
      if (!sameValue(raw, numeric)) corrections.push({ key: param.key, planned: raw, resolved: numeric, reason: '转换为数字' })
      if (param.min != null && numeric < param.min || param.max != null && numeric > param.max) {
        issue(issues, 'error', 'capability-mismatch', `「${node.title}」的参数 ${param.key} 超出允许范围。`, node.id, param.key)
      }
    }
    if (param.enum?.length) {
      const matched = enumMatch(param, resolved)
      if (matched === undefined) {
        issue(issues, 'error', 'capability-mismatch', `「${node.title}」的参数 ${param.key}=${String(raw)} 不在当前允许值中。`, node.id, param.key)
        continue
      }
      if (!sameValue(raw, matched)) corrections.push({ key: param.key, planned: raw, resolved: matched, reason: '规范为 Provider/注册表允许值' })
      resolved = matched
    }
    params[param.key] = resolved
  }

  return { params, corrections }
}

function cardReady(kind: MaterialKind | null, card: { text?: string | null; prompt?: string; assetUrl?: string | null; assetLocalPath?: string | null }): boolean {
  if (!kind) return false
  return kind === 'text' ? !!String(card.text || card.prompt || '').trim() : !!(card.assetUrl || card.assetLocalPath)
}

function resolveInputKind(input: AgentPlannedInput, plan: AgentNodePlanV1, context: AgentPlanCompileContext): { kind?: MaterialKind; ready: boolean } {
  if (input.sourceType === 'planned-node') {
    const upstream = plan.nodes.find((node) => node.id === input.sourceId)
    return { kind: upstream?.expectedOutput.materialKind, ready: !!upstream }
  }
  if (input.sourceType === 'card') {
    const board = context.project?.boards.find((candidate) => candidate.id === plan.boardId)
    const card = board?.cards[input.sourceId]
    const kind = card ? materialKindOfCard(card) : null
    return { kind: kind || undefined, ready: !!card && cardReady(kind, card) }
  }
  const anchor = context.project ? assetAnchorsForBoard(context.project, plan.boardId).find((candidate) => candidate.id === input.sourceId) : undefined
  return { kind: anchor?.mediaKind, ready: !!anchor && !!context.project && isUsableMaterial(materialFromAnchor(anchor, context.project)) }
}

function normalizedDependencies(node: AgentPlannedNode): string[] {
  return [...new Set([
    ...(node.dependsOn || []),
    ...node.inputs.filter((input) => input.sourceType === 'planned-node').map((input) => input.sourceId)
  ])]
}

function topologicalNodes(plan: AgentNodePlanV1, issues: AgentPlanIssue[]): AgentPlannedNode[] {
  const byId = new Map(plan.nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, number>(plan.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>(plan.nodes.map((node) => [node.id, []]))
  for (const node of plan.nodes) {
    for (const dependency of normalizedDependencies(node)) {
      if (!byId.has(dependency)) {
        issue(issues, 'error', 'plan-invalid', `「${node.title}」依赖不存在的节点 ${dependency}。`, node.id, 'dependsOn')
        continue
      }
      if (dependency === node.id) {
        issue(issues, 'error', 'plan-invalid', `「${node.title}」不能依赖自身。`, node.id, 'dependsOn')
        continue
      }
      incoming.set(node.id, (incoming.get(node.id) || 0) + 1)
      outgoing.get(dependency)!.push(node.id)
    }
  }
  const queue = plan.nodes.filter((node) => incoming.get(node.id) === 0)
  const sorted: AgentPlannedNode[] = []
  while (queue.length) {
    const node = queue.shift()!
    sorted.push(node)
    for (const target of outgoing.get(node.id) || []) {
      incoming.set(target, (incoming.get(target) || 0) - 1)
      if (incoming.get(target) === 0) queue.push(byId.get(target)!)
    }
  }
  if (sorted.length !== plan.nodes.length) {
    const cyclic = plan.nodes.filter((node) => !sorted.some((item) => item.id === node.id))
    for (const node of cyclic) issue(issues, 'error', 'plan-invalid', `「${node.title}」位于循环依赖中。`, node.id, 'dependsOn')
  }
  return [...sorted, ...plan.nodes.filter((node) => !sorted.some((item) => item.id === node.id))]
}

function validateInputs(node: AgentPlannedNode, plan: AgentNodePlanV1, context: AgentPlanCompileContext, capabilities: VideoProviderCapabilities | undefined, issues: AgentPlanIssue[]): void {
  const spec = resolveNodeSpec(node.kind, { params: node.params, videoCapabilities: node.kind === 'video' ? capabilities : undefined })
  const slots = new Map(spec.inputs.map((slot) => [slot.id, slot]))
  const counts = new Map<string, number>()
  for (const input of node.inputs) {
    const slot = slots.get(input.slot)
    if (!slot) {
      issue(issues, 'error', 'plan-invalid', `「${node.title}」使用了不存在的输入槽 ${input.slot}。`, node.id, 'inputs')
      continue
    }
    const resolved = resolveInputKind(input, plan, context)
    if (!resolved.kind) {
      issue(issues, 'error', 'input-missing', `「${node.title}」的输入 ${input.sourceId} 不存在或不属于当前画布。`, node.id, 'inputs')
      continue
    }
    if (!slot.accepts.includes(resolved.kind)) {
      issue(issues, 'error', 'capability-mismatch', `「${node.title}」的 ${input.slot} 不接受${resolved.kind}输入。`, node.id, 'inputs')
      continue
    }
    if (node.generationPolicy === 'reuse-if-ready' && !resolved.ready) {
      issue(issues, 'error', 'input-missing', `「${node.title}」计划复用的素材尚不可用。`, node.id, 'inputs')
    }
    const key = `${slot.id}:${resolved.kind}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  for (const slot of spec.inputs) {
    const total = [...counts.entries()].filter(([key]) => key.startsWith(`${slot.id}:`)).reduce((sum, [, count]) => sum + count, 0)
    if (total < slot.min) issue(issues, 'error', 'input-missing', `「${node.title}」的输入槽 ${slot.label} 至少需要 ${slot.min} 项。`, node.id, 'inputs')
    if (slot.max != null && total > slot.max) issue(issues, 'error', 'capability-mismatch', `「${node.title}」的输入槽 ${slot.label} 最多接受 ${slot.max} 项。`, node.id, 'inputs')
  }
}

function expectedQuantity(node: AgentPlannedNode, params: Record<string, unknown>): number {
  if (node.kind === 'image') return Math.max(1, Math.floor(Number(params.count) || 1))
  if (node.kind === 'group') return 0
  return node.expectedOutput.materialKind ? 1 : 0
}

function operationId(type: string, nodeId?: string): string {
  return `op-${type}${nodeId ? `-${nodeId}` : ''}`
}

export function compileAgentNodePlan(plan: AgentNodePlanV1, context: AgentPlanCompileContext): CompiledAgentPlanV1 {
  const issues: AgentPlanIssue[] = []
  const capabilities = videoCapabilities(context.snapshot)
  if (plan.boardId !== context.snapshot.board.id) issue(issues, 'error', 'plan-invalid', '节点计划画布与能力快照画布不一致。', undefined, 'boardId')
  if (plan.nodes.length > context.snapshot.limits.maxPlannedNodes) issue(issues, 'error', 'plan-invalid', `节点计划超过 ${context.snapshot.limits.maxPlannedNodes} 个节点上限。`)
  const duplicateIds = plan.nodes.filter((node, index) => plan.nodes.findIndex((candidate) => candidate.id === node.id) !== index)
  for (const node of duplicateIds) issue(issues, 'error', 'plan-invalid', `节点 ID ${node.id} 重复。`, node.id, 'id')

  const allowedNodes = new Map(context.snapshot.nodes.map((node) => [node.kind, node]))
  const ordered = topologicalNodes(plan, issues)
  const normalized = new Map<string, NormalizedNode>()
  for (const node of ordered) {
    const capability = allowedNodes.get(node.kind)
    if (!capability) {
      issue(issues, 'error', 'plan-invalid', `当前配方不允许节点类型 ${node.kind}。`, node.id, 'kind')
      continue
    }
    const localOrganizer = node.kind === 'group' && node.generationPolicy === 'materialize-only' && capability.agentActions.includes('organize')
    if (node.generationPolicy !== 'reuse-if-ready' && !localOrganizer && !capability.agentActions.includes('create')) {
      issue(issues, 'error', 'plan-invalid', `当前配方不允许创建${node.kind}节点。`, node.id, 'generationPolicy')
    }
    if (node.generationPolicy === 'generate-after-approval' && !capability.agentActions.includes('generate')) {
      issue(issues, 'error', 'plan-invalid', `当前配方不允许生成${node.kind}节点。`, node.id, 'generationPolicy')
    }
    const result = normalizeParams(node, capabilities, issues)
    validateInputs(node, plan, context, capabilities, issues)
    const expectedKind = resolveNodeSpec(node.kind).output.materialKind
    if (node.expectedOutput.materialKind !== expectedKind) {
      issue(issues, 'error', 'plan-invalid', `「${node.title}」声明的输出类型与节点实际输出不一致。`, node.id, 'expectedOutput')
    }
    const quantity = expectedQuantity(node, result.params)
    if (node.expectedOutput.quantity !== quantity) {
      issue(issues, 'error', 'plan-invalid', `「${node.title}」声明输出 ${node.expectedOutput.quantity} 项，但参数会产生 ${quantity} 项。`, node.id, 'expectedOutput.quantity')
    }
    normalized.set(node.id, { node, params: result.params, corrections: result.corrections, dependencies: normalizedDependencies(node) })
  }

  const imageAvailable = context.snapshot.providers.find((provider) => provider.kind === 'image')?.available
  const videoAvailable = context.snapshot.providers.find((provider) => provider.kind === 'video')?.available
  const textAvailable = context.snapshot.providers.find((provider) => provider.kind === 'text')?.available
  const audioAvailable = context.snapshot.providers.find((provider) => provider.kind === 'audio')?.available
  if (ordered.some((node) => (node.kind === 'image' || node.kind === 'pano') && node.generationPolicy === 'generate-after-approval') && !imageAvailable) {
    issue(issues, 'error', 'input-missing', '没有可用的图片模型，视觉设定与静帧节点无法执行。')
  }
  if (ordered.some((node) => node.kind === 'text' && node.generationPolicy === 'generate-after-approval') && !textAvailable) {
    issue(issues, 'error', 'input-missing', '没有可用的文本模型，导演创作指南无法执行。')
  }
  if (ordered.some((node) => node.kind === 'video') && !videoAvailable) {
    issue(issues, 'warning', 'input-missing', '尚未配置视频 Provider；图片阶段可继续，视频阶段会在检查点暂停。')
  }
  if (ordered.some((node) => node.kind === 'audio') && !audioAvailable) {
    issue(issues, 'warning', 'input-missing', '尚未配置音频 Provider；画面与视频阶段可继续，配音阶段会在检查点暂停。')
  }

  const invalidNodes = new Set(issues.filter((item) => item.level === 'error' && item.nodeId).map((item) => item.nodeId!))
  let propagated = true
  while (propagated) {
    propagated = false
    for (const item of normalized.values()) {
      if (invalidNodes.has(item.node.id) || !item.dependencies.some((dependency) => invalidNodes.has(dependency))) continue
      invalidNodes.add(item.node.id)
      issue(issues, 'error', 'input-missing', `「${item.node.title}」依赖无效节点，不能执行。`, item.node.id, 'dependsOn')
      propagated = true
    }
  }

  const operations: CompiledAgentOperation[] = []
  const terminalOperation = new Map<string, string>()
  for (const node of ordered) {
    const item = normalized.get(node.id)
    if (!item || invalidNodes.has(node.id)) continue
    const dependencyOperations = item.dependencies.flatMap((dependency) => {
      const operation = terminalOperation.get(dependency)
      return operation ? [operation] : []
    })
    if (node.generationPolicy === 'reuse-if-ready') {
      continue
    }
    if (node.kind === 'group') {
      const id = operationId('organize', node.id)
      operations.push({
        type: 'organize-stage-group', id, idempotencyKey: `${plan.id}:${id}`, planNodeId: node.id,
        dependsOn: dependencyOperations, title: node.title,
        color: typeof item.params.color === 'string' ? item.params.color : '#6366f1',
        memberPlanNodeIds: item.dependencies
      })
      terminalOperation.set(node.id, id)
      continue
    }
    const createId = operationId('create', node.id)
    operations.push({
      type: 'create-owned-card', id: createId, idempotencyKey: `${plan.id}:${createId}`, planNodeId: node.id,
      dependsOn: dependencyOperations, kind: node.kind, title: node.title, prompt: node.prompt,
      resolvedParams: item.params, corrections: item.corrections
    })
    const bindings = node.inputs.map((input, index) => {
      const id = operationId(`bind-${index + 1}`, node.id)
      operations.push({ type: 'bind-reference', id, idempotencyKey: `${plan.id}:${id}`, planNodeId: node.id, dependsOn: [createId], input })
      return id
    })
    if (node.generationPolicy === 'generate-after-approval') {
      const generateId = operationId('generate', node.id)
      operations.push({
        type: 'generate-card', id: generateId, idempotencyKey: `${plan.id}:${generateId}`, planNodeId: node.id,
        dependsOn: bindings.length ? bindings : [createId], quantity: node.expectedOutput.quantity
      })
      terminalOperation.set(node.id, generateId)
    } else {
      terminalOperation.set(node.id, bindings[bindings.length - 1] || createId)
    }
  }

  const continuityIds = ordered.filter((node) => !!node.semanticSubjectKind).map((node) => node.id)
  if (continuityIds.length) {
    const id = operationId('lock-continuity')
    operations.push({
      type: 'lock-anchor', id, idempotencyKey: `${plan.id}:${id}`, planNodeIds: continuityIds,
      dependsOn: continuityIds.flatMap((nodeId) => {
        const operation = terminalOperation.get(nodeId)
        return operation ? [operation] : []
      })
    })
  }
  const environmentIds = ordered.filter((node) => node.kind === 'pano').map((node) => node.id)
  if (environmentIds.length) {
    const id = operationId('director-environment')
    operations.push({
      type: 'apply-director-environment', id, idempotencyKey: `${plan.id}:${id}`, planNodeIds: environmentIds,
      dependsOn: environmentIds.flatMap((nodeId) => {
        const operation = terminalOperation.get(nodeId)
        return operation ? [operation] : []
      })
    })
  }
  const timelineIds = ordered.filter((node) => node.kind === 'video' || node.kind === 'audio').map((node) => node.id)
  if (timelineIds.length) {
    const id = operationId('timeline')
    operations.push({
      type: 'open-timeline', id, idempotencyKey: `${plan.id}:${id}`, planNodeIds: timelineIds,
      dependsOn: timelineIds.flatMap((nodeId) => {
        const operation = terminalOperation.get(nodeId)
        return operation ? [operation] : []
      })
    })
  }

  const generateOperations = operations.filter((operation) => operation.type === 'generate-card')
  const taskCount = generateOperations.reduce((sum, operation) => sum + operation.quantity, 0)
  if (taskCount > context.snapshot.limits.maxGenerationTasks) issue(issues, 'error', 'plan-invalid', `生成任务数 ${taskCount} 超过 ${context.snapshot.limits.maxGenerationTasks} 个上限。`)
  if (taskCount >= 10) issue(issues, 'warning', 'approval-required', `计划包含约 ${taskCount} 个生成任务，请分阶段确认结果。`)

  const videoPrice = context.videoProvider?.pricing
  const videoTasks = generateOperations.flatMap((operation) => {
    const node = normalized.get(operation.planNodeId)
    return node?.node.kind === 'video' ? [node] : []
  })
  const estimatedCost = videoPrice?.currency && (videoPrice.perRequest != null || videoPrice.perSecond != null)
    ? videoTasks.reduce((sum, item) => sum + (videoPrice.perRequest || 0) + (videoPrice.perSecond || 0) * Number(item.params.duration || 0), 0)
    : undefined
  if (estimatedCost != null && videoPrice?.confirmAbove != null && estimatedCost >= videoPrice.confirmAbove) {
    issue(issues, 'warning', 'approval-required', `预计视频费用达到确认阈值 ${videoPrice.currency} ${videoPrice.confirmAbove}。`)
  }

  return {
    version: 1,
    sourcePlanId: plan.id,
    registryVersion: context.snapshot.registryVersion,
    capabilitySnapshotHash: plan.capabilitySnapshotHash,
    boardId: plan.boardId,
    operations,
    issues,
    taskCount,
    ...(estimatedCost == null ? {} : { estimatedCost, currency: videoPrice?.currency }),
    requiresApproval: plan.checkpoints.some((checkpoint) => checkpoint.requiresApproval) || taskCount > 1 || issues.some((item) => item.level !== 'info')
  }
}

export function compiledPlanBlocked(plan: CompiledAgentPlanV1): boolean {
  return plan.issues.some((item) => item.level === 'error')
}
