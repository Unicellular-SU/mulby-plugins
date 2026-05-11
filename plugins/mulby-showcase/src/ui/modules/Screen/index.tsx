import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Camera,
    Clipboard as ClipboardIcon,
    Copy,
    Crosshair,
    FileSearch,
    Grid3X3,
    Image as ImageIcon,
    Info,
    LocateFixed,
    Lock,
    MapPin,
    Monitor,
    MousePointer2,
    Pipette,
    RadioTower,
    RefreshCw,
    Ruler,
    Save,
    ScanLine,
    Video,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

interface CaptureBounds {
    x: number
    y: number
    width: number
    height: number
}

interface DisplayInfo {
    id: number
    label: string
    bounds: CaptureBounds
    workArea: CaptureBounds
    scaleFactor: number
    rotation: number
    isPrimary: boolean
}

interface CaptureSource {
    id: string
    name: string
    thumbnailDataUrl: string
    displayId?: string
    appIconDataUrl?: string
    bounds?: CaptureBounds
}

interface ColorPickResult {
    hex: string
    rgb: string
    r: number
    g: number
    b: number
}

interface CaptureMetadata {
    type: 'region' | 'fullscreen'
    region?: CaptureBounds & { displayId?: number; scaleFactor?: number }
    display?: DisplayInfo
}

interface ScreenAttachment {
    id?: string
    name?: string
    size?: number
    kind?: string
    mime?: string
    ext?: string
    path?: string
    dataUrl?: string
    capture?: CaptureMetadata
}

interface ScreenModuleProps {
    autoAction?: 'region-capture' | null
    onAutoActionDone?: () => void
    attachments?: ScreenAttachment[]
}

type PermissionStatus = 'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'

interface CoordinateConversionResult {
    screenPoint: { x: number; y: number } | null
    dipPoint: { x: number; y: number } | null
    screenRect: CaptureBounds | null
    dipRect: CaptureBounds | null
}

interface OperationLogItem {
    action: string
    status: 'success' | 'error' | 'info'
    message: string
    timestamp: number
    details?: unknown
}

const THUMBNAIL_SIZE = { width: 220, height: 140 }
const DEFAULT_REGION: CaptureBounds = { x: 0, y: 0, width: 640, height: 360 }

function arrayBufferToDataUrl(buffer: ArrayBuffer, mime = 'image/png') {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let index = 0; index < bytes.length; index += chunkSize) {
        const chunk = bytes.subarray(index, index + chunkSize)
        binary += String.fromCharCode(...chunk)
    }
    return `data:${mime};base64,${btoa(binary)}`
}

