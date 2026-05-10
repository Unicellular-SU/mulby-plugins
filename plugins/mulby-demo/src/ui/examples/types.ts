import type { ApiCategoryId } from '../../shared/api-catalog'

export type ExampleContext = 'renderer' | 'backend' | 'manifest' | 'docs-only'

export interface ExampleResult {
  ok: boolean
  title: string
  data?: unknown
  warning?: string
}

export type MulbyApi = Record<string, any>

export interface LocalizedCopy {
  en: string
  zh: string
}

export type CopyText = string | LocalizedCopy

export type ResultViewKind = 'status' | 'log' | 'preview' | 'table' | 'json' | 'external'

export interface PlaygroundControl {
  id: string
  label: CopyText
  description: CopyText
  methods: string[]
  safety: RunnableExample['safety']
  cleanup?: boolean
  code?: string
  run: () => Promise<ExampleResult>
}

export interface InteractivePlayground {
  kind: 'interactive'
  title: CopyText
  description: CopyText
  controls: PlaygroundControl[]
  resultViews: ResultViewKind[]
}

export interface RunnableExample {
  id: string
  label: string
  description: string
  methods: string[]
  code: string
  safety: 'safe' | 'writes-plugin-data' | 'opens-system-ui' | 'requires-permission' | 'preview-only'
  run?: () => Promise<ExampleResult>
}

export interface ApiExampleModule {
  code: string
  title: string
  category: ApiCategoryId
  contexts: ExampleContext[]
  summary: string
  methods: string[]
  permissions?: string[]
  notes: string[]
  playground?: InteractivePlayground
  examples: RunnableExample[]
}

export interface ExampleGroup {
  category: ApiCategoryId
  label: string
  description: string
  order: number
  examples: ApiExampleModule[]
}
