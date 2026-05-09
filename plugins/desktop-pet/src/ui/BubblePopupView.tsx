import { useEffect, useMemo } from 'react'

const MAX_POPUP_LEN = 2000

export default function BubblePopupView() {
  const text = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('text') || ''
    let decoded = raw
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      decoded = raw
    }
    return decoded.slice(0, MAX_POPUP_LEN)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      window.mulby.window.close()
    }, 8000)
    return () => clearTimeout(timer)
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
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}>
        <div className="bubble-box">
          <span className="bubble-text" style={{ WebkitLineClamp: 8 }}>{text}</span>
        </div>
        <div className="bubble-arrow" />
      </div>
    </div>
  )
}
