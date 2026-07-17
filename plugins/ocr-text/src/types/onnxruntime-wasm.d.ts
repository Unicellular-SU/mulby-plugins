// onnxruntime-web 1.21's exports map has no "types" condition, so under
// `moduleResolution: bundler` its bundled type declarations never load.
// Declare just the API surface the OCR engine uses.
declare module 'onnxruntime-web/wasm' {
  export interface OrtTensor {
    data: Float32Array
    dims: readonly number[]
  }

  export class Tensor {
    constructor(type: 'float32', data: Float32Array, dims: number[])
  }

  export interface InferenceSession {
    inputNames: string[]
    outputNames: string[]
    run(feeds: Record<string, Tensor>): Promise<Record<string, OrtTensor>>
  }

  export const InferenceSession: {
    create(model: Uint8Array | string, options?: { executionProviders?: string[] }): Promise<InferenceSession>
  }

  export const env: {
    wasm: {
      proxy: boolean
      numThreads: number
      wasmPaths?: string | { mjs?: string; wasm?: string }
    }
  }
}
