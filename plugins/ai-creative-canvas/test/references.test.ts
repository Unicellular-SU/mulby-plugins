import assert from 'node:assert/strict'
import {
  buildMaterials,
  extractMentionTokens,
  findUnresolvedMentions,
  isUsableMaterial,
  replaceMentionInPrompt,
  resolveGenerationPrompt,
  resolveGenInputs,
  selectedGenMaterials
} from '../src/ui/services/references.ts'
import { canConnect } from '../src/ui/services/connectionPolicy.ts'
import { canGenerateCard } from '../src/ui/services/nodeCapabilities.ts'
import type { AssetAnchor, Board, Card, ProjectDoc } from '../src/ui/types.ts'

function card(id: string, patch: Partial<Card> & Pick<Card, 'kind'>): Card {
  return {
    id,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: patch.title || 'AI 图片',
    prompt: patch.prompt || '',
    text: patch.text,
    refIds: patch.refIds || [],
    assets: patch.assets || [],
    parentId: null,
    status: 'idle',
    params: {},
    ...patch
  } as Card
}

function board(cards: Record<string, Card>): Board {
  return { id: 'b1', name: 'test', cards, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
}

function testExtractMentions() {
  assert.deepEqual(extractMentionTokens('参考 @主角 和 @场景A 的构图'), ['主角', '场景A'])
}

function testUnresolved() {
  const b = board({
    src: card('src', { kind: 'image', title: '主角' }),
    me: card('me', { kind: 'image', prompt: '@主角 @已删除', refIds: ['src'] })
  })
  const mats = buildMaterials(b.cards.me, b)
  assert.deepEqual(findUnresolvedMentions(b.cards.me.prompt, mats), ['已删除'])
}

function testSelectedGenMaterials() {
  const b = board({
    t1: card('t1', { kind: 'text', title: '脚本', text: 'hello' }),
    i1: card('i1', { kind: 'image', title: '参考图', assetUrl: 'x' }),
    me: card('me', { kind: 'image', prompt: '@脚本', refIds: ['t1', 'i1'] })
  })
  const sel = selectedGenMaterials(b.cards.me, b)
  assert.equal(sel.length, 1)
  assert.equal(sel[0].label, '脚本')
  const inputs = resolveGenInputs(b.cards.me, b)
  assert.equal(inputs.texts.length, 1)
  assert.equal(inputs.images.length, 0)
}

function testReplaceMentionOnRename() {
  assert.equal(replaceMentionInPrompt('用 @旧名 的风格', '旧名', '新名'), '用 @新名 的风格')
  assert.equal(replaceMentionInPrompt('@旧名,@旧名2', '旧名', '新名'), '@新名,@旧名2')
}

// 钉住契约：全景卡产物对下游是「图片素材」（matKindOfCard 兜底 image），可作图生图/视频参考
function testPanoActsAsImageMaterial() {
  const b = board({
    p1: card('p1', { kind: 'pano', title: 'AI 全景', assetUrl: 'file:///pano.png', assetLocalPath: '/pano.png' }),
    me: card('me', { kind: 'image', prompt: '基于全景出一张剧照', refIds: ['p1'] })
  })
  const mats = buildMaterials(b.cards.me, b)
  assert.equal(mats.length, 1)
  assert.equal(mats[0].kind, 'image')
  assert.equal(mats[0].label, '图片1') // 默认标题 'AI 全景' → 按素材类型自动编号
  const inputs = resolveGenInputs(b.cards.me, b)
  assert.equal(inputs.images.length, 1)
  assert.equal(inputs.images[0].url, 'file:///pano.png')
}

function testUploadedTextMaterial() {
  const b = board({
    me: card('me', {
      kind: 'image',
      prompt: '@角色设定',
      assets: [{ id: 'a1', kind: 'text', name: '角色设定.md', mime: 'text/markdown', text: '白发剑客，黑色长衣' }]
    })
  })
  const mats = buildMaterials(b.cards.me, b)
  assert.equal(mats[0].label, '角色设定')
  assert.equal(mats[0].text, '白发剑客，黑色长衣')
  const inputs = resolveGenInputs(b.cards.me, b)
  assert.deepEqual(inputs.texts, [{ label: '角色设定', text: '白发剑客，黑色长衣' }])
}

function testLinkedTextBecomesMediaPrompt() {
  const b = board({
    t1: card('t1', { kind: 'text', title: '场景脚本', text: '雨夜的霓虹街道，一名侦探撑伞前行' }),
    me: card('me', { kind: 'image', prompt: '' })
  })
  b.edges.e1 = { id: 'e1', source: 't1', target: 'me', kind: 'ref' }
  const resolved = resolveGenerationPrompt(b.cards.me, b, 'media')
  assert.equal(resolved.text, '雨夜的霓虹街道，一名侦探撑伞前行')
  assert.equal(resolved.source, 'upstream')
}

function testLocalPromptSupplementsLinkedText() {
  const b = board({
    t1: card('t1', { kind: 'text', title: '场景脚本', text: '雨夜的霓虹街道' }),
    me: card('me', { kind: 'video', prompt: '镜头缓慢向前推进' })
  })
  b.edges.e1 = { id: 'e1', source: 't1', target: 'me', kind: 'ref' }
  const resolved = resolveGenerationPrompt(b.cards.me, b, 'media')
  assert.equal(resolved.text, '雨夜的霓虹街道\n\n本节点补充要求：\n镜头缓慢向前推进')
  assert.equal(resolved.source, 'combined')
}

function testTextMentionExpandsAndNarrowsInputs() {
  const b = board({
    t1: card('t1', { kind: 'text', title: '场景脚本', text: '一名侦探走入雨夜' }),
    t2: card('t2', { kind: 'text', title: '旁白', text: '城市从不睡眠' }),
    i1: card('i1', { kind: 'image', title: '角色图', assetUrl: 'file:///role.png' }),
    me: card('me', { kind: 'video', prompt: '把 @场景脚本 改成低机位跟拍', refIds: ['t1', 't2', 'i1'] })
  })
  const resolved = resolveGenerationPrompt(b.cards.me, b, 'media')
  assert.equal(resolved.text, '把 一名侦探走入雨夜 改成低机位跟拍')
  assert.equal(resolved.hasExplicitMentions, true)
  assert.deepEqual(resolved.inputs.texts, [{ label: '场景脚本', text: '一名侦探走入雨夜' }])
  assert.equal(resolved.inputs.images.length, 0)
}

function testImageMentionKeepsAttachmentSemantics() {
  const b = board({
    i1: card('i1', { kind: 'image', title: '角色图', assetUrl: 'file:///role.png' }),
    me: card('me', { kind: 'image', prompt: '让 @角色图 站在雪山上', refIds: ['i1'] })
  })
  const resolved = resolveGenerationPrompt(b.cards.me, b, 'media')
  assert.equal(resolved.text, '让 参考图「角色图」 站在雪山上')
  assert.equal(resolved.inputs.images.length, 1)
}

function testInvalidMentionFallsBackWithoutLeakingToken() {
  const b = board({
    t1: card('t1', { kind: 'text', title: '脚本', text: '角色走进森林，联系 @director' }),
    me: card('me', { kind: 'image', prompt: '@已删除', refIds: ['t1'] })
  })
  const resolved = resolveGenerationPrompt(b.cards.me, b, 'media')
  assert.equal(resolved.text, '角色走进森林，联系 @director')
  assert.equal(resolved.source, 'upstream')
}

function testUnsupportedMediaNeverBecomesGenerationInput() {
  const b = board({
    clip: card('clip', { kind: 'video', title: '参考视频', assetUrl: 'file:///clip.mp4' }),
    me: card('me', { kind: 'image', prompt: '参考上游素材', refIds: ['clip'] })
  })
  assert.equal(buildMaterials(b.cards.me, b)[0].kind, 'video', '详情仍可显示旧引用以便用户移除')
  assert.deepEqual(selectedGenMaterials(b.cards.me, b), [], '生成链路不得静默消费未支持的视频输入')
  assert.equal(canConnect(b.cards.clip, b.cards.me).ok, false)
}

function testVideoReferencesAreOrderedAndReusable() {
  const b = board({
    generated: card('generated', {
      kind: 'video',
      title: '生成片段',
      assetUrl: 'file:///downloaded.mp4',
      assetLocalPath: '/downloaded.mp4',
      meta: { videoGeneration: { sourceUrl: 'https://cdn.test/generated.mp4' } }
    }),
    me: card('me', {
      kind: 'video',
      refIds: ['generated'],
      assets: [
        { id: 'image-a', kind: 'image', name: '首图.png', url: 'file:///first.png' },
        { id: 'video-b', kind: 'video', name: '公网片段.mp4', url: 'https://cdn.test/reference.mp4' }
      ],
      params: { referenceOrder: ['upload:video-b', 'card:generated', 'upload:image-a'] }
    })
  })
  const selected = selectedGenMaterials(b.cards.me, b)
  assert.deepEqual(selected.filter((material) => material.kind !== 'text').map((material) => material.matId), ['upload:video-b', 'card:generated', 'upload:image-a'])
  const inputs = resolveGenInputs(b.cards.me, b)
  assert.deepEqual(inputs.videos.map((video) => video.url), ['https://cdn.test/reference.mp4', 'https://cdn.test/generated.mp4'])
  assert.equal(inputs.images.length, 1)
  const mentioned = resolveGenerationPrompt({ ...b.cards.me, prompt: '沿用 @公网片段 的运动' }, b, 'media')
  assert.equal(mentioned.text, '沿用 参考视频「公网片段」 的运动')
  assert.deepEqual(mentioned.inputs.videos.map((video) => video.url), ['https://cdn.test/reference.mp4'])
}

function testImportedMediaIsSourceOnly() {
  const imported = card('imported', { kind: 'video', meta: { resourceRole: 'source' }, assetUrl: 'file:///clip.mp4' })
  const prompt = card('prompt', { kind: 'text', text: '镜头向前推进' })
  assert.equal(canGenerateCard(imported), false)
  assert.equal(canConnect(prompt, imported).ok, false)
  assert.equal(canGenerateCard(card('generated', { kind: 'video' })), true)
}

function testMissingMediaStaysVisibleButCannotBeConsumed() {
  const b = board({
    i1: card('i1', {
      kind: 'image',
      title: '角色图',
      assetUrl: 'file:///missing.png',
      assetLocalPath: '/missing.png',
      meta: { mediaMissing: true, missingMediaReferences: ['primary'] }
    }),
    me: card('me', {
      kind: 'image',
      prompt: '让 @角色图 站在雪山上',
      refIds: ['i1'],
      assets: [{ id: 'missing-upload', kind: 'image', name: '旧参考.png', url: 'file:///old.png', localPath: '/old.png' }],
      meta: { mediaMissing: true, missingMediaReferences: ['input:missing-upload'] }
    })
  })
  const mats = buildMaterials(b.cards.me, b)
  assert.equal(mats.length, 2, '详情框仍应显示失效素材，方便用户定位和移除')
  assert.equal(mats.every((material) => material.unavailable && !isUsableMaterial(material)), true)
  assert.deepEqual(selectedGenMaterials(b.cards.me, b, mats), [], '失效路径不得发送给生成 Provider')
  assert.deepEqual(findUnresolvedMentions(b.cards.me.prompt, mats.filter(isUsableMaterial)), ['角色图'])
  const resolved = resolveGenerationPrompt(b.cards.me, b, 'media')
  assert.equal(resolved.text, '让 站在雪山上')
  assert.equal(resolved.inputs.images.length, 0)
}

function testEmbeddedTextSurvivesMissingOriginalFile() {
  const b = board({
    me: card('me', {
      kind: 'image',
      assets: [{ id: 'notes', kind: 'text', name: '设定.md', text: '白发剑客', localPath: '/deleted.md' }],
      meta: { mediaMissing: true, missingMediaReferences: ['input:notes'] }
    })
  })
  const material = buildMaterials(b.cards.me, b)[0]
  assert.equal(isUsableMaterial(material), true)
  assert.deepEqual(resolveGenInputs(b.cards.me, b).texts, [{ label: '设定', text: '白发剑客' }])
}

function testStableAnchorBindingAndExplicitNarrowing() {
  const b = board({
    story: card('story', { kind: 'text', title: '剧情', text: '阿星在雨夜推开旧仓库的门' }),
    source: card('source', { kind: 'image', title: '随时可改名的源卡', assetUrl: 'file:///role.png', assetLocalPath: '/role.png' }),
    me: card('me', {
      kind: 'video',
      prompt: '镜头缓慢推进',
      anchorRefs: [{ anchorId: 'anchor-role', mention: '阿星', acceptedAt: 1 }]
    })
  })
  b.edges.story = { id: 'story', source: 'story', target: 'me', kind: 'ref' }
  const anchor: AssetAnchor = {
    id: 'anchor-role',
    role: 'character',
    name: '阿星',
    aliases: [],
    description: '',
    tags: [],
    mediaKind: 'image',
    source: { boardId: b.id, cardId: 'source' },
    revision: 1,
    locked: false,
    createdAt: 1,
    updatedAt: 1
  }
  const project: ProjectDoc = {
    id: 'p1',
    name: 'test',
    boards: [b],
    activeBoardId: b.id,
    globalModelId: null,
    assetAnchors: { [anchor.id]: anchor },
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 3
  }

  const combined = resolveGenerationPrompt(b.cards.me, b, 'media', project)
  assert.equal(combined.inputs.images.length, 1, '接受建议后锚点应进入真实视觉输入')
  assert.equal(combined.inputs.texts.length, 1, '稳定绑定本身不应排除上游剧情')
  assert.equal(combined.hasExplicitMentions, false)

  const explicit = resolveGenerationPrompt({ ...b.cards.me, prompt: '让 @阿星 缓慢转身' }, b, 'media', project)
  assert.equal(explicit.inputs.images.length, 1)
  assert.equal(explicit.inputs.texts.length, 0, '只有显式 @ 才缩小本次生成的素材范围')
  assert.equal(explicit.hasExplicitMentions, true)
  assert.equal(explicit.text, '让 参考图「阿星」 缓慢转身')
}

testExtractMentions()
testUnresolved()
testSelectedGenMaterials()
testReplaceMentionOnRename()
testPanoActsAsImageMaterial()
testUploadedTextMaterial()
testLinkedTextBecomesMediaPrompt()
testLocalPromptSupplementsLinkedText()
testTextMentionExpandsAndNarrowsInputs()
testImageMentionKeepsAttachmentSemantics()
testInvalidMentionFallsBackWithoutLeakingToken()
testUnsupportedMediaNeverBecomesGenerationInput()
testVideoReferencesAreOrderedAndReusable()
testImportedMediaIsSourceOnly()
testMissingMediaStaysVisibleButCannotBeConsumed()
testEmbeddedTextSurvivesMissingOriginalFile()
testStableAnchorBindingAndExplicitNarrowing()
console.log('references: 17 tests OK')
