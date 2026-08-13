import { useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clapperboard,
  Clock3,
  Copy,
  Film,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  GalleryHorizontalEnd,
  Trash2
} from 'lucide-react'
import type { DirectorEnvironment, DirectorShot } from '../types'
import { isImeComposing } from '../util'
import { assessDirectorPanoramaCamera } from './directorEnvironment'
import { formatDirectorDuration, normalizeDirectorShotDuration, type DirectorContinuityIssue } from './directorWorkflow'

interface Props {
  shots: DirectorShot[]
  activeShotId: string | null
  expanded: boolean
  busy: boolean
  applyingShotId: string | null
  totalDurationMs: number
  continuityIssues: DirectorContinuityIssue[]
  environment: DirectorEnvironment | null
  onToggle: () => void
  onAdd: () => void
  onApply: (shot: DirectorShot) => void
  onGenerate: (index: number) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onCycleTake: (index: number, direction: number) => void
  onVersions: (index: number) => void
  onReorder: (draggedId: string, targetId: string) => void
  onBatchGenerate: () => void
  onExport: () => void
}

const iconButtonClass = 'grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 active:scale-[0.96]'
const shotActionButtonClass = 'grid h-5 w-5 shrink-0 place-items-center rounded-md text-white/35 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-30'

export function DirectorShotStrip({
  shots,
  activeShotId,
  expanded,
  busy,
  applyingShotId,
  totalDurationMs,
  continuityIssues,
  environment,
  onToggle,
  onAdd,
  onApply,
  onGenerate,
  onDuplicate,
  onDelete,
  onRename,
  onCycleTake,
  onVersions,
  onReorder,
  onBatchGenerate,
  onExport
}: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const cancelRenameRef = useRef(false)

  const finishRename = (shot: DirectorShot) => {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      setEditId(null)
      return
    }
    onRename(shot.id, editName.trim() || shot.name)
    setEditId(null)
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.07] px-2.5">
        <button
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 text-left text-white/75 transition-colors hover:bg-white/[0.06] hover:text-white"
          title={expanded ? '收起机位分镜条' : '展开机位分镜条'}
        >
          <Film size={14} className="shrink-0 text-amber-300" />
          <span className="text-xs font-medium">机位分镜</span>
          <span className="text-[10px] tabular-nums text-white/35">{shots.length}</span>
          {expanded ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </button>
        <div className="h-4 w-px bg-white/10" />
        <button onClick={onAdd} className={iconButtonClass} title="记录当前机位">
          <Plus size={13} />
        </button>
        <span className="hidden text-[11px] text-white/35 sm:inline">记录当前机位</span>
        {!!shots.length && (
          <span className="hidden items-center gap-1 text-[10px] tabular-nums text-white/35 md:flex" title="分镜总时长">
            <Clock3 size={10} /> {formatDirectorDuration(totalDurationMs)}
          </span>
        )}
        {continuityIssues.some((issue) => issue.severity === 'warning') && (
          <span className="flex items-center gap-1 text-[9px] text-amber-200/75" title="存在需要检查的镜头连续性提醒">
            <AlertTriangle size={10} /> {continuityIssues.filter((issue) => issue.severity === 'warning').length}
          </span>
        )}
        <div className="flex-1" />
        {shots.length > 0 && (
          <>
            <button
              onClick={onBatchGenerate}
              disabled={busy}
              className="flex h-7 items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-300/45 bg-amber-300/15 px-2.5 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-300/25 disabled:opacity-40 active:scale-[0.98]"
              title="按全部机位批量生成"
            >
              <Film size={12} /> 批量生成
            </button>
            <button onClick={onExport} disabled={busy} className={iconButtonClass} title="导出分镜到画布">
              <Clapperboard size={13} />
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="min-h-0 flex-1 overflow-x-auto px-2.5 py-2 ace-scroll">
          {shots.length === 0 ? (
            <button
              onClick={onAdd}
              className="flex h-full min-h-16 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.025] text-xs text-white/40 transition-colors hover:border-amber-300/35 hover:text-amber-100"
            >
              <Camera size={15} /> 记录当前机位，建立可排序的分镜序列
            </button>
          ) : (
            <div className="flex h-full min-w-max gap-2">
              {shots.map((shot, index) => {
                const selected = shot.id === activeShotId
                const takeIndex = shot.takes?.indexOf(shot.take || '') ?? -1
                const incomingIssues = continuityIssues.filter((issue) => issue.toId === shot.id)
                const incomingWarning = incomingIssues.some((issue) => issue.severity === 'warning')
                const shotEnvironment = shot.environmentState && environment
                  ? { ...environment, ...shot.environmentState }
                  : environment
                const panoramaStatus = assessDirectorPanoramaCamera(shot.cam, shotEnvironment)
                const approximatePanorama = !!panoramaStatus?.approximate
                return (
                  <article
                    key={shot.id}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedId) onReorder(draggedId, shot.id)
                      setDraggedId(null)
                    }}
                    className={`group relative grid w-[232px] shrink-0 grid-cols-[80px_minmax(0,1fr)] gap-2 rounded-xl border py-1.5 pl-6 pr-2 transition-colors ${
                      selected ? 'border-amber-300/55 bg-amber-300/10' : 'border-white/[0.08] bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.06]'
                    } ${draggedId === shot.id ? 'opacity-45' : ''}`}
                  >
                    <button
                      draggable={editId !== shot.id}
                      onDragStart={() => setDraggedId(shot.id)}
                      onDragEnd={() => setDraggedId(null)}
                      className="absolute inset-y-1 left-1 grid w-4 cursor-grab place-items-center rounded-md text-white/20 transition-colors hover:bg-white/[0.06] hover:text-white/55 active:cursor-grabbing"
                      title="拖动排序"
                      aria-label="拖动排序"
                    >
                      <GripVertical size={12} />
                    </button>
                    <button disabled={busy} onClick={() => onApply(shot)} className="relative h-14 w-20 self-center overflow-hidden rounded-lg bg-zinc-900 text-left disabled:cursor-wait" title={shot.sceneState ? '应用此镜头的相机与演员调度' : '切换到此旧机位'}>
                      {shot.take || shot.thumb ? (
                        <img src={shot.take || shot.thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-white/20"><Camera size={16} /></span>
                      )}
                      {approximatePanorama && (
                        <span
                          className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[8px] ${panoramaStatus?.level === 'high' ? 'bg-zinc-950/90 text-amber-100' : 'bg-zinc-950/80 text-amber-200/70'}`}
                          title={`${panoramaStatus?.label}：${panoramaStatus?.detail}`}
                        >
                          近似
                        </span>
                      )}
                      {shot.take && <span className="absolute bottom-1 right-1 rounded bg-zinc-950/80 px-1 py-0.5 text-[8px] text-amber-200">TAKE</span>}
                      {applyingShotId === shot.id && <span className="absolute inset-0 grid place-items-center bg-zinc-950/70 text-amber-200"><Loader2 size={14} className="animate-spin" /></span>}
                    </button>
                    <div className="flex min-w-0 flex-col overflow-hidden">
                      {editId === shot.id ? (
                        <input
                          autoFocus
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          onBlur={() => finishRename(shot)}
                          onKeyDown={(event) => {
                            if (isImeComposing(event)) return
                            if (event.key === 'Enter') event.currentTarget.blur()
                            if (event.key === 'Escape') {
                              cancelRenameRef.current = true
                              event.currentTarget.blur()
                            }
                          }}
                          className="min-w-0 rounded-md border border-amber-300/50 bg-zinc-900 px-1.5 py-0.5 text-[11px] outline-none"
                        />
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => onApply(shot)}
                          onDoubleClick={() => { cancelRenameRef.current = false; setEditId(shot.id); setEditName(shot.name) }}
                          className="truncate text-left text-[11px] font-medium text-white/80 hover:text-white disabled:cursor-wait disabled:opacity-50"
                          title={shot.sceneState ? '应用完整镜头，双击改名' : '切换机位，双击改名'}
                        >
                          {shot.name}
                        </button>
                      )}
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 truncate text-[9px] tabular-nums text-white/35" title={incomingIssues.length ? incomingIssues.map((issue) => issue.message).join('\n') : `灯光：${shot.lighting || '沿用场景'}`}>
                        {incomingWarning && <AlertTriangle size={9} className="shrink-0 text-amber-200/80" />}
                        <span className="truncate">{shot.shotType || '镜头'} / {Math.round(shot.cam?.focal || 35)}mm {shot.aspect && shot.aspect !== '视口' ? `/ ${shot.aspect}` : ''}</span>
                      </span>
                      <span className="flex items-center gap-1 text-[9px] tabular-nums text-white/30">
                        {normalizeDirectorShotDuration(shot.durationMs) / 1000}s
                        {shot.sceneState && <span className="flex items-center gap-0.5 text-amber-200/55" title={`保存了 ${shot.sceneState.subjects.length} 个对象的演员调度`}><Clapperboard size={9} />{shot.sceneState.subjects.length}</span>}
                      </span>
                      <div className="mt-auto flex items-center gap-1">
                        <button onClick={() => onGenerate(index)} disabled={busy} className={`${shotActionButtonClass} hover:text-amber-200`} title="按此机位生成或重拍"><RefreshCw size={11} /></button>
                        {!!shot.take && <button onClick={() => onVersions(index)} className={`${shotActionButtonClass} hover:text-indigo-200`} title="打开 Take 版本工作区"><GalleryHorizontalEnd size={11} /></button>}
                        <button onClick={() => onDuplicate(shot.id)} className={shotActionButtonClass} title="复制机位"><Copy size={11} /></button>
                        <button onClick={() => onDelete(shot.id)} className={shotActionButtonClass} title="删除机位"><Trash2 size={11} /></button>
                        {(shot.takes?.length || 0) > 1 && (
                          <div className="ml-auto flex shrink-0 items-center gap-0.5 text-[9px] tabular-nums text-white/45">
                            <button onClick={() => onCycleTake(index, -1)} className="hover:text-white" title="上一条成片"><ChevronLeft size={10} /></button>
                            <span>{takeIndex + 1}/{shot.takes!.length}</span>
                            <button onClick={() => onCycleTake(index, 1)} className="hover:text-white" title="下一条成片"><ChevronRight size={10} /></button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
