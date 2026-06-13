// decodeImageToRawImage 依赖浏览器 canvas,无法在 node 中测试;
// 其余纯函数(prompt 模板/模型筛选/base64/套装生成)在此全部覆盖。

import { createRawImage } from './pixelate-pipeline'
import {
  buildPetImageEditPrompt,
  buildPetImagePrompt,
  filterChatModels,
  filterImageGenModels,
  generatePetSpriteSet,
  normalizeBase64,
  parseImageDataUrl,
  suggestSpriteMeta,
  toImageDataUrl,
} from './appearance-workshop'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ---------------------------------------------------------------------------
// prompt 模板
// ---------------------------------------------------------------------------

function testPromptTemplateLocksConstraints() {
  const prompt = buildPetImagePrompt('  一只 圆滚滚的\n橘色小猫  ')
  assert(prompt.includes('一只 圆滚滚的 橘色小猫'), 'description should be embedded with collapsed whitespace')
  assert(prompt.includes('pixel-art'), 'prompt must lock pixel-art style')
  assert(prompt.includes('Front facing, full body'), 'prompt must lock front-facing full-body composition')
  assert(prompt.includes('solid pure white background'), 'prompt must lock solid background for matting')
  assert(prompt.includes('no gradients'), 'prompt must forbid gradients for quantization')
  assert(prompt.includes('no text, no watermark'), 'prompt must forbid text/watermark')
}

function testEditPromptTemplate() {
  const withHint = buildPetImageEditPrompt('  赛博朋克 配色  ')
  assert(withHint.includes('Redraw the main subject'), 'edit prompt must instruct redrawing the uploaded subject')
  assert(withHint.includes('Style hints: 赛博朋克 配色.'), 'hint should be embedded with collapsed whitespace')
  assert(withHint.includes('solid pure white background'), 'edit prompt must lock solid background')

  const noHint = buildPetImageEditPrompt()
  assert(!noHint.includes('Style hints'), 'omitted hint should not leave an empty Style hints clause')
  assert(buildPetImageEditPrompt('   ') === noHint, 'blank hint should behave like omitted hint')
}

function testPromptTruncatesLongInput() {
  const long = 'x'.repeat(1000)
  const prompt = buildPetImagePrompt(long)
  assert(!prompt.includes('x'.repeat(301)), 'subject longer than 300 chars must be truncated')
  assert(prompt.includes('x'.repeat(300)), 'first 300 chars of subject must survive')

  const edit = buildPetImageEditPrompt(long)
  assert(!edit.includes('x'.repeat(301)), 'edit hint longer than 300 chars must be truncated')
}

// ---------------------------------------------------------------------------
// 模型筛选
// ---------------------------------------------------------------------------

function testFilterImageGenModels() {
  const models = [
    { id: 'a', endpointType: 'image-generation' },
    { id: 'b', supportedEndpointTypes: ['openai', 'image-generation'] },
    { id: 'openai:gpt-4o', endpointType: 'openai' },
    { id: 'x:declared-but-text', endpointType: 'openai' },
    { id: 'aihubmix:gpt-image-1' },
    { id: 'gemini:gemini-2.5-flash-image-preview' },
    { id: 'openai:dall-e-3' },
    { id: 'replicate:flux-schnell' },
    { id: 'deepseek:DeepSeek-V3' },
    { id: 'openai:text-embedding-3-small' },
    { id: '' },
    null as any,
  ]
  const kept = filterImageGenModels(models).map(m => m.id)
  assert(kept.includes('a'), 'declared image-generation endpoint should be kept')
  assert(kept.includes('b'), 'supportedEndpointTypes containing image-generation should be kept')
  assert(!kept.includes('openai:gpt-4o'), 'declared non-image endpoint must be rejected')
  assert(!kept.includes('x:declared-but-text'), 'declared text endpoint must be rejected even before id heuristics')
  assert(kept.includes('aihubmix:gpt-image-1'), 'undeclared gpt-image id should be kept by heuristic')
  assert(kept.includes('gemini:gemini-2.5-flash-image-preview'), 'undeclared *-image id should be kept by heuristic')
  assert(kept.includes('openai:dall-e-3'), 'dall-e should be kept by heuristic')
  assert(kept.includes('replicate:flux-schnell'), 'flux should be kept by heuristic')
  assert(!kept.includes('deepseek:DeepSeek-V3'), 'plain text model must be rejected')
  assert(!kept.includes('openai:text-embedding-3-small'), 'embedding model must be rejected')
  assert(filterImageGenModels(undefined as any).length === 0, 'non-array input should yield empty list')
}

