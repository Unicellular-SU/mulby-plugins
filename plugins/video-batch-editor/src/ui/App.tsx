import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Crop,
  Download,
  FileDown,
  FileVideo2,
  FolderOpen,
  Gauge,
  Import,
  Loader2,
  Play,
  RefreshCw,
  RotateCw,
  Scissors,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Wand2
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'

const PLUGIN_ID = 'video-batch-editor'

type VideoPreset = 'mp4-h264' | 'mp4-h265' | 'webm' | 'cover-jpg'
type TimeMode = 'full' | 'range' | 'first' | 'remove-start'
type CropMode = 'none' | 'manual' | 'center-square' | 'center-portrait' | 'center-landscape'
type OrientationMode = 'keep' | 'landscape' | 'portrait' | 'square' | 'rotate-left' | 'rotate-right'
type FfmpegStatus = 'checking' | 'available' | 'missing' | 'idle' | 'downloading' | 'running'
type JobRunStatus = 'ready' | 'running' | 'done' | 'failed' | 'stopped'

type VideoFileSummary = {
  path: string
  name: string
  size: number
  ok: boolean
  error?: string
}

type ScanSkippedItem = {
  path: string
  name: string
  reason: string
}

type PreparedJob = {
  id: string
  sourcePath: string
  sourceName: string
  outputPath: string
  preset: VideoPreset
  args: string[]
  commandPreview: string
  status: JobRunStatus
  error?: string
}

type JobOptions = {
  preset: VideoPreset
  outputDirectory?: string
  timeMode: TimeMode
  trimStartSeconds: number
  trimDurationSeconds: number
  removeStartSeconds: number
  cropMode: CropMode
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  orientationMode: OrientationMode
  width: number
  height: number
  videoBitrateKbps: number
  crf: number
  watermarkText: string
}

type PluginInitData = {
  attachments?: { path?: string; name?: string }[]
}

const VIDEO_FILTER = [
  'mp4',
  'mov',
  'm4v',
  'mkv',
  'webm',
  'avi',
  'wmv',
  'flv',
  'ts',
  'mpeg',
  'mpg'
]

const PRESETS: Array<{ value: VideoPreset; label: string; hint: string }> = [
  { value: 'mp4-h264', label: 'MP4 / H.264', hint: '通用上传' },
  { value: 'mp4-h265', label: 'MP4 / H.265', hint: '体积优先' },
  { value: 'webm', label: 'WebM / VP9', hint: '网页分发' },
  { value: 'cover-jpg', label: '封面 JPG', hint: '截帧导出' }
]

const TIME_MODES: Array<{ value: TimeMode; label: string }> = [
  { value: 'full', label: '完整视频' },
  { value: 'range', label: '指定片段' },
  { value: 'first', label: '截取开头' },
  { value: 'remove-start', label: '去掉开头' }
]

const CROP_MODES: Array<{ value: CropMode; label: string }> = [
  { value: 'none', label: '不裁剪' },
  { value: 'manual', label: '手动裁剪' },
  { value: 'center-square', label: '中心 1:1' },
  { value: 'center-portrait', label: '中心 9:16' },
  { value: 'center-landscape', label: '中心 16:9' }
]

const ORIENTATION_MODES: Array<{ value: OrientationMode; label: string }> = [
  { value: 'keep', label: '保持原方向' },
  { value: 'landscape', label: '转横屏 16:9' },
  { value: 'portrait', label: '转竖屏 9:16' },
  { value: 'square', label: '转方屏 1:1' },
  { value: 'rotate-left', label: '左转 90°' },
  { value: 'rotate-right', label: '右转 90°' }
]

function unwrapHostData<T>(value: unknown): T | undefined {
  if (!value || typeof value !== 'object') return value as T | undefined
  if ('data' in value) return (value as { data?: T }).data
  return value as T
}

function pathsFromOpenDialog(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.filter((value): value is string => typeof value === 'string' && value.length > 0)
  }
  if (result && typeof result === 'object') {
    const data = result as { canceled?: boolean; filePaths?: string[] }
    if (data.canceled) return []
    if (Array.isArray(data.filePaths)) {
      return data.filePaths.filter((value): value is string => typeof value === 'string' && value.length > 0)
    }
  }
  return []
}

