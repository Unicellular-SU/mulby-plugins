import { useEffect, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, Clock3, Info, RefreshCw } from 'lucide-react'
import type { DirectorShot } from '../types'
import {
  formatDirectorDuration,
  normalizeDirectorShotDuration,
  type DirectorContinuityIssue
} from './directorWorkflow'

interface Props {
  shot: DirectorShot | null
  index: number
  total: number
  totalDurationMs: number
  issues: DirectorContinuityIssue[]
  showCameraHelpers: boolean
  targetSubjects: Array<{ id: string; name: string; kind: string }>
  onChange: (patch: Partial<DirectorShot>) => void
  onTargetChange: (targetSubjectId: string | null) => void
  onRefresh: () => void
  onToggleCameraHelpers: () => void
}

export function DirectorShotInspector({
  shot,
  index,
  total,
  totalDurationMs,
  issues,
  showCameraHelpers,
  targetSubjects,
  onChange,
  onTargetChange,
  onRefresh,
  onToggleCameraHelpers
}: Props) {
  const [durationText, setDurationText] = useState('4')
  const [nameText, setNameText] = useState('')
  const [notesText, setNotesText] = useState('')

  useEffect(() => {
    setDurationText(String(normalizeDirectorShotDuration(shot?.durationMs) / 1000))
    setNameText(shot?.name || '')
    setNotesText(shot?.notes || '')
  }, [shot?.id, shot?.durationMs, shot?.name, shot?.notes])

  const commitDuration = () => {
    if (!shot) return
    const durationMs = normalizeDirectorShotDuration(Number(durationText) * 1000)
    setDurationText(String(durationMs / 1000))
    onChange({ durationMs })
  }

  return (
    <section className="flex flex-col gap-2.5 border-b border-white/[0.07] pb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-white/55">镜头计划</span>
          {!!total && <span className="text-[9px] tabular-nums text-white/30">{index + 1}/{total}</span>}
        </div>
        <div className="flex items-center gap-1 text-[9px] tabular-nums text-white/35" title="分镜总时长">
          <Clock3 size={10} /> {formatDirectorDuration(totalDurationMs)}
        </div>
      </div>

      <button
        type="button"
        aria-pressed={showCameraHelpers}
        onClick={onToggleCameraHelpers}
        className={`flex h-7 items-center justify-center gap-1.5 rounded-lg border text-[10px] transition-colors active:scale-[0.98] ${
          showCameraHelpers
            ? 'border-amber-300/45 bg-amber-300/12 text-amber-100'
            : 'border-white/10 bg-white/[0.04] text-white/45 hover:bg-white/[0.08] hover:text-white/75'
        }`}
        title="在导演视角中显示所有已记录机位的取景框"
      >
        <Camera size={11} /> 导演视角显示全部机位
      </button>

      {!shot ? (
        <div className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[10px] leading-relaxed text-white/35">
          记录或选择一个机位后，可编辑时长、备注并检查相邻镜头。
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 text-[10px] text-white/45">
            镜头名称
            <input
              value={nameText}
              onChange={(event) => setNameText(event.target.value)}
              onBlur={() => {
                const name = nameText.trim() || `机位${index + 1}`
                setNameText(name)
                onChange({ name })
              }}
              className="h-7 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[11px] text-white/80 outline-none focus:border-amber-300/50"
            />
          </label>

          <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-white/45">
              时长（秒）
              <input
                type="number"
                min={0.5}
                max={120}
                step={0.5}
                value={durationText}
                onChange={(event) => setDurationText(event.target.value)}
                onBlur={commitDuration}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                  if (event.key === 'Escape') {
                    setDurationText(String(normalizeDirectorShotDuration(shot.durationMs) / 1000))
                    event.currentTarget.blur()
                  }
                }}
                className="h-7 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-right text-[11px] tabular-nums text-white/80 outline-none focus:border-amber-300/50"
              />
            </label>
            <div className="flex flex-col gap-1 text-[10px] text-white/45">
              当前构图
              <button
                type="button"
                onClick={onRefresh}
                className="flex h-7 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-[10px] text-white/65 transition-colors hover:bg-white/[0.09] hover:text-white active:scale-[0.98]"
                title="用当前出图相机、画幅、灯光和缩略图覆盖此机位"
              >
                <RefreshCw size={10} /> 更新已选机位
              </button>
            </div>
          </div>

          <label className="flex flex-col gap-1 text-[10px] text-white/45">
            跟随目标
            <select
              value={targetSubjects.some((subject) => subject.id === shot.targetSubjectId) ? shot.targetSubjectId : ''}
              onChange={(event) => onTargetChange(event.target.value || null)}
              className="h-7 rounded-lg border border-white/10 bg-zinc-900 px-2 text-[11px] text-white/80 outline-none focus:border-amber-300/50"
            >
              <option value="">固定机位</option>
              {targetSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name} · {subject.kind}</option>
              ))}
            </select>
            <span className="text-[9px] leading-relaxed text-white/30">绑定后移动对象，机位会保持原构图一起跟随。</span>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-white/45">
            导演备注
            <textarea
              value={notesText}
              onChange={(event) => setNotesText(event.target.value)}
              onBlur={() => onChange({ notes: notesText.trim() || undefined })}
              placeholder="如：演员停顿后转身，保留右侧留白"
              className="h-14 resize-none rounded-lg border border-white/10 bg-white/[0.04] p-2 text-[11px] leading-relaxed text-white/75 outline-none placeholder:text-white/25 focus:border-amber-300/50"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-white/45">连续性提醒</span>
            {issues.length ? issues.map((issue, issueIndex) => (
              <div
                key={`${issue.code}-${issue.fromId}-${issue.toId}-${issueIndex}`}
                className={`flex items-start gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] leading-relaxed ${
                  issue.severity === 'warning'
                    ? 'border-amber-300/25 bg-amber-300/[0.07] text-amber-100/80'
                    : 'border-white/[0.07] bg-white/[0.025] text-white/45'
                }`}
              >
                {issue.severity === 'warning'
                  ? <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  : <Info size={11} className="mt-0.5 shrink-0" />}
                <span>{issue.message}</span>
              </div>
            )) : (
              <div className="flex items-center gap-1.5 text-[10px] text-white/35">
                <CheckCircle2 size={11} /> 未发现明显的相邻镜头跳变
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
