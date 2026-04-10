interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
}

interface MulbyAPI {
  onPluginInit(callback: (data: PluginInitData) => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
  clipboard?: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  notification?: {
    show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
  }
  storage?: {
    get(key: string, namespace?: string): Promise<unknown>
    set(key: string, value: unknown, namespace?: string): Promise<void>
    remove(key: string, namespace?: string): Promise<void>
  }
  http?: {
    get(url: string, headers?: Record<string, string>): Promise<{ status: number; data: string }>
  }
  network?: {
    isOnline(): Promise<boolean>
  }
}

interface Window {
  mulby: MulbyAPI
}

interface BackendPluginAPI {
  notification: {
    show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
  }
}

interface BackendPluginContext {
  api: BackendPluginAPI
  featureCode?: string
  input?: string
}
