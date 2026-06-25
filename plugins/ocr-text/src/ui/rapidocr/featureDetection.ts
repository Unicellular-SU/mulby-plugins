import type { RapidOcrCapabilities } from './types'

/**
 * Detect browser capabilities required by RapidOCR before attempting to load
 * the engine. This allows early, clear error messages instead of cryptic
 * runtime failures from dynamic imports or ONNX initialization.
 */
export function detectRapidOcrCapabilities(): RapidOcrCapabilities {
  const webAssembly = (() => {
    try {
      return (
        typeof WebAssembly === 'object' &&
        typeof WebAssembly.instantiate === 'function' &&
        (() => {
          const module = new WebAssembly.Module(
            Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00),
          )
          return module instanceof WebAssembly.Module
        })()
      )
    } catch {
      return false
    }
  })()

  const webGL = (() => {
    try {
      const canvas = document.createElement('canvas')
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
      return gl !== null
    } catch {
      return false
    }
  })()

  const webWorker = typeof Worker !== 'undefined'

  const indexedDB = (() => {
    try {
      return typeof indexedDB !== 'undefined'
    } catch {
      return false
    }
  })()

  const missingFeatures: string[] = []
  if (!webAssembly) missingFeatures.push('WebAssembly')
  if (!webGL) missingFeatures.push('WebGL')
  if (!webWorker) missingFeatures.push('Web Worker')
  if (!indexedDB) missingFeatures.push('IndexedDB')

  return {
    webAssembly,
    webGL,
    webWorker,
    indexedDB,
    allSupported: missingFeatures.length === 0,
    missingFeatures,
  }
}
