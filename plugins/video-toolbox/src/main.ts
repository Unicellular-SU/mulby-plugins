/// <reference path="./types/mulby.d.ts" />

declare const mulby: any

const PLUGIN_TAG = '[video-toolbox]'

let pendingVideoPaths: string[] = []

function log(message: string) {
  console.log(`${PLUGIN_TAG} ${message}`)
}

export function onLoad() {
  log('loaded')
}

export function onUnload() {
  log('unloaded')
}

export function onEnable() {
  log('enabled')
}

export function onDisable() {
  log('disabled')
}

export async function run(context: BackendPluginContext) {
  pendingVideoPaths = (context.attachments ?? [])
    .map((attachment) => attachment.path)
    .filter((path): path is string => typeof path === 'string' && path.length > 0)

  log(`run with ${pendingVideoPaths.length} attachment(s)`)
}

export const rpc = {
  async getPendingInit(): Promise<{ paths: string[] }> {
    const paths = [...pendingVideoPaths]
    pendingVideoPaths = []
    return { paths }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
