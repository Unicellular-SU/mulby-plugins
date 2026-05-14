import { useCallback, useMemo, useState } from 'react'
import {
    BadgeInfo,
    Blend,
    Camera,
    ChartNoAxesColumn,
    CircleDot,
    Crop,
    Eraser,
    FileDown,
    FileImage,
    FilePlus2,
    FlipHorizontal,
    FlipVertical,
    FolderOpen,
    Image,
    Layers,
    List,
    Palette,
    RotateCw,
    Save,
    ScanSearch,
    SlidersHorizontal,
    Sparkles,
    SquareDashed,
    SwatchBook,
    Type,
    WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type OutputFormat = 'png' | 'jpeg' | 'webp'
type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type ImageInput = Parameters<MulbySharpFunction>[0]

interface ImageMetadata {
    format?: string
    size?: number
    width?: number
    height?: number
    space?: string
    channels?: number
    depth?: string
    density?: number
    chromaSubsampling?: string
    isProgressive?: boolean
    pages?: number
    hasProfile?: boolean
    hasAlpha?: boolean
    orientation?: number
}

interface ImageStats {
    channels?: Array<{
        min: number
        max: number
        mean: number
        stdev: number
    }>
    isOpaque?: boolean
    entropy?: number
    sharpness?: number
    dominant?: { r: number; g: number; b: number }
}

interface OutputInfo {
    format: string
    width: number
    height: number
    channels: number
    size: number
    premultiplied?: boolean
}

interface SharpVersion {
    sharp: Record<string, string>
    format: Record<string, unknown>
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface TransformRecipe {
    id: string
    label: string
    description: string
    icon: LucideIcon
    requiresSource: boolean
    outputFormat?: OutputFormat
    run: (input: ImageInput) => Promise<ArrayBuffer>
}

const OUTPUT_MIME: Record<OutputFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
}

const IMAGE_FILTERS = [
    { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif'] },
]

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function pathJoin(base: string, name: string) {
    const separator = base.includes('\\') ? '\\' : '/'
    return `${base.replace(/[\\/]+$/, '')}${separator}${name}`
}

function getPathExtension(path: string) {
    return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || 'png'
}

function getMimeFromPath(path: string) {
    const ext = getPathExtension(path)
    if (ext === 'jpg') return 'image/jpeg'
    if (ext === 'svg') return 'image/svg+xml'
    return `image/${ext}`
}

function formatBytes(bytes?: number) {
    if (bytes === undefined) return 'N/A'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString()
}

function bufferToDataUrl(buffer: ArrayBuffer, mimeType = 'image/png') {
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize)
        binary += String.fromCharCode(...chunk)
    }
    return `data:${mimeType};base64,${btoa(binary)}`
}

function summarizeDataUrl(dataUrl: string | null) {
    if (!dataUrl) return null
    const [header, data = ''] = dataUrl.split(',', 2)
    return {
        header,
        base64Length: data.length,
        preview: `${header},[base64:${data.length} chars]`,
    }
}

function summarizeVersion(version: SharpVersion | null) {
    if (!version) return null
    return {
        sharp: {
            sharp: version.sharp.sharp,
            vips: version.sharp.vips,
            mozjpeg: version.sharp.mozjpeg,
            webp: version.sharp.webp,
            png: version.sharp.png,
            jpeg: version.sharp.jpeg,
            tiff: version.sharp.tiff,
        },
        formats: Object.entries(version.format).map(([name, value]) => ({
            name,
            input: Boolean((value as { input?: unknown })?.input),
            output: Boolean((value as { output?: unknown })?.output),
        })),
    }
}

function sanitizeBinaryFields(value: unknown): unknown {
    if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength }
    if (ArrayBuffer.isView(value)) return { type: value.constructor.name, byteLength: value.byteLength }
    if (Array.isArray(value)) return value.map(sanitizeBinaryFields)
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            if (['exif', 'icc', 'iptc', 'xmp', 'tifftagPhotoshop'].includes(key)) {
                result[key] = sanitizeBinaryFields(nestedValue)
            } else {
                result[key] = sanitizeBinaryFields(nestedValue)
            }
        }
        return result
    }
    return value
}

