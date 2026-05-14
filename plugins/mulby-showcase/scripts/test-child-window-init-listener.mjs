import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const source = readFileSync(resolve(pluginRoot, 'src/ui/modules/ChildWindow/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const listenerEffectMatch = source.match(
  /useEffect\(\(\) => \{\s*return onPluginInit\(\(data\) => \{[\s\S]*?\n\s*\}, \[([^\]]*)\]\)/
)

assert(listenerEffectMatch, 'ChildWindowModule must register onPluginInit in a dedicated useEffect')

const dependencies = listenerEffectMatch[1].split(',').map((item) => item.trim()).filter(Boolean)

assert(
  !dependencies.includes('routeParams'),
  'onPluginInit listener effect must not depend on routeParams because replayed init updates routeParams and would re-register the listener'
)

assert(
  /setRouteParams\(\s*\(current\)\s*=>\s*mergeRouteParams\(current,\s*data\.params\)\s*\)/.test(source),
  'onPluginInit callback must merge params with functional setRouteParams so it can avoid a routeParams dependency'
)

