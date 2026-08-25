import type { ProjectDoc, WorkflowRun } from '../types'
import type { ProviderConfig } from './providers/types'
import { buildAgentCapabilitySnapshot } from './agentCapabilitySnapshot'
import { compileAgentNodePlan, compiledPlanBlocked } from './agentPlanCompiler'
import { sanitizeAgentNodePlan } from './agentNodePlan'
import { resolveModelId } from './models'

export interface AgentPlanRefreshResult {
  run: WorkflowRun
  changed: boolean
  blocked: boolean
}

/**
 * 每次续跑前重新读取本机节点与 Provider 能力，再编译本地白名单操作。
 * 工程文件里持久化的 compiledPlan 永远不会直接获得执行权限。
 */
export async function refreshAgentCompiledPlan(
  run: WorkflowRun,
  project: ProjectDoc,
  videoProvider?: ProviderConfig | null,
  audioProvider?: ProviderConfig | null
): Promise<AgentPlanRefreshResult> {
  if (!run.nodePlan) return { run, changed: false, blocked: false }
  const source = project.boards.find((board) => board.id === run.sourceBoardId)?.cards[run.sourceCardId]
  const sanitized = sanitizeAgentNodePlan(run.nodePlan, run.sourceBoardId)
  if (!source || !sanitized) {
    const compiledPlan = run.compiledPlan ? {
      ...run.compiledPlan,
      operations: [],
      issues: [{ level: 'error' as const, category: 'plan-invalid' as const, message: '节点计划或当前画布源卡片无效，请重新生成计划。' }]
    } : undefined
    return { run: { ...run, ...(compiledPlan ? { compiledPlan } : {}) }, changed: true, blocked: true }
  }
  const [textModelId, imageModelId] = await Promise.all([
    resolveModelId('text', source.modelId, project.defaultTextModel || null),
    resolveModelId('image', null, project.defaultImageModel || null)
  ])
  const capability = buildAgentCapabilitySnapshot({
    recipe: run.recipe,
    project,
    sourceBoardId: run.sourceBoardId,
    sourceCardId: run.sourceCardId,
    aspect: run.brief.aspect,
    textModelId,
    imageModelId,
    videoProvider,
    audioProvider
  })
  const nodePlan = { ...sanitized, capabilitySnapshotHash: capability.hash }
  const compiledPlan = compileAgentNodePlan(nodePlan, {
    snapshot: capability.snapshot,
    project,
    videoProvider,
    audioProvider
  })
  const changed = run.capabilitySnapshotHash !== capability.hash
    || run.capabilityRegistryVersion !== capability.snapshot.registryVersion
    || run.compiledPlan?.capabilitySnapshotHash !== capability.hash
  return {
    run: {
      ...run,
      nodePlan,
      compiledPlan,
      capabilitySnapshotHash: capability.hash,
      capabilityRegistryVersion: capability.snapshot.registryVersion
    },
    changed,
    blocked: compiledPlanBlocked(compiledPlan)
  }
}
