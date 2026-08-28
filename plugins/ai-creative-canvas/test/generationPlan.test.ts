import assert from 'node:assert/strict'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import { useProviders } from '../src/ui/store/providerStore.ts'
import { buildCardGenerationPlan, buildWorkflowGenerationPlan, generationPlanBlocked } from '../src/ui/services/generationPlan.ts'
import { createWorkflowRun, normalizeWorkflowBrief } from '../src/ui/services/workflowPlanner.ts'
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

async function testWorkflowSeparatesGeneratedAndEditedDuration() {
  reset()
  const squareProvider: ProviderConfig = {
    ...provider,
    capabilities: { ...provider.capabilities, aspects: ['1:1'], durations: [5, 10] }
  }
  useProviders.setState({ providers: [squareProvider], activeVideoId: squareProvider.id })
  const graph = useGraph.getState()
  const sourceId = graph.addCard('text', { x: 0, y: 0 }, { title: '广告 Brief', text: '十秒方形广告' })
  const source = useGraph.getState().getCard(sourceId)!
  const shots = Array.from({ length: 6 }, (_, index) => ({ desc: `广告镜头 ${index + 1}`, duration: 5 }))
  const brief = normalizeWorkflowBrief({
    title: '十秒广告', summary: '', audience: '通用', aspect: '1:1', totalDuration: 10, ending: 'Packshot', anchorSuggestions: [], shots
  })
  const run = createWorkflowRun({ recipe: 'product-ad-film', sourceCard: source, sourceBoardId: useGraph.getState().project.activeBoardId, goal: '生成广告' }, brief)
  const plan = await buildWorkflowGenerationPlan(run)
  const videoItems = plan.items.filter((item) => item.kind === 'video')
  assert.equal(videoItems.reduce((sum, item) => sum + (item.duration || 0), 0), 30, '费用和 Provider 任务按原始生成素材时长估算')
  assert.ok(plan.issues.some((issue) => issue.message.includes('目标成片为 10s') && issue.message.includes('30s 原始视频素材')))
  assert.equal(plan.issues.some((issue) => issue.level === 'error' && issue.message.includes('1:1')), false)
}

async function testWorkflowCountsContinuityReferencesAndReusesInputs() {
  reset()
  useProviders.setState({ providers: [provider], activeVideoId: provider.id })
  const graph = useGraph.getState()
  const sourceId = graph.addCard('text', { x: 0, y: 0 }, { title: '故事', text: '女孩在雨中奔跑' })
  const source = graph.getCard(sourceId)!
  const brief = normalizeWorkflowBrief({
    title: '雨夜', summary: '', audience: '通用', aspect: '16:9', totalDuration: 5, ending: '停下',
    anchorSuggestions: [{ role: 'character', name: '女孩', description: '黄色雨衣' }],
    shots: [{ desc: '女孩在雨中奔跑', duration: 5, anchorNames: ['女孩'] }]
  })
  const run = createWorkflowRun({ sourceCard: source, sourceBoardId: graph.project.activeBoardId, goal: '生成短片' }, brief)
  const generatedPlan = await buildWorkflowGenerationPlan(run)
  assert.equal(generatedPlan.items.filter((item) => item.title.startsWith('设定图')).length, 1)
  assert.equal(generatedPlan.taskCount, 4, '导演指南、设定图、镜头静帧和视频都应计入计划')
  assert.ok(generatedPlan.issues.some((issue) => issue.message.includes('新增生成 1 张')))

  const inputId = graph.addCard('image', { x: -300, y: 0 }, { title: '女孩', status: 'done', assetUrl: 'file:///girl.png', assetLocalPath: '/girl.png', mime: 'image/png' })
  graph.updateCard(sourceId, { refIds: [inputId] })
  const reusedPlan = await buildWorkflowGenerationPlan(run)
  assert.equal(reusedPlan.items.filter((item) => item.title.startsWith('设定图')).length, 0)
  assert.equal(reusedPlan.taskCount, 3, '复用设定图后仍需生成导演指南、镜头静帧和视频')
  assert.ok(reusedPlan.issues.some((issue) => issue.message.includes('复用已有素材 1 个')))
}

async function testVideoReferenceCapabilityPreflight() {
  reset()
  const multiProvider: ProviderConfig = {
    ...provider,
    bodyTemplate: '{"prompt":"{prompt}"{?images},"images":{$images}{/images}{?videos},"videos":{$videos}{/videos}}',
    capabilities: {
      textToVideo: true,
      imageToVideo: true,
      lastFrame: true,
      referenceInputs: {
        images: { max: 9, modes: ['single', 'keyframes', 'multi'], transport: 'either' },
        videos: { max: 3, transport: 'url' },
        mixed: true
      },
      aspects: ['16:9'],
      durations: [5, 10]
    }
  }
  useProviders.setState({ providers: [multiProvider], activeVideoId: multiProvider.id })
  const graph = useGraph.getState()
  const remoteId = graph.addCard('video', { x: 0, y: 0 }, {
    prompt: '沿用参考片段的镜头节奏',
    assets: [{ id: 'remote', kind: 'video', url: 'https://cdn.test/reference.mp4', mime: 'video/mp4', name: 'reference.mp4' }]
  })
  const remotePlan = await buildCardGenerationPlan([remoteId])
  assert.equal(remotePlan.issues.some((issue) => issue.level === 'error'), false, '公开参考视频在 Provider 上限内应通过预检')

  const localId = graph.addCard('video', { x: 300, y: 0 }, {
    prompt: '沿用本地片段',
    assets: [{ id: 'local', kind: 'video', url: 'file:///local.mp4', localPath: '/local.mp4', mime: 'video/mp4', name: 'local.mp4' }]
  })
  const localPlan = await buildCardGenerationPlan([localId])
  assert.ok(localPlan.issues.some((issue) => issue.level === 'error' && issue.message.includes('公开 http(s) URL')))
}

await testCapabilityConflictAndKnownVideoCost()
await testUnknownImageCostAndBatchThreshold()
await testWorkflowSeparatesGeneratedAndEditedDuration()
await testWorkflowCountsContinuityReferencesAndReusesInputs()
await testVideoReferenceCapabilityPreflight()
console.log('generation plan: 5 tests OK')
