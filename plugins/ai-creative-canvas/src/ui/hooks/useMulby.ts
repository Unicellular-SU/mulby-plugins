import { useMemo } from 'react'
import { PLUGIN_ID } from '../services/persistence'

/**
 * 访问 Mulby API。storage 自动注入本插件命名空间。
 * 其余能力（ai / ffmpeg / sharp / http / filesystem / host ...）直接透传 window.mulby。
 */
export function useMulby() {
  return useMemo(() => {
    const mulby = (window as any).mulby
    if (!mulby) return null
    const storage = {
      ...mulby.storage,
      get: (key: string) => mulby.storage.get(key, PLUGIN_ID),
      set: (key: string, value: unknown) => mulby.storage.set(key, value, PLUGIN_ID),
      remove: (key: string) => mulby.storage.remove(key, PLUGIN_ID)
    }
    return { ...mulby, storage }
  }, [])
}
