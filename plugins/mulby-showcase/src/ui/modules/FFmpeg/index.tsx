import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    AudioLines,
    BadgeInfo,
    ChartColumn,
    CircleStop,
    Download,
    FileAudio,
    FileDown,
    FileImage,
    FileVideo,
    Film,
    FolderOpen,
    Gauge,
    Info,
    List,
    Pause,
    Play,
    RefreshCw,
    Scissors,
    Search,
    Shrink,
    Sparkles,
    Video,
    X,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type StopMode = 'quit' | 'kill'
type FfmpegTaskHandle = ReturnType<MulbyFFmpeg['run']>

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface MediaInfo {
    duration: string | null
    durationSeconds: number | null
    bitrate: string | null
    video: string[]
    audio: string[]
    subtitle: string[]
    rawPreview: string
}

interface OutputFileInfo {
    path: string
    name?: string
    size?: number
    modifiedAt?: number
}

interface CommandRecord {
    label: string
    args: string[]
    startedAt?: number
}

const MEDIA_EXTENSIONS = [
    'mp4',
    'mkv',
    'avi',
    'mov',
    'webm',
    'm4v',
    'mp3',
    'wav',
    'flac',
    'aac',
    'ogg',
    'm4a',
]

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function truncateText(text: string, limit = 4000) {
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text
}

function formatBytes(bytes?: number) {
    if (bytes === undefined) return 'N/A'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatTime(timestamp?: number) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleTimeString()
}

function pathJoin(base: string, name: string) {
    const separator = base.includes('\\') ? '\\' : '/'
    return `${base.replace(/[\\/]+$/, '')}${separator}${name}`
}

function splitPath(path: string) {
    const normalized = path.replace(/[\\/]+$/, '')
    const separatorIndex = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'))
    if (separatorIndex < 0) return { dir: '', name: normalized }
    return { dir: normalized.slice(0, separatorIndex), name: normalized.slice(separatorIndex + 1) }
}

function replaceExtension(path: string, suffix: string, extension: string) {
    const { dir, name } = splitPath(path)
    const dotIndex = name.lastIndexOf('.')
    const baseName = dotIndex > 0 ? name.slice(0, dotIndex) : name
    const outputName = `${baseName}${suffix}.${extension}`
    return dir ? pathJoin(dir, outputName) : outputName
}

function quoteArg(arg: string) {
    if (!arg) return '""'
    if (/[\s"'()&|<>]/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`
    return arg
}

function formatCommand(args: string[]) {
    return ['ffmpeg', ...args].map(quoteArg).join(' ')
}

function parseDurationSeconds(value: string) {
    const match = value.match(/(\d+):(\d+):(\d+)(?:\.(\d+))?/)
    if (!match) return null
    const [, hours, minutes, seconds, fraction = '0'] = match
    return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(`0.${fraction}`)
}

function parseMediaInfo(stderr: string): MediaInfo {
    const durationMatch = stderr.match(/Duration:\s*([^,\r\n]+)/)
    const bitrateMatch = stderr.match(/bitrate:\s*([^,\r\n]+)/)
    const video: string[] = []
    const audio: string[] = []
    const subtitle: string[] = []

    for (const rawLine of stderr.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line.includes('Stream #')) continue
        const videoIndex = line.indexOf('Video:')
        const audioIndex = line.indexOf('Audio:')
        const subtitleIndex = line.indexOf('Subtitle:')
        if (videoIndex >= 0) video.push(line.slice(videoIndex + 'Video:'.length).trim())
        if (audioIndex >= 0) audio.push(line.slice(audioIndex + 'Audio:'.length).trim())
        if (subtitleIndex >= 0) subtitle.push(line.slice(subtitleIndex + 'Subtitle:'.length).trim())
    }

    const duration = durationMatch?.[1]?.trim() || null
    return {
        duration,
        durationSeconds: duration ? parseDurationSeconds(duration) : null,
        bitrate: bitrateMatch?.[1]?.trim() || null,
        video,
        audio,
        subtitle,
        rawPreview: truncateText(stderr.trim(), 2400),
    }
}

function statusText(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'error') return '失败'
    if (status === 'warning') return '警告'
    return '信息'
}

function downloadPhaseText(phase?: string) {
    if (phase === 'downloading') return '下载中'
    if (phase === 'extracting') return '解压中'
    if (phase === 'done') return '完成'
    return '待开始'
}

function summarizeProgress(progress: FFmpegRunProgress | null) {
    if (!progress) return null
    return {
        frame: progress.frame,
        fps: progress.fps,
        percent: progress.percent,
        time: progress.time,
        speed: progress.speed,
        size: progress.size,
        bitrate: progress.bitrate,
        q: progress.q,
    }
}

