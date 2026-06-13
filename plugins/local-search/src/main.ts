import { previewImageAsPng as decodeImageToPng } from './sharpPreview'

declare const mulby: any

interface PluginContext {
  input?: unknown
  featureCode?: string
  attachments?: Array<{ path?: string; name?: string }>
}

let pendingInput: string | null = null

export function onLoad() {
  console.log('[local-search] 插件已加载')
}

export function onUnload() {
  console.log('[local-search] 插件已卸载')
}

export function onEnable() {
  console.log('[local-search] 插件已启用')
}

export function onDisable() {
  console.log('[local-search] 插件已禁用')
}

export async function run(context: PluginContext) {
  if (typeof context.input === 'string' && context.input.trim()) {
    pendingInput = context.input.trim()
  } else {
    pendingInput = null
  }
}

export const rpc = {
  async getPendingInput() {
    const input = pendingInput
    pendingInput = null
    return input
  },
  // 用宿主 sharp 把 tiff/psd/heic 等浏览器无法解码的图片转成 PNG 供 UI 预览
  async previewImageAsPng(path: string) {
    return decodeImageToPng(path)
  },
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
