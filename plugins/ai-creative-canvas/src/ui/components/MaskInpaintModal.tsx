import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { X, Loader2, Eraser, Brush, RotateCcw } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { inpaint, type InpaintOp } from '../services/inpaint'
import { loadImageInput } from '../services/media'

import { toast, type ToastType } from '../store/toastStore'
function notify(m: string, t?: string) {
  toast(m, (t as ToastType) || 'info')
}

export function MaskInpaintModal() {
  const cardId = useUi((s) => s.maskCardId)
  if (!cardId) return null
  return <Inner cardId={cardId} />
}

function Inner({ cardId }: { cardId: string }) {
  const card = useGraph((s) => s.getActiveBoard().cards[cardId])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const drawing = useRef(false)
  const painted = useRef(false)
  const [brush, setBrush] = useState(48)
  const [erase, setErase] = useState(false)
  const [op, setOp] = useState<InpaintOp>('repaint')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)

  if (!card || !card.assetUrl) {
    useUi.getState().setMaskCardId(null)
    return null
  }
  const close = () => {
    if (!busy) useUi.getState().setMaskCardId(null)
  }

  const onImgLoad = () => {
    const img = imgRef.current
    const cv = canvasRef.current
    if (!img || !cv) return
    cv.width = img.naturalWidth
    cv.height = img.naturalHeight
  }
  const paint = (e: RPointerEvent) => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const r = cv.getBoundingClientRect()
    const scale = cv.width / r.width
    const x = (e.clientX - r.left) * scale
    const y = (e.clientY - r.top) * scale
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    ctx.fillStyle = 'rgba(236,72,153,1)'
    ctx.beginPath()
    ctx.arc(x, y, (brush * scale) / 2, 0, Math.PI * 2)
    ctx.fill()
    if (!erase) painted.current = true
  }
  const down = (e: RPointerEvent) => {
    drawing.current = true
    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    paint(e)
  }
  const clear = () => {
    const cv = canvasRef.current
    cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height)
    painted.current = false
  }

  // 正确范式：把涂抹区在底图上挖透明洞(repaint) 或填绿(remove)，整图喂模型（比单独给黑白遮罩更可能被遵守）
  // 底图从字节解码（blob→ImageBitmap），避免 file:// 图片绘到 canvas 后 toDataURL 被 taint 抛错
  const buildComposite = async (): Promise<string | null> => {
    const cv = canvasRef.current
    if (!cv) return null
    const buf = await loadImageInput({ url: card.assetUrl!, localPath: card.assetLocalPath || undefined })
    if (!buf) return null
    const bmp = await createImageBitmap(new Blob([buf], { type: card.mime || 'image/png' }))
    const w = document.createElement('canvas')
    w.width = cv.width
    w.height = cv.height
    const wc = w.getContext('2d')
    if (!wc) {
      bmp.close?.()
      return null
    }
    wc.drawImage(bmp, 0, 0, w.width, w.height)
    wc.globalCompositeOperation = 'destination-out'
    wc.drawImage(cv, 0, 0)
    wc.globalCompositeOperation = 'source-over'
    bmp.close?.()
    if (op === 'repaint') return w.toDataURL('image/png')
    // remove：把透明洞填成纯绿（绿幕），让模型据此移除并补背景
    const gcv = document.createElement('canvas')
    gcv.width = cv.width
    gcv.height = cv.height
    const gc = gcv.getContext('2d')
    if (!gc) return null
    gc.fillStyle = '#00ff00'
    gc.fillRect(0, 0, gcv.width, gcv.height)
    gc.drawImage(w, 0, 0)
    return gcv.toDataURL('image/png')
  }

  const run = async () => {
    if (!painted.current) {
      notify('请先涂抹要修改的区域', 'error')
      return
    }
    if (op === 'repaint' && !prompt.trim()) {
      notify('请描述要在涂抹区域生成什么', 'error')
      return
    }
    const composite = await buildComposite()
    if (!composite) return
    setBusy(true)
    try {
      await inpaint(cardId, op, composite, prompt.trim())
      notify(op === 'remove' ? '已擦除，结果落为新卡' : '局部重绘完成，结果落为新卡', 'success')
      useUi.getState().setMaskCardId(null)
    } catch (e: any) {
      notify('处理失败：' + (e?.message || String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  const ic = 'h-8 px-2 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10'

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6" onClick={close}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale max-w-[640px] max-h-[92vh] flex flex-col text-neutral-800 dark:text-neutral-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Brush size={16} className="text-indigo-500" /> 局部编辑（实验）
          </div>
          <button onClick={close} className="opacity-60 hover:opacity-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-3 flex flex-col gap-3 overflow-auto ace-noscroll">
          <div className="relative inline-block max-w-full" style={{ touchAction: 'none' }}>
            <img ref={imgRef} src={card.assetUrl} onLoad={onImgLoad} draggable={false} className="block max-w-full max-h-[58vh] rounded" alt="" />
            <canvas
              ref={canvasRef}
              onPointerDown={down}
              onPointerMove={(e) => drawing.current && paint(e)}
              onPointerUp={() => (drawing.current = false)}
              onPointerLeave={() => (drawing.current = false)}
              className="absolute inset-0 w-full h-full cursor-crosshair rounded"
              style={{ opacity: 0.5 }}
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <button onClick={() => setOp('repaint')} className={`px-2.5 py-1 rounded-md ${op === 'repaint' ? 'bg-indigo-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>
              重绘
            </button>
            <button onClick={() => setOp('remove')} className={`px-2.5 py-1 rounded-md ${op === 'remove' ? 'bg-indigo-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>
              擦除移除
            </button>
            <span className="opacity-50 ml-1">{op === 'remove' ? '涂抹要移除的物体（挖空填绿）' : '涂抹要重绘的区域（挖透明洞）并描述内容'}</span>
          </div>

          <div className="flex items-center gap-2 text-sm flex-wrap">
            <button onClick={() => setErase(false)} className={`${ic} ${!erase ? 'text-indigo-500' : ''}`} title="涂抹">
              <Brush size={15} />
            </button>
            <button onClick={() => setErase(true)} className={`${ic} ${erase ? 'text-indigo-500' : ''}`} title="擦除">
              <Eraser size={15} />
            </button>
            <button onClick={clear} className={ic} title="清空">
              <RotateCcw size={15} />
            </button>
            <span className="text-xs opacity-60">笔刷</span>
            <input type="range" min={8} max={140} value={brush} onChange={(e) => setBrush(Number(e.target.value))} className="w-28" />
          </div>

          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={op === 'remove' ? '可选：补充背景填补描述（留空也可）' : '在涂抹区域生成什么（如：戴上墨镜 / 换成红色裙子）'}
            className="ace-input w-full"
          />
          <div className="text-[11px] opacity-50">提示：涂抹要改动的区域。重绘＝挖透明洞按描述补画；擦除＝填绿移除物体。结果会落为一张新卡片（不覆盖原图）。</div>

          <button onClick={run} disabled={busy} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-60">
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> {op === 'remove' ? '擦除中…' : '重绘中…'}
              </>
            ) : (
              <>
                <Brush size={15} /> {op === 'remove' ? '擦除涂抹区域' : '重绘涂抹区域'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