function testFilterChatModels() {
  const models = [
    { id: 'a', endpointType: 'image-generation' },
    { id: 'openai:gpt-4o', endpointType: 'openai' },
    { id: 'deepseek:DeepSeek-V3' },
    { id: 'openai:dall-e-3' },
    { id: 'replicate:flux-schnell' },
    { id: 'bytedance:seedream-3' },
    { id: 'zhipu:cogview-3' },
    { id: 'openai:text-embedding-3-small' },
    { id: 'jina:reranker-v2', endpointType: 'jina-rerank' },
    { id: '' },
    null as any,
  ]
  const kept = filterChatModels(models).map(m => m.id)
  assert(kept.includes('openai:gpt-4o'), 'declared chat endpoint should be kept')
  assert(kept.includes('deepseek:DeepSeek-V3'), 'plain chat model should be kept')
  // 核心回归:这些图像模型 id 不含 "image" 子串,旧字符串过滤会漏判进对话列表
  assert(!kept.includes('a'), 'declared image-generation model must be excluded from chat list')
  assert(!kept.includes('openai:dall-e-3'), 'dall-e must be excluded from chat list')
  assert(!kept.includes('replicate:flux-schnell'), 'flux must be excluded from chat list')
  assert(!kept.includes('bytedance:seedream-3'), 'seedream must be excluded from chat list')
  assert(!kept.includes('zhipu:cogview-3'), 'cogview must be excluded from chat list')
  assert(!kept.includes('openai:text-embedding-3-small'), 'embedding model must be excluded')
  assert(!kept.includes('jina:reranker-v2'), 'rerank model must be excluded')
  assert(!kept.includes(''), 'empty id must be excluded')
  assert(filterChatModels(undefined as any).length === 0, 'non-array input should yield empty list')
}

// ---------------------------------------------------------------------------
// base64 / dataURL
// ---------------------------------------------------------------------------

function testBase64Helpers() {
  assert(normalizeBase64('data:image/png;base64,AAAA') === 'AAAA', 'data url prefix should be stripped')
  assert(normalizeBase64(' AA\nAA ') === 'AAAA', 'whitespace should be stripped')
  assert(normalizeBase64('') === '', 'empty input should stay empty')

  assert(toImageDataUrl('AAAA') === 'data:image/png;base64,AAAA', 'raw base64 should be wrapped as png data url')
  assert(toImageDataUrl('data:image/jpeg;base64,BBBB') === 'data:image/jpeg;base64,BBBB', 'existing data url should pass through')
  assert(toImageDataUrl('https://example.com/a.png') === 'https://example.com/a.png', 'http(s) url should pass through untouched')
  assert(toImageDataUrl('  HTTPS://EX.com/a.png  ') === 'HTTPS://EX.com/a.png', 'url scheme check should be case-insensitive and trimmed')
  assert(toImageDataUrl('') === '', 'empty base64 should yield empty string')
}

