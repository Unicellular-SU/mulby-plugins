import { useEffect, useState, useCallback } from 'react'

type ThemeActual = 'light' | 'dark'

export function useMulby() {
  const mulby = (window as any).mulby as MulbyAPI | undefined

  const [theme, setTheme] = useState<ThemeActual>('light')

  useEffect(() => {
    if (!mulby) return
    mulby.theme?.getActual?.().then((t: ThemeActual) => {
      setTheme(t)
      document.documentElement.classList.toggle('dark', t === 'dark')
    })
    const dispose = mulby.onThemeChange?.((t: ThemeActual) => {
      setTheme(t)
      document.documentElement.classList.toggle('dark', t === 'dark')
    })
    return () => dispose?.()
  }, [])

  const searchFiles = useCallback(async (query: string, limit = 100) => {
    if (!mulby?.desktop?.searchFiles) return []
    return mulby.desktop.searchFiles(query, limit)
  }, [])

  const getFileIcon = useCallback(async (path: string) => {
    if (!mulby?.system?.getFileIcon) return ''
    return mulby.system.getFileIcon(path)
  }, [])

  const getFileIcons = useCallback(async (
    requests: Array<{ key: string; path: string; kind?: 'app' | 'file'; size?: number }>
  ) => {
    if (!mulby?.system?.getFileIcons) return []
    return mulby.system.getFileIcons(requests, { size: 32, concurrency: 10 })
  }, [])

  const openFile = useCallback(async (path: string) => {
    if (!mulby?.shell?.openPath) return
    return mulby.shell.openPath(path)
  }, [])

  const showInFolder = useCallback(async (path: string) => {
    if (!mulby?.shell?.showItemInFolder) return
    return mulby.shell.showItemInFolder(path)
  }, [])

  const copyFiles = useCallback(async (paths: string[]) => {
    if (!mulby?.clipboard?.writeFiles) return false
    return mulby.clipboard.writeFiles(paths)
  }, [])

  const readFileAsText = useCallback(async (path: string) => {
    if (!mulby?.filesystem?.readFile) return ''
    return mulby.filesystem.readFile(path, 'utf-8') as Promise<string>
  }, [])

  const readFileAsBase64 = useCallback(async (path: string) => {
    if (!mulby?.filesystem?.readFile) return ''
    return mulby.filesystem.readFile(path, 'base64') as Promise<string>
  }, [])

  const getFileStat = useCallback(async (path: string) => {
    if (!mulby?.filesystem?.stat) return null
    return mulby.filesystem.stat(path)
  }, [])

  // 调用后端自定义 rpc：用 sharp 把 tiff/psd/heic 等解码为 PNG。
  // host.call 返回 { success, data }，真正的返回值在 data 上。
  const previewImageAsPng = useCallback(
    async (
      path: string
    ): Promise<{ base64: string; meta?: { width?: number; height?: number; format?: string } } | null> => {
      const host = (mulby as any)?.host
      if (!host?.call) return null
      const res = await host.call('local-search', 'previewImageAsPng', path)
      return (res?.data ?? null) as { base64: string; meta?: { width?: number; height?: number; format?: string } } | null
    },
    []
  )

  const startDrag = useCallback((paths: string | string[]) => {
    if (!mulby?.window?.startDrag) return
    mulby.window.startDrag(paths)
  }, [])

  const showContextMenu = useCallback(async (items: ContextMenuItem[]) => {
    if (!mulby?.menu?.showContextMenu) return null
    return mulby.menu.showContextMenu(items)
  }, [])

  return {
    mulby,
    theme,
    searchFiles,
    getFileIcon,
    getFileIcons,
    openFile,
    showInFolder,
    copyFiles,
    readFileAsText,
    readFileAsBase64,
    getFileStat,
    previewImageAsPng,
    startDrag,
    showContextMenu,
  }
}
