import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, FileStack, Fingerprint, FolderOpen, Loader2, Trash2, X } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

const PLUGIN_ID = 'batch-file-md5'

interface Attachment {
  path?: string
  name?: string
}

interface PluginInitData {
  attachments?: Attachment[]
}

type HashFileRow = {
  path: string
  name: string
  size: number
  md5: string
  error?: string
}

type FileEntry = {
  path: string
  name: string
}

function baseName(p: string) {
  const normalized = p.replace(/\\/g, '/')
  const i = normalized.lastIndexOf('/')
  return i >= 0 ? normalized.slice(i + 1) : normalized
}

function formatBytes(n: number) {
  if (n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Mulby 的 showOpenDialog 通常直接返回 string[]；部分环境可能是 { filePaths } */
function pathsFromOpenDialog(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.filter((p): p is string => typeof p === 'string' && p.length > 0)
  }
  if (result && typeof result === 'object') {
    const o = result as { canceled?: boolean; filePaths?: string[] }
    if (o.canceled) return []
    if (Array.isArray(o.filePaths)) {
      return o.filePaths.filter((p): p is string => typeof p === 'string' && p.length > 0)
    }
  }
  return []
}

export default function App() {
  const { dialog, notification, host, clipboard } = useMulby(PLUGIN_ID)
  const [files, setFiles] = useState<FileEntry[]>([])
  const [results, setResults] = useState<Map<string, HashFileRow>>(new Map())
  const [busy, setBusy] = useState(false)
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null)

  const mergePaths = useCallback((paths: string[]) => {
    if (!paths.length) return
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path))
      const next = [...prev]
      for (const p of paths) {
        if (!p || seen.has(p)) continue
        seen.add(p)
        next.push({ path: p, name: baseName(p) })
      }
      return next
    })
    setResults(new Map())
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const paths = (data.attachments ?? [])
        .map((a) => a.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
      mergePaths(paths)
    })

    void (async () => {
      try {
        const res = await host.call('getPendingInit')
        const d = res?.data as { paths?: string[] } | undefined
        if (d?.paths?.length) mergePaths(d.paths)
      } catch {
        /* host 未就绪 */
      }
    })()
  }, [host, mergePaths])

  const pickFiles = async () => {
    try {
      const r = await dialog.showOpenDialog({
        title: '选择文件（可多选）',
        properties: ['openFile', 'multiSelections', 'showHiddenFiles']
      })
      const filePaths = pathsFromOpenDialog(r)
      if (!filePaths.length) return
      mergePaths(filePaths)
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '无法打开文件选择框', 'error')
    }
  }

  const clearList = () => {
    setFiles([])
    setResults(new Map())
    setLastElapsedMs(null)
  }

  const removeAt = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path))
    setResults((prev) => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }

  const runHash = async () => {
    if (!files.length || busy) return
    setBusy(true)
    setResults(new Map())
    try {
      const res = await host.call(
        'hashFiles',
        files.map((f) => f.path)
      )
      const data = res?.data as { results?: HashFileRow[]; elapsedMs?: number } | undefined
      const rows = data?.results ?? []
      const map = new Map<string, HashFileRow>()
      for (const row of rows) {
        map.set(row.path, row)
      }
      setResults(map)
      setLastElapsedMs(typeof data?.elapsedMs === 'number' ? data.elapsedMs : null)
      const ok = rows.filter((r) => r.md5 && !r.error).length
      const fail = rows.length - ok
      if (fail === 0) {
        notification.show(`已完成 ${ok} 个文件的 MD5 计算`, 'success')
      } else {
        notification.show(`完成：成功 ${ok}，失败或跳过 ${fail}`, 'warning')
      }
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '计算失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const copyLine = async (path: string, md5: string) => {
    const line = `${md5}  ${path}`
    try {
      await clipboard.writeText(line)
      notification.show('已复制到剪贴板', 'success')
    } catch {
      notification.show('复制失败', 'error')
    }
  }

  const copyAll = async () => {
    const lines: string[] = []
    for (const f of files) {
      const r = results.get(f.path)
      if (r?.md5 && !r.error) {
        lines.push(`${r.md5}  ${f.path}`)
      }
    }
    if (!lines.length) {
      notification.show('没有可复制的 MD5 结果', 'warning')
      return
    }
    try {
      await clipboard.writeText(lines.join('\n'))
      notification.show(`已复制 ${lines.length} 行`, 'success')
    } catch {
      notification.show('复制失败', 'error')
    }
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const list = e.dataTransfer?.files
    if (!list?.length) return
    const paths: string[] = []
    for (let i = 0; i < list.length; i++) {
      const file = list[i] as File & { path?: string }
      if (typeof file.path === 'string' && file.path.length > 0) {
        paths.push(file.path)
      }
    }
    if (paths.length) {
      mergePaths(paths)
    } else {
      notification.show('请从资源管理器拖入文件（浏览器内拖入可能无本地路径）', 'info')
    }
  }

  const summary = useMemo(() => {
    let ok = 0
    let err = 0
    for (const f of files) {
      const r = results.get(f.path)
      if (!r) continue
      if (r.error || !r.md5) err++
      else ok++
    }
    return { ok, err, total: files.length }
  }, [files, results])

  return (
    <div className="app-shell" onDragOver={onDragOver} onDrop={onDrop}>
      <header className="glass-hero neo-inset">
        <div className="hero-text">
          <span className="pill">
            <Fingerprint size={14} aria-hidden />
            MD5
          </span>
          <h1>批量文件 MD5</h1>
          <p>
            使用流式读取与多文件并行，快速计算校验值。支持多选文件、从 Mulby 附带文件启动，或将文件拖入下方区域。
          </p>
        </div>
        <div className="hero-stat glass-mini neo-raised">
          <span className="stat-label">队列</span>
          <strong>{summary.total}</strong>
          <span className="stat-sub">
            已完成 {summary.ok}
            {summary.err > 0 ? ` · 异常 ${summary.err}` : ''}
          </span>
        </div>
      </header>

      <section className="toolbar glass-bar neo-raised">
        <button type="button" className="neo-btn primary" onClick={pickFiles} disabled={busy}>
          <FolderOpen size={18} />
          选择文件
        </button>
        <button type="button" className="neo-btn" onClick={runHash} disabled={busy || !files.length}>
          {busy ? <Loader2 className="spin" size={18} /> : <Fingerprint size={18} />}
          {busy ? '计算中…' : '开始计算'}
        </button>
        <button type="button" className="neo-btn" onClick={copyAll} disabled={busy || summary.ok === 0}>
          <Copy size={18} />
          复制全部
        </button>
        <button type="button" className="neo-btn danger" onClick={clearList} disabled={busy || !files.length}>
          <Trash2 size={18} />
          清空
        </button>
        {lastElapsedMs != null && (
          <span className="toolbar-meta">耗时 {lastElapsedMs} ms</span>
        )}
      </section>

      <div
        className={`drop-zone glass-panel neo-inset ${files.length === 0 ? 'drop-zone--empty' : ''}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {files.length === 0 ? (
          <div className="drop-hint">
            <FileStack size={40} strokeWidth={1.25} />
            <p>将文件拖放到此处，或点击「选择文件」</p>
          </div>
        ) : (
          <ul className="file-list">
            {files.map((f) => {
              const r = results.get(f.path)
              return (
                <li key={f.path} className="file-row glass-row neo-raised">
                  <div className="file-main">
                    <span className="file-name" title={f.path}>
                      {f.name}
                    </span>
                    <span className="file-path" title={f.path}>
                      {f.path}
                    </span>
                    {r && (
                      <div className="file-result">
                        {r.error ? (
                          <span className="text-warn">{r.error}</span>
                        ) : (
                          <>
                            <code className="md5">{r.md5}</code>
                            <span className="size">{formatBytes(r.size)}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="file-actions">
                    {r?.md5 && !r.error && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="复制 md5sum 格式"
                        onClick={() => void copyLine(f.path, r.md5)}
                      >
                        <Copy size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="移除"
                      onClick={() => removeAt(f.path)}
                      disabled={busy}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
