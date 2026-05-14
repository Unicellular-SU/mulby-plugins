import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const childModule = readFileSync(resolve(pluginRoot, 'src/ui/modules/ChildWindow/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  childModule.includes('className="preview-box window-message-log"'),
  'ChildWindow received messages panel must use the same scroll container as the parent window message log'
)
assert(
  childModule.includes('className="window-message-log-content"'),
  'ChildWindow received messages panel must use the same scroll content wrapper as the parent window message log'
)

