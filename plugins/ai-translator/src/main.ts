/// <reference path="./types/mulby.d.ts" />
// PluginContext 类型由 src/types/mulby.d.ts 提供
declare const mulby: any;

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
  if (context.featureCode === 'settings') {
    mulby.notification.show('已打开翻译设置')
    return
  }

  if (context.featureCode === 'compare') {
    mulby.notification.show('已打开同屏翻译')
    return
  }

  mulby.notification.show('AI 翻译已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
