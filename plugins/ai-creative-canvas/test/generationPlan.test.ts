import assert from 'node:assert/strict'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import { useProviders } from '../src/ui/store/providerStore.ts'
import { buildCardGenerationPlan, generationPlanBlocked } from '../src/ui/services/generationPlan.ts'
import type { ProviderConfig } from '../src/ui/services/providers/types.ts'

;(globalThis as any).window = {
  mulby: {
    ai: {
      allModels: async () => [{ id: 'image-1', label: 'Image', endpointType: 'image-generation' }],
      tokens: { estimate: async () => ({ inputTokens: 10, outputTokens: 20 }) }
    },
    storage: { set: async () => undefined, encrypted: {} }
  }
}

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {}, clipboard: { cards: [], edges: [] } })
  useProviders.setState({ providers: [], activeVideoId: null, activeAudioId: null, loaded: true })
}

const provider: ProviderConfig = {
  id: 'video-1', label: '测试视频', kind: 'video', type: 'custom-video', baseURL: '',
  submitUrl: 'https://example.com/submit', pollUrl: 'https://example.com/tasks/{taskId}',
  bodyTemplate: '{"prompt":"{prompt}","image":"{imageUrl}","duration":{duration},"aspect":"{aspect}"}',
  taskIdPath: 'id', statusField: 'status', videoUrlPath: 'video.url',
  capabilities: { textToVideo: true, imageToVideo: true, aspects: ['16:9'], durations: [5, 10] },
  pricing: { currency: 'CNY', perRequest: 1, perSecond: 0.2 }
}

async function testCapabilityConflictAndKnownVideoCost() {
  reset()
  useProviders.setState({ providers: [provider], activeVideoId: provider.id })
  const graph = useGraph.getState()
  const imageId = graph.addCard('image', { x: 0, y: 0 }, { assetUrl: 'file:///start.png', assetLocalPath: '/start.png', status: 'done', mime: 'image/png' })
  const videoId = graph.addCard('video', { x: 300, y: 0 }, { refIds: [imageId], prompt: '人物向前走', params: { duration: 10, aspect: '4:3' } })
  const plan = await buildCardGenerationPlan([videoId])
  assert.equal(plan.taskCount, 1)
  assert.equal(plan.costStatus, 'known')
  assert.equal(plan.estimatedCost, 3)
  assert.equal(generationPlanBlocked(plan), true)
  assert.ok(plan.issues.some((issue) => issue.message.includes('画幅 4:3')))
}

async function testUnknownImageCostAndBatchThreshold() {
  reset()
  const ids = Array.from({ length: 10 }, (_, index) => useGraph.getState().addCard('image', { x: index * 20, y: 0 }, { prompt: `图片 ${index + 1}` }))
  const plan = await buildCardGenerationPlan(ids)
  assert.equal(plan.taskCount, 10)
  assert.equal(plan.costStatus, 'unknown')
  assert.equal(plan.requiresConfirmation, true)
  assert.ok(plan.issues.some((issue) => issue.message.includes('分批')))
  assert.equal(generationPlanBlocked(plan), false)
}

await testCapabilityConflictAndKnownVideoCost()
await testUnknownImageCostAndBatchThreshold()
console.log('generation plan: 2 tests OK')
