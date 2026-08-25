import type {
  AgentCommandName,
  AgentExecutionObservationV1,
  AgentPlannedNode,
  CompiledAgentOperation,
  WorkflowRun
} from '../types'
import { useGraph } from '../store/graphStore'
import { plannedNodesForCommand } from './agentNodePlan'
import { agentCardOutputFingerprint, agentNodeAttempt, agentNodeInputFingerprint, runnableAgentNodes } from './agentNodeRuntime'

function operationForCommand(run: WorkflowRun, command: AgentCommandName, node: AgentPlannedNode): CompiledAgentOperation | undefined {
  const operations = run.compiledPlan?.operations || []
  if (command === 'materialize_texts' || command === 'materialize_continuity' || command === 'materialize_environments' || command === 'materialize_images' || command === 'create_videos' || command === 'create_audio') {
    return operations.find((operation) => operation.type === 'create-owned-card' && operation.planNodeId === node.id)
  }
  if (command === 'generate_texts' || command === 'generate_continuity' || command === 'generate_environments' || command === 'generate_images' || command === 'generate_videos' || command === 'generate_audio') {
    return operations.find((operation) => operation.type === 'generate-card' && operation.planNodeId === node.id)
  }
  if (command === 'lock_continuity') {
    return operations.find((operation) => operation.type === 'lock-anchor' && operation.planNodeIds.includes(node.id))
  }
  if (command === 'prepare_timeline') {
    return operations.find((operation) => operation.type === 'open-timeline' && operation.planNodeIds.includes(node.id))
  }
  if (command === 'apply_environment') {
    return operations.find((operation) => operation.type === 'apply-director-environment' && operation.planNodeIds.includes(node.id))
  }
  if (command === 'organize_groups') {
    return operations.find((operation) => operation.type === 'organize-stage-group' && operation.planNodeId === node.id)
  }
  return undefined
}

function cardForNode(run: WorkflowRun, node: AgentPlannedNode, outputCardIds: string[], index: number) {
  const graph = useGraph.getState()
  const owned = outputCardIds.map((id) => graph.getCard(id)).find((card) => {
    const ownership = (card?.meta as any)?.workflowOwnershipV1
    return ownership?.runId === run.id && ownership?.planNodeId === node.id
  })
  return owned || graph.getCard(outputCardIds[index])
}

function resolvedParams(run: WorkflowRun, nodeId: string): Record<string, unknown> {
  const create = run.compiledPlan?.operations.find((operation) => operation.type === 'create-owned-card' && operation.planNodeId === nodeId)
  if (create?.type === 'create-owned-card') return { ...create.resolvedParams }
  const group = run.compiledPlan?.operations.find((operation) => operation.type === 'organize-stage-group' && operation.planNodeId === nodeId)
  return group?.type === 'organize-stage-group' ? { color: group.color, memberPlanNodeIds: [...group.memberPlanNodeIds] } : {}
}

function observationStatus(command: AgentCommandName): AgentExecutionObservationV1['status'] {
  return command === 'materialize_texts' || command === 'materialize_continuity' || command === 'materialize_environments'
    || command === 'materialize_images' || command === 'create_videos' || command === 'create_audio'
    ? 'created'
    : 'completed'
}

/** 将固定工作流步骤的真实卡片结果回写为结构化 observation，供恢复、解释与后续评估使用。 */
export function observeAgentCommandOutputs(run: WorkflowRun, command: AgentCommandName, outputCardIds: string[]): AgentExecutionObservationV1[] {
  const nodes = runnableAgentNodes(run, plannedNodesForCommand(run, command))
  if (!nodes.length || !run.compiledPlan) return run.observations || []
  const now = Date.now()
  const next = [...(run.observations || [])]
  for (const [index, node] of nodes.entries()) {
    const operation = operationForCommand(run, command, node)
    if (!operation) continue
    const card = cardForNode(run, node, outputCardIds, index)
    const value: AgentExecutionObservationV1 = {
      version: 1,
      runId: run.id,
      operationId: operation.id,
      planNodeId: node.id,
      ...(card ? { cardId: card.id } : {}),
      status: observationStatus(command),
      inputFingerprint: agentNodeInputFingerprint(run, node),
      ...(agentNodeAttempt(run, node.id) ? { attempt: agentNodeAttempt(run, node.id)!.count } : {}),
      ...(card ? { outputFingerprint: agentCardOutputFingerprint(card) } : {}),
      resolvedParams: card ? { ...resolvedParams(run, node.id), ...(card.params || {}) } : resolvedParams(run, node.id),
      ...(node.expectedOutput.materialKind ? {
        output: {
          materialKind: node.expectedOutput.materialKind,
          quantity: node.expectedOutput.quantity,
          assetAvailable: node.expectedOutput.materialKind === 'text'
            ? !!String(card?.text || card?.prompt || '').trim()
            : !!(card?.assetUrl || card?.assetLocalPath),
          ...(card?.mime ? { mime: card.mime } : {})
        }
      } : {}),
      completedAt: now
    }
    const existing = next.findIndex((item) => item.operationId === value.operationId && item.planNodeId === value.planNodeId)
    if (existing >= 0) next[existing] = value
    else next.push(value)
  }
  return next.slice(-500)
}

export function observeAgentCommandFailure(run: WorkflowRun, command: AgentCommandName, message: string): AgentExecutionObservationV1[] {
  const nodes = runnableAgentNodes(run, plannedNodesForCommand(run, command))
  if (!nodes.length || !run.compiledPlan) return run.observations || []
  const next = [...(run.observations || [])]
  for (const node of nodes) {
    const operation = operationForCommand(run, command, node)
    if (!operation) continue
    const value: AgentExecutionObservationV1 = {
      version: 1,
      runId: run.id,
      operationId: operation.id,
      planNodeId: node.id,
      status: 'failed',
      inputFingerprint: agentNodeInputFingerprint(run, node),
      ...(agentNodeAttempt(run, node.id) ? { attempt: agentNodeAttempt(run, node.id)!.count } : {}),
      resolvedParams: resolvedParams(run, node.id),
      error: { category: 'execution-error', message: message.slice(0, 2000), retryable: true },
      completedAt: Date.now()
    }
    const existing = next.findIndex((item) => item.operationId === value.operationId && item.planNodeId === value.planNodeId)
    if (existing >= 0) next[existing] = value
    else next.push(value)
  }
  return next.slice(-500)
}
