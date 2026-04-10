/// <reference path="./types/mulby.d.ts" />

type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[screen-pin]'

function logLifecycle(event: string) {
  console.log(`${PLUGIN_TAG} ${event}`)
}

export function onLoad() {
  logLifecycle('plugin loaded')
}

export function onUnload() {
  logLifecycle('plugin unloaded')
}

export function onEnable() {
  logLifecycle('plugin enabled')
}

export function onDisable() {
  logLifecycle('plugin disabled')
}

export async function run(context: PluginContext) {
  const featureCode = context.featureCode ?? 'pin-screenshot'
  console.log(`${PLUGIN_TAG} feature=${featureCode}`)
  // 核心逻辑在 UI 侧完成：screenCapture → 创建 pin 子窗口
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
