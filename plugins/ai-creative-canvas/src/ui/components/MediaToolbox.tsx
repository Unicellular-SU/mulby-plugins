import { useState } from 'react'
import { Crop, Maximize2, Sparkles, Scissors, Grid2x2, Film, Images, Clapperboard, Music, VolumeX, Rewind, Minimize2, Brush, Download, Wand2, Compass } from 'lucide-react'
import type { Card } from '../types'
import { runImageTool, runGridSlice, runVideoTool } from '../services/mediaOps'
import { generateCard, canGenerate } from '../services/generate'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
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

  const mime = card.mime || ''
  const isImg = (card.kind === 'image' || card.kind === 'source') && (mime.startsWith('image') || (!mime && !!card.assetUrl))
  const isVid = card.kind === 'video' && !!card.assetLocalPath
  if (!isImg && !isVid) return null

  const download = async () => {
    const m = (window as any).mulby
    const path = card.assetLocalPath
    if (!m?.dialog || !path) {
      toast('无可下载文件', 'error')
      return
    }
    const ext = path.split('.').pop() || 'png'
    try {
      const dest = await m.dialog.showSaveDialog({ defaultPath: `${card.title}.${ext}`, filters: [{ name: '文件', extensions: [ext] }] })
      if (dest) {
        await m.filesystem.copy(path, dest)
        toast('已导出：' + dest, 'success')
      }
    } catch {
      toast('导出失败', 'error')
    }
  }

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto ace-noscroll">
      {isImg && (
        <>
          {canGenerate(card.kind) && <IconBtn icon={Wand2} title="重新生成" onClick={() => void generateCard(card.id)} />}
          {(card.meta as any)?.pano && <IconBtn icon={Compass} title="360 环视" onClick={() => useUi.getState().setPanoCardId(card.id)} />}
          <IconBtn icon={Crop} title="裁剪" onClick={() => setCropping(true)} />
          <IconBtn icon={Brush} title="局部编辑（重绘/擦除）" onClick={() => useUi.getState().setMaskCardId(card.id)} />
          <IconBtn icon={Maximize2} title="扩图" onClick={() => runImageTool(card.id, 'outpaint')} />
          <IconBtn icon={Sparkles} title="高清放大" onClick={() => runImageTool(card.id, 'upscale')} />
          <IconBtn icon={Scissors} title="抠像/去背景" onClick={() => runImageTool(card.id, 'removebg')} />
          <IconBtn icon={Grid2x2} title="宫格 2×2" onClick={() => runGridSlice(card.id, 2, 2)} />
          <IconBtn icon={Grid2x2} title="宫格 3×3" onClick={() => runGridSlice(card.id, 3, 3)} />
          <IconBtn icon={Download} title="下载" onClick={() => void download()} />
        </>
      )}
      {isVid && (
        <>
          <IconBtn icon={Scissors} title="裁剪片段（可视化时间轴）" onClick={() => useUi.getState().setTrimCardId(card.id)} />
          <IconBtn icon={Film} title="转 GIF" onClick={() => runVideoTool(card.id, 'gif')} />
          <IconBtn icon={Images} title="抽帧" onClick={() => runVideoTool(card.id, 'frames')} />
          <IconBtn icon={Clapperboard} title="镜头检测" onClick={() => runVideoTool(card.id, 'scenes')} />
          <IconBtn icon={Music} title="提取音轨" onClick={() => runVideoTool(card.id, 'splitAudio')} />
          <IconBtn icon={VolumeX} title="去音轨" onClick={() => runVideoTool(card.id, 'mute')} />
          <IconBtn icon={Rewind} title="倒放" onClick={() => runVideoTool(card.id, 'reverse')} />
          <IconBtn icon={Minimize2} title="压制" onClick={() => runVideoTool(card.id, 'compress')} />
          <IconBtn icon={Wand2} title="绿幕抠像（去绿背景）" onClick={() => runVideoTool(card.id, 'chromakey')} />
          <IconBtn icon={Download} title="下载" onClick={() => void download()} />
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
