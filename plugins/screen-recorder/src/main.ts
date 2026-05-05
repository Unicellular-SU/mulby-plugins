/// <reference path="./types/mulby.d.ts" />

declare const mulby: BackendPluginAPIDirect

const PLUGIN_TAG = '[screen-recorder]'

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

export async function run(context: BackendPluginContext) {
  console.log(`${PLUGIN_TAG} feature=${context.featureCode ?? 'record'}`)
}

export const rpc = {
  async getCapabilities() {
    return {
      screen: true,
      mediaRecorder: true,
      ffmpeg: true,
      inputMonitor: typeof (mulby as any).inputMonitor !== 'undefined'
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }

export default plugin
