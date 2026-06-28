import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { SlidersHorizontal } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { listImageModels, listTextModels, type ModelOption } from '../services/models'
import { Select } from './Select'

// 项目设置浮层：默认图像/文本模型 + 批量并发上限（面板 portal 到 body，避免被顶栏 backdrop-blur 的层叠上下文困住）
export function ProjectSettings() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [imgModels, setImg] = useState<ModelOption[]>([])
  const [txtModels, setTxt] = useState<ModelOption[]>([])
  const project = useGraph((s) => s.project)
  const setDefaultModel = useGraph((s) => s.setDefaultModel)
  const setConcurrency = useGraph((s) => s.setConcurrency)

  useEffect(() => {
    if (!open) return
    listImageModels().then(setImg)
    listTextModels().then(setTxt)
    const place = () => {
      const b = btnRef.current?.getBoundingClientRect()
      // 面板宽 256(w-64)，右对齐并夹取，避免左溢出窗口
      if (b) setPos({ top: b.bottom + 4, right: Math.max(8, Math.min(window.innerWidth - 264, window.innerWidth - b.right)) })
    }
    place()
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
      if (t.closest?.('[data-interactive]')) return // 自定义 Select 浮层在 body 上
      setOpen(false)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', place)
    window.addEventListener('wheel', place, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', place)
      window.removeEventListener('wheel', place, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        title="项目设置（默认模型 / 并发）"
        className={`h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20 ${open ? 'text-indigo-500' : ''}`}
      >
        <SlidersHorizontal size={15} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            data-interactive
            className="ace-menu ace-anim-pop fixed z-[60] w-64 p-3 flex flex-col gap-3 text-sm text-neutral-800 dark:text-neutral-200"
            style={{ top: pos.top, right: pos.right }}
          >
            <div className="flex flex-col gap-1">
              <label className="text-xs opacity-60">默认图像模型</label>
              <Select
                value={project.defaultImageModel || ''}
                onChange={(v) => setDefaultModel('image', v || null)}
                options={[{ value: '', label: '自动（列表第一个）' }, ...imgModels.map((m) => ({ value: m.id, label: m.label }))]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs opacity-60">默认文本模型</label>
              <Select
                value={project.defaultTextModel || ''}
                onChange={(v) => setDefaultModel('text', v || null)}
                options={[{ value: '', label: '自动（宿主默认）' }, ...txtModels.map((m) => ({ value: m.id, label: m.label }))]}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs opacity-60">360 全景专用模型</label>
              <Select
                value={project.defaultPanoModel || ''}
                onChange={(v) => setDefaultModel('pano', v || null)}
                options={[{ value: '', label: '不用（沿用图像模型）' }, ...imgModels.map((m) => ({ value: m.id, label: m.label }))]}
              />
              <span className="text-[11px] opacity-50">开启「全景」生成时优先用它（应选能直接出等距柱状 equirect 的模型/LoRA）。</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs opacity-60">ControlNet 控制模型</label>
              <Select
                value={project.defaultControlModel || ''}
                onChange={(v) => setDefaultModel('control', v || null)}
                options={[{ value: '', label: '不用（导演台走截图参考）' }, ...imgModels.map((m) => ({ value: m.id, label: m.label }))]}
              />
              <span className="text-[11px] opacity-50">3D 导演台「强控制」用：选支持深度/姿态控制图的模型，按控制图严格构图。</span>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs opacity-60">批量并发上限</label>
              <Select
                value={String(project.concurrency || 4)}
                onChange={(v) => setConcurrency(Number(v))}
                options={[1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 1 ? '1（顺序执行）' : `${n} 路并发` }))}
              />
              <span className="text-[11px] opacity-50">批量/分镜生成时同时进行的最大数量；过大可能触发供应商限流。</span>
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
