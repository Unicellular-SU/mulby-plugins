import type { WorkflowLogEntry, WorkflowRun, WorkflowStep } from '../types'
import { uid } from '../util'
import { focusCard } from '../focusCard'
import { useGraph } from '../store/graphStore'
import { stopCard } from './generate'
import { storyboardSourceFingerprint } from './storyboardV2'
import { executeAgentCommand } from './agentCommands'
import { visualContinuitySuggestions } from './workflowContinuity'

const locks = new Set<string>()
const controllers = new Map<string, AbortController>()

function latest(runId: string): WorkflowRun | undefined {
  return useGraph.getState().project.workflowRuns?.[runId]
}

function log(message: string, level: WorkflowLogEntry['level'], stepId?: string): WorkflowLogEntry {
  return { id: uid('log'), at: Date.now(), level, message, ...(stepId ? { stepId } : {}) }
}

function save(run: WorkflowRun): WorkflowRun {
  const next = { ...run, updatedAt: Date.now() }
  useGraph.getState().upsertWorkflowRun(next)
  return next
}

function patchStep(run: WorkflowRun, stepId: string, patch: Partial<WorkflowStep>, runPatch: Partial<WorkflowRun> = {}, entry?: WorkflowLogEntry): WorkflowRun {
  return save({
    ...run,
    ...runPatch,
    steps: run.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step),
    logs: entry ? [...run.logs, entry].slice(-200) : run.logs
  })
}

export function workflowIsStale(run: WorkflowRun): boolean {
  const source = useGraph.getState().getCard(run.sourceCardId)
  return !source || storyboardSourceFingerprint(source) !== run.sourceFingerprint
}

export function pauseWorkflow(runId: string): void {
  const controller = controllers.get(runId)
  controller?.abort()
  const run = latest(runId)
  if (!run || run.status === 'completed' || run.status === 'canceled') return
  const current = run.steps.find((step) => step.status === 'running')
  save({
    ...run,
    status: 'paused',
    steps: run.steps.map((step) => step.id === current?.id ? { ...step, status: 'pending' } : step),
    logs: [...run.logs, log('工作流已暂停，可稍后继续。', 'warning', current?.id)].slice(-200)
  })
}

export async function cancelWorkflow(runId: string): Promise<void> {
  controllers.get(runId)?.abort()
  const run = latest(runId)
  if (!run) return
  const activeIds = run.steps.flatMap((step) => step.outputCardIds).filter((id) => {
    const status = useGraph.getState().getCard(id)?.status
    return status === 'running' || status === 'queued'
  })
  await Promise.allSettled(activeIds.map(stopCard))
  save({
    ...run,
    status: 'canceled',
    steps: run.steps.map((step) => step.status === 'running' || step.status === 'checkpoint' ? { ...step, status: 'canceled' } : step),
    logs: [...run.logs, log('工作流已取消；已完成的卡片会保留。', 'warning')].slice(-200)
  })
}

export async function approveWorkflowCheckpoint(runId: string): Promise<void> {
  const run = latest(runId)
  if (!run) return
  const step = run.steps.find((item) => item.status === 'checkpoint') || run.steps.find((item) => item.requiresApproval && !item.approvedAt && item.status !== 'completed')
  if (!step) return resumeWorkflow(runId)
  patchStep(run, step.id, { status: 'pending', approvedAt: Date.now(), error: undefined }, { status: 'paused' }, log(`已确认：${step.title}`, 'success', step.id))
  return resumeWorkflow(runId)
}

