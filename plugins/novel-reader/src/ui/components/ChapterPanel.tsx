import { List, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

export interface Chapter {
  index: number
  title: string
  charPosition: number
}

export default function ChapterPanel({ chapters, activeIndex, onSelect, onClose }: {
  chapters: Chapter[]
  activeIndex: number
  onSelect: (chapter: Chapter) => void
  onClose: () => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (listRef.current && activeIndex >= 0 && activeIndex < chapters.length) {
      const activeEl = listRef.current.children[activeIndex] as HTMLElement
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'center' })
      }
    }
  }, [activeIndex, chapters.length])

  return (
    <div className="absolute inset-0 z-40 flex flex-row-reverse">
      {/* Backdrop */}
      <div className="flex-1" onClick={onClose} />

      {/* Panel */}
      <div className="w-72 h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col animate-[slideIn_200ms_ease-out]">
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <List size={16} />
            <span>目录</span>
            <span className="text-xs text-[var(--text-3)]">({chapters.length}章)</span>
          </div>
          <button
            className="p-1 rounded-lg hover:bg-[var(--border)] transition-colors"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto" ref={listRef}>
          {chapters.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--text-3)]">
              未识别到章节标题
            </div>
          ) : (
            chapters.map((ch, i) => (
              <button
                key={i}
                className={`w-full text-left px-4 py-3 text-sm border-b border-[var(--border)] transition-colors hover:bg-[var(--border)] ${
                  i === activeIndex
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
                    : 'text-[var(--text-1)]'
                }`}
                onClick={() => onSelect(ch)}
              >
                <span className="text-xs text-[var(--text-3)] mr-2">
                  {ch.index}
                </span>
                {ch.title}
              </button>
            ))
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
