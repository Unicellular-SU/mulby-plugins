import { useState } from 'react'
import { Crop, Maximize2, Sparkles, Scissors, Grid2x2, Film, Images, Clapperboard, Music, VolumeX, Rewind, Minimize2 } from 'lucide-react'
import type { Card } from '../types'
import { runImageTool, runGridSlice, runVideoTool } from '../services/mediaOps'
import { CropModal } from './CropModal'

function IconBtn({ onClick, icon: Icon, title }: { onClick: () => void; icon: typeof Crop; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="shrink-0 w-7 h-7 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10"
    >
      <Icon size={15} />
    </button>
  )
}

export function MediaToolbox({ card }: { card: Card }) {
  const [cropping, setCropping] = useState(false)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(5)

  const mime = card.mime || ''
  const isImg = (card.kind === 'image' || card.kind === 'source') && (mime.startsWith('image') || (!mime && !!card.assetUrl))
  const isVid = card.kind === 'video' && !!card.assetLocalPath
  if (!isImg && !isVid) return null

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto ace-noscroll border-t pt-1.5" style={{ borderColor: 'var(--ace-border)' }}>
      {isImg && (
        <>
          <IconBtn icon={Crop} title="裁剪" onClick={() => setCropping(true)} />
          <IconBtn icon={Maximize2} title="扩图" onClick={() => runImageTool(card.id, 'outpaint')} />
          <IconBtn icon={Sparkles} title="高清放大" onClick={() => runImageTool(card.id, 'upscale')} />
          <IconBtn icon={Scissors} title="抠像/去背景" onClick={() => runImageTool(card.id, 'removebg')} />
          <IconBtn icon={Grid2x2} title="宫格 2×2" onClick={() => runGridSlice(card.id, 2, 2)} />
          <IconBtn icon={Grid2x2} title="宫格 3×3" onClick={() => runGridSlice(card.id, 3, 3)} />
        </>
      )}
      {isVid && (
        <>
          <input
            type="number"
            value={start}
            title="起始秒"
            onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
            className="ace-input w-11 shrink-0 py-0.5"
          />
          <input
            type="number"
            value={end}
            title="结束秒"
            onChange={(e) => setEnd(Math.max(0, Number(e.target.value) || 0))}
            className="ace-input w-11 shrink-0 py-0.5"
          />
          <IconBtn icon={Scissors} title="裁剪片段" onClick={() => runVideoTool(card.id, 'clip', { start, end })} />
          <IconBtn icon={Film} title="转 GIF" onClick={() => runVideoTool(card.id, 'gif')} />
          <IconBtn icon={Images} title="抽帧" onClick={() => runVideoTool(card.id, 'frames')} />
          <IconBtn icon={Clapperboard} title="镜头检测" onClick={() => runVideoTool(card.id, 'scenes')} />
          <IconBtn icon={Music} title="提取音轨" onClick={() => runVideoTool(card.id, 'splitAudio')} />
          <IconBtn icon={VolumeX} title="去音轨" onClick={() => runVideoTool(card.id, 'mute')} />
          <IconBtn icon={Rewind} title="倒放" onClick={() => runVideoTool(card.id, 'reverse')} />
          <IconBtn icon={Minimize2} title="压制" onClick={() => runVideoTool(card.id, 'compress')} />
        </>
      )}
      {cropping && (
        <CropModal
          card={card}
          onCancel={() => setCropping(false)}
          onConfirm={(rect) => {
            setCropping(false)
            void runImageTool(card.id, 'crop', { rect })
          }}
        />
      )}
    </div>
  )
}
