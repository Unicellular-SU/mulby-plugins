import type { Viewport } from '../types'

export function GridLayer({ viewport }: { viewport: Viewport }) {
  // 固定屏幕间距：缩放不改变圆点疏密，仅随平移移动
  const size = 24
  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        backgroundImage: 'radial-gradient(circle, var(--ace-dot) 1px, transparent 1px)',
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`
      }}
    />
  )
}
