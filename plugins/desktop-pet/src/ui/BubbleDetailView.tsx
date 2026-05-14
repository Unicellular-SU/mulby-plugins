import { useEffect, useRef, useState } from 'react'
import {
  buildBubbleDetailState,
  normalizeBubbleStreamPayload,
  PET_CURRENT_BUBBLE_STORAGE_KEY,
  type BubbleDetailState,
} from './engine/bubble-stream'

export default function BubbleDetailView() {
  const [detail, setDetail] = useState<BubbleDetailState>(() => buildBubbleDetailState({ reply: '', reasoning: '' }))
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)
  const closedNotifiedRef = useRef(false)

  const notifyClosed = () => {
    if (closedNotifiedRef.current) return
    closedNotifiedRef.current = true
    window.mulby.window.sendToParent('bubble-detail-closed')
  }

  useEffect(() => {
    let disposed = false
    ;(async () => {
      try {
        const saved = await window.mulby.storage.get(PET_CURRENT_BUBBLE_STORAGE_KEY)
        if (disposed) return
        setDetail(buildBubbleDetailState(normalizeBubbleStreamPayload(saved as any)))
      } catch {
        // Storage is only a bootstrap path; live messages still update the window.
      }
    })()

    window.mulby.window.onChildMessage((channel: string, ...args: any[]) => {
      if (channel !== 'bubble-detail-update') return
      setDetail(buildBubbleDetailState(normalizeBubbleStreamPayload(args[0] as any)))
    })
    window.mulby.window.sendToParent('bubble-detail-ready')
    window.addEventListener('beforeunload', notifyClosed)

    return () => {
      disposed = true
      window.removeEventListener('beforeunload', notifyClosed)
      notifyClosed()
    }
  }, [])

  useEffect(() => {
    if (!autoScrollRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [detail.reasoning, detail.reply])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  return (
    <div className="bubble-detail-shell">
      <header className="bubble-detail-header">
        <div>
          <h1>宠物思考</h1>
          <p>{detail.reasoningChars > 0 ? `${detail.reasoningChars} 字推理过程` : '等待推理内容'}</p>
        </div>
        <button
          type="button"
          className="bubble-detail-close"
          onClick={() => {
            notifyClosed()
            window.mulby.window.close()
          }}
        >
          关闭
        </button>
      </header>

      <main ref={scrollRef} className="bubble-detail-scroll" onScroll={onScroll}>
        <section className="bubble-detail-section">
          <div className="bubble-detail-label">思考过程</div>
          <div className="bubble-detail-reasoning">
            {detail.reasoning || '本轮暂时没有推理内容。'}
          </div>
        </section>
      </main>

      <footer className="bubble-detail-reply">
        <div className="bubble-detail-label">最终回复</div>
        <div className="bubble-detail-reply-text">
          {detail.reply || '正在等待回复...'}
        </div>
      </footer>
    </div>
  )
}
