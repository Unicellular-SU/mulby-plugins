import { useCallback, useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  Crop,
  Expand,
  FileCode2,
  FileText,
  FileType2,
  FlipHorizontal,
  FolderOpen,
  Gauge,
  ImageIcon,
  ImagePlus,
  ListOrdered,
  Maximize2,
  Play,
  Plus,
  RotateCw,
  RotateCcw,
  Save,
  Trash2,
  Type,
  Wrench,
  X,
} from 'lucide-react'
import { useMulby } from '../hooks/useMulby'
import type {
  BatchCommitResult,
  BatchPipelinePreset,
  BatchPipelinePresetFile,
  BatchProcessResult,
  BatchStep,
  RasterFormat,
  WatermarkPosition,
} from '../../pipeline/types'
import { PIPELINE_PRESET_SCHEMA_VERSION } from '../../pipeline/types'
import {
  loadLastDirs,
  readStorageJson,
  saveLastDirs,
  STORAGE_KEYS,
  writeStorageJson,
} from '../lib/plugin-storage'

const PLUGIN_ID = 'bulk-image-studio'

const FORMATS: (RasterFormat | 'svg' | 'ico' | 'jpg')[] = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'tiff',
  'avif',
  'bmp',
  'gif',
  'ico',
  'svg',
]

type Gravity = 'center' | 'north' | 'south' | 'east' | 'west'

type StepKind = BatchStep['kind']

const STEP_KIND_OPTIONS: { kind: StepKind; label: string; hint?: string; Icon: LucideIcon }[] = [
  { kind: 'svgMinify', label: 'SVG 优化', hint: '仅对 .svg 有效', Icon: FileCode2 },
  { kind: 'cropAspect', label: '按比例裁剪', Icon: Crop },
  { kind: 'resize', label: '修改尺寸', Icon: Maximize2 },
  { kind: 'rotate', label: '旋转', Icon: RotateCw },
  { kind: 'flip', label: '翻转 / 镜像', Icon: FlipHorizontal },
  { kind: 'padding', label: '补边留白', Icon: Expand },
  { kind: 'watermarkText', label: '文字水印', Icon: Type },
  { kind: 'watermarkImage', label: '图片水印', Icon: ImagePlus },
  { kind: 'rounded', label: '圆角', Icon: CircleDot },
  { kind: 'compress', label: '压缩质量', hint: '光栅图', Icon: Gauge },
  { kind: 'convert', label: '转换格式', Icon: FileType2 },
  { kind: 'toPdf', label: '转成 PDF', hint: '每图一页，须放最后', Icon: FileText },
]

function kindLabel(kind: StepKind): string {
  return STEP_KIND_OPTIONS.find((o) => o.kind === kind)?.label ?? kind
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createDefaultStep(kind: StepKind): BatchStep {
  switch (kind) {
    case 'svgMinify':
      return { kind: 'svgMinify' }
    case 'cropAspect':
      return { kind: 'cropAspect', aspectW: 16, aspectH: 9, gravity: 'center' }
    case 'resize':
      return { kind: 'resize', fit: 'inside', percent: 80 }
    case 'rotate':
      return { kind: 'rotate', angle: 0, background: '#000000' }
    case 'flip':
      return { kind: 'flip', horizontal: true, vertical: false }
    case 'padding':
      return { kind: 'padding', top: 0, right: 0, bottom: 0, left: 0, color: '#ffffff', opacity: 1 }
    case 'watermarkText':
      return {
        kind: 'watermarkText',
        text: 'Watermark',
        fontSize: 24,
        color: '#ffffff',
        opacity: 0.6,
        rotateDeg: 0,
        position: 'br',
        tile: false,
      }
    case 'watermarkImage':
      return {
        kind: 'watermarkImage',
        path: '',
        scale: 0.2,
        opacity: 0.8,
        rotateDeg: 0,
        position: 'br',
        tile: false,
      }
    case 'rounded':
      return { kind: 'rounded', percentOfMinSide: 8 }
    case 'compress':
      return { kind: 'compress', quality: 82 }
    case 'convert':
      return { kind: 'convert', format: 'webp' }
    case 'toPdf':
      return { kind: 'toPdf', pageLayout: 'perImage', marginPts: 36 }
  }
}

function validatePipeline(items: { step: BatchStep }[]): { ok: true; steps: BatchStep[] } | { ok: false; message: string } {
  const steps = items.map((i) => i.step)
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const n = i + 1
    if (s.kind === 'resize') {
      if (s.width == null && s.height == null && s.percent == null) {
        return { ok: false, message: `第 ${n} 步「修改尺寸」请至少填写宽度、高度或缩放百分比中的一项` }
      }
    }
    if (s.kind === 'watermarkText' && !String(s.text ?? '').trim()) {
      return { ok: false, message: `第 ${n} 步「文字水印」请填写水印文字` }
    }
    if (s.kind === 'watermarkImage' && !String(s.path ?? '').trim()) {
      return { ok: false, message: `第 ${n} 步「图片水印」请选择水印图片文件` }
    }
    if (s.kind === 'flip' && !s.horizontal && !s.vertical) {
      return { ok: false, message: `第 ${n} 步「翻转」请至少选择水平或垂直之一` }
    }
  }
  const pdfIndices = steps.map((st, i) => (st.kind === 'toPdf' ? i : -1)).filter((i) => i >= 0)
  if (pdfIndices.length > 1) {
    return { ok: false, message: '「转成 PDF」只能添加一步' }
  }
  if (pdfIndices.length === 1 && pdfIndices[0] !== steps.length - 1) {
    return { ok: false, message: '「转成 PDF」须放在流水线最后一步' }
  }
  return { ok: true, steps }
}

