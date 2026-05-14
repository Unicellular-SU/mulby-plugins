import { useState, useEffect, useRef } from 'react'
import { buildBubblePreviewState, normalizeBubbleStreamPayload, type BubblePreviewState } from './engine/bubble-stream'

const MAX_REPLY_LEN = 2000

export default function BubbleOverlayView() {
  const [preview, setPreview] = useState<BubblePreviewState>(() => buildBubblePreviewState({ reply: '', reasoning: '' }))
  const bubbleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    window.mulby.window.onChildMessage((channel: string, ...args: any[]) => {
      if (channel !== 'bubble-update' || args[0] == null) return
      const normalized = normalizeBubbleStreamPayload(args[0])
      setPreview(buildBubblePreviewState({
        reply: normalized.reply.slice(0, MAX_REPLY_LEN),
        reasoning: normalized.reasoning,
      }))
    })
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const el = bubbleRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const width = Math.ceil(Math.max(rect.width, el.scrollWidth))
      const height = Math.ceil(Math.max(rect.height, el.scrollHeight))
      window.mulby.window.sendToParent('bubble-measured', { width, height })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [preview])

  if (!preview.reply && !preview.hasReasoning) return null

  const openDetail = () => {
    if (!preview.hasReasoning) return
    window.mulby.window.sendToParent('bubble-detail-open')
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: '4px',
      background: 'transparent',
    }}>
      <button
        ref={bubbleRef}
        type="button"
        className={`bubble-container bubble-enter bubble-preview-button ${preview.hasReasoning ? 'is-clickable' : ''}`}
        onClick={openDetail}
        title={preview.hasReasoning ? '查看完整思考过程' : undefined}
      >
        <div className="bubble-box bubble-preview-box">
          {preview.hasReasoning ? (
            <div className="bubble-reasoning-summary">
              <span>{preview.statusLabel}</span>
              <span>{preview.reasoningChars} 字</span>
            </div>
          ) : null}
          {preview.reasoningPreview ? <div className="bubble-reasoning-preview">{preview.reasoningPreview}</div> : null}
          {preview.reply ? <span className="bubble-text">{preview.reply}</span> : null}
          {preview.hasReasoning ? <span className="bubble-detail-hint">点击查看完整思考</span> : null}
        </div>
        <div className="bubble-arrow" />
      </button>
    </div>
  )
}
