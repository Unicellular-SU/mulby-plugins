/**
 * 正则表达式编辑器 - 后端入口
 * 仅负责生命周期和初始化数据传递，核心逻辑在 UI 端完成。
 */

export function onLoad() {
  console.log('[reg_helper] 正则表达式编辑器插件已加载')
}

export function onUnload() {
  console.log('[reg_helper] 正则表达式编辑器插件已卸载')
}

export function onEnable() {
  console.log('[reg_helper] 正则表达式编辑器插件已启用')
}

export function onDisable() {
  console.log('[reg_helper] 正则表达式编辑器插件已禁用')
}

export async function run(context: {
  api: {
    notification: { show: (message: string, type?: string) => void }
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
    }
  }
  input?: string
  featureCode?: string
}) {
  const { notification } = context.api
  const input = context.input || ''

  console.log('[reg_helper] 插件运行，输入:', input)
  notification.show('正则表达式编辑器已启动')
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin