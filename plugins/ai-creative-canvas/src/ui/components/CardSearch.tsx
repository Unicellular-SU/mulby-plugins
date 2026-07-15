import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { useEscClose } from '../hooks'
import { KIND_LABEL } from '../types'
import { focusCard } from '../focusCard'

interface Hit {
  boardId: string
  boardName: string
  cardId: string
  kind: string
  title: string
  snippet: string
}

// 卡片搜索面板：按标题 / 提示词 / 文本过滤全工程卡片，点击结果切画布 + 居中定位。
export function CardSearch() {
  const show = useUi((s) => s.showSearch)
  const project = useGraph((s) => s.project)
  const [q, setQ] = useState('')
  const close = () => useUi.getState().setShowSearch(false)
  useEscClose(close, show)

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase()
    if (!query) return []
    const out: Hit[] = []
    for (const b of project.boards) {
      for (const c of Object.values(b.cards)) {
        if (c.kind === 'group') continue
        const title = c.title || KIND_LABEL[c.kind] || ''
        const body = `${c.prompt || ''} ${c.text || ''}`.trim()
        const hay = `${title} ${body}`.toLowerCase()
        if (!hay.includes(query)) continue
        // 摘要：取命中位置附近的片段
        let snippet = body
        const idx = body.toLowerCase().indexOf(query)
        if (idx >= 0) snippet = (idx > 20 ? '…' : '') + body.slice(Math.max(0, idx - 20), idx + 60)
        out.push({ boardId: b.id, boardName: b.name, cardId: c.id, kind: c.kind, title, snippet: snippet.slice(0, 90) })
        if (out.length >= 50) return out // 上限，避免超长列表
      }
    }
    return out
  }, [q, project])

  if (!show) return null

  const go = (h: Hit) => {
    focusCard(h.boardId, h.cardId)
    close()
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-start justify-center pt-24 p-6" onClick={close}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale w-[520px] max-w-full max-h-[60vh] flex flex-col text-neutral-800 dark:text-neutral-200"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <Search size={15} className="opacity-50 shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索卡片：标题 / 提示词 / 文本…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          {q && <span className="text-[11px] opacity-50 shrink-0">{hits.length} 条</span>}
        </div>
        <div className="flex-1 overflow-auto ace-scroll p-1.5">
          {!q.trim() ? (
            <div className="py-8 text-center text-xs opacity-40">输入关键词搜索全工程卡片</div>
          ) : hits.length === 0 ? (
            <div className="py-8 text-center text-xs opacity-40">无匹配卡片</div>
          ) : (
            hits.map((h) => (
              <button
                key={h.cardId}
                onClick={() => go(h)}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex flex-col gap-0.5"
              >
                <div className="text-xs font-medium truncate">
                  {h.title}
                  <span className="ml-1 opacity-40 font-normal">· {KIND_LABEL[h.kind as keyof typeof KIND_LABEL] || h.kind} · {h.boardName}</span>
                </div>
                {h.snippet && <div className="text-[11px] opacity-55 truncate">{h.snippet}</div>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
