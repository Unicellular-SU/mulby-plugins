import { Sparkles, Film } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { generateSelected, canGenerate } from '../services/generate'

// 多选时浮现的批量操作（分镜扇出后一键出图）
export function BatchActions() {
  const selectedIds = useGraph((s) => s.selectedIds)
  const board = useGraph((s) => s.getActiveBoard())
  const targets = selectedIds.filter((id) => {
    const c = board.cards[id]
    return c && canGenerate(c.kind) && c.status !== 'running' && c.status !== 'queued'
  })
  const clips = selectedIds.filter((id) => {
    const c = board.cards[id]
    return c && c.kind === 'video' && c.assetLocalPath
  })
  if (targets.length < 2 && clips.length < 2) return null
  return (
    <div data-interactive className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2">
      {targets.length >= 2 && (
        <button
          onClick={() => generateSelected()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium shadow-lg"
        >
          <Sparkles size={15} /> 生成选中（{targets.length}）
        </button>
      )}
      {clips.length >= 2 && (
        <button
          onClick={() => useUi.getState().setShowCompose(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-lg"
        >
          <Film size={15} /> 合成成片（{clips.length}）
        </button>
      )}
    </div>
  )
}
