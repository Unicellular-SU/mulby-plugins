import { publicApiCatalog, restrictedApiCatalog } from '../../shared/api-catalog'
import type {
  ApiExampleModule,
  CopyText,
  ExampleResult,
  InteractivePlayground,
  MulbyApi,
  PlaygroundControl,
  ResultViewKind,
  RunnableExample
} from './types'

type MulbyWindow = Window & { mulby?: MulbyApi }
type RunnableExampleInput = Omit<RunnableExample, 'methods'> & Partial<Pick<RunnableExample, 'methods'>>
type CatalogModuleInput = Omit<ApiExampleModule, 'code' | 'methods' | 'permissions' | 'summary' | 'examples'> &
  Partial<Pick<ApiExampleModule, 'methods' | 'permissions' | 'summary'>> & {
    examples: RunnableExampleInput[]
  }

export function mulby(): MulbyApi | null {
  return (window as MulbyWindow).mulby ?? null
}

export async function attempt<T>(label: string, fn: () => T | Promise<T>): Promise<{ label: string; ok: boolean; value?: T; error?: string }> {
  try {
    return { label, ok: true, value: await fn() }
  } catch (error) {
    return {
      label,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export function unavailable(title: string): ExampleResult {
  return {
    ok: false,
    title,
    warning: 'window.mulby is not available. Run this inside Mulby to execute the API call.'
  }
}

export function unwrapHostResult<T = unknown>(value: T | { data: T }): T {
  if (value && typeof value === 'object' && 'data' in value && Object.keys(value as Record<string, unknown>).length === 1) {
    return (value as { data: T }).data
  }
  return value as T
}

export async function callBackendExample(exampleId: string): Promise<unknown> {
  const api = mulby()
  if (!api?.host) {
    return unavailable(exampleId)
  }
  return unwrapHostResult(await api.host.call('mulby-demo', 'runBackendExample', exampleId))
}

export function withMethods(
  methods: string[],
  example: Omit<RunnableExample, 'methods'>
): RunnableExample {
  return { ...example, methods }
}

export function withAllMethods(
  module: Pick<ApiExampleModule, 'methods'>,
  example: Omit<RunnableExample, 'methods'>
): RunnableExample {
  return withMethods(module.methods, example)
}

export function catalogModule(
  code: string,
  extra: CatalogModuleInput
): ApiExampleModule {
  const catalog = publicApiCatalog.find((entry) => entry.code === code)
  if (!catalog) {
    throw new Error(`Unknown public API catalog code: ${code}`)
  }

  return {
    ...extra,
    code,
    methods: extra.methods ?? catalog.methods,
    permissions: extra.permissions ?? catalog.permissions,
    summary: extra.summary ?? catalog.summary,
    examples: extra.examples.map((example) => ({
      ...example,
      methods: example.methods ?? []
    }))
  }
}

export function restrictedModule(code: string, notes: string[] = []): ApiExampleModule {
  const catalog = restrictedApiCatalog.find((entry) => entry.code === code)
  if (!catalog) {
    throw new Error(`Unknown restricted API catalog code: ${code}`)
  }

  return {
    code,
    title: catalog.title,
    category: 'restricted',
    contexts: ['docs-only'],
    summary: catalog.reason,
    methods: catalog.methods,
    notes: catalog.saferAlternative ? [...notes, `Safer alternative: ${catalog.saferAlternative}`] : notes,
    examples: [
      {
        id: `${code}-boundary`,
        label: 'Boundary note',
        description: catalog.reason,
        methods: catalog.methods,
        safety: 'preview-only',
        code: `// ${catalog.title} is documented as out of scope for runnable third-party examples.\n// Covered methods: ${catalog.methods.join(', ')}`
      }
    ]
  }
}

export function text(en: string, zh: string): CopyText {
  return { en, zh }
}

export function playground(
  title: CopyText,
  description: CopyText,
  controls: PlaygroundControl[],
  resultViews: ResultViewKind[] = ['status', 'json', 'log']
): InteractivePlayground {
  return {
    kind: 'interactive',
    title,
    description,
    controls,
    resultViews
  }
}
