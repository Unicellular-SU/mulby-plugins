import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const modulePath = resolve(pluginRoot, 'src/ui/modules/DynamicFeatures/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(modulePath), 'Dynamic Features module file must exist')

const source = readFileSync(modulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')
const mainSource = read('src/main.ts')

assert(
  source.includes('ApiReferencePanel') && source.includes('page-with-api-panel'),
  'Dynamic Features module must use the shared right-side API panel layout'
)

assert(!source.includes('CodeBlock'), 'Dynamic Features module must not keep API examples in main content')

for (const token of [
  'host.call',
  'listShowcaseDynamicFeatures',
  'setShowcaseDynamicFeature',
  'removeShowcaseDynamicFeature',
  'resetShowcaseDynamicFeatures',
  'registerDynamicFeatures',
  'showcase:main-push',
  'onMainPush',
  'onMainPushSelect',
]) {
  assert(source.includes(token), `Dynamic Features module must demonstrate ${token}`)
}

for (const token of [
  'listShowcaseDynamicFeatures',
  'setShowcaseDynamicFeature',
  'removeShowcaseDynamicFeature',
  'resetShowcaseDynamicFeatures',
  'registerShowcaseMainPush',
  'features.getFeatures',
  'features.setFeature',
  'features.removeFeature',
  'features.onMainPush',
  'features.onMainPushSelect',
]) {
  assert(mainSource.includes(token), `Backend must expose dynamic features token ${token}`)
}

for (const forbidden of [
  'systemPage',
  'settings.',
  'developer',
  'pluginStore',
  'trayMenu',
  'superPanel',
  'systemPlugin',
  'onboarding',
  'redirectHotKeySetting',
  'redirectAiModelsSetting',
]) {
  assert(!source.includes(forbidden), `Dynamic Features module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('DynamicFeaturesModule'), 'App must import and render DynamicFeaturesModule')
assert(appSource.includes("features: 'features'"), 'App feature map must route features to Dynamic Features module')
assert(sidebarSource.includes("label: '动态指令'"), 'Sidebar must include Dynamic Features module')
assert(indexSource.includes("from './DynamicFeatures'"), 'Module index must export Dynamic Features module')
assert(manifestSource.includes('"code": "features"'), 'Manifest must declare features feature')
