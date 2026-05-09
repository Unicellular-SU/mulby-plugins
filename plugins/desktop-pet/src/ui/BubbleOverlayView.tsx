import { useState, useEffect } from 'react'

const MAX_REPLY_LEN = 2000
const MAX_REASONING_LEN = 4000

export default function BubbleOverlayView() {
  const [reply, setReply] = useState('')
  const [reasoning, setReasoning] = useState('')

  useEffect(() => {
    window.mulby.window.onChildMessage((channel: string, ...args: any[]) => {
      if (channel !== 'bubble-update' || args[0] == null) return
      const raw = args[0]
      if (typeof raw === 'string') {
        setReply(raw.slice(0, MAX_REPLY_LEN))
        setReasoning('')
        return
      }
      if (raw && typeof raw === 'object' && typeof raw.reply === 'string') {
        setReply(raw.reply.slice(0, MAX_REPLY_LEN))
        setReasoning(typeof raw.reasoning === 'string' ? raw.reasoning.slice(0, MAX_REASONING_LEN) : '')
      }
    })
  }, [])

  if (!reply && !reasoning) return null

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
      <div className="bubble-container bubble-enter">
        <div className="bubble-box" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
          {reasoning ? (
            <div className="bubble-reasoning">
              {reasoning}
            </div>
          ) : null}
          {reply ? <span className="bubble-text">{reply}</span> : null}
        </div>
        <div className="bubble-arrow" />
      </div>
    </div>
  )
}