function formatBytes(value: number) {
  if (value <= 0) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function baseName(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

function presetLabel(value: VideoPreset) {
  return PRESETS.find((preset) => preset.value === value)?.label ?? value
}

function optionLabel<T extends string>(items: Array<{ value: T; label: string }>, value: T) {
  return items.find((item) => item.value === value)?.label ?? value
}

function jobStatusLabel(status: JobRunStatus) {
  if (status === 'running') return '处理中'
  if (status === 'done') return '完成'
  if (status === 'failed') return '失败'
  if (status === 'stopped') return '已停止'
  return '待执行'
}

function formatProgress(progress: FFmpegRunProgress | null) {
  if (!progress) return '等待进度'
  const items: string[] = []
  if (typeof progress.percent === 'number' && Number.isFinite(progress.percent)) {
    items.push(`${progress.percent.toFixed(1)}%`)
  }
  if (progress.time) items.push(progress.time)
  if (progress.speed) items.push(progress.speed)
  if (progress.size) items.push(progress.size)
  return items.length ? items.join(' / ') : '处理中'
}

function progressPercent(progress: FFmpegRunProgress | null) {
  if (!progress || typeof progress.percent !== 'number' || !Number.isFinite(progress.percent)) return 0
  return Math.max(0, Math.min(100, progress.percent))
}

function downloadProgressText(progress: FFmpegDownloadProgress | null) {
  if (!progress) return ''
  if (progress.phase === 'extracting') return `解压中 ${progress.percent.toFixed(0)}%`
  if (progress.phase === 'done') return '下载完成'
  return `下载中 ${progress.percent.toFixed(0)}%`
}

function formatTimestampForFile(date: Date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

export default function App() {
  const { dialog, filesystem, host, notification, shell, ffmpeg } = useMulby(PLUGIN_ID)
  const [files, setFiles] = useState<VideoFileSummary[]>([])
  const [jobs, setJobs] = useState<PreparedJob[]>([])
  const [ffmpegStatus, setFfmpegStatus] = useState<FfmpegStatus>('idle')
  const [ffmpegMessage, setFfmpegMessage] = useState('未检测')
  const [ffmpegPath, setFfmpegPath] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<FFmpegDownloadProgress | null>(null)
  const [runProgress, setRunProgress] = useState<FFmpegRunProgress | null>(null)
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [activeJobName, setActiveJobName] = useState('')
  const [busy, setBusy] = useState(false)
  const activeTaskRef = useRef<FFmpegTask | null>(null)
  const stopRequestedRef = useRef(false)
  const [options, setOptions] = useState<JobOptions>({
    preset: 'mp4-h264',
    outputDirectory: '',
    timeMode: 'full',
    trimStartSeconds: 0,
    trimDurationSeconds: 10,
    removeStartSeconds: 0,
    cropMode: 'none',
    cropX: 0,
    cropY: 0,
    cropWidth: 1080,
    cropHeight: 1080,
    orientationMode: 'keep',
    width: 1920,
    height: 1080,
    videoBitrateKbps: 4500,
    crf: 23,
    watermarkText: ''
  })

  const validFiles = useMemo(() => files.filter((file) => file.ok), [files])
  const invalidCount = files.length - validFiles.length
  const runnableJobs = useMemo(() => jobs.filter((job) => job.status !== 'done'), [jobs])
  const failedJobs = useMemo(() => jobs.filter((job) => job.status === 'failed' || job.status === 'stopped'), [jobs])
  const isRunning = activeJobId !== null
  const canPrepare = validFiles.length > 0 && !busy && !isRunning
  const canRunJobs = runnableJobs.length > 0 && ffmpegStatus === 'available' && !busy && !isRunning
  const canRetryJobs = failedJobs.length > 0 && ffmpegStatus === 'available' && !busy && !isRunning

  const summary = useMemo(() => ({
    total: files.length,
    ready: validFiles.length,
    invalid: invalidCount,
    jobs: jobs.length
  }), [files.length, invalidCount, jobs.length, validFiles.length])

  const inspectAndMergePaths = useCallback(async (paths: string[]) => {
    const nextPaths = paths.filter(Boolean)
    if (!nextPaths.length) return
    setBusy(true)
    setJobs([])
    try {
      const response = await host.call('inspectFiles', nextPaths)
      const data = unwrapHostData<{ files?: VideoFileSummary[] }>(response)
      const rows = data?.files ?? nextPaths.map((filePath) => ({
        path: filePath,
        name: baseName(filePath),
        size: 0,
        ok: true
      }))

      setFiles((previous) => {
        const map = new Map(previous.map((file) => [file.path, file]))
        for (const row of rows) {
          map.set(row.path, row)
        }
        return Array.from(map.values())
      })
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '导入失败', 'error')
    } finally {
      setBusy(false)
    }
  }, [host, notification])

  const scanAndMergeDirectories = useCallback(async (directoryPaths: string[]) => {
    const nextPaths = directoryPaths.filter(Boolean)
    if (!nextPaths.length) return
    setBusy(true)
    setJobs([])
    try {
      const response = await host.call('scanDirectories', nextPaths)
      const data = unwrapHostData<{
        files?: VideoFileSummary[]
        skipped?: ScanSkippedItem[]
        skippedCount?: number
        truncated?: boolean
      }>(response)
      const rows = data?.files ?? []

      setFiles((previous) => {
        const map = new Map(previous.map((file) => [file.path, file]))
        for (const row of rows) {
          map.set(row.path, row)
        }
        return Array.from(map.values())
      })

      const skippedCount = data?.skippedCount ?? data?.skipped?.length ?? 0
      const truncatedText = data?.truncated ? '，已达到扫描上限' : ''
      const type = rows.length > 0 ? 'success' : 'warning'
      notification.show(`已从文件夹导入 ${rows.length} 个视频，跳过 ${skippedCount} 项${truncatedText}`, type)
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '文件夹扫描失败', 'error')
    } finally {
      setBusy(false)
    }
  }, [host, notification])

  const checkFfmpeg = useCallback(async () => {
    if (!ffmpeg) {
      setFfmpegStatus('missing')
      setFfmpegPath(null)
      setFfmpegMessage('当前 Mulby 版本未提供内置 FFmpeg')
      return
    }
    setFfmpegStatus('checking')
    setFfmpegMessage('检测中')
    try {
      const available = await ffmpeg.isAvailable()
      if (available) {
        const [version, runtimePath] = await Promise.all([
          ffmpeg.getVersion(),
          ffmpeg.getPath()
        ])
        setFfmpegStatus('available')
        setFfmpegPath(runtimePath)
        setFfmpegMessage(version ? `内置 FFmpeg 可用：${version}` : '内置 FFmpeg 可用')
      } else {
        setFfmpegStatus('missing')
        setFfmpegPath(null)
        setFfmpegMessage('内置 FFmpeg 未安装')
      }
    } catch (error) {
      setFfmpegStatus('missing')
      setFfmpegPath(null)
      setFfmpegMessage(error instanceof Error ? error.message : '检测失败')
    }
  }, [ffmpeg])

  const downloadFfmpeg = useCallback(async () => {
    if (!ffmpeg || busy || isRunning) return
    setFfmpegStatus('downloading')
    setFfmpegMessage('正在下载内置 FFmpeg')
    setDownloadProgress(null)
    try {
      const result = await ffmpeg.download((progress) => {
        setDownloadProgress(progress)
        setFfmpegMessage(downloadProgressText(progress))
      })
      if (!result.success) {
        setFfmpegStatus('missing')
        setFfmpegMessage(result.error || 'FFmpeg 下载失败')
        notification.show(result.error || 'FFmpeg 下载失败', 'error')
        return
      }
      notification.show('FFmpeg 下载完成', 'success')
      setDownloadProgress(null)
      await checkFfmpeg()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'FFmpeg 下载失败'
      setFfmpegStatus('missing')
      setFfmpegMessage(message)
      notification.show(message, 'error')
    }
  }, [busy, checkFfmpeg, ffmpeg, isRunning, notification])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = params.get('theme') === 'dark' ? 'dark' : 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const paths = (data.attachments ?? [])
        .map((attachment) => attachment.path)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      void inspectAndMergePaths(paths)
    })

    void (async () => {
      try {
        const response = await host.call('getPendingInit')
        const data = unwrapHostData<{ paths?: string[] }>(response)
        if (data?.paths?.length) {
          await inspectAndMergePaths(data.paths)
        }
      } catch {
        /* Mulby host may not be ready during browser-only preview. */
      }
      await checkFfmpeg()
    })()
  }, [checkFfmpeg, host, inspectAndMergePaths])

  const pickFiles = async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择视频文件',
        filters: [{ name: 'Video', extensions: VIDEO_FILTER }],
        properties: ['openFile', 'multiSelections', 'showHiddenFiles']
      })
      await inspectAndMergePaths(pathsFromOpenDialog(result))
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '无法打开文件选择框', 'error')
    }
  }

  const pickDirectories = async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择视频文件夹',
        properties: ['openDirectory', 'multiSelections', 'showHiddenFiles']
      })
      await scanAndMergeDirectories(pathsFromOpenDialog(result))
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '无法打开文件夹选择框', 'error')
    }
  }

  const pickOutputDirectory = async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '选择输出目录',
        properties: ['openDirectory', 'showHiddenFiles']
      })
      const [directory] = pathsFromOpenDialog(result)
      if (directory) {
        setOptions((previous) => ({ ...previous, outputDirectory: directory }))
        setJobs([])
      }
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '无法选择输出目录', 'error')
    }
  }

  const prepareJobs = async () => {
    if (!canPrepare) return
    setBusy(true)
    try {
      const response = await host.call(
        'prepareJobs',
        validFiles.map((file) => file.path),
        {
          ...options,
          outputDirectory: options.outputDirectory || undefined,
          watermarkText: options.watermarkText.trim() || undefined
        }
      )
      const data = unwrapHostData<{ jobs?: PreparedJob[] }>(response)
      const nextJobs = data?.jobs ?? []
      setJobs(nextJobs.map((job) => ({ ...job, status: 'ready' as const, error: undefined })))
      notification.show(`已生成 ${nextJobs.length} 个任务`, nextJobs.length > 0 ? 'success' : 'warning')
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '任务生成失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeFile = (filePath: string) => {
    if (isRunning) return
    setFiles((previous) => previous.filter((file) => file.path !== filePath))
    setJobs((previous) => previous.filter((job) => job.sourcePath !== filePath))
  }

  const clearFiles = () => {
    if (isRunning) return
    setFiles([])
    setJobs([])
  }

  const stopQueue = () => {
    if (!activeTaskRef.current) return
    stopRequestedRef.current = true
    activeTaskRef.current.quit()
    notification.show('已请求停止当前 FFmpeg 任务', 'info')
  }

  const runQueue = async (jobIds?: string[]) => {
    const targetIdSet = jobIds ? new Set(jobIds) : null
    const selectedJobs = jobs.filter((job) => (
      targetIdSet ? targetIdSet.has(job.id) : job.status !== 'done'
    ))
    if (!ffmpeg || !selectedJobs.length || ffmpegStatus !== 'available' || busy || isRunning) return
    setBusy(true)
    setFfmpegStatus('running')
    stopRequestedRef.current = false
    let successCount = 0
    let failedCount = 0
    let stoppedCount = 0

    try {
      for (const job of selectedJobs) {
        if (stopRequestedRef.current) break
        setActiveJobId(job.id)
        setActiveJobName(job.sourceName)
        setRunProgress(null)
        setJobs((previous) => previous.map((item) => (
          item.id === job.id ? { ...item, status: 'running', error: undefined } : item
        )))

        const task = ffmpeg.run(job.args, (progress) => {
          setRunProgress(progress)
        })
        activeTaskRef.current = task

        try {
          await task.promise
          if (stopRequestedRef.current) {
            stoppedCount += 1
            setJobs((previous) => previous.map((item) => (
              item.id === job.id ? { ...item, status: 'stopped' } : item
            )))
            break
          }
          successCount += 1
          setJobs((previous) => previous.map((item) => (
            item.id === job.id ? { ...item, status: 'done' } : item
          )))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (stopRequestedRef.current) {
            stoppedCount += 1
            setJobs((previous) => previous.map((item) => (
              item.id === job.id ? { ...item, status: 'stopped', error: message } : item
            )))
            break
          }
          failedCount += 1
          setJobs((previous) => previous.map((item) => (
            item.id === job.id ? { ...item, status: 'failed', error: message } : item
          )))
        } finally {
          activeTaskRef.current = null
        }
      }

      if (stopRequestedRef.current) {
        notification.show(`队列已停止，成功 ${successCount}，失败 ${failedCount}，停止 ${stoppedCount}`, 'warning')
      } else if (failedCount > 0) {
        notification.show(`队列完成：成功 ${successCount}，失败 ${failedCount}`, 'warning')
      } else {
        notification.show(`队列完成：成功 ${successCount}`, 'success')
      }
    } finally {
      setBusy(false)
      setActiveJobId(null)
      setActiveJobName('')
      setRunProgress(null)
      stopRequestedRef.current = false
      await checkFfmpeg()
    }
  }

  const retryFailedJobs = async () => {
    if (!canRetryJobs) return
    await runQueue(failedJobs.map((job) => job.id))
  }

  const revealOutput = async (job: PreparedJob) => {
    if (!window.mulby?.shell?.showItemInFolder) {
      notification.show('当前 Mulby 版本未提供输出定位 API', 'error')
      return
    }
    try {
      await shell.showItemInFolder(job.outputPath)
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '无法定位输出文件', 'error')
    }
  }

  const exportRunLog = async () => {
    if (!files.length && !jobs.length) {
      notification.show('暂无可导出的日志', 'warning')
      return
    }
    if (!window.mulby?.dialog?.showSaveDialog || !window.mulby?.filesystem?.writeFile) {
      notification.show('当前 Mulby 版本未提供日志导出 API', 'error')
      return
    }

    try {
      const exportedAt = new Date()
      const savePath = await dialog.showSaveDialog({
        title: '导出处理日志',
        defaultPath: `video-batch-editor-log-${formatTimestampForFile(exportedAt)}.json`,
        buttonLabel: '导出',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!savePath) return

      const payload = {
        pluginId: PLUGIN_ID,
        exportedAt: exportedAt.toISOString(),
        ffmpeg: {
          status: ffmpegStatus,
          message: ffmpegMessage,
          path: ffmpegPath
        },
        options: {
          ...options,
          outputDirectory: options.outputDirectory || null,
          watermarkText: options.watermarkText.trim() || null
        },
        summary,
        files,
        jobs
      }

      await filesystem.writeFile(savePath, JSON.stringify(payload, null, 2), 'utf-8')
      notification.show('日志已导出', 'success')
    } catch (error) {
      notification.show(error instanceof Error ? error.message : '日志导出失败', 'error')
    }
  }

  const updateNumberOption = (key: keyof Pick<JobOptions, 'trimStartSeconds' | 'trimDurationSeconds' | 'removeStartSeconds' | 'cropX' | 'cropY' | 'cropWidth' | 'cropHeight' | 'width' | 'height' | 'videoBitrateKbps' | 'crf'>, value: string) => {
    const numeric = value === '' ? 0 : Number(value)
    setOptions((previous) => ({ ...previous, [key]: Number.isFinite(numeric) ? numeric : 0 }))
    setJobs([])
  }

  const updateOption = <T extends keyof JobOptions>(key: T, value: JobOptions[T]) => {
    setOptions((previous) => ({ ...previous, [key]: value }))
    setJobs([])
  }

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const list = event.dataTransfer?.files
    if (!list?.length) return
    const paths: string[] = []
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index] as File & { path?: string }
      if (file.path) paths.push(file.path)
    }
    if (paths.length > 0) {
      void inspectAndMergePaths(paths)
    } else {
      notification.show('未读取到本地路径', 'warning')
    }
  }

  const ffmpegClassName = `status-pill ${ffmpegStatus}`

  return (
    <div className="app-shell" onDragOver={onDragOver} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand-mark" aria-hidden>
          <FileVideo2 size={22} />
        </div>
        <div className="title-block">
          <h1>视频批量编辑</h1>
          <span>Batch Video Workbench</span>
        </div>
        <div className={ffmpegClassName}>
          {ffmpegStatus === 'available' ? <CheckCircle2 size={15} /> : ffmpegStatus === 'checking' || ffmpegStatus === 'downloading' || ffmpegStatus === 'running' ? <Loader2 size={15} /> : <AlertCircle size={15} />}
          <span>{ffmpegMessage}</span>
        </div>
        <button type="button" className="icon-button" onClick={checkFfmpeg} aria-label="重新检测 FFmpeg">
          <RefreshCw size={18} />
        </button>
        {ffmpegStatus === 'missing' && (
          <button type="button" className="secondary-button compact-button" onClick={downloadFfmpeg} disabled={!ffmpeg || busy || isRunning}>
            <Download size={16} />
            下载 FFmpeg
          </button>
        )}
      </header>

      <main className="workspace">
        <section className="queue-panel">
          <div className="panel-head">
            <div>
              <h2>文件队列</h2>
              <p>{summary.ready} 可处理 / {summary.total} 总数 / {summary.invalid} 异常</p>
            </div>
            <div className="head-actions">
              <button type="button" className="primary-button" onClick={pickFiles} disabled={busy}>
                <Import size={17} />
                导入视频
              </button>
              <button type="button" className="secondary-button" onClick={pickDirectories} disabled={busy}>
                <FolderOpen size={17} />
                导入文件夹
              </button>
              <button type="button" className="ghost-button" onClick={clearFiles} disabled={!files.length || busy} aria-label="清空队列">
                <Trash2 size={17} />
              </button>
            </div>
          </div>

          <div className="metrics">
            <div>
              <span>任务</span>
              <strong>{summary.jobs}</strong>
            </div>
            <div>
              <span>预设</span>
              <strong>{presetLabel(options.preset)}</strong>
            </div>
            <div>
              <span>CRF</span>
              <strong>{options.preset === 'cover-jpg' ? '-' : options.crf}</strong>
            </div>
          </div>

          <div className="file-table" role="table">
            <div className="table-row table-head" role="row">
              <span>文件</span>
              <span>大小</span>
              <span>状态</span>
              <span />
            </div>
            {files.length === 0 ? (
              <div className="empty-state">
                <FileVideo2 size={32} />
                <span>暂无视频</span>
              </div>
            ) : files.map((file) => (
              <div className="table-row" role="row" key={file.path}>
                <div className="file-cell">
                  <FileVideo2 size={18} />
                  <div>
                    <strong title={file.name}>{file.name}</strong>
                    <small title={file.path}>{file.path}</small>
                  </div>
                </div>
                <span>{formatBytes(file.size)}</span>
                <span className={file.ok ? 'state-ok' : 'state-error'}>
                  {file.ok ? '就绪' : file.error ?? '异常'}
                </span>
                <button type="button" className="icon-button subtle" onClick={() => removeFile(file.path)} aria-label={`移除 ${file.name}`}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <aside className="config-panel">
          <div className="panel-head compact">
            <div>
              <h2>处理配置</h2>
              <p>{activeJobName ? `正在处理 ${activeJobName}` : jobs.length > 0 ? `${jobs.length} 个命令已生成` : '等待生成任务'}</p>
            </div>
            <Settings2 size={20} />
          </div>

          {(downloadProgress || runProgress || ffmpegPath) && (
            <div className="runtime-panel">
              <div className="runtime-row">
                <span>{activeJobName ? '任务进度' : downloadProgress ? '下载进度' : 'FFmpeg 路径'}</span>
                <strong title={activeJobName ? formatProgress(runProgress) : downloadProgress ? downloadProgressText(downloadProgress) : ffmpegPath ?? ''}>
                  {activeJobName ? formatProgress(runProgress) : downloadProgress ? downloadProgressText(downloadProgress) : ffmpegPath}
                </strong>
              </div>
              {(downloadProgress || runProgress) && (
                <div className="progress-track" aria-hidden>
                  <span style={{ width: `${downloadProgress ? downloadProgress.percent : progressPercent(runProgress)}%` }} />
                </div>
              )}
            </div>
          )}

          <label className="field">
            <span>导出预设</span>
            <select
              value={options.preset}
              onChange={(event) => updateOption('preset', event.target.value as VideoPreset)}
            >
              {PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label} - {preset.hint}
                </option>
              ))}
            </select>
          </label>

          <div className="config-group">
            <div className="group-title">
              <Scissors size={15} />
              <span>批量截取</span>
              <em>{optionLabel(TIME_MODES, options.timeMode)}</em>
            </div>
            <label className="field">
              <span>截取方式</span>
              <select
                value={options.timeMode}
                onChange={(event) => updateOption('timeMode', event.target.value as TimeMode)}
              >
                {TIME_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            {options.timeMode === 'range' && (
              <div className="field-grid">
                <label className="field">
                  <span>起点秒</span>
                  <input
                    type="number"
                    min={0}
                    value={options.trimStartSeconds}
                    onChange={(event) => updateNumberOption('trimStartSeconds', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>时长秒</span>
                  <input
                    type="number"
                    min={0}
                    value={options.trimDurationSeconds}
                    onChange={(event) => updateNumberOption('trimDurationSeconds', event.target.value)}
                  />
                </label>
              </div>
            )}

            {options.timeMode === 'first' && (
              <label className="field">
                <span>截取前 N 秒</span>
                <input
                  type="number"
                  min={1}
                  value={options.trimDurationSeconds}
                  onChange={(event) => updateNumberOption('trimDurationSeconds', event.target.value)}
                />
              </label>
            )}

            {options.timeMode === 'remove-start' && (
              <label className="field">
                <span>去掉开头秒数</span>
                <input
                  type="number"
                  min={0}
                  value={options.removeStartSeconds}
                  onChange={(event) => updateNumberOption('removeStartSeconds', event.target.value)}
                />
              </label>
            )}
          </div>

          {options.preset !== 'cover-jpg' && (
            <div className="config-group">
              <div className="group-title">
                <Crop size={15} />
                <span>画面裁剪</span>
                <em>{optionLabel(CROP_MODES, options.cropMode)}</em>
              </div>
              <label className="field">
                <span>裁剪模式</span>
                <select
                  value={options.cropMode}
                  onChange={(event) => updateOption('cropMode', event.target.value as CropMode)}
                >
                  {CROP_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>

              {options.cropMode === 'manual' && (
                <>
                  <div className="field-grid">
                    <label className="field">
                      <span>X</span>
                      <input
                        type="number"
                        min={0}
                        value={options.cropX}
                        onChange={(event) => updateNumberOption('cropX', event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>Y</span>
                      <input
                        type="number"
                        min={0}
                        value={options.cropY}
                        onChange={(event) => updateNumberOption('cropY', event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="field-grid">
                    <label className="field">
                      <span>裁剪宽度</span>
                      <input
                        type="number"
                        min={2}
                        step={2}
                        value={options.cropWidth}
                        onChange={(event) => updateNumberOption('cropWidth', event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>裁剪高度</span>
                      <input
                        type="number"
                        min={2}
                        step={2}
                        value={options.cropHeight}
                        onChange={(event) => updateNumberOption('cropHeight', event.target.value)}
                      />
                    </label>
                  </div>
                </>
              )}
            </div>
          )}

          {options.preset !== 'cover-jpg' && (
            <div className="config-group">
              <div className="group-title">
                <RotateCw size={15} />
                <span>横竖屏转换</span>
                <em>{optionLabel(ORIENTATION_MODES, options.orientationMode)}</em>
              </div>
              <label className="field">
                <span>方向/比例</span>
                <select
                  value={options.orientationMode}
                  onChange={(event) => updateOption('orientationMode', event.target.value as OrientationMode)}
                >
                  {ORIENTATION_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {options.preset !== 'cover-jpg' && options.orientationMode === 'keep' && (
            <div className="config-group compact-group">
              <div className="group-title">
                <span>输出尺寸</span>
                <em>{options.width || '-'} x {options.height || '-'}</em>
              </div>
              <div className="field-grid">
                <label className="field">
                  <span>宽度</span>
                  <input
                    type="number"
                    min={0}
                    step={2}
                    value={options.width}
                    onChange={(event) => updateNumberOption('width', event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>高度</span>
                  <input
                    type="number"
                    min={0}
                    step={2}
                    value={options.height}
                    onChange={(event) => updateNumberOption('height', event.target.value)}
                  />
                </label>
              </div>
            </div>
          )}

          {options.preset !== 'cover-jpg' && (
            <div className="config-group">
              <div className="group-title">
                <Gauge size={15} />
                <span>编码参数</span>
                <em>{options.preset === 'webm' ? `${options.videoBitrateKbps} kbps` : `CRF ${options.crf}`}</em>
              </div>
              <label className="field">
                <span><Gauge size={14} /> 码率 kbps</span>
                <input
                  type="number"
                  min={300}
                  value={options.videoBitrateKbps}
                  onChange={(event) => updateNumberOption('videoBitrateKbps', event.target.value)}
                />
              </label>

              <label className="field">
                <span>CRF {options.crf}</span>
                <input
                  type="range"
                  min={0}
                  max={51}
                  value={options.crf}
                  onChange={(event) => updateNumberOption('crf', event.target.value)}
                />
              </label>

              <label className="field">
                <span><Sparkles size={14} /> 文字水印</span>
                <input
                  type="text"
                  value={options.watermarkText}
                  placeholder="可选"
                  onChange={(event) => {
                    updateOption('watermarkText', event.target.value)
                  }}
                />
              </label>
            </div>
          )}

          <label className="field">
            <span>输出目录</span>
            <div className="directory-row">
              <input
                type="text"
                value={options.outputDirectory}
                placeholder="默认原目录"
                onChange={(event) => updateOption('outputDirectory', event.target.value)}
              />
              <button type="button" className="icon-button" onClick={pickOutputDirectory} aria-label="选择输出目录">
                <FolderOpen size={17} />
              </button>
            </div>
          </label>

          <div className="action-row">
            <button type="button" className="primary-button wide" onClick={prepareJobs} disabled={!canPrepare}>
              <Wand2 size={18} />
              生成任务
            </button>
            {isRunning ? (
              <button type="button" className="secondary-button wide danger" onClick={stopQueue}>
                <Square size={18} />
                停止任务
              </button>
            ) : (
              <button type="button" className="secondary-button wide" onClick={() => void runQueue()} disabled={!canRunJobs}>
                <Play size={18} />
                执行队列
              </button>
            )}
          </div>
        </aside>

        <section className="jobs-panel">
          <div className="panel-head">
            <div>
              <h2>任务预览</h2>
              <p>{jobs.length > 0 ? `${jobs.length} 条命令 / ${failedJobs.length} 条可重试` : '未生成命令'}</p>
            </div>
            <div className="head-actions">
              <button type="button" className="secondary-button compact-button" onClick={retryFailedJobs} disabled={!canRetryJobs}>
                <RefreshCw size={16} />
                重试失败
              </button>
              <button type="button" className="secondary-button compact-button" onClick={exportRunLog} disabled={(!files.length && !jobs.length) || busy}>
                <FileDown size={16} />
                导出日志
              </button>
              <ClipboardList size={20} />
            </div>
          </div>

          <div className="job-list">
            {jobs.length === 0 ? (
              <div className="empty-state compact-empty">
                <ClipboardList size={30} />
                <span>暂无任务</span>
              </div>
            ) : jobs.map((job) => (
              <article className="job-row" key={job.id}>
                <div className="job-title">
                  <strong>{job.sourceName}</strong>
                  <div className="job-badges">
                    <span>{presetLabel(job.preset)}</span>
                    <em className={`job-status ${job.status}`}>{jobStatusLabel(job.status)}</em>
                  </div>
                </div>
                <code>{job.commandPreview}</code>
                {activeJobId === job.id && (
                  <div className="job-progress">{formatProgress(runProgress)}</div>
                )}
                {job.error && <div className="job-error" title={job.error}>{job.error}</div>}
                <div className="job-output-row">
                  <small title={job.outputPath}>{job.outputPath}</small>
                  <button
                    type="button"
                    className="icon-button subtle"
                    onClick={() => void revealOutput(job)}
                    disabled={job.status !== 'done' || isRunning}
                    aria-label={`定位输出 ${job.sourceName}`}
                  >
                    <FolderOpen size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
