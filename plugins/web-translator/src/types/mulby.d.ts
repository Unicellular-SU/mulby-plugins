export {}

declare global {
  interface PluginInitData {
    pluginName: string
    featureCode: string
    input: string
    mode?: string
    route?: string
    capabilities?: {
      webview?: boolean
    }
  }

  interface MulbyInBrowser {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => MulbyInBrowser
    viewport: (width: number, height: number) => MulbyInBrowser
    show: () => MulbyInBrowser
    wait: (msOrSelector: number | string | Function, ...params: unknown[]) => MulbyInBrowser
    evaluate: (func: string | Function, ...params: unknown[]) => MulbyInBrowser
    run: (idOrOptions?: number | Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown[]>
  }

  interface Window {
    mulby?: {
      clipboard?: {
        writeText: (text: string) => Promise<void>
      }
      inbrowser?: MulbyInBrowser
      notification?: {
        show: (message: string, type?: string) => void
      }
      onPluginInit?: (callback: (data: PluginInitData) => void) => void
      onThemeChange?: (callback: (theme: 'light' | 'dark') => void) => void
    }
  }
}
