import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { worldToScreen } from './viewport'

// 拖动时的对齐参考线（屏幕坐标覆盖层）
export function GuideLayer() {
  const guides = useUi((s) => s.guides)
  const ss = useUi((s) => s.stageSize)
  const vp = useGraph((s) => s.getActiveBoard().viewport)
  if (!guides || (guides.vx.length === 0 && guides.hy.length === 0)) return null
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
      {guides.vx.map((x, i) => {
        const sx = worldToScreen(x, 0, vp).x
        return <line key={'v' + i} x1={sx} y1={0} x2={sx} y2={ss.h} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
      })}
      {guides.hy.map((y, i) => {
        const sy = worldToScreen(0, y, vp).y
        return <line key={'h' + i} x1={0} y1={sy} x2={ss.w} y2={sy} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 3" opacity={0.85} />
      })}
    </svg>
  )
}
