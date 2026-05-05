/// <reference path="./types/mulby.d.ts" />

type PluginContext = BackendPluginContext

const TAG = '[desktop-pet]'

export function onLoad() {
  console.log(`${TAG} loaded`)
}

export function onUnload() {
  console.log(`${TAG} unloaded`)
}

export function onEnable() {
  console.log(`${TAG} enabled`)
}

export function onDisable() {
  console.log(`${TAG} disabled`)
}

export async function run(context: PluginContext) {
  console.log(`${TAG} feature=${context.featureCode ?? 'pet'}`)
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
