import { memo } from 'react'
import { KIND_ACCENT, type Card } from '../types'

// 低缩放（LOD）占位卡：仅渲染按 kind 着色的轻量色块，省去 img/video/文本/事件富层。
// 保留 data-card-id，故仍可框选/拖动/右键/双击（命中走事件委托）。缩放到一定程度才换回完整 CardView。
export const CardPlaceholder = memo(function CardPlaceholder({ card, selected }: { card: Card; selected: boolean }) {
  const accent = KIND_ACCENT[card.kind]
  return (
    <div
      data-card-id={card.id}
      className={`ace-card absolute rounded-lg ${selected ? 'ring-2 z-10' : ''}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        background: accent + '22',
        border: `1px solid ${accent}66`,
        ['--tw-ring-color' as any]: accent
      }}
    />
  )
})
