import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  FolderOpen, RefreshCw, X, Search, ArrowUpDown,
  ArrowUp, ArrowDown, HardDrive, Folder, File,
  ChevronRight, ChevronDown, Loader2, LayoutGrid, List, ExternalLink,
  Download, Copy, Filter
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScanTree {
  name: string
  path: string
  size: number
  isDirectory: boolean
  extension: string
  modifiedAt: number
  children?: ScanTree[]
}

interface ScanResult {
  tree: ScanTree
  totalSize: number
  totalFiles: number
  totalDirs: number
  scanTimeMs: number
  truncated: boolean
  cachedAt?: number
  isFromCache?: boolean
}

interface DiskInfo {
  name: string
  path: string
  total: number
  free: number
  used: number
  usedPercent: number
}

// ─── Treemap Algorithm (Squarified) ──────────────────────────────────────────

interface TreemapRect {
  x: number
  y: number
  w: number
  h: number
  item: ScanTree
}

function squarifiedTreemap(items: ScanTree[], x: number, y: number, w: number, h: number): TreemapRect[] {
  const totalSize = items.reduce((s, i) => s + Math.max(i.size, 0), 0)
  if (totalSize <= 0 || items.length === 0 || w <= 0 || h <= 0) return []
  if (items.length === 1) {
    return [{ x, y, w, h, item: items[0] }]
  }

  const area = w * h
  const sorted = [...items]
    .filter(i => i.size > 0)
    .sort((a, b) => b.size - a.size)
    .map(i => ({ item: i, area: (i.size / totalSize) * area }))

  if (sorted.length === 0) return []

  const rects: TreemapRect[] = []
  let cx = x, cy = y, cw = w, ch = h

  function layoutRow(row: { item: ScanTree; area: number }[], horizontal: boolean) {
    const rowArea = row.reduce((s, r) => s + r.area, 0)
    if (horizontal) {
      const rowH = cw > 0 ? rowArea / cw : 0
      let rx = cx
      for (const r of row) {
        const rw = rowH > 0 ? r.area / rowH : 0
        rects.push({ x: rx, y: cy, w: rw, h: rowH, item: r.item })
        rx += rw
      }
      cy += rowH
      ch -= rowH
    } else {
      const rowW = ch > 0 ? rowArea / ch : 0
      let ry = cy
      for (const r of row) {
        const rh = rowW > 0 ? r.area / rowW : 0
        rects.push({ x: cx, y: ry, w: rowW, h: rh, item: r.item })
        ry += rh
      }
      cx += rowW
      cw -= rowW
    }
  }

  function worst(row: { area: number }[], side: number): number {
    if (row.length === 0 || side <= 0) return Infinity
    const s = row.reduce((sum, r) => sum + r.area, 0)
    const maxA = Math.max(...row.map(r => r.area))
    const minA = Math.min(...row.map(r => r.area))
    const sideSq = side * side
    return Math.max((sideSq * maxA) / (s * s), (s * s) / (sideSq * minA))
  }

  let remaining = [...sorted]
  while (remaining.length > 0) {
    const horizontal = cw >= ch
    const side = horizontal ? cw : ch
    if (side <= 0) break

    const row: { item: ScanTree; area: number }[] = [remaining[0]]
    let currentWorst = worst(row, side)
    remaining = remaining.slice(1)

    while (remaining.length > 0) {
      const testRow = [...row, remaining[0]]
      const testWorst = worst(testRow, side)
      if (testWorst <= currentWorst) {
        row.push(remaining[0])
        currentWorst = testWorst
        remaining = remaining.slice(1)
      } else {
        break
      }
    }

    layoutRow(row, horizontal)
  }

  return rects
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatDate(ts: number): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return `${Math.floor(diff / 86400)} 天前`
}

function getExtLabel(ext: string): string {
  if (!ext) return '文件夹'
  return ext.toUpperCase().slice(1) || '文件'
}

const COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
  '#ec4899', '#f43f5e', '#ef4444', '#f97316',
  '#eab308', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#7c3aed', '#db2777'
]

function getColor(index: number): string {
  return COLORS[index % COLORS.length]
}

function flattenTree(
  tree: ScanTree,
  expandedPaths: Set<string>,
  startDepth = 0
): { item: ScanTree; depth: number }[] {
  const result: { item: ScanTree; depth: number }[] = []
  const stack: { node: ScanTree; depth: number }[] = []
  if (tree.children) {
    for (let i = tree.children.length - 1; i >= 0; i--) {
      stack.push({ node: tree.children[i], depth: startDepth })
    }
  }
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!
    result.push({ item: node, depth })
    if (node.isDirectory && node.children && expandedPaths.has(node.path)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push({ node: node.children[i], depth: depth + 1 })
      }
    }
  }
  return result
}

