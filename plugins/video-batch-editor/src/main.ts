/// <reference path="./types/mulby.d.ts" />

declare const require: any

const { access, readdir, stat } = require('node:fs/promises')
const path = require('node:path')

type PluginContext = BackendPluginContext

type VideoPreset = 'mp4-h264' | 'mp4-h265' | 'webm' | 'cover-jpg'
type TimeMode = 'full' | 'range' | 'first' | 'remove-start'
type CropMode = 'none' | 'manual' | 'center-square' | 'center-portrait' | 'center-landscape'
type OrientationMode = 'keep' | 'landscape' | 'portrait' | 'square' | 'rotate-left' | 'rotate-right'

type JobOptions = {
  preset: VideoPreset
  outputDirectory?: string
  timeMode?: TimeMode
  trimStartSeconds?: number
  trimDurationSeconds?: number
  removeStartSeconds?: number
  cropMode?: CropMode
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
  orientationMode?: OrientationMode
  width?: number
  height?: number
  videoBitrateKbps?: number
  crf?: number
  watermarkText?: string
}

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
  status: 'ready'
}

const PLUGIN_TAG = '[video-batch-editor]'
const DEFAULT_FFMPEG_BIN = 'ffmpeg'
const MAX_SCAN_DEPTH = 8
const MAX_SCAN_FILES = 5000
const MAX_SKIPPED_SAMPLES = 200
const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.wmv',
  '.flv',
  '.ts',
  '.mpeg',
  '.mpg'
])

let pendingPaths: string[] = []

function log(message: string) {
  console.log(`${PLUGIN_TAG} ${message}`)
}

export function onLoad() {
  log('loaded')
}

export function onUnload() {
  log('unloaded')
}

export function onEnable() {
  log('enabled')
}

export function onDisable() {
  log('disabled')
}

export async function run(context: PluginContext) {
  const raw = context.attachments ?? []
  pendingPaths = raw
    .map((attachment) => attachment.path)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  log(`run feature=${context.featureCode ?? ''} attachments=${pendingPaths.length}`)
}

function isVideoFile(filePath: string) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function pushSkipped(skipped: ScanSkippedItem[], filePath: string, reason: string) {
  if (skipped.length >= MAX_SKIPPED_SAMPLES) return
  skipped.push({
    path: filePath,
    name: path.basename(filePath),
    reason
  })
}

function quoteArg(value: string) {
  if (/^[A-Za-z0-9_./:=,+-]+$/.test(value)) return value
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function clampEvenNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = clampNumber(value, fallback, min, max)
  if (numeric <= 0) return 0
  return Math.max(min, Math.floor(numeric / 2) * 2)
}

function normalizeOptions(options: JobOptions): Required<Omit<JobOptions, 'outputDirectory' | 'watermarkText'>> & {
  outputDirectory?: string
  watermarkText?: string
} {
  const timeMode = options.timeMode ?? (options.trimDurationSeconds && options.trimDurationSeconds > 0 ? 'range' : 'full')
  const cropMode = options.cropMode ?? 'none'
  const orientationMode = options.orientationMode ?? 'keep'

  return {
    preset: options.preset ?? 'mp4-h264',
    outputDirectory: options.outputDirectory,
    timeMode,
    trimStartSeconds: clampNumber(options.trimStartSeconds, 0, 0, 86400),
    trimDurationSeconds: clampNumber(options.trimDurationSeconds, 0, 0, 86400),
    removeStartSeconds: clampNumber(options.removeStartSeconds, 0, 0, 86400),
    cropMode,
    cropX: clampNumber(options.cropX, 0, 0, 7680),
    cropY: clampNumber(options.cropY, 0, 0, 4320),
    cropWidth: clampEvenNumber(options.cropWidth, 1080, 2, 7680),
    cropHeight: clampEvenNumber(options.cropHeight, 1080, 2, 4320),
    orientationMode,
    width: clampEvenNumber(options.width, 1920, 0, 7680),
    height: clampEvenNumber(options.height, 1080, 0, 4320),
    videoBitrateKbps: clampNumber(options.videoBitrateKbps, 4500, 300, 100000),
    crf: clampNumber(options.crf, 23, 0, 51),
    watermarkText: options.watermarkText?.trim() || undefined
  }
}

function outputExtension(preset: VideoPreset) {
  if (preset === 'webm') return '.webm'
  if (preset === 'cover-jpg') return '.jpg'
  return '.mp4'
}

function buildTrimArgs(args: string[], options: ReturnType<typeof normalizeOptions>) {
  if (options.timeMode === 'range') {
    if (options.trimStartSeconds > 0) {
      args.push('-ss', String(options.trimStartSeconds))
    }
    return
  }

  if (options.timeMode === 'first') {
    return
  }

  if (options.timeMode === 'remove-start' && options.removeStartSeconds > 0) {
    args.push('-ss', String(options.removeStartSeconds))
  }
}

function appendDurationArgs(args: string[], options: ReturnType<typeof normalizeOptions>) {
  if ((options.timeMode === 'range' || options.timeMode === 'first') && options.trimDurationSeconds > 0) {
    args.push('-t', String(options.trimDurationSeconds))
  }
}

