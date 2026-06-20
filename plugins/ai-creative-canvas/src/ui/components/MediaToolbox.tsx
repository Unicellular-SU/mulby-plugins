import { useState } from 'react'
import {
  Crop,
  Maximize2,
  Sparkles,
  Scissors,
  Grid2x2,
  Film,
  Images,
  Clapperboard,
  Music,
  VolumeX,
  Rewind,
  Minimize2
} from 'lucide-react'
import type { Card } from '../types'
import { runImageTool, runGridSlice, runVideoTool } from '../services/mediaOps'
import { CropModal } from './CropModal'

function ToolBtn({ onClick, icon: Icon, label }: { onClick: () => void; icon: typeof Crop; label: string }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 py-2 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-[11px]"
    >
      <Icon size={16} />
      <span>{label}</span>
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
    <div className="flex flex-col gap-1.5 border-t pt-2" style={{ borderColor: 'var(--ace-border)' }}>
      {isImg && (
        <>
          <span className="text-[11px] font-medium opacity-60">媒体工具（图像）</span>
          <div className="grid grid-cols-4 gap-1">
            <ToolBtn icon={Crop} label="裁剪" onClick={() => setCropping(true)} />
            <ToolBtn icon={Maximize2} label="扩图" onClick={() => runImageTool(card.id, 'outpaint')} />
            <ToolBtn icon={Sparkles} label="高清" onClick={() => runImageTool(card.id, 'upscale')} />
            <ToolBtn icon={Scissors} label="抠像" onClick={() => runImageTool(card.id, 'removebg')} />
          </div>
          <div className="grid grid-cols-3 gap-1">
            <ToolBtn icon={Grid2x2} label="宫格 2×2" onClick={() => runGridSlice(card.id, 2, 2)} />
            <ToolBtn icon={Grid2x2} label="宫格 3×3" onClick={() => runGridSlice(card.id, 3, 3)} />
            <ToolBtn icon={Grid2x2} label="分镜 1×3" onClick={() => runGridSlice(card.id, 1, 3)} />
          </div>
        </>
      )}

      {isVid && (
        <>
          <span className="text-[11px] font-medium opacity-60">媒体工具（视频 · FFmpeg）</span>
          <div className="grid grid-cols-4 gap-1">
            <ToolBtn icon={Film} label="转 GIF" onClick={() => runVideoTool(card.id, 'gif')} />
            <ToolBtn icon={Images} label="抽帧" onClick={() => runVideoTool(card.id, 'frames')} />
            <ToolBtn icon={Clapperboard} label="镜头" onClick={() => runVideoTool(card.id, 'scenes')} />
            <ToolBtn icon={Music} label="提音轨" onClick={() => runVideoTool(card.id, 'splitAudio')} />
            <ToolBtn icon={VolumeX} label="去音轨" onClick={() => runVideoTool(card.id, 'mute')} />
            <ToolBtn icon={Rewind} label="倒放" onClick={() => runVideoTool(card.id, 'reverse')} />
            <ToolBtn icon={Minimize2} label="压制" onClick={() => runVideoTool(card.id, 'compress')} />
          </div>
          <div className="flex items-end gap-1.5">
            <label className="flex flex-col text-[10px] opacity-60 gap-0.5">
              起(s)
              <input
                type="number"
                min={0}
                value={start}
                onChange={(e) => setStart(Math.max(0, Number(e.target.value) || 0))}
                className="ace-input w-14"
              />
            </label>
            <label className="flex flex-col text-[10px] opacity-60 gap-0.5">
              止(s)
              <input
                type="number"
                min={0}
                value={end}
                onChange={(e) => setEnd(Math.max(0, Number(e.target.value) || 0))}
                className="ace-input w-14"
              />
            </label>
            <button
              onClick={() => runVideoTool(card.id, 'clip', { start, end })}
              className="flex-1 py-1.5 rounded-md bg-pink-500 hover:bg-pink-600 text-white text-xs flex items-center justify-center gap-1"
            >
              <Scissors size={13} /> 裁剪片段
            </button>
          </div>
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
