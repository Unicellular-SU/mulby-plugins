import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const modulePath = resolve(pluginRoot, 'src/ui/modules/Log/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(modulePath), 'Log module file must exist')

const source = readFileSync(modulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')

assert(
  source.includes('ApiReferencePanel') && source.includes('page-with-api-panel'),
  'Log module must use the shared right-side API panel layout'
)

assert(!source.includes('CodeBlock'), 'Log module must not keep API examples in main content')

for (const token of [
  'log.debug',
  'log.info',
  'log.warn',
  'log.error',
  'log.getLogs',
  'log.clear',
  'log.getLogsDir',
  'log.subscribe',
  'log.onLog',
  'liveEntries',
  'writeLogEntry',
]) {
  assert(source.includes(token), `Log module must demonstrate ${token}`)
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
]) {
  assert(!source.includes(forbidden), `Log module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('LogModule'), 'App must import and render LogModule')
assert(appSource.includes("log: 'log'"), 'App feature map must route log to Log module')
assert(sidebarSource.includes("label: '日志'"), 'Sidebar must include Log module')
assert(indexSource.includes("from './Log'"), 'Module index must export Log module')
assert(manifestSource.includes('"code": "log"'), 'Manifest must declare log feature')
