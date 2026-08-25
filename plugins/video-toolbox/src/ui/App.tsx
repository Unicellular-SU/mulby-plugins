import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clapperboard,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  Images,
  Layers,
  Loader2,
  Play,
  Scissors,
  X,
  XCircle
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'
import { useTaskQueue, type TaskItem } from './hooks/useTaskQueue'
import {
  buildConvertArgs,
  buildSequenceFramesArgs,
  buildSingleFrameArgs,
  buildTrimFastArgs,
  buildTrimPreciseArgs,
  clipFileName,
  convertedFileName,
  frameFileName,
  resolveCodec,
  type Container,
  type Quality,
  type VideoCodec
} from './lib/ffmpegArgs'
import {
  base64ToArrayBuffer,
  computePercent,
  formatBytes,
  formatClock,
  parseFfmpegTime,
  pathToResourceUrl,
  splitPath
} from './lib/format'

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'ts', 'wmv']

type Tab = 'convert' | 'trim' | 'frames'
type FFmpegPhase = 'checking' | 'ready' | 'missing' | 'downloading' | 'error'

interface SourceInfo {
  path: string
  name: string
  stem: string
  dir: string
  ext: string
  durationSec: number | null
  width: number | null
  height: number | null
  sizeBytes: number | null
  previewable: boolean
}

interface PluginInitPayload {
  attachments?: Array<{ path?: string; name?: string }>
}

const CONTAINER_OPTIONS: Array<{ value: Container; label: string }> = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'mov', label: 'MOV' },
  { value: 'mkv', label: 'MKV' },
  { value: 'webm', label: 'WebM (VP9)' },
  { value: 'gif', label: 'GIF 动图' }
]

const QUALITY_OPTIONS: Array<{ value: Quality; label: string }> = [
  { value: 'high', label: '高画质' },
  { value: 'balanced', label: '均衡' },
  { value: 'compact', label: '小体积' }
]

