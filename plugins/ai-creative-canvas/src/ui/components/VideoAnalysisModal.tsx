import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Check,
  Clapperboard,
  Images,
  Loader2,
  MapPin,
  Play,
  ScanSearch,
  Square,
  X
} from 'lucide-react'
import { focusCard } from '../focusCard'
import { useEscClose } from '../hooks'
import { ensureFfmpeg } from '../services/mediaVideo'
import {
  cancelVideoAnalysis,
  convertVideoAnalysisToStoryboard,
  createVideoAnalysisReport,
  materializeVideoAnalysisFrames,
  readVideoAnalysisReport,
  updateVideoAnalysisShot,
  type VideoAnalysisProgress
} from '../services/videoAnalysis'
import { readStoryboardDoc } from '../services/storyboardV2'
import { useGraph } from '../store/graphStore'
import { toast } from '../store/toastStore'
import { useUi } from '../store/uiStore'
import type { VideoAnalysisFrame, VideoAnalysisShot } from '../types'

function formatTime(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  const rest = Math.max(0, seconds) - minutes * 60
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`
}

function EditableField({
  label,
  value,
  rows = 2,
  onCommit
}: {
  label: string
  value: string
  rows?: number
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (next !== value) onCommit(next)
  }
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium opacity-45">{label}</span>
      <textarea
        value={draft}
        rows={rows}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') event.currentTarget.blur()
        }}
        className="w-full resize-y rounded-lg border bg-black/[0.025] px-2.5 py-2 text-xs leading-relaxed outline-none transition focus:border-indigo-400 dark:bg-white/[0.045] ace-noscroll"
        style={{ borderColor: 'var(--ace-border)' }}
      />
    </label>
  )
}

function FrameStrip({
  shot,
  onRepresentative
}: {
  shot: VideoAnalysisShot
  onRepresentative: (frame: VideoAnalysisFrame) => void
}) {
  const roleLabel = { start: '首帧', middle: '中帧', end: '尾帧' } as const
  return (
    <div className="grid min-h-0 grid-cols-3 gap-3">
      {shot.frames.map((frame) => {
        const active = frame.path === shot.representativeFramePath
        return (
          <button
            type="button"
            key={`${frame.role}-${frame.time}`}
            onClick={() => onRepresentative(frame)}
            className={`group relative min-w-0 overflow-hidden rounded-xl border-2 bg-black ${active ? 'border-indigo-500' : 'border-transparent hover:border-white/35'}`}
            title="设为代表帧"
          >
            <img src={frame.url} alt="" draggable={false} className="aspect-video h-full max-h-[38vh] w-full object-contain" />
            <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white backdrop-blur">
              {roleLabel[frame.role]} · {formatTime(frame.time)}
            </span>
            {active && <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-indigo-500 px-2 py-1 text-[10px] text-white"><Check size={10} /> 代表帧</span>}
          </button>
        )
      })}
    </div>
  )
}

export function VideoAnalysisModal() {
  const cardId = useUi((state) => state.videoAnalysisCardId)
  const close = () => {
    if (cardId) cancelVideoAnalysis(cardId)
    useUi.getState().setVideoAnalysisCardId(null)
  }
  useEscClose(close, !!cardId)
  if (!cardId) return null
  return <VideoAnalysisInner cardId={cardId} onClose={close} />
}

function VideoAnalysisInner({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const project = useGraph((state) => state.project)
  const card = useMemo(() => {
    for (const board of project.boards) if (board.cards[cardId]) return board.cards[cardId]
    return undefined
  }, [project, cardId])
  const report = readVideoAnalysisReport(card)
  const stale = !!report && report.sourceAssetUrl !== card?.assetUrl
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(() => report?.shots[0]?.id || null)
  const [progress, setProgress] = useState<VideoAnalysisProgress | null>(null)
  const [threshold, setThreshold] = useState(report?.threshold ?? 0.4)
  const [maxShots, setMaxShots] = useState(60)

  useEffect(() => {
    if (!report?.shots.length) return
    if (!report.shots.some((shot) => shot.id === selectedId)) setSelectedId(report.shots[0].id)
  }, [report, selectedId])

  if (!card) return null
  const shot = report?.shots.find((item) => item.id === selectedId) || report?.shots[0] || null
  const boardId = project.boards.find((board) => !!board.cards[cardId])?.id

  const run = async () => {
    if (!card.assetLocalPath) {
      toast('视觉拉片需要本地视频文件，请先重新导入或生成视频', 'error')
      return
    }
    setBusy(true)
    setProgress({ phase: 'detecting', current: 0, total: 1, message: '准备 FFmpeg…' })
    try {
      if (!await ensureFfmpeg()) return
      const next = await createVideoAnalysisReport(cardId, { threshold, maxShots }, setProgress)
      setSelectedId(next.shots[0]?.id || null)
      toast(`视觉拉片完成：${next.shots.length} 个镜头`, 'success')
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast(`视觉拉片失败：${error?.message || String(error)}`, 'error')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }
  const cancel = () => {
    if (cancelVideoAnalysis(cardId)) setProgress((current) => current ? { ...current, message: '正在取消并清理临时帧…' } : current)
  }
  const updateShot = (patch: Partial<VideoAnalysisShot>) => {
    if (shot) updateVideoAnalysisShot(cardId, shot.id, patch)
  }
  const materialize = () => {
    if (!report || stale) return
    const ids = materializeVideoAnalysisFrames(cardId, report)
    toast(ids.length ? `已同步 ${ids.length} 张代表帧到画布` : '没有可落地的代表帧', ids.length ? 'success' : 'warning')
  }
  const convert = () => {
    if (!report || stale) return
    const result = convertVideoAnalysisToStoryboard(cardId, report, true)
    if (!result) return
    const owner = useGraph.getState().getCard(result.ownerId)
    const doc = owner ? readStoryboardDoc(owner) : null
    if (doc) {
      useUi.getState().setVideoAnalysisCardId(null)
      useUi.getState().openStoryboardShot(doc.id, doc.shots[0]?.id || null)
    }
  }
  const locate = () => {
    onClose()
    if (boardId) focusCard(boardId, cardId)
  }

  const phaseProgress = progress ? Math.max(0, Math.min(1, progress.total ? progress.current / progress.total : 0)) : 0
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div data-interactive className="ace-dialog ace-anim-scale flex h-[92vh] w-[min(1520px,97vw)] flex-col overflow-hidden text-neutral-800 dark:text-neutral-200">
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex min-w-0 items-center gap-2">
            <ScanSearch size={18} className="shrink-0 text-indigo-500" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">视觉拉片 · {card.title}</div>
              <div className="mt-0.5 text-[10px] opacity-45">场景切分 + 首/中/尾帧证据 + 可编辑镜头结论</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {report && !stale && <button type="button" onClick={materialize} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-black/5 px-2.5 text-xs hover:bg-black/10 disabled:opacity-45 dark:bg-white/10 dark:hover:bg-white/15"><Images size={13} /> 落地代表帧</button>}
            {report && !stale && <button type="button" onClick={convert} disabled={busy} className="flex h-8 items-center gap-1.5 rounded-lg bg-indigo-500 px-3 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-45"><Clapperboard size={13} /> 转为故事板</button>}
            <button type="button" onClick={locate} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10" title="定位源视频"><MapPin size={15} /></button>
            <button type="button" onClick={onClose} disabled={busy} className="grid h-8 w-8 place-items-center rounded-lg opacity-60 hover:bg-black/5 hover:opacity-100 disabled:opacity-25 dark:hover:bg-white/10"><X size={18} /></button>
          </div>
        </header>

        {!report || stale ? (
          <main className="flex flex-1 items-center justify-center p-8">
            <div className="w-full max-w-xl rounded-2xl border p-6" style={{ borderColor: 'var(--ace-border)' }}>
              <div className="mb-5 flex items-start gap-3">
                {stale ? <AlertCircle className="mt-0.5 shrink-0 text-amber-500" size={22} /> : <ScanSearch className="mt-0.5 shrink-0 text-indigo-500" size={22} />}
                <div>
                  <div className="font-semibold">{stale ? '源视频已经变化，需要重新拉片' : '建立可追溯的视频镜头报告'}</div>
                  <p className="mt-1 text-xs leading-relaxed opacity-60">每个镜头抽取首帧、中帧和尾帧后交给视觉模型分析。若连接了带时间码的 SRT/VTT 文本，会按时间区间合并对白；没有字幕时明确标记“未转写”，不会猜台词。</p>
                </div>
              </div>
              <AnalysisOptions threshold={threshold} maxShots={maxShots} disabled={busy} onThreshold={setThreshold} onMaxShots={setMaxShots} />
              <button type="button" onClick={() => void run()} disabled={busy || !card.assetLocalPath} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-45">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} {busy ? '正在拉片…' : stale ? '重新分析当前视频' : '开始视觉拉片'}
              </button>
              {!card.assetLocalPath && <div className="mt-3 text-center text-xs text-red-500">当前卡片缺少本地视频文件，请先重新导入或生成。</div>}
              {busy && <Progress progress={progress} value={phaseProgress} onCancel={cancel} />}
            </div>
          </main>
        ) : (
          <main className="flex min-h-0 flex-1">
            <aside className="flex w-[280px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--ace-border)' }}>
              <div className="border-b p-3" style={{ borderColor: 'var(--ace-border)' }}>
                <div className="flex items-center justify-between text-xs"><span className="font-medium">{report.shots.length} 个镜头</span><span className="tabular-nums opacity-45">{formatTime(report.duration)}</span></div>
                <div className="mt-1 text-[10px] opacity-45">阈值 {report.threshold.toFixed(2)} · 三帧采样</div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 ace-noscroll">
                {report.shots.map((item) => {
                  const active = item.id === shot?.id
                  return (
                    <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} className={`mb-1 flex w-full items-center gap-2 rounded-lg border p-2 text-left ${active ? 'border-indigo-400 bg-indigo-500/10' : 'border-transparent hover:bg-black/[0.035] dark:hover:bg-white/[0.045]'}`}>
                      <div className="h-14 w-[84px] shrink-0 overflow-hidden rounded-md bg-black/10">{item.representativeFrameUrl && <img src={item.representativeFrameUrl} alt="" className="h-full w-full object-cover" />}</div>
                      <div className="min-w-0 flex-1"><div className="flex items-center justify-between"><span className="text-xs font-semibold">镜头 {item.index + 1}</span><span className="text-[9px] tabular-nums opacity-45">{(item.end - item.start).toFixed(1)}s</span></div><div className="mt-1 truncate text-[10px] opacity-60">{item.shotSize || '景别未定'} · {item.scene || '场景待补充'}</div><div className={`mt-1 text-[9px] ${item.transcriptStatus === 'matched' ? 'text-emerald-500' : 'opacity-35'}`}>{item.transcriptStatus === 'matched' ? '已匹配字幕' : '未转写'}</div></div>
                    </button>
                  )
                })}
              </div>
              <div className="border-t p-2" style={{ borderColor: 'var(--ace-border)' }}><button type="button" onClick={() => void run()} disabled={busy} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-black/5 text-xs hover:bg-black/10 disabled:opacity-40 dark:bg-white/10 dark:hover:bg-white/15">{busy ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />} 重新分析</button></div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col bg-black/[0.018] p-4 dark:bg-white/[0.012]">
              {shot && <><div className="mb-3 flex items-center justify-between"><div><span className="text-sm font-semibold">镜头 {shot.index + 1}</span><span className="ml-2 text-xs tabular-nums opacity-45">{formatTime(shot.start)} — {formatTime(shot.end)}</span></div><span className="rounded-full bg-black/5 px-2 py-1 text-[10px] opacity-60 dark:bg-white/10">点击帧可更换代表帧</span></div><FrameStrip shot={shot} onRepresentative={(frame) => updateShot({ representativeFramePath: frame.path, representativeFrameUrl: frame.url })} /><div className="mt-4 min-h-0 flex-1 overflow-y-auto rounded-xl border bg-white/60 p-4 text-xs leading-relaxed dark:bg-white/[0.025] ace-noscroll" style={{ borderColor: 'var(--ace-border)' }}><div className="grid grid-cols-2 gap-x-6 gap-y-3"><Summary label="场景" value={shot.scene} /><Summary label="景别" value={shot.shotSize} /><Summary label="构图" value={shot.composition} /><Summary label="人物 / 关键物体" value={shot.characters} /><Summary label="动作变化" value={shot.action} /><Summary label="镜头变化" value={shot.camera} /><Summary label="光线 / 色彩" value={shot.color} /><Summary label="情绪 / 节奏" value={shot.mood} /></div><div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--ace-border)' }}><div className="text-[10px] font-medium opacity-45">对白 / 字幕</div><div className="mt-1">{shot.transcriptStatus === 'matched' ? shot.dialogue : <span className="opacity-40">未转写（可连接带时间码的 SRT/VTT 文本后重新分析）</span>}</div></div></div></>}
            </section>

            <aside className="w-[330px] shrink-0 overflow-y-auto border-l p-3 ace-noscroll" style={{ borderColor: 'var(--ace-border)' }}>
              {shot && <div className="space-y-3"><div><div className="text-xs font-semibold">校正分析结论</div><div className="mt-1 text-[10px] opacity-45">失焦后自动保存；⌘/Ctrl + Enter 也可保存当前项。</div></div><EditableField label="场景" value={shot.scene} onCommit={(scene) => updateShot({ scene })} /><div className="grid grid-cols-2 gap-2"><EditableField label="景别" rows={1} value={shot.shotSize} onCommit={(shotSize) => updateShot({ shotSize })} /><EditableField label="情绪 / 节奏" rows={1} value={shot.mood} onCommit={(mood) => updateShot({ mood })} /></div><EditableField label="构图与视觉重心" value={shot.composition} onCommit={(composition) => updateShot({ composition })} /><EditableField label="人物 / 关键物体" value={shot.characters} onCommit={(characters) => updateShot({ characters })} /><EditableField label="动作变化" value={shot.action} onCommit={(action) => updateShot({ action })} /><EditableField label="镜头变化（仅依据三帧）" value={shot.camera} onCommit={(camera) => updateShot({ camera })} /><EditableField label="光线 / 色彩" value={shot.color} onCommit={(color) => updateShot({ color })} /><EditableField label="可学习视频提示词" rows={4} value={shot.learnablePrompt} onCommit={(learnablePrompt) => updateShot({ learnablePrompt })} /></div>}
            </aside>
          </main>
        )}
        {busy && report && !stale && <div className="shrink-0 border-t px-4 py-2" style={{ borderColor: 'var(--ace-border)' }}><Progress progress={progress} value={phaseProgress} onCancel={cancel} /></div>}
      </div>
    </div>
  )
}

function AnalysisOptions({ threshold, maxShots, disabled, onThreshold, onMaxShots }: { threshold: number; maxShots: number; disabled: boolean; onThreshold: (value: number) => void; onMaxShots: (value: number) => void }) {
  return <div className="grid grid-cols-2 gap-3"><label><span className="mb-1 block text-[10px] opacity-50">场景检测灵敏度 · {threshold.toFixed(2)}</span><input type="range" min="0.15" max="0.75" step="0.05" value={threshold} disabled={disabled} onChange={(event) => onThreshold(Number(event.target.value))} className="w-full accent-indigo-500" /></label><label><span className="mb-1 block text-[10px] opacity-50">最多分析镜头</span><input type="number" min={1} max={100} value={maxShots} disabled={disabled} onChange={(event) => onMaxShots(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} className="h-8 w-full rounded-lg border bg-black/[0.025] px-2 text-xs outline-none dark:bg-white/[0.045]" style={{ borderColor: 'var(--ace-border)' }} /></label></div>
}

function Progress({ progress, value, onCancel }: { progress: VideoAnalysisProgress | null; value: number; onCancel: () => void }) {
  return <div className="mt-3"><div className="mb-1 flex items-center justify-between text-[10px]"><span className="truncate opacity-60">{progress?.message || '准备中…'}</span><button type="button" onClick={onCancel} className="ml-3 flex shrink-0 items-center gap-1 text-red-500 hover:text-red-600"><Square size={9} fill="currentColor" /> 取消</button></div><div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-indigo-500 transition-[width]" style={{ width: `${Math.max(3, value * 100)}%` }} /></div></div>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] font-medium opacity-40">{label}</div><div className="mt-1 whitespace-pre-wrap">{value || <span className="opacity-30">未识别</span>}</div></div>
}
