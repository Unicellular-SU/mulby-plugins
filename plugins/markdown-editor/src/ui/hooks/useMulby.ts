import { useMemo } from 'react'

type NotificationType = 'info' | 'success' | 'warning' | 'error'
type ThemeMode = 'light' | 'dark'
type OpenDialogResult = string[] | { filePaths?: string[] } | undefined

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

interface AiMessageLike {
  role: 'system' | 'user' | 'assistant'
  content?: string
}

interface AiCallOption {
  model?: string
  messages: AiMessageLike[]
  [key: string]: unknown
}

type AiCallResult = Promise<unknown> & { abort?: () => void }

interface AiModelCapabilityInfo {
  type?: string
  isUserSelected?: boolean
}

interface AiModelInfo {
  id?: string
  label?: string
  endpointType?: string
  supportedEndpointTypes?: string[]
  // Per-model capabilities (e.g. { type: 'reasoning' }) — used to flag slow
  // reasoning models in the inline-completion picker. Populated by the host.
  capabilities?: AiModelCapabilityInfo[]
}

interface AiImageGenInput {
  model: string
  prompt: string
  size?: string
  count?: number
}

interface AiImageGenResult {
  images: string[]
  tokens?: { inputTokens: number; outputTokens: number }
}

interface AiImageProgressChunk {
  type: 'status' | 'preview'
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback'
  message?: string
  image?: string
  index?: number
  received?: number
  total?: number
}

type AiImageStreamResult = Promise<AiImageGenResult> & { abort?: () => void }

interface WindowMulby {
  clipboard?: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
    readImage?: () => Promise<ArrayBuffer | null>
    getFormat?: () => Promise<'text' | 'image' | 'files' | 'empty'>
  }
  ai?: {
    call?: (option: AiCallOption, onChunk?: (chunk: unknown) => void) => AiCallResult
    allModels?: () => Promise<AiModelInfo[]>
    abort?: (requestId: string) => Promise<void>
    images?: {
      generate?: (input: AiImageGenInput) => Promise<AiImageGenResult>
      generateStream?: (
        input: AiImageGenInput,
        onChunk: (chunk: AiImageProgressChunk) => void
      ) => AiImageStreamResult
    }
  }
  storage?: {
    get: (key: string, pluginId?: string) => Promise<unknown>
    set: (key: string, value: unknown, pluginId?: string) => Promise<void>
    remove: (key: string, pluginId?: string) => Promise<void>
  }
  notification?: {
    show: (message: string, type?: NotificationType) => void
  }
  dialog?: {
    showOpenDialog: (options?: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: { name: string; extensions: string[] }[]
      properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
    }) => Promise<OpenDialogResult>
    showSaveDialog: (options?: {
      title?: string
      defaultPath?: string
      buttonLabel?: string
      filters?: { name: string; extensions: string[] }[]
    }) => Promise<string | null>
    showMessageBox?: (options: {
      type?: 'none' | 'info' | 'error' | 'question' | 'warning'
      title?: string
      message: string
      detail?: string
      buttons?: string[]
      defaultId?: number
      cancelId?: number
    }) => Promise<{ response: number; checkboxChecked: boolean }>
  }
  filesystem?: {
    readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string | ArrayBuffer | Uint8Array>
    writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') => Promise<void>
    exists?: (path: string) => Promise<boolean>
    mkdir?: (path: string) => Promise<void>
  }
  system?: {
    getPath?: (name: string) => Promise<string>
  }
  onThemeChange?: (callback: (theme: ThemeMode) => void) => void
  onPluginInit?: (callback: (data: PluginInitData) => void) => void
}

declare global {
  interface Window {
    mulby?: WindowMulby
  }
}

