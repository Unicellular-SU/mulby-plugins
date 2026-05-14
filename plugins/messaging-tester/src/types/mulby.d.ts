interface MulbyHost {
  call(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>
}

interface MulbyNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): Promise<void> | void
}

interface MulbyAPI {
  host?: MulbyHost
  notification?: MulbyNotification
}

interface Window {
  mulby?: MulbyAPI
}
