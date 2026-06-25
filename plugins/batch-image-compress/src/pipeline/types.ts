export type OutputFormat = 'jpeg' | 'png' | 'webp'
export type OutputMode = 'overwrite' | 'sameDir' | 'otherDir'

export interface CompressSettings {
  format: OutputFormat | 'original'
  quality: number
  maxWidth?: number
  maxHeight?: number
  suffix: string
  outputMode: OutputMode
  outputDir?: string
}

export interface CompressPayload {
  files: string[]
  settings: CompressSettings
}

export interface StagedItem {
  sourcePath: string
  tempPath: string
  beforeSize: number
  afterSize: number
  beforeWidth: number
  beforeHeight: number
  afterWidth: number
  afterHeight: number
  format: string
  /** true when original kept because compressed was larger */
  keptOriginal: boolean
}

export interface BatchCompressResult {
  staged: StagedItem[]
  errors: { file: string; message: string }[]
  tempRoot: string
}

export interface CommitPayload {
  mode: OutputMode
  otherDir?: string
  suffix: string
  items: StagedItem[]
}

export interface CommitResult {
  written: string[]
  errors: { file: string; message: string }[]
}

export interface DiscardPayload {
  items: StagedItem[]
}

export interface MetadataRow {
  path: string
  width?: number
  height?: number
  format?: string
  size?: number
  error?: string
}
