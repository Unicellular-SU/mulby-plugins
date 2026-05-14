import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pluginDir = path.join(root, 'plugins', 'mulby-api-lab')
const mulbyApiDocsDir = 'D:\\Node.js\\mulby\\docs\\apis'
const requiredFiles = [
  'manifest.json',
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'src/main.ts',
  'src/types/mulby.d.ts',
  'src/ui/App.tsx',
  'src/ui/apiRegistry.ts',
  'src/ui/main.tsx',
  'src/ui/styles.css',
  'src/ui/index.html',
  'README.md',
  'assets/icon.svg',
  'icon.png'
]

const expectedFeatures = [
  'lab-main',
  'lab-search',
  'lab-files',
  'lab-over',
  'lab-precapture',
  'lab-silent',
  'lab-mainpush',
  'lab-window'
]

const expectedTools = ['echo', 'summarize_api_module', 'safe_file_probe']
const emojiRanges = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u
const errors = []
const namespaceByDocModule = {
  'app-events': 'app',
  'clipboard-history': 'clipboardHistory',
  'input-monitor': 'inputMonitor',
  'plugin-store': 'pluginStore',
  'super-panel': 'superPanel',
  'system-page': 'systemPage',
  'system-plugin': 'systemPlugin',
  'tray-menu': 'trayMenu'
}

const noParenHeadingsByModule = {
  features: new Set(['getFeatures', 'setFeature', 'removeFeature', 'onMainPush', 'onMainPushSelect', 'redirectHotKeySetting', 'redirectAiModelsSetting'])
}

function assert(condition, message) {
  if (!condition) errors.push(message)
}

function readText(relativePath) {
  return fs.readFileSync(path.join(pluginDir, relativePath), 'utf8')
}

