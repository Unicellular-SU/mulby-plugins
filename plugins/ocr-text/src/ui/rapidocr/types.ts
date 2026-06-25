/** Current state of the RapidOCR engine lifecycle */
export type RapidOcrEngineStatus =
  | 'uninitialized' // never loaded yet
  | 'downloading'   // models downloading from CDN
  | 'initializing'  // WASM compile, worker spawn
  | 'ready'         // ready to process images
  | 'error'         // initialization or processing failed

/** Progress information during initialization */
export interface RapidOcrProgress {
  status: RapidOcrEngineStatus
  /** Download progress 0-100, only meaningful when status === 'downloading' */
  downloadPercent: number
  /** Human-readable status message */
  message: string
}

/** Capability check result */
export interface RapidOcrCapabilities {
  webAssembly: boolean
  webGL: boolean
  webWorker: boolean
  indexedDB: boolean
  allSupported: boolean
  missingFeatures: string[]
}

/** Configuration for the RapidOCR engine */
export interface RapidOcrConfig {
  /** Language model, default 'ch' (Chinese + English) */
  language?: string
  /** Model version, default 'PP-OCRv4' */
  modelVersion?: string
  /** Model type, default 'mobile' */
  modelType?: string
}
