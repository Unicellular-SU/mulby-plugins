/** Current state of the RapidOCR engine lifecycle */
export type RapidOcrEngineStatus =
  | 'uninitialized' // never loaded yet
  | 'downloading'   // built-in models loading from the plugin package
  | 'initializing'  // WASM compile, session creation
  | 'ready'         // ready to process images
  | 'error'         // initialization or processing failed

/** Progress information during initialization */
export interface RapidOcrProgress {
  status: RapidOcrEngineStatus
  /** Load progress 0-100 */
  downloadPercent: number
  /** Human-readable status message */
  message: string
}
