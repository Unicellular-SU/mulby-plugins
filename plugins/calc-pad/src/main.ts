/// <reference path="./types/mulby.d.ts" />

type PluginContext = BackendPluginContext

export function onLoad() {
  console.log('[calc-pad] loaded')
}

export function onUnload() {
  console.log('[calc-pad] unloaded')
}

export function onEnable() {
  console.log('[calc-pad] enabled')
}

export function onDisable() {
  console.log('[calc-pad] disabled')
}

export async function run(context: PluginContext) {
  // All logic handled in UI renderer
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
