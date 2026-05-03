/// <reference path="./types/mulby.d.ts" />
declare const mulby: any

export function onLoad() {
  console.log('[ctool] 插件已加载')
}

export function onUnload() {
  console.log('[ctool] 插件已卸载')
}

export function onEnable() {
  console.log('[ctool] 插件已启用')
}

export function onDisable() {
  console.log('[ctool] 插件已禁用')
}

export async function run(_context: BackendPluginContext) {
  mulby.notification.show('Ctool 已打开', 'info')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
