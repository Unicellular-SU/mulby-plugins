import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const securitySource = readFileSync(resolve(pluginRoot, 'src/ui/modules/Security/index.tsx'), 'utf8')
const settingsSource = readFileSync(resolve(pluginRoot, 'src/ui/modules/Settings/index.tsx'), 'utf8')
const sidebarSource = readFileSync(resolve(pluginRoot, 'src/ui/components/Sidebar.tsx'), 'utf8')
const manifestSource = readFileSync(resolve(pluginRoot, 'manifest.json'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  securitySource.includes('title="存储与安全"'),
  'Security module page title must be renamed to 存储与安全'
)

assert(
  securitySource.includes('ApiReferencePanel') && securitySource.includes('page-with-api-panel'),
  'Storage and security module must use the shared right-side API panel layout'
)

assert(
  !securitySource.includes('CodeBlock'),
  'Storage and security module must not keep API examples in main content'
)

for (const token of [
  'security.isEncryptionAvailable',
  'security.encryptString',
  'security.decryptString',
  'storage.setWithVersion',
  'storage.getMeta',
  'storage.setMany',
  'storage.getMany',
  'storage.transaction',
  'storage.append',
  'storage.watch',
  'storage.encrypted',
  'storage.attachment',
]) {
  assert(securitySource.includes(token), `Storage and security module must demonstrate ${token}`)
}

assert(
  !securitySource.includes('storage.listNamespaces') && !securitySource.includes('storage.getAllWithMeta'),
  'Storage and security module must not demonstrate host storage explorer APIs'
)

for (const token of [
  'storage.setWithVersion',
  'storage.getMeta',
  'storage.setMany',
  'storage.getMany',
  'storage.transaction',
  'storage.append',
  'storage.watch',
  'storage.encrypted',
  'storage.attachment',
]) {
  assert(!settingsSource.includes(token), `Settings module must no longer own storage demo API ${token}`)
}

assert(
  sidebarSource.includes("label: '存储与安全'"),
  'Sidebar label for the security module must be 存储与安全'
)

assert(
  manifestSource.includes('"explain": "存储与安全"'),
  'Manifest feature explain for the security module must be 存储与安全'
)
