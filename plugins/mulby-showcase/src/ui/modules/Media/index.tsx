import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    AudioLines,
    Bell,
    Camera,
    CircleStop,
    List,
    Mic,
    Pause,
    Play,
    RefreshCw,
    Settings,
    Square,
    Video,
    Volume2,
    Webcam,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel, CodeBlock } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type MediaKind = 'camera' | 'microphone'
type MediaAccessStatus = 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
type PermissionStatus = MediaAccessStatus | 'authorized' | 'limited'
type OperationStatus = 'success' | 'warning' | 'error' | 'info'
type LoadingAction =
    | 'voices'
    | 'speak'
    | 'beep'
    | 'devices'
    | 'permissions'
    | 'preview'
    | 'recording'
    | `request:${MediaKind}`
    | `settings:${MediaKind}`
    | null

interface Voice {
    name: string
    lang: string
    default: boolean
    localService: boolean
}

interface MediaPermissionSnapshot {
    status: MediaAccessStatus | null
    hasAccess: boolean | null
    canRequest: boolean | null
    error?: string
}

interface DeviceSummary {
    kind: MediaDeviceKind
    label: string
    deviceId: string
    groupId: string
}

interface TrackSummary {
    kind: string
    label: string
    enabled: boolean
    muted: boolean
    readyState: MediaStreamTrackState
    settings: Record<string, unknown>
}

interface StreamSummary {
    active: boolean
    tracks: TrackSummary[]
}

interface PreviewState {
    active: boolean
    hasVideo: boolean
    hasAudio: boolean
    startedAt: number | null
}

