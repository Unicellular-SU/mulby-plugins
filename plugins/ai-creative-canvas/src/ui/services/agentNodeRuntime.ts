import type {
  AgentExecutionObservationV1,
  AgentNodeAttemptV1,
  AgentNodeDecisionV1,
  AgentPlannedNode,
  Card,
  WorkflowLogEntry,
  WorkflowRun,
  WorkflowStep
} from '../types'
import { useGraph } from '../store/graphStore'
import { uid } from '../util'
import { plannedNodesForCommand } from './agentNodePlan'

/** N4 的重试上限是保护额度，不是 Provider 的重试策略。 */
export const AGENT_NODE_MAX_ATTEMPTS = 3

function stable(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
}

function hash(value: string): string {
  let result = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 0x01000193)
  }
  return `anr1-${(result >>> 0).toString(36)}`
}

function boardFor(run: WorkflowRun) {
  return useGraph.getState().project.boards.find((board) => board.id === run.sourceBoardId)
}

function ownership(card: Card | undefined): any {
  return (card?.meta as any)?.workflowOwnershipV1
}

/** 找到同一工作流节点的卡片；复用的用户卡片通过最近 observation 绑定。 */
export function runtimeCardForNode(run: WorkflowRun, nodeId: string): Card | undefined {
  const board = boardFor(run)
  if (!board) return undefined
  const owned = Object.values(board.cards).find((card) => {
    const owner = ownership(card)
    return owner?.runId === run.id && owner?.planNodeId === nodeId && owner?.boardId === run.sourceBoardId
  })
  if (owned) return owned
  const observed = [...(run.observations || [])].reverse().find((item) => item.planNodeId === nodeId && item.cardId)
  return observed?.cardId ? board.cards[observed.cardId] : undefined
}

function cardOutputValue(card: Card | undefined): unknown {
  if (!card) return null
  const mediaState = (card.meta as any)?.mediaVersionsV1
  return {
    kind: card.kind,
    text: card.text || '',
    assetUrl: card.assetUrl || '',
    assetLocalPath: card.assetLocalPath || '',
    attachmentId: card.attachmentId || '',
    mime: card.mime || '',
    mediaCurrentId: mediaState?.currentId || ''
  }
}

export function agentCardOutputFingerprint(card: Card | undefined): string {
  return hash(stable(cardOutputValue(card)))
}

function anchorValue(run: WorkflowRun, sourceId: string): unknown {
  const anchor = useGraph.getState().project.assetAnchors?.[sourceId]
  if (!anchor || anchor.source?.boardId !== run.sourceBoardId) return null
  const source = anchor.source?.cardId ? boardFor(run)?.cards[anchor.source.cardId] : undefined
  return {
    id: anchor.id,
    revision: anchor.revision,
    locked: anchor.locked,
    description: anchor.description,
    pinnedMedia: anchor.pinnedMedia || null,
    sourceOutput: cardOutputValue(source)
  }
}

function plannedInputValue(run: WorkflowRun, sourceId: string, seen: Set<string>): unknown {
  const card = runtimeCardForNode(run, sourceId)
  if (card) return { nodeId: sourceId, output: cardOutputValue(card) }
  if (seen.has(sourceId)) return { nodeId: sourceId, cycle: true }
  const node = run.nodePlan?.nodes.find((candidate) => candidate.id === sourceId)
  if (!node) return { nodeId: sourceId, missing: true }
  const nextSeen = new Set(seen)
  nextSeen.add(sourceId)
  return { nodeId: sourceId, input: agentNodeInputFingerprint(run, node, nextSeen) }
}

/**
 * 只包含节点输入和本地卡片配置。Provider 能力快照不进入此指纹，因此切换 Provider 只会重新编译。
 */
