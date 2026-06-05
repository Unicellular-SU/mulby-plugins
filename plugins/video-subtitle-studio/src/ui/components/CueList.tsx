import { ArrowUpToLine, Play, Scissors, Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SubtitleCue } from '../lib/subtitles'

export type SplitRequest =
  | { kind: 'text'; textIndex: number }
  | { kind: 'time'; splitMs: number }
  | { kind: 'word'; wordIndex: number }

interface CueListProps {
  cues: SubtitleCue[]
  onChange: (id: string, patch: Partial<SubtitleCue>) => void
  onDelete: (id: string) => void
  onSplit?: (id: string, request: SplitRequest) => void
  onMerge?: (id: string) => void
  currentTimeMs?: number
  formatTime?: (ms: number) => string
  activeCueId?: string | null
  onSeek?: (startMs: number) => void
}

interface CueRowProps {
  cue: SubtitleCue
  index: number
  active: boolean
  canMerge: boolean
  currentTimeMs?: number
  formatTime?: (ms: number) => string
  onChange: (id: string, patch: Partial<SubtitleCue>) => void
  onDelete: (id: string) => void
  onSplit?: (id: string, request: SplitRequest) => void
  onMerge?: (id: string) => void
  onSeek?: (startMs: number) => void
}

const ESTIMATED_ROW_HEIGHT = 232
const GAP = 12
const OVERSCAN = 6

