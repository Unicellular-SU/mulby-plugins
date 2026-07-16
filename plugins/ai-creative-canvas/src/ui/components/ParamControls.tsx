import { useRef, type PointerEvent as RPointerEvent } from 'react'
import { Dices } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { Select } from './Select'
import type { Card } from '../types'
import { durationValues } from '../services/videoSpecs'
import { getParamSchema } from '../services/paramSchema'

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
      <button onClick={() => onChange(Math.floor(Math.random() * 1e9))} title="随机种子" className="px-1 py-1 rounded hover:bg-black/10 dark:hover:bg-white/15 grid place-items-center opacity-70 hover:opacity-100">
        <Dices size={13} />
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

// 不同节点类型的生成参数：字段声明在 services/paramSchema，单一渲染器分发（select/seed/duration）
export function ParamControls({ card }: { card: Card }) {
  const updateCard = useGraph((s) => s.updateCard)
  const p = card.params || {}
  const set = (k: string, v: unknown) => updateCard(card.id, { params: { ...card.params, [k]: v } })
  const fields = getParamSchema(card)
  if (!fields.length) return null
  return (
    <>
      {fields.map((f) => {
        if (f.type === 'seed') return <SeedControl key={f.key} value={p[f.key] as number | undefined} onChange={(v) => set(f.key, v)} />
        if (f.type === 'duration') return <DurationSlider key={f.key} values={durationValues(card.modelId)} value={Number(p[f.key]) || 5} onChange={(v) => set(f.key, v)} />
        const cur = p[f.key] !== undefined && p[f.key] !== null ? String(p[f.key]) : f.default
        return (
          <div key={f.key} className="shrink-0" style={{ width: f.width }}>
            <Select className="w-full" value={cur} onChange={(v) => set(f.key, f.numeric ? Number(v) : v)} options={f.options} />
          </div>
        )
      })}
    </>
  )
}
