import { useState, useEffect } from 'react'

export default function BubbleOverlayView() {
  const [text, setText] = useState('')

  useEffect(() => {
    window.mulby.window.onChildMessage((channel: string, ...args: any[]) => {
      if (channel === 'bubble-update' && args[0]) {
        setText(typeof args[0] === 'string' ? args[0] : '')
      }
    })
  }, [])

  if (!text) return null

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: '4px',
      background: 'rgba(255, 100, 100, 0.3)',
    }}>
      <div className="bubble-container bubble-enter">
        <div className="bubble-box">
          <span className="bubble-text">{text}</span>
        </div>
        <div className="bubble-arrow" />
      </div>
    </div>
  )
}
