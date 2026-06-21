import { useGraph } from '../store/graphStore'
import { Select, type SelectOption } from './Select'
import type { Card } from '../types'

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

function DurationSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0" title="时长（秒）">
      <input type="range" min={1} max={15} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-24 accent-indigo-500" />
      <span className="text-xs tabular-nums w-8">{value}s</span>
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
        <DurationSlider value={Number(p.duration) || 5} onChange={(v) => set('duration', v)} />
        <Select className="w-[84px] shrink-0" value={String(p.camera || '')} onChange={(v) => set('camera', v)} options={[{ value: '', label: '运镜·无' }, { value: '缓慢推近', label: '推近' }, { value: '缓慢拉远', label: '拉远' }, { value: '向左平移', label: '左移' }, { value: '向右平移', label: '右移' }, { value: '环绕运镜', label: '环绕' }, { value: '手持轻微晃动', label: '手持' }]} />
        <Select className="w-[88px] shrink-0" value={String(p.motion || '适中')} onChange={(v) => set('motion', v)} options={[{ value: '轻微', label: '运动·轻微' }, { value: '适中', label: '运动·适中' }, { value: '强烈', label: '运动·强烈' }]} />
        <SeedControl value={p.seed as number | undefined} onChange={(v) => set('seed', v)} />
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
