import assert from 'node:assert/strict'
import {
  buildImageAlt,
  DEFAULT_IMAGE_SIZE,
  filterImageModels,
  IMAGE_SIZES,
  normalizeBase64,
  runImageGeneration,
  toImageDataUrl,
  type ImageAiClient,
  type ImageProgressChunk
} from './imageGen'

// filterImageModels keeps only image-generation capable models.
assert.deepEqual(
  filterImageModels([
    { id: 'gpt-4o', endpointType: 'openai' },
    { id: 'dall-e-3', endpointType: 'image-generation' },
    { id: 'flux', supportedEndpointTypes: ['image-generation'] },
    { id: '', endpointType: 'image-generation' },
    { label: 'no-id', endpointType: 'image-generation' }
  ]).map((model) => model.id),
  ['dall-e-3', 'flux']
)
assert.deepEqual(filterImageModels([]), [])
// Non-array input is tolerated.
assert.deepEqual(filterImageModels(undefined as never), [])

// normalizeBase64 strips data-url prefixes and whitespace.
assert.equal(normalizeBase64('aGVsbG8='), 'aGVsbG8=')
assert.equal(normalizeBase64('data:image/png;base64,aGVsbG8='), 'aGVsbG8=')
assert.equal(normalizeBase64('  aG Vs bG8=\n'), 'aGVsbG8=')
assert.equal(normalizeBase64(''), '')

// toImageDataUrl wraps raw base64 and passes existing data URLs through.
assert.equal(toImageDataUrl('aGVsbG8='), 'data:image/png;base64,aGVsbG8=')
assert.equal(toImageDataUrl('data:image/jpeg;base64,abc'), 'data:image/jpeg;base64,abc')
assert.equal(toImageDataUrl('aGVsbG8=', 'image/webp'), 'data:image/webp;base64,aGVsbG8=')
assert.equal(toImageDataUrl(''), '')

// buildImageAlt collapses whitespace, strips markdown-breaking chars, truncates.
assert.equal(buildImageAlt('  一只  在月球上的\n猫  '), '一只 在月球上的 猫')
assert.equal(buildImageAlt('a [b] \\c'), 'a b c')
assert.equal(buildImageAlt('x'.repeat(60)).length, 51) // 50 chars + ellipsis
assert.ok(buildImageAlt('x'.repeat(60)).endsWith('…'))

// IMAGE_SIZES are labelled by aspect ratio, in tall→wide order, and each value
// is a valid WxH pair. The default must be one of the presets.
{
  const ratios = IMAGE_SIZES.map((item) => item.label.split(' ')[0])
  assert.deepEqual(ratios, ['9:16', '2:3', '3:4', '1:1', '4:3', '3:2', '16:9'])
  for (const item of IMAGE_SIZES) {
    assert.match(item.value, /^\d+x\d+$/, `size value should be WxH: ${item.value}`)
  }
  assert.ok(
    IMAGE_SIZES.some((item) => item.value === DEFAULT_IMAGE_SIZE),
    'DEFAULT_IMAGE_SIZE must be one of the presets'
  )
}

// runImageGeneration prefers the streaming API and forwards previews/results.
{
  const previews: string[] = []
  const statuses: ImageProgressChunk[] = []
  const ai: ImageAiClient = {
    images: {
      generateStream: (input, onChunk) => {
        assert.equal(input.prompt, '一只猫')
        assert.equal(input.model, 'dall-e-3')
        onChunk({ type: 'status', stage: 'start', message: '开始' })
        onChunk({ type: 'preview', image: 'partial==', index: 0 })
        const promise = Promise.resolve({ images: ['final=='] }) as Promise<{
          images: string[]
        }> & { abort?: () => void }
        promise.abort = () => undefined
        return promise
      }
    }
  }
  const handle = runImageGeneration({
    ai,
    model: 'dall-e-3',
    prompt: '一只猫',
    onPreview: (image) => previews.push(image),
    onStatus: (chunk) => statuses.push(chunk)
  })
  const result = await handle.result
  assert.deepEqual(result.images, ['final=='])
  assert.equal(result.aborted, false)
  assert.deepEqual(previews, ['partial=='])
  assert.equal(statuses.length, 1)
  assert.equal(statuses[0].stage, 'start')
}

// runImageGeneration falls back to the non-streaming API.
{
  const ai: ImageAiClient = {
    images: {
      generate: async (input) => ({ images: [`gen:${input.prompt}`] })
    }
  }
  const handle = runImageGeneration({ ai, model: 'm', prompt: 'hi' })
  const result = await handle.result
  assert.deepEqual(result.images, ['gen:hi'])
  assert.equal(result.aborted, false)
}

// runImageGeneration surfaces aborts without throwing.
{
  let abortCalled = false
  const ai: ImageAiClient = {
    images: {
      generateStream: (_input, _onChunk) => {
        const promise = new Promise<{ images: string[] }>((_resolve, reject) => {
          // Reject shortly after, simulating a host abort rejection.
          setTimeout(() => reject(new Error('aborted by host')), 5)
        }) as Promise<{ images: string[] }> & { abort?: () => void }
        promise.abort = () => {
          abortCalled = true
        }
        return promise
      }
    }
  }
  const handle = runImageGeneration({ ai, model: 'm', prompt: 'p' })
  handle.abort()
  const result = await handle.result
  assert.equal(abortCalled, true)
  assert.equal(result.aborted, true)
  assert.deepEqual(result.images, [])
}

// runImageGeneration rejects when no image API is available.
{
  const handle = runImageGeneration({ ai: {}, model: 'm', prompt: 'p' })
  await assert.rejects(handle.result, /未启用 Mulby 生图能力/)
}

console.log('markdown-editor imageGen unit tests passed')
