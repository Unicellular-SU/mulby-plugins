import * as ort from 'onnxruntime-web/wasm'
import type { RapidOcrProgress } from './types'
import { PpOcrEngine } from './ppocr/engine'
import { buildDictionary } from './ppocr/recognition'
import type { RawImage, SessionRunner } from './ppocr/types'

// Built-in offline OCR engine: PP-OCRv4 ONNX models running on
// onnxruntime-web's WASM backend. Models + WASM runtime ship inside the
// plugin package (ui/models, ui/ort), so no Python, no network, no external
// dependency — works identically on macOS / Windows / Linux.
//
// The plugin UI is loaded over file://, where fetch() of local files is
// blocked. Everything is therefore loaded as bytes through
// mulby.filesystem.readFile and handed to onnxruntime-web directly:
//   - models: Uint8Array -> ort.InferenceSession.create(bytes)
//   - wasm glue/binary: Blob URLs via ort.env.wasm.wasmPaths
// Inference runs on the main thread (proxy worker disabled); recognition of
// a typical screenshot region takes ~1-2s and the CSS spinner keeps animating
// on the compositor meanwhile.

type ProgressCallback = (progress: RapidOcrProgress) => void

let engine: PpOcrEngine | null = null
let initError = ''
let initPromise: Promise<boolean> | null = null

function report(cb: ProgressCallback | undefined, status: RapidOcrProgress['status'], message: string, downloadPercent = 0) {
  cb?.({ status, downloadPercent, message })
}

/**
 * Whether the built-in offline OCR engine can run in this WebView.
 * Only WebAssembly is required; no external environment is involved.
 */
export function isRapidOcrSupported(): boolean {
  try {
    return (
      typeof WebAssembly === 'object' &&
      new WebAssembly.Module(Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00)) instanceof WebAssembly.Module
    )
  } catch {
    return false
  }
}

/**
 * Initialize the built-in OCR engine (loads WASM runtime + models from the
 * plugin package). Safe to call repeatedly; the result is cached and an
 * in-flight init is shared. Retries are allowed after a failure.
 */
export async function checkRapidOcrAvailable(
  mulby: any,
  onProgress?: ProgressCallback,
): Promise<{ available: boolean; error: string }> {
  if (engine) return { available: true, error: '' }
  if (!initPromise) initPromise = initEngine(mulby, onProgress)
  const ok = await initPromise
  if (!ok) initPromise = null
  return { available: ok, error: initError }
}

export function isRapidOcrReady(): boolean {
  return engine !== null
}

export interface RapidOcrProcessResult {
  text: string
  engine: 'rapidocr'
}

/**
 * Recognize an image (data URL) with the built-in engine.
 * Returns lines joined by newlines, in reading order.
 */
export async function processRapidOcrImage(
  _mulby: any,
  dataUrl: string,
): Promise<RapidOcrProcessResult> {
  if (!engine) throw new Error(initError || '离线 OCR 引擎未初始化')
  const image = await decodeDataUrl(dataUrl)
  const lines = await engine.recognize(image)
  return { text: lines.map((l) => l.text).join('\n'), engine: 'rapidocr' }
}

async function initEngine(mulby: any, onProgress?: ProgressCallback): Promise<boolean> {
  initError = ''
  try {
    if (!isRapidOcrSupported()) {
      throw new Error('当前环境不支持 WebAssembly，无法运行离线 OCR 引擎')
    }

    report(onProgress, 'downloading', '正在加载 OCR 运行时…', 10)
    const [glueBytes, wasmBytes] = await Promise.all([
      readPluginFile(mulby, 'ort/ort-wasm-simd-threaded.mjs'),
      readPluginFile(mulby, 'ort/ort-wasm-simd-threaded.wasm'),
    ])
    const glueUrl = URL.createObjectURL(new Blob([glueBytes as unknown as BlobPart], { type: 'text/javascript' }))
    const wasmUrl = URL.createObjectURL(new Blob([wasmBytes as unknown as BlobPart], { type: 'application/wasm' }))
    ort.env.wasm.proxy = false
    ort.env.wasm.numThreads = 1
    ;(ort.env.wasm as any).wasmPaths = { mjs: glueUrl, wasm: wasmUrl }

    report(onProgress, 'downloading', '正在加载文字检测模型…', 40)
    const detBytes = await readPluginFile(mulby, 'models/ch_PP-OCRv4_det_infer.onnx')
    const detSession = await ort.InferenceSession.create(detBytes, { executionProviders: ['wasm'] })

    report(onProgress, 'downloading', '正在加载文字识别模型…', 70)
    const recBytes = await readPluginFile(mulby, 'models/ch_PP-OCRv4_rec_infer.onnx')
    const recSession = await ort.InferenceSession.create(recBytes, { executionProviders: ['wasm'] })

    report(onProgress, 'initializing', '正在初始化离线引擎…', 90)
    const keysText = await readPluginFile(mulby, 'models/ppocr_keys_v1.txt', 'utf-8')
    const dict = buildDictionary(String(keysText))

    engine = new PpOcrEngine(makeRunner(detSession), makeRunner(recSession), dict)
    report(onProgress, 'ready', '离线 OCR 引擎就绪', 100)
    return true
  } catch (err: any) {
    console.error('[rapidocr] init failed:', err)
    initError = err?.message || '离线 OCR 引擎初始化失败'
    report(onProgress, 'error', initError)
    return false
  }
}

function makeRunner(session: ort.InferenceSession): SessionRunner {
  return async (input) => {
    const tensor = new ort.Tensor('float32', input.data, input.dims)
    const outputs = await session.run({ [session.inputNames[0]]: tensor })
    const out = outputs[session.outputNames[0]]
    return { data: out.data as Float32Array, dims: [...out.dims] }
  }
}

/** Read a file shipped inside the plugin package, relative to the UI dir. */
async function readPluginFile(mulby: any, relPath: string): Promise<Uint8Array>
async function readPluginFile(mulby: any, relPath: string, encoding: 'utf-8'): Promise<string>
async function readPluginFile(mulby: any, relPath: string, encoding?: 'utf-8'): Promise<Uint8Array | string> {
  const url = new URL(relPath, new URL('.', location.href))
  const filePath = fileUrlToPath(url)
  const result = await mulby.filesystem.readFile(filePath, encoding)
  if (encoding === 'utf-8') return String(result)
  return toUint8Array(result)
}

function fileUrlToPath(url: URL): string {
  let p = decodeURIComponent(url.pathname)
  // Windows: file:///C:/... -> C:/...
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
  return p
}

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  // IPC may serialize Buffer as { type: 'Buffer', data: number[] }
  if (data && typeof data === 'object' && Array.isArray((data as any).data)) {
    return Uint8Array.from((data as any).data)
  }
  throw new Error('无法读取插件内置资源文件')
}

/** Decode a data URL into an RGBA pixel buffer via an off-DOM canvas. */
function decodeDataUrl(dataUrl: string): Promise<RawImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('无法创建画布')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        resolve({ data: imageData.data, width: imageData.width, height: imageData.height })
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}