// ─── Components ───────────────────────────────────────────────────────────────

function TreemapView({
  items,
  onNavigate,
  totalSize,
  containerRef
}: {
  items: ScanTree[]
  onNavigate: (item: ScanTree) => void
  totalSize: number
  containerRef: React.RefObject<HTMLDivElement>
}) {
  const [dims, setDims] = useState({ w: 800, h: 350 })
  const localRef = useRef<HTMLDivElement>(null)
  const ref = containerRef || localRef

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: width, h: height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref])

  const rects = useMemo(
    () => squarifiedTreemap(items, 0, 0, dims.w, dims.h),
    [items, dims.w, dims.h]
  )

  return (
    <div ref={ref} className="w-full h-full relative rounded-lg overflow-hidden bg-slate-800/50">
      {rects.map((rect, i) => {
        const showLabel = rect.w > 60 && rect.h > 30
        const showSize = rect.w > 80 && rect.h > 50
        const percent = totalSize > 0 ? (rect.item.size / totalSize) * 100 : 0

        return (
          <div
            key={rect.item.path + i}
            className="treemap-cell absolute flex flex-col justify-center items-center text-white"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.w,
              height: rect.h,
              backgroundColor: getColor(i),
              border: '1px solid rgba(15, 23, 42, 0.3)',
              padding: 4
            }}
            onClick={() => onNavigate(rect.item)}
            title={`${rect.item.name}\n${formatSize(rect.item.size)} (${percent.toFixed(1)}%)\n${rect.item.isDirectory ? '文件夹' : '文件'}`}
          >
            {showLabel && (
              <span className="text-xs font-medium truncate max-w-full px-1 text-center leading-tight">
                {rect.item.name}
              </span>
            )}
            {showSize && (
              <span className="text-[10px] opacity-70 mt-0.5">
                {formatSize(rect.item.size)}
              </span>
            )}
            {showSize && percent > 1 && (
              <span className="text-[10px] opacity-50">
                {percent.toFixed(1)}%
              </span>
            )}
          </div>
        )
      })}
      {items.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-400">
          无可显示的项目
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const mulby = useMulby()

  // State
  const [isScanning, setIsScanning] = useState(false)
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)
  const [currentPath, setCurrentPath] = useState('')
  const [breadcrumbs, setBreadcrumbs] = useState<{ name: string; path: string }[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'size' | 'name' | 'type' | 'date'>('size')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [viewMode, setViewMode] = useState<'treemap' | 'list'>('treemap')
  const [selectedItem, setSelectedItem] = useState<ScanTree | null>(null)
  const [disks, setDisks] = useState<DiskInfo[]>([])
  const [scanProgress, setScanProgress] = useState({ dirsScanned: 0, filesScanned: 0, bytesScanned: 0, cachedDirs: 0, currentDir: '', isIncremental: false, startTime: 0 })
  const [currentTree, setCurrentTree] = useState<ScanTree | null>(null)
  const [extensionFilter, setExtensionFilter] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: ScanTree } | null>(null)
  const [sizeFilter, setSizeFilter] = useState<'all' | '100mb' | '1gb' | '10gb'>('all')

  const treemapRef = useRef<HTMLDivElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 })

  // Load disk info on mount
  useEffect(() => {
        mulby.host?.call('getDiskInfo')?.then((res: any) => {
      const result = res?.data
      if (result?.disks) {
        setDisks(result.disks)
      }
    }).catch(() => {})
  }, [mulby.host])

  // Current tree for display
  const displayTree = currentTree || scanResult?.tree || null
  const displayItems = displayTree?.children || []

  // Available extensions for filter
  const availableExtensions = useMemo(() => {
    const exts = new Set<string>()
    for (const item of displayItems) {
      if (!item.isDirectory && item.extension) {
        exts.add(item.extension)
      }
    }
    return ['', ...Array.from(exts).sort()]
  }, [displayItems])

  // Sort & filter
  const sortedItems = useMemo(() => {
    let items = [...displayItems]

    if (extensionFilter) {
      items = items.filter(i => i.isDirectory || i.extension === extensionFilter)
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.extension.toLowerCase().includes(q)
      )
    }

    items.sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'size': cmp = a.size - b.size; break
        case 'name': cmp = a.name.localeCompare(b.name, 'zh-CN'); break
        case 'type': cmp = a.extension.localeCompare(b.extension); break
        case 'date': cmp = a.modifiedAt - b.modifiedAt; break
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return items
  }, [displayItems, sortBy, sortDir, searchQuery, extensionFilter])

  // Flat list for list view (collapsible tree)
  const flatList = useMemo(() => {
    if (!displayTree) return []
    const all = flattenTree(displayTree, expandedPaths)

    let filtered = all
    if (searchQuery || extensionFilter || sizeFilter !== 'all') {
      const q = searchQuery.toLowerCase()
      const sizeThresholds = { all: 0, '100mb': 100 * 1024 * 1024, '1gb': 1024 * 1024 * 1024, '10gb': 10 * 1024 * 1024 * 1024 }
      const minSize = sizeThresholds[sizeFilter]
      filtered = all.filter(({ item }) => {
        const matchSearch = !searchQuery || item.name.toLowerCase().includes(q) || item.extension.toLowerCase().includes(q)
        const matchExt = !extensionFilter || item.isDirectory || item.extension === extensionFilter
        const matchSize = item.isDirectory || item.size >= minSize
        return matchSearch && matchExt && matchSize
      })
    }

    return filtered
  }, [displayTree, expandedPaths, searchQuery, extensionFilter, sizeFilter])

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectFolder = useCallback(async () => {
    const dirs = await mulby.dialog.showOpenDialog({
      title: '选择要分析的目录',
      properties: ['openDirectory']
    })
    if (dirs && dirs.length > 0) {
      await startScan(dirs[0])
    }
  }, [mulby.dialog])

  const handleScanDrive = useCallback(async (drivePath: string) => {
    await startScan(drivePath)
  }, [])

  const startScan = useCallback(async (dirPath: string, forceFull = false) => {
    setSearchQuery('')
    setExtensionFilter('')
    setSelectedItem(null)

    // 1. Try loading cache first (non-blocking)
    let hasCache = false
    if (!forceFull) {
      try {
        const cacheRes = await mulby.host.call('loadCache', dirPath)
        const cached = cacheRes?.data as (ScanResult & { cachedAt: number }) | null
        if (cached?.tree) {
          hasCache = true
          // Show cached data immediately, no scanning overlay
          const cachedResult: ScanResult = { ...cached, isFromCache: true }
          setScanResult(cachedResult)
          setCurrentPath(dirPath)
          setCurrentTree(cachedResult.tree)
          const pathParts = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
          const crumbs = pathParts.map((part, i) => ({
            name: part,
            path: pathParts.slice(0, i + 1).join(dirPath.includes('/') ? '/' : '\\')
          }))
          setBreadcrumbs(crumbs)
        }
      } catch { /* no cache */ }
    }

    // 2. Start scanning (shows progress bar but doesn't block if we have cache)
    setIsScanning(true)
    setScanProgress({ dirsScanned: 0, filesScanned: 0, bytesScanned: 0, cachedDirs: 0, currentDir: '', isIncremental: hasCache, startTime: Date.now() })

    progressTimer.current = setInterval(async () => {
      try {
        const res = await mulby.host.call('getScanStatus')
        const status = res?.data
        if (status) setScanProgress(status)
      } catch { /* ignore */ }
    }, 100)

    // 3. Run scan
    const scanMethod = forceFull ? 'scanDirectory' : 'incrementalScan'
    try {
      const res = await mulby.host.call(scanMethod, dirPath, {
        maxDepth: 8,
        maxChildren: 3000
      })
      const result = res?.data as ScanResult | undefined
      if (!result) throw new Error('No result')

      setScanResult(result)
      setCurrentPath(dirPath)
      setCurrentTree(result.tree)

      const pathParts = dirPath.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
      const crumbs = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join(dirPath.includes('/') ? '/' : '\\')
      }))
      setBreadcrumbs(crumbs)
    } catch (e) {
      if (!hasCache) {
        mulby.notification.show('扫描失败，请检查路径权限', 'error')
      }
    } finally {
      if (progressTimer.current) {
        clearInterval(progressTimer.current)
        progressTimer.current = null
      }
      setIsScanning(false)
    }
  }, [mulby.host, mulby.notification])

  const handleCancelScan = useCallback(async () => {
    await mulby.host.call('cancelScan')
    setIsScanning(false)
    if (progressTimer.current) {
      clearInterval(progressTimer.current)
      progressTimer.current = null
    }
  }, [mulby.host])

  const handleNavigateToItem = useCallback((item: ScanTree) => {
    if (item.isDirectory && item.children && item.children.length > 0) {
      setCurrentTree(item)
      const parts = item.path.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean)
      const crumbs = parts.map((part, i) => ({
        name: part,
        path: parts.slice(0, i + 1).join(item.path.includes('/') ? '/' : '\\')
      }))
      setBreadcrumbs(crumbs)
      setSearchQuery('')
      setExtensionFilter('')
      setSelectedItem(null)
    } else {
      setSelectedItem(item)
    }
  }, [])

  const handleBreadcrumbClick = useCallback((index: number) => {
    if (!scanResult) return
    let tree: ScanTree = scanResult.tree
    const targetCrumbs = breadcrumbs.slice(0, index + 1)

    for (let i = 1; i < targetCrumbs.length; i++) {
      const targetName = targetCrumbs[i].name
      const found = tree.children?.find(c => c.name === targetName)
      if (found) {
        tree = found
      } else {
        break
      }
    }

    setCurrentTree(tree)
    setBreadcrumbs(targetCrumbs)
    setSearchQuery('')
    setExtensionFilter('')
  }, [scanResult, breadcrumbs])

  const handleGoBack = useCallback(() => {
    if (breadcrumbs.length <= 1 && scanResult?.tree) {
      setCurrentTree(scanResult.tree)
      setBreadcrumbs(breadcrumbs.slice(0, 1))
    } else if (breadcrumbs.length > 1) {
      handleBreadcrumbClick(breadcrumbs.length - 2)
    }
  }, [breadcrumbs, scanResult, handleBreadcrumbClick])

  const handleShowInFolder = useCallback(async (itemPath: string) => {
    await mulby.shell.showItemInFolder(itemPath)
  }, [mulby.shell])

  const toggleSort = useCallback((field: 'size' | 'name' | 'type' | 'date') => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }, [sortBy])

  // Toggle folder expand/collapse
  const toggleExpand = useCallback((itemPath: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(itemPath)) next.delete(itemPath)
      else next.add(itemPath)
      return next
    })
  }, [])

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, item: ScanTree) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (contextMenu) {
      const handler = () => closeContextMenu()
      window.addEventListener('click', handler)
      return () => window.removeEventListener('click', handler)
    }
  }, [contextMenu, closeContextMenu])

  const handleCopyPath = useCallback((itemPath: string) => {
    mulby.clipboard.writeText(itemPath)
    mulby.notification.show('已复制路径', 'success')
    closeContextMenu()
  }, [mulby.clipboard, mulby.notification, closeContextMenu])

  // Export results as CSV or JSON
  const handleExport = useCallback((format: 'csv' | 'json') => {
    if (!flatList.length) return
    const rows = flatList.map(({ item, depth }) => ({
      name: item.name,
      path: item.path,
      size: item.size,
      sizeFormatted: formatSize(item.size),
      type: item.isDirectory ? 'folder' : item.extension,
      modified: item.modifiedAt ? new Date(item.modifiedAt).toISOString() : '',
      depth
    }))

    let content: string
    let mimeType: string
    let ext: string

    if (format === 'csv') {
      const header = 'Name,Path,Size,Type,Modified,Depth'
      const csvRows = rows.map(r =>
        `"${r.name.replace(/"/g, '""')}","${r.path.replace(/"/g, '""')}",${r.size},"${r.type}","${r.modified}",${r.depth}`
      )
      content = [header, ...csvRows].join('\n')
      mimeType = 'text/csv'
      ext = 'csv'
    } else {
      content = JSON.stringify(rows, null, 2)
      mimeType = 'application/json'
      ext = 'json'
    }

    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `disk-scan-${Date.now()}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    mulby.notification.show(`已导出 ${flatList.length} 条记录`, 'success')
  }, [flatList, mulby.notification])

  // Virtual scroll handler
  const ROW_HEIGHT = 36
  const handleListScroll = useCallback(() => {
    const el = listScrollRef.current
    if (!el) return
    const scrollTop = el.scrollTop
    const viewHeight = el.clientHeight
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10)
    const end = Math.min(flatList.length, Math.ceil((scrollTop + viewHeight) / ROW_HEIGHT) + 10)
    setVisibleRange({ start, end })
  }, [flatList.length])

  useEffect(() => {
    const el = listScrollRef.current
    if (el) el.addEventListener('scroll', handleListScroll, { passive: true })
    return () => el?.removeEventListener('scroll', handleListScroll)
  }, [handleListScroll])

  // Reset expanded paths when tree changes
  useEffect(() => {
    setExpandedPaths(new Set())
    setSizeFilter('all')
  }, [currentPath])

  // ─── Render ─────────────────────────────────────────────────────────────────

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <ArrowUpDown size={12} className="opacity-30" />
    return sortDir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />
  }

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 select-none">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/80 border-b border-slate-700/50">
        <button
          onClick={handleSelectFolder}
          disabled={isScanning}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors"
        >
          <FolderOpen size={16} />
          选择目录
        </button>

        {/* Quick drive buttons */}
        {disks.map(disk => (
          <button
            key={disk.path}
            onClick={() => handleScanDrive(disk.path)}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm transition-colors"
            title={disk.total > 0 ? `${formatSize(disk.free)} 可用 / ${formatSize(disk.total)} 总计` : disk.name}
          >
            <HardDrive size={14} />
            <span>{disk.name}</span>
            {disk.total > 0 && (
              <span className="text-xs text-slate-400 ml-1">{disk.usedPercent}%</span>
            )}
          </button>
        ))}

        <div className="flex-1" />

        {scanResult && (
          <>
            <button
              onClick={() => startScan(currentPath)}
              disabled={isScanning}
              title="增量更新（跳过未变化目录）"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm transition-colors"
            >
              <RefreshCw size={14} className={isScanning ? 'animate-spin-slow' : ''} />
              刷新
            </button>
            <button
              onClick={() => startScan(currentPath, true)}
              disabled={isScanning}
              title="全量重新扫描（忽略缓存）"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-600 disabled:opacity-50 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              全量扫描
            </button>
          </>
        )}

        {isScanning ? (
          <button
            onClick={handleCancelScan}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-500 text-sm font-medium transition-colors"
          >
            <X size={14} />
            取消
          </button>
        ) : (
          <div className="flex items-center rounded-lg bg-slate-700/50 p-0.5">
            <button
              onClick={() => setViewMode('treemap')}
              title="矩形图视图"
              className={`p-1.5 rounded ${viewMode === 'treemap' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'} transition-colors`}
            >
              <LayoutGrid size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              title="列表视图"
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'} transition-colors`}
            >
              <List size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── Scanning Progress ── */}
      {isScanning && (
        <div className={`border-b ${scanProgress.isIncremental ? 'px-4 py-1.5 bg-slate-800/20 border-slate-700/20' : 'px-4 py-3 bg-indigo-900/30 border-indigo-700/30'}`}>
          <div className={`flex items-center justify-between ${scanProgress.isIncremental ? 'text-xs' : 'text-sm'} text-indigo-200`}>
            <div className="flex items-center gap-2">
              <Loader2 size={14} className={`animate-spin ${scanProgress.isIncremental ? 'text-slate-400' : ''}`} />
              <span className={`font-medium ${scanProgress.isIncremental ? 'text-slate-400' : ''}`}>
                {scanProgress.isIncremental ? '后台更新中' : '正在扫描'}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-indigo-300">
              {scanProgress.cachedDirs > 0 && (
                <span className="text-emerald-400">跳过 {scanProgress.cachedDirs.toLocaleString()} 目录</span>
              )}
              {scanProgress.dirsScanned > 0 && (
                <span>{scanProgress.dirsScanned.toLocaleString()} 目录</span>
              )}
              {scanProgress.filesScanned > 0 && (
                <span>{scanProgress.filesScanned.toLocaleString()} 文件</span>
              )}
              {scanProgress.bytesScanned > 0 && (
                <span className="text-indigo-400">{formatSize(scanProgress.bytesScanned)}</span>
              )}
              {scanProgress.startTime > 0 && (() => {
                const elapsed = (Date.now() - scanProgress.startTime) / 1000
                if (elapsed < 0.5) return null
                const speed = scanProgress.filesScanned / elapsed
                return (
                  <>
                    <span>{elapsed.toFixed(1)}s</span>
                    {speed > 10 && <span className="text-indigo-400">{Math.round(speed)} 文件/s</span>}
                  </>
                )
              })()}
            </div>
          </div>
          {!scanProgress.isIncremental && scanProgress.currentDir && (
            <p className="text-xs text-indigo-400/60 truncate mt-1.5 pl-6 font-mono">
              {scanProgress.currentDir}
            </p>
          )}
          <div className={`mt-1.5 rounded overflow-hidden ${scanProgress.isIncremental ? 'h-0.5' : 'mt-2 h-1'} bg-indigo-900/50`}>
            <div className="h-full w-1/3 bg-indigo-500/60 rounded progress-bar-indeterminate" />
          </div>
        </div>
      )}

      {/* ── Breadcrumb ── */}
      {displayTree && (!isScanning || scanProgress.isIncremental) && (
        <div className="flex items-center gap-1 px-4 py-2 text-sm bg-slate-800/40 border-b border-slate-700/30">
          {breadcrumbs.length > 1 && (
            <button
              onClick={handleGoBack}
              className="text-slate-400 hover:text-white px-1 transition-colors"
            >
              ←
            </button>
          )}
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-slate-500" />}
              <button
                onClick={() => handleBreadcrumbClick(i)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  i === breadcrumbs.length - 1
                    ? 'text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── Stats Bar ── */}
      {scanResult && (!isScanning || scanProgress.isIncremental) && (
        <div className="flex items-center gap-4 px-4 py-2 text-xs text-slate-400 bg-slate-800/30 border-b border-slate-700/20">
          <span className="flex items-center gap-1.5">
            <HardDrive size={12} />
            总大小: <strong className="text-slate-200">{formatSize(scanResult.totalSize ?? 0)}</strong>
          </span>
          <span>文件: <strong className="text-slate-200">{(scanResult.totalFiles ?? 0).toLocaleString()}</strong></span>
          <span>文件夹: <strong className="text-slate-200">{(scanResult.totalDirs ?? 0).toLocaleString()}</strong></span>
          <span>耗时: <strong className="text-slate-200">{((scanResult.scanTimeMs ?? 0) / 1000).toFixed(1)}s</strong></span>
          <span>当前目录: <strong className="text-slate-200">{displayItems.length}</strong> 项</span>
          {scanResult.cachedAt && (
            <span className="ml-auto text-slate-500" title={new Date(scanResult.cachedAt).toLocaleString('zh-CN')}>
              缓存于 {formatTimeAgo(scanResult.cachedAt)}
            </span>
          )}
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* Empty state */}
        {!isScanning && !displayTree && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400 animate-fade-in">
            <div className="w-20 h-20 rounded-2xl bg-slate-800 flex items-center justify-center">
              <HardDrive size={40} className="text-indigo-400" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-medium text-slate-200 mb-1">磁盘助手</h2>
              <p className="text-sm">选择目录或点击磁盘分区开始分析空间占用</p>
            </div>
            <button
              onClick={handleSelectFolder}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              <FolderOpen size={18} />
              选择目录
            </button>
            {disks.length > 0 && (
              <div className="flex gap-3 mt-2">
                {disks.map(disk => (
                  <button
                    key={disk.path}
                    onClick={() => handleScanDrive(disk.path)}
                    className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 transition-colors min-w-[100px]"
                  >
                    <HardDrive size={20} className="text-indigo-400" />
                    <span className="text-sm font-medium">{disk.name}</span>
                    {disk.total > 0 && (
                      <span className="text-xs text-slate-400">
                        {formatSize(disk.free)} / {formatSize(disk.total)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Treemap view */}
        {displayTree && (!isScanning || scanProgress.isIncremental) && viewMode === 'treemap' && (
          <div className="flex-1 flex flex-col min-h-0 animate-fade-in">
            <div className="flex-1 min-h-0 p-3">
              <TreemapView
                items={sortedItems}
                onNavigate={handleNavigateToItem}
                totalSize={displayTree.size || sortedItems.reduce((s, i) => s + i.size, 0)}
                containerRef={treemapRef}
              />
            </div>

            {/* Legend bar */}
            <div className="px-4 pb-3">
              <div className="flex items-center gap-3 overflow-x-auto text-xs">
                {sortedItems.slice(0, 8).map((item, i) => (
                  <button
                    key={item.path + i}
                    onClick={() => handleNavigateToItem(item)}
                    className="flex items-center gap-1.5 shrink-0 hover:opacity-80 transition-opacity"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: getColor(i) }} />
                    <span className="text-slate-300 truncate max-w-[120px]">{item.name}</span>
                    <span className="text-slate-500">{formatSize(item.size)}</span>
                  </button>
                ))}
                {sortedItems.length > 8 && (
                  <span className="text-slate-500 shrink-0">
                    +{sortedItems.length - 8} 更多
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* List view */}
        {displayTree && (!isScanning || scanProgress.isIncremental) && viewMode === 'list' && (
          <div className="flex-1 flex flex-col min-h-0 animate-fade-in min-w-0">
            {/* Search & filter bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/30 flex-wrap min-w-0">
              <div className="flex-1 relative min-w-[140px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索文件或文件夹..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} title="清除搜索" className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                    <X size={14} />
                  </button>
                )}
              </div>
              {availableExtensions.length > 1 && (
                <select title="文件类型筛选" value={extensionFilter} onChange={e => setExtensionFilter(e.target.value)}
                  className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 shrink-0">
                  <option value="">所有类型</option>
                  {availableExtensions.filter(Boolean).map(ext => (<option key={ext} value={ext}>{ext.toUpperCase()}</option>))}
                </select>
              )}
              {/* Size filter */}
              <select title="文件大小筛选" value={sizeFilter} onChange={e => setSizeFilter(e.target.value as any)}
                className="px-2 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 shrink-0">
                <option value="all">全部大小</option>
                <option value="100mb">&gt; 100 MB</option>
                <option value="1gb">&gt; 1 GB</option>
                <option value="10gb">&gt; 10 GB</option>
              </select>
              {/* Export */}
              <div className="flex gap-1 shrink-0">
                <button onClick={() => handleExport('json')} title="导出 JSON"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                  <Download size={14} />
                </button>
            </div>
            </div>

            {/* Header row */}
            <div className="flex items-center px-3 py-2 text-xs font-medium text-slate-400 border-b border-slate-700/30 bg-slate-800/60 shrink-0 min-w-0">
              <button onClick={() => toggleSort('name')} className="flex items-center gap-1 flex-1 min-w-0 hover:text-white transition-colors cursor-pointer">
                名称 <SortIcon field="name" />
              </button>
              <button onClick={() => toggleSort('size')} className="flex items-center justify-end gap-1 w-[100px] shrink-0 hover:text-white transition-colors cursor-pointer">
                大小 <SortIcon field="size" />
              </button>
              <button onClick={() => toggleSort('type')} className="flex items-center justify-center gap-1 w-[56px] shrink-0 hover:text-white transition-colors cursor-pointer">
                类型 <SortIcon field="type" />
              </button>
              <button onClick={() => toggleSort('date')} className="flex items-center justify-end gap-1 w-[96px] shrink-0 hover:text-white transition-colors cursor-pointer">
                日期 <SortIcon field="date" />
              </button>
              <div className="w-[32px] shrink-0" />
            </div>

            {/* Virtual-scrolled list body */}
            <div
              ref={listScrollRef}
              className="flex-1 overflow-auto min-h-0"
              style={{ contain: 'strict' }}
            >
              {flatList.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
                  {searchQuery || extensionFilter || sizeFilter !== 'all' ? '没有匹配的结果' : '没有可显示的项目'}
                </div>
              ) : (
                <div style={{ height: flatList.length * ROW_HEIGHT, position: 'relative' }}>
                  {flatList.slice(visibleRange.start, visibleRange.end).map(({ item, depth }, idx) => {
                    const globalIdx = visibleRange.start + idx
                    const isSelected = selectedItem?.path === item.path
                    const sizePercent = scanResult && scanResult.totalSize > 0
                      ? (item.size / scanResult.totalSize) * 100
                      : 0
                    const sizeColor = sizePercent > 10 ? 'bg-red-500' : sizePercent > 3 ? 'bg-yellow-500' : 'bg-indigo-500'

                    return (
                      <div
                        key={item.path}
                        className={`flex items-center px-3 border-b border-slate-800/30 cursor-pointer transition-colors min-w-0 ${isSelected ? 'bg-indigo-600/20' : 'hover:bg-slate-700/30'}`}
                        style={{ position: 'absolute', top: globalIdx * ROW_HEIGHT, left: 0, right: 0, height: ROW_HEIGHT }}
                        onClick={() => setSelectedItem(item)}
                        onDoubleClick={() => item.isDirectory && handleNavigateToItem(item)}
                        onContextMenu={e => handleContextMenu(e, item)}
                      >
                        {/* Name + tree toggle */}
                        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm" style={{ paddingLeft: depth * 14 }}>
                          {item.isDirectory && item.children && item.children.length > 0 ? (
                            <button
                              onClick={e => { e.stopPropagation(); toggleExpand(item.path) }}
                              className="p-0.5 rounded hover:bg-slate-600 shrink-0"
                              title={expandedPaths.has(item.path) ? '折叠' : '展开'}
                            >
                              {expandedPaths.has(item.path) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          ) : (
                            <span className="w-5 shrink-0" />
                          )}
                          {item.isDirectory ? <Folder size={14} className="text-indigo-400 shrink-0" /> : <File size={14} className="text-slate-400 shrink-0" />}
                          <span className="truncate ml-1" title={item.name}>{item.name}</span>
                          {item.isDirectory && item.children && (
                            <span className="text-xs text-slate-500 shrink-0 ml-1">({item.children.length})</span>
                          )}
                        </div>
                        {/* Size with bar */}
                        <div className="flex items-center justify-end gap-1.5 w-[100px] shrink-0 text-sm">
                          <div className="w-10 h-1 bg-slate-700/50 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${sizeColor}`} style={{ width: `${Math.min(sizePercent * 3, 100)}%` }} />
                          </div>
                          <span className="text-slate-200 tabular-nums text-xs w-14 text-right">{formatSize(item.size)}</span>
                        </div>
                        {/* Type */}
                        <div className="w-[56px] shrink-0 text-center">
                          <span className="text-xs text-slate-400 px-1 py-0.5 rounded bg-slate-800/50">
                            {getExtLabel(item.extension)}
                          </span>
                        </div>
                        {/* Date */}
                        <div className="w-[96px] shrink-0 text-right text-xs text-slate-400 tabular-nums whitespace-nowrap">
                          {formatDate(item.modifiedAt)}
                        </div>
                        {/* Actions */}
                        <div className="w-[32px] shrink-0 flex justify-center">
                          <button
                            onClick={e => { e.stopPropagation(); handleShowInFolder(item.path) }}
                            className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                            title="在文件管理器中显示"
                          >
                            <ExternalLink size={12} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Bottom status */}
            <div className="px-3 py-1.5 text-xs text-slate-500 border-t border-slate-700/20 shrink-0 flex items-center justify-between">
              <span>{flatList.length.toLocaleString()} 项</span>
              {flatList.length > 0 && <span>虚拟滚动 · 当前渲染 {visibleRange.end - visibleRange.start} 行</span>}
            </div>
          </div>
        )}

        {/* ── Context Menu ── */}
        {contextMenu && (
          <div
            className="fixed z-50 py-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl text-sm min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-1 text-xs text-slate-400 truncate max-w-[240px]">{contextMenu.item.name}</div>
            <div className="border-t border-slate-700 my-1" />
            {contextMenu.item.isDirectory && (
              <button
                onClick={() => { handleNavigateToItem(contextMenu.item); closeContextMenu() }}
                className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-slate-700 text-left transition-colors"
              >
                <FolderOpen size={14} /> 打开
              </button>
            )}
            <button
              onClick={() => handleCopyPath(contextMenu.item.path)}
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-slate-700 text-left transition-colors"
            >
              <Copy size={14} /> 复制路径
            </button>
            <button
              onClick={() => { handleShowInFolder(contextMenu.item.path); closeContextMenu() }}
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-slate-700 text-left transition-colors"
            >
              <ExternalLink size={14} /> 在资源管理器中显示
            </button>
          </div>
        )}
      </div>

      {/* ── Item Detail Panel ── */}
      {selectedItem && !isScanning && (
        <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-800/60 border-t border-slate-700/30 text-sm animate-fade-in">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {selectedItem.isDirectory ? (
              <Folder size={16} className="text-indigo-400 shrink-0" />
            ) : (
              <File size={16} className="text-slate-400 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{selectedItem.name}</p>
              <p className="text-xs text-slate-400 truncate">{selectedItem.path}</p>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <span className="text-indigo-300 font-medium">{formatSize(selectedItem.size)}</span>
            <span className="text-slate-400">{getExtLabel(selectedItem.extension)}</span>
            {selectedItem.modifiedAt > 0 && (
              <span className="text-slate-400">{formatDate(selectedItem.modifiedAt)}</span>
            )}
            {selectedItem.isDirectory ? (
              <button
                onClick={() => handleNavigateToItem(selectedItem)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs transition-colors"
              >
                <FolderOpen size={12} />
                打开
              </button>
            ) : null}
            <button
              onClick={() => handleShowInFolder(selectedItem.path)}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs transition-colors"
            >
              <ExternalLink size={12} />
              定位
            </button>
            <button
              onClick={() => setSelectedItem(null)}
              title="关闭详情"
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
