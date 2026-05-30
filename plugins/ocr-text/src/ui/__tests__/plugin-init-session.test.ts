import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldProcessPluginInit } from '../pluginInitSession.ts'

describe('plugin init session handling', () => {
  it('processes every new launch nonce and ignores only duplicate replays', () => {
    const lastNonceRef: { current: number | string | null } = { current: null }

    assert.equal(shouldProcessPluginInit(lastNonceRef, { nonce: 1001 }), true)
    assert.equal(shouldProcessPluginInit(lastNonceRef, { nonce: 1001 }), false)
    assert.equal(shouldProcessPluginInit(lastNonceRef, { nonce: 1002 }), true)
  })

  it('keeps processing hot launches after the first accepted payload', () => {
    const lastNonceRef: { current: number | string | null } = { current: null }
    const processed: string[] = []

    for (const payload of [
      { nonce: 2001, image: 'first-capture' },
      { nonce: 2002, image: 'second-capture' },
    ]) {
      if (shouldProcessPluginInit(lastNonceRef, payload)) {
        processed.push(payload.image)
      }
    }

    assert.deepEqual(processed, ['first-capture', 'second-capture'])
  })

  it('keeps handling init payloads when nonce is unavailable', () => {
    const lastNonceRef: { current: number | string | null } = { current: null }

    assert.equal(shouldProcessPluginInit(lastNonceRef, {}), true)
    assert.equal(shouldProcessPluginInit(lastNonceRef, {}), true)
  })
})
