import { useEffect, useState } from 'react'
import { Compass, Image, Loader2, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import type { DirectorEnvironment } from '../types'
import { assessDirectorPanoramaQuality, normalizeDirectorEnvironmentControls } from './directorEnvironment'

interface Props {
  environment: DirectorEnvironment | null
  busy: boolean
  canvasPanoramas: Array<{ id: string; title: string }>
  canvasLoadingId: string | null
  onImport: () => void
  onImportCanvas: (cardId: string) => void
  onClear: () => void
  onDescriptionChange: (description: string) => void
  onSettingsChange: (patch: Partial<DirectorEnvironment>, commit: boolean) => void
}

interface CalibrationRangeProps {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (value: number, commit: boolean) => void
}

function CalibrationRange({ label, value, display, min, max, step, disabled, onChange }: CalibrationRangeProps) {
  const commitOnKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') onChange(Number(event.currentTarget.value), true)
  }
  return (
    <label className={`flex flex-col gap-1 text-[10px] ${disabled ? 'text-white/25' : 'text-white/45'}`}>
      <span className="flex items-center justify-between gap-2">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-white/35">{display}</span>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value), false)}
        onPointerUp={(event) => onChange(Number(event.currentTarget.value), true)}
        onKeyUp={commitOnKey}
        className="w-full accent-amber-300 disabled:opacity-35"
      />
    </label>
  )
}

