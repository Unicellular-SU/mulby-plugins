import { useGraph } from '../store/graphStore'
import type { Card } from '../types'

const ASPECTS: [string, string][] = [
  ['1:1', '1:1'],
  ['4:3', '4:3'],
  ['3:4', '3:4'],
  ['16:9', '16:9'],
  ['9:16', '9:16']
]

function Sel({
  value,
  onChange,
  title,
  options
}: {
  value: string
  onChange: (v: string) => void
  title: string
  options: [string, string][]
}) {
  return (
    <select
      title={title}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="shrink-0 text-xs rounded-md px-1.5 py-1 bg-black/5 dark:bg-white/10 outline-none focus:ring-1 focus:ring-indigo-400"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

// 不同节点类型的生成参数（参考 AI-CanvasPro：图像有比例/数量，视频有比例/时长，音频有音色/语速/格式）
export function ParamControls({ card }: { card: Card }) {
  const updateCard = useGraph((s) => s.updateCard)
  const p = card.params || {}
  const set = (k: string, v: unknown) => updateCard(card.id, { params: { ...card.params, [k]: v } })

  if (card.kind === 'image') {
    return (
      <>
        <Sel title="比例" value={String(p.aspect || '1:1')} onChange={(v) => set('aspect', v)} options={ASPECTS} />
        <Sel title="数量" value={String(p.count || 1)} onChange={(v) => set('count', Number(v))} options={[['1', '×1'], ['2', '×2'], ['3', '×3'], ['4', '×4']]} />
      </>
    )
  }
  if (card.kind === 'video') {
    return (
      <>
        <Sel title="比例" value={String(p.aspect || '16:9')} onChange={(v) => set('aspect', v)} options={ASPECTS} />
        <Sel title="时长" value={String(p.duration || 5)} onChange={(v) => set('duration', Number(v))} options={[['3', '3s'], ['5', '5s'], ['8', '8s'], ['10', '10s']]} />
      </>
    )
  }
  if (card.kind === 'audio') {
    return (
      <>
        <Sel title="音色" value={String(p.voice || 'alloy')} onChange={(v) => set('voice', v)} options={[['alloy', 'alloy'], ['echo', 'echo'], ['fable', 'fable'], ['onyx', 'onyx'], ['nova', 'nova'], ['shimmer', 'shimmer']]} />
        <Sel title="语速" value={String(p.speed || 1)} onChange={(v) => set('speed', Number(v))} options={[['0.75', '0.75×'], ['1', '1×'], ['1.25', '1.25×'], ['1.5', '1.5×']]} />
        <Sel title="格式" value={String(p.format || 'mp3')} onChange={(v) => set('format', v)} options={[['mp3', 'mp3'], ['wav', 'wav'], ['opus', 'opus']]} />
      </>
    )
  }
  if (card.kind === 'text') {
    return (
      <Sel title="创意度" value={String(p.temperature ?? 0.7)} onChange={(v) => set('temperature', Number(v))} options={[['0.3', '严谨'], ['0.7', '均衡'], ['1', '发散']]} />
    )
  }
  return null
}
