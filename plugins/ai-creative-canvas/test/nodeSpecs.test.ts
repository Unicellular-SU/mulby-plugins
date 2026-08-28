import assert from 'node:assert/strict'
import {
  NODE_SPEC_REGISTRY_VERSION,
  NODE_SPECS,
  getNodeSpec,
  resolveNodeInputPolicy,
  resolveNodeSpec
} from '../src/ui/services/nodeSpecs.ts'
import {
  canGenerateCard,
  canGenerateKind,
  inputPolicyFor,
  materialKindOfCard
} from '../src/ui/services/nodeCapabilities.ts'
import { getParamSchema } from '../src/ui/services/paramSchema.ts'
import type { Card, CardKind } from '../src/ui/types.ts'

const CARD_KINDS: CardKind[] = ['image', 'pano', 'video', 'text', 'audio', 'source', 'group', 'note']

function card(kind: CardKind, params: Record<string, unknown> = {}, patch: Partial<Card> = {}): Card {
  return {
    id: `${kind}-1`,
    kind,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: kind,
    prompt: '',
    modelId: null,
    providerId: null,
    params,
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

function fieldKeys(kind: CardKind, capabilities?: Parameters<typeof getParamSchema>[1]): string[] {
  return getParamSchema(card(kind), capabilities).map((field) => field.key)
}

function selectField(kind: CardKind, key: string, capabilities?: Parameters<typeof getParamSchema>[1]) {
  const field = getParamSchema(card(kind), capabilities).find((item) => item.type === 'select' && item.key === key)
  assert.ok(field && field.type === 'select', `${kind}.${key} 应是下拉参数`)
  return field
}

function testRegistryCompleteness() {
  assert.match(NODE_SPEC_REGISTRY_VERSION, /^1\./)
  assert.deepEqual(Object.keys(NODE_SPECS).sort(), [...CARD_KINDS].sort())
  assert.equal(new Set(Object.values(NODE_SPECS).map((spec) => spec.kind)).size, CARD_KINDS.length)
  for (const kind of CARD_KINDS) {
    const spec = getNodeSpec(kind)
    assert.equal(spec.version, 1)
    assert.equal(spec.kind, kind)
    assert.ok(spec.label && spec.purpose)
    assert.ok(Array.isArray(spec.inputs) && Array.isArray(spec.params))
    assert.ok(spec.output.description)
    assert.ok(spec.lifecycle.terminalStatuses.length > 0)
  }
}

function testLifecycleAndAgentPermissions() {
  const generatable: CardKind[] = ['text', 'image', 'pano', 'video', 'audio']
  for (const kind of CARD_KINDS) {
    assert.equal(canGenerateKind(kind), generatable.includes(kind), `${kind} 的生成能力应来自注册表`)
    assert.equal(getNodeSpec(kind).lifecycle.generatable, generatable.includes(kind))
  }
  assert.equal(canGenerateKind('unknown'), false)
  assert.equal(canGenerateCard(card('image', {}, { meta: { resourceRole: 'source' } })), false)
  assert.deepEqual(getNodeSpec('image').agent.actions, ['reference', 'create', 'generate', 'inspect-output'])
  assert.deepEqual(getNodeSpec('text').agent.actions, ['reference', 'create', 'generate', 'inspect-output'])
  assert.deepEqual(getNodeSpec('pano').agent.actions, ['reference', 'create', 'generate', 'inspect-output'])
  assert.deepEqual(getNodeSpec('video').agent.actions, ['reference', 'create', 'generate', 'inspect-output'])
  assert.deepEqual(getNodeSpec('audio').agent.actions, ['reference', 'create', 'generate', 'inspect-output'])
  assert.deepEqual(getNodeSpec('source').agent.actions, ['reference', 'inspect-output'])
  assert.deepEqual(getNodeSpec('group').agent.actions, ['organize', 'inspect-output'])
  assert.deepEqual(getNodeSpec('note').agent.actions, [])
}

function testInputPolicies() {
  assert.deepEqual(inputPolicyFor(card('text')), { accepted: ['text', 'image'] })
  assert.deepEqual(inputPolicyFor(card('image')), { accepted: ['text', 'image'] })
  assert.deepEqual(inputPolicyFor(card('pano')), { accepted: ['text', 'image'] })
  assert.deepEqual(inputPolicyFor(card('audio')), { accepted: ['text'] })
  assert.deepEqual(inputPolicyFor(card('source')), { accepted: [] })
  assert.deepEqual(inputPolicyFor(card('group')), { accepted: [] })
  assert.deepEqual(inputPolicyFor(card('note')), { accepted: [] })
  assert.deepEqual(inputPolicyFor(card('video')), { accepted: ['text', 'image', 'video'], maxByKind: { image: 9, video: 3 } })
  assert.deepEqual(inputPolicyFor(card('video', { refMode: 'keyframe' })), { accepted: ['text', 'image'], maxByKind: { image: 2 } })

  assert.deepEqual(
    resolveNodeInputPolicy('video', { videoCapabilities: { textToVideo: true, imageToVideo: false } }),
    { accepted: ['text'] }
  )
  assert.deepEqual(
    resolveNodeInputPolicy('video', { params: { refMode: 'keyframe' }, videoCapabilities: { imageToVideo: true, lastFrame: false } }),
    { accepted: ['text', 'image'], maxByKind: { image: 1 } }
  )
  assert.deepEqual(
    resolveNodeInputPolicy('video', { videoCapabilities: { imageToVideo: true, lastFrame: true } }),
    { accepted: ['text', 'image'], maxByKind: { image: 1 } },
    '旧 Provider 的普通模式仍只能发送一张图'
  )
  assert.deepEqual(
    resolveNodeInputPolicy('video', {
      videoCapabilities: {
        imageToVideo: true,
        lastFrame: true,
        referenceInputs: {
          images: { max: 9, modes: ['single', 'keyframes', 'multi'], transport: 'either' },
          videos: { max: 3, transport: 'url' },
          mixed: true
        }
      }
    }),
    { accepted: ['text', 'image', 'video'], maxByKind: { image: 9, video: 3 } }
  )
}

function testParamSchemaCompatibility() {
  assert.deepEqual(fieldKeys('image'), ['aspect', 'resolution', 'count', 'seed'])
  assert.deepEqual(fieldKeys('pano'), ['resolution', 'seed'])
  assert.deepEqual(fieldKeys('video'), ['aspect', 'camera', 'motion', 'refMode', 'seed', 'duration'])
  assert.deepEqual(fieldKeys('audio'), ['voice', 'speed', 'format'])
  assert.deepEqual(fieldKeys('text'), ['temperature', 'shotCount'])
  assert.deepEqual(fieldKeys('source'), [])
  assert.deepEqual(fieldKeys('group'), [])
  assert.deepEqual(fieldKeys('note'), [])

  assert.deepEqual(
    [selectField('image', 'aspect').default, selectField('image', 'resolution').default, selectField('image', 'count').default],
    ['1:1', '1K', '1']
  )
  assert.deepEqual(selectField('image', 'count').options.map((option) => option.value), ['1', '2', '3', '4'])
  assert.deepEqual(
    [selectField('text', 'temperature').default, selectField('text', 'shotCount').default],
    ['0.7', '0']
  )
  assert.deepEqual(
    [selectField('audio', 'voice').default, selectField('audio', 'speed').default, selectField('audio', 'format').default],
    ['alloy', '1', 'mp3']
  )

  const providerCapabilities = {
    textToVideo: true,
    imageToVideo: true,
    lastFrame: false,
    aspects: ['16:9', '9:16'],
    resolutions: ['720p', '1080p']
  }
  assert.deepEqual(fieldKeys('video', providerCapabilities), ['aspect', 'resolution', 'camera', 'motion', 'refMode', 'seed', 'duration'])
  assert.deepEqual(selectField('video', 'aspect', providerCapabilities).options.map((option) => option.value), ['16:9', '9:16'])
  assert.equal(selectField('video', 'aspect', providerCapabilities).default, '16:9')
  assert.deepEqual(selectField('video', 'resolution', providerCapabilities).options.map((option) => option.value), ['720p', '1080p'])
  assert.deepEqual(selectField('video', 'refMode', providerCapabilities).options, [{ value: 'omni', label: '参考·首帧' }])
  assert.equal(fieldKeys('video', { textToVideo: true, imageToVideo: false }).includes('refMode'), false)
}

function testOutputsAndDynamicResolution() {
  assert.deepEqual(
    CARD_KINDS.map((kind) => [kind, getNodeSpec(kind).output.materialKind || null, getNodeSpec(kind).output.cardinality]),
    [
      ['image', 'image', 'parameter'],
      ['pano', 'image', 'one'],
      ['video', 'video', 'one'],
      ['text', 'text', 'one'],
      ['audio', 'audio', 'one'],
      ['source', null, 'one'],
      ['group', null, 'none'],
      ['note', null, 'none']
    ]
  )
  assert.equal(getNodeSpec('image').output.cardinalityParam, 'count')
  assert.equal(getNodeSpec('image').output.supportsVersions, true)
  assert.equal(materialKindOfCard(card('source', {}, { mime: 'video/mp4' })), 'video')
  assert.equal(materialKindOfCard(card('source', {}, { mime: 'audio/wav' })), 'audio')
  assert.equal(materialKindOfCard(card('source', {}, { mime: 'text/plain' })), 'text')
  assert.equal(materialKindOfCard(card('source', {}, { mime: 'image/png' })), 'image')
  assert.equal(materialKindOfCard(card('group')), null)

  const resolved = resolveNodeSpec('video', {
    params: { refMode: 'keyframe' },
    videoCapabilities: { imageToVideo: true, lastFrame: true, aspects: ['1:1'], resolutions: ['4K'] }
  })
  assert.equal(resolved.inputs.find((input) => input.id === 'image-references')?.max, 2)
  assert.deepEqual(resolved.inputs.find((input) => input.id === 'image-references')?.orderMeaning, ['首帧', '尾帧'], '首尾关键帧的输入顺序必须稳定')
  assert.deepEqual(resolved.params.find((param) => param.key === 'aspect')?.enum, [{ value: '1:1', label: '1:1' }])
  assert.equal(resolved.params.find((param) => param.key === 'resolution')?.default, '4K')
}

testRegistryCompleteness()
testLifecycleAndAgentPermissions()
testInputPolicies()
testParamSchemaCompatibility()
testOutputsAndDynamicResolution()
console.log('node specs: registry completeness and compatibility assertions OK')
