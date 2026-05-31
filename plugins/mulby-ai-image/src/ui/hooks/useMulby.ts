import { useMemo } from 'react'

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

    const host = pluginId && mulby.host
      ? {
          ...mulby.host,
          invoke: (method: string, ...args: unknown[]) => mulby.host!.invoke(pluginId, method, ...args),
          call: (method: string, ...args: unknown[]) => mulby.host!.call(pluginId, method, ...args),
          status: () => mulby.host!.status(pluginId),
          restart: () => mulby.host!.restart(pluginId),
        }
      : mulby.host

    return {
      ...mulby,
      storage,
      host,
    }
  }, [pluginId])
}
