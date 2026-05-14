import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const styles = readFileSync(resolve(pluginRoot, 'src/ui/styles.css'), 'utf8')
const windowModule = readFileSync(resolve(pluginRoot, 'src/ui/modules/WindowAPI/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function getRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))
  return match?.[1] ?? ''
}

const gridTwoRule = getRule('.grid-2')
assert(
  /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(gridTwoRule),
  '.grid-2 must use minmax(0, 1fr) so long content cannot widen one column'
)

const windowLogRule = getRule('.window-message-log')
assert(windowLogRule, 'Window communication log must use the .window-message-log class')
assert(/overflow:\s*auto/.test(windowLogRule), '.window-message-log must scroll in both axes')
assert(/max-height:\s*180px/.test(windowLogRule), '.window-message-log must cap height so messages scroll vertically')
assert(/min-width:\s*0/.test(windowLogRule), '.window-message-log must be allowed to shrink inside grid cells')

const windowLogContentRule = getRule('.window-message-log-content')
assert(windowLogContentRule, 'Window communication log content must use the .window-message-log-content class')
assert(/width:\s*max-content/.test(windowLogContentRule), '.window-message-log-content must preserve long rows for horizontal scrolling')
assert(/min-width:\s*100%/.test(windowLogContentRule), '.window-message-log-content must still fill the empty/short state')

assert(
  windowModule.includes('className="preview-box window-message-log"'),
  'WindowAPI module must attach the scroll container class to the preview box'
)
assert(
  windowModule.includes('className="window-message-log-content"'),
  'WindowAPI module must attach the scroll content class to the message list'
)

