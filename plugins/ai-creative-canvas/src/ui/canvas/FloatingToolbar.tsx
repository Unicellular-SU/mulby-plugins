import type { CSSProperties } from 'react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { MediaToolbox } from '../components/MediaToolbox'
import { worldToScreen } from './viewport'

const BAR_W = 360

// 选中单张媒体卡时，在卡上方居中浮出媒体工具条（裁剪/局部编辑/放大/去背/下载…）。
// 屏幕坐标浮层，跟随视口；空间不足翻到卡下方；左右夹取到舞台范围内。
export function FloatingToolbar() {
  const selectedIds = useGraph((s) => s.selectedIds)
  const board = useGraph((s) => s.getActiveBoard())
  const ss = useUi((s) => s.stageSize)

  if (selectedIds.length !== 1) return null
  const card = board.cards[selectedIds[0]]
  if (!card) return null
  const mime = card.mime || ''
  const isImg = (card.kind === 'image' || card.kind === 'source') && (mime.startsWith('image') || (!mime && !!card.assetUrl)) && !!card.assetUrl
  const isVid = card.kind === 'video' && !!card.assetLocalPath
  if (!isImg && !isVid) return null

  const vp = board.viewport
  const top = worldToScreen(card.x + card.w / 2, card.y, vp)
  const bottom = worldToScreen(card.x + card.w / 2, card.y + card.h, vp)
  const placeAbove = top.y - 8 >= 46
  const left = Math.max(8, Math.min(top.x - BAR_W / 2, ss.w - BAR_W - 8))
  const style: CSSProperties = placeAbove
    ? { left, bottom: Math.max(8, ss.h - (top.y - 8)), maxWidth: BAR_W }
    : { left, top: bottom.y + 8, maxWidth: BAR_W }

  return (
    <div
      data-interactive
      className="ace-glass ace-anim-scale absolute z-30 px-1.5 py-1"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <MediaToolbox card={card} />
    </div>
  )
}
