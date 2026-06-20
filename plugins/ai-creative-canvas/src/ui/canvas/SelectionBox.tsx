export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

export function SelectionBox({ rect }: { rect: ScreenRect | null }) {
  if (!rect) return null
  return (
    <div
      className="absolute pointer-events-none rounded-sm"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        background: 'rgba(99,102,241,0.12)',
        border: '1px solid rgba(99,102,241,0.8)'
      }}
    />
  )
}
