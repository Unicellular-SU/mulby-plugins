interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    clipboardHistory: {
      query: (options?: {
        type?: 'text' | 'image' | 'files'
        search?: string
        favorite?: boolean
        limit?: number
        offset?: number
      }) => Promise<any[]>
      get: (id: string) => Promise<any>
      copy: (id: string) => Promise<{ success: boolean; error?: string }>
      toggleFavorite: (id: string) => Promise<{ success: boolean }>
      delete: (id: string) => Promise<{ success: boolean }>
      clear: () => Promise<{ success: boolean }>
      stats: () => Promise<{ total: number; text: number; image: number; files: number; favorite: number }>
    }
    notification: {
      show: (message: string, type?: string) => void
    }
  }
  input?: string
  featureCode?: string
}

export function onLoad() {
  console.log('[剪贴板历史] 插件已加载')
}

export function onUnload() {
  console.log('[剪贴板历史] 插件已卸载')
}

export function onEnable() {
  console.log('[剪贴板历史] 插件已启用')
}

export function onDisable() {
  console.log('[剪贴板历史] 插件已禁用')
}

export async function run(context: PluginContext) {
  // 插件启动时不做任何操作，所有逻辑在 UI 中处理
}

// 导出 host 方法供 UI 调用
export const host = {
  // 查询历史记录
  async queryHistory(context: PluginContext, options?: {
    type?: 'text' | 'image' | 'files'
    search?: string
    favorite?: boolean
    limit?: number
    offset?: number
  }) {
    const { clipboardHistory } = context.api
    return await clipboardHistory.query(options)
  },

  // 复制历史记录到剪贴板
  async copyToClipboard(context: PluginContext, id: string) {
    const { clipboardHistory, notification } = context.api
    const result = await clipboardHistory.copy(id)

    if (result.success) {
      notification.show('已复制到剪贴板')
      return { success: true }
    } else {
      notification.show(result.error || '复制失败', 'error')
      return { success: false, error: result.error }
    }
  },

  // 切换收藏状态
  async toggleFavorite(context: PluginContext, id: string) {
    const { clipboardHistory } = context.api
    return await clipboardHistory.toggleFavorite(id)
  },

  // 删除记录
  async deleteItem(context: PluginContext, id: string) {
    const { clipboardHistory, notification } = context.api
    const result = await clipboardHistory.delete(id)

    if (result.success) {
      notification.show('已删除')
      return { success: true }
    } else {
      notification.show('删除失败', 'error')
      return { success: false }
    }
  },

  // 清空历史（保留收藏）
  async clearHistory(context: PluginContext) {
    const { clipboardHistory, notification } = context.api
    const result = await clipboardHistory.clear()

    if (result.success) {
      notification.show('已清空历史记录（收藏已保留）')
      return { success: true }
    } else {
      notification.show('清空失败', 'error')
      return { success: false }
    }
  },

  // 获取统计信息
  async getStats(context: PluginContext) {
    const { clipboardHistory } = context.api
    return await clipboardHistory.stats()
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, host }
export default plugin
