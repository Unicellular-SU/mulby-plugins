declare const mulby: any

interface PluginContext {
  api?: {
    notification?: {
      show: (message: string, type?: string) => void
    }
  }
}

export function onLoad() {}

export function onUnload() {}

export function onEnable() {}

export function onDisable() {}

export async function run(_context: PluginContext) {
  mulby.notification.show('网页翻译已打开', 'info')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
