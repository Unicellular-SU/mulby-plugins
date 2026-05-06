import { useState, useRef, useEffect } from 'react'

export default function ChatInputView() {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    window.mulby.window.sendToParent('chat-message', trimmed)
    window.mulby.window.close()
  }

  const close = () => {
    window.mulby.window.sendToParent('chat-closed', true)
    window.mulby.window.close()
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '8px',
      gap: '4px',
    }}>
      <input
        ref={inputRef}
        className="pet-chat-input"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') send()
          if (e.key === 'Escape') close()
        }}
        placeholder="和宠物说点什么..."
        maxLength={200}
        style={{ flex: 1 }}
      />
      <button
        onClick={close}
        style={{
          width: '24px',
          height: '24px',
          border: '1px solid rgba(167, 139, 250, 0.3)',
          borderRadius: '50%',
          background: 'rgba(20, 20, 40, 0.9)',
          color: 'rgba(240, 238, 246, 0.6)',
          fontSize: '12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