function buildCropFilters(options: ReturnType<typeof normalizeOptions>) {
  if (options.cropMode === 'manual') {
    if (options.cropWidth <= 0 || options.cropHeight <= 0) return []
    return [`crop=${options.cropWidth}:${options.cropHeight}:${options.cropX}:${options.cropY}`]
  }
  if (options.cropMode === 'center-square') {
    return ['crop=trunc(min(iw\\,ih)/2)*2:trunc(min(iw\\,ih)/2)*2']
  }
  if (options.cropMode === 'center-portrait') {
    return ['crop=trunc(min(iw\\,ih*9/16)/2)*2:trunc(min(ih\\,iw*16/9)/2)*2']
  }
  if (options.cropMode === 'center-landscape') {
    return ['crop=trunc(min(iw\\,ih*16/9)/2)*2:trunc(min(ih\\,iw*9/16)/2)*2']
  }
  return []
}

function buildOrientationFilters(options: ReturnType<typeof normalizeOptions>) {
  if (options.orientationMode === 'rotate-left') return ['transpose=2']
  if (options.orientationMode === 'rotate-right') return ['transpose=1']
  if (options.orientationMode === 'portrait') {
    return [
      'scale=1080:1920:force_original_aspect_ratio=decrease',
      'pad=1080:1920:(ow-iw)/2:(oh-ih)/2'
    ]
  }
  if (options.orientationMode === 'landscape') {
    return [
      'scale=1920:1080:force_original_aspect_ratio=decrease',
      'pad=1920:1080:(ow-iw)/2:(oh-ih)/2'
    ]
  }
  if (options.orientationMode === 'square') {
    return [
      'scale=1080:1080:force_original_aspect_ratio=decrease',
      'pad=1080:1080:(ow-iw)/2:(oh-ih)/2'
    ]
  }
  return []
}

function buildResizeFilters(options: ReturnType<typeof normalizeOptions>) {
  if (options.orientationMode !== 'keep' || options.width <= 0 && options.height <= 0) return []
  const width = options.width > 0 ? String(options.width) : '-2'
  const height = options.height > 0 ? String(options.height) : '-2'
  return [`scale=${width}:${height}:force_original_aspect_ratio=decrease`]
}

