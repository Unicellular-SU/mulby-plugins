import { useMemo, useState } from 'react'
import { Clapperboard, Loader2, X } from 'lucide-react'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import { useStudio } from '../store/studioStore'
import { toast } from '../store/toastStore'
import { resolveVideoCapabilities } from '../services/providers/config'
import { normalizeReshootRange, prepareVideoReshoot } from '../services/videoReshoot'
import { buildCardGenerationPlan } from '../services/generationPlan'
import { useGenerationPlan } from '../store/generationPlanStore'
import { generateCard } from '../services/generate'

export function VideoReshootDialog({ cardId, duration, playhead, onClose }: { cardId: string; duration: number; playhead: number; onClose: () => void }) {
  const initial = useMemo(() => normalizeReshootRange(playhead - 1, playhead + 1, duration), [duration, playhead])
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const provider = useProviders((state) => state.activeFor('video'))
  const capabilities = resolveVideoCapabilities(provider)
  const range = normalizeReshootRange(start, end, duration)

  const create = async () => {
    setBusy(true)
    try {
      const replacementId = await prepareVideoReshoot(cardId, range.start, range.end, instruction, duration)
      // 先退出工作台，避免全屏编辑器挡住全局生成预检对话框。
      onClose()
      useStudio.getState().close()
      useUi.getState().setStudioCardId(null)
      const plan = await buildCardGenerationPlan([replacementId])
      const accepted = !plan.requiresConfirmation || await useGenerationPlan.getState().present(plan)
      if (accepted) {
        void generateCard(replacementId)
        toast('已创建替换片段并开始生成；完成后会自动回填为新成片', 'success')
      } else {
        toast('已创建替换片段卡，可检查输入后再生成', 'info')
      }
    } catch (error: any) {
      toast(error?.message || String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/55 p-5" onClick={() => !busy && onClose()}>
      <div data-interactive onClick={(event) => event.stopPropagation()} className="ace-dialog ace-anim-scale w-[min(680px,94vw)] overflow-hidden">
        <div className="flex h-12 items-center gap-2 border-b border-black/10 px-4 dark:border-white/10"><Clapperboard size={17} className="text-pink-500" /><b className="text-sm">局部重拍</b><span className="text-xs opacity-45">原片不会被覆盖</span><button disabled={busy} onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"><X size={16} /></button></div>
        <div className="space-y-5 p-5">
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs leading-5"><b>处理方式：</b>抽取区间首帧、代表帧和尾帧 → 继承原提示词、故事板、锚点与风格 → 生成替换片段 → 自动拼回一张新视频卡。</div>
          <div className="grid grid-cols-2 gap-4">
            <label className="space-y-1.5 text-xs"><span className="opacity-60">开始时间</span><input type="number" min={0} max={Math.max(0, range.end - 0.1)} step={0.1} value={start} onChange={(event) => setStart(Number(event.target.value))} className="ace-input w-full" /></label>
            <label className="space-y-1.5 text-xs"><span className="opacity-60">结束时间</span><input type="number" min={range.start + 0.1} max={duration} step={0.1} value={end} onChange={(event) => setEnd(Number(event.target.value))} className="ace-input w-full" /></label>
          </div>
          <div className="space-y-2">
            <div className="relative h-2 rounded-full bg-black/10 dark:bg-white/10"><div className="absolute h-full rounded-full bg-pink-500" style={{ left: `${duration ? range.start / duration * 100 : 0}%`, right: `${duration ? (duration - range.end) / duration * 100 : 0}%` }} /></div>
            <div className="flex justify-between text-[11px] opacity-45"><span>{range.start.toFixed(1)}s</span><span>替换 {(range.end - range.start).toFixed(1)}s / 原片 {duration.toFixed(1)}s</span><span>{range.end.toFixed(1)}s</span></div>
          </div>
          <label className="block space-y-1.5 text-xs"><span className="opacity-60">这段要改什么</span><textarea autoFocus value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="例如：人物转身动作更自然，保持服装、机位和环境不变" className="ace-input h-24 w-full resize-none py-2" /></label>
          <div className="flex flex-wrap gap-2 text-[11px]"><span className={`rounded-full px-2 py-1 ${provider ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>{provider?.label || '未配置视频 Provider'}</span><span className={`rounded-full px-2 py-1 ${capabilities.imageToVideo ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>{capabilities.imageToVideo ? '支持参考图' : '不支持参考图'}</span><span className="rounded-full bg-black/5 px-2 py-1 dark:bg-white/10">{capabilities.lastFrame ? '首尾帧约束' : '仅首帧约束 · 中/尾帧保留检查'}</span></div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-black/10 px-5 py-3 dark:border-white/10"><button disabled={busy} onClick={onClose} className="h-9 rounded-lg px-4 text-xs hover:bg-black/5 dark:hover:bg-white/10">取消</button><button disabled={busy || !provider || !capabilities.imageToVideo} onClick={() => void create()} className="flex h-9 items-center gap-1.5 rounded-lg bg-pink-600 px-5 text-xs font-medium text-white disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />}创建并生成替换片段</button></div>
      </div>
    </div>
  )
}
