import assert from 'node:assert/strict'
import {
  buildDirectorPromptContext,
  compileDirectorPrompt,
  directorPromptStatus,
  missingDirectorMentionTokens,
  parseDirectorPromptResponse,
  readDirectorPrompt,
  type CinematicPromptPlan,
  type DirectorPromptDraft
} from '../src/ui/services/directorPrompt.ts'
import type { Board, Card, ProjectDoc } from '../src/ui/types.ts'
import type { ProviderConfig } from '../src/ui/services/providers/types.ts'

function card(id: string, kind: Card['kind'], patch: Partial<Card> = {}): Card {
  return {
    id, kind, x: 0, y: 0, w: 320, h: 240, title: id, prompt: '', modelId: null, providerId: null,
    params: {}, status: 'idle', progress: 0, error: null, assetUrl: null, assetLocalPath: null,
    attachmentId: null, mime: null, text: null, refIds: [], assets: [], meta: {}, parentId: null,
    ...patch
  }
}

function fixture() {
  const text = card('story', 'text', { title: '剧情', text: '她看见最后一班列车开走，但没有追上去' })
  const image = card('frame', 'image', {
    title: '首帧', assetUrl: 'file:///frame.png', assetLocalPath: '/frame.png', mime: 'image/png',
    meta: { imageGeneration: { completedAt: 100 } }
  })
  const video = card('video', 'video', {
    title: '视频', prompt: '克制地向前推进', modelId: 'video-pro',
    params: { camera: '缓慢推进', motion: '轻微', aspect: '21:9', duration: 8, refMode: 'omni' }
  })
  const board: Board = {
    id: 'board', name: '画布', cards: { story: text, frame: image, video },
    edges: {
      e1: { id: 'e1', source: 'story', target: 'video', kind: 'ref' },
      e2: { id: 'e2', source: 'frame', target: 'video', kind: 'ref' }
    },
    viewport: { x: 0, y: 0, zoom: 1 }, stylePackId: 'cinematic-real'
  }
  const project: ProjectDoc = {
    id: 'project', name: '测试', boards: [board], activeBoardId: board.id, globalModelId: null,
    defaultTextModel: 'text-model', concurrency: 4, createdAt: 1, updatedAt: 1, schemaVersion: 2
  }
  const provider: ProviderConfig = {
    id: 'provider', label: 'Video API', kind: 'video', type: 'custom-video', baseURL: '',
    submitUrl: 'https://api.test/generate', pollUrl: 'https://api.test/task/{taskId}', taskIdPath: 'id',
    statusField: 'status', videoUrlPath: 'result.url', model: 'video-pro',
    bodyTemplate: '{"prompt":"{prompt}"{?imageUrl},"image":"{imageUrl}"{/imageUrl},"audio":true}',
    capabilities: { textToVideo: true, imageToVideo: true, lastFrame: false, nativeAudio: true, aspects: ['21:9'], durations: [8] }
  }
  return { text, image, video, board, project, provider }
}

const plan: CinematicPromptPlan = {
  visibleAction: '她向前半步又停下，手指松开车票',
  unresolvedState: '她仍然没有决定是否离开',
  subjectLocks: ['保持首帧人物外观与站位'],
  spatialRelationship: '人物被站台边缘和远去的列车分开',
  cameraPosition: '摄影机在站台柱子后侧',
  lensAndScale: '50mm 中景',
  visualFlow: '视线从车票进入，沿手臂到人物，最后被列车尾灯带走',
  temporalArc: '开始列车缓慢离站，中段人物向前，结尾她停下',
  subjectMotion: '一次克制的半步动作',
  environmentMotion: '列车和服装边缘被风带动',
  cameraMotion: '极慢向前推进',
  practicalLight: '站台钠灯和列车尾灯',
  colorThesis: '大面积冷灰中只保留尾灯暗红',
  opticalConstraints: ['边缘轻微柔化', '不过度锐化'],
  audioDesign: '轨道摩擦声逐渐远去',
  avoid: ['广告摆拍', '随机镜头光斑']
}

