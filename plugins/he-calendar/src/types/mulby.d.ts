// Mulby plugin type declarations for backend (main process)
// These augment the global scope available in the plugin's Node.js environment.

interface BackendPluginContext {
  api: {
    tools: {
      register(name: string, handler: (args: any) => Promise<any>): void
      unregister(name: string): void
    }
    storage: {
      get(key: string): any
      set(key: string, value: any): void
      remove(key: string): void
      clear(): void
      keys(): string[]
    }
    [key: string]: any
  }
  input?: string
  featureCode?: string
  attachments?: Array<{ path?: string; name?: string; kind?: 'file' | 'image' }>
}

declare global {
  var __mulby_context__: BackendPluginContext
}

export {}
