import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import SearchBar from './components/SearchBar'
import CategoryPanel from './components/CategoryPanel'
import FileList from './components/FileList'
import FilePreview from './components/FilePreview'
import { useMulby } from './hooks/useMulby'
import {
  FileItem,
  CategoryId,
  getExtension,
  filterByCategory,
  getCategoryCounts,
} from './utils'

export default function App() {
  const {
    mulby,
    searchFiles,
    getFileIcons,
    openFile,
    showInFolder,
    copyFiles,
    startDrag,
    showContextMenu,
  } = useMulby()

  const [query, setQuery] = useState('')
  const [allFiles, setAllFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(false)
  const [category, setCategory] = useState<CategoryId>('all')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [rightKeyCount, setRightKeyCount] = useState(0)
  const [isAttached, setIsAttached] = useState(false)
  const [previewEnabled, setPreviewEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('local-search:preview') !== 'off'
    } catch {
      return true
    }
  })
  const rightKeyTimer = useRef<ReturnType<typeof setTimeout>>()

  const filteredFiles = filterByCategory(allFiles, category)
  const categoryCounts = getCategoryCounts(allFiles)
  const focusedFile = filteredFiles[focusedIndex] ?? null

  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const lastQueryRef = useRef('')
  const subInputDispose = useRef<(() => void) | null>(null)
  const fileListContainerRef = useRef<HTMLDivElement>(null)
  const isAttachedRef = useRef(false)

  const subInputKeyDownDispose = useRef<(() => void) | null>(null)

  const focusFileList = useCallback(() => {
    if (isAttachedRef.current) return
    setTimeout(() => fileListContainerRef.current?.focus(), 50)
  }, [])

  useEffect(() => {
    if (!mulby) return

    const setupSubInput = async () => {
      try {
        const mode = await mulby.window.getMode()
        const attached = mode === 'attached'
        setIsAttached(attached)
        isAttachedRef.current = attached

        if (attached && mulby.subInput) {
          await mulby.subInput.set('输入关键词搜索文件…', true, { forwardKeys: ['ArrowRight'] })
          subInputDispose.current = mulby.subInput.onChange(({ text }: { text: string }) => {
            setQuery(text)
          })
        }
      } catch {
        setIsAttached(false)
        isAttachedRef.current = false
      }
    }

    if (mulby.onPluginInit) {
      mulby.onPluginInit(async (data: any) => {
        await setupSubInput()

        const initInput = data?.input || ''
        let pendingInput: string | null = null
        try {
          // getPendingInput 是后端自定义 rpc 方法，必须用 host.call；
          // host.invoke 仅用于 Mulby 内置 API 命名空间（如 clipboard.readText）。
          // host.call 返回 { success, data }，真正的返回值在 data 上。
          const res = await (mulby as any).host?.call?.('local-search', 'getPendingInput')
          pendingInput = (res?.data ?? null) as string | null
        } catch {}

        const keyword = pendingInput || initInput || ''
        if (keyword) {
          setQuery(keyword)
          if (isAttachedRef.current && mulby.subInput) {
            mulby.subInput.setValue(keyword)
          }
        }
      })
    }

    const detachDispose = mulby.onPluginDetached?.(() => {
      setIsAttached(false)
      isAttachedRef.current = false
      if (subInputDispose.current) {
        subInputDispose.current()
        subInputDispose.current = null
      }
    })

    return () => {
      if (subInputDispose.current) {
        subInputDispose.current()
        subInputDispose.current = null
      }
      if (subInputKeyDownDispose.current) {
        subInputKeyDownDispose.current()
        subInputKeyDownDispose.current = null
      }
      mulby.subInput?.remove?.()
      detachDispose?.()
    }
  }, [])

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setAllFiles([])
        setFocusedIndex(0)
        setSelectedIndices(new Set())
        return
      }
      lastQueryRef.current = q
      setLoading(true)
      try {
        const results = await searchFiles(q.trim(), 200)
        if (q !== lastQueryRef.current) return

        const items: FileItem[] = results.map((r: any) => ({
          name: r.name,
          path: r.path,
          isDirectory: r.isDirectory,
          size: r.size,
          ext: getExtension(r.name),
        }))

        setAllFiles(items)
        setFocusedIndex(0)
        setSelectedIndices(new Set([0]))

        if (!isAttachedRef.current) {
          focusFileList()
        }

        const iconRequests = items.slice(0, 100).map((f, i) => ({
          key: String(i),
          path: f.path,
          kind: 'file' as const,
          size: 32,
        }))
        if (iconRequests.length > 0) {
          const icons = await getFileIcons(iconRequests)
          if (q !== lastQueryRef.current) return
          setAllFiles((prev) => {
            const next = [...prev]
            for (const icon of icons) {
              const idx = Number(icon.key)
              if (next[idx]) next[idx] = { ...next[idx], icon: icon.icon }
            }
            return next
          })
        }
      } catch {
        if (q === lastQueryRef.current) setAllFiles([])
      } finally {
        if (q === lastQueryRef.current) setLoading(false)
      }
    },
    [searchFiles, getFileIcons, focusFileList]
  )

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setAllFiles([])
      return
    }
    debounceRef.current = setTimeout(() => doSearch(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, doSearch])

  useEffect(() => {
    setFocusedIndex(0)
    setSelectedIndices(new Set())
  }, [category])

  const handleSelect = useCallback(
    (idx: number, shift: boolean) => {
      if (shift && selectedIndices.size > 0) {
        const anchor = [...selectedIndices][0]
        const start = Math.min(anchor, idx)
        const end = Math.max(anchor, idx)
        const range = new Set<number>()
        for (let i = start; i <= end; i++) range.add(i)
        setSelectedIndices(range)
      } else {
        setSelectedIndices(new Set([idx]))
      }
    },
    [selectedIndices]
  )

  const handleOpen = useCallback(
    (file: FileItem) => {
      openFile(file.path)
    },
    [openFile]
  )

  const handleShowContextMenu = useCallback(
    async (_e: React.MouseEvent, file: FileItem, idx: number) => {
      _e.preventDefault()
      setFocusedIndex(idx)
      if (!selectedIndices.has(idx)) setSelectedIndices(new Set([idx]))

      const result = await showContextMenu([
        { label: '打开文件', id: 'open' },
        { label: '打开文件所在文件夹', id: 'folder' },
        { type: 'separator', label: '' },
        { label: '复制文件', id: 'copy' },
        { label: '复制文件路径', id: 'copy-path' },
      ])

      if (result === 'open') openFile(file.path)
      else if (result === 'folder') showInFolder(file.path)
      else if (result === 'copy') {
        const paths = [...selectedIndices].map((i) => filteredFiles[i]?.path).filter(Boolean)
        copyFiles(paths.length > 0 ? paths : [file.path])
      } else if (result === 'copy-path') {
        mulby?.clipboard?.writeText?.(file.path)
      }
    },
    [selectedIndices, filteredFiles, openFile, showInFolder, copyFiles, showContextMenu, mulby]
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent, file: FileItem) => {
      e.preventDefault()
      const paths = [...selectedIndices].map((i) => filteredFiles[i]?.path).filter(Boolean)
      startDrag(paths.length > 0 ? paths : file.path)
    },
    [selectedIndices, filteredFiles, startDrag]
  )

  const handleNavKey = useCallback(
    (key: string, modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => {
      if (key === 'ArrowDown') {
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 1, filteredFiles.length - 1)
          if (modifiers.shift) {
            setSelectedIndices((s) => new Set([...s, next]))
          } else {
            setSelectedIndices(new Set([next]))
          }
          return next
        })
      } else if (key === 'ArrowUp') {
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 1, 0)
          if (modifiers.shift) {
            setSelectedIndices((s) => new Set([...s, next]))
          } else {
            setSelectedIndices(new Set([next]))
          }
          return next
        })
      } else if (key === 'Enter') {
        if (focusedFile) openFile(focusedFile.path)
      } else if (key === 'ArrowRight') {
        clearTimeout(rightKeyTimer.current)
        const newCount = rightKeyCount + 1
        setRightKeyCount(newCount)

        if (newCount >= 2 && focusedFile) {
          showInFolder(focusedFile.path)
          setRightKeyCount(0)
        } else {
          if (focusedFile) {
            showContextMenu([
              { label: '打开文件', id: 'open' },
              { label: '打开文件所在文件夹', id: 'folder' },
              { type: 'separator', label: '' },
              { label: '复制文件', id: 'copy' },
              { label: '复制文件路径', id: 'copy-path' },
            ]).then((result) => {
              if (result === 'open') openFile(focusedFile.path)
              else if (result === 'folder') showInFolder(focusedFile.path)
              else if (result === 'copy') {
                const paths = [...selectedIndices].map((i) => filteredFiles[i]?.path).filter(Boolean)
                copyFiles(paths.length > 0 ? paths : [focusedFile.path])
              } else if (result === 'copy-path') {
                mulby?.clipboard?.writeText?.(focusedFile.path)
              }
            })
          }
          rightKeyTimer.current = setTimeout(() => setRightKeyCount(0), 500)
        }
      } else if (key === 'Tab') {
        const cats: CategoryId[] = ['all', 'image', 'spreadsheet', 'document', 'video-audio', 'archive', 'text', 'other']
        const idx = cats.indexOf(category)
        const next = modifiers.shift
          ? cats[(idx - 1 + cats.length) % cats.length]
          : cats[(idx + 1) % cats.length]
        setCategory(next)
      }
    },
    [filteredFiles, focusedFile, selectedIndices, category, rightKeyCount, openFile, showInFolder, copyFiles, showContextMenu, mulby]
  )

  // Attached mode: receive navigation keys forwarded from host subInput via IPC
  useEffect(() => {
    if (!isAttached || !mulby?.subInput?.onKeyDown) return
    subInputKeyDownDispose.current?.()
    subInputKeyDownDispose.current = mulby.subInput.onKeyDown((data: { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => {
      handleNavKey(data.key, data)
    })
    return () => {
      subInputKeyDownDispose.current?.()
      subInputKeyDownDispose.current = null
    }
  }, [isAttached, mulby, handleNavKey])

  // Detached mode: standard DOM keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' && e.key !== 'Tab' && e.key !== 'Escape') return

      const navKeys = ['ArrowDown', 'ArrowUp', 'Enter', 'ArrowRight', 'Tab']
      if (navKeys.includes(e.key)) {
        e.preventDefault()
        handleNavKey(e.key, { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey })
        return
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        const paths = [...selectedIndices].map((i) => filteredFiles[i]?.path).filter(Boolean)
        if (paths.length > 0) {
          copyFiles(paths)
          mulby?.notification?.show?.('已复制到剪贴板')
        }
      } else if (e.key === 'Escape') {
        ;(document.querySelector('.search-input') as HTMLInputElement)?.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [filteredFiles, selectedIndices, copyFiles, mulby, handleNavKey])

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text)
      if (isAttached && mulby?.subInput) {
        mulby.subInput.setValue(text)
      }
    },
    [isAttached, mulby]
  )

  const togglePreview = useCallback(() => {
    setPreviewEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem('local-search:preview', next ? 'on' : 'off')
      } catch {}
      return next
    })
  }, [])

  const previewToggle = (
    <button
      className={`preview-switch${previewEnabled ? ' on' : ''}`}
      onClick={togglePreview}
      title={previewEnabled ? '关闭文件预览' : '开启文件预览'}
    >
      {previewEnabled ? <Eye size={13} /> : <EyeOff size={13} />}
      预览
    </button>
  )

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)' }}>
      {!isAttached && (
        <div className="px-3 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <SearchBar
            value={query}
            onChange={handleQueryChange}
            loading={loading}
            resultCount={filteredFiles.length}
          />
          <div className="flex items-center gap-1 mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span className="shortcut-hint">Enter 打开</span>
            <span className="shortcut-hint">→ 菜单</span>
            <span className="shortcut-hint">→→ 打开文件夹</span>
            <span className="shortcut-hint">⌘C 复制</span>
            <span className="shortcut-hint">Tab 切换类型</span>
            <span className="shortcut-hint">Shift+↑↓ 多选</span>
            <span className="shortcut-hint">拖拽文件</span>
            <div className="ml-auto">{previewToggle}</div>
          </div>
        </div>
      )}

      {isAttached && (
        <div className="flex items-center gap-1 px-3 py-1.5 text-xs" style={{ color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
          <span className="shortcut-hint">Enter 打开</span>
          <span className="shortcut-hint">→ 菜单</span>
          <span className="shortcut-hint">→→ 打开文件夹</span>
          <span className="shortcut-hint">⌘C 复制</span>
          <span className="shortcut-hint">Tab 切换类型</span>
          <span className="shortcut-hint">Shift+↑↓ 多选</span>
          <div className="ml-auto flex items-center gap-2">
            {loading && <span style={{ color: 'var(--accent)' }}>搜索中…</span>}
            {!loading && query && <span>{filteredFiles.length} 个结果</span>}
            {previewToggle}
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <CategoryPanel active={category} counts={categoryCounts} onSelect={setCategory} />

        <div
          ref={fileListContainerRef}
          tabIndex={-1}
          className={`flex flex-col outline-none${previewEnabled ? '' : ' flex-1'}`}
          style={
            previewEnabled
              ? { width: 320, minWidth: 260, borderRight: '1px solid var(--border-color)' }
              : { minWidth: 260 }
          }
        >
          <FileList
            files={filteredFiles}
            focusedIndex={focusedIndex}
            selectedIndices={selectedIndices}
            onFocusIndex={setFocusedIndex}
            onSelect={handleSelect}
            onOpen={handleOpen}
            onContextMenu={handleShowContextMenu}
            onDragStart={handleDragStart}
          />
        </div>

        {previewEnabled && (
          <div className="flex-1 min-w-0 flex flex-col relative">
            <FilePreview file={focusedFile} />
          </div>
        )}
      </div>
    </div>
  )
}
