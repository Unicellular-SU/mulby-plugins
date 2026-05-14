import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const packageSource = read('package.json')
const fileManagerSource = read('src/ui/modules/FileManager/index.tsx')
const moduleSources = [
  'src/ui/modules/DynamicFeatures/index.tsx',
  'src/ui/modules/HostRPC/index.tsx',
  'src/ui/modules/Log/index.tsx',
  'src/ui/modules/PluginOrchestration/index.tsx',
  'src/ui/modules/Scheduler/index.tsx',
  'src/ui/modules/FileManager/index.tsx',
].map(path => ({ path, source: read(path) }))

assert(
  packageSource.includes('test:dialog-modal-modernization'),
  'package.json must include the dialog modal modernization regression test'
)

assert(
  !fileManagerSource.includes('dialog.showErrorBox') && !fileManagerSource.includes('showErrorBox(title, content)'),
  'File Manager must not demonstrate dialog.showErrorBox because it opens a native error dialog'
)

assert(
  fileManagerSource.includes("type: 'error'") && fileManagerSource.includes('dialog.showMessageBox'),
  'File Manager error demo must use dialog.showMessageBox with error styling'
)

for (const { path, source } of moduleSources) {
  assert(!source.includes('window.confirm'), `${path} must use dialog.showMessageBox instead of window.confirm`)
  assert(!source.includes('window.alert'), `${path} must use in-plugin dialog or notification instead of window.alert`)
}
