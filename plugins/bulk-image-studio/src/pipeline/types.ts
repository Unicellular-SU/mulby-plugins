/** 与 sharp / 输出文件扩展名对齐（小写） */
export type RasterFormat =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'tiff'
  | 'avif'
  | 'bmp'
  | 'gif'

export type WatermarkPosition = 'tl' | 'tr' | 'bl' | 'br' | 'center'

export type BatchStep =
  | { kind: 'compress'; quality?: number }
  | { kind: 'convert'; format: RasterFormat | 'svg' | 'ico' | 'jpg' }
  | { kind: 'resize'; width?: number; height?: number; percent?: number; fit?: 'cover' | 'inside' | 'fill' }
  | {
      kind: 'watermarkText'
      text: string
      fontSize?: number
      color?: string
      opacity?: number
      rotateDeg?: number
      position?: WatermarkPosition
      tile?: boolean
      margin?: number
    }
  | {
      kind: 'watermarkImage'
      path: string
      scale?: number
      opacity?: number
      rotateDeg?: number
      position?: WatermarkPosition
      tile?: boolean
      margin?: number
    }
  | { kind: 'rounded'; percentOfMinSide?: number; fixedRadiusPx?: number }
  | {
      kind: 'padding'
      top?: number
      right?: number
      bottom?: number
      left?: number
      color?: string
      opacity?: number
    }
  | {
      kind: 'cropAspect'
      aspectW: number
      aspectH: number
      gravity?: 'center' | 'north' | 'south' | 'east' | 'west'
    }
  | { kind: 'rotate'; angle: number; background?: string }
  | { kind: 'flip'; horizontal?: boolean; vertical?: boolean }
  | { kind: 'svgMinify' }
  /** 将当前光栅结果导出为单页 PDF（宜放在流水线末尾） */
  | {
      kind: 'toPdf'
      /** 默认 perImage：页尺寸随图；a4：单页 A4 内接居中 */
      pageLayout?: 'perImage' | 'a4'
      /** a4 时四边留白（PDF 点），默认 36 */
      marginPts?: number
    }

export interface MulbyFilesystem {
  readFile(path: string, encoding?: 'utf-8' | 'base64'): Buffer | Uint8Array | string | Promise<Buffer | Uint8Array | string>
  writeFile(
    path: string,
    data: Buffer | Uint8Array | ArrayBuffer | string,
    encoding?: 'utf-8' | 'base64'
  ): void | Promise<void>
  exists(path: string): boolean | Promise<boolean>
  mkdir?(path: string): void | Promise<void>
  unlink?(path: string): void | Promise<void>
}

/** 可持久化的流水线预设（仅存步骤，不含队列文件） */
export interface BatchPipelinePreset {
  id: string
  name: string
  nameSuffix?: string
  steps: BatchStep[]
}

export const PIPELINE_PRESET_SCHEMA_VERSION = 1

export interface BatchPipelinePresetFile {
  schemaVersion: number
  presets: BatchPipelinePreset[]
}

/** 阶段一：处理到系统临时目录，不要求用户先选输出位置 */
export interface BatchProcessPayload {
  files: string[]
  steps: BatchStep[]
  nameSuffix?: string
  /** 为 true 时按 EXIF Orientation 自动旋转像素（sharp.rotate 无参） */
  autoExifOrient?: boolean
}

export interface BatchStagedItem {
  sourcePath: string
  tempPath: string
}

export interface BatchProcessResult {
  staged: BatchStagedItem[]
  errors: { file: string; message: string }[]
  tempRoot: string
}

/** 阶段二：用户选择写入方式后提交 */
export type BatchCommitMode = 'overwrite' | 'sameDir' | 'otherDir'

export interface BatchCommitPayload {
  mode: BatchCommitMode
  /** mode === 'otherDir' 时必填 */
  otherDir?: string
  nameSuffix?: string
  items: BatchStagedItem[]
  /**
   * 非空且 mode 为 sameDir/otherDir 时，按模板生成主文件名（不含扩展名），扩展名仍与暂存一致。
   * 占位：{stem} {ext} {index} {date} {w} {h}
   */
  outputNameTemplate?: string
}

export interface BatchCommitResult {
  written: string[]
  errors: { file: string; message: string }[]
}

export interface BatchDiscardPayload {
  items: BatchStagedItem[]
}

export interface MergePdfPayload {
  files: string[]
  outPath: string
  /** perImage：每页等于图片尺寸（默认）；a4：每页 A4，内接缩放 */
  pageLayout?: 'perImage' | 'a4'
  /** a4 时四边留白（PDF 点），默认 36 */
  marginPts?: number
}

/** 长图合并时每张图的矩形裁剪（0~1 相对原图像素）：左 x0、右 x1、上 y0、下 y1。 */
export interface MergeStripCropRatios {
  y0: number
  y1: number
  x0: number
  x1: number
}

export const DEFAULT_MERGE_STRIP_CROP: MergeStripCropRatios = { y0: 0, y1: 1, x0: 0, x1: 1 }

export interface MergeStripPayload {
  files: string[]
  outPath: string
  direction: 'horizontal' | 'vertical'
  spacing?: number
  background?: string
  /** 与 files 一一对应；缺省或某项省略时按整图处理 */
  stripCropRatios?: MergeStripCropRatios[]
  /** 输出总像素超过此值（百万像素）时中止，默认 200 */
  maxOutputMegapixels?: number
}

export interface MergeGifPayload {
  files: string[]
  outPath: string
  frameDelayMs?: number
  loop?: boolean
  maxSide?: number
  /** 为 true 时帧先走 PNG 调色板量化，减小体积（实验） */
  paletteReduce?: boolean
}

export interface ManualCropPayload {
  filePath: string
  rect: { left: number; top: number; width: number; height: number }
  outPath: string
}
