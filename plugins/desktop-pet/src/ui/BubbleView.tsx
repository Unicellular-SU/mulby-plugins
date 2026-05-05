import { useEffect, useState, useRef } from 'react'

export default function BubbleView() {
  const [text, setText] = useState('')
  const [visible, setVisible] = useState(false)
  const [animating, setAnimating] = useState(false)
  const hideTimerRef = useRef<number>(0)

  useEffect(() => {
    const handler = (channel: string, ...args: any[]) => {
      if (channel === 'bubble-show' && args[0]) {
        setText(String(args[0]))
        setVisible(true)
        setAnimating(true)
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => {
          setAnimating(false)
          setTimeout(() => setVisible(false), 300)
        }, 5000)
      }
      if (channel === 'bubble-hide') {
        setAnimating(false)
        setTimeout(() => setVisible(false), 300)
      }
      if (channel === 'bubble-update' && args[0]) {
        setText(String(args[0]))
        if (!visible) {
          setVisible(true)
          setAnimating(true)
        }
        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => {
          setAnimating(false)
          setTimeout(() => setVisible(false), 300)
        }, 5000)
      }
    }
    window.mulby.window.onChildMessage(handler)
  }, [])

  if (!visible || !text) return null

  return (
    <div className={`bubble-container ${animating ? 'bubble-enter' : 'bubble-exit'}`}>
      <div className="bubble-box">
        <span className="bubble-text">{text}</span>
      </div>
      <div className="bubble-arrow" />
    </div>
  )
}