function buildVideoFilters(options: ReturnType<typeof normalizeOptions>) {
  const filters: string[] = [
    ...buildCropFilters(options),
    ...buildOrientationFilters(options),
    ...buildResizeFilters(options)
  ]

  if (options.watermarkText) {
    const text = options.watermarkText.replace(/[':\\]/g, '\\$&')
    filters.push(`drawtext=text='${text}':x=w-tw-32:y=h-th-28:fontcolor=white@0.86:fontsize=28:shadowcolor=black@0.5:shadowx=2:shadowy=2`)
  }

  return filters
}

function buildOutputPath(sourcePath: string, options: ReturnType<typeof normalizeOptions>) {
  const parsed = path.parse(sourcePath)
  const outputDir = options.outputDirectory || parsed.dir
  const suffixParts = [
    options.timeMode !== 'full' ? 'clip' : '',
    options.cropMode !== 'none' ? 'crop' : '',
    options.orientationMode !== 'keep' ? options.orientationMode.replace('rotate-', 'rot-') : '',
    options.preset === 'cover-jpg' ? 'cover' : 'edited'
  ].filter(Boolean)
  const suffix = `_${suffixParts.join('_')}`
  return path.join(outputDir, `${parsed.name}${suffix}${outputExtension(options.preset)}`)
}

function buildArgs(sourcePath: string, outputPath: string, options: ReturnType<typeof normalizeOptions>) {
  const args: string[] = ['-y']

  buildTrimArgs(args, options)
  args.push('-i', sourcePath)
  appendDurationArgs(args, options)

  if (options.preset === 'cover-jpg') {
    const filters = buildVideoFilters(options)
    if (filters.length > 0) {
      args.push('-vf', filters.join(','))
    }
    args.push('-frames:v', '1', '-q:v', '2', outputPath)
    return args
  }

  const filters = buildVideoFilters(options)
  if (filters.length > 0) {
    args.push('-vf', filters.join(','))
  }

  if (options.preset === 'mp4-h265') {
    args.push('-c:v', 'libx265', '-crf', String(options.crf), '-tag:v', 'hvc1')
  } else if (options.preset === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-b:v', `${options.videoBitrateKbps}k`)
  } else {
    args.push('-c:v', 'libx264', '-crf', String(options.crf), '-preset', 'medium')
  }

  args.push('-c:a', options.preset === 'webm' ? 'libopus' : 'aac')
  if (options.preset !== 'webm') {
    args.push('-movflags', '+faststart')
  }
  args.push(outputPath)
  return args
}

function buildPreparedJob(sourcePath: string, index: number, options: ReturnType<typeof normalizeOptions>): PreparedJob {
  const outputPath = buildOutputPath(sourcePath, options)
  const args = buildArgs(sourcePath, outputPath, options)
  return {
    id: `${Date.now()}-${index}`,
    sourcePath,
    sourceName: path.basename(sourcePath),
    outputPath,
    preset: options.preset,
    args,
    commandPreview: [DEFAULT_FFMPEG_BIN, ...args].map(quoteArg).join(' '),
    status: 'ready'
  }
}

async function inspectPath(filePath: string): Promise<VideoFileSummary> {
  try {
    await access(filePath)
    const fileStat = await stat(filePath)
    if (fileStat.isDirectory()) {
      return {
        path: filePath,
        name: path.basename(filePath),
        size: 0,
        ok: false,
        error: '请选择“导入文件夹”扫描目录'
      }
    }
    if (!isVideoFile(filePath)) {
      return {
        path: filePath,
        name: path.basename(filePath),
        size: fileStat.size,
        ok: false,
        error: '不是当前支持的视频扩展名'
      }
    }
    return {
      path: filePath,
      name: path.basename(filePath),
      size: fileStat.size,
      ok: true
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      path: filePath,
      name: path.basename(filePath),
      size: 0,
      ok: false,
      error: message
    }
  }
}

async function scanDirectory(
  directoryPath: string,
  files: VideoFileSummary[],
  skipped: ScanSkippedItem[],
  depth = 0
): Promise<{ skippedCount: number; truncated: boolean }> {
  if (depth > MAX_SCAN_DEPTH) {
    pushSkipped(skipped, directoryPath, `超过最大扫描深度 ${MAX_SCAN_DEPTH}`)
    return { skippedCount: 1, truncated: false }
  }

  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushSkipped(skipped, directoryPath, message)
    return { skippedCount: 1, truncated: false }
  }

  let skippedCount = 0
  let truncated = false

  for (const entry of entries) {
    if (files.length >= MAX_SCAN_FILES) {
      truncated = true
      break
    }

    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isSymbolicLink()) {
      skippedCount += 1
      pushSkipped(skipped, entryPath, '跳过符号链接')
      continue
    }

    if (entry.isDirectory()) {
      const result = await scanDirectory(entryPath, files, skipped, depth + 1)
      skippedCount += result.skippedCount
      truncated = truncated || result.truncated
      if (truncated) break
      continue
    }

    if (!entry.isFile()) {
      skippedCount += 1
      pushSkipped(skipped, entryPath, '不是普通文件')
      continue
    }

    if (!isVideoFile(entryPath)) {
      skippedCount += 1
      pushSkipped(skipped, entryPath, '不是当前支持的视频扩展名')
      continue
    }

    try {
      const fileStat = await stat(entryPath)
      files.push({
        path: entryPath,
        name: entry.name,
        size: fileStat.size,
        ok: true
      })
    } catch (error) {
      skippedCount += 1
      const message = error instanceof Error ? error.message : String(error)
      pushSkipped(skipped, entryPath, message)
    }
  }

  return { skippedCount, truncated }
}

export const rpc = {
  async getPendingInit(): Promise<{ paths: string[] }> {
    const paths = [...pendingPaths]
    pendingPaths = []
    return { paths }
  },

  async inspectFiles(filePaths: string[]): Promise<{ files: VideoFileSummary[] }> {
    const unique = [...new Set((filePaths ?? []).filter((value) => typeof value === 'string' && value.length > 0))]
    const files = await Promise.all(unique.map((filePath) => inspectPath(filePath)))

    return { files }
  },

  async scanDirectories(directoryPaths: string[]): Promise<{
    files: VideoFileSummary[]
    skipped: ScanSkippedItem[]
    skippedCount: number
    truncated: boolean
  }> {
    const unique = [...new Set((directoryPaths ?? []).filter((value) => typeof value === 'string' && value.length > 0))]
    const files: VideoFileSummary[] = []
    const skipped: ScanSkippedItem[] = []
    let skippedCount = 0
    let truncated = false

    for (const directoryPath of unique) {
      try {
        const directoryStat = await stat(directoryPath)
        if (!directoryStat.isDirectory()) {
          skippedCount += 1
          pushSkipped(skipped, directoryPath, '不是文件夹')
          continue
        }
      } catch (error) {
        skippedCount += 1
        const message = error instanceof Error ? error.message : String(error)
        pushSkipped(skipped, directoryPath, message)
        continue
      }

      const result = await scanDirectory(directoryPath, files, skipped)
      skippedCount += result.skippedCount
      truncated = truncated || result.truncated
      if (truncated) break
    }

    files.sort((left, right) => left.path.localeCompare(right.path))
    return { files, skipped, skippedCount, truncated }
  },

  async prepareJobs(filePaths: string[], options: JobOptions): Promise<{ jobs: PreparedJob[] }> {
    const normalized = normalizeOptions(options)
    const unique = [...new Set((filePaths ?? []).filter((value) => typeof value === 'string' && value.length > 0))]
    const jobs = unique
      .filter((filePath) => isVideoFile(filePath))
      .map((filePath, index) => buildPreparedJob(filePath, index, normalized))
    return { jobs }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
