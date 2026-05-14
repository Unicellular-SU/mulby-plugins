import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = resolve(__dirname, '..')
const aiModulePath = resolve(pluginRoot, 'src/ui/modules/AI/index.tsx')

function read(relativePath) {
  return readFileSync(resolve(pluginRoot, relativePath), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(existsSync(aiModulePath), 'AI module file must exist')

const aiSource = readFileSync(aiModulePath, 'utf8')
const appSource = read('src/ui/App.tsx')
const sidebarSource = read('src/ui/components/Sidebar.tsx')
const indexSource = read('src/ui/modules/index.ts')
const manifestSource = read('manifest.json')
const mainSource = read('src/main.ts')

assert(
  aiSource.includes('ApiReferencePanel') && aiSource.includes('page-with-api-panel'),
  'AI module must use the shared right-side API panel layout'
)

assert(
  !aiSource.includes('CodeBlock'),
  'AI module must not keep API examples in main content'
)

for (const token of [
  'ai.call',
  'ai.abort',
  'ai.allModels',
  'ai.testConnection',
  'ai.testConnectionStream',
  'ai.models.fetch',
  'ai.tokens.estimate',
  'ai.attachments.upload',
  'ai.attachments.get',
  'ai.attachments.delete',
  'ai.images.generate',
  'ai.images.generateStream',
  'ai.images.edit',
  'ai.mcp.listServers',
  'ai.mcp.listTools',
  'ai.skills.listEnabled',
  'ai.skills.preview',
  'ai.tooling.webSearch.getSettings',
  'ai.tooling.pluginTools.getDisabled',
]) {
  assert(aiSource.includes(token), `AI module must demonstrate ${token}`)
}

for (const token of [
  '__requestId',
  'abortedRef',
  'requestIdRef',
]) {
  assert(aiSource.includes(token), `AI stream abort pattern must include ${token}`)
}

for (const token of [
  'formatTokenUsage',
  'callResult?.usage',
  'streamFinal?.usage',
  '实际 Token',
  '流式 Token',
  '估算 Token',
]) {
  assert(aiSource.includes(token), `AI conversation token panel must display real usage via ${token}`)
}

for (const token of [
  'getShowcaseTime',
  'getShowcaseEcho',
  'runAiToolDemo',
]) {
  assert(mainSource.includes(token), `Backend must expose AI helper ${token}`)
}

for (const forbidden of [
  'ai.settings',
  'mcpServer',
  'upsertServer',
  'removeServer',
  'activateServer',
  'deactivateServer',
  'restartServer',
  'skills.install',
  'skills.remove',
  'skills.enable',
  'skills.disable',
  'webSearch.update',
  'setActiveProvider',
  'pluginTools.setDisabled',
  'systemPage',
  'ai-settings',
]) {
  assert(!aiSource.includes(forbidden), `AI module must not demonstrate excluded API ${forbidden}`)
}

assert(appSource.includes('AIModule'), 'App must import and render AIModule')
assert(appSource.includes("ai: 'ai'"), 'App feature map must route ai to the AI module')
assert(sidebarSource.includes("label: 'AI'"), 'Sidebar must include AI module')
assert(indexSource.includes("from './AI'"), 'Module index must export AI module')
assert(manifestSource.includes('"code": "ai"'), 'Manifest must declare ai feature')
