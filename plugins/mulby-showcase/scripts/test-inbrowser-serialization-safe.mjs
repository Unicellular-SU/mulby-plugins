import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const source = readFileSync(resolve(pluginRoot, 'src/ui/modules/InBrowser/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const expectedFunctionCalls = [
  /\.when\(\s*\(\)\s*=>\s*Boolean\(document\.body\)\s*\)/,
  /\.wait\(\s*\(\)\s*=>\s*Boolean\(\(window as unknown as \{ __fixtureReady\?: boolean \}\)\.__fixtureReady\)\s*\)/,
  /\.evaluate\(\s*\(\)\s*=>\s*\(\{/,
  /\.download\(\s*\(\)\s*=>\s*location\.href,\s*savePath\s*\)/,
]

for (const pattern of expectedFunctionCalls) {
  assert(
    pattern.test(source),
    'InBrowser showcase must exercise real Function arguments for when/wait/evaluate/download'
  )
}

assert(
  !/id="inbrowser-url"[\s\S]*?disabled=\{useLocalFixture\}/.test(source),
  'External URL input must remain editable even when the local fixture toggle is enabled'
)

assert(
  !source.includes('const pageScripts = {'),
  'InBrowser showcase must not hide Function API coverage behind string script constants'
)
