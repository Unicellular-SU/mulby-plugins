import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { DIRECTOR_POSES, type DirectorPosePreset } from './directorMannequin'
import {
  DIRECTOR_JOINT_GROUPS,
  DIRECTOR_POSE_GROUPS,
  getDirectorJointLimits,
  type DirectorJointAxis,
  type DirectorPoseSafetySummary
} from './directorPoseTools'

export interface DirectorJointEditorState {
  name: string
  rotation: [number, number, number]
}

interface Props {
  activePose?: string
  locked?: boolean
  previews: Record<string, string>
  previewStatus: 'idle' | 'loading' | 'ready' | 'error'
  joint: DirectorJointEditorState | null
  safety: DirectorPoseSafetySummary
  onApplyPose: (pose: DirectorPosePreset) => void
  onRetryPreviews: () => void
  onSelectJoint: (joint: string) => void
  onSetJointAxis: (axis: DirectorJointAxis, value: number) => void
  onCommitJoint: () => void
  onResetJoint: () => void
}

const poseButtonClass = 'group relative flex min-w-0 flex-col overflow-hidden rounded-xl border text-left transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'

export function DirectorPosePanel({
  activePose,
  locked,
  previews,
  previewStatus,
  joint,
  safety,
  onApplyPose,
  onRetryPreviews,
  onSelectJoint,
  onSetJointAxis,
  onCommitJoint,
  onResetJoint
}: Props) {
  const activeGroup = DIRECTOR_POSE_GROUPS.find((group) => group.poses.includes(activePose || ''))?.id || 'basic'
  const [groupId, setGroupId] = useState(activeGroup)
  useEffect(() => { setGroupId(activeGroup) }, [activeGroup])
  const group = DIRECTOR_POSE_GROUPS.find((item) => item.id === groupId) || DIRECTOR_POSE_GROUPS[0]
  const poses = useMemo(
    () => group.poses.map((name) => DIRECTOR_POSES.find((pose) => pose.k === name)).filter(Boolean) as DirectorPosePreset[],
    [group]
  )
  const limits = joint ? getDirectorJointLimits(joint.name) : [120, 120, 120]

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-white/50">姿势库</span>
          <span className="text-[9px] tabular-nums text-white/30">{DIRECTOR_POSES.length} 个预设</span>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-black/15 p-1">
          {DIRECTOR_POSE_GROUPS.map((item) => (
            <button
              key={item.id}
              onClick={() => setGroupId(item.id)}
              className={`h-7 whitespace-nowrap rounded-lg text-[10px] transition-colors ${
                item.id === groupId ? 'bg-amber-300/15 text-amber-100' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/75'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {previewStatus === 'error' && (
          <button
            onClick={onRetryPreviews}
            className="flex items-center justify-between rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-2.5 py-2 text-left text-[10px] text-amber-100/80 hover:bg-amber-300/10"
          >
            缩略图加载失败，仍可使用姿势 <span className="font-medium text-amber-200">重试</span>
          </button>
        )}

        <div className="grid grid-cols-3 gap-1.5">
          {poses.map((pose) => {
            const preview = previews[pose.k]
            const active = (activePose || '站立') === pose.k
            return (
              <button
                key={pose.k}
                disabled={locked}
                onClick={() => onApplyPose(pose)}
                className={`${poseButtonClass} ${
                  active ? 'border-amber-300/55 bg-amber-300/10 text-amber-100' : 'border-white/[0.08] bg-white/[0.03] text-white/60 hover:border-white/20 hover:bg-white/[0.06] hover:text-white'
                }`}
                title={`应用姿势：${pose.k}`}
              >
                <span className="relative block aspect-[4/3] w-full overflow-hidden bg-zinc-900/80">
                  {preview ? (
                    <img src={preview} alt={`${pose.k}姿势预览`} draggable={false} className="h-full w-full object-cover" />
                  ) : (
                    <span className={`absolute inset-0 ${previewStatus === 'loading' ? 'animate-pulse bg-white/[0.055]' : 'grid place-items-center text-[9px] text-white/20'}`}>
                      {previewStatus !== 'loading' ? pose.k : ''}
                    </span>
                  )}
                  {active && <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-md bg-amber-300 text-zinc-950"><Check size={10} strokeWidth={2.4} /></span>}
                </span>
                <span className="w-full truncate px-1.5 py-1 text-center text-[10px] font-medium">{pose.k}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t border-white/[0.07] pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/50"><SlidersHorizontal size={11} /> 关节微调</span>
          <span className={`flex items-center gap-1 text-[9px] ${safety.level === 'error' ? 'text-red-300' : safety.level === 'warning' ? 'text-amber-200' : 'text-white/35'}`}>
            {safety.level === 'safe' ? <Check size={10} /> : <AlertTriangle size={10} />}
            {safety.level === 'safe' ? '姿态安全' : safety.level === 'warning' ? '接近上限' : '需要调整'}
          </span>
        </div>

        <label className="flex flex-col gap-1 text-[10px] text-white/40">
          当前关节
          <select
            value={joint?.name || ''}
            disabled={locked}
            onChange={(event) => onSelectJoint(event.target.value)}
            className="h-8 rounded-lg border border-white/10 bg-zinc-900 px-2 text-[11px] text-white/75 outline-none focus:border-amber-300/50 disabled:opacity-40"
          >
            <option value="" disabled>在模型上点选，或从这里选择</option>
            {DIRECTOR_JOINT_GROUPS.map((item) => (
              <optgroup key={item.label} label={item.label}>
                {item.joints.map((name) => <option key={name} value={name}>{name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>

        {joint ? (
          <div className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
            {(['X', 'Y', 'Z'] as const).map((label, axis) => (
              <label key={label} className="grid grid-cols-[14px_minmax(0,1fr)_48px] items-center gap-2 text-[10px]">
                <span className="font-semibold text-white/30">{label}</span>
                <input
                  aria-label={`${joint.name} ${label} 轴旋转`}
                  type="range"
                  min={-limits[axis]}
                  max={limits[axis]}
                  step={1}
                  value={joint.rotation[axis]}
                  disabled={locked}
                  onChange={(event) => onSetJointAxis(axis as DirectorJointAxis, Number(event.target.value))}
                  onPointerUp={onCommitJoint}
                  onKeyUp={onCommitJoint}
                  className="min-w-0 accent-amber-300"
                />
                <input
                  aria-label={`${joint.name} ${label} 轴角度`}
                  type="number"
                  min={-limits[axis]}
                  max={limits[axis]}
                  step={1}
                  value={Math.round(joint.rotation[axis])}
                  disabled={locked}
                  onChange={(event) => onSetJointAxis(axis as DirectorJointAxis, Number(event.target.value))}
                  onBlur={onCommitJoint}
                  className="h-7 rounded-lg border border-white/10 bg-white/[0.04] px-1 text-right tabular-nums text-white/70 outline-none focus:border-amber-300/50 disabled:opacity-40"
                />
              </label>
            ))}
            <button
              onClick={onResetJoint}
              disabled={locked}
              className="mt-0.5 flex h-7 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] text-[10px] text-white/55 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
            >
              <RotateCcw size={10} /> 复位当前关节
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 px-3 py-3 text-[10px] leading-relaxed text-white/30">
            切到摆姿模式后点击身体关节，或从上方列表选择关节。
          </div>
        )}

        {safety.issues.length > 0 && (
          <div className="flex flex-col gap-1 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-2.5 py-2 text-[9px] text-amber-100/70">
            {safety.issues.slice(0, 3).map((issue, index) => <span key={`${issue.joint}-${issue.axis}-${index}`}>{issue.message}</span>)}
            {safety.issues.length > 3 && <span>另有 {safety.issues.length - 3} 项需要检查</span>}
          </div>
        )}
        <div className="text-[10px] leading-relaxed text-white/30">直接拖动关节可旋转；按住 Shift 拖动手腕或脚踝可用 IK 移动末端。</div>
      </section>
    </div>
  )
}