function dataUrlToArrayBuffer(dataUrl: string) {
    const base64Data = dataUrl.split(',')[1] || ''
    const binaryString = atob(base64Data)
    const bytes = new Uint8Array(binaryString.length)
    for (let index = 0; index < binaryString.length; index++) {
        bytes[index] = binaryString.charCodeAt(index)
    }
    return bytes.buffer
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function isPermissionGranted(status: PermissionStatus | null) {
    return status === 'authorized' || status === 'granted'
}

function summarizeDataUrl(dataUrl: string | null) {
    if (!dataUrl) return null
    const [prefix, data = ''] = dataUrl.split(',', 2)
    return {
        prefix,
        length: dataUrl.length,
        base64Length: data.length,
    }
}

function summarizeSource(source: CaptureSource) {
    return {
        id: source.id,
        name: source.name,
        displayId: source.displayId,
        bounds: source.bounds,
        hasThumbnail: Boolean(source.thumbnailDataUrl),
        hasAppIcon: Boolean(source.appIconDataUrl),
    }
}

function statusLabel(status: PermissionStatus | null) {
    if (status === null) return '未检测'
    return status
}

export function ScreenModule({ autoAction, onAutoActionDone, attachments = [] }: ScreenModuleProps) {
    const { screen, clipboard, filesystem, dialog, permission } = useMulby()
    const notify = useNotification()

    const [displays, setDisplays] = useState<DisplayInfo[]>([])
    const [primaryDisplay, setPrimaryDisplay] = useState<DisplayInfo | null>(null)
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
    const [cursorDisplay, setCursorDisplay] = useState<DisplayInfo | null>(null)
    const [matchingDisplay, setMatchingDisplay] = useState<DisplayInfo | null>(null)
    const [sources, setSources] = useState<CaptureSource[]>([])
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
    const [selectedSourceBounds, setSelectedSourceBounds] = useState<CaptureBounds | null>(null)
    const [screenshot, setScreenshot] = useState<string | null>(null)
    const [lastCaptureMeta, setLastCaptureMeta] = useState<{ type: string; format: 'png' | 'jpeg'; sourceId?: string; region?: CaptureBounds } | null>(null)
    const [pickedColor, setPickedColor] = useState<ColorPickResult | null>(null)
    const [screenPermissionStatus, setScreenPermissionStatus] = useState<PermissionStatus | null>(null)
    const [microphonePermissionStatus, setMicrophonePermissionStatus] = useState<PermissionStatus | null>(null)
    const [captureRegion, setCaptureRegion] = useState<CaptureBounds>(DEFAULT_REGION)
    const [includeAudio, setIncludeAudio] = useState(false)
    const [frameRate, setFrameRate] = useState(30)
    const [mediaStreamConstraints, setMediaStreamConstraints] = useState<object | null>(null)
    const [coordinateConversion, setCoordinateConversion] = useState<CoordinateConversionResult>({
        screenPoint: null,
        dipPoint: null,
        screenRect: null,
        dipRect: null,
    })
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const autoActionRunRef = useRef(false)

    const selectedSource = useMemo(
        () => sources.find(source => source.id === selectedSourceId) || null,
        [selectedSourceId, sources]
    )

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 10))
    }, [])

    const loadPermissions = useCallback(async () => {
        try {
            const [screenStatus, micStatus] = await Promise.all([
                permission.getStatus('screen') as Promise<PermissionStatus>,
                permission.getStatus('microphone') as Promise<PermissionStatus>,
            ])
            setScreenPermissionStatus(screenStatus)
            setMicrophonePermissionStatus(micStatus)
        } catch (error) {
            pushOperation({
                action: 'permission.getStatus',
                status: 'error',
                message: getErrorMessage(error),
            })
        }
    }, [permission, pushOperation])

    const loadDisplays = useCallback(async () => {
        try {
            const [allDisplays, primary, cursor] = await Promise.all([
                screen.getAllDisplays(),
                screen.getPrimaryDisplay(),
                screen.getCursorScreenPoint(),
            ])
            setDisplays(allDisplays || [])
            setPrimaryDisplay(primary)
            setCursorPos(cursor || null)

            if (cursor) {
                const nearest = await screen.getDisplayNearestPoint(cursor)
                setCursorDisplay(nearest)
            }
        } catch (error) {
            pushOperation({
                action: 'screen.getAllDisplays',
                status: 'error',
                message: getErrorMessage(error),
            })
        }
    }, [pushOperation, screen])

    const loadSources = useCallback(async () => {
        setLoadingAction('sources')
        try {
            const allSources = await screen.getSources({
                types: ['screen', 'window'],
                thumbnailSize: THUMBNAIL_SIZE,
            })
            setSources(allSources || [])
            setSelectedSourceId(current => current || allSources?.[0]?.id || null)
            pushOperation({
                action: 'screen.getSources',
                status: 'success',
                message: `已加载 ${allSources?.length || 0} 个捕获源`,
                details: allSources?.map(summarizeSource),
            })
        } catch (error) {
            pushOperation({
                action: 'screen.getSources',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('获取屏幕源失败')
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, screen])

    useEffect(() => {
        void loadDisplays()
        void loadPermissions()
    }, [loadDisplays, loadPermissions])

    useEffect(() => {
        const updateCursor = async () => {
            try {
                const pos = await screen.getCursorScreenPoint()
                setCursorPos(pos || null)
            } catch {
                setCursorPos(null)
            }
        }

        void updateCursor()
        const interval = setInterval(updateCursor, 500)
        return () => clearInterval(interval)
    }, [screen])

    useEffect(() => {
        const attachment = attachments.find(item => item.kind === 'image' && item.dataUrl)
        if (!attachment?.dataUrl) return

        setScreenshot(attachment.dataUrl)
        setLastCaptureMeta({
            type: attachment.capture?.type === 'fullscreen' ? 'preCapture fullscreen' : 'preCapture region',
            format: 'png',
            region: attachment.capture?.region,
        })
        if (attachment.capture?.region) {
            setCaptureRegion({
                x: attachment.capture.region.x,
                y: attachment.capture.region.y,
                width: attachment.capture.region.width,
                height: attachment.capture.region.height,
            })
        }
        pushOperation({
            action: 'manifest.preCapture',
            status: 'success',
            message: '已接收宿主预捕获截图',
            details: {
                name: attachment.name,
                size: attachment.size,
                capture: attachment.capture,
            },
        })
    }, [attachments, pushOperation])

    const handleCapture = useCallback(async () => {
        setLoadingAction('capture')
        try {
            const buffer = await screen.capture({ format: 'png' })
            const dataUrl = arrayBufferToDataUrl(buffer, 'image/png')
            setScreenshot(dataUrl)
            setLastCaptureMeta({ type: 'capture primary', format: 'png' })
            pushOperation({
                action: 'screen.capture',
                status: 'success',
                message: '主屏幕截图成功',
                details: { bytes: buffer.byteLength },
            })
            notify.success('截图成功')
        } catch (error) {
            pushOperation({
                action: 'screen.capture',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('截图失败')
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, screen])

    const handleCaptureSource = useCallback(async (sourceId: string) => {
        setLoadingAction(`capture:${sourceId}`)
        try {
            const buffer = await screen.capture({ sourceId, format: 'png' })
            const dataUrl = arrayBufferToDataUrl(buffer, 'image/png')
            setScreenshot(dataUrl)
            setLastCaptureMeta({ type: 'capture source', format: 'png', sourceId })
            pushOperation({
                action: 'screen.capture(sourceId)',
                status: 'success',
                message: '指定源截图成功',
                details: { sourceId, bytes: buffer.byteLength },
            })
            notify.success('截图成功')
        } catch (error) {
            pushOperation({
                action: 'screen.capture(sourceId)',
                status: 'error',
                message: getErrorMessage(error),
                details: { sourceId },
            })
            notify.error('截图失败')
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, screen])

    const handleRegionBufferCapture = useCallback(async () => {
        setLoadingAction('capture-region')
        try {
            const buffer = await screen.captureRegion(captureRegion, { format: 'png' })
            const dataUrl = arrayBufferToDataUrl(buffer, 'image/png')
            setScreenshot(dataUrl)
            setLastCaptureMeta({ type: 'capture region', format: 'png', region: captureRegion })
            pushOperation({
                action: 'screen.captureRegion',
                status: 'success',
                message: '坐标区域截图成功',
                details: { region: captureRegion, bytes: buffer.byteLength },
            })
            notify.success('区域截图成功')
        } catch (error) {
            pushOperation({
                action: 'screen.captureRegion',
                status: 'error',
                message: getErrorMessage(error),
                details: { region: captureRegion },
            })
            notify.error('区域截图失败')
        } finally {
            setLoadingAction(null)
        }
    }, [captureRegion, notify, pushOperation, screen])

    const handleInteractiveRegionCapture = useCallback(async () => {
        setLoadingAction('interactive-region')
        try {
            const result = await screen.screenCapture()
            if (result) {
                setScreenshot(result)
                setLastCaptureMeta({ type: 'screenCapture interactive', format: 'png' })
                pushOperation({
                    action: 'screen.screenCapture',
                    status: 'success',
                    message: '交互式区域截图成功',
                    details: summarizeDataUrl(result),
                })
                notify.success('区域截图成功')
            } else {
                pushOperation({
                    action: 'screen.screenCapture',
                    status: 'info',
                    message: '已取消交互式区域截图',
                })
                notify.info('已取消截图')
            }
        } catch (error) {
            pushOperation({
                action: 'screen.screenCapture',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('截图失败')
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, screen])

    useEffect(() => {
        if (autoAction !== 'region-capture' || autoActionRunRef.current) return
        autoActionRunRef.current = true
        void (async () => {
            try {
                await handleInteractiveRegionCapture()
            } finally {
                onAutoActionDone?.()
            }
        })()
    }, [autoAction, handleInteractiveRegionCapture, onAutoActionDone])

    const handleCopyScreenshot = useCallback(async () => {
        if (!screenshot) return
        try {
            await clipboard.writeImage(dataUrlToArrayBuffer(screenshot))
            pushOperation({
                action: 'clipboard.writeImage',
                status: 'success',
                message: '截图已复制到剪贴板',
            })
            notify.success('已复制到剪贴板')
        } catch (error) {
            pushOperation({
                action: 'clipboard.writeImage',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('复制失败')
        }
    }, [clipboard, notify, pushOperation, screenshot])

    const handleSaveScreenshot = useCallback(async () => {
        if (!screenshot) return
        try {
            const savePath = await dialog.showSaveDialog({
                title: '保存截图',
                defaultPath: `screenshot-${Date.now()}.png`,
                filters: [{ name: 'PNG 图片', extensions: ['png'] }],
            })

            if (!savePath) return

            const base64Data = screenshot.split(',')[1]
            await filesystem.writeFile(savePath, base64Data, 'base64')
            pushOperation({
                action: 'filesystem.writeFile',
                status: 'success',
                message: '截图已保存',
                details: { path: savePath },
            })
            notify.success('截图已保存')
        } catch (error) {
            pushOperation({
                action: 'filesystem.writeFile',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('保存失败')
        }
    }, [dialog, filesystem, notify, pushOperation, screenshot])

    const handleRequestPermission = useCallback(async (type: 'screen' | 'microphone') => {
        try {
            const status = await permission.request(type) as PermissionStatus
            if (type === 'screen') {
                setScreenPermissionStatus(status)
            } else {
                setMicrophonePermissionStatus(status)
            }
            pushOperation({
                action: 'permission.request',
                status: isPermissionGranted(status) ? 'success' : 'info',
                message: `${type}: ${status}`,
            })
            notify.info(`${type} 权限状态: ${status}`)
        } catch (error) {
            pushOperation({
                action: 'permission.request',
                status: 'error',
                message: getErrorMessage(error),
                details: { type },
            })
            notify.error('请求权限失败')
        }
    }, [notify, permission, pushOperation])

    const handleOpenPermissionSettings = useCallback(async (type: 'screen' | 'microphone') => {
        try {
            const opened = await permission.openSystemSettings(type)
            pushOperation({
                action: 'permission.openSystemSettings',
                status: opened ? 'success' : 'info',
                message: opened ? `已打开 ${type} 系统权限设置` : `当前平台不支持打开 ${type} 权限设置`,
            })
        } catch (error) {
            pushOperation({
                action: 'permission.openSystemSettings',
                status: 'error',
                message: getErrorMessage(error),
                details: { type },
            })
            notify.error('打开权限设置失败')
        }
    }, [notify, permission, pushOperation])

    const handleColorPick = useCallback(async () => {
        setLoadingAction('color-pick')
        try {
            const result = await screen.colorPick()
            if (result) {
                setPickedColor(result)
                pushOperation({
                    action: 'screen.colorPick',
                    status: 'success',
                    message: `取色成功: ${result.hex}`,
                    details: result,
                })
                notify.success(`取色成功: ${result.hex}`)
            } else {
                pushOperation({
                    action: 'screen.colorPick',
                    status: 'info',
                    message: '已取消取色',
                })
                notify.info('已取消取色')
            }
        } catch (error) {
            pushOperation({
                action: 'screen.colorPick',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('取色失败')
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, screen])

    const handleGetDisplayMatching = useCallback(async () => {
        try {
            const display = await screen.getDisplayMatching(captureRegion)
            setMatchingDisplay(display)
            pushOperation({
                action: 'screen.getDisplayMatching',
                status: 'success',
                message: `区域匹配显示器: ${display.label}`,
                details: { region: captureRegion, display },
            })
            notify.success(`区域匹配显示器: ${display.label}`)
        } catch (error) {
            pushOperation({
                action: 'screen.getDisplayMatching',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('获取显示器失败')
        }
    }, [captureRegion, notify, pushOperation, screen])

    const handleGetWindowBounds = useCallback(async () => {
        if (!selectedSourceId) return
        try {
            const bounds = await screen.getWindowBounds(selectedSourceId)
            setSelectedSourceBounds(bounds)
            pushOperation({
                action: 'screen.getWindowBounds',
                status: bounds ? 'success' : 'info',
                message: bounds ? '已获取窗口边界' : '该源未返回窗口边界',
                details: { sourceId: selectedSourceId, bounds },
            })
            if (bounds) {
                setCaptureRegion(bounds)
            }
        } catch (error) {
            pushOperation({
                action: 'screen.getWindowBounds',
                status: 'error',
                message: getErrorMessage(error),
                details: { sourceId: selectedSourceId },
            })
            notify.error('获取窗口边界失败')
        }
    }, [notify, pushOperation, screen, selectedSourceId])

    const handleBuildMediaConstraints = useCallback(async () => {
        if (!selectedSourceId) {
            notify.warning('请先选择一个屏幕或窗口源')
            return
        }

        try {
            const constraints = await screen.getMediaStreamConstraints({
                sourceId: selectedSourceId,
                audio: includeAudio,
                frameRate,
            })
            setMediaStreamConstraints(constraints)
            pushOperation({
                action: 'screen.getMediaStreamConstraints',
                status: 'success',
                message: '已生成录屏约束',
                details: constraints,
            })
            notify.success('录屏约束已生成')
        } catch (error) {
            pushOperation({
                action: 'screen.getMediaStreamConstraints',
                status: 'error',
                message: getErrorMessage(error),
                details: { sourceId: selectedSourceId, includeAudio, frameRate },
            })
            notify.error('生成录屏约束失败')
        }
    }, [frameRate, includeAudio, notify, pushOperation, screen, selectedSourceId])

    const handleCoordinateConversion = useCallback(async () => {
        try {
            const basePoint = cursorPos || { x: captureRegion.x, y: captureRegion.y }
            const [dipPoint, screenPoint, dipRect, screenRect] = await Promise.all([
                screen.screenToDipPoint(basePoint),
                screen.dipToScreenPoint(basePoint),
                screen.screenToDipRect(captureRegion),
                screen.dipToScreenRect(captureRegion),
            ])
            const result = { screenPoint, dipPoint, screenRect, dipRect }
            setCoordinateConversion(result)
            pushOperation({
                action: 'screen coordinate conversion',
                status: 'success',
                message: '坐标转换完成',
                details: result,
            })
        } catch (error) {
            pushOperation({
                action: 'screen coordinate conversion',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('坐标转换失败')
        }
    }, [captureRegion, cursorPos, notify, pushOperation, screen])

    const setRegionValue = useCallback((key: keyof CaptureBounds, value: number) => {
        setCaptureRegion(current => ({
            ...current,
            [key]: key === 'width' || key === 'height' ? Math.max(1, value || 1) : value || 0,
        }))
    }, [])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Screen Display API',
            items: [
                { name: 'screen.getAllDisplays()', description: '获取全部显示器信息。' },
                { name: 'screen.getPrimaryDisplay()', description: '获取主显示器。' },
                { name: 'screen.getCursorScreenPoint()', description: '获取鼠标当前位置。' },
                { name: 'screen.getDisplayNearestPoint(point)', description: '获取离指定点最近的显示器。' },
                { name: 'screen.getDisplayMatching(rect)', description: '获取与矩形区域重叠最多的显示器。' },
            ],
        },
        {
            title: 'Screen Capture API',
            items: [
                { name: 'screen.getSources(options)', description: '获取可捕获的屏幕和窗口源。' },
                { name: 'screen.getWindowBounds(sourceId)', description: '获取窗口捕获源的边界，平台不支持时返回 null。' },
                { name: 'screen.capture(options)', description: '截取主屏幕或指定源，返回图片二进制。' },
                { name: 'screen.captureRegion(region, options)', description: '按屏幕坐标截取指定区域。' },
                { name: 'screen.screenCapture()', description: '启动宿主交互式区域截图，返回 PNG Data URL。' },
                { name: 'manifest.features[].preCapture', description: '功能启动前由宿主预先完成区域或全屏截图并注入附件。' },
            ],
        },
        {
            title: 'Recording And Color API',
            items: [
                { name: 'screen.getMediaStreamConstraints(options)', description: '生成录屏用 getUserMedia 约束。' },
                { name: 'screen.colorPick()', description: '启动屏幕取色器。' },
                { name: 'screen.screenToDipPoint(point)', description: '屏幕物理坐标转 DIP 坐标。' },
                { name: 'screen.dipToScreenPoint(point)', description: 'DIP 坐标转屏幕物理坐标。' },
                { name: 'screen.screenToDipRect(rect)', description: '屏幕物理区域转 DIP 区域。' },
                { name: 'screen.dipToScreenRect(rect)', description: 'DIP 区域转屏幕物理区域。' },
            ],
        },
        {
            title: 'Related APIs',
            items: [
                { name: 'permission.getStatus(type)', description: '查询 screen/microphone 权限状态。' },
                { name: 'permission.request(type)', description: '请求屏幕录制或麦克风权限。' },
                { name: 'permission.openSystemSettings(type)', description: '打开系统权限设置页。' },
                { name: 'clipboard.writeImage(image)', description: '将截图写入剪贴板。' },
                { name: 'filesystem.writeFile(path, data, encoding)', description: '保存截图文件。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '显示器与鼠标位置',
            code: `const displays = await window.mulby.screen.getAllDisplays()
const primary = await window.mulby.screen.getPrimaryDisplay()
const cursor = await window.mulby.screen.getCursorScreenPoint()
const nearest = await window.mulby.screen.getDisplayNearestPoint(cursor)

console.log(displays, primary, nearest)`,
        },
        {
            title: '捕获源、窗口边界和截图',
            code: `const sources = await window.mulby.screen.getSources({
  types: ['screen', 'window'],
  thumbnailSize: { width: 220, height: 140 }
})

const bounds = await window.mulby.screen.getWindowBounds(sources[0].id)
const buffer = await window.mulby.screen.capture({
  sourceId: sources[0].id,
  format: 'png'
})

if (bounds) {
  const regionBuffer = await window.mulby.screen.captureRegion(bounds, { format: 'png' })
  await window.mulby.clipboard.writeImage(regionBuffer)
}`,
        },
        {
            title: '交互式截图和预捕获',
            code: `// manifest.json
{
  "features": [{
    "code": "screenshot",
    "preCapture": "region"
  }]
}

// UI
window.mulby.onPluginInit((data) => {
  const image = data.attachments?.find(item => item.kind === 'image')
  console.log(image?.dataUrl, image?.capture)
})

const dataUrl = await window.mulby.screen.screenCapture()`,
        },
        {
            title: '录屏约束和坐标转换',
            code: `const constraints = await window.mulby.screen.getMediaStreamConstraints({
  sourceId: sources[0].id,
  audio: false,
  frameRate: 30
})

const stream = await navigator.mediaDevices.getUserMedia(constraints)

const dipPoint = await window.mulby.screen.screenToDipPoint({ x: 200, y: 200 })
const screenRect = await window.mulby.screen.dipToScreenRect({
  x: 0,
  y: 0,
  width: 800,
  height: 600
})`,
        },
    ], [])

    const rawData = useMemo(() => ({
        permissions: {
            screen: screenPermissionStatus,
            microphone: microphonePermissionStatus,
        },
        displays,
        primaryDisplay,
        cursor: {
            point: cursorPos,
            nearestDisplay: cursorDisplay,
            matchingDisplay,
        },
        sources: {
            selectedSourceId,
            selectedSourceBounds,
            items: sources.map(summarizeSource),
        },
        capture: {
            region: captureRegion,
            lastCaptureMeta,
            screenshot: summarizeDataUrl(screenshot),
            preCaptureAttachments: attachments.map(item => ({
                name: item.name,
                size: item.size,
                kind: item.kind,
                mime: item.mime,
                capture: item.capture,
                dataUrl: summarizeDataUrl(item.dataUrl || null),
            })),
        },
        recording: {
            includeAudio,
            frameRate,
            constraints: mediaStreamConstraints,
        },
        color: pickedColor,
        coordinateConversion,
        operations: operationLog,
    }), [attachments, captureRegion, coordinateConversion, cursorDisplay, cursorPos, displays, frameRate, includeAudio, lastCaptureMeta, matchingDisplay, mediaStreamConstraints, microphonePermissionStatus, operationLog, pickedColor, primaryDisplay, screenPermissionStatus, screenshot, selectedSourceBounds, selectedSourceId, sources])

    return (
        <div className="main-content">
            <PageHeader
                icon={Monitor}
                title="屏幕与捕获"
                description="显示器信息、截图、取色、录屏约束和坐标转换"
                actions={<Button variant="secondary" onClick={() => { void loadDisplays(); void loadPermissions() }}><RefreshCw aria-hidden="true" size={14} />刷新</Button>}
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Monitor aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{displays.length}</div>
                            <div className="stat-label">显示器</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <FileSearch aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{sources.length}</div>
                            <div className="stat-label">捕获源</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Lock aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{statusLabel(screenPermissionStatus)}</div>
                            <div className="stat-label">屏幕权限</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <ImageIcon aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{screenshot ? '已捕获' : '无'}</div>
                            <div className="stat-label">截图</div>
                        </div>
                    </div>

                    <Card
                        title={`显示器 (${displays.length})`}
                        icon={Monitor}
                        actions={<Button variant="secondary" onClick={loadDisplays}><RefreshCw aria-hidden="true" size={14} />刷新</Button>}
                    >
                        <div className="grid grid-2">
                            {displays.map((display) => (
                                <div
                                    key={display.id}
                                    style={{
                                        padding: 'var(--spacing-md)',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: 'var(--radius-md)',
                                    }}
                                >
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 'var(--spacing-sm)',
                                    }}>
                                        <span style={{ fontWeight: 600 }}>{display.label || `显示器 ${display.id}`}</span>
                                        {display.isPrimary && <StatusBadge status="info">主显示器</StatusBadge>}
                                    </div>
                                    <div className="info-grid" style={{ fontSize: '12px' }}>
                                        <span className="info-label">分辨率</span>
                                        <span className="info-value">{display.bounds.width} × {display.bounds.height}</span>

                                        <span className="info-label">工作区</span>
                                        <span className="info-value">{display.workArea.width} × {display.workArea.height}</span>

                                        <span className="info-label">缩放</span>
                                        <span className="info-value">@{display.scaleFactor}x</span>

                                        <span className="info-label">位置</span>
                                        <span className="info-value">({display.bounds.x}, {display.bounds.y})</span>

                                        <span className="info-label">旋转</span>
                                        <span className="info-value">{display.rotation}°</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {cursorPos && (
                            <div style={{
                                marginTop: 'var(--spacing-md)',
                                display: 'flex',
                                gap: 'var(--spacing-sm)',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                            }}>
                                <MousePointer2 aria-hidden="true" size={14} />
                                <span>鼠标位置: X {cursorPos.x}, Y {cursorPos.y}</span>
                                {cursorDisplay && <StatusBadge status="info">最近显示器: {cursorDisplay.label}</StatusBadge>}
                            </div>
                        )}
                    </Card>

                    <Card title="权限" icon={Lock}>
                        <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                            <div className="list-row">
                                <StatusBadge status={isPermissionGranted(screenPermissionStatus) ? 'success' : screenPermissionStatus === null ? 'info' : 'warning'}>
                                    {statusLabel(screenPermissionStatus)}
                                </StatusBadge>
                                <div className="list-row-main">屏幕录制</div>
                                <div className="action-bar">
                                    <Button variant="secondary" onClick={() => void handleRequestPermission('screen')}>请求</Button>
                                    <Button variant="secondary" onClick={() => void handleOpenPermissionSettings('screen')}>系统设置</Button>
                                </div>
                            </div>
                            <div className="list-row">
                                <StatusBadge status={isPermissionGranted(microphonePermissionStatus) ? 'success' : microphonePermissionStatus === null ? 'info' : 'warning'}>
                                    {statusLabel(microphonePermissionStatus)}
                                </StatusBadge>
                                <div className="list-row-main">麦克风（录屏音频可选）</div>
                                <div className="action-bar">
                                    <Button variant="secondary" onClick={() => void handleRequestPermission('microphone')}>请求</Button>
                                    <Button variant="secondary" onClick={() => void handleOpenPermissionSettings('microphone')}>系统设置</Button>
                                </div>
                            </div>
                        </div>
                    </Card>

                    <Card title="捕获源和截图" icon={Camera}>
                        <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <Button onClick={handleCapture} loading={loadingAction === 'capture'}><Camera aria-hidden="true" size={14} />截取主屏幕</Button>
                            <Button variant="secondary" onClick={loadSources} loading={loadingAction === 'sources'}><FileSearch aria-hidden="true" size={14} />获取源列表</Button>
                            <Button variant="secondary" onClick={() => selectedSourceId && void handleCaptureSource(selectedSourceId)} disabled={!selectedSourceId} loading={loadingAction === `capture:${selectedSourceId}`}><ScanLine aria-hidden="true" size={14} />截取选中源</Button>
                            <Button variant="secondary" onClick={handleGetWindowBounds} disabled={!selectedSourceId}><Ruler aria-hidden="true" size={14} />窗口边界</Button>
                        </div>

                        {sources.length > 0 && (
                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                                    可用源
                                </div>
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                                    gap: 'var(--spacing-sm)',
                                }}>
                                    {sources.slice(0, 12).map((source) => (
                                        <button
                                            key={source.id}
                                            type="button"
                                            onClick={() => setSelectedSourceId(source.id)}
                                            style={{
                                                cursor: 'pointer',
                                                padding: 'var(--spacing-xs)',
                                                background: source.id === selectedSourceId ? 'var(--accent-light)' : 'var(--bg-tertiary)',
                                                border: `1px solid ${source.id === selectedSourceId ? 'var(--accent)' : 'var(--border-primary)'}`,
                                                borderRadius: 'var(--radius-sm)',
                                                textAlign: 'left',
                                                color: 'var(--text-primary)',
                                            }}
                                            title={source.name}
                                        >
                                            {source.thumbnailDataUrl && (
                                                <img
                                                    src={source.thumbnailDataUrl}
                                                    alt={source.name}
                                                    style={{
                                                        width: '100%',
                                                        borderRadius: 'var(--radius-xs)',
                                                        marginBottom: 'var(--spacing-xs)',
                                                    }}
                                                />
                                            )}
                                            <div style={{
                                                fontSize: '11px',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {source.name}
                                            </div>
                                            {source.bounds && (
                                                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                                    {source.bounds.width} × {source.bounds.height}
                                                </div>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {selectedSource && (
                            <div className="info-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <span className="info-label">选中源</span>
                                <span className="info-value">{selectedSource.name}</span>
                                <span className="info-label">源 ID</span>
                                <span className="info-value" style={{ wordBreak: 'break-all', fontSize: '11px' }}>{selectedSource.id}</span>
                                <span className="info-label">边界</span>
                                <span className="info-value">{selectedSourceBounds ? `${selectedSourceBounds.x}, ${selectedSourceBounds.y}, ${selectedSourceBounds.width} × ${selectedSourceBounds.height}` : '未查询或不支持'}</span>
                            </div>
                        )}

                        {screenshot && (
                            <div>
                                <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>截图预览</div>
                                <div className="preview-box" style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <img src={screenshot} alt="截图" />
                                </div>
                                <div className="action-bar">
                                    <Button variant="secondary" onClick={handleCopyScreenshot}><Copy aria-hidden="true" size={14} />复制到剪贴板</Button>
                                    <Button variant="secondary" onClick={handleSaveScreenshot}><Save aria-hidden="true" size={14} />保存到文件</Button>
                                </div>
                            </div>
                        )}
                    </Card>

                    <Card title="区域捕获" icon={Crosshair}>
                        <div className="input-row" style={{ marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                            {(['x', 'y', 'width', 'height'] as const).map(key => (
                                <div className="input-group" style={{ width: 120 }} key={key}>
                                    <label className="input-label">{key}</label>
                                    <input
                                        className="input"
                                        type="number"
                                        value={captureRegion[key]}
                                        onChange={(event) => setRegionValue(key, Number(event.target.value))}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="action-bar">
                            <Button onClick={handleRegionBufferCapture} loading={loadingAction === 'capture-region'}><Grid3X3 aria-hidden="true" size={14} />截取坐标区域</Button>
                            <Button variant="secondary" onClick={handleInteractiveRegionCapture} loading={loadingAction === 'interactive-region'}><LocateFixed aria-hidden="true" size={14} />交互式区域截图</Button>
                            <Button variant="secondary" onClick={handleGetDisplayMatching}><MapPin aria-hidden="true" size={14} />匹配显示器</Button>
                        </div>
                        {matchingDisplay && (
                            <div style={{ marginTop: 'var(--spacing-md)' }}>
                                <StatusBadge status="info">区域匹配: {matchingDisplay.label}</StatusBadge>
                            </div>
                        )}
                    </Card>

                    <Card title="录屏约束" icon={Video}>
                        <div className="input-row" style={{ alignItems: 'center', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                            <label className="input-row" style={{ alignItems: 'center', width: 'auto' }}>
                                <input type="checkbox" checked={includeAudio} onChange={(event) => setIncludeAudio(event.target.checked)} />
                                <span>包含桌面音频</span>
                            </label>
                            <div className="input-group" style={{ width: 150 }}>
                                <label className="input-label">帧率</label>
                                <input
                                    className="input"
                                    type="number"
                                    min={1}
                                    max={120}
                                    value={frameRate}
                                    onChange={(event) => setFrameRate(Math.max(1, Number(event.target.value) || 30))}
                                />
                            </div>
                            <Button onClick={handleBuildMediaConstraints} disabled={!selectedSourceId}><RadioTower aria-hidden="true" size={14} />生成约束</Button>
                        </div>
                        {mediaStreamConstraints && (
                            <CodeBlock>{JSON.stringify(mediaStreamConstraints, null, 2)}</CodeBlock>
                        )}
                    </Card>

                    <Card title="屏幕取色器" icon={Pipette}>
                        <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <Button variant="primary" onClick={handleColorPick} loading={loadingAction === 'color-pick'}><Pipette aria-hidden="true" size={14} />屏幕取色</Button>
                            <Button variant="secondary" onClick={() => pickedColor && void clipboard.writeText(pickedColor.hex)} disabled={!pickedColor}><ClipboardIcon aria-hidden="true" size={14} />复制 HEX</Button>
                        </div>

                        {pickedColor && (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--spacing-md)',
                                padding: 'var(--spacing-md)',
                                background: 'var(--bg-tertiary)',
                                borderRadius: 'var(--radius-md)',
                            }}>
                                <div style={{
                                    width: '60px',
                                    height: '60px',
                                    borderRadius: 'var(--radius-md)',
                                    backgroundColor: pickedColor.hex,
                                    border: '2px solid var(--border-primary)',
                                }} />
                                <div>
                                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                                        HEX: {pickedColor.hex}
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        RGB: {pickedColor.r}, {pickedColor.g}, {pickedColor.b}
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                        {pickedColor.rgb}
                                    </div>
                                </div>
                            </div>
                        )}
                    </Card>

                    <Card title="坐标转换" icon={Ruler}>
                        <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <Button onClick={handleCoordinateConversion}><Ruler aria-hidden="true" size={14} />转换当前坐标</Button>
                        </div>
                        <div className="grid grid-2">
                            <div className="list-row">
                                <StatusBadge status="info">Point</StatusBadge>
                                <div className="list-row-main">Screen to DIP</div>
                                <div className="list-row-meta">{coordinateConversion.dipPoint ? `${coordinateConversion.dipPoint.x}, ${coordinateConversion.dipPoint.y}` : '-'}</div>
                            </div>
                            <div className="list-row">
                                <StatusBadge status="info">Point</StatusBadge>
                                <div className="list-row-main">DIP to Screen</div>
                                <div className="list-row-meta">{coordinateConversion.screenPoint ? `${coordinateConversion.screenPoint.x}, ${coordinateConversion.screenPoint.y}` : '-'}</div>
                            </div>
                            <div className="list-row">
                                <StatusBadge status="info">Rect</StatusBadge>
                                <div className="list-row-main">Screen to DIP</div>
                                <div className="list-row-meta">{coordinateConversion.dipRect ? `${coordinateConversion.dipRect.width} × ${coordinateConversion.dipRect.height}` : '-'}</div>
                            </div>
                            <div className="list-row">
                                <StatusBadge status="info">Rect</StatusBadge>
                                <div className="list-row-main">DIP to Screen</div>
                                <div className="list-row-meta">{coordinateConversion.screenRect ? `${coordinateConversion.screenRect.width} × ${coordinateConversion.screenRect.height}` : '-'}</div>
                            </div>
                        </div>
                    </Card>

                    {operationLog.length > 0 && (
                        <Card title="最近操作" icon={Info}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.map(item => (
                                    <div className="list-row" key={`${item.timestamp}-${item.action}`}>
                                        <StatusBadge status={item.status}>{item.status === 'success' ? '成功' : item.status === 'error' ? '失败' : '信息'}</StatusBadge>
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