export function agentNodeInputFingerprint(run: WorkflowRun, node: AgentPlannedNode, seen = new Set<string>()): string {
  const board = boardFor(run)
  const card = runtimeCardForNode(run, node.id)
  const references = [...node.inputs].sort((left, right) => left.priority - right.priority || left.sourceId.localeCompare(right.sourceId)).map((input) => ({
    slot: input.slot,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    purpose: input.purpose,
    value: input.sourceType === 'card'
      ? { id: input.sourceId, card: cardOutputValue(board?.cards[input.sourceId]), text: board?.cards[input.sourceId]?.text || '', prompt: board?.cards[input.sourceId]?.prompt || '' }
      : input.sourceType === 'anchor'
        ? anchorValue(run, input.sourceId)
        : plannedInputValue(run, input.sourceId, seen)
  }))
  return hash(stable({
    nodeId: node.id,
    kind: node.kind,
    prompt: node.prompt,
    params: node.params,
    expectedOutput: node.expectedOutput,
    generationPolicy: node.generationPolicy,
    cardConfig: card ? { id: card.id, prompt: card.prompt, params: card.params, refIds: card.refIds, anchorRefs: card.anchorRefs || [] } : null,
    references
  }))
}

function nodeDependencies(node: AgentPlannedNode): string[] {
  return [...new Set([
    ...node.dependsOn,
    ...node.inputs.filter((input) => input.sourceType === 'planned-node').map((input) => input.sourceId)
  ])]
}

export function agentNodeDependents(run: WorkflowRun, nodeId: string): string[] {
  const nodes = run.nodePlan?.nodes || []
  const result = new Set<string>()
  const queue = [nodeId]
  while (queue.length) {
    const current = queue.shift()!
    for (const node of nodes) {
      if (result.has(node.id) || !nodeDependencies(node).includes(current)) continue
      result.add(node.id)
      queue.push(node.id)
    }
  }
  return [...result]
}

export function rejectedAgentNodeIds(run: WorkflowRun): Set<string> {
  const result = new Set(Object.entries(run.nodeDecisions || {}).filter(([, decision]) => decision?.decision === 'rejected').map(([id]) => id))
  for (const id of [...result]) agentNodeDependents(run, id).forEach((dependent) => result.add(dependent))
  return result
}

export function runnableAgentNodes(run: WorkflowRun, nodes: AgentPlannedNode[]): AgentPlannedNode[] {
  const rejected = rejectedAgentNodeIds(run)
  return nodes.filter((node) => !rejected.has(node.id))
}

export interface AgentNodeStaleReport {
  changedNodeIds: string[]
  outputChangedNodeIds: string[]
  staleNodeIds: string[]
}

function latestObservation(run: WorkflowRun, nodeId: string): AgentExecutionObservationV1 | undefined {
  return [...(run.observations || [])].reverse().find((item) => item.planNodeId === nodeId && ['created', 'completed', 'stale'].includes(item.status))
}

/** 比较上次真实执行的输入/输出，输出变更根和需要重做的传递闭包。 */
export function inspectAgentNodeStaleness(run: WorkflowRun): AgentNodeStaleReport {
  const changed = new Set<string>()
  const outputChanged = new Set<string>()
  for (const node of run.nodePlan?.nodes || []) {
    const observation = latestObservation(run, node.id)
    if (!observation?.inputFingerprint) continue // N0-N3 旧记录没有基线，首次恢复只建立基线。
    if (agentNodeInputFingerprint(run, node) !== observation.inputFingerprint) changed.add(node.id)
    const card = runtimeCardForNode(run, node.id)
    if (observation.outputFingerprint && agentCardOutputFingerprint(card) !== observation.outputFingerprint) outputChanged.add(node.id)
  }
  // 用户编辑已完成的主设定会成为新的权威输出：保留这个节点，只把变更传播到下游。
  // 只有节点自身的输入/参数发生变化时，节点本身才需要重做。
  const stale = new Set(changed)
  for (const id of [...changed, ...outputChanged]) agentNodeDependents(run, id).forEach((dependent) => stale.add(dependent))
  return { changedNodeIds: [...changed], outputChangedNodeIds: [...outputChanged], staleNodeIds: [...stale] }
}

function markOwnedCardsStale(run: WorkflowRun, nodeIds: Iterable<string>): void {
  const target = new Set(nodeIds)
  const graph = useGraph.getState()
  const board = boardFor(run)
  if (!board) return
  for (const card of Object.values(board.cards)) {
    const owner = ownership(card)
    if (owner?.runId !== run.id || !target.has(owner.planNodeId)) continue
    graph.updateCard(card.id, { meta: { ...(card.meta || {}), storyboardInputStale: true } })
  }
}

