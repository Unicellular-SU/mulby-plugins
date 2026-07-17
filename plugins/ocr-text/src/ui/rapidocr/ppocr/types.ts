/** Shared types for the built-in PP-OCR pipeline. */

export type Point = [number, number]

/** RGBA pixel buffer (same layout as ImageData). */
export interface RawImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface OcrLine {
  /** 4 corner points [tl, tr, br, bl] in image coordinates */
  box: Point[]
  text: string
  score: number
}

export interface ModelInput {
  data: Float32Array
  dims: number[]
}

export interface ModelOutput {
  data: Float32Array
  dims: number[]
}

/**
 * Adapter over an ONNX inference session. Keeping this as a plain function
 * lets the pipeline run unchanged in the plugin UI (onnxruntime-web WASM) and
 * in Node (smoke tests) without importing ort here.
 */
export type SessionRunner = (input: ModelInput) => Promise<ModelOutput>