function testParseImageDataUrl() {
  const bytes = [0, 1, 2, 250, 255]
  const base64 = btoa(String.fromCharCode(...bytes))

  const parsed = parseImageDataUrl(`data:image/jpeg;base64,${base64}`)
  assert(parsed !== null, 'valid image data url should parse')
  assert(parsed.mimeType === 'image/jpeg', `mime should be extracted, got ${parsed.mimeType}`)
  const out = [...new Uint8Array(parsed.buffer)]
  assert(out.join(',') === bytes.join(','), `bytes should round-trip, got ${out.join(',')}`)

  const padded = parseImageDataUrl(`data:image/png;base64,${base64.slice(0, 4)}\n${base64.slice(4)}`)
  assert(padded !== null, 'whitespace inside base64 should be tolerated')

  assert(parseImageDataUrl(`data:text/plain;base64,${base64}`) === null, 'non-image mime must be rejected')
  assert(parseImageDataUrl('not-a-data-url') === null, 'plain string must be rejected')
  assert(parseImageDataUrl('data:image/png;base64,@@@@') === null, 'broken base64 must be rejected')
  assert(parseImageDataUrl('') === null, 'empty input must be rejected')
}

// ---------------------------------------------------------------------------
// 套装元信息
// ---------------------------------------------------------------------------

function testSuggestSpriteMeta() {
  const meta = suggestSpriteMeta('  一只 很长很长很长很长很长很长很长很长很长的描述  ', 1234567890)
  assert(meta.id === 'custom_1234567890', `id should carry timestamp, got ${meta.id}`)
  assert(meta.name.length === 20, `name should be truncated to 20 chars, got ${meta.name.length}`)
  assert(meta.description.startsWith('一只 很长'), 'description should keep cleaned text')

  const empty = suggestSpriteMeta('   ')
  assert(empty.name === '自定义宠物', 'blank description should fall back to default name')
}

// ---------------------------------------------------------------------------
// 套装生成
// ---------------------------------------------------------------------------

function testGeneratePetSpriteSetEndToEnd() {
  const src = createRawImage(256, 256)
  const fill = (x: number, y: number, w: number, h: number, c: [number, number, number]) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const i = ((y + dy) * 256 + (x + dx)) * 4
        src.data[i] = c[0]
        src.data[i + 1] = c[1]
        src.data[i + 2] = c[2]
        src.data[i + 3] = 255
      }
    }
  }
  fill(0, 0, 256, 256, [255, 255, 255])
  fill(64, 64, 128, 128, [40, 90, 220])
  fill(112, 152, 32, 8, [200, 40, 40])

  const { spriteSet, pixelation } = generatePetSpriteSet(src, { id: 'custom_1', name: '小蓝', description: '蓝色方块' })
  assert(pixelation.opaquePixels > 0, 'pixelation should keep the pet body')
  assert(spriteSet.id === 'custom_1' && spriteSet.name === '小蓝', 'meta should be wired into sprite set')
  assert(typeof spriteSet.sprites['stand_neutral'] === 'string', 'stand_neutral must exist for validateSpriteSet')
  assert(Object.keys(spriteSet.sprites).length === 195, 'sprite set should cover all pose/expression keys')
}

function testGeneratePetSpriteSetRejectsEmptySubject() {
  // 纯白图:抠背景后什么都不剩,应抛出引导性错误
  const src = createRawImage(128, 128)
  for (let p = 0; p < 128 * 128; p++) {
    src.data[p * 4] = 255
    src.data[p * 4 + 1] = 255
    src.data[p * 4 + 2] = 255
    src.data[p * 4 + 3] = 255
  }
  let message = ''
  try {
    generatePetSpriteSet(src, { id: 'x', name: 'x', description: '' })
  } catch (err) {
    message = err instanceof Error ? err.message : String(err)
  }
  assert(message.includes('像素化后没有可用主体'), `empty subject should raise a friendly error, got: ${message}`)
}

testPromptTemplateLocksConstraints()
testEditPromptTemplate()
testPromptTruncatesLongInput()
testFilterImageGenModels()
testFilterChatModels()
testBase64Helpers()
testParseImageDataUrl()
testSuggestSpriteMeta()
testGeneratePetSpriteSetEndToEnd()
testGeneratePetSpriteSetRejectsEmptySubject()
