/// <reference path="./types/mulby.d.ts" />
// 运行时由 Mulby 宿主注入全局 API 代理（无需从参数中获取）
declare const mulby: any

export function onLoad() {
  console.log('[screenshot-annotator] 插件已加载')
}

export function onUnload() {
  console.log('[screenshot-annotator] 插件已卸载')
}

export function onEnable() {
  console.log('[screenshot-annotator] 插件已启用')
}

export function onDisable() {
  console.log('[screenshot-annotator] 插件已禁用')
}

// run 是插件入口，context 由宿主注入（包含 featureCode / input / attachments / api）
export async function run(context: BackendPluginContext) {
  if (context.featureCode !== 'annotate') {
    return
  }

  await mulby.window.setAlwaysOnTop?.(true)
}

export const rpc = {}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