export function useMulby(pluginId?: string) {
  return useMemo(() => ({
    clipboard: {
      readText: () => window.mulby?.clipboard?.readText() ?? Promise.resolve(''),
      writeText: (text: string) => window.mulby?.clipboard?.writeText(text) ?? Promise.resolve(),
      readImage: () => window.mulby?.clipboard?.readImage?.() ?? Promise.resolve(null),
      getFormat: () => window.mulby?.clipboard?.getFormat?.() ?? Promise.resolve('empty' as const)
    },
    storage: {
      get: (key: string) => window.mulby?.storage?.get(key, pluginId) ?? Promise.resolve(undefined),
      set: (key: string, value: unknown) => window.mulby?.storage?.set(key, value, pluginId) ?? Promise.resolve(),
      remove: (key: string) => window.mulby?.storage?.remove(key, pluginId) ?? Promise.resolve()
    },
    notification: {
      show: (message: string, type?: NotificationType) => window.mulby?.notification?.show(message, type)
    },
    dialog: {
      showOpenDialog: (options?: {
        title?: string
        defaultPath?: string
        buttonLabel?: string
        filters?: { name: string; extensions: string[] }[]
        properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
      }) => window.mulby?.dialog?.showOpenDialog(options) ?? Promise.resolve(undefined),
      showSaveDialog: (options?: {
        title?: string
        defaultPath?: string
        buttonLabel?: string
        filters?: { name: string; extensions: string[] }[]
      }) => window.mulby?.dialog?.showSaveDialog(options) ?? Promise.resolve(null),
      showMessageBox: (options: {
        type?: 'none' | 'info' | 'error' | 'question' | 'warning'
        title?: string
        message: string
        detail?: string
        buttons?: string[]
        defaultId?: number
        cancelId?: number
      }) =>
        window.mulby?.dialog?.showMessageBox?.(options) ??
        Promise.resolve({ response: 1, checkboxChecked: false })
    },
    filesystem: {
      readFile: (path: string, encoding?: 'utf-8' | 'base64') =>
        window.mulby?.filesystem?.readFile(path, encoding) ?? Promise.resolve(''),
      writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') =>
        window.mulby?.filesystem?.writeFile(path, data, encoding) ?? Promise.resolve(),
      exists: (path: string) => window.mulby?.filesystem?.exists?.(path) ?? Promise.resolve(false),
      mkdir: (path: string) => window.mulby?.filesystem?.mkdir?.(path) ?? Promise.resolve()
    },
    system: {
      getPath: (name: string) => window.mulby?.system?.getPath?.(name) ?? Promise.resolve('')
    },
    ai: {
      call: (option: AiCallOption, onChunk?: (chunk: unknown) => void): AiCallResult => {
        const host = window.mulby?.ai?.call
        if (host) {
          return host(option, onChunk)
        }
        const fallback = Promise.reject(new Error('当前环境未启用 Mulby AI 能力')) as AiCallResult
        fallback.abort = () => undefined
        // Avoid unhandled-rejection noise when the result is never awaited.
        fallback.catch(() => undefined)
        return fallback
      },
      allModels: (): Promise<AiModelInfo[]> => window.mulby?.ai?.allModels?.() ?? Promise.resolve([]),
      abort: (requestId: string) => window.mulby?.ai?.abort?.(requestId) ?? Promise.resolve(),
      images: {
        generate: (input: AiImageGenInput): Promise<AiImageGenResult> => {
          const host = window.mulby?.ai?.images?.generate
          if (host) {
            return host(input)
          }
          return Promise.reject(new Error('当前环境未启用 Mulby 生图能力'))
        },
        generateStream: (
          input: AiImageGenInput,
          onChunk: (chunk: AiImageProgressChunk) => void
        ): AiImageStreamResult => {
          const host = window.mulby?.ai?.images?.generateStream
          if (host) {
            return host(input, onChunk)
          }
          const fallback = Promise.reject(
            new Error('当前环境未启用 Mulby 生图能力')
          ) as AiImageStreamResult
          fallback.abort = () => undefined
          // Avoid unhandled-rejection noise when the result is never awaited.
          fallback.catch(() => undefined)
          return fallback
        }
      }
    }
  }), [pluginId])
}
