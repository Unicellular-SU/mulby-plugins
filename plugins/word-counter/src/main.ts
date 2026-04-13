/// <reference path="./types/mulby.d.ts" />

declare const mulby: any;

type PluginContext = BackendPluginContext

const PLUGIN_TAG = '[word-counter]'

function logLifecycle(event: string) {
  console.log(`${PLUGIN_TAG} ${event}`)
}

export function onLoad() {
  logLifecycle('插件已加载')
}

export function onUnload() {
  logLifecycle('插件已卸载')
}

export function onEnable() {
  logLifecycle('插件已启用')
}

export function onDisable() {
  logLifecycle('插件已禁用')
}

export async function run(context: PluginContext) {
  const featureCode = context.featureCode ?? 'open-counter'
  const input = context.input?.trim() ?? ''

  if (featureCode === 'count-selection' && input.length === 0) {
    mulby.notification.show('未检测到选中文本，请先选中内容后再试一次。', 'warning')
    return
  }

  console.log(`${PLUGIN_TAG} 触发功能: ${featureCode}, 输入长度: ${input.length}`)
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
