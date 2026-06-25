type SharpOperation = {
  method: string
  args: unknown[]
}

type SharpExecutePayload = {
  input?: string | Buffer | ArrayBuffer | Uint8Array | object | unknown[]
  options?: object
  operations: SharpOperation[]
}

type SharpApi = {
  execute?: (payload: SharpExecutePayload) => Promise<unknown>
}

declare const mulby: { sharp?: SharpApi }

export type SharpMetadata = {
  format?: string
  width?: number
  height?: number
  channels?: number
  space?: string
  depth?: string
  density?: number
  hasAlpha?: boolean
  orientation?: number
}

export type RawBufferResult = {
  data: Buffer
  info: {
    width: number
    height: number
    channels: number
    size?: number
  }
}

export interface SharpLike {
  resize(...args: unknown[]): SharpLike
  png(...args: unknown[]): SharpLike
  jpeg(...args: unknown[]): SharpLike
  webp(...args: unknown[]): SharpLike
  toBuffer(options?: object): Promise<Buffer>
  toBuffer(options: { resolveWithObject: true }): Promise<RawBufferResult>
  toFile(fileOut: string): Promise<{ format: string; width: number; height: number; channels: number; size: number }>
  metadata(): Promise<SharpMetadata>
}

const CHAIN_METHODS = ['resize', 'png', 'jpeg', 'webp']

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value)
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (isArrayBufferView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data)
  }
  throw new Error('宿主 sharp 返回了无法识别的二进制结果')
}

function reviveSharpResult(value: unknown): unknown {
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || isArrayBufferView(value)) {
    return toBuffer(value)
  }
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return toBuffer(value)
  }
  if (Array.isArray(value)) return value.map(reviveSharpResult)
  if (value && typeof value === 'object') {
    const revived: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      revived[key] = reviveSharpResult(nestedValue)
    }
    return revived
  }
  return value
}

class SharpClient {
  constructor(
    private readonly input?: SharpExecutePayload['input'],
    private readonly options?: object,
    private readonly operations: SharpOperation[] = []
  ) {}

  chain(method: string, args: unknown[]): SharpLike {
    this.operations.push({ method, args })
    return this as unknown as SharpLike
  }

  async toBuffer(options?: object): Promise<Buffer | RawBufferResult> {
    return (await this.execute('toBuffer', options ? [options] : [])) as Buffer | RawBufferResult
  }

  async toFile(fileOut: string): Promise<{ format: string; width: number; height: number; channels: number; size: number }> {
    return (await this.execute('toFile', [fileOut])) as {
      format: string; width: number; height: number; channels: number; size: number
    }
  }

  async metadata(): Promise<SharpMetadata> {
    return (await this.execute('metadata', [])) as SharpMetadata
  }

  private async execute(method: string, args: unknown[]): Promise<unknown> {
    const execute = mulby?.sharp?.execute
    if (typeof execute !== 'function') {
      throw new Error('当前 Mulby 版本未提供后端 sharp.execute API，无法处理图片')
    }

    const result = await execute({
      input: this.input,
      options: this.options,
      operations: [...this.operations, { method, args }],
    })
    return reviveSharpResult(result)
  }
}

for (const method of CHAIN_METHODS) {
  ;(SharpClient.prototype as unknown as Record<string, (...args: unknown[]) => SharpLike>)[method] =
    function (...args: unknown[]) {
      return (this as SharpClient).chain(method, args)
    }
}

export function sharp(input?: SharpExecutePayload['input'], options?: object): SharpLike {
  return new SharpClient(input, options) as unknown as SharpLike
}