export function DirectorEnvironmentPanel({
  environment,
  busy,
  canvasPanoramas,
  canvasLoadingId,
  onImport,
  onImportCanvas,
  onClear,
  onDescriptionChange,
  onSettingsChange
}: Props) {
  const [description, setDescription] = useState('')
  const controls = normalizeDirectorEnvironmentControls(environment)
  const rotation = Math.round(environment?.rotation || 0)
  const quality = assessDirectorPanoramaQuality(environment?.width, environment?.height)

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
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[10px] text-white/55" title={environment.name}>{environment.name || '全景背景'}</div>
              {environment.width && environment.height && <div className="mt-0.5 font-mono text-[9px] text-white/30">{environment.width}×{environment.height}</div>}
            </div>
            {quality && (
              <span
                title={quality.detail}
                className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] ${
                  quality.level === 'high' || quality.level === 'standard'
                    ? 'border-white/10 bg-white/[0.05] text-white/65'
                    : 'border-amber-300/20 bg-amber-300/10 text-amber-200/75'
                }`}
              >
                {quality.label}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-white/[0.06] pt-2">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-white/45">
              <SlidersHorizontal size={11} />
              <span>环境校准</span>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.035] p-1">
              {(['grounded', 'infinite'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={busy}
                  onClick={() => onSettingsChange({ mode }, true)}
                  className={`h-7 rounded-md text-[10px] transition-colors active:scale-[0.98] ${controls.mode === mode ? 'bg-amber-300/15 text-amber-100' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/65'} disabled:opacity-40`}
                  title={mode === 'grounded' ? '投影下半球地面，适合固定机位和小范围移机' : '无限远背景，只随视角旋转'}
                >
                  {mode === 'grounded' ? '落地环境' : '无限背景'}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/[0.035] p-1">
              {(['physical', 'adapted'] as const).map((compositionMode) => (
                <button
                  key={compositionMode}
                  type="button"
                  disabled={busy}
                  onClick={() => onSettingsChange({ compositionMode }, true)}
                  className={`h-7 rounded-md text-[10px] transition-colors active:scale-[0.98] ${controls.compositionMode === compositionMode ? 'bg-amber-300/15 text-amber-100' : 'text-white/40 hover:bg-white/[0.05] hover:text-white/65'} disabled:opacity-40`}
                  title={compositionMode === 'physical' ? '背景与主体使用同一个镜头视野，透视和接影更可靠' : '背景使用独立镜头视野，可单独调整视觉尺寸'}
                >
                  {compositionMode === 'physical' ? '物理一致' : '构图适配'}
                </button>
              ))}
            </div>
            <CalibrationRange
              label="背景尺寸"
              value={controls.backgroundScale}
              display={`${Math.round(controls.backgroundScale * 100)}%`}
              min={0.5}
              max={2}
              step={0.05}
              disabled={busy || controls.compositionMode !== 'adapted'}
              onChange={(value, commit) => onSettingsChange({ backgroundScale: value }, commit)}
            />
            <CalibrationRange label="水平旋转" value={rotation} display={`${rotation}°`} min={-180} max={180} step={1} disabled={busy} onChange={(value, commit) => onSettingsChange({ rotation: value }, commit)} />
            <CalibrationRange label="拍摄高度" value={controls.cameraHeight} display={`${controls.cameraHeight.toFixed(1)}m`} min={0.3} max={5} step={0.1} disabled={busy || controls.mode !== 'grounded'} onChange={(value, commit) => onSettingsChange({ cameraHeight: value }, commit)} />
            <CalibrationRange label="地平线校准" value={controls.horizon} display={`${Math.round(controls.horizon)}°`} min={-20} max={20} step={1} disabled={busy} onChange={(value, commit) => onSettingsChange({ horizon: value }, commit)} />
            <CalibrationRange label="画面曝光" value={controls.exposure} display={controls.exposure.toFixed(2)} min={0.25} max={3} step={0.05} disabled={busy} onChange={(value, commit) => onSettingsChange({ exposure: value }, commit)} />
            <CalibrationRange label="环境光" value={controls.environmentIntensity} display={controls.environmentIntensity.toFixed(2)} min={0} max={3} step={0.05} disabled={busy} onChange={(value, commit) => onSettingsChange({ environmentIntensity: value }, commit)} />
            <CalibrationRange label="背景柔化" value={controls.backgroundBlur} display={`${Math.round(controls.backgroundBlur * 100)}%`} min={0} max={1} step={0.05} disabled={busy} onChange={(value, commit) => onSettingsChange({ backgroundBlur: value }, commit)} />
            <CalibrationRange label="接影强度" value={controls.shadowOpacity} display={`${Math.round(controls.shadowOpacity * 100)}%`} min={0} max={1} step={0.05} disabled={busy} onChange={(value, commit) => onSettingsChange({ shadowOpacity: value }, commit)} />
            <div className="rounded-md border border-amber-300/10 bg-amber-300/[0.04] px-2 py-1.5 text-[9px] leading-relaxed text-amber-100/45">
              {controls.compositionMode === 'physical'
                ? '背景与主体共用镜头视野，地面和接影最可靠。'
                : '背景独立构图。调整背景尺寸不会改变人物，但地面透视为近似。'}
            </div>
          </div>

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

      <label className="flex flex-col gap-1 text-[10px] text-white/45">
        当前画布 AI 全景
        <div className="relative">
          <Compass size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/35" />
          <select
            value=""
            disabled={busy || canvasPanoramas.length === 0}
            onChange={(event) => {
              const cardId = event.target.value
              if (cardId) onImportCanvas(cardId)
            }}
            className="h-8 w-full rounded-lg border border-white/10 bg-zinc-900 pl-7 pr-7 text-[10px] text-white/70 outline-none focus:border-amber-300/50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="">{canvasPanoramas.length ? '选择一张全景作为背景' : '当前画布没有可用的 360 全景'}</option>
            {canvasPanoramas.map((panorama) => <option key={panorama.id} value={panorama.id}>{panorama.title}</option>)}
          </select>
          {canvasLoadingId && <Loader2 size={11} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-amber-200" />}
        </div>
        <span className="text-[9px] leading-relaxed text-white/30">会复制全景附件，源卡片删除后导演工程仍可使用。</span>
      </label>

      {environment && (
        <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-2 text-[9px] text-white/30">
          <span>{environment.source === 'canvas' ? '来源：当前画布 360 全景' : environment.source === 'local' ? '来源：本地文件' : '来源：历史工程'}</span>
          {environment.source === 'canvas' && environment.sourceCardId && !canvasPanoramas.some((item) => item.id === environment.sourceCardId) && (
            <span className="text-amber-200/65">源卡已删除，副本可用</span>
          )}
        </div>
      )}
    </section>
  )
}
