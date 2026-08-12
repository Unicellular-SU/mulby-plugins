import assert from 'node:assert/strict'
import { getParamSchema } from '../../src/ui/services/paramSchema.ts'
import {
  buildProviderRequestPreview,
  isProviderConfigShape,
  renderProviderTemplate,
  resolveVideoCapabilities,
  validateProviderConfig
} from '../../src/ui/services/providers/config.ts'
import type { ProviderConfig } from '../../src/ui/services/providers/types.ts'
import type { Card } from '../../src/ui/types.ts'

const templateProvider: ProviderConfig = {
  id: 'provider-1',
  label: 'Template Video',
  kind: 'video',
  type: 'custom-video',
  baseURL: '',
  submitUrl: 'https://api.test/v1/generate',
  pollUrl: 'https://api.test/v1/tasks/{taskId}',
  taskIdPath: 'id',
  statusField: 'status',
  videoUrlPath: 'result.url',
  model: 'video-pro',
  models: ['video-pro'],
  bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image":"{imageUrl}"{/imageUrl}{?lastImageUrl},"last":"{lastImageUrl}"{/lastImageUrl},"duration":{duration}}',
  capabilities: {
    textToVideo: true,
    imageToVideo: true,
    lastFrame: false,
    nativeAudio: false,
    aspects: ['16:9', '9:16'],
    durations: [5, 10],
    resolutions: ['720p', '1080p']
  }
}

function testTemplateAndPreview() {
  const rendered = renderProviderTemplate('{"prompt":"{prompt}"{?imageUrl},"image":"{imageUrl}"{/imageUrl}}', { prompt: 'a "quote"', imageUrl: undefined })
  assert.deepEqual(JSON.parse(rendered), { prompt: 'a "quote"' })
  const preview = buildProviderRequestPreview(templateProvider, true)
  assert.equal(preview.url, templateProvider.submitUrl)
  assert.equal(preview.headers.Authorization, 'Bearer ••••••••')
  assert.equal((preview.body as any).duration, 5)
  assert.equal((preview.body as any).last, undefined, '未声明尾帧能力时不应出现在预览请求')
  const sensitive = buildProviderRequestPreview({ ...templateProvider, headers: { 'X-Api-Key': 'do-not-leak', 'X-Trace': 'safe' } }, false)
  assert.equal(sensitive.headers['X-Api-Key'], '••••••••')
  assert.equal(sensitive.headers['X-Trace'], 'safe')
}

function testValidation() {
  assert.equal(validateProviderConfig(templateProvider).filter((issue) => issue.level === 'error').length, 0)
  assert.match(validateProviderConfig({ ...templateProvider, submitUrl: 'bad-url' })[0].message, /提交 URL/)
  assert.ok(validateProviderConfig(templateProvider, '{bad json').some((issue) => issue.field === 'headers' && issue.level === 'error'))
  assert.ok(validateProviderConfig(templateProvider, '{"X-Retry": 3}').some((issue) => issue.field === 'headers' && issue.level === 'error'))
  assert.ok(validateProviderConfig({ ...templateProvider, capabilities: { textToVideo: false, imageToVideo: false } }).some((issue) => issue.field === 'capabilities'))
  assert.ok(validateProviderConfig({ ...templateProvider, bodyTemplate: '{"prompt":"{prompt}"}' }).some((issue) => issue.field === 'capabilities.imageToVideo'))
  assert.ok(validateProviderConfig({ ...templateProvider, bodyTemplate: undefined, baseURL: 'https://api.test', submitPath: '/generate', promptField: 'prompt', resultPath: 'url', capabilities: { textToVideo: true, imageToVideo: true } }).some((issue) => issue.field === 'capabilities.imageToVideo'))
  assert.equal(isProviderConfigShape(templateProvider), true)
  assert.equal(isProviderConfigShape({ id: 'broken' }), false)
  assert.equal(isProviderConfigShape({ ...templateProvider, headers: { Authorization: 42 } }), false)
}

function testCapabilitiesAndCardSchema() {
  const inferred = resolveVideoCapabilities({ ...templateProvider, capabilities: undefined })
  assert.equal(inferred.imageToVideo, true)
  assert.equal(inferred.lastFrame, true)
  const card = { id: 'video-1', kind: 'video', params: {} } as Card
  const schema = getParamSchema(card, templateProvider.capabilities)
  assert.deepEqual((schema.find((field) => field.type === 'select' && field.key === 'aspect') as any).options.map((item: any) => item.value), ['16:9', '9:16'])
  assert.ok(schema.some((field) => field.type === 'select' && field.key === 'resolution'))
  const reference = schema.find((field) => field.type === 'select' && field.key === 'refMode') as any
  assert.deepEqual(reference.options.map((item: any) => item.value), ['omni'])
  const textOnly = getParamSchema(card, { textToVideo: true, imageToVideo: false })
  assert.equal(textOnly.some((field) => field.type === 'select' && field.key === 'refMode'), false)
  assert.ok(getParamSchema(card).some((field) => field.type === 'select' && field.key === 'refMode'), '未配置 Provider 时应保留通用参数')
}

testTemplateAndPreview()
testValidation()
testCapabilitiesAndCardSchema()
console.log('provider config: 25 assertions OK')
