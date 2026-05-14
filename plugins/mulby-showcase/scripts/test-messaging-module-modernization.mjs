import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const messagingModulePath = resolve(pluginRoot, 'src/ui/modules/Messaging/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(messagingModulePath), 'Messaging module file must exist')

const messagingSource = readFileSync(messagingModulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')
const mainSource = read('src/main.ts')

assert(
  messagingSource.includes('ApiReferencePanel') && messagingSource.includes('page-with-api-panel'),
  'Messaging module must use the shared right-side API panel layout'
)

assert(
  !messagingSource.includes('CodeBlock'),
  'Messaging module must not keep API examples in main content'
)

for (const token of [
  'host.call',
  'sendShowcaseMessage',
  'broadcastShowcaseMessage',
  'getRecentShowcaseMessages',
  'clearShowcaseMessages',
  'parseJsonPayload',
  'targetPluginId',
  'messageType',
  'payloadText',
]) {
  assert(messagingSource.includes(token), `Messaging module must demonstrate ${token}`)
}

for (const token of [
  'recentMessages',
  'showcaseMessagingHandler',
  'recordShowcaseMessage',
  'sendShowcaseMessage',
  'broadcastShowcaseMessage',
  'getRecentShowcaseMessages',
  'clearShowcaseMessages',
  'mulby.messaging.send',
  'mulby.messaging.broadcast',
  'context.api.messaging.on',
  'context.api.messaging.off',
  'onBackground(context?: PluginContext)',
]) {
  assert(mainSource.includes(token), `Backend must expose messaging token ${token}`)
}

for (const forbidden of [
  'systemPage',
  'settings.',
  'developer',
  'pluginStore',
  'trayMenu',
  'superPanel',
  'getMessageBus',
  'getHistory(',
]) {
  assert(!messagingSource.includes(forbidden), `Messaging module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('MessagingModule'), 'App must import and render MessagingModule')
assert(appSource.includes("messaging: 'messaging'"), 'App feature map must route messaging to the Messaging module')
assert(sidebarSource.includes("label: '插件通信'"), 'Sidebar must include Messaging module')
assert(indexSource.includes("from './Messaging'"), 'Module index must export Messaging module')
assert(manifestSource.includes('"code": "messaging"'), 'Manifest must declare messaging feature')

const manifest = JSON.parse(manifestSource)
assert(
  manifest.pluginSetting?.background === true,
  'Showcase manifest must keep messaging subscriptions alive in background'
)
assert(
  manifest.pluginSetting?.idleTimeoutMs === 'never',
  'Showcase manifest must prevent idle cleanup while demonstrating plugin messaging'
)
