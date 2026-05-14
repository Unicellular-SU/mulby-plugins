import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const parentModule = readFileSync(resolve(pluginRoot, 'src/ui/modules/WindowAPI/index.tsx'), 'utf8')
const childModule = readFileSync(resolve(pluginRoot, 'src/ui/modules/ChildWindow/index.tsx'), 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  /const fallbackWindowToken = useMemo\(\(\) => `child-\$\{Date\.now\(\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2\)\}`, \[\]\)/.test(childModule),
  'ChildWindowModule must create a stable close-notification token per child window instance'
)
assert(
  /instanceId: routeParams\.instanceId \|\| fallbackWindowToken/.test(childModule),
  'ChildWindowModule must include a stable instance id in close notifications'
)
assert(
  /win\.sendToParent\('child-window-closing'/.test(childModule),
  'ChildWindowModule must notify its parent before closing the current child window'
)
assert(
  /channel === 'child-window-closing'/.test(parentModule),
  'WindowAPI parent module must listen for child-window-closing messages'
)
assert(
  /removeClosedChild\(payload\)/.test(parentModule),
  'WindowAPI parent module must remove a child record when receiving a close notification'
)
assert(
  /const instanceId = createChildWindowInstanceId\(\)/.test(parentModule),
  'WindowAPI parent module must generate an instance id before creating child windows'
)
assert(
  /instanceId,/.test(parentModule),
  'WindowAPI parent module must pass the generated instance id when creating child windows'
)
assert(
  /instanceId: patch\?\.instanceId/.test(parentModule),
  'WindowAPI parent module must keep the generated instance id on the child record'
)
