import { useEffect, useState, useRef } from 'react'

const MAX_TEXT_LEN = 2000

export default function BubbleView() {
  const [text, setText] = useState('')
  const [visible, setVisible] = useState(false)
  const [animating, setAnimating] = useState(false)
  const hideTimerRef = useRef<number>(0)
  const fadeTimerRef = useRef<number>(0)

  useEffect(() => {
    const sched = (next: string | null) => {
      clearTimeout(hideTimerRef.current)
      clearTimeout(fadeTimerRef.current)
      if (next == null) {
        setAnimating(false)
        fadeTimerRef.current = window.setTimeout(() => setVisible(false), 300)
        return
      }
      setText(next.slice(0, MAX_TEXT_LEN))
      setVisible(true)
      setAnimating(true)
      hideTimerRef.current = window.setTimeout(() => {
        setAnimating(false)
        fadeTimerRef.current = window.setTimeout(() => setVisible(false), 300)
      }, 5000)
    }

    const handler = (channel: string, ...args: any[]) => {
      if (channel === 'bubble-show' || channel === 'bubble-update') {
        if (args[0] == null) return
        sched(typeof args[0] === 'string' ? args[0] : String(args[0]))
        return
      }
      if (channel === 'bubble-hide') {
        sched(null)
      }
    }
    window.mulby.window.onChildMessage(handler)
    return () => {
      clearTimeout(hideTimerRef.current)
      clearTimeout(fadeTimerRef.current)
    }
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
