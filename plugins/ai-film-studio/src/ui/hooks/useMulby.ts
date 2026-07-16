import { useMemo } from 'react'

/**
 * 访问 Mulby API。传入 pluginId 时，storage 自动注入插件命名空间。
 * 后续里程碑（AI 文本/图像调用）会通过它访问 window.mulby.ai。
 */
export function useMulby(pluginId?: string) {
  return useMemo(() => {
    const mulby = window.mulby

    const storage = pluginId
      ? {
          ...mulby.storage,
          get: (key: string) => mulby.storage.get(key, pluginId),
          set: (key: string, value: unknown) => mulby.storage.set(key, value, pluginId),
          remove: (key: string) => mulby.storage.remove(key, pluginId),
        }
      : mulby.storage

    return { ...mulby, storage }
  }, [pluginId])
}
