/// <reference path="./types/mulby.d.ts" />

type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[screen-color-picker]'

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
  console.log(`${PLUGIN_TAG} feature=${context.featureCode ?? 'open_color_picker'}`)
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
