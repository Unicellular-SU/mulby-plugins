import type { AgentCommandName, WorkflowOwnershipV1, WorkflowRun, WorkflowStep } from '../types'
import { useGraph } from '../store/graphStore'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import { generateCard } from './generate'
import { materializeStoryboardAudio, materializeStoryboardShots, saveStoryboardDoc, shotToVideo } from './storyboard'
import { createStoryboardDoc, readStoryboardDoc } from './storyboardV2'
import { buildCardGenerationPlan, generationPlanBlocked } from './generationPlan'
import { resolveVideoCapabilities } from './providers/config'
import { coveringVideoDuration } from './videoSpecs'
import { isWorkflowVisualAnchorName, lockWorkflowContinuity, orderWorkflowContinuityCards, prepareWorkflowContinuity, refreshWorkflowContinuityInputs, workflowStylePrompt } from './workflowContinuity'
import { assetAnchorsForBoard } from './semanticAssets'
import { plannedNodesForCommand, spokenDialogue } from './agentNodePlan'
import {
  applyWorkflowPrimaryEnvironment,
  materializeWorkflowPlanCards,
  organizeWorkflowStageGroups,
  resolvedPlanInputCardIds,
  workflowOwnershipForNode
} from './agentPlanMaterialization'
import {
  agentNodeInputFingerprint,
  claimAgentNodeAttempt,
  recordAgentNodeError,
  rejectedAgentNodeIds,
  runnableAgentNodes
} from './agentNodeRuntime'

export const AGENT_COMMANDS = new Set<AgentCommandName>([
  'save_storyboard', 'materialize_texts', 'generate_texts',
  'materialize_continuity', 'generate_continuity', 'lock_continuity',
  'materialize_environments', 'generate_environments', 'apply_environment',
  'materialize_images', 'generate_images',
  'create_videos', 'generate_videos', 'create_audio', 'generate_audio',
  'organize_groups', 'prepare_timeline'
])

function outputOf(run: WorkflowRun, command: AgentCommandName): string[] {
  return run.steps.find((step) => step.command === command)?.outputCardIds || []
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError')
}

function workflowOwnership(run: WorkflowRun, planNodeId: string): WorkflowOwnershipV1 {
  return workflowOwnershipForNode(run, planNodeId)
}

function currentStoryboard(run: WorkflowRun) {
  const owner = useGraph.getState().getCard(run.sourceCardId)
  if (!owner) throw new Error('源文本卡片已不存在')
  const doc = readStoryboardDoc(owner)
  if (!doc) throw new Error('故事板尚未保存')
  return { owner, doc }
}

function planNodeIdForCard(run: WorkflowRun | undefined, cardId: string): string | undefined {
  if (!run) return undefined
  const card = useGraph.getState().getCard(cardId)
  const owner = (card?.meta as any)?.workflowOwnershipV1
  if (owner?.runId === run.id && typeof owner.planNodeId === 'string') return owner.planNodeId
  return [...(run.observations || [])].reverse().find((observation) => observation.cardId === cardId)?.planNodeId
}

