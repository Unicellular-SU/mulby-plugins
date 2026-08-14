import type { AgentCommandName, WorkflowRun, WorkflowStep } from '../types'
import { useGraph } from '../store/graphStore'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import { generateCard } from './generate'
import { materializeStoryboardShots, saveStoryboardDoc, shotToVideo } from './storyboard'
import { createStoryboardDoc, readStoryboardDoc } from './storyboardV2'
import { buildCardGenerationPlan, generationPlanBlocked } from './generationPlan'
import { resolveVideoCapabilities } from './providers/config'
import { coveringVideoDuration } from './videoSpecs'
import { isWorkflowVisualAnchorName, lockWorkflowContinuity, orderWorkflowContinuityCards, prepareWorkflowContinuity, refreshWorkflowContinuityInputs, workflowStylePrompt } from './workflowContinuity'
import { assetAnchorsForBoard } from './semanticAssets'

export const AGENT_COMMANDS = new Set<AgentCommandName>([
  'save_storyboard', 'materialize_continuity', 'generate_continuity', 'lock_continuity',
  'materialize_images', 'generate_images',
  'create_videos', 'generate_videos', 'prepare_timeline'
])

function outputOf(run: WorkflowRun, command: AgentCommandName): string[] {
  return run.steps.find((step) => step.command === command)?.outputCardIds || []
}

function ensureNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('已取消', 'AbortError')
}

function currentStoryboard(run: WorkflowRun) {
  const owner = useGraph.getState().getCard(run.sourceCardId)
  if (!owner) throw new Error('源文本卡片已不存在')
  const doc = readStoryboardDoc(owner)
  if (!doc) throw new Error('故事板尚未保存')
  return { owner, doc }
}

async function generateCards(ids: string[], signal: AbortSignal): Promise<string[]> {
  const unique = [...new Set(ids)].filter((id) => !!useGraph.getState().getCard(id))
  const plan = await buildCardGenerationPlan(unique, '工作流步骤预检')
  if (generationPlanBlocked(plan)) throw new Error(plan.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message).join('；'))
  await Promise.all(unique.map(async (id) => {
    ensureNotAborted(signal)
    const card = useGraph.getState().getCard(id)
    const stale = !!(card?.meta as any)?.storyboardInputStale
    if (!card || (card.status === 'done' && !stale)) return
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
  }))
  return unique
}

export async function executeAgentCommand(run: WorkflowRun, step: WorkflowStep, signal: AbortSignal): Promise<string[]> {
  if (!AGENT_COMMANDS.has(step.command)) throw new Error(`不允许的 Agent 命令：${step.command}`)
  ensureNotAborted(signal)
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
  if (step.command === 'materialize_continuity') {
    return prepareWorkflowContinuity(run)
  }
  if (step.command === 'generate_continuity') {
    const ids = outputOf(run, 'materialize_continuity')
    if (!ids.length) return []
    const pending = ids.filter((id) => {
      const card = useGraph.getState().getCard(id)
      return !!card && (!(card.assetUrl || card.assetLocalPath) || !!(card.meta as any)?.storyboardInputStale)
    })
    for (const id of orderWorkflowContinuityCards(run, pending)) {
      ensureNotAborted(signal)
      refreshWorkflowContinuityInputs(run, id)
      await generateCards([id], signal)
    }
    return ids
  }
  if (step.command === 'lock_continuity') {
    // 先把用户当前选择/局部编辑后的主图重新固定；随后只重生成依赖已变化的派生设定图。
    const initiallyLocked = lockWorkflowContinuity(run)
    const recordedIds = outputOf(run, 'materialize_continuity')
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
      await generateCards([id], signal)
    }
    return lockWorkflowContinuity(run)
  }
  if (step.command === 'materialize_images') {
    const { owner, doc } = currentStoryboard(run)
    const result = materializeStoryboardShots(owner.id, doc, undefined, { aspect: run.brief.aspect })
    if (!result) throw new Error('镜头静帧卡片落地失败')
    return result.cardIds
  }
  if (step.command === 'generate_images') {
    const ids = outputOf(run, 'materialize_images')
    if (!ids.length) throw new Error('没有可生成的镜头静帧卡片')
    return generateCards(ids, signal)
  }
  if (step.command === 'create_videos') {
    const { doc } = currentStoryboard(run)
    const provider = useProviders.getState().activeFor('video')
    const capabilities = resolveVideoCapabilities(provider)
    const ids = doc.shots.flatMap((shot) => {
      if (!shot.imageCardId) return []
      const image = useGraph.getState().getCard(shot.imageCardId)
      if (!image || image.status !== 'done') return []
      const plannedDuration = shot.duration || 5
      const generationDuration = provider ? coveringVideoDuration(provider.model, plannedDuration, capabilities.durations) : plannedDuration
      if (generationDuration + 0.05 < plannedDuration) throw new Error(`镜头 ${shot.shotNumber || shot.order + 1} 的计划时长 ${plannedDuration}s 超过当前 Provider 最大生成时长 ${generationDuration}s，请拆分镜头或更换 Provider`)
      const videoId = shotToVideo(image.id, {
        aspect: run.brief.aspect,
        plannedDuration,
        generationDuration
      })
      return videoId ? [videoId] : []
    })
    if (!ids.length) throw new Error('没有已完成静帧可用于创建视频卡，请先检查静帧结果')
    return [...new Set(ids)]
  }
  if (step.command === 'generate_videos') {
    const ids = outputOf(run, 'create_videos')
    if (!ids.length) throw new Error('没有可生成的视频卡片')
    return generateCards(ids, signal)
  }
  const ids = outputOf(run, 'generate_videos').filter((id) => useGraph.getState().getCard(id)?.status === 'done')
  if (!ids.length) throw new Error('没有已完成的视频片段可送入时间线')
  const boardId = useGraph.getState().boardIdOfCard(ids[0])
  if (boardId) useGraph.getState().setActiveBoard(boardId)
  useGraph.getState().setSelection(ids)
  useUi.getState().setShowTimeline(true)
  return ids
}
