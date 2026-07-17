/**
 * End-to-end test of the plugin UI OCR engine in a real Chromium page loaded
 * over file:// (same protocol and restrictions as the Mulby plugin WebView).
 *
 * Exercises the risky parts the Node smoke test cannot reach:
 *   - plugin-file resolution from location.href (file:// URL -> fs path)
 *   - mulby.filesystem.readFile byte loading (stubbed via CDP)
 *   - onnxruntime-web WASM init through Blob URLs (glue mjs dynamic import +
 *     wasm binary), main-thread inference (proxy disabled)
 *   - data-URL image decode -> full PP-OCR pipeline
 *
 * Usage: node scripts/test-e2e.mjs
 */
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const require = createRequire(import.meta.url)
const puppeteer = require('puppeteer')

const pluginRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(pluginRoot, 'node_modules/.cache/e2e')
fs.mkdirSync(cacheDir, { recursive: true })

// 1. Bundle the UI engine exactly as vite would resolve it (classic script so
//    Chrome's file:// page can load it; Chrome blocks ESM on file://, the
//    Electron WebView does not).
await build({
  entryPoints: [path.join(pluginRoot, 'src/ui/rapidocr/engine.ts')],
  bundle: true,
  format: 'iife',
  globalName: '__ocrEngine',
  platform: 'browser',
  define: { 'import.meta.url': '"file:///"' },
  outfile: path.join(cacheDir, 'engine.bundle.js'),
  logLevel: 'silent',
})

// 2. Harness page inside ui/ so relative plugin-file resolution matches
//    production (ui/index.html -> ui/models, ui/ort).
const harnessPath = path.join(pluginRoot, 'ui', '__e2e__.html')
fs.writeFileSync(
  harnessPath,
  `<!doctype html>
<html><head><meta charset="utf-8"></head><body>
<script>
window.mulby = {
  filesystem: {
    readFile: async (p, encoding) => {
      const r = await window.__nodeReadFile(p)
      if (encoding === 'utf-8') return r.text
      const bin = atob(r.base64)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      return u8
    },
  },
}
</script>
<script src="${url.pathToFileURL(path.join(cacheDir, 'engine.bundle.js')).href}"></script>
<script>
window.__run = async () => {
  const progress = []
  const init = await __ocrEngine.checkRapidOcrAvailable(window.mulby, (p) =>
    progress.push(p.status + ':' + p.downloadPercent + ':' + p.message),
  )
  if (!init.available) return { error: init.error, progress }
  const dataUrl = await window.__getImageDataUrl()
  const t0 = Date.now()
  const out = await __ocrEngine.processRapidOcrImage(window.mulby, dataUrl)
  return { text: out.text, ms: Date.now() - t0, progress }
}
</script>
</body></html>`,
)

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.on('console', (msg) => console.log('[page]', msg.type(), msg.text()))
  page.on('pageerror', (err) => console.log('[pageerror]', String(err)))

  await page.exposeFunction('__nodeReadFile', (p) => {
    const buf = fs.readFileSync(p)
    return { base64: buf.toString('base64'), text: buf.toString('utf-8') }
  })
  await page.exposeFunction('__getImageDataUrl', () => {
    const buf = fs.readFileSync(path.join(pluginRoot, 'scripts/test-image.png'))
    return 'data:image/png;base64,' + buf.toString('base64')
  })

  await page.goto(url.pathToFileURL(harnessPath).href)
  const result = await page.evaluate(() => window.__run())

  console.log('--- progress ---')
  for (const p of result.progress || []) console.log(' ', p)
  if (result.error) {
    console.error('INIT FAILED:', result.error)
    process.exitCode = 1
  } else {
    console.log(`--- recognized in ${result.ms}ms ---`)
    console.log(result.text)

    const expected = ['OCR', '无需安装Python环境', 'The quick brown fox jumps over the lazy dog 1234567890', 'macOS', 'Apache-2.0']
    const missing = expected.filter((e) => !result.text.replace(/\s/g, '').includes(e.replace(/\s/g, '')))
    if (missing.length) {
      console.error('MISSING expected fragments:', missing)
      process.exitCode = 1
    } else {
      console.log('E2E PASS: all expected fragments recognized')
    }
  }
} finally {
  await browser.close()
  fs.rmSync(harnessPath, { force: true })
}
