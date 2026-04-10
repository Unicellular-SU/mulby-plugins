/**
 * 对齐辅助线渲染组件
 *
 * 在画布上用虚线显示水平和垂直对齐线
 * 使用 React Flow 的 viewport 变换将 flow 坐标映射到屏幕
 */
import { useViewport } from '@xyflow/react'
import type { HelperLine } from '../hooks/useHelperLines'

interface HelperLinesProps {
  lines: HelperLine[]
}

export default function HelperLines({ lines }: HelperLinesProps) {
  const { x: vpX, y: vpY, zoom } = useViewport()

  if (lines.length === 0) return null

  // 去重：同方向同位置只画一条线
  const uniqueLines = lines.filter(
    (line, i, arr) =>
      arr.findIndex(
        (l) => l.orientation === line.orientation && Math.abs(l.position - line.position) < 0.5
      ) === i
  )

  return (
    <svg
      className="helper-lines"
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      {uniqueLines.map((line, idx) => {
        if (line.orientation === 'vertical') {
          // 垂直线（x 固定）
          const screenX = line.position * zoom + vpX
          return (
            <line
              key={`v-${idx}`}
              x1={screenX} y1={0}
              x2={screenX} y2="100%"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          )
        } else {
          // 水平线（y 固定）
          const screenY = line.position * zoom + vpY
          return (
            <line
              key={`h-${idx}`}
              x1={0} y1={screenY}
              x2="100%" y2={screenY}
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.7}
            />
          )
        }
      })}
    </svg>
  )
}
