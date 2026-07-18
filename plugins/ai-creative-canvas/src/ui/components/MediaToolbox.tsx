import { useState } from 'react'
import { Crop, Maximize2, Sparkles, Scissors, Grid2x2, Film, Images, Clapperboard, Music, VolumeX, Rewind, Minimize2, Brush, Download, Wand2, Compass, GitMerge, ArrowUpDown, SlidersHorizontal } from 'lucide-react'
import type { Card } from '../types'
import { runImageTool, runGridSlice, runVideoTool } from '../services/mediaOps'
import { repairEquirectSeam } from '../services/mediaPano'
import { repairEquirectPoles } from '../services/panoOutpaint'
import { generateCard, canGenerate } from '../services/generate'
import { useUi } from '../store/uiStore'
import { saveToLocal } from '../services/saveLocal'
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
  const isPano = card.kind === 'pano'
  const isImg = (card.kind === 'image' || card.kind === 'pano' || card.kind === 'source') && (mime.startsWith('image') || (!mime && !!card.assetUrl))
  const isVid = card.kind === 'video' && !!card.assetLocalPath
  if (!isImg && !isVid) return null

  const download = () => saveToLocal(card.assetLocalPath, card.title)

  return (
    <div className="flex items-center gap-0.5 max-w-[92vw] overflow-x-auto ace-noscroll">{/* 单行横向滚动，不再 wrap 成多排挤压卡片 */}
      {isImg && (
        <>
          {canGenerate(card.kind) && <IconBtn icon={Wand2} title="重新生成" onClick={() => void generateCard(card.id)} />}
          {isPano && (
            <IconBtn
              icon={Compass}
              title="360 预览（节点内拖动环视，可截图；再点退出）"
              onClick={() => { const s = useUi.getState(); s.setPanoCardId(s.panoCardId === card.id ? null : card.id) }}
            />
          )}
          {isPano && <IconBtn icon={GitMerge} title="修复接缝（实验·偏移+重绘，效果依赖模型，可能需多次）" onClick={() => void repairEquirectSeam(card.id)} />}
          {isPano && <IconBtn icon={ArrowUpDown} title="天/地修复（实验·锚定重绘天花板/地板，效果依赖模型，可能需多次）" onClick={() => void repairEquirectPoles(card.id)} />}
          {/* 裁剪/扩图/宫格/抠像/局部编辑会破坏等距柱状 2:1 投影，全景卡不提供 */}
          {!isPano && <IconBtn icon={Crop} title="裁剪" onClick={() => setCropping(true)} />}
          {!isPano && <IconBtn icon={Brush} title="局部编辑（重绘/擦除）" onClick={() => useUi.getState().setMaskCardId(card.id)} />}
          {!isPano && <IconBtn icon={Maximize2} title="扩图" onClick={() => runImageTool(card.id, 'outpaint')} />}
          <IconBtn icon={Sparkles} title="高清放大" onClick={() => runImageTool(card.id, 'upscale')} />
          {!isPano && <IconBtn icon={Scissors} title="抠像/去背景" onClick={() => runImageTool(card.id, 'removebg')} />}
          {!isPano && <IconBtn icon={Grid2x2} title="宫格 2×2" onClick={() => runGridSlice(card.id, 2, 2)} />}
          {!isPano && <IconBtn icon={Grid2x2} title="宫格 3×3" onClick={() => runGridSlice(card.id, 3, 3)} />}
          <IconBtn icon={Download} title="下载" onClick={() => void download()} />
        </>
      )}
      {isVid && (
        <>
          <button
            onClick={() => useUi.getState().setStudioCardId(card.id)}
            title="剪辑工作台（裁切/变速/调色/叠加/导出，非破坏式）"
            className="shrink-0 h-7 px-2 flex items-center gap-1 rounded-md bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25 text-[11px] font-medium"
          >
            <SlidersHorizontal size={13} /> 工作台
          </button>
          <IconBtn icon={Scissors} title="快速裁剪片段（可视化时间轴）" onClick={() => useUi.getState().setTrimCardId(card.id)} />
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
