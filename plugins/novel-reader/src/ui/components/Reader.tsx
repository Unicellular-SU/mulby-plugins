import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, EyeOff, List, Loader2, Settings } from 'lucide-react'
import { useMulby } from '../hooks/useMulby'
import SettingsPanel from './SettingsPanel'
import ChapterPanel from './ChapterPanel'
import type { Chapter } from './ChapterPanel'
import type { BookEntry, ReaderSettings } from '../App'

const PLUGIN_ID = 'novel-reader'

interface ChapterIndex {
  title: string
  startOffset: number
  endOffset: number
}

function toPanelChapters(chapters: ChapterIndex[]): Chapter[] {
  return chapters.map((ch, i) => ({
    index: i + 1,
    title: ch.title,
    charPosition: ch.startOffset,
  }))
}

function resolveInitialChapterIndex(chapters: ChapterIndex[], progress: number): number {
  if (chapters.length === 0) return 0
  if (progress <= 0) return 0
  if (progress >= 1) return chapters.length - 1
  return Math.max(0, Math.min(chapters.length - 1, Math.floor(progress * chapters.length)))
}

export default function Reader({ book, settings, onBack, onSettingsChange }: {
  book: BookEntry
  settings: ReaderSettings
  onBack: () => void
  onSettingsChange: (s: ReaderSettings) => void
}) {
  const { host, window: mulbyWindow } = useMulby(PLUGIN_ID)
  const call = async (method: string, ...args: unknown[]) => {
    const result = await host.call(method, ...args)
    return (result as any)?.data
  }
  const containerRef = useRef<HTMLDivElement>(null)
  const preloadCache = useRef<Map<number, string>>(new Map())

  // View toggles
  const [showSettings, setShowSettings] = useState(false)
  const [showChapters, setShowChapters] = useState(false)

  // Data
  const [chapterIndex, setChapterIndex] = useState<ChapterIndex[] | null>(null)
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)
  const [chapterContent, setChapterContent] = useState('')
  const [fullText, setFullText] = useState('')
  const [isLoadingText, setIsLoadingText] = useState(true)
  const [isIndexing, setIsIndexing] = useState(false)
  const [indexingProgress, setIndexingProgress] = useState(0)
  const [indexingDone, setIndexingDone] = useState(false)
  const [hasChapters, setHasChapters] = useState(book.chapterCount > 0)
  const [readingMode, setReadingMode] = useState<'full' | 'chapter'>('full')

  // Scroll
  const [scrollProgress, setScrollProgress] = useState(book.progress)
  const [activeChapter, setActiveChapter] = useState(0)
  const restoringRef = useRef(false)
  const pendingScrollRef = useRef<number | null>(null)

  const chapters = chapterIndex ? toPanelChapters(chapterIndex) : []
  const showChaptersRef = useRef(false)
  const showSettingsRef = useRef(false)
  const readingModeRef = useRef<'full' | 'chapter'>('full')
  showChaptersRef.current = showChapters
  showSettingsRef.current = showSettings
  readingModeRef.current = readingMode

  // Determine display content
  const content = readingMode === 'chapter' && chapterContent ? chapterContent : fullText

  const getCurrentScrollProgress = useCallback(() => {
    const el = containerRef.current
    if (!el) return 0
    const maxScroll = el.scrollHeight - el.clientHeight
    return maxScroll > 0 ? el.scrollTop / maxScroll : 0
  }, [])

  const restoreScrollProgress = useCallback((progress: number) => {
    restoringRef.current = true
    requestAnimationFrame(() => {
      const el = containerRef.current
      if (el) {
        const maxScroll = el.scrollHeight - el.clientHeight
        el.scrollTop = Math.max(0, maxScroll * progress)
      }
      requestAnimationFrame(() => {
        restoringRef.current = false
      })
    })
  }, [])

  const loadFullTextFallback = useCallback(async () => {
    const data = await call('openBookData', book.filePath, book.id)
    const nextText = typeof data?.text === 'string' ? data.text : ''
    if (!nextText) return data

    const currentProgress = readingModeRef.current === 'full' ? getCurrentScrollProgress() : 0
    setFullText(nextText)
    if (readingModeRef.current === 'full') {
      restoreScrollProgress(currentProgress)
    }
    return data
  }, [book.filePath, book.id, getCurrentScrollProgress, host, restoreScrollProgress])

  const loadChapterByIndex = useCallback(async (chaptersSource: ChapterIndex[], idx: number, targetScroll: number = 0) => {
    if (idx < 0 || idx >= chaptersSource.length) return false

    const cached = preloadCache.current.get(idx)
    if (cached !== undefined) {
      setChapterContent(cached)
      setCurrentChapterIdx(idx)
      setActiveChapter(idx)
      setReadingMode('chapter')
      setScrollProgress(targetScroll)
      pendingScrollRef.current = targetScroll
      return true
    }

    const ch = chaptersSource[idx]
    try {
      const text = await call('readChapter', book.filePath, ch.startOffset, ch.endOffset)
      preloadCache.current.set(idx, text)
      setChapterContent(text)
      setCurrentChapterIdx(idx)
      setActiveChapter(idx)
      setReadingMode('chapter')
      setScrollProgress(targetScroll)
      pendingScrollRef.current = targetScroll
      return true
    } catch (err) {
      console.error('[novel-reader] loadChapter failed:', err)
      return false
    }
  }, [book.filePath, host])

  useEffect(() => {
    if (readingMode === 'chapter' && chapterContent && pendingScrollRef.current !== null) {
      const target = pendingScrollRef.current
      pendingScrollRef.current = null
      
      restoringRef.current = true
      requestAnimationFrame(() => {
        const el = containerRef.current
        if (el) {
          const maxScroll = el.scrollHeight - el.clientHeight
          el.scrollTop = Math.max(0, maxScroll * target)
        }
        requestAnimationFrame(() => {
          restoringRef.current = false
        })
      })
    }
  }, [chapterContent, readingMode])

  const initialProgressRef = useRef(book.progress)
  useEffect(() => {
    initialProgressRef.current = book.progress
  }, [book.id])

  // ── Init: load text first → then index ──

  useEffect(() => {
    let cancelled = false
    let progressTimer: number | null = null

    async function init() {
      const initialProgress = initialProgressRef.current
      setIsLoadingText(true)
      setIsIndexing(false)
      setIndexingProgress(0)
      setIndexingDone(false)
      setChapterIndex(null)
      setChapterContent('')
      setCurrentChapterIdx(0)
      setActiveChapter(0)
      setReadingMode('full')
      setScrollProgress(initialProgress)
      preloadCache.current.clear()

      // Step 1: Load a preview first so the reader can render immediately
      let previewText = ''
      let previewLoaded = false
      let previewIndexed = false
      let previewChapters: ChapterIndex[] = []
      try {
        const preview = await call('openBookPreview', book.filePath, book.id)
        if (cancelled) return

        previewText = preview?.text ?? ''
        previewLoaded = true
        previewIndexed = Boolean(preview?.indexed)
        previewChapters = preview?.chapters ?? []

        setFullText(previewText)

        if (previewChapters.length > 0) {
          setChapterIndex(previewChapters)
          setHasChapters(true)
        } else {
          setHasChapters(false)
        }
      } catch (err) {
        console.error('[novel-reader] openBookPreview failed:', err)
      }

      setIsLoadingText(false)
      if (cancelled) return
      if (!previewLoaded) {
        setIndexingDone(true)
        return
      }

      // Step 2: If chapters already exist, switch to chapter mode directly
      if (previewChapters.length > 0) {
        let initialIdx = 0
        let targetScroll = 0
        if (book.currentChapterIdx !== undefined && book.currentChapterIdx >= 0) {
          initialIdx = book.currentChapterIdx
          targetScroll = book.chapterProgress ?? 0
        } else {
          const exactProgress = initialProgress * previewChapters.length
          initialIdx = Math.max(0, Math.min(previewChapters.length - 1, Math.floor(exactProgress)))
          targetScroll = exactProgress - initialIdx
          if (targetScroll <= 0 && initialIdx > 0) {
            initialIdx -= 1
            targetScroll = 1.0
          }
          targetScroll = Math.max(0, Math.min(1, targetScroll))
        }
        
        await loadChapterByIndex(previewChapters, initialIdx, targetScroll)
        if (!cancelled) setIndexingDone(true)
        if (book.indexing) call('clearIndexingState', book.id)
        return
      }

      // Step 3: No chapters yet. If we've already indexed and found none, load full text as fallback.
      if (previewIndexed) {
        await loadFullTextFallback()
        if (!cancelled) setIndexingDone(true)
        if (book.indexing) call('clearIndexingState', book.id)
        return
      }

      // Step 4: Build the catalog in the backend so the reader thread stays responsive.
      setIsIndexing(true)
      setIndexingProgress(0.05)
      progressTimer = window.setInterval(() => {
        setIndexingProgress((value) => Math.min(0.9, value + 0.05))
      }, 250)

      try {
        const result = await call('indexBook', book.filePath, book.id)
        if (cancelled) return

        const nextChapters: ChapterIndex[] = result?.chapters ?? []
        setIndexingProgress(1)

        if (nextChapters.length > 0) {
          setChapterIndex(nextChapters)
          setHasChapters(true)
          let initialIdx = 0
          let targetScroll = 0
          if (book.currentChapterIdx !== undefined && book.currentChapterIdx >= 0) {
            initialIdx = book.currentChapterIdx
            targetScroll = book.chapterProgress ?? 0
          } else {
            const exactProgress = initialProgress * nextChapters.length
            initialIdx = Math.max(0, Math.min(nextChapters.length - 1, Math.floor(exactProgress)))
            targetScroll = exactProgress - initialIdx
            if (targetScroll <= 0 && initialIdx > 0) {
              initialIdx -= 1
              targetScroll = 1.0
            }
            targetScroll = Math.max(0, Math.min(1, targetScroll))
          }
          await loadChapterByIndex(nextChapters, initialIdx, targetScroll)
        } else {
          setHasChapters(false)
          await loadFullTextFallback()
        }
      } catch (err) {
        console.error('[novel-reader] indexBook failed:', err)
        await loadFullTextFallback()
      } finally {
        if (progressTimer !== null) {
          window.clearInterval(progressTimer)
          progressTimer = null
        }
        if (!cancelled) {
          setIsIndexing(false)
          setIndexingDone(true)
        }
      }
    }

    init()
    return () => {
      cancelled = true
      if (progressTimer !== null) {
        window.clearInterval(progressTimer)
      }
    }
  }, [book.id, book.filePath, host, loadChapterByIndex, loadFullTextFallback])

  // ── Restore full-text reading progress after the first paint ──

  useEffect(() => {
    const initialProgress = initialProgressRef.current
    if (isLoadingText || readingMode !== 'full' || !fullText || initialProgress <= 0) return

    restoringRef.current = true
    const firstFrame = requestAnimationFrame(() => {
      const el = containerRef.current
      if (el) {
        const maxScroll = el.scrollHeight - el.clientHeight
        el.scrollTop = Math.max(0, maxScroll * initialProgress)
      }
      requestAnimationFrame(() => {
        restoringRef.current = false
      })
    })

    return () => cancelAnimationFrame(firstFrame)
  }, [book.id, fullText, isLoadingText, readingMode, restoreScrollProgress])

  // ── Preload ──

  const preloadChapter = useCallback(async (idx: number) => {
    if (!chapterIndex || idx < 0 || idx >= chapterIndex.length) return
    if (preloadCache.current.has(idx)) return
    try {
      const ch = chapterIndex[idx]
      const text = await call('readChapter', book.filePath, ch.startOffset, ch.endOffset)
      preloadCache.current.set(idx, text)
    } catch { /* ignore */ }
  }, [chapterIndex, book.filePath, host])

  useEffect(() => {
    if (chapterIndex) {
      preloadChapter(currentChapterIdx + 1)
      preloadChapter(currentChapterIdx - 1)
    }
  }, [currentChapterIdx, chapterIndex, preloadChapter])

  // ── Scroll tracking ──

  const handleScroll = useCallback(() => {
    if (restoringRef.current) return
    const el = containerRef.current
    if (!el) return
    const maxScroll = el.scrollHeight - el.clientHeight
    const progress = maxScroll > 0 ? el.scrollTop / maxScroll : 0
    setScrollProgress(progress)

    if (readingMode === 'full' && chapterIndex && chapterIndex.length > 0 && fullText.length > 0) {
      const approxChar = progress * fullText.length
      let nextActive = 0
      for (let i = chapterIndex.length - 1; i >= 0; i--) {
        if (chapterIndex[i].startOffset <= approxChar) {
          nextActive = i
          break
        }
      }
      setActiveChapter(nextActive)
    }
  }, [chapterIndex, fullText.length, readingMode])

  // ── Overall progress ──

  const overallProgress = readingMode === 'chapter' && chapterIndex
    ? (currentChapterIdx + scrollProgress) / Math.max(chapterIndex.length, 1)
    : scrollProgress

  // Ensure we save progress on unmount or mode change
  const latestProgressRef = useRef({ overallProgress, currentChapterIdx, scrollProgress, readingMode })
  useEffect(() => {
    latestProgressRef.current = { overallProgress, currentChapterIdx, scrollProgress, readingMode }
  }, [overallProgress, currentChapterIdx, scrollProgress, readingMode])

  useEffect(() => {
    const timer = setTimeout(() => {
      call('saveProgress', book.id, overallProgress, readingMode === 'chapter' ? currentChapterIdx : -1, scrollProgress)
    }, 500)
    return () => clearTimeout(timer)
  }, [overallProgress, currentChapterIdx, scrollProgress, readingMode, book.id, host])

  useEffect(() => {
    return () => {
      const state = latestProgressRef.current
      call('saveProgress', book.id, state.overallProgress, state.readingMode === 'chapter' ? state.currentChapterIdx : -1, state.scrollProgress)
    }
  }, [book.id, host])

  // ── Chapter navigation ──

  const handleChapterSelect = useCallback((ch: Chapter) => {
    const idx = ch.index - 1
    if (chapterIndex && idx >= 0 && idx < chapterIndex.length) {
      void loadChapterByIndex(chapterIndex, idx)
    }
    setShowChapters(false)
  }, [chapterIndex, loadChapterByIndex])

  // ── Boss key ──

  const handleBossKey = useCallback(() => {
    mulbyWindow.hide(true)
  }, [mulbyWindow])

  // ── Keyboard ──

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showChaptersRef.current) { if (e.key === 'Escape') setShowChapters(false); return }
      if (showSettingsRef.current) { if (e.key === 'Escape') setShowSettings(false); return }

      const el = containerRef.current
      if (!el) return
      const step = el.clientHeight * 0.8

      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); el.scrollBy({ top: step, behavior: 'smooth' }) }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); el.scrollBy({ top: -step, behavior: 'smooth' }) }
      if (readingMode === 'chapter' && chapterIndex) {
        if (e.key === 'ArrowRight' && currentChapterIdx < chapterIndex.length - 1) {
          e.preventDefault()
          handleChapterSelect({ index: currentChapterIdx + 2, title: '', charPosition: 0 })
        }
        if (e.key === 'ArrowLeft' && currentChapterIdx > 0) {
          e.preventDefault()
          handleChapterSelect({ index: currentChapterIdx, title: '', charPosition: 0 })
        }
      }
      if (e.key === 'Escape') handleBossKey()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleBossKey, handleChapterSelect, chapterIndex, currentChapterIdx, readingMode])

  const percentValue = overallProgress * 100
  const percentStr = percentValue.toFixed(1)

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-[var(--border)]"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
          <button
            className="p-1.5 rounded-lg hover:bg-[var(--border)] transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onClick={onBack}
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="flex-1 text-sm font-medium text-[var(--text-1)] truncate">{book.title}</h2>
        {hasChapters && chapters.length > 0 && (
          <button
            className="p-1.5 rounded-lg hover:bg-[var(--border)] transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="目录"
            onClick={() => setShowChapters(true)}
          >
            <List size={16} />
          </button>
        )}
        <span className="text-xs text-[var(--text-3)]">{percentStr}%</span>
      </div>

      {/* Indexing banner */}
      {isIndexing && (
        <div className="shrink-0 px-4 py-2 border-b border-[var(--border)] bg-[var(--accent)]/5">
          <div className="flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
            <span className="text-xs text-[var(--accent)]">
              正在建立目录 {Math.round(indexingProgress * 100)}%
            </span>
          </div>
          <p className="text-xs text-[var(--text-3)] mt-1">
            你可以先开始阅读，目录生成完成后会自动显示。
          </p>
        </div>
      )}

      {/* No chapters after indexing */}
      {indexingDone && !isIndexing && !hasChapters && (
        <div className="shrink-0 px-4 py-2 border-b border-[var(--border)] bg-[var(--accent)]/5">
          <p className="text-xs text-[var(--text-2)]">
            未识别到章节，将以全文模式阅读。
          </p>
        </div>
      )}

      {/* Reading area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-8 py-6 select-text relative"
        onScroll={handleScroll}
        style={{ userSelect: 'text' }}
      >
        {isLoadingText ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
              <p className="text-xs text-[var(--text-3)]">加载中...</p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="max-w-2xl mx-auto whitespace-pre-wrap break-words leading-relaxed"
              style={{
                fontSize: `${settings.fontSize}px`,
                lineHeight: settings.lineHeight,
                color: 'var(--text-1)',
              }}
            >
              {content || <span className="text-[var(--text-3)]">文件内容为空</span>}
            </div>

            <div className="max-w-2xl mx-auto mt-12 pb-8 text-center">
              {readingMode === 'chapter' && chapterIndex && currentChapterIdx < chapterIndex.length && (
                <p className="text-xs text-[var(--text-3)] mb-1">
                  {chapterIndex[currentChapterIdx].title}
                </p>
              )}
              <p className="text-xs text-[var(--text-3)]">
                {percentValue >= 99.9 ? '已读完' : `已阅读 ${percentStr}%`}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-t border-[var(--border)] bg-[var(--surface)]">
        <span className="text-xs text-[var(--text-3)] flex-1">
          {readingMode === 'chapter' && chapterIndex
            ? `${currentChapterIdx + 1}/${chapterIndex.length}章`
            : `进度 ${percentStr}%`}
        </span>
        
        {readingMode === 'chapter' && chapterIndex && (
          <div className="flex items-center justify-center gap-4 flex-1">
            <button 
              className="p-1.5 rounded hover:bg-[var(--border)] transition-colors text-[var(--text-2)] disabled:opacity-30 text-sm"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => handleChapterSelect({ index: currentChapterIdx, title: '', charPosition: 0 })}
              disabled={currentChapterIdx <= 0}
            >
              上一章
            </button>
            <button 
              className="p-1.5 rounded hover:bg-[var(--border)] transition-colors text-[var(--text-2)] disabled:opacity-30 text-sm"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onClick={() => handleChapterSelect({ index: currentChapterIdx + 2, title: '', charPosition: 0 })}
              disabled={currentChapterIdx >= chapterIndex.length - 1}
            >
              下一章
            </button>
          </div>
        )}
        {!readingMode || readingMode === 'full' || !chapterIndex ? <div className="flex-1" /> : null}

        <div className="flex items-center justify-end gap-2 flex-1">
          <button className="p-2 rounded-lg hover:bg-[var(--border)] transition-colors text-[var(--text-2)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="设置" onClick={() => setShowSettings(true)}>
            <Settings size={16} />
          </button>
          <button className="p-2 rounded-lg hover:bg-[var(--border)] transition-colors text-[var(--text-2)]" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} title="老板键 (Esc)" onClick={handleBossKey}>
            <EyeOff size={16} />
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel settings={settings} onChange={onSettingsChange} onClose={() => setShowSettings(false)} />
      )}

      {showChapters && (
        <ChapterPanel chapters={chapters} activeIndex={activeChapter} onSelect={handleChapterSelect} onClose={() => setShowChapters(false)} />
      )}
    </div>
  )
}