interface PipelineItem {
  id: string
  step: BatchStep
}

interface Props {
  seedPaths: string[]
}

export default function BatchPage({ seedPaths }: Props) {
  const { dialog, notification, host, storage, filesystem } = useMulby(PLUGIN_ID)
  const [files, setFiles] = useState<string[]>([])
  const [pipeline, setPipeline] = useState<PipelineItem[]>([])
  const [nameSuffix, setNameSuffix] = useState('_out')
  const [outputNameTemplate, setOutputNameTemplate] = useState('')
  const [autoExifOrient, setAutoExifOrient] = useState(false)
  const [presets, setPresets] = useState<BatchPipelinePreset[]>([])
  const [presetSelectId, setPresetSelectId] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [staging, setStaging] = useState<BatchProcessResult | null>(null)
  const [committing, setCommitting] = useState(false)
  const batchOtherDirHintRef = useRef<string | undefined>(undefined)
  const presetsLoadedRef = useRef(false)

  useEffect(() => {
    if (seedPaths.length) setFiles((f) => [...new Set([...f, ...seedPaths])])
  }, [seedPaths])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const dirs = await loadLastDirs(storage)
      if (!cancelled) batchOtherDirHintRef.current = dirs.batchOtherDir
      const list = await readStorageJson<BatchPipelinePreset[]>(storage, STORAGE_KEYS.pipelinePresets)
      if (!cancelled && Array.isArray(list)) {
        setPresets(list.filter((p) => p && typeof p.id === 'string' && p.name && Array.isArray(p.steps)))
      }
      const lastId = await readStorageJson<string>(storage, STORAGE_KEYS.pipelinePresetLastId)
      if (!cancelled && typeof lastId === 'string') setPresetSelectId(lastId)
      presetsLoadedRef.current = true
    })()
    return () => {
      cancelled = true
    }
  }, [storage])

  useEffect(() => {
    if (!presetsLoadedRef.current) return
    void writeStorageJson(storage, STORAGE_KEYS.pipelinePresets, presets)
  }, [presets, storage])

  useEffect(() => {
    if (!presetsLoadedRef.current) return
    void writeStorageJson(storage, STORAGE_KEYS.pipelinePresetLastId, presetSelectId || '')
  }, [presetSelectId, storage])

  const persistPresets = useCallback((next: BatchPipelinePreset[]) => {
    setPresets(next)
  }, [])

  const applyPreset = (p: BatchPipelinePreset) => {
    setPipeline(p.steps.map((step) => ({ id: newId(), step })))
    if (p.nameSuffix != null) setNameSuffix(p.nameSuffix)
    setPresetSelectId(p.id)
  }

  const saveCurrentAsPreset = () => {
    const v = validatePipeline(pipeline)
    if (!v.ok) {
      notification.show(v.message, 'warning')
      return
    }
    const name = window.prompt('预设名称', '我的预设')?.trim()
    if (!name) return
    const preset: BatchPipelinePreset = {
      id: newId(),
      name,
      nameSuffix,
      steps: v.steps,
    }
    persistPresets([...presets, preset])
    setPresetSelectId(preset.id)
    notification.show('已保存预设', 'success')
  }

  const deleteSelectedPreset = () => {
    const p = presets.find((x) => x.id === presetSelectId)
    if (!p) {
      notification.show('请先在列表中选一个预设', 'warning')
      return
    }
    if (!window.confirm(`删除预设「${p.name}」？`)) return
    persistPresets(presets.filter((x) => x.id !== presetSelectId))
    setPresetSelectId('')
  }

  const exportPresetsJson = async () => {
    const payload: BatchPipelinePresetFile = { schemaVersion: PIPELINE_PRESET_SCHEMA_VERSION, presets }
    const text = JSON.stringify(payload, null, 2)
    const out = await dialog.showSaveDialog({
      title: '导出流水线预设',
      defaultPath: 'bulk-image-studio-presets.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (!out) return
    try {
      await filesystem.writeFile(out, text, 'utf-8')
      notification.show('已导出', 'success')
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '导出失败', 'error')
    }
  }

  const importPresetsJson = async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入流水线预设',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    const fp = picked?.[0]
    if (!fp) return
    try {
      const raw = await filesystem.readFile(fp, 'utf-8')
      if (typeof raw !== 'string') {
        notification.show('无法读取文件', 'error')
        return
      }
      const data = JSON.parse(raw) as BatchPipelinePresetFile | { presets?: unknown }
      const list = Array.isArray(data.presets) ? (data.presets as BatchPipelinePreset[]) : []
      const merged: BatchPipelinePreset[] = []
      for (const p of list) {
        if (!p || !p.name || !Array.isArray(p.steps)) continue
        const v = validatePipeline(p.steps.map((step) => ({ id: 'x', step })))
        if (!v.ok) continue
        merged.push({
          id: newId(),
          name: p.name,
          nameSuffix: p.nameSuffix,
          steps: v.steps,
        })
      }
      if (!merged.length) {
        notification.show('没有可导入的有效预设', 'warning')
        return
      }
      persistPresets([...presets, ...merged])
      notification.show(`已导入 ${merged.length} 个预设`, 'success')
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '导入失败', 'error')
    }
  }

  const exportStagingErrors = async (errors: { file: string; message: string }[], format: 'csv' | 'txt') => {
    if (!errors.length) return
    const date = new Date().toISOString().slice(0, 10)
    const text =
      format === 'csv'
        ? ['file,message', ...errors.map((e) => `"${e.file.replace(/"/g, '""')}","${e.message.replace(/"/g, '""')}"`)].join('\n')
        : errors.map((e) => `${e.file}\n  ${e.message}`).join('\n\n')
    const out = await dialog.showSaveDialog({
      title: '导出失败列表',
      defaultPath: format === 'csv' ? `batch-errors-${date}.csv` : `batch-errors-${date}.txt`,
      filters: format === 'csv' ? [{ name: 'CSV', extensions: ['csv'] }] : [{ name: '文本', extensions: ['txt'] }],
    })
    if (!out) return
    try {
      await filesystem.writeFile(out, text, 'utf-8')
      notification.show('已导出', 'success')
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '导出失败', 'error')
    }
  }

  const addStep = (kind: StepKind) => {
    setPipeline((p) => [...p, { id: newId(), step: createDefaultStep(kind) }])
  }

  const removeStep = (id: string) => setPipeline((p) => p.filter((x) => x.id !== id))

  const moveStep = (index: number, dir: -1 | 1) => {
    setPipeline((p) => {
      const j = index + dir
      if (j < 0 || j >= p.length) return p
      const next = [...p]
      const t = next[index]
      next[index] = next[j]
      next[j] = t
      return next
    })
  }

  const replaceStep = (id: string, step: BatchStep) => {
    setPipeline((p) => p.map((x) => (x.id === id ? { ...x, step } : x)))
  }

  const addFiles = async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif', 'svg', 'ico'] }],
    })
    if (picked?.length) setFiles((f) => [...new Set([...f, ...picked])])
  }

  const pickWmImgForStep = async (id: string, current: BatchStep) => {
    if (current.kind !== 'watermarkImage') return
    const picked = await dialog.showOpenDialog({
      title: '选择水印图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (picked?.[0]) replaceStep(id, { ...current, path: picked[0] })
  }

  const clearStagingIfAny = async () => {
    if (staging?.staged?.length) {
      try {
        await host.call('batchDiscardStaging', { items: staging.staged })
      } catch {
        /* 忽略 */
      }
    }
    setStaging(null)
  }

  const runProcess = async () => {
    const v = validatePipeline(pipeline)
    if (!v.ok) {
      notification.show(v.message, 'warning')
      return
    }
    if (!files.length) {
      notification.show('请先添加要处理的图片', 'warning')
      return
    }
    if (!v.steps.length) {
      notification.show('请从下拉框添加至少一个处理步骤', 'warning')
      return
    }
    setRunning(true)
    try {
      await clearStagingIfAny()
      const payload = { files, steps: v.steps, nameSuffix: nameSuffix || '_out', autoExifOrient }
      console.log('[bulk-image-studio:ui]', 'host.call batchProcess', {
        fileCount: files.length,
        stepKinds: v.steps.map((s) => s.kind),
      })
      const res = await host.call('batchProcess', payload)
      const data = res?.data as BatchProcessResult
      setStaging(data)
      const errN = data?.errors?.length ?? 0
      const okN = data?.staged?.length ?? 0
      notification.show(
        `处理完成：${okN} 张已暂存，${errN} 张失败。请在上方选择保存方式。`,
        errN && !okN ? 'error' : errN ? 'warning' : 'success'
      )
      if (errN && data.errors.length) console.error(data.errors)
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '批量处理失败', 'error')
    } finally {
      setRunning(false)
    }
  }

  const finishCommit = (data: BatchCommitResult, prev: BatchProcessResult) => {
    const w = data.written.length
    const e = data.errors.length
    notification.show(`已写入 ${w} 个文件${e ? `，${e} 个失败` : ''}`, e ? 'warning' : 'success')
    if (e === 0) {
      setStaging(null)
      return
    }
    const failedSrc = new Set(data.errors.map((x) => x.file))
    const remaining = prev.staged.filter((s) => failedSrc.has(s.sourcePath))
    if (remaining.length === 0) {
      setStaging(null)
      return
    }
    setStaging({ ...prev, staged: remaining })
  }

  const commitOverwrite = async () => {
    const snap = staging
    if (!snap?.staged.length) return
    setCommitting(true)
    try {
      const res = await host.call('batchCommit', {
        mode: 'overwrite',
        nameSuffix: nameSuffix || '_out',
        items: snap.staged,
      })
      const data = res?.data as BatchCommitResult | undefined
      if (!data) {
        notification.show('保存无返回数据', 'error')
        return
      }
      finishCommit(data, snap)
    } catch (err) {
      notification.show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setCommitting(false)
    }
  }

  const commitSameDir = async () => {
    const snap = staging
    if (!snap?.staged.length) return
    setCommitting(true)
    try {
      const tpl = outputNameTemplate.trim()
      const res = await host.call('batchCommit', {
        mode: 'sameDir',
        nameSuffix: nameSuffix || '_out',
        ...(tpl ? { outputNameTemplate: tpl } : {}),
        items: snap.staged,
      })
      const data = res?.data as BatchCommitResult | undefined
      if (!data) {
        notification.show('保存无返回数据', 'error')
        return
      }
      finishCommit(data, snap)
    } catch (err) {
      notification.show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setCommitting(false)
    }
  }

  const commitOtherDir = async () => {
    const snap = staging
    if (!snap?.staged.length) return
    const picked = await dialog.showOpenDialog({
      title: '选择保存目录',
      properties: ['openDirectory'],
      defaultPath: batchOtherDirHintRef.current,
    })
    const dir = picked?.[0]
    if (!dir) return
    setCommitting(true)
    try {
      const tpl = outputNameTemplate.trim()
      const res = await host.call('batchCommit', {
        mode: 'otherDir',
        otherDir: dir,
        nameSuffix: nameSuffix || '_out',
        ...(tpl ? { outputNameTemplate: tpl } : {}),
        items: snap.staged,
      })
      const data = res?.data as BatchCommitResult | undefined
      if (!data) {
        notification.show('保存无返回数据', 'error')
        return
      }
      batchOtherDirHintRef.current = dir
      void saveLastDirs(storage, { batchOtherDir: dir })
      finishCommit(data, snap)
    } catch (err) {
      notification.show(err instanceof Error ? err.message : '保存失败', 'error')
    } finally {
      setCommitting(false)
    }
  }

  const discardStaging = async () => {
    if (!staging?.staged.length) {
      setStaging(null)
      return
    }
    setCommitting(true)
    try {
      await host.call('batchDiscardStaging', { items: staging.staged })
      setStaging(null)
      notification.show('已放弃暂存结果', 'success')
    } catch (err) {
      notification.show(err instanceof Error ? err.message : '清理失败', 'error')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="page batch-page-v2">
      {staging && (
        <section className="batch-staging-banner" aria-live="polite">
          <div className="batch-staging-inner">
            <div className="batch-staging-text">
              <strong>处理结果已就绪</strong>
              <span className="batch-staging-meta">
                可保存 {staging.staged.length} 张
                {staging.errors.length > 0 ? ` · ${staging.errors.length} 张失败` : ''}
              </span>
            </div>
            <div className="batch-staging-actions">
              <button type="button" className="btn sm primary" disabled={!staging.staged.length || committing} onClick={commitOverwrite}>
                <RotateCcw size={14} />
                覆盖原图
              </button>
              <button type="button" className="btn sm secondary" disabled={!staging.staged.length || committing} onClick={commitSameDir}>
                <Save size={14} />
                同目录带后缀
              </button>
              <button type="button" className="btn sm secondary" disabled={!staging.staged.length || committing} onClick={commitOtherDir}>
                <FolderOpen size={14} />
                其他目录
              </button>
              {staging.errors.length > 0 ? (
                <>
                  <button type="button" className="btn sm ghost" disabled={committing} onClick={() => void exportStagingErrors(staging.errors, 'csv')}>
                    导出失败 CSV
                  </button>
                  <button type="button" className="btn sm ghost" disabled={committing} onClick={() => void exportStagingErrors(staging.errors, 'txt')}>
                    导出失败 TXT
                  </button>
                </>
              ) : null}
              <button type="button" className="btn sm ghost" disabled={committing} onClick={discardStaging}>
                放弃
              </button>
            </div>
          </div>
          {staging.errors.length > 0 && (
            <ul className="batch-staging-errors">
              {staging.errors.map((er, i) => (
                <li key={i}>
                  {er.file}: {er.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="batch-triple">
        <aside className="batch-col batch-col-left batch-aside">
          <div className="batch-aside-head">
            <h2>
              <ImageIcon size={16} />
              图片队列
            </h2>
            <span className="batch-badge">{files.length}</span>
          </div>
          <div className="batch-aside-actions">
            <button type="button" className="btn secondary sm" onClick={addFiles}>
              <Plus size={14} />
              添加
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setFiles([])} disabled={!files.length}>
              <Trash2 size={14} />
              清空
            </button>
          </div>
          <div className="batch-file-scroll">
            {files.length === 0 ? (
              <p className="batch-empty-files">尚未添加图片，点击「添加」选择文件。</p>
            ) : (
              <ul className="batch-file-list">
                {files.map((p) => (
                  <li key={p} className="batch-file-item">
                    <span className="batch-file-name" title={p}>
                      {p.replace(/^.*[/\\]/, '')}
                    </span>
                    <button type="button" className="btn icon-only" aria-label="移除" onClick={() => setFiles((f) => f.filter((x) => x !== p))}>
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <details className="batch-aside-details">
            <summary className="batch-aside-details-summary">预设与输出（展开设置）</summary>
            <div className="batch-aside-details-body">
              <div className="batch-preset-bar batch-preset-bar--aside">
                <label className="batch-label" htmlFor="batch-preset-select-aside">
                  流水线预设
                </label>
                <select
                  id="batch-preset-select-aside"
                  className="input batch-input"
                  value={presetSelectId}
                  onChange={(e) => {
                    const id = e.target.value
                    setPresetSelectId(id)
                    const p = presets.find((x) => x.id === id)
                    if (p) applyPreset(p)
                  }}
                >
                  <option value="">— 选用预设 —</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div className="batch-preset-actions">
                  <button type="button" className="btn sm secondary" onClick={saveCurrentAsPreset}>
                    保存当前
                  </button>
                  <button type="button" className="btn sm ghost" onClick={deleteSelectedPreset}>
                    删除
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => void exportPresetsJson()}>
                    导出 JSON
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => void importPresetsJson()}>
                    导入
                  </button>
                </div>
              </div>
              <label className="batch-inline-check batch-aside-check">
                <input type="checkbox" checked={autoExifOrient} onChange={(e) => setAutoExifOrient(e.target.checked)} />
                <span>导入时按 EXIF 自动旋转</span>
              </label>
              <label className="batch-label" htmlFor="batch-output-template-aside">
                输出文件名模板（可选）
              </label>
              <input
                id="batch-output-template-aside"
                className="input batch-input"
                value={outputNameTemplate}
                onChange={(e) => setOutputNameTemplate(e.target.value)}
                placeholder="{stem}_out{index}"
              />
              <p className="hint batch-aside-hint">
                仅同目录/其他目录生效。占位：{'{stem}'} {'{ext}'} {'{index}'} {'{date}'} {'{w}'} {'{h}'}；留空则用后缀。
              </p>
              <label className="batch-label" htmlFor="batch-name-suffix-aside">
                保存用文件名后缀
              </label>
              <input
                id="batch-name-suffix-aside"
                className="input batch-input"
                value={nameSuffix}
                onChange={(e) => setNameSuffix(e.target.value)}
                placeholder="_out"
              />
              <p className="hint batch-aside-hint">同目录/其他目录保存时使用；覆盖原图时扩展名可能替换。</p>
            </div>
          </details>
        </aside>

        <section className="batch-col batch-col-center batch-pipeline">
          <div className="batch-pipeline-head">
            <h2>
              <ListOrdered size={16} />
              处理步骤
            </h2>
            <p className="hint">
              步骤从上到下依次执行。在<strong>右侧工具箱</strong>点击图标添加步骤；预设与输出文件名可在<strong>左侧栏底部</strong>展开「预设与输出」。
            </p>
          </div>

          {pipeline.length === 0 ? (
            <div className="batch-pipeline-empty">
              <p>还没有任何步骤。</p>
              <p className="hint">在右侧「工具箱」中点击压缩、转格式等图标即可加入列表。</p>
            </div>
          ) : (
            <ol className="batch-step-list">
              {pipeline.map((item, index) => (
                <li key={item.id} className="batch-step-card">
                  <div className="batch-step-card-head">
                    <span className="batch-step-index">{index + 1}</span>
                    <span className="batch-step-title">{kindLabel(item.step.kind)}</span>
                    <div className="batch-step-tools">
                      <button
                        type="button"
                        className="btn icon-only"
                        aria-label="上移"
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                      >
                        <ChevronUp size={16} />
                      </button>
                      <button
                        type="button"
                        className="btn icon-only"
                        aria-label="下移"
                        disabled={index === pipeline.length - 1}
                        onClick={() => moveStep(index, 1)}
                      >
                        <ChevronDown size={16} />
                      </button>
                      <button type="button" className="btn icon-only danger" aria-label="删除此步骤" onClick={() => removeStep(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="batch-step-card-body">
                    <StepFields item={item} onChange={(step) => replaceStep(item.id, step)} onPickWatermark={() => pickWmImgForStep(item.id, item.step)} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="batch-col batch-col-right batch-toolbox" aria-label="工具箱">
          <div className="batch-toolbox-head">
            <h2>
              <Wrench size={14} />
              工具箱
            </h2>
          </div>
          <p className="hint batch-toolbox-hint">每次点击添加一种操作，可多次添加组成流水线。命名与预设请在左侧栏展开「预设与输出」。</p>

          <div className="batch-toolbox-scroll">
            <div className="batch-add-bar">
              <span className="batch-add-label" id="batch-add-steps-label">
                添加步骤
              </span>
              <div className="batch-add-grid batch-add-grid-toolbox" role="group" aria-labelledby="batch-add-steps-label">
                {STEP_KIND_OPTIONS.map(({ kind, label, hint, Icon }) => (
                  <button
                    key={kind}
                    type="button"
                    className="batch-add-tile batch-add-tile--toolbox-row"
                    title={hint ? `${label}（${hint}）` : label}
                    onClick={() => addStep(kind)}
                  >
                    <span className="batch-add-tile-icon" aria-hidden>
                      <Icon size={16} strokeWidth={1.65} />
                    </span>
                    <span className="batch-add-tile-text">
                      <span className="batch-add-tile-label">{label}</span>
                      {hint ? <span className="batch-add-tile-hint">{hint}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="batch-toolbox-foot batch-toolbox-foot--minimal">
            <button type="button" className="btn primary batch-run-btn" disabled={running || committing} onClick={runProcess}>
              <Play size={18} />
              {running ? '正在处理…' : '开始处理'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}

function StepFields({
  item,
  onChange,
  onPickWatermark,
}: {
  item: PipelineItem
  onChange: (s: BatchStep) => void
  onPickWatermark: () => void
}) {
  const s = item.step

  const posOpts: { v: WatermarkPosition; l: string }[] = [
    { v: 'tl', l: '左上' },
    { v: 'tr', l: '右上' },
    { v: 'bl', l: '左下' },
    { v: 'br', l: '右下' },
    { v: 'center', l: '居中' },
  ]

  switch (s.kind) {
    case 'svgMinify':
      return <p className="hint step-static-hint">将使用 SVGO 优化 SVG 结构（非像素压缩）。</p>

    case 'cropAspect':
      return (
        <div className="batch-fields-grid">
          <label className="batch-field">
            <span>宽比</span>
            <input className="input" type="number" min={1} value={s.aspectW} onChange={(e) => onChange({ ...s, aspectW: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>高比</span>
            <input className="input" type="number" min={1} value={s.aspectH} onChange={(e) => onChange({ ...s, aspectH: +e.target.value })} />
          </label>
          <label className="batch-field wide">
            <span>裁剪参考</span>
            <select className="input" value={s.gravity ?? 'center'} onChange={(e) => onChange({ ...s, gravity: e.target.value as Gravity })}>
              <option value="center">居中</option>
              <option value="north">靠上</option>
              <option value="south">靠下</option>
              <option value="east">靠右</option>
              <option value="west">靠左</option>
            </select>
          </label>
        </div>
      )

    case 'resize':
      return (
        <div className="batch-fields-grid">
          <label className="batch-field">
            <span>宽度 px</span>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="可选"
              value={s.width ?? ''}
              onChange={(e) => onChange({ ...s, width: e.target.value === '' ? undefined : +e.target.value })}
            />
          </label>
          <label className="batch-field">
            <span>高度 px</span>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="可选"
              value={s.height ?? ''}
              onChange={(e) => onChange({ ...s, height: e.target.value === '' ? undefined : +e.target.value })}
            />
          </label>
          <label className="batch-field">
            <span>缩放 %</span>
            <input
              className="input"
              type="number"
              min={1}
              placeholder="可选"
              value={s.percent ?? ''}
              onChange={(e) => onChange({ ...s, percent: e.target.value === '' ? undefined : +e.target.value })}
            />
          </label>
          <label className="batch-field wide">
            <span>适应方式</span>
            <select className="input" value={s.fit ?? 'inside'} onChange={(e) => onChange({ ...s, fit: e.target.value as 'cover' | 'inside' | 'fill' })}>
              <option value="inside">适应内接（默认）</option>
              <option value="cover">覆盖裁切</option>
              <option value="fill">拉伸填充</option>
            </select>
          </label>
        </div>
      )

    case 'rotate':
      return (
        <div className="batch-fields-grid">
          <label className="batch-field">
            <span>角度 °</span>
            <input className="input" type="number" value={s.angle} onChange={(e) => onChange({ ...s, angle: +e.target.value })} />
          </label>
          <label className="batch-field wide">
            <span>透明/背景色</span>
            <input className="input" value={s.background ?? '#000000'} onChange={(e) => onChange({ ...s, background: e.target.value })} />
          </label>
        </div>
      )

    case 'flip':
      return (
        <div className="batch-toggle-group" role="group" aria-label="镜像方向">
          <button
            type="button"
            className={`batch-toggle ${s.horizontal ? 'on' : ''}`}
            onClick={() => onChange({ ...s, horizontal: !s.horizontal })}
          >
            水平（左右）
          </button>
          <button type="button" className={`batch-toggle ${s.vertical ? 'on' : ''}`} onClick={() => onChange({ ...s, vertical: !s.vertical })}>
            垂直（上下）
          </button>
        </div>
      )

    case 'padding':
      return (
        <div className="batch-fields-grid">
          {(['top', 'right', 'bottom', 'left'] as const).map((k) => (
            <label key={k} className="batch-field">
              <span>{k === 'top' ? '上' : k === 'right' ? '右' : k === 'bottom' ? '下' : '左'} px</span>
              <input className="input" type="number" min={0} value={s[k]} onChange={(e) => onChange({ ...s, [k]: +e.target.value })} />
            </label>
          ))}
          <label className="batch-field wide">
            <span>颜色 #RRGGBB</span>
            <input className="input" value={s.color ?? '#ffffff'} onChange={(e) => onChange({ ...s, color: e.target.value })} />
          </label>
          <label className="batch-field">
            <span>不透明度 0–1</span>
            <input className="input" type="number" step={0.05} min={0} max={1} value={s.opacity ?? 1} onChange={(e) => onChange({ ...s, opacity: +e.target.value })} />
          </label>
        </div>
      )

    case 'watermarkText':
      return (
        <div className="batch-fields-grid">
          <label className="batch-field full">
            <span>文字</span>
            <input className="input" value={s.text} onChange={(e) => onChange({ ...s, text: e.target.value })} />
          </label>
          <label className="batch-field">
            <span>字号</span>
            <input className="input" type="number" min={8} value={s.fontSize ?? 24} onChange={(e) => onChange({ ...s, fontSize: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>颜色</span>
            <input className="input" value={s.color ?? '#ffffff'} onChange={(e) => onChange({ ...s, color: e.target.value })} />
          </label>
          <label className="batch-field">
            <span>不透明度</span>
            <input className="input" type="number" step={0.05} min={0} max={1} value={s.opacity ?? 0.6} onChange={(e) => onChange({ ...s, opacity: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>旋转 °</span>
            <input className="input" type="number" value={s.rotateDeg ?? 0} onChange={(e) => onChange({ ...s, rotateDeg: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>位置</span>
            <select className="input" value={s.position ?? 'br'} onChange={(e) => onChange({ ...s, position: e.target.value as WatermarkPosition })}>
              {posOpts.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </label>
          <label className="batch-field full batch-inline-check">
            <input type="checkbox" checked={!!s.tile} onChange={(e) => onChange({ ...s, tile: e.target.checked })} />
            <span>平铺整图</span>
          </label>
        </div>
      )

    case 'watermarkImage':
      return (
        <div className="batch-fields-grid">
          <div className="batch-field full batch-wm-row">
            <span className="batch-label-inline">水印文件</span>
            <input className="input flex1" readOnly value={s.path} placeholder="未选择文件" />
            <button type="button" className="btn secondary sm" onClick={onPickWatermark}>
              浏览…
            </button>
          </div>
          <label className="batch-field">
            <span>相对主图宽度比</span>
            <input className="input" type="number" step={0.05} min={0.05} max={1} value={s.scale ?? 0.2} onChange={(e) => onChange({ ...s, scale: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>不透明度</span>
            <input className="input" type="number" step={0.05} min={0} max={1} value={s.opacity ?? 0.8} onChange={(e) => onChange({ ...s, opacity: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>旋转 °</span>
            <input className="input" type="number" value={s.rotateDeg ?? 0} onChange={(e) => onChange({ ...s, rotateDeg: +e.target.value })} />
          </label>
          <label className="batch-field">
            <span>位置</span>
            <select className="input" value={s.position ?? 'br'} onChange={(e) => onChange({ ...s, position: e.target.value as WatermarkPosition })}>
              {posOpts.map((o) => (
                <option key={o.v} value={o.v}>
                  {o.l}
                </option>
              ))}
            </select>
          </label>
          <label className="batch-field full batch-inline-check">
            <input type="checkbox" checked={!!s.tile} onChange={(e) => onChange({ ...s, tile: e.target.checked })} />
            <span>平铺整图</span>
          </label>
        </div>
      )

    case 'rounded':
      return (
        <label className="batch-field">
          <span>圆角占短边百分比（1–50）</span>
          <input
            className="input"
            type="number"
            min={1}
            max={50}
            value={s.percentOfMinSide ?? 8}
            onChange={(e) => onChange({ ...s, percentOfMinSide: +e.target.value })}
          />
        </label>
      )

    case 'compress':
      return (
        <label className="batch-field">
          <span>质量 1–100</span>
          <input className="input" type="number" min={1} max={100} value={s.quality ?? 82} onChange={(e) => onChange({ ...s, quality: +e.target.value })} />
        </label>
      )

    case 'convert':
      return (
        <label className="batch-field wide">
          <span>目标格式</span>
          <select
            className="input"
            value={s.format}
            onChange={(e) => onChange({ ...s, format: e.target.value as RasterFormat | 'svg' | 'ico' | 'jpg' })}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      )

    case 'toPdf':
      return (
        <div className="batch-fields-grid">
          <label className="batch-field wide">
            <span>页面版式</span>
            <select
              className="input"
              value={s.pageLayout ?? 'perImage'}
              onChange={(e) => onChange({ ...s, pageLayout: e.target.value as 'perImage' | 'a4' })}
            >
              <option value="perImage">尺寸随图（一页即整张图）</option>
              <option value="a4">A4 内接居中</option>
            </select>
          </label>
          {(s.pageLayout ?? 'perImage') === 'a4' ? (
            <label className="batch-field">
              <span>四边留白（pt）</span>
              <input
                className="input"
                type="number"
                min={0}
                value={s.marginPts ?? 36}
                onChange={(e) => onChange({ ...s, marginPts: +e.target.value })}
              />
            </label>
          ) : null}
          <p className="hint step-static-hint">须保持在流水线最后一步；每张输入图生成一个 PDF 文件。</p>
        </div>
      )

    default:
      return null
  }
}
