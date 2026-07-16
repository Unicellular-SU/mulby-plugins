import type { Annotation } from '../types'

type Pt = { x: number; y: number }

// 渲染单个标注；map 把世界坐标映射到目标坐标系（世界层=恒等；屏幕覆盖层=worldToScreen）
export function renderAnnotation(a: Annotation, map: (p: Pt) => Pt = (p) => p) {
  const pts = a.points.map(map)
  const sw = 2.5
  if (a.kind === 'pen') {
    return (
      <polyline
        key={a.id}
        points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
        fill="none"
        stroke={a.color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  if (a.kind === 'rect') {
    const s = pts[0]
    const e = pts[1] || pts[0]
    return (
      <rect
        key={a.id}
        x={Math.min(s.x, e.x)}
        y={Math.min(s.y, e.y)}
        width={Math.abs(e.x - s.x)}
        height={Math.abs(e.y - s.y)}
        fill="none"
        stroke={a.color}
        strokeWidth={sw}
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  if (a.kind === 'arrow') {
    const s = pts[0]
    const e = pts[1] || pts[0]
    const ang = Math.atan2(e.y - s.y, e.x - s.x)
    const HL = 14
    const a1 = ang + Math.PI - 0.4
    const a2 = ang + Math.PI + 0.4
    const head = `${e.x},${e.y} ${e.x + HL * Math.cos(a1)},${e.y + HL * Math.sin(a1)} ${e.x + HL * Math.cos(a2)},${e.y + HL * Math.sin(a2)}`
    return (
      <g key={a.id}>
        <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} stroke={a.color} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
        <polygon points={head} fill={a.color} />
      </g>
    )
  }
  if (a.kind === 'text') {
    const p = pts[0]
    return (
      <text key={a.id} x={p.x} y={p.y} fill={a.color} fontSize={16} style={{ userSelect: 'none' }}>
        {a.text}
      </text>
    )
  }
  return null
}

// 已提交标注层：置于世界层内（随平移缩放变换）
export function AnnotationLayer({ annotations }: { annotations: Annotation[] }) {
  if (!annotations || !annotations.length) return null
  return (
    <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
      {annotations.map((a) => renderAnnotation(a))}
    </svg>
  )
}