function testContextAndFingerprint() {
  const { video, board, project, provider } = fixture()
  const context = buildDirectorPromptContext(video, board, project, provider)
  assert.equal(context.textInputs.length, 1)
  assert.equal(context.imageInputs.length, 1)
  assert.equal(context.imageInputs[0].role, 'reference')
  assert.equal(context.style.label, '写实电影感')
  assert.equal(context.params.camera, '缓慢推进')
  assert.equal(context.provider.nativeAudio, true)
  assert.equal(context.fingerprint, buildDirectorPromptContext(video, board, project, provider).fingerprint)
  assert.notEqual(context.fingerprint, buildDirectorPromptContext({ ...video, prompt: '改为固定机位' }, board, project, provider).fingerprint)
  const multiDurationProvider = { ...provider, capabilities: { ...provider.capabilities, durations: [8, 10] } }
  assert.notEqual(
    buildDirectorPromptContext(video, board, project, multiDurationProvider).fingerprint,
    buildDirectorPromptContext({ ...video, params: { ...video.params, duration: 10 } }, board, project, multiDurationProvider).fingerprint
  )

  const modelFallbackProvider = { ...provider, capabilities: { ...provider.capabilities, durations: [] } }
  const modelFallbackVideo = { ...video, modelId: 'grok-video-1.5', params: { ...video.params, duration: undefined } }
  assert.equal(buildDirectorPromptContext(modelFallbackVideo, board, project, modelFallbackProvider).params.duration, 10)
  assert.equal(buildDirectorPromptContext({ ...modelFallbackVideo, params: { ...modelFallbackVideo.params, duration: 14 } }, board, project, modelFallbackProvider).params.duration, 15)
}

function testParseAndCompile() {
  const parsed = parseDirectorPromptResponse(`\`\`\`json\n${JSON.stringify({ localPrompt: '保持克制的推进和未完成动作', plan })}\n\`\`\``)
  assert.equal(parsed.plan.visibleAction, plan.visibleAction)
  assert.throws(() => parseDirectorPromptResponse('{"plan":{"visibleAction":"x"}}'), /信息不完整/)
  const { video, board, project, provider } = fixture()
  const context = buildDirectorPromptContext(video, board, project, provider)
  const compiled = compileDirectorPrompt(video, board, context, parsed.localPrompt, parsed.plan)
  assert.match(compiled, /最后一班列车/)
  assert.match(compiled, /可见行动/)
  assert.match(compiled, /风格约束/)
  assert.match(compiled, /声音/)
  assert.match(compiled, /21:9/)
  assert.deepEqual(missingDirectorMentionTokens('让 @主角 参考 @场景', '保持 @主角 站位'), ['场景'])
  assert.deepEqual(missingDirectorMentionTokens('让 @主角 前进', '保持 @主角 前进'), [])

  const mentionedVideo = { ...video, prompt: '@剧情 与 @首帧，保持克制' }
  const mentionedContext = buildDirectorPromptContext(mentionedVideo, board, project, provider)
  const partiallyRewritten = compileDirectorPrompt(mentionedVideo, board, mentionedContext, '@剧情，缓慢推进', parsed.plan)
  assert.match(partiallyRewritten, /参考图「首帧」/)
}

function testStoredStatus() {
  const { video, board, project, provider } = fixture()
  const context = buildDirectorPromptContext(video, board, project, provider)
  const draft: DirectorPromptDraft = {
    version: 1, createdAt: 1, contextFingerprint: context.fingerprint, localPrompt: '建议',
    compiledPrompt: '最终提示词', plan,
    contextSummary: { textCount: 1, imageCount: 1, imageLabels: ['首帧'], styleLabel: '写实电影感', providerLabel: 'Video API', usedVisualImages: 1 },
    mode: 'next-generation'
  }
  const stored = { ...video, meta: { directorPrompt: draft } }
  assert.equal(readDirectorPrompt(stored.meta)?.compiledPrompt, '最终提示词')
  assert.equal(directorPromptStatus(stored, board, project, provider).status, 'ready')
  const changed = { ...stored, params: { ...stored.params, camera: '手持跟拍' } }
  assert.equal(directorPromptStatus(changed, board, project, provider).status, 'stale')
}

testContextAndFingerprint()
testParseAndCompile()
testStoredStatus()
console.log('director prompt: 23 assertions OK')
