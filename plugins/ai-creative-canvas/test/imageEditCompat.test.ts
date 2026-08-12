import assert from 'node:assert/strict'
import {
  editImageWithMaskCompatibility,
  type ImageEditApi,
  type LegacyImageEditInput
} from '../src/ui/services/imageEditCompat.ts'

const input: LegacyImageEditInput = {
  model: 'test:image-model',
  imageAttachmentId: 'source-1',
  maskAttachmentId: 'mask-1',
  prompt: 'replace the painted area'
}

const ok = { images: ['result'], tokens: {} }

async function testNativeMask() {
  const calls: LegacyImageEditInput[] = []
  const api: ImageEditApi = {
    providers: {
      describe: async () => ({ capabilities: { operations: ['generate', 'edit', 'inpaint'], input: { supportsMask: true } } })
    },
    edit: async (value) => { calls.push(value); return ok }
  }
  const result = await editImageWithMaskCompatibility(api, input)
  assert.equal(result.mode, 'native-mask')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].maskAttachmentId, 'mask-1')
}

async function testDescribeDrivenFallback() {
  const calls: LegacyImageEditInput[] = []
  const api: ImageEditApi = {
    providers: {
      describe: async () => ({ capabilities: { operations: ['generate', 'edit'], input: { supportsMask: false } } })
    },
    edit: async (value) => { calls.push(value); return ok }
  }
  const result = await editImageWithMaskCompatibility(api, input)
  assert.equal(result.mode, 'composite-fallback')
  assert.equal(calls.length, 1, '能力已知时不应先提交一次必败的 inpaint')
  assert.equal(calls[0].maskAttachmentId, undefined)
}

async function testSafeValidationFallback() {
  const calls: LegacyImageEditInput[] = []
  const api: ImageEditApi = {
    providers: { describe: async () => { throw new Error('old host') } },
    edit: async (value) => {
      calls.push(value)
      if (value.maskAttachmentId) {
        throw Object.assign(new Error('Image operation "inpaint" is not supported'), {
          code: 'unsupported_operation', phase: 'validate', billed: 'no'
        })
      }
      return ok
    }
  }
  const result = await editImageWithMaskCompatibility(api, input)
  assert.equal(result.mode, 'composite-fallback')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].maskAttachmentId, undefined)
}

async function testNoUnsafeRetry() {
  let calls = 0
  const charged = Object.assign(new Error('provider rejected'), {
    code: 'unsupported_operation', phase: 'submit', billed: 'unknown'
  })
  const api: ImageEditApi = {
    edit: async () => { calls++; throw charged }
  }
  await assert.rejects(() => editImageWithMaskCompatibility(api, input), (error) => error === charged)
  assert.equal(calls, 1, '可能已提交/计费时不得自动重试')
}

async function testPlainEdit() {
  let described = false
  const api: ImageEditApi = {
    providers: { describe: async () => { described = true; return {} } },
    edit: async () => ok
  }
  const result = await editImageWithMaskCompatibility(api, { ...input, maskAttachmentId: undefined })
  assert.equal(result.mode, 'plain-edit')
  assert.equal(described, false)
}

await testNativeMask()
await testDescribeDrivenFallback()
await testSafeValidationFallback()
await testNoUnsafeRetry()
await testPlainEdit()
console.log('image edit compatibility: 5 tests OK')
