import { useEffect, useRef, useState } from 'react'

function parseDroppedPathText(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      if (line.startsWith('file://')) {
        try {
          let p = decodeURIComponent(line.replace(/^file:\/\//, ''))
          // 修复 Windows 盘符 /D:/...
          if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1)
          return p
        } catch {
          return line.replace(/^file:\/\//, '')
        }
      }
      return line
    })
}

/** 同步收集拖放事件中的所有候选路径（必须在任何 await 之前完成）。 */
function collectFilePaths(event: DragEvent): string[] {
  const dt = event.dataTransfer
  if (!dt) return []
  const candidates = new Set<string>()
  for (let i = 0; i < (dt.files?.length || 0); i++) {
    const file = dt.files[i] as File & { path?: string }
    if (typeof file.path === 'string' && file.path) candidates.add(file.path)
  }
  parseDroppedPathText(dt.getData('text/uri-list')).forEach((p) => candidates.add(p))
  parseDroppedPathText(dt.getData('text/plain')).forEach((p) => candidates.add(p))
  return [...candidates].filter(Boolean)
}

/**
 * 全局注册拖拽监听，向回调返回解析出的本地文件路径。
 * 处理了「内部子节点打断事件流」和「await 清空 dataTransfer」两个经典深坑。
 */
export function useFileDrop(onPaths: (paths: string[]) => void) {
  const [isDragging, setIsDragging] = useState(false)
  const cbRef = useRef(onPaths)
  cbRef.current = onPaths

  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
    }
    const onOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
        setIsDragging(false)
      }
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      // 1) 同步收集（不能有 await）
      let paths = collectFilePaths(e)
      // 2) 静态快照拷贝 FileList，避免被清空
      const staticFiles = Array.from(e.dataTransfer?.files || []) as File[]
      // 3) 官方宿主解析补充真实路径
      const pluginApi = window.mulby?.plugin
      if (pluginApi && staticFiles.length > 0) {
        try {
          const resolved = pluginApi.resolveDroppedFilePaths(staticFiles)
          if (resolved && resolved.length > 0) paths = [...paths, ...resolved]
        } catch {
          /* ignore */
        }
      }
      paths = [...new Set(paths)].filter(Boolean)
      if (paths.length > 0) cbRef.current(paths)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return { isDragging }
}