export function FFmpegModule() {
    const { ffmpeg, dialog, filesystem, system, shell } = useMulby()
    const notify = useNotification()

    const [isAvailable, setIsAvailable] = useState<boolean | null>(null)
    const [version, setVersion] = useState<string | null>(null)
    const [ffmpegPath, setFFmpegPath] = useState<string | null>(null)
    const [platformLabel, setPlatformLabel] = useState('unknown')
    const [downloadProgress, setDownloadProgress] = useState<FFmpegDownloadProgress | null>(null)
    const [runProgress, setRunProgress] = useState<FFmpegRunProgress | null>(null)
    const [inputFile, setInputFile] = useState('')
    const [outputFile, setOutputFile] = useState('')
    const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null)
    const [lastOutput, setLastOutput] = useState<OutputFileInfo | null>(null)
    const [lastCommand, setLastCommand] = useState<CommandRecord | null>(null)
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [activeTask, setActiveTask] = useState<{ id: string; label: string; startedAt: number } | null>(null)
    const [recordMouse, setRecordMouse] = useState(true)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])

    const currentTaskRef = useRef<{ task: FfmpegTaskHandle; action: string } | null>(null)
    const stopModeRef = useRef<StopMode | null>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 14))
    }, [])

    const loadPlatform = useCallback(async () => {
        try {
            const [isWindows, isMacOS, isLinux] = await Promise.all([
                system.isWindows(),
                system.isMacOS(),
                system.isLinux(),
            ])
            setPlatformLabel(isWindows ? 'windows' : isMacOS ? 'macos' : isLinux ? 'linux' : 'unknown')
        } catch (error) {
            pushOperation({
                action: 'system.isWindows/isMacOS/isLinux',
                status: 'error',
                message: getErrorMessage(error),
            })
        }
    }, [pushOperation, system])

    const refreshAvailability = useCallback(async () => {
        setLoadingAction('status')
        try {
            const available = await ffmpeg.isAvailable()
            setIsAvailable(available)
            if (available) {
                const [nextVersion, nextPath] = await Promise.all([
                    ffmpeg.getVersion(),
                    ffmpeg.getPath(),
                ])
                setVersion(nextVersion)
                setFFmpegPath(nextPath)
                pushOperation({
                    action: 'ffmpeg.isAvailable/getVersion/getPath',
                    status: 'success',
                    message: 'FFmpeg 运行时可用',
                    details: { version: nextVersion, path: nextPath },
                })
                notify.success('FFmpeg 已安装')
            } else {
                setVersion(null)
                setFFmpegPath(null)
                pushOperation({
                    action: 'ffmpeg.isAvailable',
                    status: 'warning',
                    message: 'FFmpeg 未安装',
                })
                notify.warning('FFmpeg 未安装，请先下载')
            }
        } catch (error) {
            pushOperation({
                action: 'ffmpeg.isAvailable',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`检查 FFmpeg 失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ffmpeg, notify, pushOperation])

    useEffect(() => {
        void loadPlatform()
        void refreshAvailability()
    }, [loadPlatform, refreshAvailability])

    const ensureAvailable = useCallback(async () => {
        const available = isAvailable ?? await ffmpeg.isAvailable()
        setIsAvailable(available)
        if (!available) {
            throw new Error('FFmpeg 未安装，请先下载')
        }
    }, [ffmpeg, isAvailable])

    const refreshOutputInfo = useCallback(async (path: string) => {
        const exists = await filesystem.exists(path)
        if (!exists) {
            setLastOutput({ path })
            return { path }
        }
        const stat = await filesystem.stat(path)
        const info = {
            path,
            name: stat?.name,
            size: stat?.size,
            modifiedAt: stat?.modifiedAt,
        }
        setLastOutput(info)
        return info
    }, [filesystem])

    const chooseSavePath = useCallback(async (defaultPath: string, extensions: string[], title = '选择输出文件') => {
        return dialog.showSaveDialog({
            title,
            defaultPath,
            filters: [{ name: extensions.map(ext => ext.toUpperCase()).join('/'), extensions }],
        })
    }, [dialog])

    const runFfmpegTask = useCallback(async (
        id: string,
        label: string,
        args: string[],
        options?: { outputPath?: string; successMessage?: string; expectedStop?: boolean }
    ) => {
        await ensureAvailable()
        setRunProgress(null)
        setActiveTask({ id, label, startedAt: Date.now() })
        setLastCommand({ label, args, startedAt: Date.now() })
        stopModeRef.current = null

        const task = ffmpeg.run(args, progress => {
            setRunProgress(progress)
        })
        currentTaskRef.current = { task, action: label }

        try {
            await task.promise
            const stopMode = stopModeRef.current
            const outputInfo = options?.outputPath ? await refreshOutputInfo(options.outputPath) : null
            const message = stopMode
                ? `${label}已${stopMode === 'quit' ? '优雅结束' : '强制终止'}`
                : options?.successMessage || `${label}完成`
            pushOperation({
                action: `ffmpeg.run: ${label}`,
                status: stopMode ? 'warning' : 'success',
                message,
                details: {
                    command: formatCommand(args),
                    output: outputInfo,
                },
            })
            if (stopMode) {
                notify.info(message)
            } else {
                notify.success(message)
            }
        } catch (error) {
            const message = getErrorMessage(error)
            if (stopModeRef.current || options?.expectedStop) {
                pushOperation({
                    action: `ffmpeg.run: ${label}`,
                    status: 'warning',
                    message: `${label}已停止`,
                    details: { error: truncateText(message, 1200), command: formatCommand(args) },
                })
                notify.info(`${label}已停止`)
            } else {
                pushOperation({
                    action: `ffmpeg.run: ${label}`,
                    status: 'error',
                    message: truncateText(message, 300),
                    details: { error: truncateText(message, 2000), command: formatCommand(args) },
                })
                notify.error(`${label}失败: ${truncateText(message, 160)}`)
            }
        } finally {
            currentTaskRef.current = null
            stopModeRef.current = null
            setActiveTask(null)
            setRunProgress(null)
        }
    }, [ensureAvailable, ffmpeg, notify, pushOperation, refreshOutputInfo])

    const handleDownload = useCallback(async () => {
        setLoadingAction('download')
        setDownloadProgress(null)
        try {
            const result = await ffmpeg.download(progress => {
                setDownloadProgress(progress)
            })
            if (result.success) {
                pushOperation({
                    action: 'ffmpeg.download',
                    status: 'success',
                    message: 'FFmpeg 下载并解压完成',
                })
                notify.success('FFmpeg 下载完成')
                await refreshAvailability()
            } else {
                pushOperation({
                    action: 'ffmpeg.download',
                    status: 'error',
                    message: result.error || '下载失败',
                })
                notify.error(result.error || 'FFmpeg 下载失败')
            }
        } catch (error) {
            pushOperation({
                action: 'ffmpeg.download',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`FFmpeg 下载失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ffmpeg, notify, pushOperation, refreshAvailability])

    const handleSelectInput = useCallback(async () => {
        setLoadingAction('select-input')
        try {
            const [path] = await dialog.showOpenDialog({
                title: '选择视频或音频文件',
                filters: [{ name: '媒体文件', extensions: MEDIA_EXTENSIONS }],
                properties: ['openFile'],
            })
            if (!path) {
                pushOperation({
                    action: 'dialog.showOpenDialog',
                    status: 'info',
                    message: '已取消选择输入文件',
                })
                return
            }
            const defaultOutput = replaceExtension(path, '_compressed', 'mp4')
            setInputFile(path)
            setOutputFile(defaultOutput)
            setMediaInfo(null)
            setLastOutput(null)
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'success',
                message: '已选择输入媒体文件',
                details: { input: path, output: defaultOutput },
            })
            notify.success('已选择输入文件')
        } catch (error) {
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`选择文件失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, pushOperation])

    const handleChooseOutput = useCallback(async () => {
        const baseOutput = outputFile || (inputFile ? replaceExtension(inputFile, '_output', 'mp4') : 'mulby-ffmpeg-output.mp4')
        try {
            const path = await chooseSavePath(baseOutput, ['mp4'], '选择默认 MP4 输出路径')
            if (path) {
                setOutputFile(path)
                setLastOutput(null)
                pushOperation({
                    action: 'dialog.showSaveDialog',
                    status: 'success',
                    message: '已选择默认输出路径',
                    details: { output: path },
                })
            }
        } catch (error) {
            pushOperation({
                action: 'dialog.showSaveDialog',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`选择输出路径失败: ${getErrorMessage(error)}`)
        }
    }, [chooseSavePath, inputFile, notify, outputFile, pushOperation])

    const handleGetMediaInfo = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }
        await ensureAvailable()
        setLoadingAction('media-info')
        setMediaInfo(null)
        const args = ['-hide_banner', '-i', inputFile]
        setLastCommand({ label: '读取媒体信息', args, startedAt: Date.now() })
        const task = ffmpeg.run(args)
        currentTaskRef.current = { task, action: '读取媒体信息' }
        try {
            await task.promise
            pushOperation({
                action: 'ffmpeg.run: 读取媒体信息',
                status: 'warning',
                message: 'FFmpeg 未返回可解析的媒体信息',
                details: { command: formatCommand(args) },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            const info = parseMediaInfo(message)
            if (info.duration || info.video.length > 0 || info.audio.length > 0 || info.subtitle.length > 0) {
                setMediaInfo(info)
                pushOperation({
                    action: 'ffmpeg.run: 读取媒体信息',
                    status: 'success',
                    message: '已从 FFmpeg stderr 解析媒体信息',
                    details: { command: formatCommand(args), info },
                })
                notify.success('媒体信息已读取')
            } else {
                pushOperation({
                    action: 'ffmpeg.run: 读取媒体信息',
                    status: 'error',
                    message: '无法解析媒体信息',
                    details: { error: truncateText(message, 2000), command: formatCommand(args) },
                })
                notify.error('无法解析媒体信息')
            }
        } finally {
            currentTaskRef.current = null
            setLoadingAction(null)
        }
    }, [ensureAvailable, ffmpeg, inputFile, notify, pushOperation])

    const handleCompressVideo = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }
        const outputPath = outputFile || replaceExtension(inputFile, '_compressed', 'mp4')
        setOutputFile(outputPath)
        await runFfmpegTask('compress', '压缩 MP4', [
            '-y',
            '-i', inputFile,
            '-c:v', 'libx264',
            '-crf', '28',
            '-preset', 'fast',
            '-tag:v', 'avc1',
            '-movflags', '+faststart',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-map', '0:v?',
            '-map', '0:a?',
            outputPath,
        ], {
            outputPath,
            successMessage: '视频压缩完成',
        })
    }, [inputFile, notify, outputFile, runFfmpegTask])

    const handleExtractAudio = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }
        const defaultPath = replaceExtension(inputFile, '_audio', 'mp3')
        const outputPath = await chooseSavePath(defaultPath, ['mp3'], '保存提取的音频')
        if (!outputPath) return
        await runFfmpegTask('extract-audio', '提取 MP3 音频', [
            '-y',
            '-i', inputFile,
            '-vn',
            '-q:a', '2',
            '-map', '0:a?',
            outputPath,
        ], {
            outputPath,
            successMessage: '音频提取完成',
        })
    }, [chooseSavePath, inputFile, notify, runFfmpegTask])

    const handleConvertGif = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }
        const outputPath = await chooseSavePath(replaceExtension(inputFile, '_preview', 'gif'), ['gif'], '保存 GIF')
        if (!outputPath) return
        await runFfmpegTask('gif', '转换 GIF', [
            '-y',
            '-i', inputFile,
            '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
            '-loop', '0',
            outputPath,
        ], {
            outputPath,
            successMessage: 'GIF 转换完成',
        })
    }, [chooseSavePath, inputFile, notify, runFfmpegTask])

    const handleExtractFrame = useCallback(async () => {
        if (!inputFile) {
            notify.warning('请先选择输入文件')
            return
        }
        const outputPath = await chooseSavePath(replaceExtension(inputFile, '_frame', 'png'), ['png'], '保存视频帧')
        if (!outputPath) return
        await runFfmpegTask('frame', '抽取单帧', [
            '-y',
            '-ss', '00:00:01',
            '-i', inputFile,
            '-frames:v', '1',
            '-q:v', '2',
            outputPath,
        ], {
            outputPath,
            successMessage: '视频帧已导出',
        })
    }, [chooseSavePath, inputFile, notify, runFfmpegTask])

    const handleGenerateTestVideo = useCallback(async () => {
        const tempDir = await system.getPath('temp')
        const outputPath = await chooseSavePath(pathJoin(tempDir, `mulby-ffmpeg-test-${Date.now()}.mp4`), ['mp4'], '保存测试视频')
        if (!outputPath) return
        await runFfmpegTask('test-video', '生成测试视频', [
            '-y',
            '-f', 'lavfi',
            '-i', 'testsrc2=duration=5:size=1280x720:rate=30',
            '-f', 'lavfi',
            '-i', 'sine=frequency=880:duration=5',
            '-c:v', 'libx264',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac',
            '-shortest',
            outputPath,
        ], {
            outputPath,
            successMessage: '测试视频已生成',
        })
    }, [chooseSavePath, runFfmpegTask, system])

    const buildScreenRecordingArgs = useCallback(async (outputPath: string) => {
        const [isWindows, isMacOS, isLinux] = await Promise.all([
            system.isWindows(),
            system.isMacOS(),
            system.isLinux(),
        ])

        if (isWindows) {
            return [
                '-y',
                '-f', 'gdigrab',
                '-framerate', '30',
                '-draw_mouse', recordMouse ? '1' : '0',
                '-i', 'desktop',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-crf', '23',
                outputPath,
            ]
        }

        if (isMacOS) {
            return [
                '-y',
                '-f', 'avfoundation',
                '-framerate', '30',
                '-capture_cursor', recordMouse ? '1' : '0',
                '-i', '1',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-crf', '23',
                outputPath,
            ]
        }

        if (isLinux) {
            return [
                '-y',
                '-f', 'x11grab',
                '-framerate', '30',
                '-draw_mouse', recordMouse ? '1' : '0',
                '-i', ':0.0',
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-crf', '23',
                outputPath,
            ]
        }

        throw new Error('当前平台未提供 FFmpeg 录屏参数示例')
    }, [recordMouse, system])

    const handleStartRecording = useCallback(async () => {
        const tempDir = await system.getPath('temp')
        const outputPath = await chooseSavePath(pathJoin(tempDir, `mulby-ffmpeg-record-${Date.now()}.mp4`), ['mp4'], '保存 FFmpeg 录屏')
        if (!outputPath) return
        try {
            const args = await buildScreenRecordingArgs(outputPath)
            await runFfmpegTask('record-screen', 'FFmpeg 全屏录制', args, {
                outputPath,
                successMessage: '录屏任务结束',
                expectedStop: true,
            })
        } catch (error) {
            pushOperation({
                action: 'buildScreenRecordingArgs',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`无法开始录屏: ${getErrorMessage(error)}`)
        }
    }, [buildScreenRecordingArgs, chooseSavePath, notify, pushOperation, runFfmpegTask, system])

    const handleQuitTask = useCallback(() => {
        if (!currentTaskRef.current) {
            notify.warning('没有正在运行的 FFmpeg 任务')
            return
        }
        stopModeRef.current = 'quit'
        currentTaskRef.current.task.quit()
        pushOperation({
            action: 'task.quit',
            status: 'info',
            message: `已请求优雅退出: ${currentTaskRef.current.action}`,
        })
        notify.info('已请求 FFmpeg 优雅退出')
    }, [notify, pushOperation])

    const handleKillTask = useCallback(() => {
        if (!currentTaskRef.current) {
            notify.warning('没有正在运行的 FFmpeg 任务')
            return
        }
        stopModeRef.current = 'kill'
        currentTaskRef.current.task.kill()
        pushOperation({
            action: 'task.kill',
            status: 'warning',
            message: `已请求强制终止: ${currentTaskRef.current.action}`,
        })
        notify.warning('已请求强制终止 FFmpeg')
    }, [notify, pushOperation])

    const handleRevealOutput = useCallback(async () => {
        if (!lastOutput?.path) {
            notify.warning('没有可定位的输出文件')
            return
        }
        try {
            await shell.showItemInFolder(lastOutput.path)
            pushOperation({
                action: 'shell.showItemInFolder',
                status: 'success',
                message: '已在文件管理器中定位输出文件',
                details: { path: lastOutput.path },
            })
        } catch (error) {
            pushOperation({
                action: 'shell.showItemInFolder',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`定位输出文件失败: ${getErrorMessage(error)}`)
        }
    }, [lastOutput, notify, pushOperation, shell])

    const statusBadge = useMemo(() => {
        if (isAvailable === null) return { status: 'info' as const, text: '未检测' }
        if (isAvailable) return { status: 'success' as const, text: '已安装' }
        return { status: 'warning' as const, text: '未安装' }
    }, [isAvailable])

    const currentCommandText = useMemo(() => (
        lastCommand ? formatCommand(lastCommand.args) : ''
    ), [lastCommand])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'FFmpeg API',
            items: [
                { name: 'ffmpeg.isAvailable()', description: '检查宿主 FFmpeg 二进制是否已安装。' },
                { name: 'ffmpeg.getVersion()', description: '读取 FFmpeg 版本字符串。' },
                { name: 'ffmpeg.getPath()', description: '读取宿主管理的 FFmpeg 可执行文件路径，未安装时返回 null。' },
                { name: 'ffmpeg.download(onProgress?)', description: '下载并解压宿主 FFmpeg 运行时。' },
                { name: 'ffmpeg.run(args, onProgress?)', description: '以参数数组执行 FFmpeg 命令并监听进度。' },
                { name: 'task.promise', description: '等待 FFmpeg 进程结束。' },
                { name: 'task.quit()', description: '向 FFmpeg 发送 q/SIGINT，适合录制类任务优雅停止。' },
                { name: 'task.kill()', description: '强制终止 FFmpeg 进程。' },
            ],
        },
        {
            title: '辅助 API',
            items: [
                { name: 'dialog.showOpenDialog(options)', description: '选择输入音视频文件。' },
                { name: 'dialog.showSaveDialog(options)', description: '选择输出文件路径。' },
                { name: 'filesystem.exists(path)', description: '检查输出文件是否存在。' },
                { name: 'filesystem.stat(path)', description: '读取输出文件大小和修改时间。' },
                { name: 'system.getPath("temp")', description: '生成测试视频和录屏的默认临时路径。' },
                { name: 'system.isWindows/isMacOS/isLinux()', description: '为 FFmpeg 原生录屏构造平台参数。' },
                { name: 'shell.showItemInFolder(path)', description: '在系统文件管理器中定位输出文件。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '检测与下载 FFmpeg',
            code: `const available = await window.mulby.ffmpeg.isAvailable()

if (!available) {
  const result = await window.mulby.ffmpeg.download(progress => {
    console.log(progress.phase, progress.percent)
  })
  if (!result.success) throw new Error(result.error || 'FFmpeg download failed')
}

const version = await window.mulby.ffmpeg.getVersion()
const path = await window.mulby.ffmpeg.getPath()`,
        },
        {
            title: '执行并控制任务',
            code: `const task = window.mulby.ffmpeg.run([
  '-y',
  '-i', inputPath,
  '-c:v', 'libx264',
  '-crf', '28',
  '-c:a', 'aac',
  outputPath,
], progress => {
  console.log(progress.percent, progress.time, progress.speed)
})

// task.quit() sends a graceful stop request
// task.kill() force terminates the process
await task.promise`,
        },
        {
            title: '读取媒体信息',
            code: `try {
  await window.mulby.ffmpeg.run(['-hide_banner', '-i', inputPath]).promise
} catch (error) {
  const stderr = error instanceof Error ? error.message : String(error)
  const duration = stderr.match(/Duration:\\s*([^,]+)/)?.[1]
  const streams = stderr.split('\\n').filter(line => line.includes('Stream #'))
  console.log(duration, streams)
}`,
        },
        {
            title: '生成测试视频',
            code: `const task = window.mulby.ffmpeg.run([
  '-y',
  '-f', 'lavfi',
  '-i', 'testsrc2=duration=5:size=1280x720:rate=30',
  '-f', 'lavfi',
  '-i', 'sine=frequency=880:duration=5',
  '-c:v', 'libx264',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-shortest',
  outputPath,
])

await task.promise`,
        },
    ], [])

    const rawData = useMemo(() => ({
        status: {
            isAvailable,
            version,
            ffmpegPath,
            platformLabel,
        },
        downloadProgress,
        activeTask,
        runProgress: summarizeProgress(runProgress),
        inputFile: inputFile || null,
        outputFile: outputFile || null,
        mediaInfo,
        lastOutput,
        lastCommand: lastCommand ? {
            label: lastCommand.label,
            command: formatCommand(lastCommand.args),
            args: lastCommand.args,
            startedAt: lastCommand.startedAt,
        } : null,
        recordMouse,
        operations: operationLog,
    }), [activeTask, downloadProgress, ffmpegPath, inputFile, isAvailable, lastCommand, lastOutput, mediaInfo, operationLog, outputFile, platformLabel, recordMouse, runProgress, version])

    return (
        <div className="main-content">
            <PageHeader
                icon={Film}
                title="FFmpeg 音视频处理"
                description="宿主 FFmpeg 运行时、任务执行、进度回调与音视频转码示例"
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="ffmpeg-page-stack">
                        <Card
                            title="运行时状态"
                            icon={Info}
                            actions={(
                                <>
                                    <Button variant="secondary" onClick={refreshAvailability} loading={loadingAction === 'status'}>
                                        <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                        刷新
                                    </Button>
                                    {isAvailable === false && (
                                        <Button variant="primary" onClick={handleDownload} loading={loadingAction === 'download'}>
                                            <Download className="inline-icon" aria-hidden="true" size={14} />
                                            下载 FFmpeg
                                        </Button>
                                    )}
                                </>
                            )}
                        >
                            <div className="stats-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <div className="stat-item">
                                    <div className="stat-value">
                                        <StatusBadge status={statusBadge.status}>{statusBadge.text}</StatusBadge>
                                    </div>
                                    <div className="stat-label">安装状态</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{version || 'N/A'}</div>
                                    <div className="stat-label">版本</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{platformLabel}</div>
                                    <div className="stat-label">平台</div>
                                </div>
                            </div>

                            {ffmpegPath && (
                                <div className="list-row">
                                    <BadgeInfo className="inline-icon" aria-hidden="true" size={14} />
                                    <span className="list-row-main">{ffmpegPath}</span>
                                </div>
                            )}

                            {downloadProgress && (
                                <div style={{ marginTop: 'var(--spacing-md)' }}>
                                    <div className="list-row" style={{ marginBottom: 'var(--spacing-sm)' }}>
                                        <Download className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">{downloadPhaseText(downloadProgress.phase)}</span>
                                        <span className="list-row-meta">{Math.round(downloadProgress.percent)}%</span>
                                        {downloadProgress.total ? (
                                            <span className="list-row-meta">
                                                {formatBytes(downloadProgress.downloaded)} / {formatBytes(downloadProgress.total)}
                                            </span>
                                        ) : null}
                                    </div>
                                    <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                                        <div
                                            style={{
                                                width: `${downloadProgress.percent}%`,
                                                height: '100%',
                                                background: 'var(--accent-primary)',
                                                transition: 'width 0.2s ease',
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </Card>

                        <Card title="输入与输出" icon={FolderOpen}>
                            <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <Button variant="primary" onClick={handleSelectInput} loading={loadingAction === 'select-input'}>
                                    <FolderOpen className="inline-icon" aria-hidden="true" size={14} />
                                    选择输入文件
                                </Button>
                                <Button variant="secondary" onClick={handleChooseOutput} disabled={!inputFile}>
                                    <FileDown className="inline-icon" aria-hidden="true" size={14} />
                                    选择 MP4 输出
                                </Button>
                                <Button variant="secondary" onClick={handleGenerateTestVideo} disabled={Boolean(activeTask)}>
                                    <Sparkles className="inline-icon" aria-hidden="true" size={14} />
                                    生成测试视频
                                </Button>
                            </div>

                            {inputFile || outputFile ? (
                                <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                    {inputFile && (
                                        <div className="list-row">
                                            <FileVideo className="inline-icon" aria-hidden="true" size={14} />
                                            <span className="list-row-main">{inputFile}</span>
                                            <span className="list-row-meta">输入</span>
                                        </div>
                                    )}
                                    {outputFile && (
                                        <div className="list-row">
                                            <FileDown className="inline-icon" aria-hidden="true" size={14} />
                                            <span className="list-row-main">{outputFile}</span>
                                            <span className="list-row-meta">默认输出</span>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <FolderOpen aria-hidden="true" size={28} />
                                    <p>选择媒体文件，或先生成一个测试视频</p>
                                </div>
                            )}
                        </Card>

                        <Card
                            title="任务进度"
                            icon={Gauge}
                            actions={activeTask ? (
                                <>
                                    <Button variant="secondary" onClick={handleQuitTask}>
                                        <Pause className="inline-icon" aria-hidden="true" size={14} />
                                        优雅停止
                                    </Button>
                                    <Button variant="secondary" onClick={handleKillTask}>
                                        <X className="inline-icon" aria-hidden="true" size={14} />
                                        强制终止
                                    </Button>
                                </>
                            ) : null}
                        >
                            {activeTask ? (
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    <div className="list-row">
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">{activeTask.label}</span>
                                        <span className="list-row-meta">开始于 {formatTime(activeTask.startedAt)}</span>
                                    </div>
                                    <div style={{ height: 8, background: 'var(--bg-tertiary)', borderRadius: 4, overflow: 'hidden' }}>
                                        <div
                                            style={{
                                                width: `${runProgress?.percent ?? 0}%`,
                                                height: '100%',
                                                background: runProgress?.percent === undefined ? 'var(--warning)' : 'var(--accent-primary)',
                                                transition: 'width 0.2s ease',
                                            }}
                                        />
                                    </div>
                                    <div className="stats-grid">
                                        <div className="stat-item">
                                            <div className="stat-value">{runProgress?.percent !== undefined ? `${runProgress.percent}%` : 'N/A'}</div>
                                            <div className="stat-label">进度</div>
                                        </div>
                                        <div className="stat-item">
                                            <div className="stat-value">{runProgress?.time || 'N/A'}</div>
                                            <div className="stat-label">时间</div>
                                        </div>
                                        <div className="stat-item">
                                            <div className="stat-value">{runProgress?.speed || 'N/A'}</div>
                                            <div className="stat-label">速度</div>
                                        </div>
                                        <div className="stat-item">
                                            <div className="stat-value">{runProgress?.size || 'N/A'}</div>
                                            <div className="stat-label">输出大小</div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <Gauge aria-hidden="true" size={28} />
                                    <p>当前没有正在运行的 FFmpeg 任务</p>
                                </div>
                            )}

                            {currentCommandText && (
                                <div className="preview-box" style={{ marginTop: 'var(--spacing-md)', justifyContent: 'flex-start', alignItems: 'stretch' }}>
                                    <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>{currentCommandText}</code>
                                </div>
                            )}
                        </Card>

                        <Card title="处理操作" icon={Scissors}>
                            <div className="action-bar">
                                <Button variant="primary" onClick={handleCompressVideo} disabled={!inputFile || Boolean(activeTask) || isAvailable === false}>
                                    <Shrink className="inline-icon" aria-hidden="true" size={14} />
                                    压缩 MP4
                                </Button>
                                <Button variant="secondary" onClick={handleExtractAudio} disabled={!inputFile || Boolean(activeTask) || isAvailable === false}>
                                    <FileAudio className="inline-icon" aria-hidden="true" size={14} />
                                    提取音频
                                </Button>
                                <Button variant="secondary" onClick={handleConvertGif} disabled={!inputFile || Boolean(activeTask) || isAvailable === false}>
                                    <Film className="inline-icon" aria-hidden="true" size={14} />
                                    转 GIF
                                </Button>
                                <Button variant="secondary" onClick={handleExtractFrame} disabled={!inputFile || Boolean(activeTask) || isAvailable === false}>
                                    <FileImage className="inline-icon" aria-hidden="true" size={14} />
                                    抽取单帧
                                </Button>
                                <Button variant="secondary" onClick={handleGetMediaInfo} loading={loadingAction === 'media-info'} disabled={!inputFile || Boolean(activeTask) || isAvailable === false}>
                                    <Search className="inline-icon" aria-hidden="true" size={14} />
                                    读取信息
                                </Button>
                            </div>
                        </Card>

                        <Card
                            title="FFmpeg 原生录屏"
                            icon={Video}
                            actions={activeTask?.id === 'record-screen' ? (
                                <Button variant="secondary" onClick={handleQuitTask}>
                                    <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                    停止录制
                                </Button>
                            ) : null}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={recordMouse}
                                        onChange={event => setRecordMouse(event.target.checked)}
                                    />
                                    捕获鼠标光标
                                </label>
                                <div className="action-bar">
                                    <Button
                                        variant="secondary"
                                        onClick={handleStartRecording}
                                        disabled={Boolean(activeTask) || isAvailable === false}
                                    >
                                        <Video className="inline-icon" aria-hidden="true" size={14} />
                                        开始全屏录制
                                    </Button>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                    这里仅演示 FFmpeg 原生命令参数，不请求麦克风或摄像头权限。桌面流录制和权限流程在屏幕模块中展示。
                                </div>
                            </div>
                        </Card>

                        {(mediaInfo || lastOutput) && (
                            <Card
                                title="结果"
                                icon={ChartColumn}
                                actions={lastOutput?.path ? (
                                    <Button variant="secondary" onClick={handleRevealOutput}>
                                        <FolderOpen className="inline-icon" aria-hidden="true" size={14} />
                                        定位输出
                                    </Button>
                                ) : null}
                            >
                                {mediaInfo && (
                                    <div style={{ display: 'grid', gap: 'var(--spacing-md)', marginBottom: lastOutput ? 'var(--spacing-md)' : 0 }}>
                                        <div className="stats-grid">
                                            <div className="stat-item">
                                                <div className="stat-value">{mediaInfo.duration || 'N/A'}</div>
                                                <div className="stat-label">时长</div>
                                            </div>
                                            <div className="stat-item">
                                                <div className="stat-value">{mediaInfo.bitrate || 'N/A'}</div>
                                                <div className="stat-label">码率</div>
                                            </div>
                                            <div className="stat-item">
                                                <div className="stat-value">{mediaInfo.video.length}</div>
                                                <div className="stat-label">视频流</div>
                                            </div>
                                            <div className="stat-item">
                                                <div className="stat-value">{mediaInfo.audio.length}</div>
                                                <div className="stat-label">音频流</div>
                                            </div>
                                        </div>
                                        {[...mediaInfo.video.map(stream => ({ type: '视频', icon: FileVideo, stream })), ...mediaInfo.audio.map(stream => ({ type: '音频', icon: AudioLines, stream })), ...mediaInfo.subtitle.map(stream => ({ type: '字幕', icon: List, stream }))].map((item, index) => {
                                            const Icon = item.icon
                                            return (
                                                <div className="list-row" key={`${item.type}-${index}`}>
                                                    <Icon className="inline-icon" aria-hidden="true" size={14} />
                                                    <span className="list-row-main">{item.stream}</span>
                                                    <span className="list-row-meta">{item.type}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}

                                {lastOutput && (
                                    <div className="list-row">
                                        <FileDown className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">{lastOutput.path}</span>
                                        <span className="list-row-meta">{formatBytes(lastOutput.size)}</span>
                                        <span className="list-row-meta">{formatTime(lastOutput.modifiedAt)}</span>
                                    </div>
                                )}
                            </Card>
                        )}

                        <Card title="最近操作" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length > 0 ? operationLog.map((item, index) => (
                                    <div className="list-row" key={`${item.timestamp}-${index}`}>
                                        <StatusBadge status={item.status}>{statusText(item.status)}</StatusBadge>
                                        <span className="list-row-main">{item.action}</span>
                                        <span className="list-row-meta">{item.message}</span>
                                        <span className="list-row-meta">{formatTime(item.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <List aria-hidden="true" size={28} />
                                        <p>暂无操作记录</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
