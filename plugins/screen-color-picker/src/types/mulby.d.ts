interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

interface MulbyAPI {
  screen?: {
    colorPick?: () => Promise<ColorPickResult | null>
  }
  clipboard?: {
    writeText: (text: string) => Promise<void>
  }
  storage?: {
    get: (key: string, namespace?: string) => Promise<unknown>
    set: (key: string, value: unknown, namespace?: string) => Promise<void>
  }
  notification?: {
    show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  }
  onThemeChange?: (callback: (theme: 'light' | 'dark') => void) => void
  onPluginInit?: (callback: (data: PluginInitData) => void) => void
  window?: {
    hide: (isRestorePreWindow?: boolean) => void
    show: () => void
  }
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  feature?: string
  input: string
  mode?: string
  route?: string
}

interface BackendPluginContext {
  featureCode?: string
  input?: string
}

interface Window {
  mulby?: MulbyAPI
}
