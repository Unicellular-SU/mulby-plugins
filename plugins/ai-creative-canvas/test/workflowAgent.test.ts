import assert from 'node:assert/strict'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import { executeAgentCommand, AGENT_COMMANDS } from '../src/ui/services/agentCommands.ts'
import { createWorkflowRun, fixedWorkflowSteps, normalizeWorkflowBrief, sanitizeWorkflowRuns } from '../src/ui/services/workflowPlanner.ts'
import { resumeWorkflow } from '../src/ui/services/workflowRunner.ts'
import { readStoryboardDoc } from '../src/ui/services/storyboardV2.ts'

;(globalThis as any).window = { mulby: { storage: { set: async () => undefined } } }

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {}, clipboard: { cards: [], edges: [] } })
}

function makeRun() {
  const graph = useGraph.getState()
  const sourceCardId = graph.addCard('text', { x: 0, y: 0 }, { title: '剧本', text: '女孩在雨夜找到一只受伤的小猫。' })
  const source = graph.getCard(sourceCardId)!
  const brief = normalizeWorkflowBrief({
    title: '雨夜相遇', summary: '一段温暖相遇', audience: '年轻观众', aspect: '16:9', totalDuration: 10, ending: '女孩抱起小猫',
    anchorSuggestions: [{ role: 'character', name: '女孩', description: '黄色雨衣' }],
    shots: [
      { desc: '女孩走在雨巷', scene: '雨巷', character: '女孩', action: '行走', emotion: '孤独', shotSize: '全景', camera: '跟拍', duration: 5, imagePrompt: '黄色雨衣女孩走在雨巷', videoPrompt: '跟拍女孩缓慢行走', dialogue: '', sfx: '雨声' },
      { desc: '女孩发现小猫', scene: '雨巷', character: '女孩、小猫', action: '蹲下', emotion: '怜惜', shotSize: '近景', camera: '缓慢推进', duration: 5, imagePrompt: '女孩蹲下看见小猫', videoPrompt: '镜头推进，女孩蹲下', dialogue: '', sfx: '雨声' }
    ]
  })
  return createWorkflowRun({ sourceCard: source, sourceBoardId: graph.project.activeBoardId, goal: '做成短片' }, brief)
}

async function testWhitelistAndIdempotentMaterialization() {
  reset()
  const run = makeRun()
  assert.deepEqual(fixedWorkflowSteps().map((step) => step.command), [...AGENT_COMMANDS])
  const signal = new AbortController().signal
  const saveStep = run.steps[0]
  await executeAgentCommand(run, saveStep, signal)
  assert.equal(readStoryboardDoc(useGraph.getState().getCard(run.sourceCardId)!)?.shots.length, 2)
  const first = await executeAgentCommand(run, run.steps[1], signal)
  const second = await executeAgentCommand(run, run.steps[1], signal)
  assert.deepEqual(second, first)
  assert.equal(Object.values(useGraph.getState().getActiveBoard().cards).filter((card) => card.kind === 'image').length, 2)
  first.forEach((id) => useGraph.getState().updateCard(id, { status: 'done', assetUrl: `file:///${id}.png`, assetLocalPath: `/${id}.png` }))
  const withImages = { ...run, steps: run.steps.map((step) => step.command === 'materialize_images' ? { ...step, outputCardIds: first } : step) }
  const videos1 = await executeAgentCommand(withImages, run.steps[3], signal)
  const videos2 = await executeAgentCommand(withImages, run.steps[3], signal)
  assert.deepEqual(videos2, videos1)
  assert.equal(Object.values(useGraph.getState().getActiveBoard().cards).filter((card) => card.kind === 'video').length, 2)
}

async function testCheckpointAndLoadRecovery() {
  reset()
  const run = makeRun()
  useGraph.getState().upsertWorkflowRun(run)
  await resumeWorkflow(run.id)
  const paused = useGraph.getState().project.workflowRuns?.[run.id]!
  assert.equal(paused.status, 'paused')
  assert.equal(paused.steps[0].status, 'checkpoint')

  const dirty = {
    ...useGraph.getState().project,
    workflowRuns: {
      [run.id]: { ...paused, status: 'running', steps: paused.steps.map((step, index) => index === 0 ? { ...step, status: 'running' } : step) },
      evil: { ...paused, id: 'evil', steps: [{ id: 'x', command: 'delete_everything', status: 'pending' }] }
    }
  } as any
  const clean = sanitizeWorkflowRuns(dirty)
  assert.equal(clean[run.id].status, 'paused')
  assert.equal(clean[run.id].steps[0].status, 'pending')
  assert.equal(clean.evil, undefined)
}

await testWhitelistAndIdempotentMaterialization()
await testCheckpointAndLoadRecovery()
console.log('workflow agent: 2 tests OK')
