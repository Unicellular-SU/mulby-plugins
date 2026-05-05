import { useEffect, useState, useRef } from 'react'

export default function BubbleView() {
  const [text, setText] = useState('')
  const [animClass, setAnimClass] = useState('')
  const [visible, setVisible] = useState(false)
  const hideTimerRef = useRef<number>(0)

  useEffect(() => {
    window.mulby.window.onChildMessage((channel: string, ...args: any[]) => {
      if (channel === 'bubble-show' && args[0]) {
        const msg = String(args[0])
        setText(msg)
        setVisible(true)
        setAnimClass('bubble-enter')

        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => {
          setAnimClass('bubble-exit')
          setTimeout(() => setVisible(false), 300)
        }, 4000)
      }
      if (channel === 'bubble-hide') {
        setAnimClass('bubble-exit')
        setTimeout(() => setVisible(false), 300)
      }
      if (channel === 'bubble-update' && args[0]) {
        setText(String(args[0]))
        if (!visible) {
          setVisible(true)
          setAnimClass('bubble-enter')
        }

        clearTimeout(hideTimerRef.current)
        hideTimerRef.current = window.setTimeout(() => {
          setAnimClass('bubble-exit')
          setTimeout(() => setVisible(false), 300)
        }, 4000)
      }
    })
  }, [])

  if (!visible || !text) return null

  return (
    <div className={`bubble-wrap ${animClass}`}>
      <div className="bubble-content">{text}</div>
      <div className="bubble-tail" />
    </div>
  )
}
