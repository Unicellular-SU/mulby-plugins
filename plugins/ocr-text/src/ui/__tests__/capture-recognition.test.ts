import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { requestCaptureRecognition } from '../captureRecognition.ts'

function createMulby(runResult: { success: boolean; error?: string }) {
  const calls: string[] = []
  return {
    calls,
    mulby: {
      window: {
        hide: (restore?: boolean) => calls.push(`hide:${restore === true}`),
        show: () => calls.push('show'),
      },
      plugin: {
        run: async (pluginId: string, featureCode: string) => {
          calls.push(`run:${pluginId}:${featureCode}`)
          return runResult
        },
      },
    },
  }
}

describe('capture recognition launch', () => {
  it('reuses the plugin feature preCapture path instead of direct screen capture', async () => {
    const { mulby, calls } = createMulby({ success: true })

    const result = await requestCaptureRecognition(mulby)

    assert.deepEqual(calls, ['hide:true', 'run:ocr-text:ocr'])
    assert.deepEqual(result, { success: true })
  })

  it('restores the plugin window when preCapture is cancelled', async () => {
    const { mulby, calls } = createMulby({ success: false, error: 'Capture cancelled' })

    const result = await requestCaptureRecognition(mulby)

    assert.deepEqual(calls, ['hide:true', 'run:ocr-text:ocr', 'show'])
    assert.equal(result.success, false)
  })
})
