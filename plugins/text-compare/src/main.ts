interface PluginContext {
  api: {
    notification: {
      show: (message: string, type?: string) => void
    }
  }
}

export function onLoad() {
  console.log('[text_compare] 插件已加载')
}

export function onUnload() {
  console.log('[text_compare] 插件已卸载')
}

export function onEnable() {
  console.log('[text_compare] 插件已启用')
}

export function onDisable() {
  console.log('[text_compare] 插件已禁用')
}

export async function run(context: PluginContext) {
  const { notification } = context.api
  notification.show('文本/代码对比已打开', 'info')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
