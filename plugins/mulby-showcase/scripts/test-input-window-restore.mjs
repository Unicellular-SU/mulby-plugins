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
const inputModuleSource = read('src/ui/modules/Input/index.tsx')

assert(
  packageSource.includes('test:input-window-restore'),
  'package.json must include the input window restore regression test'
)

assert(
  inputModuleSource.includes('restoreInputWindowsAfterInput'),
  'Input module must use a shared restore helper after input actions'
)

const restoreCalls = inputModuleSource.match(/await restoreInputWindowsAfterInput\(\)/g) ?? []

assert(
  restoreCalls.length >= 5,
  'Input module must restore hidden Mulby windows after single actions and WPS script flows'
)

for (const actionName of ['runAction', 'runSimulateAction', 'runWpsAutoScript', 'runWpsTableScript', 'runQuickFormatScript']) {
  const actionIndex = inputModuleSource.indexOf(actionName)
  assert(actionIndex >= 0, `Input module must define ${actionName}`)

  const nextActionIndex = inputModuleSource.indexOf('\n    const ', actionIndex + actionName.length)
  const section = inputModuleSource.slice(actionIndex, nextActionIndex > actionIndex ? nextActionIndex : undefined)

  assert(
    section.includes('await restoreInputWindowsAfterInput()'),
    `${actionName} must restore hidden Mulby windows when its input flow completes`
  )
}
