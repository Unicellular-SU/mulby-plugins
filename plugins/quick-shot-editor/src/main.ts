/// <reference path="./types/mulby.d.ts" />

declare const mulby: any;

type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[quick-shot-editor]'

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
  const featureCode = context.featureCode ?? 'open-studio'
  const attachmentCount = context.attachments?.length ?? 0
  const inputLength = context.input?.length ?? 0

  console.log(
    `${PLUGIN_TAG} feature=${featureCode} inputLength=${inputLength} attachments=${attachmentCount}`
  )
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
