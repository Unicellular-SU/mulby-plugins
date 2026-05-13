import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const pluginModulePath = resolve(pluginRoot, 'src/ui/modules/PluginOrchestration/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(pluginModulePath), 'Plugin Orchestration module file must exist')

const pluginSource = readFileSync(pluginModulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')

assert(
  pluginSource.includes('ApiReferencePanel') && pluginSource.includes('page-with-api-panel'),
  'Plugin Orchestration module must use the shared right-side API panel layout'
)

assert(
  !pluginSource.includes('CodeBlock'),
  'Plugin Orchestration module must not keep API examples in main content'
)

for (const token of [
  'plugin.getAll',
  'plugin.listCommands',
  'plugin.search',
  'plugin.run(',
  'plugin.runCommand',
  'plugin.getRecentUsed',
  'plugin.redirect',
  'plugin.outPlugin',
  'plugin.listCommandShortcuts',
  'plugin.validateCommandShortcut',
  'plugin.bindCommandShortcut',
  'plugin.unbindCommandShortcut',
  'plugin.setCommandDisabled',
  'plugin.listBackground',
  'plugin.getBackgroundInfo',
  'plugin.prewarm',
  'onPluginInit',
  'onPluginAttach',
  'onPluginDetached',
  'onPluginOut',
  'onPluginLaunchStart',
  'onPluginLaunchEnd',
]) {
  assert(pluginSource.includes(token), `Plugin Orchestration module must demonstrate ${token}`)
}

for (const forbidden of [
  'plugin.install(',
  'plugin.uninstall(',
  'plugin.enable(',
  'plugin.disable(',
  'pluginStore',
  'installFromUrl',
  'updateAll',
  'checkUpdatesInstalled',
  'systemPage',
  'settings.',
  'developer',
  'trayMenu',
  'superPanel',
  'systemPlugin',
  'onboarding',
]) {
  assert(!pluginSource.includes(forbidden), `Plugin Orchestration module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('PluginOrchestrationModule'), 'App must import and render PluginOrchestrationModule')
assert(appSource.includes("plugin: 'plugin'"), 'App feature map must route plugin to the Plugin Orchestration module')
assert(sidebarSource.includes("label: '插件编排'"), 'Sidebar must include Plugin Orchestration module')
assert(indexSource.includes("from './PluginOrchestration'"), 'Module index must export Plugin Orchestration module')
assert(manifestSource.includes('"code": "plugin"'), 'Manifest must declare plugin feature')
