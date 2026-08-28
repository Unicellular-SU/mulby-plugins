import assert from 'node:assert/strict'
import { getParamSchema } from '../../src/ui/services/paramSchema.ts'
import {
  buildProviderRequestPreview,
  isProviderConfigShape,
  migrateProviderConfig,
  renderProviderTemplate,
  resolveVideoCapabilities,
  validateProviderConfig
} from '../../src/ui/services/providers/config.ts'
import { PROVIDER_TEMPLATES } from '../../src/ui/services/providers/presets.ts'
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
  const arrays = renderProviderTemplate('{"prompt":"{prompt}"{?images},"images":{$images}{/images}{?videos},"videos":{$videos}{/videos}}', {
    prompt: 'safe',
    images: ['https://example.test/a.png', 'data:image/png;base64,ABC'],
    videos: ['https://example.test/v.mp4']
  })
  assert.deepEqual(JSON.parse(arrays), {
    prompt: 'safe',
    images: ['https://example.test/a.png', 'data:image/png;base64,ABC'],
    videos: ['https://example.test/v.mp4']
  })
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
  assert.equal(isProviderConfigShape({ ...templateProvider, submitRetries: -1 }), false)
  assert.ok(validateProviderConfig({ ...templateProvider, submitRetries: 1.5 }).some((issue) => issue.field === 'submitRetries'))
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

function testSeedance25Preset() {
  const template = PROVIDER_TEMPLATES.find((item) => item.id === 'raydu-seedance25')
  assert.ok(template, '应提供 Raydu Seedance 2.5 模板')
  const provider = template.make()
  assert.equal(provider.model, 'seedance25')
  assert.equal(provider.submitUrl, 'https://raydu.liekumall.com/v1/video/generations')
  assert.equal(provider.pollUrl, 'https://raydu.liekumall.com/v1/video/generations/{taskId}')
  assert.equal(provider.taskIdPath, 'task_id|taskId|id')
  assert.equal(provider.statusField, 'status')
  assert.equal(provider.videoUrlPath, 'result.videoUrl|result.ossUrl|result.originalUrl|result.videoUrls.0|result_url|result.url|result.video_url')
  assert.deepEqual(provider.pollScheduleMs, [5000, 10000, 15000, 20000, 30000])
  assert.equal(provider.timeoutMs, 2400000)
  assert.equal(provider.submitRetries, 0)
  const capabilities = resolveVideoCapabilities(provider)
  assert.equal(capabilities.referenceInputs.images.max, 9)
  assert.equal(capabilities.referenceInputs.videos.max, 3)
  assert.equal(capabilities.referenceInputs.mixed, true)
  assert.equal(validateProviderConfig(provider).filter((issue) => issue.level === 'error').length, 0)

  const preview = buildProviderRequestPreview(provider, true)
  assert.deepEqual(preview.body, {
    model: 'seedance25',
    prompt: '示例视频描述',
    images: [
      'https://example.invalid/reference-1.png',
      'https://example.invalid/reference-2.png'
    ],
    videos: ['https://example.invalid/reference.mp4'],
    settings: {
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      enableSound: 'on'
    }
  })
  assert.equal(preview.pollUrl, 'https://raydu.liekumall.com/v1/video/generations/task-demo')

  const syncTemplate = PROVIDER_TEMPLATES.find((item) => item.id === 'raydu-seedance25-sync')
  assert.ok(syncTemplate, '应提供 Raydu Seedance 2.5 同步模板')
  const syncProvider = syncTemplate.make()
  assert.equal(syncProvider.submitUrl, 'https://raydu.liekumall.com/v1/video/generate')
  assert.equal(syncProvider.pollUrl, undefined)
  assert.equal(syncProvider.videoUrlPath, 'videoUrl|ossUrl|originalUrl')
  assert.equal(syncProvider.timeoutMs, 720000)
  assert.equal(syncProvider.submitRetries, 0)
  assert.equal(validateProviderConfig(syncProvider).filter((issue) => issue.level === 'error').length, 0)
  const syncPreview = buildProviderRequestPreview(syncProvider, true)
  assert.deepEqual(syncPreview.body, {
    model: 'seedance25',
    prompt: '示例视频描述',
    images: [
      'https://example.invalid/reference-1.png',
      'https://example.invalid/reference-2.png'
    ],
    videos: ['https://example.invalid/reference.mp4'],
    settings: {
      resolution: '720p',
      ratio: '16:9',
      duration: 5,
      enableSound: 'on'
    },
    timeoutMs: 600000
  })
  assert.equal(syncPreview.pollUrl, undefined)
}

function testSeedance25StoredProviderMigration() {
  const current = PROVIDER_TEMPLATES.find((item) => item.id === 'raydu-seedance25')?.make()
  assert.ok(current)
  const legacy: ProviderConfig = {
    ...current,
    taskIdPath: 'task_id',
    videoUrlPath: 'result_url',
    pollScheduleMs: undefined,
    pollIntervalMs: 3000,
    timeoutMs: 1800000
  }
  const migrated = migrateProviderConfig(legacy)
  assert.notEqual(migrated, legacy)
  assert.equal(migrated.taskIdPath, 'task_id|taskId|id')
  assert.equal(migrated.videoUrlPath, 'result.videoUrl|result.ossUrl|result.originalUrl|result.videoUrls.0|result_url|result.url|result.video_url')
  assert.deepEqual(migrated.pollScheduleMs, [5000, 10000, 15000, 20000, 30000])
  assert.equal(migrated.timeoutMs, 2400000)

  const customized = { ...legacy, pollIntervalMs: 12000, videoUrlPath: 'custom.url', timeoutMs: 900000 }
  const preserved = migrateProviderConfig(customized)
  assert.equal(preserved.videoUrlPath, 'custom.url', '用户自定义结果路径不应被覆盖')
  assert.equal(preserved.pollScheduleMs, undefined, '用户自定义固定间隔不应被退避覆盖')
  assert.equal(preserved.pollIntervalMs, 12000)
  assert.equal(preserved.timeoutMs, 900000)
}

testTemplateAndPreview()
testValidation()
testCapabilitiesAndCardSchema()
testSeedance25Preset()
testSeedance25StoredProviderMigration()
console.log('provider config: assertions OK')