function extractRegistryMethods(registry) {
  const registryMethods = new Set()
  const quotedValues = (source) => Array.from(source.matchAll(/['"]([^'"]+)['"]/g), (match) => match[1])

  for (const match of registry.matchAll(/method\(\s*['"]([^'"]+)['"]/g)) {
    registryMethods.add(match[1])
  }

  for (const match of registry.matchAll(/methods\(\s*['"]([^'"]+)['"]\s*,\s*\[([\s\S]*?)\]/g)) {
    const prefix = match[1]
    for (const name of quotedValues(match[2])) {
      registryMethods.add(`${prefix}.${name}`)
    }
  }

  return registryMethods
}

function cleanHeading(raw) {
  return raw
    .replace(/`/g, '')
    .replace(/^\d+\.\s*/, '')
    .trim()
}

function splitMethodHeading(raw) {
  return cleanHeading(raw)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
}

function tokenFromHeadingPart(part) {
  const parenIndex = part.indexOf('(')
  if (parenIndex >= 0) {
    part = part.slice(0, parenIndex).trim()
  }
  const token = part.split(/\s+/)[0]?.trim()
  return /^[A-Za-z_$][\w.$-]*$/.test(token) ? token : ''
}

function canonicalMethodName(moduleId, token) {
  const namespace = namespaceByDocModule[moduleId] || moduleId
  if (!token) return ''
  if (token.startsWith('api.')) token = token.slice(4)

  if (moduleId === 'ai') {
    return token.startsWith('ai.') ? token : `ai.${token}`
  }

  if (moduleId === 'storage') {
    if (token.startsWith('encrypted.') || token.startsWith('attachment.')) return `storage.${token}`
    return token.startsWith('storage.') ? token : `storage.${token}`
  }

  if (moduleId === 'window') {
    if (token.startsWith('subInput.')) return `window.${token}`
    if (token.startsWith('mulbyMain.')) return token
    if (token.startsWith('ChildWindowHandle.')) return token
    return token.startsWith('window.') ? token : `window.${token}`
  }

  if (moduleId === 'sharp') {
    if (token === 'sharp') return 'sharp.sharp'
    if (token === 'getSharpVersion') return 'getSharpVersion'
    return token.startsWith('sharp.') ? token : `sharp.${token}`
  }

  if (moduleId === 'theme' && token === 'onThemeChange') return 'onThemeChange'

  if ((moduleId === 'plugin' || moduleId === 'app-events') && token.startsWith('onPlugin')) {
    return `pluginLifecycle.${token}`
  }

  if (token.includes('.')) return token
  return `${namespace}.${token}`
}

function extractDocMethods(moduleId, docContent) {
  const methods = new Set()
  const noParenHeadings = noParenHeadingsByModule[moduleId] || new Set()

  for (const match of docContent.matchAll(/^#{3,4}\s+(.+)$/gm)) {
    const heading = cleanHeading(match[1])
    if (!heading) continue

    if (moduleId === 'screen' && /\bpreCapture\b/.test(heading)) {
      methods.add('screen.preCapture')
      continue
    }

    if (!heading.includes('(') && !noParenHeadings.has(heading)) continue

    for (const part of splitMethodHeading(heading)) {
      const token = tokenFromHeadingPart(part)
      const canonical = canonicalMethodName(moduleId, token)
      if (canonical) methods.add(canonical)
    }
  }

  for (const match of docContent.matchAll(/^\s*-\s+`([^`]+)`/gm)) {
    const item = cleanHeading(match[1])
    if (!item.includes('(')) continue
    const token = tokenFromHeadingPart(item)
    const canonical = canonicalMethodName(moduleId, token)
    if (canonical) methods.add(canonical)
  }

  return methods
}

assert(fs.existsSync(pluginDir), 'plugins/mulby-api-lab directory is missing')

if (fs.existsSync(pluginDir)) {
  for (const file of requiredFiles) {
    assert(fs.existsSync(path.join(pluginDir, file)), `${file} is missing`)
  }

  const manifestPath = path.join(pluginDir, 'manifest.json')
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    assert(manifest.id === 'mulby-api-lab', 'manifest.id must be mulby-api-lab')
    assert(manifest.name === 'mulby-api-lab', 'manifest.name must be mulby-api-lab')
    assert(manifest.main === 'dist/main.js', 'manifest.main must point to dist/main.js')
    assert(manifest.ui === 'ui/index.html', 'manifest.ui must point to ui/index.html')
    assert(manifest.icon === 'icon.png', 'manifest.icon must point to icon.png')
    assert(manifest.type === 'developer', 'manifest.type must be developer')
    assert(manifest.pluginSetting?.background === true, 'pluginSetting.background must be true')
    assert(manifest.pluginSetting?.single === true, 'pluginSetting.single must be true')
    assert(manifest.pluginSetting?.idleTimeoutMs === 'never', 'pluginSetting.idleTimeoutMs must be never')

    const features = new Set((manifest.features || []).map((feature) => feature.code))
    for (const feature of expectedFeatures) {
      assert(features.has(feature), `feature ${feature} is missing`)
    }

    const tools = new Set((manifest.tools || []).map((tool) => tool.name))
    for (const tool of expectedTools) {
      assert(tools.has(tool), `tool ${tool} is missing`)
    }

    assert(!emojiRanges.test(JSON.stringify(manifest)), 'manifest must not use emoji icons')
  }

  const mainPath = path.join(pluginDir, 'src', 'main.ts')
  if (fs.existsSync(mainPath)) {
    const main = fs.readFileSync(mainPath, 'utf8')
    for (const tool of expectedTools) {
      assert(new RegExp(`tools\\.register\\(['"]${tool}['"]`).test(main), `tool ${tool} is not registered in src/main.ts`)
    }
    for (const feature of expectedFeatures) {
      assert(main.includes(feature), `src/main.ts does not reference feature ${feature}`)
    }
    assert(main.includes('export const rpc'), 'src/main.ts must export rpc methods')
  }

  const textFiles = requiredFiles.filter((file) => !file.endsWith('.png'))
  for (const file of textFiles) {
    const absolute = path.join(pluginDir, file)
    if (fs.existsSync(absolute)) {
      const content = fs.readFileSync(absolute, 'utf8')
      assert(!emojiRanges.test(content), `${file} contains emoji-like icon characters`)
    }
  }

  const appPath = path.join(pluginDir, 'src', 'ui', 'App.tsx')
  if (fs.existsSync(appPath)) {
    const app = readText('src/ui/App.tsx')
    assert(app.includes('from \'lucide-react\''), 'App.tsx must use lucide-react icons')
    assert(!app.includes('const modules = []'), 'App.tsx module list must not be empty')
    assert(app.includes('function ApiModulePage'), 'App.tsx must render module-first pages')
    assert(app.includes('function ApiMethodTable'), 'App.tsx must include method coverage tables')
    assert(app.includes('function RawOutputDrawer'), 'App.tsx must keep raw API output in collapsible drawers')
    assert(app.includes('function CollapsibleContextPanel'), 'App.tsx must include a collapsible context panel')
    assert(!app.includes('function ScenarioPanel'), 'App.tsx must not use the old scenario grid model')
    assert(!app.includes('function DemoCard'), 'App.tsx must not use the old bare DemoCard model')
    assert(!app.includes('<JsonBlock value={runState.value}'), 'Raw JSON must not be the primary demo result')
  }

  const registryPath = path.join(pluginDir, 'src', 'ui', 'apiRegistry.ts')
  if (fs.existsSync(registryPath)) {
    const registry = fs.readFileSync(registryPath, 'utf8')
    const registryMethods = extractRegistryMethods(registry)
    assert(registry.includes('export const apiRegistry'), 'apiRegistry.ts must export apiRegistry')
    assert(registry.includes("id: 'window'"), 'apiRegistry must include window module')
    assert(registry.includes("id: 'inbrowser'"), 'apiRegistry must include inbrowser module')
    assert(registry.includes('window.create'), 'apiRegistry must include window.create coverage')
    assert(registry.includes('ChildWindowHandle'), 'apiRegistry must include ChildWindowHandle coverage')
    assert(registry.includes('inbrowser.goto'), 'apiRegistry must include inbrowser.goto coverage')
    assert(registry.includes('inbrowser.run'), 'apiRegistry must include inbrowser.run coverage')
    assert(registry.includes('inbrowser.evaluate'), 'apiRegistry must include inbrowser.evaluate coverage')
    assert(registry.includes('inbrowser.screenshot'), 'apiRegistry must include inbrowser.screenshot coverage')

    if (fs.existsSync(mulbyApiDocsDir)) {
      const docModules = fs.readdirSync(mulbyApiDocsDir)
        .filter((file) => file.endsWith('.md') && file !== 'README.md')
        .map((file) => path.basename(file, '.md'))
      for (const moduleId of docModules) {
        assert(registry.includes(`id: '${moduleId}'`) || registry.includes(`id: "${moduleId}"`), `apiRegistry missing docs module ${moduleId}`)
        const docPath = path.join(mulbyApiDocsDir, `${moduleId}.md`)
        const docMethods = extractDocMethods(moduleId, fs.readFileSync(docPath, 'utf8'))
        for (const method of docMethods) {
          assert(registryMethods.has(method), `apiRegistry missing docs method ${moduleId}: ${method}`)
        }
      }
    }
  }

  assert(fs.existsSync(path.join(pluginDir, 'dist', 'main.js')), 'dist/main.js build output is missing')
  assert(fs.existsSync(path.join(pluginDir, 'ui', 'index.html')), 'ui/index.html build output is missing')
}

if (errors.length > 0) {
  console.error(`Mulby API Lab validation failed with ${errors.length} issue(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Mulby API Lab validation passed')
