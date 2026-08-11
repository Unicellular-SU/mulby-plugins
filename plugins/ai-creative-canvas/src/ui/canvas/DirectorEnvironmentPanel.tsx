import { useEffect, useState } from 'react'
import { Image, Loader2, Trash2, Upload } from 'lucide-react'
import type { DirectorEnvironment } from '../types'

interface Props {
  environment: DirectorEnvironment | null
  busy: boolean
  onImport: () => void
  onClear: () => void
  onDescriptionChange: (description: string) => void
  onRotationChange: (rotation: number, commit: boolean) => void
}

export function DirectorEnvironmentPanel({
  environment,
  busy,
  onImport,
  onClear,
  onDescriptionChange,
  onRotationChange
}: Props) {
  const [description, setDescription] = useState('')
  const rotation = Math.round(environment?.rotation || 0)

  useEffect(() => setDescription(environment?.description || ''), [environment?.assetId, environment?.description])

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-black/15 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-white/55">
          <Image size={12} />
          <span>环境背景</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={onImport}
            className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[10px] text-white/65 transition-colors hover:bg-white/[0.09] hover:text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            {environment ? '替换' : '导入全景'}
          </button>
          {environment && (
            <button
              type="button"
              disabled={busy}
              onClick={onClear}
              title="移除环境背景"
              className="grid h-7 w-7 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-white/45 transition-colors hover:bg-white/[0.09] hover:text-white disabled:opacity-40"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {!environment ? (
        <div className="rounded-lg border border-dashed border-white/10 px-2.5 py-3 text-center text-[10px] leading-relaxed text-white/30">
          支持 JPG、PNG、WebP 等距柱状全景图，建议 2:1 画幅。
        </div>
      ) : (
        <>
          <div className="truncate text-[10px] text-white/45" title={environment.name}>{environment.name || '全景背景'}</div>
          <label className="flex flex-col gap-1 text-[10px] text-white/45">
            水平旋转 <span className="tabular-nums text-white/30">{rotation}°</span>
            <input
              aria-label="环境水平旋转"
              type="range"
              min={-180}
              max={180}
              step={1}
              value={rotation}
              onChange={(event) => onRotationChange(Number(event.target.value), false)}
              onPointerUp={(event) => onRotationChange(Number(event.currentTarget.value), true)}
              onKeyUp={(event) => {
                if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') onRotationChange(Number(event.currentTarget.value), true)
              }}
              className="w-full accent-amber-300"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-white/45">
            环境描述
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => onDescriptionChange(description.trim())}
              placeholder="如：雨夜霓虹街道，湿润路面反光"
              className="h-14 resize-none rounded-lg border border-white/10 bg-white/[0.04] p-2 text-[11px] leading-relaxed text-white/75 outline-none placeholder:text-white/25 focus:border-amber-300/50"
            />
          </label>
        </>
      )}
    </section>
  )
}
