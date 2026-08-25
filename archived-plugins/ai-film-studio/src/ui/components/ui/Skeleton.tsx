/**
 * 骨架屏 Skeleton —— 加载占位（shimmer 扫光）。纯展示；count>1 渲染多块（网格/列表占位）。
 * 规格 docs §5.2；样式见 styles.css「Skeleton」。prefers-reduced-motion 下停扫光。
 */
import type { CSSProperties } from 'react'

export interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  count?: number
  className?: string
}

export default function Skeleton({ width, height = 16, radius, count = 1, className }: SkeletonProps) {
  const style: CSSProperties = { width: width ?? '100%', height, borderRadius: radius }
  const cls = `afs-skeleton${className ? ' ' + className : ''}`
  if (count <= 1) return <span className={cls} style={style} aria-hidden />
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cls} style={style} aria-hidden />
      ))}
    </>
  )
}
