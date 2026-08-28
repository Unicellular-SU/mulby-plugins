import assert from 'node:assert/strict'
import {
  MAX_AGENT_CAPABILITY_BYTES,
  MAX_AGENT_CAPABILITY_RESOURCES,
  agentCapabilitySnapshotBytes,
  buildAgentCapabilitySnapshot
} from '../src/ui/services/agentCapabilitySnapshot.ts'
import type { AssetAnchor, Board, Card, ProjectDoc } from '../src/ui/types.ts'
import type { ProviderConfig } from '../src/ui/services/providers/types.ts'

function card(id: string, kind: Card['kind'], patch: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: id,
    prompt: '',
    modelId: null,
    providerId: null,
    params: {},
    status: 'idle',
    progress: 0,
    error: null,
    assetUrl: null,
    assetLocalPath: null,
    attachmentId: null,
    mime: null,
    text: null,
    refIds: [],
    assets: [],
    meta: {},
    parentId: null,
    ...patch
  }
}

function board(id: string, cards: Card[], edges: Board['edges'] = {}): Board {
  return { id, name: id, cards: Object.fromEntries(cards.map((item) => [item.id, item])), edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

function anchor(id: string, boardId: string, cardId: string, locked = true): AssetAnchor {
  return {
    id,
    role: 'prop',
    name: id,
    aliases: [],
    description: '仅用于测试的产品视觉身份',
    tags: [],
    mediaKind: 'image',
    source: { boardId, cardId },
    pinnedMedia: { assetLocalPath: `/private/anchors/${id}.png`, mime: 'image/png' },
    revision: 1,
    locked,
    createdAt: 1,
    updatedAt: 2
  }
}

const videoProvider: ProviderConfig = {
  id: 'video-secret-provider',
  label: 'Video Pro',
  kind: 'video',
  type: 'custom-video',
  baseURL: 'https://secret-provider.example/v1',
  submitUrl: 'https://secret-provider.example/generate',
  headers: { Authorization: 'Bearer DO_NOT_LEAK' },
  bodyTemplate: '{"secret":"DO_NOT_LEAK","prompt":"{prompt}"}',
  model: 'video-pro',
  capabilities: {
    textToVideo: true,
    imageToVideo: true,
    lastFrame: true,
    nativeAudio: false,
    aspects: ['1:1', '16:9'],
    durations: [5, 10],
    resolutions: ['720p', '1080p']
  }
}

function fixtureProject(): ProjectDoc {
  const foreign = card('foreign-product', 'image', {
    title: 'FOREIGN_BOARD_SECRET',
    prompt: 'FOREIGN_PROMPT_SECRET',
    assetLocalPath: '/private/foreign.png',
    mime: 'image/png'
  })
  const source = card('source-brief', 'text', {
    title: '产品 Brief',
    text: '保温杯通勤广告',
    refIds: ['linked-product']
  })
  const linked = card('linked-product', 'source', {
    title: '品牌保温杯',
    prompt: 'PROMPT_MUST_NOT_ENTER_SNAPSHOT',
    assetLocalPath: '/Users/demo/SECRET_PRODUCT_PATH.png',
    assetUrl: 'file:///Users/demo/SECRET_PRODUCT_PATH.png',
    mime: 'image/png'
  })
  const fillers = Array.from({ length: 100 }, (_, index) => card(`filler-${String(index).padStart(3, '0')}`, 'image', {
    title: `参考素材 ${index} ${'很长'.repeat(80)}`,
    prompt: `FILLER_PROMPT_SECRET_${index}`,
    assetLocalPath: `/private/fillers/${index}.png`,
    mime: 'image/png'
  }))
  const current = board('board-3', [source, linked, ...fillers], {
    edge1: { id: 'edge1', source: linked.id, target: source.id, kind: 'ref' }
  })
  current.style = '干净、明亮、现代商业摄影'
  return {
    id: 'project-1',
    name: 'test',
    boards: [board('board-1', [foreign]), current],
    activeBoardId: current.id,
    globalModelId: null,
    assetAnchors: {
      foreign: anchor('foreign-anchor', 'board-1', foreign.id),
      current: anchor('current-product-anchor', current.id, linked.id)
    },
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 1
  }
}

function testSnapshotContractAndProviderResolution() {
  const project = fixtureProject()
  const result = buildAgentCapabilitySnapshot({
    recipe: 'product-ad-film',
    project,
    sourceBoardId: 'board-3',
    sourceCardId: 'source-brief',
    aspect: '1:1',
    textModelId: 'text-pro',
    imageModelId: 'image-pro',
    videoProvider
  })
  const snapshot = result.snapshot
  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.registryVersion, '1.2.0')
  assert.deepEqual(snapshot.nodes.map((node) => node.kind), ['text', 'image', 'pano', 'video', 'audio', 'source', 'group'])
  assert.equal(snapshot.nodes.some((node) => node.kind === 'note'), false)
  assert.deepEqual(snapshot.nodes.find((node) => node.kind === 'group')?.agentActions, ['organize', 'inspect-output'])
  assert.equal(snapshot.nodes.find((node) => node.kind === 'pano')?.params.some((param) => param.key === 'aspect'), false, '全景画幅固定为 2:1，不向计划开放 aspect 参数')
  const video = snapshot.nodes.find((node) => node.kind === 'video')!
  assert.equal(video.inputs.find((input) => input.slot === 'image-references')?.max, 2)
  assert.deepEqual(video.params.find((param) => param.key === 'aspect')?.allowed, ['1:1', '16:9'])
  assert.deepEqual(video.params.find((param) => param.key === 'duration')?.allowed, [5, 10])
  assert.deepEqual(video.params.find((param) => param.key === 'resolution')?.allowed, ['720p', '1080p'])
  assert.equal(video.output.kind, 'video')
  assert.equal(video.output.cardinality, 'one')

  const providers = Object.fromEntries(snapshot.providers.map((provider) => [provider.kind, provider]))
  assert.deepEqual(providers.video.capabilities, {
    textToVideo: true,
    imageToVideo: true,
    lastFrame: true,
    nativeAudio: false,
    aspects: ['1:1', '16:9'],
    durations: [5, 10],
    resolutions: ['720p', '1080p'],
    referenceInputs: {
      images: { max: 2, modes: ['single', 'keyframes'], transport: 'either' },
      videos: { max: 0, transport: 'url' },
      mixed: false
    }
  })
  assert.equal(providers.video.available, true)
  assert.equal(providers.video.modelId, 'video-pro')
  assert.equal(providers.image.available, true)
  assert.equal(providers.text.available, true)
  assert.equal(providers.audio.available, false)
}

function testIsolationRedactionPriorityAndSize() {
  const project = fixtureProject()
  const first = buildAgentCapabilitySnapshot({
    recipe: 'product-ad-film', project, sourceBoardId: 'board-3', sourceCardId: 'source-brief', aspect: '1:1',
    textModelId: 'text-pro', imageModelId: 'image-pro', videoProvider
  })
  const second = buildAgentCapabilitySnapshot({
    recipe: 'product-ad-film', project, sourceBoardId: 'board-3', sourceCardId: 'source-brief', aspect: '1:1',
    textModelId: 'text-pro', imageModelId: 'image-pro', videoProvider
  })
  assert.equal(first.hash, second.hash, '同一能力输入必须产生稳定哈希')
  assert.equal(first.snapshot.currentBoardResources[0].id, 'source-brief')
  assert.equal(first.snapshot.currentBoardResources[1].id, 'linked-product')
  assert.equal(first.snapshot.currentBoardResources[1].semanticRole, 'prop')
  assert.equal(first.snapshot.currentBoardResources[1].locked, true)
  assert.equal(first.snapshot.currentBoardResources.length, MAX_AGENT_CAPABILITY_RESOURCES)
  assert.equal(first.snapshot.currentBoardResources.some((resource) => resource.id === 'foreign-product'), false)
  assert.equal(first.snapshot.currentBoardResources.every((resource) => resource.title.length <= 120), true)
  assert.equal(first.bytes, agentCapabilitySnapshotBytes(first.snapshot))
  assert.ok(first.bytes <= MAX_AGENT_CAPABILITY_BYTES, `能力快照过大：${first.bytes} bytes`)

  const serialized = JSON.stringify(first.snapshot)
  for (const secret of ['DO_NOT_LEAK', 'secret-provider.example', 'SECRET_PRODUCT_PATH', 'PROMPT_MUST_NOT_ENTER_SNAPSHOT', 'FILLER_PROMPT_SECRET', 'FOREIGN_BOARD_SECRET', '/private/']) {
    assert.equal(serialized.includes(secret), false, `能力快照不得包含敏感或跨画布内容：${secret}`)
  }

  const changed = buildAgentCapabilitySnapshot({
    recipe: 'product-ad-film', project, sourceBoardId: 'board-3', sourceCardId: 'source-brief', aspect: '1:1',
    textModelId: 'text-pro', imageModelId: 'image-pro',
    videoProvider: { ...videoProvider, capabilities: { ...videoProvider.capabilities, durations: [5] } }
  })
  assert.notEqual(changed.hash, first.hash, 'Provider 能力变化必须改变快照哈希')
}

testSnapshotContractAndProviderResolution()
testIsolationRedactionPriorityAndSize()
console.log('agent capability snapshot: contract, isolation, redaction and size assertions OK')