interface RecordingInfo {
    mimeType: string
    size: number
    durationMs: number
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

const SAMPLE_TEXTS = [
    { label: '中文', text: '你好，欢迎使用 Mulby 功能展示插件！' },
    { label: '英文', text: 'Hello, welcome to the Mulby Showcase plugin.' },
    { label: '数字', text: '今天是 2026 年 5 月 11 日，语速、音调和音量都可以调整。' },
    { label: '长文', text: 'Mulby 插件可以在渲染进程使用文字转语音，也可以通过媒体权限 API 管理摄像头和麦克风访问。' },
]

const DEFAULT_PERMISSIONS: Record<MediaKind, MediaPermissionSnapshot> = {
    camera: { status: null, hasAccess: null, canRequest: null },
    microphone: { status: null, hasAccess: null, canRequest: null },
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function statusLabel(status: PermissionStatus | null) {
    if (!status) return '未读取'

    const labels: Record<PermissionStatus, string> = {
        authorized: '已授权',
        granted: '已授权',
        denied: '已拒绝',
        'not-determined': '未决定',
        restricted: '受限',
        limited: '有限',
        unknown: '未知',
    }

    return labels[status] ?? status
}

function permissionBadge(snapshot: MediaPermissionSnapshot) {
    if (snapshot.error) return 'error'
    if (snapshot.hasAccess || snapshot.status === 'granted') return 'success'
    if (!snapshot.status) return 'info'
    if (snapshot.status === 'denied' || snapshot.status === 'restricted') return 'error'
    return 'warning'
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(ms: number) {
    const seconds = Math.max(0, Math.round(ms / 1000))
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return `${minutes}:${String(rest).padStart(2, '0')}`
}

function summarizeTrackSettings(settings: MediaTrackSettings) {
    const result: Record<string, unknown> = {}

    Object.entries(settings).forEach(([key, value]) => {
        result[key] = key === 'deviceId' || key === 'groupId' ? '[redacted]' : value
    })

    return result
}

function summarizeStream(stream: MediaStream | null): StreamSummary | null {
    if (!stream) return null

    return {
        active: stream.active,
        tracks: stream.getTracks().map(track => ({
            kind: track.kind,
            label: track.label || '(no label)',
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            settings: summarizeTrackSettings(track.getSettings()),
        })),
    }
}

function summarizeDevice(device: MediaDeviceInfo, index: number): DeviceSummary {
    return {
        kind: device.kind,
        label: device.label || `${device.kind} ${index + 1}`,
        deviceId: device.deviceId ? '[redacted]' : '',
        groupId: device.groupId ? '[redacted]' : '',
    }
}

function chooseAudioMimeType() {
    if (typeof MediaRecorder === 'undefined') return ''

    return [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
    ].find(type => MediaRecorder.isTypeSupported(type)) ?? ''
}

export function MediaModule() {
    const { tts, shell, media, permission } = useMulby()
    const notify = useNotification()

    const previewVideoRef = useRef<HTMLVideoElement | null>(null)
    const previewStreamRef = useRef<MediaStream | null>(null)
    const recordingStreamRef = useRef<MediaStream | null>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const recordingChunksRef = useRef<Blob[]>([])
    const recordingStartedAtRef = useRef<number | null>(null)
    const recordingUrlRef = useRef<string | null>(null)

    const [text, setText] = useState(SAMPLE_TEXTS[0].text)
    const [voices, setVoices] = useState<Voice[]>([])
    const [selectedVoice, setSelectedVoice] = useState('')
    const [rate, setRate] = useState(1)
    const [pitch, setPitch] = useState(1)
    const [volume, setVolume] = useState(1)
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [permissions, setPermissions] = useState<Record<MediaKind, MediaPermissionSnapshot>>(DEFAULT_PERMISSIONS)
    const [devices, setDevices] = useState<DeviceSummary[]>([])
    const [previewCamera, setPreviewCamera] = useState(true)
    const [previewMicrophone, setPreviewMicrophone] = useState(false)
    const [previewState, setPreviewState] = useState<PreviewState>({ active: false, hasVideo: false, hasAudio: false, startedAt: null })
    const [previewStreamInfo, setPreviewStreamInfo] = useState<StreamSummary | null>(null)
    const [lastMediaConstraints, setLastMediaConstraints] = useState<MediaStreamConstraints | null>(null)
    const [recorderState, setRecorderState] = useState<'idle' | 'recording' | 'recorded'>('idle')
    const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
    const [recordingInfo, setRecordingInfo] = useState<RecordingInfo | null>(null)
    const [recordingDurationMs, setRecordingDurationMs] = useState(0)
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])

    const selectedVoiceInfo = useMemo(
        () => voices.find(voice => voice.name === selectedVoice) || null,
        [selectedVoice, voices]
    )

    const cameraDevices = devices.filter(device => device.kind === 'videoinput')
    const microphoneDevices = devices.filter(device => device.kind === 'audioinput')
    const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput')

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 10))
    }, [])

    const setRecordingObjectUrl = useCallback((url: string | null) => {
        if (recordingUrlRef.current) {
            URL.revokeObjectURL(recordingUrlRef.current)
        }
        recordingUrlRef.current = url
        setRecordingUrl(url)
    }, [])

    const stopPreviewStream = useCallback(() => {
        if (previewStreamRef.current) {
            previewStreamRef.current.getTracks().forEach(track => track.stop())
            previewStreamRef.current = null
        }

        if (previewVideoRef.current) {
            previewVideoRef.current.srcObject = null
        }

        setPreviewState({ active: false, hasVideo: false, hasAudio: false, startedAt: null })
        setPreviewStreamInfo(null)
    }, [])

    const readPermissionSnapshot = useCallback(async (type: MediaKind): Promise<MediaPermissionSnapshot> => {
        try {
            const [status, canRequest, hasAccess] = await Promise.all([
                media.getAccessStatus(type),
                permission.canRequest(type),
                type === 'camera' ? media.hasCameraAccess() : media.hasMicrophoneAccess(),
            ])

            return { status, hasAccess, canRequest }
        } catch (error) {
            return {
                status: null,
                hasAccess: null,
                canRequest: null,
                error: getErrorMessage(error),
            }
        }
    }, [media, permission])

    const loadPermissions = useCallback(async () => {
        setLoadingAction('permissions')
        try {
            const [camera, microphone] = await Promise.all([
                readPermissionSnapshot('camera'),
                readPermissionSnapshot('microphone'),
            ])
            setPermissions({ camera, microphone })
            pushOperation({
                action: 'media.getAccessStatus',
                status: camera.error || microphone.error ? 'warning' : 'success',
                message: '已刷新媒体权限状态',
                details: { camera, microphone },
            })
        } finally {
            setLoadingAction(null)
        }
    }, [pushOperation, readPermissionSnapshot])

    const loadVoices = useCallback(async () => {
        setLoadingAction('voices')
        try {
            const voiceList = tts.getVoices() || []
            setVoices(voiceList)
            setSelectedVoice(current => {
                if (current && voiceList.some(voice => voice.name === current)) return current
                return voiceList.find(voice => voice.lang.toLowerCase().startsWith('zh'))?.name || voiceList[0]?.name || ''
            })
            pushOperation({
                action: 'tts.getVoices',
                status: 'success',
                message: `已加载 ${voiceList.length} 个语音`,
                details: voiceList.map(voice => ({
                    name: voice.name,
                    lang: voice.lang,
                    default: voice.default,
                    localService: voice.localService,
                })),
            })
        } catch (error) {
            pushOperation({
                action: 'tts.getVoices',
                status: 'error',
                message: getErrorMessage(error),
            })
        } finally {
            setLoadingAction(null)
        }
    }, [pushOperation, tts])

    const loadDevices = useCallback(async () => {
        setLoadingAction('devices')
        try {
            if (!navigator.mediaDevices?.enumerateDevices) {
                throw new Error('当前运行环境不支持 enumerateDevices')
            }

            const deviceList = await navigator.mediaDevices.enumerateDevices()
            const nextDevices = deviceList.map(summarizeDevice)
            setDevices(nextDevices)
            pushOperation({
                action: 'navigator.mediaDevices.enumerateDevices',
                status: 'success',
                message: `已读取 ${nextDevices.length} 个媒体设备`,
                details: nextDevices,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({
                action: 'navigator.mediaDevices.enumerateDevices',
                status: 'error',
                message,
            })
            notify.error(`读取媒体设备失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation])

    useEffect(() => {
        void loadPermissions()
        void loadVoices()

        const timer = window.setTimeout(() => {
            void loadVoices()
            void loadDevices()
        }, 500)

        const handleVoicesChanged = () => {
            void loadVoices()
        }

        window.speechSynthesis?.addEventListener('voiceschanged', handleVoicesChanged)

        return () => {
            window.clearTimeout(timer)
            window.speechSynthesis?.removeEventListener('voiceschanged', handleVoicesChanged)
        }
    }, [loadDevices, loadPermissions, loadVoices])

    useEffect(() => {
        const interval = window.setInterval(() => {
            setIsSpeaking(tts.isSpeaking() || false)
        }, 200)

        return () => window.clearInterval(interval)
    }, [tts])

    useEffect(() => {
        if (recorderState !== 'recording') return undefined

        const interval = window.setInterval(() => {
            if (recordingStartedAtRef.current) {
                setRecordingDurationMs(Date.now() - recordingStartedAtRef.current)
            }
        }, 250)

        return () => window.clearInterval(interval)
    }, [recorderState])

    useEffect(() => {
        return () => {
            stopPreviewStream()

            const recorder = mediaRecorderRef.current
            if (recorder) {
                recorder.ondataavailable = null
                recorder.onstop = null
                if (recorder.state !== 'inactive') {
                    recorder.stop()
                }
            }

            recordingStreamRef.current?.getTracks().forEach(track => track.stop())
            if (recordingUrlRef.current) {
                URL.revokeObjectURL(recordingUrlRef.current)
                recordingUrlRef.current = null
            }
        }
    }, [stopPreviewStream])

    const ensureMediaAccess = useCallback(async (type: MediaKind) => {
        const hasAccess = type === 'camera'
            ? await media.hasCameraAccess()
            : await media.hasMicrophoneAccess()

        if (hasAccess) return

        const granted = await media.askForAccess(type)
        if (!granted) {
            throw new Error(`${type === 'camera' ? '摄像头' : '麦克风'}权限未授权`)
        }
    }, [media])

    const handleRequestAccess = useCallback(async (type: MediaKind) => {
        setLoadingAction(`request:${type}`)
        try {
            const granted = await media.askForAccess(type)
            pushOperation({
                action: 'media.askForAccess',
                status: granted ? 'success' : 'warning',
                message: `${type}: ${granted ? '已授权' : '未授权'}`,
            })
            await loadPermissions()
            notify.info(`${type === 'camera' ? '摄像头' : '麦克风'}权限: ${granted ? '已授权' : '未授权'}`)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({
                action: 'media.askForAccess',
                status: 'error',
                message,
                details: { type },
            })
            notify.error(`请求权限失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [loadPermissions, media, notify, pushOperation])

    const handleOpenSettings = useCallback(async (type: MediaKind) => {
        setLoadingAction(`settings:${type}`)
        try {
            const opened = await permission.openSystemSettings(type)
            pushOperation({
                action: 'permission.openSystemSettings',
                status: opened ? 'success' : 'info',
                message: opened ? `已打开 ${type} 系统权限设置` : `当前平台不支持打开 ${type} 权限设置`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({
                action: 'permission.openSystemSettings',
                status: 'error',
                message,
                details: { type },
            })
            notify.error(`打开权限设置失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, permission, pushOperation])

    const handleSpeak = useCallback(() => {
        if (!text.trim()) {
            notify.warning('请输入要朗读的文本')
            return
        }

        setLoadingAction('speak')
        const options = {
            lang: selectedVoiceInfo?.lang,
            rate,
            pitch,
            volume,
        }

        pushOperation({
            action: 'tts.speak',
            status: 'info',
            message: '已提交朗读',
            details: { textLength: text.length, options },
        })
        notify.info('开始朗读')

        void tts.speak(text, options)
            .then(() => {
                pushOperation({
                    action: 'tts.speak',
                    status: 'success',
                    message: '朗读完成',
                })
            })
            .catch(error => {
                const message = getErrorMessage(error)
                pushOperation({
                    action: 'tts.speak',
                    status: 'error',
                    message,
                })
                notify.error(`朗读失败: ${message}`)
            })
            .finally(() => {
                setLoadingAction(null)
            })
    }, [notify, pitch, pushOperation, rate, selectedVoiceInfo, text, tts, volume])

    const handleStop = useCallback(() => {
        tts.stop()
        setLoadingAction(null)
        pushOperation({ action: 'tts.stop', status: 'info', message: '已停止朗读' })
        notify.info('已停止')
    }, [notify, pushOperation, tts])

    const handlePause = useCallback(() => {
        tts.pause()
        pushOperation({ action: 'tts.pause', status: 'info', message: '已暂停朗读' })
        notify.info('已暂停')
    }, [notify, pushOperation, tts])

    const handleResume = useCallback(() => {
        tts.resume()
        pushOperation({ action: 'tts.resume', status: 'info', message: '已恢复朗读' })
        notify.info('继续朗读')
    }, [notify, pushOperation, tts])

    const handleBeep = useCallback(async () => {
        setLoadingAction('beep')
        try {
            await shell.beep()
            pushOperation({ action: 'shell.beep', status: 'success', message: '已播放系统提示音' })
            notify.info('已播放提示音')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.beep', status: 'error', message })
            notify.error(`播放提示音失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, shell])

    const handleStartPreview = useCallback(async () => {
        if (!previewCamera && !previewMicrophone) {
            notify.warning('请至少选择摄像头或麦克风')
            return
        }

        setLoadingAction('preview')
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('当前运行环境不支持 getUserMedia')
            }

            if (previewCamera) await ensureMediaAccess('camera')
            if (previewMicrophone) await ensureMediaAccess('microphone')

            stopPreviewStream()

            const constraints: MediaStreamConstraints = {
                video: previewCamera ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
                audio: previewMicrophone,
            }
            const stream = await navigator.mediaDevices.getUserMedia(constraints)
            previewStreamRef.current = stream

            if (previewVideoRef.current) {
                previewVideoRef.current.srcObject = stream
                if (stream.getVideoTracks().length > 0) {
                    await previewVideoRef.current.play().catch(() => undefined)
                }
            }

            const streamInfo = summarizeStream(stream)
            setPreviewStreamInfo(streamInfo)
            setLastMediaConstraints(constraints)
            setPreviewState({
                active: true,
                hasVideo: stream.getVideoTracks().length > 0,
                hasAudio: stream.getAudioTracks().length > 0,
                startedAt: Date.now(),
            })
            pushOperation({
                action: 'navigator.mediaDevices.getUserMedia',
                status: 'success',
                message: '媒体采集已启动',
                details: { constraints, stream: streamInfo },
            })
            await loadPermissions()
            await loadDevices()
            notify.success('媒体采集已启动')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({
                action: 'navigator.mediaDevices.getUserMedia',
                status: 'error',
                message,
                details: { previewCamera, previewMicrophone },
            })
            notify.error(`媒体采集失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ensureMediaAccess, loadDevices, loadPermissions, notify, previewCamera, previewMicrophone, pushOperation, stopPreviewStream])

    const handleStopPreview = useCallback(() => {
        stopPreviewStream()
        pushOperation({ action: 'MediaStreamTrack.stop', status: 'info', message: '已停止媒体采集' })
    }, [pushOperation, stopPreviewStream])

    const handleStartRecording = useCallback(async () => {
        setLoadingAction('recording')
        try {
            if (typeof MediaRecorder === 'undefined') {
                throw new Error('当前运行环境不支持 MediaRecorder')
            }
            if (!navigator.mediaDevices?.getUserMedia) {
                throw new Error('当前运行环境不支持 getUserMedia')
            }

            await ensureMediaAccess('microphone')

            recordingStreamRef.current?.getTracks().forEach(track => track.stop())
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            recordingStreamRef.current = stream
            recordingChunksRef.current = []
            recordingStartedAtRef.current = Date.now()
            setRecordingDurationMs(0)
            setRecordingInfo(null)
            setRecordingObjectUrl(null)

            const mimeType = chooseAudioMimeType()
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            mediaRecorderRef.current = recorder
            recorder.ondataavailable = event => {
                if (event.data.size > 0) {
                    recordingChunksRef.current.push(event.data)
                }
            }
            recorder.onstop = () => {
                const durationMs = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0
                const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
                const url = URL.createObjectURL(blob)
                setRecordingObjectUrl(url)
                setRecordingInfo({
                    mimeType: blob.type || recorder.mimeType || 'audio/webm',
                    size: blob.size,
                    durationMs,
                })
                setRecordingDurationMs(durationMs)
                setRecorderState('recorded')
                recordingStartedAtRef.current = null
                recordingStreamRef.current?.getTracks().forEach(track => track.stop())
                recordingStreamRef.current = null
                pushOperation({
                    action: 'MediaRecorder.stop',
                    status: 'success',
                    message: '录音已生成',
                    details: { size: blob.size, mimeType: blob.type, durationMs },
                })
            }

            recorder.start()
            setRecorderState('recording')
            pushOperation({
                action: 'MediaRecorder.start',
                status: 'success',
                message: '麦克风录音已开始',
                details: summarizeStream(stream),
            })
            await loadPermissions()
            notify.info('录音已开始')
        } catch (error) {
            const message = getErrorMessage(error)
            recordingStreamRef.current?.getTracks().forEach(track => track.stop())
            recordingStreamRef.current = null
            recordingStartedAtRef.current = null
            setRecorderState(recordingUrl ? 'recorded' : 'idle')
            pushOperation({
                action: 'MediaRecorder.start',
                status: 'error',
                message,
            })
            notify.error(`录音失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ensureMediaAccess, loadPermissions, notify, pushOperation, recordingUrl, setRecordingObjectUrl])

    const handleStopRecording = useCallback(() => {
        const recorder = mediaRecorderRef.current
        if (!recorder || recorder.state === 'inactive') return
        recorder.stop()
    }, [])

    const handleClearRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        recordingStreamRef.current?.getTracks().forEach(track => track.stop())
        recordingStreamRef.current = null
        recordingStartedAtRef.current = null
        recordingChunksRef.current = []
        setRecordingObjectUrl(null)
        setRecordingInfo(null)
        setRecordingDurationMs(0)
        setRecorderState('idle')
        pushOperation({ action: 'MediaRecorder.clear', status: 'info', message: '已清除录音结果' })
    }, [pushOperation, setRecordingObjectUrl])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Media API',
            items: [
                { name: 'media.getAccessStatus(mediaType)', description: '读取摄像头或麦克风权限状态。' },
                { name: 'media.askForAccess(mediaType)', description: '请求摄像头或麦克风权限。' },
                { name: 'media.hasCameraAccess()', description: '检查摄像头是否可用。' },
                { name: 'media.hasMicrophoneAccess()', description: '检查麦克风是否可用。' },
            ],
        },
        {
            title: 'TTS API',
            items: [
                { name: 'tts.speak(text, options)', description: '使用系统语音朗读文本。' },
                { name: 'tts.pause() / tts.resume()', description: '暂停和恢复朗读。' },
                { name: 'tts.stop()', description: '停止当前朗读。' },
                { name: 'tts.getVoices()', description: '获取可用语音列表。' },
                { name: 'tts.isSpeaking()', description: '读取当前朗读状态。' },
            ],
        },
        {
            title: 'Browser Media APIs',
            items: [
                { name: 'navigator.mediaDevices.enumerateDevices()', description: '列出摄像头、麦克风和音频输出设备。' },
                { name: 'navigator.mediaDevices.getUserMedia(constraints)', description: '获取摄像头或麦克风 MediaStream。' },
                { name: 'MediaRecorder', description: '录制麦克风或媒体流内容。' },
            ],
        },
        {
            title: 'Related APIs',
            items: [
                { name: 'permission.canRequest(type)', description: '检查媒体权限是否可程序化请求。' },
                { name: 'permission.openSystemSettings(type)', description: '打开系统摄像头或麦克风权限设置。' },
                { name: 'shell.beep()', description: '播放系统提示音。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '检查和请求媒体权限',
            code: `const cameraStatus = await window.mulby.media.getAccessStatus('camera')
const hasMic = await window.mulby.media.hasMicrophoneAccess()

if (cameraStatus === 'not-determined') {
  await window.mulby.media.askForAccess('camera')
}

if (!hasMic) {
  await window.mulby.media.askForAccess('microphone')
}`,
        },
        {
            title: '获取摄像头和麦克风流',
            code: `const hasCamera = await window.mulby.media.hasCameraAccess()
if (!hasCamera) {
  await window.mulby.media.askForAccess('camera')
}

const stream = await navigator.mediaDevices.getUserMedia({
  video: true,
  audio: true
})

video.srcObject = stream`,
        },
        {
            title: '麦克风录音',
            code: `await window.mulby.media.askForAccess('microphone')

const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
const recorder = new MediaRecorder(stream)
const chunks = []

recorder.ondataavailable = event => chunks.push(event.data)
recorder.onstop = () => {
  const blob = new Blob(chunks, { type: recorder.mimeType })
  const url = URL.createObjectURL(blob)
}

recorder.start()`,
        },
        {
            title: '文字转语音和系统提示音',
            code: `const voices = window.mulby.tts.getVoices()

await window.mulby.tts.speak('Hello Mulby', {
  lang: voices[0]?.lang,
  rate: 1,
  pitch: 1,
  volume: 0.8
})

await window.mulby.shell.beep()`,
        },
    ], [])

    const rawData = useMemo(() => ({
        permissions,
        devices: {
            total: devices.length,
            camera: cameraDevices,
            microphone: microphoneDevices,
            audioOutput: audioOutputDevices,
        },
        tts: {
            textLength: text.length,
            selectedVoice: selectedVoiceInfo,
            rate,
            pitch,
            volume,
            isSpeaking,
            voices,
        },
        preview: {
            options: {
                camera: previewCamera,
                microphone: previewMicrophone,
            },
            state: previewState,
            lastConstraints: lastMediaConstraints,
            stream: previewStreamInfo,
        },
        recorder: {
            state: recorderState,
            durationMs: recordingDurationMs,
            info: recordingInfo,
            hasObjectUrl: Boolean(recordingUrl),
        },
        operations: operationLog,
    }), [audioOutputDevices, cameraDevices, devices.length, isSpeaking, lastMediaConstraints, microphoneDevices, operationLog, permissions, pitch, previewCamera, previewMicrophone, previewState, previewStreamInfo, rate, recorderState, recordingDurationMs, recordingInfo, recordingUrl, selectedVoiceInfo, text.length, voices, volume])

    return (
        <div className="main-content">
            <PageHeader
                icon={Volume2}
                title="媒体与语音"
                description="TTS、摄像头/麦克风权限、媒体采集、麦克风录音和系统提示音"
                actions={(
                    <Button variant="secondary" onClick={() => { void loadPermissions(); void loadDevices(); void loadVoices() }}>
                        <RefreshCw aria-hidden="true" size={14} />
                        刷新
                    </Button>
                )}
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Volume2 aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{voices.length}</div>
                            <div className="stat-label">语音</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Camera aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{statusLabel(permissions.camera.status)}</div>
                            <div className="stat-label">摄像头权限</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Mic aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{statusLabel(permissions.microphone.status)}</div>
                            <div className="stat-label">麦克风权限</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Webcam aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{devices.length}</div>
                            <div className="stat-label">媒体设备</div>
                        </div>
                    </div>

                    <Card title="文字转语音" icon={Volume2}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            <div className="input-group">
                                <label className="input-label">朗读文本</label>
                                <textarea
                                    className="textarea"
                                    value={text}
                                    onChange={(event) => setText(event.target.value)}
                                    placeholder="输入要朗读的文本..."
                                    rows={4}
                                />
                            </div>

                            <div className="action-bar">
                                {SAMPLE_TEXTS.map(sample => (
                                    <Button
                                        key={sample.label}
                                        variant="secondary"
                                        onClick={() => setText(sample.text)}
                                    >
                                        {sample.label}
                                    </Button>
                                ))}
                            </div>

                            <div className="input-group">
                                <label className="input-label">语音 ({voices.length} 个可用)</label>
                                <select
                                    className="select"
                                    value={selectedVoice}
                                    onChange={(event) => setSelectedVoice(event.target.value)}
                                    disabled={voices.length === 0}
                                >
                                    {voices.map(voice => (
                                        <option key={voice.name} value={voice.name}>
                                            {voice.name} ({voice.lang}) {voice.default ? '(默认)' : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-3">
                                <div className="input-group">
                                    <label className="input-label">语速: {rate.toFixed(1)}x</label>
                                    <input className="slider" type="range" min="0.5" max="2" step="0.1" value={rate} onChange={(event) => setRate(Number(event.target.value))} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">音调: {pitch.toFixed(1)}</label>
                                    <input className="slider" type="range" min="0.5" max="2" step="0.1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label">音量: {Math.round(volume * 100)}%</label>
                                    <input className="slider" type="range" min="0" max="1" step="0.1" value={volume} onChange={(event) => setVolume(Number(event.target.value))} />
                                </div>
                            </div>

                            <div className="action-bar">
                                <Button onClick={handleSpeak} disabled={loadingAction === 'speak'}>
                                    <Play aria-hidden="true" size={14} />
                                    朗读
                                </Button>
                                <Button variant="secondary" onClick={handlePause} disabled={!isSpeaking}>
                                    <Pause aria-hidden="true" size={14} />
                                    暂停
                                </Button>
                                <Button variant="secondary" onClick={handleResume}>
                                    <Play aria-hidden="true" size={14} />
                                    继续
                                </Button>
                                <Button variant="secondary" onClick={handleStop}>
                                    <Square aria-hidden="true" size={14} />
                                    停止
                                </Button>
                                <Button variant="secondary" onClick={() => void loadVoices()} loading={loadingAction === 'voices'}>
                                    <RefreshCw aria-hidden="true" size={14} />
                                    语音列表
                                </Button>
                            </div>

                            {isSpeaking && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--spacing-sm)',
                                    color: 'var(--accent)',
                                }}>
                                    <span className="spinner" />
                                    <span>正在朗读...</span>
                                </div>
                            )}
                        </div>
                    </Card>

                    <Card
                        title="摄像头和麦克风权限"
                        icon={Settings}
                        actions={(
                            <Button variant="secondary" onClick={() => void loadPermissions()} loading={loadingAction === 'permissions'}>
                                <RefreshCw aria-hidden="true" size={14} />
                                刷新权限
                            </Button>
                        )}
                    >
                        <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                            {(['camera', 'microphone'] as const).map(type => {
                                const snapshot = permissions[type]
                                const label = type === 'camera' ? '摄像头' : '麦克风'
                                return (
                                    <div className="list-row" key={type}>
                                        <StatusBadge status={permissionBadge(snapshot)}>
                                            {snapshot.error ? '异常' : statusLabel(snapshot.status)}
                                        </StatusBadge>
                                        <div className="list-row-main">{label}</div>
                                        <div className="list-row-meta">
                                            {snapshot.error ? snapshot.error : `可请求: ${snapshot.canRequest === null ? '-' : snapshot.canRequest ? '是' : '否'}`}
                                        </div>
                                        <div className="action-bar">
                                            <Button variant="secondary" onClick={() => void handleRequestAccess(type)} loading={loadingAction === `request:${type}`}>
                                                请求
                                            </Button>
                                            <Button variant="secondary" onClick={() => void handleOpenSettings(type)} loading={loadingAction === `settings:${type}`}>
                                                系统设置
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </Card>

                    <Card
                        title="设备和实时采集"
                        icon={Video}
                        actions={(
                            <Button variant="secondary" onClick={() => void loadDevices()} loading={loadingAction === 'devices'}>
                                <List aria-hidden="true" size={14} />
                                列出设备
                            </Button>
                        )}
                    >
                        <div className="input-row" style={{ alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
                            <label className="input-row" style={{ width: 'auto', alignItems: 'center' }}>
                                <input type="checkbox" checked={previewCamera} onChange={(event) => setPreviewCamera(event.target.checked)} />
                                <span>摄像头视频</span>
                            </label>
                            <label className="input-row" style={{ width: 'auto', alignItems: 'center' }}>
                                <input type="checkbox" checked={previewMicrophone} onChange={(event) => setPreviewMicrophone(event.target.checked)} />
                                <span>麦克风音频</span>
                            </label>
                            <Button onClick={handleStartPreview} loading={loadingAction === 'preview'}>
                                <Webcam aria-hidden="true" size={14} />
                                启动采集
                            </Button>
                            <Button variant="secondary" onClick={handleStopPreview} disabled={!previewState.active}>
                                <CircleStop aria-hidden="true" size={14} />
                                停止采集
                            </Button>
                        </div>

                        <div className="preview-box" style={{ minHeight: 240, marginBottom: 'var(--spacing-md)' }}>
                            <video
                                ref={previewVideoRef}
                                autoPlay
                                muted
                                playsInline
                                style={{
                                    display: previewState.active && previewState.hasVideo ? 'block' : 'none',
                                    maxWidth: '100%',
                                    maxHeight: 220,
                                    borderRadius: 'var(--radius-md)',
                                    background: '#000',
                                }}
                            />
                            {previewState.active && !previewState.hasVideo && (
                                <div>当前只采集麦克风音频，没有视频画面。</div>
                            )}
                            {!previewState.active && (
                                <div>启动采集后会在这里显示摄像头预览或媒体流状态。</div>
                            )}
                        </div>

                        {previewStreamInfo && (
                            <CodeBlock>{JSON.stringify(previewStreamInfo, null, 2)}</CodeBlock>
                        )}

                        {devices.length > 0 && (
                            <div style={{ marginTop: 'var(--spacing-md)' }}>
                                <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>设备列表</div>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                    gap: 'var(--spacing-sm)',
                                }}>
                                    {devices.map((device, index) => (
                                        <div
                                            key={`${device.kind}-${index}`}
                                            style={{
                                                padding: 'var(--spacing-sm)',
                                                background: 'var(--bg-tertiary)',
                                                borderRadius: 'var(--radius-sm)',
                                            }}
                                        >
                                            <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-primary)' }}>
                                                {device.kind === 'videoinput' ? '摄像头' : device.kind === 'audioinput' ? '麦克风' : '音频输出'}
                                            </div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {device.label}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Card>

                    <Card title="麦克风录音" icon={Mic}>
                        <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <Button onClick={handleStartRecording} loading={loadingAction === 'recording'} disabled={recorderState === 'recording'}>
                                <AudioLines aria-hidden="true" size={14} />
                                开始录音
                            </Button>
                            <Button variant="secondary" onClick={handleStopRecording} disabled={recorderState !== 'recording'}>
                                <CircleStop aria-hidden="true" size={14} />
                                停止录音
                            </Button>
                            <Button variant="secondary" onClick={handleClearRecording} disabled={!recordingUrl || recorderState === 'recording'}>
                                清除
                            </Button>
                        </div>

                        <div className="info-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <span className="info-label">状态</span>
                            <span className="info-value">{recorderState === 'recording' ? '录音中' : recorderState === 'recorded' ? '已生成' : '空闲'}</span>
                            <span className="info-label">时长</span>
                            <span className="info-value">{formatDuration(recordingDurationMs)}</span>
                            <span className="info-label">大小</span>
                            <span className="info-value">{recordingInfo ? formatBytes(recordingInfo.size) : '-'}</span>
                            <span className="info-label">格式</span>
                            <span className="info-value">{recordingInfo?.mimeType || '-'}</span>
                        </div>

                        {recordingUrl && (
                            <audio controls src={recordingUrl} style={{ width: '100%' }} />
                        )}
                    </Card>

                    <Card title="系统提示音" icon={Bell}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                            <Button onClick={() => void handleBeep()} loading={loadingAction === 'beep'}>
                                <Bell aria-hidden="true" size={14} />
                                播放提示音
                            </Button>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                                使用系统默认提示音，适合插件完成、失败或需要用户注意时的轻量反馈。
                            </span>
                        </div>
                    </Card>

                    <Card title="可用语音列表" icon={List}>
                        {voices.length > 0 ? (
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                                gap: 'var(--spacing-sm)',
                                maxHeight: 300,
                                overflowY: 'auto',
                            }}>
                                {voices.map(voice => (
                                    <button
                                        key={voice.name}
                                        type="button"
                                        onClick={() => setSelectedVoice(voice.name)}
                                        style={{
                                            padding: 'var(--spacing-sm)',
                                            background: selectedVoice === voice.name ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                                            borderRadius: 'var(--radius-sm)',
                                            cursor: 'pointer',
                                            transition: 'all var(--transition-fast)',
                                            border: selectedVoice === voice.name ? '1px solid var(--accent)' : '1px solid transparent',
                                            color: 'var(--text-primary)',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <div style={{ fontWeight: 500, fontSize: '12px' }}>{voice.name}</div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                                            {voice.lang} {voice.default ? '(默认)' : ''} {voice.localService ? '(本地)' : ''}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div>正在加载语音列表...</div>
                            </div>
                        )}
                    </Card>

                    {operationLog.length > 0 && (
                        <Card title="最近操作" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.map(item => (
                                    <div className="list-row" key={`${item.timestamp}-${item.action}`}>
                                        <StatusBadge status={item.status}>{item.status === 'success' ? '成功' : item.status === 'error' ? '失败' : item.status === 'warning' ? '警告' : '信息'}</StatusBadge>
                                        <div className="list-row-main">{item.action}</div>
                                        <div className="list-row-meta">{item.message}</div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
