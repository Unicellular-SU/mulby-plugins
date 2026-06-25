import type { RapidOcrProgress } from './types'
import { detectRapidOcrCapabilities } from './featureDetection'

// RapidOCR runs via the backend (src/main.ts) which calls Python RapidOCR
// through shell commands — the same pattern as native OCR (Swift/PowerShell).
// This module manages capability detection and initialization state for the
// frontend UI.

let rapidOcrAvailable: boolean | null = null
let rapidOcrCheckError = ''

/**
 * Check whether Python RapidOCR is available on this system.
 * Calls the backend RPC which runs `python3 -c "from rapidocr import RapidOCR"`.
 * Result is cached after the first call.
 */
export async function checkRapidOcrAvailable(
  mulby: any,
): Promise<{ available: boolean; error: string }> {
  if (rapidOcrAvailable !== null) {
    return { available: rapidOcrAvailable, error: rapidOcrCheckError }
  }
  try {
    const res = await mulby.host.call('checkRapidOcr')
    console.log('[rapidocr] checkRapidOcr raw response:', JSON.stringify(res))
    const data = res?.data || res
    rapidOcrAvailable = !!data?.available
    rapidOcrCheckError = data?.error || ''
    console.log('[rapidocr] available:', rapidOcrAvailable, 'error:', rapidOcrCheckError)
  } catch (err: any) {
    console.error('[rapidocr] checkRapidOcr failed:', err)
    rapidOcrAvailable = false
    rapidOcrCheckError = err?.message || '检测失败'
  }
  return { available: !!rapidOcrAvailable, error: rapidOcrCheckError }
}

/**
 * Check browser capabilities (WASM/WebGL not needed for backend-based OCR,
 * but we still verify basic web APIs are available).
 */
export function checkBrowserCapabilities(): boolean {
  const caps = detectRapidOcrCapabilities()
  // Backend-based OCR only needs basic browser functionality
  return caps.webWorker && typeof fetch === 'function'
}

export function isRapidOcrReady(): boolean {
  return rapidOcrAvailable === true
}

export interface RapidOcrProcessResult {
  text: string
  engine: 'rapidocr'
}

/**
 * Process an image through RapidOCR via the backend RPC.
 * @param mulby - The Mulby API instance
 * @param dataUrl - Image data URL
 */
export async function processRapidOcrImage(
  mulby: any,
  dataUrl: string,
): Promise<RapidOcrProcessResult> {
  // Extract base64 and mimeType from data URL
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL')
  const mimeType = match[1]
  const base64 = match[2]

  console.log('[rapidocr] Calling backend rapidOcr RPC...')
  const res = await mulby.host.call('rapidOcr', base64, mimeType)
  console.log('[rapidocr] Backend response:', JSON.stringify(res))
  const data = res?.data || res

  if (!data?.success) {
    throw new Error(data?.error || 'RapidOCR 识别失败')
  }

  console.log('[rapidocr] Recognition succeeded, text length:', data.text?.length)
  return { text: data.text ?? '', engine: 'rapidocr' }
}
