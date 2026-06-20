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
      </>
    )
  }
  if (card.kind === 'video') {
    return (
      <>
        <Select className="w-[78px] shrink-0" value={String(p.aspect || '16:9')} onChange={(v) => set('aspect', v)} options={ASPECTS} />
        <Select className="w-[72px] shrink-0" value={String(p.duration || 5)} onChange={(v) => set('duration', Number(v))} options={[{ value: '3', label: '3s' }, { value: '5', label: '5s' }, { value: '8', label: '8s' }, { value: '10', label: '10s' }]} />
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
      <Select className="w-[92px] shrink-0" value={String(p.temperature ?? 0.7)} onChange={(v) => set('temperature', Number(v))} options={[{ value: '0.3', label: '严谨' }, { value: '0.7', label: '均衡' }, { value: '1', label: '发散' }]} />
    )
  }
  return null
}
