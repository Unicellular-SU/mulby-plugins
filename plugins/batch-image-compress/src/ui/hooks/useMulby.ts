import { useMemo } from 'react'

export function useMulby(pluginId?: string) {
  return useMemo(() => ({
    clipboard: {
      readText: () => window.mulby?.clipboard?.readText(),
      writeText: (text: string) => window.mulby?.clipboard?.writeText(text),
      readImage: () => window.mulby?.clipboard?.readImage(),
      writeImage: (image: string | ArrayBuffer) => window.mulby?.clipboard?.writeImage(image),
      readFiles: () => window.mulby?.clipboard?.readFiles(),
      writeFiles: (files: string | string[]) => window.mulby?.clipboard?.writeFiles(files),
      getFormat: () => window.mulby?.clipboard?.getFormat(),
    },
    storage: {
      get: (key: string) => window.mulby?.storage?.get(key, pluginId),
      set: (key: string, value: unknown) => window.mulby?.storage?.set(key, value, pluginId),
      remove: (key: string) => window.mulby?.storage?.remove(key, pluginId),
    },
    notification: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') =>
        window.mulby?.notification?.show(message, type),
    },
    window: {
      setSize: (width: number, height: number) => window.mulby?.window?.setSize(width, height),
      setExpendHeight: (height: number) => window.mulby?.window?.setExpendHeight?.(height),
      hide: (isRestorePreWindow?: boolean) => window.mulby?.window?.hide?.(isRestorePreWindow),
      show: () => window.mulby?.window?.show(),
      close: () => window.mulby?.window?.close(),
    },
    plugin: {
      getAll: () => window.mulby?.plugin?.getAll?.(),
      search: (query: string) => window.mulby?.plugin?.search?.(query),
      run: (name: string, featureCode: string, input?: string) =>
        window.mulby?.plugin?.run?.(name, featureCode, input),
      redirect: (label: string | [string, string], payload?: unknown) =>
        window.mulby?.plugin?.redirect?.(label, payload),
      outPlugin: (isKill?: boolean) => window.mulby?.plugin?.outPlugin?.(isKill),
    },
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') =>
        window.mulby?.filesystem?.readFile(path, encoding),
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
    screen: {
      getAllDisplays: () => window.mulby?.screen?.getAllDisplays(),
      getPrimaryDisplay: () => window.mulby?.screen?.getPrimaryDisplay(),
      getCursorScreenPoint: () => window.mulby?.screen?.getCursorScreenPoint(),
    },
    shell: {
      openPath: (path: string) => window.mulby?.shell?.openPath(path),
      openExternal: (url: string) => window.mulby?.shell?.openExternal(url),
      showItemInFolder: (path: string) => window.mulby?.shell?.showItemInFolder(path),
      openFolder: (path: string) => window.mulby?.shell?.openFolder(path),
      trashItem: (path: string) => window.mulby?.shell?.trashItem(path),
      beep: () => window.mulby?.shell?.beep(),
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
    system: {
      getSystemInfo: () => window.mulby?.system?.getSystemInfo(),
      getAppInfo: () => window.mulby?.system?.getAppInfo(),
      getPath: (name: string) => window.mulby?.system?.getPath(name as any),
      getEnv: (name: string) => window.mulby?.system?.getEnv(name),
      getFileIcon: (filePath: string) => window.mulby?.system?.getFileIcon?.(filePath),
      isDev: () => window.mulby?.system?.isDev?.(),
      isMacOS: () => window.mulby?.system?.isMacOS?.(),
      isWindows: () => window.mulby?.system?.isWindows?.(),
      isLinux: () => window.mulby?.system?.isLinux?.(),
    },
    theme: {
      get: () => window.mulby?.theme?.get(),
      set: (mode: 'light' | 'dark' | 'system') => window.mulby?.theme?.set(mode),
      getActual: () => window.mulby?.theme?.getActual(),
    },
    host: {
      invoke: (method: string, ...args: unknown[]) =>
        window.mulby?.host?.invoke(pluginId || '', method, ...args),
      call: (method: string, ...args: unknown[]) =>
        window.mulby?.host?.call?.(pluginId || '', method, ...args),
      status: () => window.mulby?.host?.status(pluginId || ''),
      restart: () => window.mulby?.host?.restart(pluginId || ''),
    },
    sharp: window.mulby?.sharp,
    menu: {
      showContextMenu: (items: any[]) =>
        window.mulby?.menu?.showContextMenu(items),
    },
  }), [pluginId])
}
