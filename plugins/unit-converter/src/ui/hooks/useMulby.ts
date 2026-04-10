import { useMemo } from 'react'

export function useMulby(pluginId: string) {
  return useMemo(
    () => ({
      clipboard: {
        readText: () => window.mulby?.clipboard?.readText(),
        writeText: (text: string) => window.mulby?.clipboard?.writeText(text)
      },
      notification: {
        show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') =>
          window.mulby?.notification?.show(message, type)
      },
      storage: {
        get: (key: string) => window.mulby?.storage?.get(key, pluginId),
        set: (key: string, value: unknown) => window.mulby?.storage?.set(key, value, pluginId),
        remove: (key: string) => window.mulby?.storage?.remove(key, pluginId)
      },
      http: {
        get: (url: string, headers?: Record<string, string>) => window.mulby?.http?.get(url, headers)
      },
      network: {
        isOnline: () => window.mulby?.network?.isOnline()
      }
    }),
    [pluginId]
  )
}
