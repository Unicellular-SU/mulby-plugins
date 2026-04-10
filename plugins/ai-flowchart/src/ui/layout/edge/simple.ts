/**
 * 简单路径：两个节点距离很近或直接连接时使用
 * 参考: idootop/reactflow-auto-layout/src/layout/edge/algorithms/simple.ts
 */
import { uid, type ControlPoint, isInLine, isOnLine } from './point'

interface SimplePathParams {
  isDirectConnect?: boolean
  source: ControlPoint
  target: ControlPoint
  sourceOffset: ControlPoint
  targetOffset: ControlPoint
}

function lineDir(start: ControlPoint, end: ControlPoint): 'vertical' | 'horizontal' {
  return start.x === end.x ? 'vertical' : 'horizontal'
}

/**
 * 简单路径：生成 sourceOffset→...→targetOffset 之间的控制点
 */
export function getSimplePath({
  isDirectConnect,
  source,
  target,
  sourceOffset,
  targetOffset,
}: SimplePathParams): ControlPoint[] {
  const srcDir = lineDir(source, sourceOffset)
  const isH = srcDir === 'horizontal'
  const tgtDir = lineDir(target, targetOffset)

  if (isDirectConnect) {
    if (isH) {
      if (sourceOffset.x <= targetOffset.x) {
        const cx = (sourceOffset.x + targetOffset.x) / 2
        return [
          { id: uid(), x: cx, y: sourceOffset.y },
          { id: uid(), x: cx, y: targetOffset.y },
        ]
      } else {
        const cy = (sourceOffset.y + targetOffset.y) / 2
        return [
          sourceOffset,
          { id: uid(), x: sourceOffset.x, y: cy },
          { id: uid(), x: targetOffset.x, y: cy },
          targetOffset,
        ]
      }
    } else {
      if (sourceOffset.y <= targetOffset.y) {
        const cy = (sourceOffset.y + targetOffset.y) / 2
        return [
          { id: uid(), x: sourceOffset.x, y: cy },
          { id: uid(), x: targetOffset.x, y: cy },
        ]
      } else {
        const cx = (sourceOffset.x + targetOffset.x) / 2
        return [
          sourceOffset,
          { id: uid(), x: cx, y: sourceOffset.y },
          { id: uid(), x: cx, y: targetOffset.y },
          targetOffset,
        ]
      }
    }
  }

  const points: ControlPoint[] = []

  if (srcDir === tgtDir) {
    // 同方向：增加两个中间点
    if (source.y === sourceOffset.y) {
      const midY = (sourceOffset.y + targetOffset.y) / 2
      points.push({ id: uid(), x: sourceOffset.x, y: midY })
      points.push({ id: uid(), x: targetOffset.x, y: midY })
    } else {
      const midX = (sourceOffset.x + targetOffset.x) / 2
      points.push({ id: uid(), x: midX, y: sourceOffset.y })
      points.push({ id: uid(), x: midX, y: targetOffset.y })
    }
  } else {
    // 不同方向：增加一个拐点
    let point = { id: uid(), x: sourceOffset.x, y: targetOffset.y }
    const inS = isInLine(point, source, sourceOffset)
    const inE = isInLine(point, target, targetOffset)
    if (inS || inE) {
      point = { id: uid(), x: targetOffset.x, y: sourceOffset.y }
    } else {
      const onS = isOnLine(point, source, sourceOffset)
      const onE = isOnLine(point, target, targetOffset)
      if (onS && onE) {
        point = { id: uid(), x: targetOffset.x, y: sourceOffset.y }
      }
    }
    points.push(point)
  }

  return [sourceOffset, ...points, targetOffset]
}
