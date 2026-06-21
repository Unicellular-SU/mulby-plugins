import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { useGraph } from '../store/graphStore'
import { Select, type SelectOption } from './Select'
import type { Card } from '../types'
import { durationValues } from '../services/videoSpecs'

const ASPECTS: SelectOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' }
]

function SeedControl({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
        placeholder="seed"
        title="随机种子（若模型支持，便于复现）"
        className="w-[60px] text-xs rounded-md px-1.5 py-1 bg-black/5 dark:bg-white/10 outline-none focus:ring-1 focus:ring-indigo-400"
      />
      <button onClick={() => onChange(Math.floor(Math.random() * 1e9))} title="随机种子" className="px-1 py-1 rounded hover:bg-black/10 dark:hover:bg-white/15 text-xs leading-none">
        🎲
      </button>
    </div>
  )
}

// 自定义时长滑块：整行，按所选模型的合法档位吸附
function DurationSlider({ values, value, onChange }: { values: number[]; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const n = values.length
  const single = n <= 1
  let curIdx = 0
  let bd = Infinity
  values.forEach((x, i) => {
    const d = Math.abs(x - value)
    if (d < bd) {
      bd = d
      curIdx = i
    }
  })
  const setFromX = (clientX: number) => {
    const el = ref.current
    if (!el || single) return
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    onChange(values[Math.round(t * (n - 1))]) // 吸附到最近合法档位
  }
  const down = (e: RPointerEvent) => {
    if (single) return
    e.stopPropagation()
    e.preventDefault()
    setFromX(e.clientX)
    const move = (ev: PointerEvent) => setFromX(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const pct = single ? 100 : (curIdx / (n - 1)) * 100
  return (
    <div data-interactive className="basis-full w-full flex items-center gap-2 py-1">
      <span className="text-[11px] opacity-60 shrink-0">时长</span>
      <div ref={ref} onPointerDown={down} className={`relative flex-1 h-6 flex items-center select-none ${single ? 'opacity-70' : 'cursor-pointer'}`}>
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-black/10 dark:bg-white/15" />
        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
        {values.map((s, i) => {
          const p = single ? 50 : (i / (n - 1)) * 100
          return (
            <div
              key={s}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full"
              style={{ left: `${p}%`, width: 4, height: 4, background: i <= curIdx ? '#6366f1' : 'var(--ace-border)' }}
            />
          )
        })}
        <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-500 shadow" style={{ left: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums shrink-0 text-right whitespace-nowrap" style={{ minWidth: '2.25rem' }}>
        {values[curIdx]}s{single ? ' · 固定' : ''}
      </span>
    </div>
  )
}

// 不同节点类型的生成参数（参考 AI-CanvasPro：图像比例/数量，视频比例/时长，音频音色/语速/格式）
export function ParamControls({ card }: { card: Card }) {
  const updateCard = useGraph((s) => s.updateCard)
  const p = card.params || {}
  const set = (k: string, v: unknown) => updateCard(card.id, { params: { ...card.params, [k]: v } })

  if (card.kind === 'image') {
    return (
      <>
        <Select className="w-[78px] shrink-0" value={String(p.aspect || '1:1')} onChange={(v) => set('aspect', v)} options={ASPECTS} />
        <Select className="w-[68px] shrink-0" value={String(p.resolution || '1K')} onChange={(v) => set('resolution', v)} options={[{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' }]} />
        <Select className="w-[62px] shrink-0" value={String(p.count || 1)} onChange={(v) => set('count', Number(v))} options={[{ value: '1', label: '×1' }, { value: '2', label: '×2' }, { value: '3', label: '×3' }, { value: '4', label: '×4' }]} />
        <SeedControl value={p.seed as number | undefined} onChange={(v) => set('seed', v)} />
      </>
    )
  }
  if (card.kind === 'video') {
    return (
      <>
        <Select className="w-[78px] shrink-0" value={String(p.aspect || '16:9')} onChange={(v) => set('aspect', v)} options={ASPECTS} />
        <Select className="w-[84px] shrink-0" value={String(p.camera || '')} onChange={(v) => set('camera', v)} options={[{ value: '', label: '运镜·无' }, { value: '缓慢推近', label: '推近' }, { value: '缓慢拉远', label: '拉远' }, { value: '向左平移', label: '左移' }, { value: '向右平移', label: '右移' }, { value: '环绕运镜', label: '环绕' }, { value: '手持轻微晃动', label: '手持' }]} />
        <Select className="w-[88px] shrink-0" value={String(p.motion || '适中')} onChange={(v) => set('motion', v)} options={[{ value: '轻微', label: '运动·轻微' }, { value: '适中', label: '运动·适中' }, { value: '强烈', label: '运动·强烈' }]} />
        <SeedControl value={p.seed as number | undefined} onChange={(v) => set('seed', v)} />
        <DurationSlider values={durationValues(card.modelId)} value={Number(p.duration) || 5} onChange={(v) => set('duration', v)} />
      </>
    )
  }
  if (card.kind === 'audio') {
    return (
      <>
        <Select className="w-[92px] shrink-0" value={String(p.voice || 'alloy')} onChange={(v) => set('voice', v)} options={['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((v) => ({ value: v, label: v }))} />
        <Select className="w-[76px] shrink-0" value={String(p.speed || 1)} onChange={(v) => set('speed', Number(v))} options={[{ value: '0.75', label: '0.75×' }, { value: '1', label: '1×' }, { value: '1.25', label: '1.25×' }, { value: '1.5', label: '1.5×' }]} />
        <Select className="w-[76px] shrink-0" value={String(p.format || 'mp3')} onChange={(v) => set('format', v)} options={[{ value: 'mp3', label: 'mp3' }, { value: 'wav', label: 'wav' }, { value: 'opus', label: 'opus' }]} />
      </>
    )
  }
  if (card.kind === 'text') {
    return (
      <>
        <Select className="w-[92px] shrink-0" value={String(p.temperature ?? 0.7)} onChange={(v) => set('temperature', Number(v))} options={[{ value: '0.3', label: '严谨' }, { value: '0.7', label: '均衡' }, { value: '1', label: '发散' }]} />
        <Select className="w-[96px] shrink-0" value={String(p.shotCount || 0)} onChange={(v) => set('shotCount', Number(v))} options={[{ value: '0', label: '镜数·自动' }, { value: '4', label: '镜数·4' }, { value: '6', label: '镜数·6' }, { value: '8', label: '镜数·8' }, { value: '12', label: '镜数·12' }]} />
      </>
    )
  }
  return null
}