const CueRow = memo(function CueRow({
  cue,
  index,
  active,
  canMerge,
  currentTimeMs,
  formatTime,
  onChange,
  onDelete,
  onSplit,
  onMerge,
  onSeek
}: CueRowProps) {
  const textRef = useRef<HTMLTextAreaElement | null>(null)
  const [showSplit, setShowSplit] = useState(false)

  const cursorIndex = () => {
    const node = textRef.current
    const position = node?.selectionStart
    return typeof position === 'number' && position > 0 ? position : Math.floor(cue.text.length / 2)
  }

  const playheadInside =
    typeof currentTimeMs === 'number' && currentTimeMs > cue.startMs && currentTimeMs < cue.endMs

  return (
    <article className={`cue-card transition ${active ? 'cue-card-active' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">#{index + 1}</span>
        <div className="flex items-center gap-1">
          {onSeek && (
            <button className="icon-button hover:text-cyan-200" aria-label="跳转到此字幕" title="跳转播放" onClick={() => onSeek(cue.startMs)}>
              <Play size={15} />
            </button>
          )}
          {onMerge && canMerge && (
            <button className="icon-button hover:text-cyan-200" aria-label="向上合并" title="与上一条合并" onClick={() => onMerge(cue.id)}>
              <ArrowUpToLine size={15} />
            </button>
          )}
          {onSplit && (
            <button
              className={`icon-button hover:text-cyan-200 ${showSplit ? 'text-cyan-200' : ''}`}
              aria-label="拆分字幕"
              title="拆分字幕"
              onClick={() => setShowSplit((value) => !value)}
            >
              <Scissors size={15} />
            </button>
          )}
          <button className="icon-button" aria-label="删除字幕" onClick={() => onDelete(cue.id)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="field compact"><span>开始</span><input type="number" value={cue.startMs} onChange={(event) => onChange(cue.id, { startMs: Number(event.target.value) })} /></label>
        <label className="field compact"><span>结束</span><input type="number" value={cue.endMs} onChange={(event) => onChange(cue.id, { endMs: Number(event.target.value) })} /></label>
      </div>
      <textarea ref={textRef} value={cue.text} onChange={(event) => onChange(cue.id, { text: event.target.value })} />
      <textarea placeholder="译文" value={cue.translation || ''} onChange={(event) => onChange(cue.id, { translation: event.target.value })} />

      {onSplit && showSplit && (
        <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/60 p-3 text-sm">
          <p className="mb-2 text-xs text-slate-400">在哪里拆分这条字幕？</p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              onClick={() => {
                onSplit(cue.id, { kind: 'text', textIndex: cursorIndex() })
                setShowSplit(false)
              }}
            >
              <Scissors size={14} />
              在文本光标处
            </button>
            <button
              className="btn-secondary"
              disabled={!playheadInside}
              title={playheadInside ? '' : '播放头需在本条字幕时间范围内'}
              onClick={() => {
                if (typeof currentTimeMs === 'number') {
                  onSplit(cue.id, { kind: 'time', splitMs: currentTimeMs })
                  setShowSplit(false)
                }
              }}
            >
              <Play size={14} />
              在播放头{playheadInside && formatTime ? `（${formatTime(currentTimeMs!)}）` : ''}
            </button>
          </div>
          {cue.words && cue.words.length > 1 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs text-slate-400">或按词级时间戳，点词从其前面断开：</p>
              <div className="flex flex-wrap gap-1.5">
                {cue.words.map((word, wordIndex) => (
                  <button
                    key={`${word.startMs}-${wordIndex}`}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-200 transition hover:border-cyan-300/60 hover:bg-cyan-400/10 disabled:opacity-40"
                    disabled={wordIndex === 0}
                    onClick={() => {
                      onSplit(cue.id, { kind: 'word', wordIndex })
                      setShowSplit(false)
                    }}
                  >
                    {word.text || '·'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
})

export function CueList({
  cues,
  onChange,
  onDelete,
  onSplit,
  onMerge,
  currentTimeMs,
  formatTime,
  activeCueId,
  onSeek
}: CueListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const heightsRef = useRef<Map<string, number>>(new Map())
  const [viewportHeight, setViewportHeight] = useState(620)
  const [scrollTop, setScrollTop] = useState(0)
  const [, forceRender] = useState(0)

  const rowHeight = useCallback(
    (id: string) => heightsRef.current.get(id) ?? ESTIMATED_ROW_HEIGHT,
    []
  )

  const offsets: number[] = []
  let running = 0
  for (const cue of cues) {
    offsets.push(running)
    running += rowHeight(cue.id) + GAP
  }
  const totalHeight = Math.max(running - GAP, 0)

  let startIndex = 0
  while (startIndex < cues.length - 1 && offsets[startIndex + 1] <= scrollTop) startIndex += 1
  startIndex = Math.max(0, startIndex - OVERSCAN)

  let endIndex = startIndex
  const visibleBottom = scrollTop + viewportHeight
  while (endIndex < cues.length && offsets[endIndex] < visibleBottom) endIndex += 1
  endIndex = Math.min(cues.length, endIndex + OVERSCAN)

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setViewportHeight(element.clientHeight || 620)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const measureRow = useCallback((id: string, node: HTMLDivElement | null) => {
    if (!node) return
    const measured = node.getBoundingClientRect().height
    const previous = heightsRef.current.get(id)
    if (measured > 0 && (previous === undefined || Math.abs(previous - measured) > 1)) {
      heightsRef.current.set(id, measured)
      forceRender((value) => value + 1)
    }
  }, [])

  const activeIndex = activeCueId ? cues.findIndex((cue) => cue.id === activeCueId) : -1

  useEffect(() => {
    if (activeIndex < 0) return
    const element = scrollRef.current
    if (!element) return
    const top = offsets[activeIndex] ?? 0
    const bottom = top + rowHeight(cues[activeIndex].id)
    const viewTop = element.scrollTop
    const viewBottom = viewTop + element.clientHeight
    if (top < viewTop || bottom > viewBottom) {
      element.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex])

  const visible = cues.slice(startIndex, endIndex)

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto pr-2"
      onScroll={(event) => setScrollTop((event.target as HTMLDivElement).scrollTop)}
    >
      <div style={{ position: 'relative', height: totalHeight }}>
        {visible.map((cue, localIndex) => {
          const index = startIndex + localIndex
          return (
            <div
              key={cue.id}
              ref={(node) => measureRow(cue.id, node)}
              style={{ position: 'absolute', top: offsets[index], left: 0, right: 0 }}
            >
              <CueRow
                cue={cue}
                index={index}
                active={cue.id === activeCueId}
                canMerge={index > 0}
                currentTimeMs={currentTimeMs}
                formatTime={formatTime}
                onChange={onChange}
                onDelete={onDelete}
                onSplit={onSplit}
                onMerge={onMerge}
                onSeek={onSeek}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
