/// <reference path="./types/mulby.d.ts" />
// PluginContext 类型由 src/types/mulby.d.ts 提供
type PluginContext = BackendPluginContext

export function onLoad() {
  console.log('[ai-translator] loaded')
}

export function onUnload() {
  console.log('[ai-translator] unloaded')
}

export function onEnable() {
  console.log('[ai-translator] enabled')
}

export function onDisable() {
  console.log('[ai-translator] disabled')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  if (context.featureCode === 'settings') {
    notification.show('已打开翻译设置')
    return
  }

  if (context.featureCode === 'compare') {
    notification.show('已打开同屏翻译')
    return
  }

  notification.show('AI 翻译已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