export function SharpModule() {
    const { sharp, getSharpVersion, dialog, filesystem, system, screen } = useMulby()
    const notify = useNotification()

    const [sourcePath, setSourcePath] = useState('')
    const [sourceLabel, setSourceLabel] = useState('未选择图片')
    const [sourcePreview, setSourcePreview] = useState<string | null>(null)
    const [resultPreview, setResultPreview] = useState<string | null>(null)
    const [resultBuffer, setResultBuffer] = useState<ArrayBuffer | null>(null)
    const [resultFormat, setResultFormat] = useState<OutputFormat>('png')
    const [metadata, setMetadata] = useState<ImageMetadata | null>(null)
    const [stats, setStats] = useState<ImageStats | null>(null)
    const [sharpVersion, setSharpVersion] = useState<SharpVersion | null>(null)
    const [toFileInfo, setToFileInfo] = useState<OutputInfo | null>(null)
    const [lastSavePath, setLastSavePath] = useState<string | null>(null)
    const [quality, setQuality] = useState(82)
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])

    const hasSource = Boolean(sourcePath)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 12))
    }, [])

    const setSourceFromPath = useCallback(async (path: string, label?: string) => {
        const base64 = await filesystem.readFile(path, 'base64')
        const preview = typeof base64 === 'string'
            ? `data:${getMimeFromPath(path)};base64,${base64}`
            : bufferToDataUrl(base64, getMimeFromPath(path))
        setSourcePath(path)
        setSourceLabel(label || path)
        setSourcePreview(preview)
        setResultPreview(null)
        setResultBuffer(null)
        setMetadata(null)
        setStats(null)
        setToFileInfo(null)
        setLastSavePath(null)
    }, [filesystem])

    const writeTempImage = useCallback(async (buffer: ArrayBuffer, extension: string) => {
        const tempDir = await system.getPath('temp')
        const filePath = pathJoin(tempDir, `mulby-showcase-sharp-${Date.now()}.${extension}`)
        await filesystem.writeFile(filePath, buffer)
        return filePath
    }, [filesystem, system])

    const handleSelectImage = useCallback(async () => {
        setLoadingAction('select')
        try {
            const [path] = await dialog.showOpenDialog({
                title: '选择图片',
                filters: IMAGE_FILTERS,
                properties: ['openFile'],
            })
            if (!path) {
                pushOperation({
                    action: 'dialog.showOpenDialog',
                    status: 'info',
                    message: '已取消选择图片',
                })
                return
            }
            await setSourceFromPath(path)
            pushOperation({
                action: 'dialog.showOpenDialog + filesystem.readFile',
                status: 'success',
                message: '图片已加载为 Sharp 输入',
                details: { path },
            })
            notify.success('图片已加载')
        } catch (error) {
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`选择图片失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, pushOperation, setSourceFromPath])

    const handleCaptureScreen = useCallback(async () => {
        setLoadingAction('capture-screen')
        try {
            const buffer = await screen.capture({ format: 'png' })
            const path = await writeTempImage(buffer, 'png')
            await setSourceFromPath(path, '屏幕截图临时文件')
            pushOperation({
                action: 'screen.capture + filesystem.writeFile',
                status: 'success',
                message: '已截图并写入临时文件作为 Sharp 输入',
                details: { path, byteLength: buffer.byteLength },
            })
            notify.success('截图已作为图片来源')
        } catch (error) {
            pushOperation({
                action: 'screen.capture',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`截图失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, screen, setSourceFromPath, writeTempImage])

    const handleCreateFixture = useCallback(async () => {
        setLoadingAction('create-fixture')
        try {
            const buffer = await sharp({
                create: {
                    width: 720,
                    height: 420,
                    channels: 4,
                    background: { r: 36, g: 99, b: 235, alpha: 1 },
                },
            })
                .composite([
                    {
                        input: {
                            create: {
                                width: 260,
                                height: 160,
                                channels: 4,
                                background: { r: 250, g: 204, b: 21, alpha: 0.88 },
                            },
                        },
                        left: 56,
                        top: 62,
                        blend: 'over',
                    },
                    {
                        input: {
                            text: {
                                text: 'Mulby Sharp',
                                width: 520,
                                height: 110,
                                channels: 4,
                                rgba: true,
                            },
                        },
                        left: 92,
                        top: 248,
                        blend: 'over',
                    },
                ])
                .png({ compressionLevel: 9 })
                .toBuffer()
            const path = await writeTempImage(buffer, 'png')
            await setSourceFromPath(path, 'Sharp create/text/composite 生成图')
            pushOperation({
                action: 'sharp({ create }).composite().png().toBuffer',
                status: 'success',
                message: '已创建示例图并写入临时文件',
                details: { path, byteLength: buffer.byteLength },
            })
            notify.success('示例图已创建')
        } catch (error) {
            pushOperation({
                action: 'sharp({ create })',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`创建示例图失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, setSourceFromPath, sharp, writeTempImage])

    const handleGetVersion = useCallback(async () => {
        setLoadingAction('version')
        try {
            const version = await getSharpVersion()
            setSharpVersion(version)
            pushOperation({
                action: 'getSharpVersion',
                status: 'success',
                message: '已读取宿主 Sharp/libvips 版本和格式支持',
                details: {
                    sharp: version.sharp.sharp,
                    vips: version.sharp.vips,
                    formatCount: Object.keys(version.format).length,
                },
            })
            notify.success('版本信息已更新')
        } catch (error) {
            pushOperation({
                action: 'getSharpVersion',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`获取版本失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [getSharpVersion, notify, pushOperation])

    const handleGetMetadata = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择或生成图片')
            return
        }
        setLoadingAction('metadata')
        try {
            const meta = await sharp(sourcePath).metadata()
            setMetadata(meta as ImageMetadata)
            pushOperation({
                action: 'sharp(input).metadata',
                status: 'success',
                message: '已读取图片元数据',
                details: sanitizeBinaryFields(meta),
            })
            notify.success('元数据已更新')
        } catch (error) {
            pushOperation({
                action: 'sharp(input).metadata',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`读取元数据失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, sharp, sourcePath])

    const handleGetStats = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择或生成图片')
            return
        }
        setLoadingAction('stats')
        try {
            const imageStats = await sharp(sourcePath).stats()
            setStats(imageStats as ImageStats)
            pushOperation({
                action: 'sharp(input).stats',
                status: 'success',
                message: '已读取通道统计信息',
                details: imageStats,
            })
            notify.success('统计信息已更新')
        } catch (error) {
            pushOperation({
                action: 'sharp(input).stats',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`读取统计失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, sharp, sourcePath])

    const runBufferRecipe = useCallback(async (recipe: TransformRecipe) => {
        if (recipe.requiresSource && !sourcePath) {
            notify.warning('请先选择或生成图片')
            return
        }
        setLoadingAction(recipe.id)
        try {
            const outputFormat = recipe.outputFormat || resultFormat
            const input = recipe.requiresSource ? sourcePath : undefined
            const buffer = await recipe.run(input)
            setResultBuffer(buffer)
            setResultFormat(outputFormat)
            setResultPreview(bufferToDataUrl(buffer, OUTPUT_MIME[outputFormat]))
            setToFileInfo(null)
            pushOperation({
                action: recipe.id,
                status: 'success',
                message: recipe.description,
                details: { outputFormat, byteLength: buffer.byteLength },
            })
            notify.success(recipe.label)
        } catch (error) {
            pushOperation({
                action: recipe.id,
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`${recipe.label}失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, resultFormat, sourcePath])

    const handleSaveResultBuffer = useCallback(async () => {
        if (!resultBuffer) {
            notify.warning('没有可保存的处理结果')
            return
        }
        setLoadingAction('save-buffer')
        try {
            const savePath = await dialog.showSaveDialog({
                title: '保存处理结果',
                defaultPath: `sharp-result-${Date.now()}.${resultFormat}`,
                filters: [{ name: resultFormat.toUpperCase(), extensions: [resultFormat === 'jpeg' ? 'jpg' : resultFormat] }],
            })
            if (!savePath) {
                pushOperation({
                    action: 'dialog.showSaveDialog',
                    status: 'info',
                    message: '已取消保存处理结果',
                })
                return
            }
            await filesystem.writeFile(savePath, resultBuffer)
            setLastSavePath(savePath)
            pushOperation({
                action: 'dialog.showSaveDialog + filesystem.writeFile',
                status: 'success',
                message: '已保存 toBuffer 返回的 ArrayBuffer',
                details: { savePath, byteLength: resultBuffer.byteLength },
            })
            notify.success('处理结果已保存')
        } catch (error) {
            pushOperation({
                action: 'filesystem.writeFile',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`保存失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, filesystem, notify, pushOperation, resultBuffer, resultFormat])

    const handleSaveViaToFile = useCallback(async () => {
        if (!sourcePath) {
            notify.warning('请先选择或生成图片')
            return
        }
        setLoadingAction('to-file')
        try {
            const savePath = await dialog.showSaveDialog({
                title: '使用 Sharp toFile 保存',
                defaultPath: `sharp-tofile-${Date.now()}.webp`,
                filters: [{ name: 'WebP 图片', extensions: ['webp'] }],
            })
            if (!savePath) {
                pushOperation({
                    action: 'dialog.showSaveDialog',
                    status: 'info',
                    message: '已取消 toFile 保存',
                })
                return
            }
            const info = await sharp(sourcePath)
                .resize(640, undefined, { fit: 'inside', withoutEnlargement: true } as object)
                .withMetadata()
                .webp({ quality })
                .toFile(savePath)
            setToFileInfo(info)
            setLastSavePath(savePath)
            pushOperation({
                action: 'sharp(input).resize().withMetadata().webp().toFile',
                status: 'success',
                message: '已通过 Sharp toFile 直接写入文件',
                details: { savePath, info },
            })
            notify.success('toFile 已保存')
        } catch (error) {
            pushOperation({
                action: 'sharp(input).toFile',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`toFile 保存失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, pushOperation, quality, sharp, sourcePath])

    const recipes: TransformRecipe[] = useMemo(() => [
        {
            id: 'resize-extract-extend',
            label: '缩放裁剪画布',
            description: 'resize / extract / extend 组合已输出 PNG',
            icon: Crop,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(640, 420, { fit: 'cover', position: 'center' })
                .extract({ left: 80, top: 40, width: 420, height: 280 })
                .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#f8fafc' })
                .png({ compressionLevel: 9 })
                .toBuffer(),
        },
        {
            id: 'trim-rotate-flip',
            label: '旋转与翻转',
            description: 'rotate / flip / flop / trim 组合已输出 PNG',
            icon: RotateCw,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(520, 520, { fit: 'inside', background: '#ffffff' })
                .extend({ top: 16, bottom: 16, left: 16, right: 16, background: '#ffffff' })
                .trim({ threshold: 8 })
                .rotate(90, { background: '#ffffff' })
                .flip()
                .flop()
                .png()
                .toBuffer(),
        },
        {
            id: 'affine-transform',
            label: '仿射变换',
            description: 'affine 已输出带背景的 PNG',
            icon: SquareDashed,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(420, 300, { fit: 'contain', background: '#ffffff' })
                .affine([[1, 0.16], [0.08, 1]], { background: '#f1f5f9', odx: 22, ody: 18 })
                .png()
                .toBuffer(),
        },
        {
            id: 'filter-stack',
            label: '滤镜增强',
            description: 'median / blur / sharpen / normalise / gamma 组合已输出 PNG',
            icon: Sparkles,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(560, undefined, { fit: 'inside' })
                .median(3)
                .blur(0.6)
                .sharpen({ sigma: 1.2 })
                .normalise()
                .gamma(1.8)
                .png()
                .toBuffer(),
        },
        {
            id: 'color-modulate',
            label: '颜色调整',
            description: 'modulate / tint / grayscale / negate / toColorspace 组合已输出 PNG',
            icon: Palette,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(560, undefined, { fit: 'inside' })
                .modulate({ brightness: 1.08, saturation: 0.78, hue: 24 })
                .tint({ r: 48, g: 113, b: 242 })
                .grayscale(false)
                .negate({ alpha: false })
                .toColorspace('srgb')
                .png()
                .toBuffer(),
        },
        {
            id: 'threshold-convolve',
            label: '边缘与阈值',
            description: 'greyscale / convolve / threshold 已输出 PNG',
            icon: ScanSearch,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(560, undefined, { fit: 'inside' })
                .greyscale()
                .convolve({
                    width: 3,
                    height: 3,
                    kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1],
                })
                .threshold(34, { greyscale: false })
                .png()
                .toBuffer(),
        },
        {
            id: 'alpha-flatten',
            label: '透明通道',
            description: 'ensureAlpha / flatten / removeAlpha 已输出 JPEG',
            icon: Eraser,
            requiresSource: true,
            outputFormat: 'jpeg',
            run: input => sharp(input)
                .resize(560, undefined, { fit: 'inside' })
                .ensureAlpha(0.82)
                .flatten({ background: { r: 248, g: 250, b: 252 } })
                .removeAlpha()
                .jpeg({ quality, progressive: true })
                .toBuffer(),
        },
        {
            id: 'channel-bandbool',
            label: '通道运算',
            description: 'extractChannel / bandbool 已输出 PNG',
            icon: CircleDot,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(560, undefined, { fit: 'inside' })
                .extractChannel('red')
                .bandbool('or')
                .png()
                .toBuffer(),
        },
        {
            id: 'composite-watermark',
            label: '文字合成',
            description: 'composite 文本叠加已输出 PNG',
            icon: Layers,
            requiresSource: true,
            outputFormat: 'png',
            run: input => sharp(input)
                .resize(720, 420, { fit: 'cover' })
                .composite([
                    {
                        input: {
                            create: {
                                width: 300,
                                height: 72,
                                channels: 4,
                                background: { r: 15, g: 23, b: 42, alpha: 0.76 },
                            },
                        },
                        left: 28,
                        top: 320,
                        blend: 'over',
                    },
                    {
                        input: {
                            text: {
                                text: 'Mulby Showcase',
                                width: 280,
                                height: 54,
                                channels: 4,
                                rgba: true,
                            },
                        },
                        left: 42,
                        top: 332,
                        blend: 'over',
                    },
                ])
                .png()
                .toBuffer(),
        },
        {
            id: 'format-output',
            label: '格式转换',
            description: `${resultFormat.toUpperCase()} 输出已生成`,
            icon: FileImage,
            requiresSource: true,
            outputFormat: resultFormat,
            run: input => {
                const pipeline = sharp(input)
                    .resize(720, undefined, { fit: 'inside', withoutEnlargement: true } as object)
                    .withMetadata()
                    .timeout({ seconds: 10 })
                if (resultFormat === 'jpeg') return pipeline.jpeg({ quality, progressive: true }).toBuffer()
                if (resultFormat === 'webp') return pipeline.webp({ quality, effort: 4 }).toBuffer()
                return pipeline.png({ compressionLevel: 9 }).toBuffer()
            },
        },
        {
            id: 'create-text',
            label: '创建文字图',
            description: 'text 输入已输出 PNG',
            icon: Type,
            requiresSource: false,
            outputFormat: 'png',
            run: () => sharp({
                text: {
                    text: 'Sharp text input',
                    width: 680,
                    height: 180,
                    channels: 4,
                    rgba: true,
                },
            })
                .extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#111827' })
                .png()
                .toBuffer(),
        },
    ], [quality, resultFormat, sharp])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Sharp 输入与终结方法',
            items: [
                { name: 'sharp(input, options?)', description: '创建渲染进程 Sharp 链式构建器。' },
                { name: 'sharp(...).toBuffer(options?)', description: '执行链并返回 ArrayBuffer。' },
                { name: 'sharp(...).toFile(path)', description: '执行链并由宿主 Sharp 直接写入目标文件。' },
                { name: 'sharp(...).metadata()', description: '读取图片元数据。' },
                { name: 'sharp(...).stats()', description: '读取通道统计、熵、锐度和主色。' },
                { name: 'getSharpVersion()', description: '读取宿主 bundled Sharp/libvips 版本和格式能力。' },
            ],
        },
        {
            title: '尺寸与几何',
            items: [
                { name: 'resize(width?, height?, options?)', description: '调整尺寸，支持 fit、position、background。' },
                { name: 'extract({ left, top, width, height })', description: '裁剪固定区域。' },
                { name: 'extend(options)', description: '扩展画布边缘。' },
                { name: 'trim(options?)', description: '自动裁剪边缘空白。' },
                { name: 'rotate(angle?, options?)', description: '旋转图片或按 EXIF 自动旋转。' },
                { name: 'flip() / flop()', description: '垂直或水平翻转。' },
                { name: 'affine(matrix, options?)', description: '应用仿射变换。' },
            ],
        },
        {
            title: '滤镜、颜色与通道',
            items: [
                { name: 'median(size?) / blur(sigma?) / sharpen(options?)', description: '中值滤波、模糊和锐化。' },
                { name: 'normalise() / gamma() / threshold()', description: '对比度、伽马和阈值处理。' },
                { name: 'convolve(kernel)', description: '应用卷积核。' },
                { name: 'modulate(options) / tint(color)', description: '调整亮度、饱和度、色相和着色。' },
                { name: 'greyscale() / grayscale() / negate()', description: '灰度和反相处理。' },
                { name: 'toColorspace(colorspace)', description: '设置输出颜色空间。' },
                { name: 'ensureAlpha() / flatten() / removeAlpha()', description: '管理 alpha 通道和背景合成。' },
                { name: 'extractChannel(channel) / bandbool(op)', description: '提取通道并做通道布尔运算。' },
            ],
        },
        {
            title: '合成与输出',
            items: [
                { name: 'composite(images)', description: '叠加 create/text/path/buffer 输入。' },
                { name: 'png() / jpeg() / webp()', description: '页面提供稳定可预览的常用格式输出。' },
                { name: 'gif() / tiff() / avif() / heif() / raw()', description: '宿主 Sharp 也支持这些输出链方法，具体编码能力取决于 bundled libvips。' },
                { name: 'withMetadata() / keepExif() / withExif()', description: '控制输出元数据和 EXIF。' },
                { name: 'keepIccProfile() / withIccProfile()', description: '控制 ICC profile。' },
                { name: 'timeout(options)', description: '限制单次 Sharp 操作耗时。' },
                { name: 'tile(options?)', description: '输出深度缩放瓦片。' },
            ],
        },
        {
            title: '相关插件 API',
            items: [
                { name: 'dialog.showOpenDialog(options)', description: '选择本地图片输入。' },
                { name: 'dialog.showSaveDialog(options)', description: '选择处理结果保存路径。' },
                { name: 'filesystem.readFile(path, "base64")', description: '读取图片预览数据。' },
                { name: 'filesystem.writeFile(path, data)', description: '写入临时图片或保存 toBuffer 结果。' },
                { name: 'system.getPath("temp")', description: '获取临时目录保存生成图。' },
                { name: 'screen.capture(options)', description: '截屏作为 Sharp 输入，依赖 screen 权限。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '链式处理并返回 ArrayBuffer',
            code: `const buffer = await window.mulby.sharp(imagePath)
  .resize(640, 420, { fit: 'cover' })
  .extract({ left: 80, top: 40, width: 420, height: 280 })
  .extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#f8fafc' })
  .png({ compressionLevel: 9 })
  .toBuffer()`,
        },
        {
            title: '元数据与统计信息',
            code: `const metadata = await window.mulby.sharp(imagePath).metadata()
const stats = await window.mulby.sharp(imagePath).stats()

console.log(metadata.width, metadata.height, stats.dominant)`,
        },
        {
            title: '合成 create/text 输入',
            code: `const buffer = await window.mulby.sharp(imagePath)
  .resize(720, 420, { fit: 'cover' })
  .composite([
    {
      input: {
        create: {
          width: 300,
          height: 72,
          channels: 4,
          background: { r: 15, g: 23, b: 42, alpha: 0.76 },
        },
      },
      left: 28,
      top: 320,
    },
    {
      input: {
        text: {
          text: 'Mulby Showcase',
          width: 280,
          height: 54,
          channels: 4,
          rgba: true,
        },
      },
      left: 42,
      top: 332,
    },
  ])
  .png()
  .toBuffer()`,
        },
        {
            title: '直接输出文件',
            code: `const info = await window.mulby.sharp(imagePath)
  .resize(640, undefined, { fit: 'inside', withoutEnlargement: true })
  .withMetadata()
  .webp({ quality: 82 })
  .toFile(savePath)`,
        },
        {
            title: '截图或生成图作为输入',
            code: `const screenshot = await window.mulby.screen.capture({ format: 'png' })
const tempDir = await window.mulby.system.getPath('temp')
const path = \`\${tempDir}/sharp-source.png\`
await window.mulby.filesystem.writeFile(path, screenshot)

const output = await window.mulby.sharp(path)
  .modulate({ brightness: 1.08, saturation: 0.78 })
  .webp({ quality: 82 })
  .toBuffer()`,
        },
    ], [])

    const rawData = useMemo(() => ({
        source: {
            path: sourcePath || null,
            label: sourceLabel,
            preview: summarizeDataUrl(sourcePreview),
        },
        result: {
            format: resultFormat,
            preview: summarizeDataUrl(resultPreview),
            buffer: resultBuffer ? { byteLength: resultBuffer.byteLength } : null,
            toFileInfo,
            lastSavePath,
        },
        controls: {
            quality,
        },
        metadata: sanitizeBinaryFields(metadata),
        stats,
        version: summarizeVersion(sharpVersion),
        operations: operationLog,
    }), [lastSavePath, metadata, operationLog, quality, resultBuffer, resultFormat, resultPreview, sharpVersion, sourceLabel, sourcePath, sourcePreview, stats, toFileInfo])

    return (
        <div className="main-content">
            <PageHeader
                icon={Image}
                title="Sharp 图像处理"
                description="宿主 Sharp 运行时、链式图像处理、格式输出与元数据演示"
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
                        <Card
                            title="图片来源"
                            icon={FolderOpen}
                            actions={(
                                <>
                                    <Button variant="secondary" onClick={handleGetVersion} loading={loadingAction === 'version'}>
                                        <BadgeInfo className="inline-icon" aria-hidden="true" size={14} />
                                        版本
                                    </Button>
                                    <Button variant="secondary" onClick={handleCreateFixture} loading={loadingAction === 'create-fixture'}>
                                        <FilePlus2 className="inline-icon" aria-hidden="true" size={14} />
                                        生成示例图
                                    </Button>
                                </>
                            )}
                        >
                            <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <Button variant="primary" onClick={handleSelectImage} loading={loadingAction === 'select'}>
                                    <FolderOpen className="inline-icon" aria-hidden="true" size={14} />
                                    选择图片文件
                                </Button>
                                <Button variant="secondary" onClick={handleCaptureScreen} loading={loadingAction === 'capture-screen'}>
                                    <Camera className="inline-icon" aria-hidden="true" size={14} />
                                    截取屏幕
                                </Button>
                            </div>
                            <div className="list-row">
                                <StatusBadge status={hasSource ? 'success' : 'info'}>{hasSource ? '已加载' : '待加载'}</StatusBadge>
                                <span className="list-row-main">{sourceLabel}</span>
                            </div>
                            {sharpVersion && (
                                <div className="stats-grid" style={{ marginTop: 'var(--spacing-md)' }}>
                                    <div className="stat-item">
                                        <div className="stat-value">{sharpVersion.sharp.sharp || 'N/A'}</div>
                                        <div className="stat-label">sharp</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{sharpVersion.sharp.vips || 'N/A'}</div>
                                        <div className="stat-label">libvips</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{Object.keys(sharpVersion.format).length}</div>
                                        <div className="stat-label">format entries</div>
                                    </div>
                                </div>
                            )}
                        </Card>

                        {(sourcePreview || resultPreview) && (
                            <Card
                                title="图片预览"
                                icon={FileImage}
                                actions={resultBuffer ? (
                                    <Button variant="secondary" onClick={handleSaveResultBuffer} loading={loadingAction === 'save-buffer'}>
                                        <Save className="inline-icon" aria-hidden="true" size={14} />
                                        保存结果
                                    </Button>
                                ) : null}
                            >
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: resultPreview ? 'repeat(auto-fit, minmax(240px, 1fr))' : '1fr',
                                    gap: 'var(--spacing-md)',
                                }}>
                                    <div>
                                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>原图</div>
                                        <div className="preview-box" style={{ minHeight: 240 }}>
                                            {sourcePreview ? <img src={sourcePreview} alt="原图" style={{ maxHeight: 260 }} /> : '暂无原图'}
                                        </div>
                                    </div>
                                    {resultPreview && (
                                        <div>
                                            <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>
                                                处理结果 {resultBuffer ? `(${formatBytes(resultBuffer.byteLength)})` : ''}
                                            </div>
                                            <div className="preview-box" style={{ minHeight: 240 }}>
                                                <img src={resultPreview} alt="处理结果" style={{ maxHeight: 260 }} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                                {lastSavePath && (
                                    <div className="list-row" style={{ marginTop: 'var(--spacing-md)' }}>
                                        <StatusBadge status="success">已保存</StatusBadge>
                                        <span className="list-row-main">{lastSavePath}</span>
                                    </div>
                                )}
                            </Card>
                        )}

                        <Card title="元数据与统计" icon={ChartNoAxesColumn}>
                            <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <Button onClick={handleGetMetadata} loading={loadingAction === 'metadata'} disabled={!hasSource}>
                                    <ChartNoAxesColumn className="inline-icon" aria-hidden="true" size={14} />
                                    读取元数据
                                </Button>
                                <Button variant="secondary" onClick={handleGetStats} loading={loadingAction === 'stats'} disabled={!hasSource}>
                                    <SlidersHorizontal className="inline-icon" aria-hidden="true" size={14} />
                                    读取统计
                                </Button>
                            </div>
                            {(metadata || stats) ? (
                                <div className="stats-grid">
                                    <div className="stat-item">
                                        <div className="stat-value">{metadata?.format || 'N/A'}</div>
                                        <div className="stat-label">格式</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{metadata?.width && metadata?.height ? `${metadata.width}x${metadata.height}` : 'N/A'}</div>
                                        <div className="stat-label">尺寸</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{metadata?.channels ?? 'N/A'}</div>
                                        <div className="stat-label">通道</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{metadata?.space || 'N/A'}</div>
                                        <div className="stat-label">色彩空间</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">{stats?.entropy !== undefined ? stats.entropy.toFixed(2) : 'N/A'}</div>
                                        <div className="stat-label">熵</div>
                                    </div>
                                    <div className="stat-item">
                                        <div className="stat-value">
                                            {stats?.dominant ? `rgb(${stats.dominant.r}, ${stats.dominant.g}, ${stats.dominant.b})` : 'N/A'}
                                        </div>
                                        <div className="stat-label">主色</div>
                                    </div>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <ChartNoAxesColumn aria-hidden="true" size={28} />
                                    <p>读取元数据或统计后显示图片结构信息</p>
                                </div>
                            )}
                        </Card>

                        <Card
                            title="处理参数"
                            icon={SwatchBook}
                            actions={(
                                <Button variant="secondary" onClick={handleSaveViaToFile} loading={loadingAction === 'to-file'} disabled={!hasSource}>
                                    <FileDown className="inline-icon" aria-hidden="true" size={14} />
                                    toFile 保存 WebP
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--spacing-md)' }}>
                                <div>
                                    <label className="input-label" htmlFor="sharp-output-format">输出格式</label>
                                    <select
                                        id="sharp-output-format"
                                        className="input-field"
                                        value={resultFormat}
                                        onChange={event => setResultFormat(event.target.value as OutputFormat)}
                                    >
                                        <option value="png">PNG</option>
                                        <option value="jpeg">JPEG</option>
                                        <option value="webp">WebP</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="input-label" htmlFor="sharp-quality">JPEG/WebP 质量: {quality}</label>
                                    <input
                                        id="sharp-quality"
                                        className="input-field"
                                        type="range"
                                        min="40"
                                        max="100"
                                        value={quality}
                                        onChange={event => setQuality(Number(event.target.value))}
                                    />
                                </div>
                            </div>
                            {toFileInfo && (
                                <div className="list-row" style={{ marginTop: 'var(--spacing-md)' }}>
                                    <StatusBadge status="success">{toFileInfo.format}</StatusBadge>
                                    <span className="list-row-main">
                                        {toFileInfo.width}x{toFileInfo.height}, {toFileInfo.channels} channels, {formatBytes(toFileInfo.size)}
                                    </span>
                                </div>
                            )}
                        </Card>

                        <Card title="图像处理操作" icon={WandSparkles}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
                                <div>
                                    <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>尺寸与几何</div>
                                    <div className="action-bar">
                                        {recipes.slice(0, 3).map(recipe => {
                                            const Icon = recipe.icon
                                            return (
                                                <Button
                                                    key={recipe.id}
                                                    variant="secondary"
                                                    onClick={() => runBufferRecipe(recipe)}
                                                    loading={loadingAction === recipe.id}
                                                    disabled={recipe.requiresSource && !hasSource}
                                                >
                                                    <Icon className="inline-icon" aria-hidden="true" size={14} />
                                                    {recipe.label}
                                                </Button>
                                            )
                                        })}
                                        <Button
                                            variant="secondary"
                                            onClick={() => runBufferRecipe({
                                                id: 'flip-only',
                                                label: '垂直翻转',
                                                description: 'flip 已输出 PNG',
                                                icon: FlipVertical,
                                                requiresSource: true,
                                                outputFormat: 'png',
                                                run: input => sharp(input).flip().png().toBuffer(),
                                            })}
                                            loading={loadingAction === 'flip-only'}
                                            disabled={!hasSource}
                                        >
                                            <FlipVertical className="inline-icon" aria-hidden="true" size={14} />
                                            垂直翻转
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            onClick={() => runBufferRecipe({
                                                ...recipes[1],
                                                id: 'flop-only',
                                                label: '水平翻转',
                                                description: 'flop 已输出 PNG',
                                                icon: FlipHorizontal,
                                                run: input => sharp(input).flop().png().toBuffer(),
                                            })}
                                            loading={loadingAction === 'flop-only'}
                                            disabled={!hasSource}
                                        >
                                            <FlipHorizontal className="inline-icon" aria-hidden="true" size={14} />
                                            水平翻转
                                        </Button>
                                    </div>
                                </div>

                                <div>
                                    <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>滤镜、颜色与通道</div>
                                    <div className="action-bar">
                                        {recipes.slice(3, 8).map(recipe => {
                                            const Icon = recipe.icon
                                            return (
                                                <Button
                                                    key={recipe.id}
                                                    variant="secondary"
                                                    onClick={() => runBufferRecipe(recipe)}
                                                    loading={loadingAction === recipe.id}
                                                    disabled={recipe.requiresSource && !hasSource}
                                                >
                                                    <Icon className="inline-icon" aria-hidden="true" size={14} />
                                                    {recipe.label}
                                                </Button>
                                            )
                                        })}
                                        <Button
                                            variant="secondary"
                                            onClick={() => runBufferRecipe({
                                                id: 'clahe-linear-recomb',
                                                label: '局部均衡',
                                                description: 'clahe / linear / recomb 已输出 PNG',
                                                icon: Blend,
                                                requiresSource: true,
                                                outputFormat: 'png',
                                                run: input => sharp(input)
                                                    .resize(560, undefined, { fit: 'inside' })
                                                    .clahe({ width: 48, height: 48, maxSlope: 3 })
                                                    .linear(1.06, -6)
                                                    .recomb([[1.04, -0.02, 0], [0, 1, 0], [0, -0.02, 1.04]])
                                                    .png()
                                                    .toBuffer(),
                                            })}
                                            loading={loadingAction === 'clahe-linear-recomb'}
                                            disabled={!hasSource}
                                        >
                                            <Blend className="inline-icon" aria-hidden="true" size={14} />
                                            局部均衡
                                        </Button>
                                    </div>
                                </div>

                                <div>
                                    <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>合成与输出</div>
                                    <div className="action-bar">
                                        {recipes.slice(8).map(recipe => {
                                            const Icon = recipe.icon
                                            return (
                                                <Button
                                                    key={recipe.id}
                                                    variant={recipe.id === 'format-output' ? 'primary' : 'secondary'}
                                                    onClick={() => runBufferRecipe(recipe)}
                                                    loading={loadingAction === recipe.id}
                                                    disabled={recipe.requiresSource && !hasSource}
                                                >
                                                    <Icon className="inline-icon" aria-hidden="true" size={14} />
                                                    {recipe.label}
                                                </Button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <Card title="最近操作" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length > 0 ? operationLog.map((item, index) => (
                                    <div className="list-row" key={`${item.timestamp}-${index}`}>
                                        <StatusBadge status={item.status}>{item.status === 'success' ? '成功' : item.status === 'error' ? '失败' : item.status === 'warning' ? '警告' : '信息'}</StatusBadge>
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