export function retryWorkflowStep(runId: string, stepId: string): void {
  const run = latest(runId)
  if (!run) return
  const index = run.steps.findIndex((step) => step.id === stepId)
  if (index < 0) return
  const target = run.steps[index]
  if (target.command === 'generate_continuity' || target.command === 'generate_images' || target.command === 'generate_videos') {
    for (const cardId of target.outputCardIds) {
      const card = useGraph.getState().getCard(cardId)
      if (!card) continue
      if (target.command === 'generate_continuity') {
        const continuity = (card.meta as any)?.workflowContinuityV1
        if (continuity?.runId !== run.id) continue // 复用的用户素材只读，不允许“重跑”时被生成任务覆盖。
        const anchorId = (card.meta as any)?.semanticAnchorId
        const anchor = typeof anchorId === 'string' ? useGraph.getState().project.assetAnchors?.[anchorId] : undefined
        if (anchor?.locked) {
          useGraph.getState().upsertAssetAnchor(cardId, {
            id: anchor.id,
            role: anchor.role,
            name: anchor.name,
            aliases: anchor.aliases,
            description: anchor.description,
            tags: anchor.tags,
            locked: false
          })
        }
      }
      useGraph.getState().updateCard(cardId, { meta: { ...(card.meta || {}), storyboardInputStale: true } })
    }
  }
  save({
    ...run,
    status: 'paused',
    steps: run.steps.map((step, stepIndex) => stepIndex < index ? step : {
      ...step,
      status: 'pending', error: undefined, startedAt: undefined, completedAt: undefined,
      outputCardIds: stepIndex === index ? step.outputCardIds : [],
      ...(stepIndex === index ? {} : { approvedAt: undefined })
    }),
    logs: [...run.logs, log(`准备重跑步骤：${target.title}`, 'info', stepId)].slice(-200)
  })
}

export async function resumeWorkflow(runId: string): Promise<void> {
  if (locks.has(runId)) return
  let run = latest(runId)
  if (!run || run.status === 'completed' || run.status === 'canceled') return
  if (workflowIsStale(run)) {
    save({ ...run, status: 'stale', logs: [...run.logs, log('源文本已经变化，请重新生成计划，避免按旧剧本继续。', 'warning')].slice(-200) })
    return
  }
  const controller = new AbortController()
  controllers.set(runId, controller)
  locks.add(runId)
  try {
    while (!controller.signal.aborted) {
      run = latest(runId)
      if (!run) return
      const step = run.steps.find((item) => item.status !== 'completed')
      if (!step) {
        save({ ...run, status: 'completed', logs: [...run.logs, log('工作流已完成，视频片段已送入时间线。', 'success')].slice(-200) })
        return
      }
      if (step.status === 'canceled' || step.status === 'stale') return
      const emptyContinuityCheckpoint = step.command === 'lock_continuity' && visualContinuitySuggestions(run).length === 0
      if (step.requiresApproval && !step.approvedAt && !emptyContinuityCheckpoint) {
        patchStep(run, step.id, { status: 'checkpoint', error: undefined }, { status: 'paused' }, log(`等待确认：${step.title}`, 'info', step.id))
        return
      }
      run = patchStep(run, step.id, { status: 'running', startedAt: Date.now(), error: undefined }, { status: 'running' }, log(`开始：${step.title}`, 'info', step.id))
      try {
        const outputCardIds = await executeAgentCommand(run, run.steps.find((item) => item.id === step.id)!, controller.signal)
        if (step.command === 'generate_continuity' && outputCardIds[0]) {
          const boardId = useGraph.getState().boardIdOfCard(outputCardIds[0])
          if (boardId) focusCard(boardId, outputCardIds[0])
        }
        run = latest(runId) || run
        patchStep(run, step.id, { status: 'completed', outputCardIds, completedAt: Date.now(), error: undefined }, { status: 'running' }, log(`完成：${step.title}`, 'success', step.id))
      } catch (error: any) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          const current = latest(runId)
          if (current && current.status !== 'canceled') patchStep(current, step.id, { status: 'pending' }, { status: 'paused' })
          return
        }
        const message = error?.message || String(error)
        const current = latest(runId) || run
        patchStep(current, step.id, { status: 'error', error: message }, { status: 'error' }, log(message, 'error', step.id))
        return
      }
    }
  } finally {
    locks.delete(runId)
    if (controllers.get(runId) === controller) controllers.delete(runId)
  }
}