/** 局部重做已获确认后，把“当前待重做输入”作为新基线，避免 resume 再次弹出同一 stale 提示。 */
function rebaseObservations(run: WorkflowRun, nodeIds: Iterable<string>): AgentExecutionObservationV1[] {
  const target = new Set(nodeIds)
  const nodes = new Map((run.nodePlan?.nodes || []).map((node) => [node.id, node]))
  return (run.observations || []).map((observation) => {
    const node = nodes.get(observation.planNodeId)
    if (!node || !target.has(node.id)) return observation
    return {
      ...observation,
      status: ['created', 'completed', 'stale'].includes(observation.status) ? 'stale' as const : observation.status,
      inputFingerprint: agentNodeInputFingerprint(run, node),
      outputFingerprint: agentCardOutputFingerprint(runtimeCardForNode(run, node.id))
    }
  })
}

export function resetWorkflowStepsForNodes(run: WorkflowRun, nodeIds: Iterable<string>): WorkflowStep[] {
  const target = new Set(nodeIds)
  return run.steps.map((step) => {
    const affected = plannedNodesForCommand(run, step.command).some((node) => target.has(node.id))
    if (!affected) return step
    return {
      ...step,
      status: 'pending',
      approvedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined
    }
  })
}

function runtimeLog(message: string, level: WorkflowLogEntry['level'] = 'info'): WorkflowLogEntry {
  return { id: uid('log'), at: Date.now(), level, message }
}

function saveRuntime(run: WorkflowRun): WorkflowRun {
  const next = { ...run, updatedAt: Date.now() }
  useGraph.getState().upsertWorkflowRun(next)
  return next
}

/** 把新发现的输入变化放入待确认状态，不自动消耗 Provider 额度。 */
export function stageWorkflowLocalReplan(runId: string): AgentNodeStaleReport | null {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  if (!run || run.pendingReplanNodeIds?.length) return run ? { changedNodeIds: [], outputChangedNodeIds: [], staleNodeIds: run.pendingReplanNodeIds || [] } : null
  const report = inspectAgentNodeStaleness(run)
  if (!report.staleNodeIds.length) return report
  const observations = report.outputChangedNodeIds.length
    ? (run.observations || []).map((observation) => report.outputChangedNodeIds.includes(observation.planNodeId) && observation.outputFingerprint
      ? { ...observation, outputFingerprint: agentCardOutputFingerprint(runtimeCardForNode(run, observation.planNodeId)) }
      : observation)
    : run.observations
  saveRuntime({
    ...run,
    status: 'paused',
    pendingReplanNodeIds: report.staleNodeIds,
    observations,
    logs: [...run.logs, runtimeLog(`检测到 ${report.staleNodeIds.length} 个节点的输入或上游结果已变化，等待确认局部重做。`, 'warning')].slice(-200)
  })
  return report
}

/** 用户确认后只重置受影响节点对应的步骤和 Agent 自有产物。 */
export function confirmWorkflowLocalReplan(runId: string): AgentNodeStaleReport | null {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  if (!run) return null
  const report = inspectAgentNodeStaleness(run)
  const nodeIds = new Set([...(run.pendingReplanNodeIds || []), ...report.staleNodeIds])
  if (!nodeIds.size) return { changedNodeIds: [], outputChangedNodeIds: [], staleNodeIds: [] }
  markOwnedCardsStale(run, nodeIds)
  const observations = rebaseObservations(run, nodeIds)
  saveRuntime({
    ...run,
    status: 'paused',
    pendingReplanNodeIds: undefined,
    steps: resetWorkflowStepsForNodes(run, nodeIds),
    observations,
    logs: [...run.logs, runtimeLog(`已确认局部重做：${nodeIds.size} 个节点；无关节点保持原结果。`, 'info')].slice(-200)
  })
  return { ...report, staleNodeIds: [...nodeIds] }
}

