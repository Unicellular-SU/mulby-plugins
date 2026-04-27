import { useMemo } from 'react'

type NotifyType = 'info' | 'success' | 'warning' | 'error'

export function useMulby(pluginId: string) {
  return useMemo(
    () => ({
      screen: {
        colorPick: () => window.mulby?.screen?.colorPick?.()
      },
      clipboard: {
        writeText: (text: string) => window.mulby?.clipboard?.writeText(text)
      },
      storage: {
        get: (key: string) => window.mulby?.storage?.get(key, pluginId),
        set: (key: string, value: unknown) => window.mulby?.storage?.set(key, value, pluginId)
      },
      notification: {
        show: (message: string, type?: NotifyType) => window.mulby?.notification?.show(message, type)
      }
    }),
    [pluginId]
  )
}
