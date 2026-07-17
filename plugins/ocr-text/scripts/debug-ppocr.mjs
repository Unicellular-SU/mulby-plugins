/** Debug harness: dump det boxes, crops, and per-crop rec results. */
import { build } from 'esbuild'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const pluginRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const imagePath = path.resolve(process.argv[2] || 'scripts/test-image.png')
const outDir = path.join(pluginRoot, 'scripts/debug-crops')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: {
    engine: path.join(pluginRoot, 'src/ui/rapidocr/ppocr/engine.ts'),
    detection: path.join(pluginRoot, 'src/ui/rapidocr/ppocr/detection.ts'),
    recognition: path.join(pluginRoot, 'src/ui/rapidocr/ppocr/recognition.ts'),
    imaging: path.join(pluginRoot, 'src/ui/rapidocr/ppocr/imaging.ts'),
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outdir: path.join(pluginRoot, 'node_modules/.cache/ppocr-debug'),
  logLevel: 'silent',
})
const cacheDir = path.join(pluginRoot, 'node_modules/.cache/ppocr-debug')
const { runDetection } = await import(url.pathToFileURL(path.join(cacheDir, 'detection.js')).href)
const { recognizeLines, buildDictionary } = await import(url.pathToFileURL(path.join(cacheDir, 'recognition.js')).href)
const { cropPerspective, rotate90CCW } = await import(url.pathToFileURL(path.join(cacheDir, 'imaging.js')).href)

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

const modelsDir = path.join(pluginRoot, 'src/ui/public/models')
const detSession = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(modelsDir, 'ch_PP-OCRv4_det_infer.onnx'))), { executionProviders: ['wasm'] })
const recSession = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(path.join(modelsDir, 'ch_PP-OCRv4_rec_infer.onnx'))), { executionProviders: ['wasm'] })
const dict = buildDictionary(fs.readFileSync(path.join(modelsDir, 'ppocr_keys_v1.txt'), 'utf-8'))

const png = PNG.sync.read(fs.readFileSync(imagePath))
const image = { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), width: png.width, height: png.height }

const savePng = (img, name) => {
  const p = new PNG({ width: img.width, height: img.height })
  Buffer.from(img.data).copy(p.data)
  fs.writeFileSync(path.join(outDir, name), PNG.sync.write(p))
}

const { boxes, resized } = await runDetection(makeRunner(detSession), image)
console.log(`det boxes: ${boxes.length} (resized ${resized.width}x${resized.height})`)
savePng(resized, '_resized.png')
boxes.forEach((b, i) => {
  const w = Math.hypot(b.box[0][0] - b.box[1][0], b.box[0][1] - b.box[1][1]).toFixed(0)
  const h = Math.hypot(b.box[0][0] - b.box[3][0], b.box[0][1] - b.box[3][1]).toFixed(0)
  console.log(`box ${i}: score=${b.score.toFixed(3)} ${w}x${h} pts=${JSON.stringify(b.box.map(p => p.map(v => Math.round(v))))}`)
})

const crops = boxes.map(({ box }) => {
  let crop = cropPerspective(image, box)
  if (crop.height / crop.width >= 1.5) crop = rotate90CCW(crop)
  return crop
})
crops.forEach((c, i) => savePng(c, `crop-${i}.png`))

const recs = await recognizeLines(makeRunner(recSession), crops, dict)
recs.forEach((r, i) => console.log(`rec ${i}: score=${r.score.toFixed(3)} "${r.text}"`))

// dump rec model inputs (after resize to 48px height)
const { resizeBilinear } = await import(url.pathToFileURL(path.join(cacheDir, 'imaging.js')).href)
crops.forEach((c, i) => {
  const targetW = Math.max(1, Math.min(320, Math.ceil((48 * c.width) / c.height)))
  savePng(resizeBilinear(c, targetW, 48), `rec-input-${i}.png`)
})
