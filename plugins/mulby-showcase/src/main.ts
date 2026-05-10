/**
 * Mulby Showcase - Backend Entry
 * 
 * 这个文件展示了插件后端的生命周期钩子和基本结构。
 * 对于纯 UI 插件，后端主要用于初始化和资源管理。
 */

interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    clipboardHistory: ClipboardHistoryApi
    notification: {
      show: (message: string, type?: string) => void
    }
    storage: {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
    }
    features: {
      getFeatures: (codes?: string[]) => Array<{ code: string }>
      setFeature: (feature: {
        code: string
        explain?: string
        icon?: string
        platform?: string | string[]
        mode?: 'ui' | 'silent' | 'detached'
        route?: string
        mainHide?: boolean
        mainPush?: boolean
        cmds: Array<string | { type: 'keyword' | 'regex'; value?: string; match?: string; explain?: string }>
      }) => void
      removeFeature: (code: string) => boolean
      redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
      redirectAiModelsSetting: () => void
    }
  }
  input?: string
  featureCode?: string
}

type ClipboardHistoryType = 'text' | 'image' | 'files'

interface ClipboardHistoryQueryOptions {
  type?: ClipboardHistoryType
  search?: string
  favorite?: boolean
  limit?: number
  offset?: number
}

interface ClipboardHistoryItem {
  id: string
  type: ClipboardHistoryType
  content: string
  plainText?: string
  files?: string[]
  timestamp: number
  size: number
  favorite: boolean
  tags?: string[]
}

interface ClipboardHistoryStats {
  total: number
  text: number
  image: number
  files: number
  favorite: number
}

interface ClipboardHistoryApi {
  query: (options?: ClipboardHistoryQueryOptions) => Promise<ClipboardHistoryItem[]>
  get: (id: string) => Promise<ClipboardHistoryItem | null>
  copy: (id: string) => Promise<{ success: boolean; error?: string }>
  toggleFavorite: (id: string) => Promise<{ success: boolean }>
  delete: (id: string) => Promise<{ success: boolean }>
  clear: () => Promise<{ success: boolean }>
  stats: () => Promise<ClipboardHistoryStats>
}

declare const mulby: {
  clipboardHistory: ClipboardHistoryApi
}

/**
 * 插件加载时调用
 * 用于初始化资源、注册服务等
 */
export function onLoad(context?: PluginContext) {
  console.log('[Mulby Showcase] 插件已加载')

  const features = context?.api.features
  if (!features) return

  registerDynamicFeatures(features)
}

/**
 * 插件卸载时调用
 * 用于清理资源、保存状态等
 */
export function onUnload() {
  console.log('[Mulby Showcase] 插件即将卸载')
}

/**
 * 插件启用时调用
 * 用于恢复服务、重新注册等
 */
export function onEnable() {
  console.log('[Mulby Showcase] 插件已启用')
}

/**
 * 插件禁用时调用
 * 用于暂停服务、释放资源等
 */
export function onDisable() {
  console.log('[Mulby Showcase] 插件已禁用')
}

/**
 * 主执行函数
 * 当用户触发插件时调用
 * 
 * @param context - 执行上下文
 * @param context.api - Mulby API 接口
 * @param context.input - 用户输入
 * @param context.feature - 触发的功能代码
 */
export async function run(context: PluginContext) {
  const { notification, clipboard } = context.api

  // 记录功能触发
  console.log(`[Mulby Showcase] 功能触发: ${context.featureCode || 'main'}`)

  // 对于 UI 插件，主要逻辑在前端处理
  // 这里可以做一些后端初始化工作

  // 示例：根据不同功能显示不同通知
  switch (context.featureCode) {
    case 'showcase:today': {
      const today = new Date().toLocaleDateString()
      await clipboard.writeText(today)
      notification.show(`今日日期：${today}`)
      break
    }
    case 'showcase:reverse': {
      const raw = (context.input || '').trim()
      let text = raw
      if (raw.toLowerCase().startsWith('rev ')) {
        text = raw.slice(4)
      } else if (raw.toLowerCase().startsWith('reverse ')) {
        text = raw.slice(8)
      }
      if (!text) {
        notification.show('请输入要反转的文本')
        break
      }
      const reversed = text.split('').reverse().join('')
      await clipboard.writeText(reversed)
      notification.show(`已复制反转结果：${reversed}`)
      break
    }
    case 'showcase:mac-only':
      notification.show('macOS 专用动态指令已触发')
      break
    case 'showcase:refresh-features': {
      const features = context.api.features
      if (!features) {
        notification.show('动态指令 API 不可用')
        break
      }
      for (const code of getDynamicFeatureCodes()) {
        features.removeFeature(code)
      }
      registerDynamicFeatures(features)
      notification.show('动态指令已清理并重新注册')
      break
    }
    case 'sysinfo':
      notification.show('正在加载系统信息...')
      break
    case 'clipboard':
      notification.show('剪贴板管理器已就绪')
      break
    case 'input':
      notification.show('输入控制已就绪')
      break
    case 'screenshot':
      notification.show('截图功能已就绪')
      break
    default:
      // 不显示通知，让 UI 自己处理
      break
  }
}

export const rpc = {
  queryClipboardHistory(options?: ClipboardHistoryQueryOptions) {
    return mulby.clipboardHistory.query(options)
  },

  getClipboardHistoryItem(id: string) {
    return mulby.clipboardHistory.get(id)
  },

  copyClipboardHistoryItem(id: string) {
    return mulby.clipboardHistory.copy(id)
  },

  toggleClipboardHistoryFavorite(id: string) {
    return mulby.clipboardHistory.toggleFavorite(id)
  },

  deleteClipboardHistoryItem(id: string) {
    return mulby.clipboardHistory.delete(id)
  },

  clearClipboardHistory() {
    return mulby.clipboardHistory.clear()
  },

  getClipboardHistoryStats() {
    return mulby.clipboardHistory.stats()
  }
}

// 同时导出为 module.exports 以保持兼容性
const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin

function getDynamicFeatureCodes(): string[] {
  return [
    'showcase:today',
    'showcase:reverse',
    'showcase:mac-only',
    'showcase:refresh-features',
    'showcase:ui-settings',
    'showcase:ui-detached'
  ]
}

function registerDynamicFeatures(features: NonNullable<PluginContext['api']['features']>) {
  features.setFeature({
    code: 'showcase:today',
    explain: '动态指令：显示今日日期',
    mode: 'silent',
    cmds: ['today', '日期']
  })

  features.setFeature({
    code: 'showcase:reverse',
    explain: '动态指令：反转输入文本',
    mode: 'silent',
    cmds: [
      { type: 'keyword', value: 'reverse' },
      { type: 'regex', match: '^rev\\s+.+', explain: 'rev 开头文本' }
    ]
  })

  features.setFeature({
    code: 'showcase:mac-only',
    explain: '动态指令：仅 macOS 可见',
    mode: 'silent',
    platform: 'darwin',
    cmds: ['mac only', 'macos']
  })

  features.setFeature({
    code: 'showcase:refresh-features',
    explain: '动态指令：清理并刷新指令',
    mode: 'silent',
    cmds: ['清理动态指令', '刷新动态指令', 'refresh features']
  })

  features.setFeature({
    code: 'showcase:ui-settings',
    explain: '动态指令：打开设置面板',
    mode: 'ui',
    route: 'settings',
    cmds: ['showcase settings', 'showcase ui']
  })

  features.setFeature({
    code: 'showcase:ui-detached',
    explain: '动态指令：以独立窗口打开',
    mode: 'detached',
    route: 'settings',
    cmds: ['showcase detached', 'showcase window']
  })
}
