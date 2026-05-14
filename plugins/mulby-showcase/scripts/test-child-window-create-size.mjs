import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const source = readFileSync(resolve(pluginRoot, 'src/ui/modules/WindowAPI/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const createChildMatch = source.match(
  /const handleCreateChild = async \(\) => \{([\s\S]*?)\n\s*const handleCreateOverlay = async/
)

assert(createChildMatch, 'WindowAPI module must define handleCreateChild before handleCreateOverlay')

const handleCreateChildBody = createChildMatch[1]

assert(
  /win\.getBounds\(\)/.test(handleCreateChildBody),
  'handleCreateChild must read the current window bounds before creating a child window'
)
assert(
  /const childWindowBounds = toWindowBounds\(await win\.getBounds\(\)\) \|\| bounds \|\| \{ x: 0, y: 0, width: 560, height: 420 \}/.test(handleCreateChildBody),
  'handleCreateChild must derive childWindowBounds from the parent window bounds with an old-size fallback'
)
assert(
  /width:\s*childWindowBounds\.width/.test(handleCreateChildBody),
  'window.create child options must use the parent window width'
)
assert(
  /height:\s*childWindowBounds\.height/.test(handleCreateChildBody),
  'window.create child options must use the parent window height'
)
assert(
  !/win\.create\('child-window',\s*\{[\s\S]*?width:\s*560[\s\S]*?\}\)/.test(handleCreateChildBody)
    && !/win\.create\('child-window',\s*\{[\s\S]*?height:\s*420[\s\S]*?\}\)/.test(handleCreateChildBody),
  'handleCreateChild must not hardcode the normal child window size in window.create options'
)
