import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const source = readFileSync(resolve(pluginRoot, 'src/ui/modules/Settings/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  source.includes('ApiReferencePanel'),
  'Settings module must use the shared right-side API reference panel'
)

assert(
  source.includes('page-with-api-panel'),
  'Settings module must use the two-column page-with-api-panel layout'
)

assert(
  !source.includes('CodeBlock'),
  'Settings module must not keep API examples in the main content'
)

assert(
  !source.includes('window.mulby?.settings') && !source.includes('window.mulby.settings'),
  'Settings module must not demonstrate the host-only settings API'
)

assert(
  !source.includes('theme.set(') && !source.includes('theme?.set('),
  'Settings module must avoid mutating host-wide theme settings'
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
  assert(!source.includes(token), `Settings module must not duplicate storage demo API ${token}`)
}

assert(
  source.includes('shortcut.onTriggered'),
  'Settings module must use the current shortcut.onTriggered disposer-based listener'
)
