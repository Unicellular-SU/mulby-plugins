import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal, Trash2, Copy, Check, ListFilter, Crosshair } from 'lucide-react'
import type { LogEntry } from '../types'

const levelColor: Record<string, string> = {
  info: 'text-slate-500 dark:text-slate-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-rose-600 dark:text-rose-400',
  warn: 'text-amber-600 dark:text-amber-400'
}

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })

export function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const endRef = useRef<HTMLDivElement>(null)
  const firstErrorRef = useRef<HTMLDivElement>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [copied, setCopied] = useState(false)

  const errorCount = useMemo(() => logs.filter((l) => l.level === 'error').length, [logs])
  const firstErrorId = useMemo(() => logs.find((l) => l.level === 'error')?.id, [logs])
  // 「仅错误」也保留 warn，便于连同警告一起排查
  const shown = useMemo(
    () => (onlyErrors ? logs.filter((l) => l.level === 'error' || l.level === 'warn') : logs),
    [logs, onlyErrors]
  )

  // 仅在「全部」视图自动滚到底，避免过滤态被打断
  useEffect(() => {
    if (!onlyErrors) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, onlyErrors])

  const copyAll = async () => {
    const text = logs.map((l) => `[${fmtTime(l.ts)}] ${l.text}`).join('\n')
    try {
      const mc = (window as any)?.mulby?.clipboard
      if (mc?.writeText) await mc.writeText(text)
      else await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* 复制失败静默 */ }
  }

  const jumpToError = () => firstErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
          <Terminal size={14} /> 诊断日志
          {errorCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400">
              {errorCount} 错误
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {errorCount > 0 && (
            <button onClick={jumpToError} className="btn-ghost !px-2 !py-1 text-xs" title="定位到首个错误">
              <Crosshair size={12} /> 定位错误
            </button>
          )}
          <button
            onClick={() => setOnlyErrors((v) => !v)}
            className={`btn-ghost !px-2 !py-1 text-xs ${onlyErrors ? 'text-amber-600 dark:text-amber-400' : ''}`}
            title={onlyErrors ? '显示全部日志' : '只看错误/警告'}
          >
            <ListFilter size={12} /> {onlyErrors ? '仅错误' : '全部'}
          </button>
          <button onClick={copyAll} className="btn-ghost !px-2 !py-1 text-xs" disabled={logs.length === 0} title="复制全部日志">
            {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? '已复制' : '复制'}
          </button>
          <button onClick={onClear} className="btn-ghost !px-2 !py-1 text-xs" disabled={logs.length === 0}>
            <Trash2 size={12} /> 清空
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-2 mono text-[12px] leading-relaxed bg-slate-50/60 dark:bg-black/30">
        {shown.length === 0 ? (
          <div className="text-slate-400 dark:text-slate-600 italic">
            {onlyErrors ? '没有错误/警告日志。' : '暂无日志，执行构建/打包/创建后将在此显示流式输出。'}
          </div>
        ) : (
          shown.map((l) => (
            <div
              key={l.id}
              ref={l.id === firstErrorId ? firstErrorRef : undefined}
              className="whitespace-pre-wrap break-words"
            >
              <span className="text-slate-400 dark:text-slate-600 mr-2">{fmtTime(l.ts)}</span>
              <span className={levelColor[l.level] || levelColor.info}>{l.text}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
