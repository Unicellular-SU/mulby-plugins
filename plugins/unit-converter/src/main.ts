/// <reference path="./types/mulby.d.ts" />

declare const mulby: any;

type PluginContext = BackendPluginContext

const TAG = '[unit-converter]'

function log(message: string) {
  console.log(`${TAG} ${message}`)
}

export function onLoad() {
  log('插件已加载')
}

export function onUnload() {
  log('插件已卸载')
}

export function onEnable() {
  log('插件已启用')
}

export function onDisable() {
  log('插件已禁用')
}

export async function run(context: PluginContext) {
  const featureCode = context.featureCode ?? 'open-converter'
  const input = context.input?.trim() ?? ''

  if (featureCode === 'convert-selection' && !input) {
    mulby.notification.show('未检测到可转换内容，请先选中带单位的数值。', 'warning')
    return
  }

  log(`触发功能: ${featureCode}, 输入长度: ${input.length}`)
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