async function generateCards(ids: string[], signal: AbortSignal, run?: WorkflowRun): Promise<string[]> {
  const unique = [...new Set(ids)].filter((id) => !!useGraph.getState().getCard(id))
  const rejected = run ? rejectedAgentNodeIds(run) : new Set<string>()
  const executable = unique.filter((id) => {
    const nodeId = planNodeIdForCard(run, id)
    return !nodeId || !rejected.has(nodeId)
  })
  const plan = await buildCardGenerationPlan(executable, '工作流步骤预检')
  if (generationPlanBlocked(plan)) throw new Error(plan.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join('；'))
  // 节点尝试先逐个登记，避免 Promise.all 下两个任务同时把次数写回为同一个值。
  const claim = new Map<string, string>()
  if (run) {
    for (const id of executable) {
      const card = useGraph.getState().getCard(id)
      if (!card || (card.status === 'done' && !(card.meta as any)?.storyboardInputStale) || card.status === 'running' || card.status === 'queued') continue
      const nodeId = planNodeIdForCard(run, id)
      const node = nodeId ? run.nodePlan?.nodes.find((candidate) => candidate.id === nodeId) : undefined
      if (!nodeId || !node) continue
      const fingerprint = agentNodeInputFingerprint(run, node)
      claimAgentNodeAttempt(run.id, nodeId, fingerprint)
      claim.set(id, nodeId)
    }
  }
  await Promise.all(executable.map(async (id) => {
    ensureNotAborted(signal)
    const card = useGraph.getState().getCard(id)
    const stale = !!(card?.meta as any)?.storyboardInputStale
    if (!card || (card.status === 'done' && !stale)) return
    try {
      if (card.status !== 'running' && card.status !== 'queued') await generateCard(id)
      while (true) {
        ensureNotAborted(signal)
        const current = useGraph.getState().getCard(id)
        if (!current) throw new Error('生成中的卡片已被删除')
        if (current.status === 'done') return
        if (current.status === 'error') throw new Error(`${current.title}：${current.error || '生成失败'}`)
        if (current.status === 'idle') throw new Error(`${current.title}：生成已停止`)
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    } catch (error: any) {
      const nodeId = claim.get(id)
      if (run && nodeId) recordAgentNodeError(run.id, nodeId, error?.message || String(error))
      throw error
    }
  }))
  return executable
}

export async function executeAgentCommand(run: WorkflowRun, step: WorkflowStep, signal: AbortSignal): Promise<string[]> {
  if (!AGENT_COMMANDS.has(step.command)) throw new Error(`不允许的 Agent 命令：${step.command}`)
  ensureNotAborted(signal)
  const graph = useGraph.getState()
  if (!graph.project.boards.some((board) => board.id === run.sourceBoardId)) throw new Error('工作流发起画布已不存在')
  // generateCard 按活动画布读取节点；每一步先回到任务所属画布，避免用户切换画布后生成错板或停在 idle。
  if (graph.project.activeBoardId !== run.sourceBoardId) graph.setActiveBoard(run.sourceBoardId)
  if (step.command === 'save_storyboard') {
    const owner = useGraph.getState().getCard(run.sourceCardId)
    if (!owner || owner.kind !== 'text') throw new Error('源文本卡片已不存在')
    const previous = readStoryboardDoc(owner)
    const anchors = assetAnchorsForBoard(useGraph.getState().project, run.sourceBoardId)
    const stylePrompt = workflowStylePrompt(run)
    const withStyle = (prompt: string | undefined) => {
      const current = String(prompt || '').trim()
      if (!stylePrompt || current.includes(stylePrompt)) return current
      return [current, `视觉风格：${stylePrompt}`].filter(Boolean).join('\n')
    }
    const shots = run.brief.shots.map((shot) => ({
      ...shot,
      imagePrompt: withStyle(shot.imagePrompt),
      videoPrompt: withStyle(shot.videoPrompt),
      anchorIds: [...new Set((shot.anchorNames || []).filter(isWorkflowVisualAnchorName).flatMap((name) => {
        const normalized = name.trim().toLocaleLowerCase()
        const anchor = anchors.find((candidate) => candidate.name.toLocaleLowerCase() === normalized || candidate.aliases.some((alias) => alias.toLocaleLowerCase() === normalized))
        return anchor ? [anchor.id] : []
      }))]
    }))
    const doc = createStoryboardDoc(owner, shots, previous)
    if (!saveStoryboardDoc(owner.id, doc)) throw new Error('故事板保存失败')
    return [owner.id]
  }
  if (step.command === 'materialize_texts') {
    return materializeWorkflowPlanCards(run, step.command)
  }
  if (step.command === 'generate_texts') {
    return generateCards(outputOf(run, 'materialize_texts'), signal, run)
  }
  if (step.command === 'materialize_continuity') {
    const nodes = runnableAgentNodes(run, plannedNodesForCommand(run, step.command))
    const ids = prepareWorkflowContinuity(run, nodes.length || run.nodePlan ? new Set(nodes.map((node) => node.id)) : undefined)
    nodes.forEach((node, index) => {
      const card = useGraph.getState().getCard(ids[index])
      const ownership = (card?.meta as any)?.workflowOwnershipV1 as WorkflowOwnershipV1 | undefined
      if (!card || ownership?.runId !== run.id || ownership.planNodeId !== node.id) return
      const refs = [...new Set([...card.refIds, ...resolvedPlanInputCardIds(run, node)])]
      useGraph.getState().updateCard(card.id, { refIds: refs })
    })
    return ids
  }
  if (step.command === 'generate_continuity') {
    const rejected = rejectedAgentNodeIds(run)
    const ids = outputOf(run, 'materialize_continuity').filter((id) => {
      const owner = (useGraph.getState().getCard(id)?.meta as any)?.workflowOwnershipV1
      return owner?.runId !== run.id || !rejected.has(owner?.planNodeId)
    })
    if (!ids.length) return []
    const pending = ids.filter((id) => {
      const card = useGraph.getState().getCard(id)
      return !!card && (!(card.assetUrl || card.assetLocalPath) || !!(card.meta as any)?.storyboardInputStale)
    })
    for (const id of orderWorkflowContinuityCards(run, pending)) {
      ensureNotAborted(signal)
      refreshWorkflowContinuityInputs(run, id)
      await generateCards([id], signal, run)
    }
    return ids
  }
  if (step.command === 'lock_continuity') {
    // 先把用户当前选择/局部编辑后的主图重新固定；随后只重生成依赖已变化的派生设定图。
    const planned = plannedNodesForCommand(run, step.command)
    const allowed = planned.length || run.nodePlan ? new Set(runnableAgentNodes(run, planned).map((node) => node.id)) : undefined
    const initiallyLocked = lockWorkflowContinuity(run, allowed)
    const recordedIds = outputOf(run, 'materialize_continuity').filter((id) => {
      const owner = (useGraph.getState().getCard(id)?.meta as any)?.workflowOwnershipV1
      return owner?.runId !== run.id || !allowed || allowed.has(owner?.planNodeId)
    })
    const ids = recordedIds.length ? recordedIds : initiallyLocked
    for (const id of orderWorkflowContinuityCards(run, ids)) refreshWorkflowContinuityInputs(run, id)
    const stale = ids.filter((id) => {
      const card = useGraph.getState().getCard(id)
      return !!card && !!(card.meta as any)?.workflowContinuityV1 && !!(card.meta as any)?.storyboardInputStale
    })
    if (!stale.length) return initiallyLocked
    for (const id of orderWorkflowContinuityCards(run, stale)) {
      ensureNotAborted(signal)
      refreshWorkflowContinuityInputs(run, id)
      await generateCards([id], signal, run)
    }
    return lockWorkflowContinuity(run, allowed)
  }
  if (step.command === 'materialize_environments') {
    return materializeWorkflowPlanCards(run, step.command)
  }
  if (step.command === 'generate_environments') {
    const rejected = rejectedAgentNodeIds(run)
    const ids = outputOf(run, 'materialize_environments').filter((id) => {
      const owner = (useGraph.getState().getCard(id)?.meta as any)?.workflowOwnershipV1
      return owner?.runId !== run.id || !rejected.has(owner?.planNodeId)
    })
    for (const id of ids) {
      ensureNotAborted(signal)
      await generateCards([id], signal, run)
    }
    return ids
  }
  if (step.command === 'apply_environment') {
    return applyWorkflowPrimaryEnvironment(run)
  }
  if (step.command === 'materialize_images') {
    const { owner, doc } = currentStoryboard(run)
    const planned = plannedNodesForCommand(run, step.command)
    const allowed = planned.length || run.nodePlan ? new Set(runnableAgentNodes(run, planned).map((node) => node.id)) : undefined
    const selectedShotIds = allowed ? new Set(doc.shots.flatMap((_shot, index) => allowed.has(`shot-image-${index + 1}`) ? [doc.shots[index].id] : [])) : undefined
    const result = materializeStoryboardShots(owner.id, doc, selectedShotIds && selectedShotIds.size < doc.shots.length ? selectedShotIds : undefined, {
      aspect: run.brief.aspect,
      ownershipForShot: (_shot, index) => planned[index] ? workflowOwnership(run, planned[index].id) : undefined,
      refIdsForShot: (_shot, index) => planned[index] ? resolvedPlanInputCardIds(run, planned[index]) : []
    })
    if (!result) throw new Error('镜头静帧卡片落地失败')
    return result.cardIds
  }
  if (step.command === 'generate_images') {
    const ids = outputOf(run, 'materialize_images')
    if (!ids.length) throw new Error('没有可生成的镜头静帧卡片')
    return generateCards(ids, signal, run)
  }
  if (step.command === 'create_videos') {
    const { doc } = currentStoryboard(run)
    const planned = plannedNodesForCommand(run, step.command)
    const allowed = planned.length || run.nodePlan ? new Set(runnableAgentNodes(run, planned).map((node) => node.id)) : undefined
    const provider = useProviders.getState().activeFor('video')
    const capabilities = resolveVideoCapabilities(provider)
    const ids = doc.shots.flatMap((shot, index) => {
      if (allowed && !allowed.has(`shot-video-${index + 1}`)) return []
      if (!shot.imageCardId) return []
      const image = useGraph.getState().getCard(shot.imageCardId)
      if (!image || image.status !== 'done') return []
      const plannedDuration = shot.duration || 5
      const generationDuration = provider ? coveringVideoDuration(provider.model, plannedDuration, capabilities.durations) : plannedDuration
      if (generationDuration + 0.05 < plannedDuration) throw new Error(`镜头 ${shot.shotNumber || shot.order + 1} 的计划时长 ${plannedDuration}s 超过当前 Provider 最大生成时长 ${generationDuration}s，请拆分镜头或更换 Provider`)
      const videoId = shotToVideo(image.id, {
        aspect: run.brief.aspect,
        plannedDuration,
        generationDuration,
        ...(planned[index] ? { ownership: workflowOwnership(run, planned[index].id) } : {})
      })
      return videoId ? [videoId] : []
    })
    if (!ids.length) throw new Error('没有已完成静帧可用于创建视频卡，请先检查静帧结果')
    return [...new Set(ids)]
  }
  if (step.command === 'generate_videos') {
    const ids = outputOf(run, 'create_videos')
    if (!ids.length) throw new Error('没有可生成的视频卡片')
    return generateCards(ids, signal, run)
  }
  if (step.command === 'create_audio') {
    const { owner, doc } = currentStoryboard(run)
    const planned = plannedNodesForCommand(run, step.command)
    const allowed = planned.length || run.nodePlan ? new Set(runnableAgentNodes(run, planned).map((node) => node.id)) : undefined
    const provider = useProviders.getState().activeFor('audio')
    const result = materializeStoryboardAudio(owner.id, doc, {
      speechForShot: (shot, index) => !allowed || allowed.has(`shot-audio-${index + 1}`) ? spokenDialogue(shot.dialogue) : '',
      ownershipForShot: (_shot, index) => {
        const node = !allowed || allowed.has(`shot-audio-${index + 1}`) ? planned.find((candidate) => candidate.id === `shot-audio-${index + 1}`) : undefined
        return node ? workflowOwnership(run, node.id) : undefined
      },
      paramsForShot: (_shot, index) => {
        const node = !allowed || allowed.has(`shot-audio-${index + 1}`) ? planned.find((candidate) => candidate.id === `shot-audio-${index + 1}`) : undefined
        const operation = node && run.compiledPlan?.operations.find((candidate) => candidate.type === 'create-owned-card' && candidate.planNodeId === node.id)
        const params = operation?.type === 'create-owned-card' ? operation.resolvedParams : {}
        const voice = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(provider?.ttsVoice || '') ? provider!.ttsVoice : params.voice
        const format = ['mp3', 'wav', 'opus'].includes(provider?.ttsFormat || '') ? provider!.ttsFormat : params.format
        return { ...params, ...(voice ? { voice } : {}), ...(format ? { format } : {}) }
      }
    })
    if (!result) throw new Error('配音卡片落地失败')
    return result.cardIds
  }
  if (step.command === 'generate_audio') {
    const ids = outputOf(run, 'create_audio')
    if (!ids.length) return []
    for (const id of ids) {
      ensureNotAborted(signal)
      await generateCards([id], signal, run)
    }
    return ids
  }
  if (step.command === 'organize_groups') {
    return organizeWorkflowStageGroups(run)
  }
  const ids = [...new Set([
    ...outputOf(run, 'generate_videos'),
    ...outputOf(run, 'generate_audio')
  ])].filter((id) => useGraph.getState().getCard(id)?.status === 'done')
  const videoIds = ids.filter((id) => useGraph.getState().getCard(id)?.kind === 'video')
  if (!videoIds.length) throw new Error('没有已完成的视频片段可送入时间线')
  useGraph.getState().setActiveBoard(run.sourceBoardId)
  useGraph.getState().setSelection(ids)
  useUi.getState().setShowTimeline(true)
  return ids
}