/** 节点级重试：不删除卡片，只把该节点及其依赖下游标为 stale。 */
export function retryWorkflowNode(runId: string, nodeId: string): boolean {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  if (!run?.nodePlan?.nodes.some((node) => node.id === nodeId)) return false
  const nodeIds = new Set([nodeId, ...agentNodeDependents(run, nodeId)])
  markOwnedCardsStale(run, nodeIds)
  saveRuntime({
    ...run,
    status: 'paused',
    pendingReplanNodeIds: undefined,
    steps: resetWorkflowStepsForNodes(run, nodeIds),
    observations: rebaseObservations(run, nodeIds),
    logs: [...run.logs, runtimeLog(`已准备重做「${run.nodePlan.nodes.find((node) => node.id === nodeId)?.title || nodeId}」及其 ${Math.max(0, nodeIds.size - 1)} 个下游节点。`)].slice(-200)
  })
  return true
}

export function rejectWorkflowNode(runId: string, nodeId: string, reason?: string): boolean {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  if (!run?.nodePlan?.nodes.some((node) => node.id === nodeId)) return false
  const decision: AgentNodeDecisionV1 = { version: 1, decision: 'rejected', ...(reason ? { reason: reason.slice(0, 300) } : {}), decidedAt: Date.now() }
  const affected = new Set([nodeId, ...agentNodeDependents(run, nodeId)])
  markOwnedCardsStale(run, affected)
  saveRuntime({
    ...run,
    status: 'paused',
    pendingReplanNodeIds: undefined,
    nodeDecisions: { ...(run.nodeDecisions || {}), [nodeId]: decision },
    steps: resetWorkflowStepsForNodes(run, affected),
    observations: rebaseObservations(run, affected),
    logs: [...run.logs, runtimeLog(`已排除「${run.nodePlan.nodes.find((node) => node.id === nodeId)?.title || nodeId}」；其下游节点也不会自动生成。`, 'warning')].slice(-200)
  })
  return true
}

export function restoreWorkflowNode(runId: string, nodeId: string): boolean {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  if (!run?.nodeDecisions?.[nodeId]) return false
  const { [nodeId]: _removed, ...rest } = run.nodeDecisions
  const affected = new Set([nodeId, ...agentNodeDependents(run, nodeId)])
  saveRuntime({
    ...run,
    status: 'paused',
    pendingReplanNodeIds: undefined,
    nodeDecisions: Object.keys(rest).length ? rest : undefined,
    steps: resetWorkflowStepsForNodes(run, affected),
    observations: rebaseObservations(run, affected),
    logs: [...run.logs, runtimeLog(`已恢复「${run.nodePlan?.nodes.find((node) => node.id === nodeId)?.title || nodeId}」，可继续执行。`)].slice(-200)
  })
  return true
}

export function claimAgentNodeAttempt(runId: string, nodeId: string, inputFingerprint: string): number {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  if (!run) return 0
  const current = run.nodeAttempts?.[nodeId]
  const base: AgentNodeAttemptV1 = current?.inputFingerprint === inputFingerprint
    ? current
    : { version: 1, inputFingerprint, count: 0, maxAttempts: AGENT_NODE_MAX_ATTEMPTS }
  if (base.count >= base.maxAttempts) throw new Error(`节点「${run.nodePlan?.nodes.find((node) => node.id === nodeId)?.title || nodeId}」已达到 ${base.maxAttempts} 次重试上限；请修改输入或视觉设定后再试`)
  const count = base.count + 1
  saveRuntime({
    ...run,
    nodeAttempts: { ...(run.nodeAttempts || {}), [nodeId]: { ...base, count, lastAttemptAt: Date.now() } }
  })
  return count
}

export function recordAgentNodeError(runId: string, nodeId: string, message: string): void {
  const run = useGraph.getState().project.workflowRuns?.[runId]
  const state = run?.nodeAttempts?.[nodeId]
  if (!run || !state) return
  saveRuntime({ ...run, nodeAttempts: { ...(run.nodeAttempts || {}), [nodeId]: { ...state, lastError: message.slice(0, 500) } } })
}

export function agentNodeAttempt(run: WorkflowRun, nodeId: string): AgentNodeAttemptV1 | undefined {
  return run.nodeAttempts?.[nodeId]
}