export default function App() {
  const { ffmpeg, filesystem, dialog, clipboard, notification, shell } = useMulby('video-toolbox')

  const [tab, setTab] = useState<Tab>('convert')
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [ffmpegPhase, setFfmpegPhase] = useState<FFmpegPhase>('checking')
  const [ffmpegPercent, setFfmpegPercent] = useState(0)
  const [ffmpegVersion, setFfmpegVersion] = useState<string>('')
  const [container, setContainer] = useState<Container>('mp4')
  const [codec, setCodec] = useState<VideoCodec>('h264')
  const [quality, setQuality] = useState<Quality>('balanced')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trimPrecise, setTrimPrecise] = useState(false)
  const [frameMode, setFrameMode] = useState<'single' | 'sequence'>('single')
  const [frameFormat, setFrameFormat] = useState<'png' | 'jpg'>('png')
  const [frameInterval, setFrameInterval] = useState(5)
  const [copyToClipboard, setCopyToClipboard] = useState(true)
  const [playheadSec, setPlayheadSec] = useState(0)

  const copyFrameRef = useRef(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    copyFrameRef.current = copyToClipboard
  }, [copyToClipboard])

  const runner = useCallback(
    (args: string[], onProgress: (percent: number) => void, context: { totalSec: number | null }) => {
      return ffmpeg.run(args, (raw) => {
        onProgress(computePercent(parseFfmpegTime(raw.time), raw.percent, context.totalSec))
      })
    },
    [ffmpeg]
  )

  const onTaskDone = useCallback(
    async (task: TaskItem) => {
      void notification.show(`${task.label} 完成`, 'success')
      if (task.kind === 'frame' && task.outputPath && copyFrameRef.current) {
        try {
          const base64 = (await filesystem.readFile(task.outputPath, 'base64')) as string
          await clipboard.writeImage(base64ToArrayBuffer(base64))
          void notification.show('截图已复制到剪贴板', 'success')
        } catch {
          // clipboard copy is best-effort
        }
      }
    },
    [clipboard, filesystem, notification]
  )

  const { tasks, enqueue, cancel, clearFinished } = useTaskQueue(runner, onTaskDone)

  useEffect(() => {
    void (async () => {
      try {
        const available = await ffmpeg.isAvailable()
        if (available) {
          const version = await ffmpeg.getVersion()
          setFfmpegVersion(version || '')
          setFfmpegPhase('ready')
        } else {
          setFfmpegPhase('missing')
        }
      } catch {
        setFfmpegPhase('missing')
      }
    })()
  }, [ffmpeg])

  const loadSource = useCallback(
    async (path: string) => {
      let sizeBytes: number | null = null
      try {
        const stat = await filesystem.stat(path)
        if (stat && typeof stat.size === 'number') sizeBytes = stat.size
      } catch {
        sizeBytes = null
      }
      const parts = splitPath(path)
      setTrimStart(0)
      setTrimEnd(0)
      setPlayheadSec(0)
      setSource({
        path,
        name: parts.name,
        stem: parts.stem,
        dir: parts.dir,
        ext: parts.ext,
        durationSec: null,
        width: null,
        height: null,
        sizeBytes,
        previewable: true
      })
    },
    [filesystem]
  )

  useEffect(() => {
    void (async () => {
      try {
        const raw = await window.mulby.host?.call?.('video-toolbox', 'getPendingInit')
        const data = raw as { success?: boolean; data?: { paths?: string[] } } | undefined
        const first = data?.data?.paths?.[0]
        if (first) void loadSource(first)
      } catch {
        // host rpc is optional before the backend is ready
      }
    })()
  }, [loadSource])

  useEffect(() => {
    const handler = (payload: unknown) => {
      const data = payload as PluginInitPayload
      const first = data?.attachments?.map((item) => item.path).find((path): path is string => Boolean(path))
      if (first) void loadSource(first)
    }
    const disposable = window.mulby.onPluginInit?.(handler)
    return () => disposable?.()
  }, [loadSource])

  const ensureFfmpegReady = useCallback(async (): Promise<boolean> => {
    if (ffmpegPhase === 'ready') return true
    if (ffmpegPhase === 'downloading') return false
    const available = await ffmpeg.isAvailable().catch(() => false)
    if (available) {
      setFfmpegPhase('ready')
      return true
    }
    setFfmpegPhase('downloading')
    setFfmpegPercent(0)
    const result = await ffmpeg.download((progress) => {
      setFfmpegPercent(Math.max(0, Math.min(100, progress.percent)))
    })
    if (!result.success) {
      setFfmpegPhase('error')
      void notification.show(result.error || 'FFmpeg 下载失败', 'error')
      return false
    }
    const version = await ffmpeg.getVersion().catch(() => '')
    setFfmpegVersion(version || '')
    setFfmpegPhase('ready')
    return true
  }, [ffmpeg, ffmpegPhase, notification])

  const handlePickFile = useCallback(async () => {
    try {
      const picked = await dialog.showOpenDialog({
        title: '选择视频文件',
        filters: [{ name: '视频文件', extensions: VIDEO_EXTS }],
        properties: ['openFile']
      })
      const path = picked?.[0]
      if (path) void loadSource(path)
    } catch (error) {
      void notification.show(error instanceof Error ? error.message : '打开文件失败', 'error')
    }
  }, [dialog, loadSource, notification])

  const handleMetadata = useCallback((video: HTMLVideoElement) => {
    setSource((prev) =>
      prev
        ? {
            ...prev,
            durationSec: Number.isFinite(video.duration) ? video.duration : prev.durationSec,
            width: video.videoWidth || null,
            height: video.videoHeight || null
          }
        : prev
    )
    setTrimEnd((prev) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      return duration > 0 ? duration : prev
    })
  }, [])

  const markUnpreviewable = useCallback(() => {
    setSource((prev) => (prev ? { ...prev, previewable: false } : prev))
  }, [])

  const totalDuration = source?.durationSec ?? null

  const startConvert = useCallback(async () => {
    if (!source) return
    if (!(await ensureFfmpegReady())) return
    const output = `${source.dir}/${convertedFileName(source.stem, container)}`
    enqueue({
      kind: 'convert',
      label: `转码 → ${container.toUpperCase()} · ${output.split('/').pop()}`,
      args: buildConvertArgs({ input: source.path, output, container, codec, quality }),
      outputPath: output,
      totalSec: totalDuration
    })
  }, [codec, container, enqueue, ensureFfmpegReady, quality, source, totalDuration])

  const trimDuration = Math.max(0, trimEnd - trimStart)
  const canTrim = Boolean(source) && trimDuration > 0.05

  const startTrim = useCallback(async () => {
    if (!source || !canTrim) return
    if (!(await ensureFfmpegReady())) return
    const ext = trimPrecise ? 'mp4' : source.ext || 'mp4'
    const output = `${source.dir}/${clipFileName(source.stem, trimStart, trimEnd, ext)}`
    const buildArgs = trimPrecise ? buildTrimPreciseArgs : buildTrimFastArgs
    enqueue({
      kind: 'trim',
      label: `剪切 ${formatClock(trimStart)} - ${formatClock(trimEnd)}${trimPrecise ? ' · 精确' : ' · 快速'}`,
      args: buildArgs({ input: source.path, output, startSec: trimStart, durationSec: trimDuration }),
      outputPath: output,
      totalSec: trimDuration
    })
  }, [canTrim, enqueue, ensureFfmpegReady, source, trimDuration, trimEnd, trimPrecise, trimStart])

  const startSingleFrame = useCallback(async () => {
    if (!source) return
    if (!(await ensureFfmpegReady())) return
    const output = `${source.dir}/${frameFileName(source.stem, playheadSec, frameFormat)}`
    enqueue({
      kind: 'frame',
      label: `截图 @ ${formatClock(playheadSec)}`,
      args: buildSingleFrameArgs({ input: source.path, output, atSec: playheadSec }),
      outputPath: output,
      totalSec: null
    })
  }, [enqueue, ensureFfmpegReady, frameFormat, playheadSec, source])

  const startSequenceFrames = useCallback(async () => {
    if (!source || !(await ensureFfmpegReady())) return
    const interval = Math.max(0.1, frameInterval)
    const dir = `${source.dir}/${source.stem}_frames`
    try {
      await filesystem.mkdir(dir)
    } catch {
      // directory may already exist
    }
    const pattern = `${dir}/${source.stem}_%04d.${frameFormat}`
    enqueue({
      kind: 'sequence',
      label: `每 ${interval}s 抽帧 → ${dir.split('/').pop()}/`,
      args: buildSequenceFramesArgs({ input: source.path, pattern, intervalSec: interval }),
      outputPath: dir,
      totalSec: totalDuration
    })
  }, [enqueue, ensureFfmpegReady, filesystem, frameFormat, frameInterval, source, totalDuration])

  const setInPoint = useCallback(() => {
    const t = videoRef.current?.currentTime ?? playheadSec
    setTrimStart(t)
    if (t >= trimEnd) setTrimEnd(totalDuration ?? t + 1)
  }, [playheadSec, totalDuration, trimEnd])

  const setOutPoint = useCallback(() => {
    const t = videoRef.current?.currentTime ?? playheadSec
    setTrimEnd(t)
    if (t <= trimStart) setTrimStart(0)
  }, [playheadSec, trimStart])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'i' || event.key === 'I') setInPoint()
      if (event.key === 'o' || event.key === 'O') setOutPoint()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setInPoint, setOutPoint])

  const openOutput = useCallback(
    async (task: TaskItem) => {
      if (!task.outputPath) return
      try {
        await shell.showItemInFolder(task.outputPath)
      } catch {
        // best-effort
      }
    },
    [shell]
  )

  const effectiveCodec = resolveCodec(container, codec)
  const activeTasks = tasks.filter((task) => task.status === 'queued' || task.status === 'running').length

  return (
    <div className="plugin-root">
      <header className="header">
        <Clapperboard size={16} className="header-icon" />
        <h1 className="header-title">视频工具箱</h1>
        <span className="badge">{ffmpegVersion ? `FFmpeg ${ffmpegVersion.split(' ')[1] ?? ''}` : 'FFmpeg'}</span>
        <div className="spacer" />
        {ffmpegPhase !== 'ready' && (
          <button className={`btn-${ffmpegPhase === 'checking' || ffmpegPhase === 'downloading' ? 'secondary' : 'primary'}`} onClick={() => void ensureFfmpegReady()}>
            {ffmpegPhase === 'checking' && (
              <>
                <Loader2 size={13} className="spin" /> 检测 FFmpeg…
              </>
            )}
            {ffmpegPhase === 'missing' && (
              <>
                <Download size={13} /> 下载 FFmpeg
              </>
            )}
            {ffmpegPhase === 'downloading' && (
              <>
                <Loader2 size={13} className="spin" /> 下载中 {Math.round(ffmpegPercent)}%
              </>
            )}
            {ffmpegPhase === 'error' && (
              <>
                <AlertTriangle size={13} /> 重试下载
              </>
            )}
          </button>
        )}
        {source && (
          <button className="btn-ghost" onClick={() => void handlePickFile()}>
            <FolderOpen size={13} /> 更换视频
          </button>
        )}
      </header>

      {!source ? (
        <main className="main center">
          <div className="dropzone">
            <Film size={44} strokeWidth={1.2} />
            <p className="empty-title">拖入视频，或选择一个文件开始</p>
            <p className="empty-hint">支持 MP4 / MOV / MKV / WebM / AVI 等常见格式</p>
            <button className="btn-primary" onClick={() => void handlePickFile()}>
              <FolderOpen size={14} /> 选择视频文件
            </button>
          </div>
        </main>
      ) : (
        <>
          <section className="source-bar">
            <div className="preview-pane">
              {source.previewable ? (
                <video
                  ref={videoRef}
                  src={pathToResourceUrl(source.path)}
                  controls
                  onLoadedMetadata={(event) => handleMetadata(event.currentTarget)}
                  onTimeUpdate={(event) => setPlayheadSec(event.currentTarget.currentTime)}
                  onError={markUnpreviewable}
                />
              ) : (
                <div className="preview-fallback">
                  <AlertTriangle size={22} />
                  <p>浏览器无法预览该编码格式</p>
                  <p className="empty-hint">转码、剪切、抽帧仍可正常执行</p>
                </div>
              )}
            </div>
            <div className="meta-pane">
              <div className="meta-name" title={source.name}>
                {source.name}
              </div>
              <dl className="meta-grid">
                <dt>时长</dt>
                <dd>{totalDuration != null ? formatClock(totalDuration) : '—'}</dd>
                <dt>分辨率</dt>
                <dd>{source.width && source.height ? `${source.width}×${source.height}` : '—'}</dd>
                <dt>大小</dt>
                <dd>{formatBytes(source.sizeBytes)}</dd>
                <dt>当前帧</dt>
                <dd>{formatClock(playheadSec)}</dd>
              </dl>
              <nav className="tabs">
                <button className={tab === 'convert' ? 'tab active' : 'tab'} onClick={() => setTab('convert')}>
                  <Layers size={13} /> 转码
                </button>
                <button className={tab === 'trim' ? 'tab active' : 'tab'} onClick={() => setTab('trim')}>
                  <Scissors size={13} /> 剪切
                </button>
                <button className={tab === 'frames' ? 'tab active' : 'tab'} onClick={() => setTab('frames')}>
                  <Camera size={13} /> 截图抽帧
                </button>
              </nav>

              {tab === 'convert' && (
                <div className="panel">
                  <label className="field">
                    <span>目标格式</span>
                    <select value={container} onChange={(event) => setContainer(event.target.value as Container)}>
                      {CONTAINER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(container === 'mp4' || container === 'mov' || container === 'mkv') && (
                    <label className="field">
                      <span>编码器</span>
                      <select value={effectiveCodec} onChange={(event) => setCodec(event.target.value as VideoCodec)}>
                        <option value="h264">H.264（兼容性最好）</option>
                        <option value="h265">H.265（体积更小）</option>
                      </select>
                    </label>
                  )}
                  {container !== 'gif' && (
                    <label className="field">
                      <span>画质</span>
                      <select value={quality} onChange={(event) => setQuality(event.target.value as Quality)}>
                        {QUALITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button className="btn-primary run-btn" disabled={activeTasks > 0} onClick={() => void startConvert()}>
                    <Play size={13} /> 开始转码
                  </button>
                  <p className="field-hint">输出到源文件所在目录：{source.stem}_converted.{container}</p>
                </div>
              )}

              {tab === 'trim' && (
                <div className="panel">
                  {!source.previewable && !totalDuration && (
                    <p className="warn-line">
                      <AlertTriangle size={12} /> 无法预览时请手动输入时间点
                    </p>
                  )}
                  <div className="point-row">
                    <button className="btn-secondary" onClick={setInPoint}>
                      设为入点 (I)
                    </button>
                    <code>{formatClock(trimStart)}</code>
                    <button className="btn-secondary" onClick={setOutPoint}>
                      设为出点 (O)
                    </button>
                    <code>{formatClock(trimEnd)}</code>
                  </div>
                  <div className="timeline-track">
                    <div
                      className="timeline-range"
                      style={{
                        left: `${totalDuration ? (trimStart / totalDuration) * 100 : 0}%`,
                        width: `${totalDuration ? ((trimEnd - trimStart) / totalDuration) * 100 : 0}%`
                      }}
                    />
                  </div>
                  <label className="check-row">
                    <input type="checkbox" checked={trimPrecise} onChange={(event) => setTrimPrecise(event.target.checked)} />
                    <span>精确模式（重编码，帧级准确；关闭则为快速关键帧切割）</span>
                  </label>
                  <button className="btn-primary run-btn" disabled={!canTrim || activeTasks > 0} onClick={() => void startTrim()}>
                    <Scissors size={13} /> 开始剪切（{trimDuration.toFixed(1)} 秒）
                  </button>
                </div>
              )}

              {tab === 'frames' && (
                <div className="panel">
                  <div className="mode-row">
                    <button className={frameMode === 'single' ? 'tab active' : 'tab'} onClick={() => setFrameMode('single')}>
                      当前帧截图
                    </button>
                    <button className={frameMode === 'sequence' ? 'tab active' : 'tab'} onClick={() => setFrameMode('sequence')}>
                      连续抽帧
                    </button>
                  </div>
                  {frameMode === 'single' ? (
                    <>
                      <label className="check-row">
                        <input type="checkbox" checked={copyToClipboard} onChange={(event) => setCopyToClipboard(event.target.checked)} />
                        <span>同时复制到剪贴板</span>
                      </label>
                      <div className="field-row">
                        <label className="field">
                          <span>格式</span>
                          <select value={frameFormat} onChange={(event) => setFrameFormat(event.target.value as 'png' | 'jpg')}>
                            <option value="png">PNG</option>
                            <option value="jpg">JPG</option>
                          </select>
                        </label>
                        <button className="btn-primary run-btn" disabled={activeTasks > 0} onClick={() => void startSingleFrame()}>
                          <Camera size={13} /> 截图 @ {formatClock(playheadSec)}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="field-row">
                      <label className="field">
                        <span>间隔（秒）</span>
                        <input
                          type="number"
                          min={0.1}
                          step={0.5}
                          value={frameInterval}
                          onChange={(event) => setFrameInterval(Number(event.target.value) || 1)}
                        />
                      </label>
                      <label className="field">
                        <span>格式</span>
                        <select value={frameFormat} onChange={(event) => setFrameFormat(event.target.value as 'png' | 'jpg')}>
                          <option value="png">PNG</option>
                          <option value="jpg">JPG</option>
                        </select>
                      </label>
                      <button className="btn-primary run-btn" disabled={activeTasks > 0} onClick={() => void startSequenceFrames()}>
                        <Images size={13} /> 开始抽帧
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <footer className="footer">
            <div className="footer-head">
              <span className="section-title">任务队列{activeTasks > 0 ? `（${activeTasks} 个进行中）` : ''}</span>
              {tasks.length > activeTasks && (
                <button className="btn-ghost" onClick={clearFinished}>
                  清除已完成
                </button>
              )}
            </div>
            {tasks.length === 0 ? (
              <p className="empty-hint">暂无任务</p>
            ) : (
              <ul className="task-list">
                {tasks.map((task) => (
                  <li key={task.id} className="task-row">
                    <span className="task-status">
                      {task.status === 'running' && <Loader2 size={14} className="spin accent" />}
                      {task.status === 'queued' && <span className="dot queued" />}
                      {task.status === 'done' && <CheckCircle2 size={14} className="ok" />}
                      {task.status === 'cancelled' && <XCircle size={14} className="muted" />}
                      {task.status === 'error' && <XCircle size={14} className="bad" />}
                    </span>
                    <div className="task-body">
                      <div className="task-label">{task.label}</div>
                      {(task.status === 'running' || task.status === 'done') && (
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${task.percent}%` }} />
                        </div>
                      )}
                      {task.error && <div className="task-error">{task.error}</div>}
                    </div>
                    {task.status === 'done' && task.outputPath && (
                      <button className="btn-ghost" title="打开输出位置" onClick={() => void openOutput(task)}>
                        <ExternalLink size={13} />
                      </button>
                    )}
                    {(task.status === 'running' || task.status === 'queued') && (
                      <button className="btn-ghost" onClick={() => cancel(task.id)}>
                        <X size={13} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </footer>
        </>
      )}
    </div>
  )
}
