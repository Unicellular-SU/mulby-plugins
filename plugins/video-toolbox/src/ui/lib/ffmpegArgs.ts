import { formatFfmpegTime, formatFileStamp } from './format'

export type Container = 'mp4' | 'mov' | 'mkv' | 'webm' | 'gif'
export type VideoCodec = 'h264' | 'h265' | 'vp9'
export type Quality = 'high' | 'balanced' | 'compact'

const CRF_TABLE: Record<VideoCodec, Record<Quality, number>> = {
  h264: { high: 20, balanced: 23, compact: 28 },
  h265: { high: 22, balanced: 26, compact: 31 },
  vp9: { high: 27, balanced: 31, compact: 35 }
}

export function resolveCodec(container: Container, preferred: VideoCodec): VideoCodec {
  if (container === 'webm') return 'vp9'
  if (container === 'gif') return 'h264'
  if (preferred === 'vp9') return 'h264'
  return preferred
}

export function buildConvertArgs(options: {
  input: string
  output: string
  container: Container
  codec: VideoCodec
  quality: Quality
}): string[] {
  const { input, output, container } = options
  const codec = resolveCodec(container, options.codec)
  const crf = CRF_TABLE[codec][options.quality]

  if (container === 'gif') {
    return [
      '-y',
      '-i',
      input,
      '-vf',
      'fps=12,scale=480:-2:flags=lanczos,split[s0][s1];[s0]palettegen=[p];[s1][p]paletteuse',
      '-loop',
      '0',
      '-an',
      output
    ]
  }

  let videoArgs: string[]
  switch (codec) {
    case 'h265':
      videoArgs = ['-c:v', 'libx265', '-preset', 'fast', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1']
      break
    case 'vp9':
      videoArgs = ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4']
      break
    default:
      videoArgs = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p']
      break
  }

  const audioArgs =
    container === 'webm' ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-c:a', 'aac', '-b:a', '128k']

  const extraArgs: string[] = []
  if (container === 'mp4' || container === 'mov') {
    extraArgs.push('-movflags', '+faststart')
  }

  return [
    '-y',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    ...videoArgs,
    ...audioArgs,
    ...extraArgs,
    output
  ]
}

export function buildTrimFastArgs(options: { input: string; output: string; startSec: number; durationSec: number }): string[] {
  const { input, output, startSec, durationSec } = options
  return [
    '-y',
    '-ss',
    formatFfmpegTime(startSec),
    '-i',
    input,
    '-t',
    formatFfmpegTime(durationSec),
    '-map',
    '0',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    output
  ]
}

export function buildTrimPreciseArgs(options: { input: string; output: string; startSec: number; durationSec: number }): string[] {
  const { input, output, startSec, durationSec } = options
  return [
    '-y',
    '-ss',
    formatFfmpegTime(startSec),
    '-i',
    input,
    '-t',
    formatFfmpegTime(durationSec),
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    output
  ]
}

export function buildSingleFrameArgs(options: { input: string; output: string; atSec: number }): string[] {
  const { input, output, atSec } = options
  return ['-y', '-ss', formatFfmpegTime(atSec), '-i', input, '-frames:v', '1', '-q:v', '2', output]
}

export function buildSequenceFramesArgs(options: {
  input: string
  pattern: string
  intervalSec: number
  startSec?: number
}): string[] {
  const { input, pattern, intervalSec, startSec = 0 } = options
  const fps = 1 / Math.max(0.01, intervalSec)
  const args: string[] = ['-y']
  if (startSec > 0) {
    args.push('-ss', formatFfmpegTime(startSec))
  }
  args.push('-i', input, '-vf', `fps=${fps.toFixed(6)}`, '-q:v', '2', pattern)
  return args
}

export function convertedFileName(stem: string, container: Container): string {
  return `${stem}_converted.${container}`
}

export function clipFileName(stem: string, startSec: number, endSec: number, ext: string): string {
  return `${stem}_clip_${formatFileStamp(startSec)}-${formatFileStamp(endSec)}.${ext}`
}

export function frameFileName(stem: string, atSec: number, ext: 'png' | 'jpg'): string {
  return `${stem}_${formatFileStamp(atSec)}.${ext}`
}
