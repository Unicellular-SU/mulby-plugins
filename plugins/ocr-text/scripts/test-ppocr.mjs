/**
 * Node smoke test for the built-in PP-OCR pipeline.
 *
 * Validates the exact same pipeline code that ships in the plugin UI
 * (src/ui/rapidocr/ppocr/*), running it on onnxruntime-web's WASM backend in
 * Node against the bundled PP-OCRv4 models.
 *
 * Usage: node scripts/test-ppocr.mjs [image.png]
 */
import { build } from 'esbuild'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const pluginRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const imagePath = path.resolve(process.argv[2] || 'scripts/test-image.png')

// 1. Bundle the pipeline TS (platform-neutral: no DOM/Node APIs inside)
const bundlePath = path.join(pluginRoot, 'node_modules/.cache/ppocr-engine.test.mjs')
await build({
  entryPoints: [path.join(pluginRoot, 'src/ui/rapidocr/ppocr/engine.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile: bundlePath,
  logLevel: 'silent',
})
const { PpOcrEngine } = await import(url.pathToFileURL(bundlePath).href)

// 2. onnxruntime-web (node build) with WASM backend
const ort = await import('onnxruntime-web')
ort.env.wasm.proxy = false
ort.env.wasm.numThreads = 1
const ortDist = path.join(pluginRoot, 'node_modules/onnxruntime-web/dist')
ort.env.wasm.wasmPaths = {
  mjs: path.join(ortDist, 'ort-wasm-simd-threaded.mjs'),
  wasm: path.join(ortDist, 'ort-wasm-simd-threaded.wasm'),
}

const makeRunner = (session) => async (input) => {
  const tensor = new ort.Tensor('float32', input.data, input.dims)
  const outputs = await session.run({ [session.inputNames[0]]: tensor })
  const t = outputs[session.outputNames[0]]
  return { data: t.data, dims: [...t.dims] }
}

// 3. Load models + dictionary (same files the plugin ships)
const modelsDir = path.join(pluginRoot, 'src/ui/public/models')
console.time('load-models')
const detSession = await ort.InferenceSession.create(
  new Uint8Array(fs.readFileSync(path.join(modelsDir, 'ch_PP-OCRv4_det_infer.onnx'))),
  { executionProviders: ['wasm'] },
)
const recSession = await ort.InferenceSession.create(
  new Uint8Array(fs.readFileSync(path.join(modelsDir, 'ch_PP-OCRv4_rec_infer.onnx'))),
  { executionProviders: ['wasm'] },
)
console.timeEnd('load-models')
console.log('det in/out:', detSession.inputNames, detSession.outputNames)
console.log('rec in/out:', recSession.inputNames, recSession.outputNames)

const keysText = fs.readFileSync(path.join(modelsDir, 'ppocr_keys_v1.txt'), 'utf-8')
const dict = [...keysText.split('\n'), ' ']

const engine = new PpOcrEngine(makeRunner(detSession), makeRunner(recSession), dict)

// 4. Decode PNG and run
const png = PNG.sync.read(fs.readFileSync(imagePath))
const image = { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), width: png.width, height: png.height }
console.log(`image: ${image.width}x${image.height}`)

console.time('recognize')
const lines = await engine.recognize(image)
console.timeEnd('recognize')

console.log(`--- ${lines.length} lines ---`)
for (const l of lines) console.log(`${l.score.toFixed(3)}  ${l.text}`)
