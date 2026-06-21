import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { X, Loader2, Eraser, Brush, RotateCcw } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { inpaint } from '../services/inpaint'

function notify(m: string, t?: string) {
  ;(window as any).mulby?.notification?.show?.(m, t)
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
  const [brush, setBrush] = useState(48)
  const [erase, setErase] = useState(false)
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
  }

  // 黑白遮罩：涂抹处白、其余黑
  const buildMask = (): string | null => {
    const cv = canvasRef.current
    if (!cv) return null
    const w = document.createElement('canvas')
    w.width = cv.width
    w.height = cv.height
    const wc = w.getContext('2d')
    if (!wc) return null
    wc.drawImage(cv, 0, 0)
    wc.globalCompositeOperation = 'source-in'
    wc.fillStyle = '#fff'
    wc.fillRect(0, 0, w.width, w.height)
    const f = document.createElement('canvas')
    f.width = cv.width
    f.height = cv.height
    const fc = f.getContext('2d')
    if (!fc) return null
    fc.fillStyle = '#000'
    fc.fillRect(0, 0, f.width, f.height)
    fc.drawImage(w, 0, 0)
    return f.toDataURL('image/png')
  }

  const run = async () => {
    const mask = buildMask()
    if (!mask) return
    if (!prompt.trim()) {
      notify('请描述要在涂抹区域生成什么', 'error')
      return
    }
    setBusy(true)
    try {
      await inpaint(cardId, mask, prompt.trim())
      notify('局部重绘完成', 'success')
      useUi.getState().setMaskCardId(null)
    } catch (e: any) {
      notify('重绘失败：' + (e?.message || String(e)), 'error')
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
        className="max-w-[640px] max-h-[92vh] flex flex-col rounded-xl border bg-white dark:bg-neutral-900 shadow-2xl text-neutral-800 dark:text-neutral-200"
        style={{ borderColor: 'var(--ace-border)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Brush size={16} className="text-indigo-500" /> 局部重绘（实验）
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
            placeholder="在涂抹区域生成什么（如：戴上墨镜 / 换成红色裙子）"
            className="ace-input w-full"
          />
          <div className="text-[11px] opacity-50">提示：涂抹要改动的区域，写明想要的内容。效果取决于所选图像模型是否支持遮罩参考。</div>

          <button onClick={run} disabled={busy} className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-60">
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> 重绘中…
              </>
            ) : (
              <>
                <Brush size={15} /> 重绘涂抹区域
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
