import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const hostRpcModulePath = resolve(pluginRoot, 'src/ui/modules/HostRPC/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(hostRpcModulePath), 'Host RPC module file must exist')

const hostRpcSource = readFileSync(hostRpcModulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')
const mainSource = read('src/main.ts')

assert(
  hostRpcSource.includes('ApiReferencePanel') && hostRpcSource.includes('page-with-api-panel'),
  'Host RPC module must use the shared right-side API panel layout'
)

assert(
  !hostRpcSource.includes('CodeBlock'),
  'Host RPC module must not keep API examples in main content'
)

for (const token of [
  'host.status',
  'host.call',
  'host.invoke',
  'host.restart',
  'getHostRpcBackendStatus',
  'echoHostRpcPayload',
  'notifyFromHostRpc',
  'storageRoundtripFromHostRpc',
  'readClipboardViaHostRpcInvoke',
  'safeBackendApiCall',
]) {
  assert(hostRpcSource.includes(token), `Host RPC module must demonstrate ${token}`)
}

for (const token of [
  'getHostRpcBackendStatus',
  'echoHostRpcPayload',
  'notifyFromHostRpc',
  'storageRoundtripFromHostRpc',
  'safeBackendApiCall',
  'mulby.notification.show',
  'mulby.storage.set',
  'mulby.storage.get',
]) {
  assert(mainSource.includes(token), `Backend must expose Host RPC token ${token}`)
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
  assert(!hostRpcSource.includes(forbidden), `Host RPC module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('HostRPCModule'), 'App must import and render HostRPCModule')
assert(appSource.includes("'host-rpc': 'host-rpc'"), 'App feature map must route host-rpc to the Host RPC module')
assert(sidebarSource.includes("label: 'Host RPC'"), 'Sidebar must include Host RPC module')
assert(indexSource.includes("from './HostRPC'"), 'Module index must export Host RPC module')
assert(manifestSource.includes('"code": "host-rpc"'), 'Manifest must declare host-rpc feature')
