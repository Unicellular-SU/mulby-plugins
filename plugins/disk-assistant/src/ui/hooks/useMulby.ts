import { useMemo } from 'react'

export function useMulby(pluginId = 'disk-assistant') {
  return useMemo(() => ({
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') => window.mulby?.filesystem?.readFile(path, encoding),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
        window.mulby?.filesystem?.writeFile(path, data, encoding),
      exists: (path: string) => window.mulby?.filesystem?.exists(path),
      readdir: (path: string) => window.mulby?.filesystem?.readdir(path),
      mkdir: (path: string) => window.mulby?.filesystem?.mkdir(path),
      stat: (path: string) => window.mulby?.filesystem?.stat(path),
      copy: (src: string, dest: string) => window.mulby?.filesystem?.copy(src, dest),
      move: (src: string, dest: string) => window.mulby?.filesystem?.move(src, dest),
      unlink: (path: string) => window.mulby?.filesystem?.unlink(path),
    },

    dialog: {
      showOpenDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
      }) => window.mulby?.dialog?.showOpenDialog(options),
      showSaveDialog: (options?: {
        title?: string
        defaultPath?: string
        filters?: { name: string; extensions: string[] }[]
      }) => window.mulby?.dialog?.showSaveDialog(options),
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
      }) => window.mulby?.dialog?.showMessageBox(options),
    },

    shell: {
      openPath: (path: string) => window.mulby?.shell?.openPath(path),
      openExternal: (url: string) => window.mulby?.shell?.openExternal(url),
      showItemInFolder: (path: string) => window.mulby?.shell?.showItemInFolder(path),
      openFolder: (path: string) => window.mulby?.shell?.openFolder(path),
      trashItem: (path: string) => window.mulby?.shell?.trashItem(path),
    },

    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') =>
        window.mulby?.notification?.show(message, type),
    },

    window: {
      setSize: (width: number, height: number) => window.mulby?.window?.setSize(width, height),
      center: () => window.mulby?.window?.center?.(),
      hide: (isRestorePreWindow?: boolean) => window.mulby?.window?.hide?.(isRestorePreWindow),
      show: () => window.mulby?.window?.show(),
      close: () => window.mulby?.window?.close(),
      detach: () => window.mulby?.window?.detach?.(),
      getMode: () => window.mulby?.window?.getMode?.(),
      minimize: () => window.mulby?.window?.minimize?.(),
      maximize: () => window.mulby?.window?.maximize?.(),
      getState: () => window.mulby?.window?.getState?.(),
      reload: () => window.mulby?.window?.reload?.(),
    },

    host: {
      call: (method: string, ...args: unknown[]) =>
        window.mulby?.host?.call?.(pluginId, method, ...args),
    },

    system: {
      getSystemInfo: () => window.mulby?.system?.getSystemInfo(),
      getAppInfo: () => window.mulby?.system?.getAppInfo(),
      getPath: (name: string) => window.mulby?.system?.getPath(name as any),
      isWindows: () => window.mulby?.system?.isWindows?.(),
      isMacOS: () => window.mulby?.system?.isMacOS?.(),
      isLinux: () => window.mulby?.system?.isLinux?.(),
    },

    storage: {
      get: (key: string) => window.mulby?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.mulby?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.mulby?.storage?.remove(key, pluginId),
    },

    clipboard: {
      readText: () => window.mulby?.clipboard?.readText(),
      writeText: (text: string) => window.mulby?.clipboard?.writeText(text),
    },

    theme: {
      get: () => window.mulby?.theme?.get(),
      getActual: () => window.mulby?.theme?.getActual(),
    },
  }), [pluginId])
}
