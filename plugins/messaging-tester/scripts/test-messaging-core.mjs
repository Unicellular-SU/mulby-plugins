import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const outDir = resolve(pluginRoot, '.test-build')
const outFile = resolve(outDir, 'messaging-core.mjs')

rmSync(outDir, { recursive: true, force: true })

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}
mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [resolve(pluginRoot, 'src/messagingCore.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
})

const {
  createMessageLog,
  getReplyForMessage,
  MESSAGING_TESTER_PLUGIN_ID,
  SHOWCASE_PLUGIN_ID,
} = await import(pathToFileURL(outFile))

const log = createMessageLog({ limit: 3, pluginId: MESSAGING_TESTER_PLUGIN_ID })

log.record({
  id: 'msg-1',
  from: SHOWCASE_PLUGIN_ID,
  to: MESSAGING_TESTER_PLUGIN_ID,
  type: 'tester-ping',
  payload: { text: 'from showcase' },
  timestamp: 1,
}, 'received')

log.record({
  id: 'msg-2',
  from: MESSAGING_TESTER_PLUGIN_ID,
  to: SHOWCASE_PLUGIN_ID,
  type: 'showcase-ping',
  payload: { text: 'to showcase' },
  timestamp: 2,
}, 'sent')

assert.equal(log.getRecent().length, 2)
assert.equal(log.getRecent()[0].id, 'msg-2')
assert.equal(log.getRecent({ direction: 'received' }).length, 1)
assert.equal(log.getRecent({ type: 'showcase' }).length, 1)

log.record({
  id: 'msg-3',
  from: 'other-plugin',
  type: 'tester-broadcast',
  payload: {},
  timestamp: 3,
}, 'received')

log.record({
  id: 'msg-4',
  from: 'other-plugin',
  type: 'tester-broadcast',
  payload: {},
  timestamp: 4,
}, 'received')

assert.deepEqual(log.getRecent().map((message) => message.id), ['msg-4', 'msg-3', 'msg-2'])

const testerReply = getReplyForMessage({
  id: 'ping-1',
  from: SHOWCASE_PLUGIN_ID,
  to: MESSAGING_TESTER_PLUGIN_ID,
  type: 'tester-ping',
  payload: { text: 'ping' },
  timestamp: 5,
})

assert.equal(testerReply?.targetPluginId, SHOWCASE_PLUGIN_ID)
assert.equal(testerReply?.type, 'tester-pong')
assert.equal(testerReply?.payload.requestId, 'ping-1')
assert.equal(testerReply?.payload.pluginId, MESSAGING_TESTER_PLUGIN_ID)

const showcaseReply = getReplyForMessage({
  id: 'ping-2',
  from: SHOWCASE_PLUGIN_ID,
  to: MESSAGING_TESTER_PLUGIN_ID,
  type: 'showcase-pong',
  payload: {},
  timestamp: 6,
})

assert.equal(showcaseReply, null)

const manifest = JSON.parse(read('manifest.json'))
assert.equal(manifest.id, MESSAGING_TESTER_PLUGIN_ID)
assert.equal(manifest.main, 'dist/main.js')
assert.equal(manifest.ui, 'ui/index.html')
assert.equal(manifest.pluginSetting?.background, true, 'manifest must keep the messaging subscriber running in background')
assert.equal(manifest.pluginSetting?.idleTimeoutMs, 'never', 'manifest must prevent idle cleanup while testing message subscriptions')
assert(manifest.features.some((feature) => feature.code === 'main'), 'manifest must declare a main feature')

const mainSource = read('src/main.ts')
for (const token of [
  'context.api.messaging.on',
  'context.api.messaging.off',
  'registerMessaging(context)',
  'onBackground(context?: PluginContext)',
  'sendToShowcase',
  'broadcastTesterMessage',
  'getRecentMessages',
  'clearMessages',
  'tester-ping',
]) {
  assert(mainSource.includes(token), `main.ts must include ${token}`)
}

const appSource = read('src/ui/App.tsx')
for (const token of [
  'Messaging Tester',
  '@mulby/showcase',
  'sendToShowcase',
  "sendToShowcase('showcase-ping')",
  'Mulby host.call API 不可用',
  'broadcastTesterMessage',
  'getRecentMessages',
]) {
  assert(appSource.includes(token), `App.tsx must include ${token}`)
}

const readmeSource = read('README.md')
for (const token of [
  '@mulby/messaging-tester',
  'showcase-ping',
  'tester-ping',
  '广播',
]) {
  assert(readmeSource.includes(token), `README must document ${token}`)
}

rmSync(outDir, { recursive: true, force: true })
