import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  FileCode2,
  FileSearch,
  Layers3,
  Play,
  Search,
  ShieldAlert,
  TerminalSquare
} from 'lucide-react'
import { getCatalogSummary, publicApiCatalog, restrictedApiCatalog } from '../shared/api-catalog'
import { methodDetails } from '../shared/method-details'
import { apiExamples, ensureCatalogCoverage, groupExamplesByCategory } from './examples/registry'
import type { ApiExampleModule, CopyText, ExampleResult, PlaygroundControl, RunnableExample } from './examples/types'
import {
  categoryTranslations,
  exampleTranslations,
  languageOptions,
  localize,
  moduleTranslations,
  normalizeLanguage,
  safetyTranslations,
  uiText
} from './i18n'
import type { Language } from './i18n'

const iconByCategory: Record<string, typeof Layers3> = {
  data: Database,
  'files-network': TerminalSquare,
  ui: Layers3,
  system: ShieldAlert,
  plugin: FileCode2,
  'ai-media': Code2,
  diagnostics: FileSearch,
  restricted: AlertTriangle
}

function formatValue(value: unknown) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function localizeCopy(text: CopyText, language: Language) {
  return typeof text === 'string' ? text : localize(text, language)
}

function getModuleTitle(module: ApiExampleModule, language: Language) {
  return language === 'zh' ? moduleTranslations[module.code]?.title ?? module.title : module.title
}

function getModuleSummary(module: ApiExampleModule, language: Language) {
  return language === 'zh' ? moduleTranslations[module.code]?.summary ?? module.summary : module.summary
}

function getModuleNotes(module: ApiExampleModule, language: Language) {
  return language === 'zh' ? moduleTranslations[module.code]?.notes ?? module.notes : module.notes
}

function getExampleLabel(example: RunnableExample, language: Language) {
  return language === 'zh' ? exampleTranslations[example.id]?.label ?? example.label : example.label
}

function getExampleDescription(example: RunnableExample, language: Language) {
  return language === 'zh' ? exampleTranslations[example.id]?.description ?? example.description : example.description
}

function getCategoryLabel(category: ApiExampleModule['category'], fallback: string, language: Language) {
  return language === 'zh' ? categoryTranslations[category]?.label ?? fallback : fallback
}

function matchesQuery(module: ApiExampleModule, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  const translation = moduleTranslations[module.code]
  const translatedExamples = module.examples.flatMap((example) => {
    const exampleText = exampleTranslations[example.id]
    return exampleText ? [exampleText.label, exampleText.description] : []
  })
  return [
    module.code,
    module.title,
    module.summary,
    module.methods.join(' '),
    module.notes.join(' '),
    translation?.title ?? '',
    translation?.summary ?? '',
    translation?.notes.join(' ') ?? '',
    ...translatedExamples
  ].some((value) => value.toLowerCase().includes(normalized))
}

export default function App() {
  const [language, setLanguage] = useState<Language>(() => normalizeLanguage(navigator.language))
  const [query, setQuery] = useState('')
  const [selectedCode, setSelectedCode] = useState(apiExamples[0]?.code ?? '')
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [result, setResult] = useState<ExampleResult | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [activityLog, setActivityLog] = useState<Array<{ id: string; ok: boolean; label: string; at: string; warning?: string }>>([])

  const filteredExamples = useMemo(
    () => apiExamples.filter((module) => matchesQuery(module, query)),
    [query]
  )
  const groups = useMemo(() => groupExamplesByCategory(filteredExamples), [filteredExamples])
  const selected = apiExamples.find((module) => module.code === selectedCode) ?? filteredExamples[0] ?? apiExamples[0]
  const coverage = ensureCatalogCoverage(apiExamples)
  const summary = getCatalogSummary()
  const selectedTitle = getModuleTitle(selected, language)
  const selectedSummary = getModuleSummary(selected, language)
  const selectedNotes = getModuleNotes(selected, language)
  const selectedCategory = getCategoryLabel(selected.category, selected.category, language)
  const activeMethod = selected.methods.includes(selectedMethod ?? '')
    ? selectedMethod
    : selected.methods[0] ?? null
  const activeMethodDetail = activeMethod ? methodDetails[activeMethod] : null

  async function runExample(example: RunnableExample) {
    const exampleLabel = getExampleLabel(example, language)
    if (!example.run) {
      setResult({
        ok: true,
        title: exampleLabel,
        warning: localize(uiText.docsOnlyWarning, language),
        data: { code: example.code }
      })
      return
    }

    setRunningId(example.id)
    setResult(null)
    try {
      const nextResult = await example.run()
      setResult({ ...nextResult, title: language === 'zh' ? exampleLabel : nextResult.title })
    } catch (error) {
      setResult({
        ok: false,
        title: exampleLabel,
        warning: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setRunningId(null)
    }
  }

  async function runPlaygroundControl(control: PlaygroundControl) {
    const label = localizeCopy(control.label, language)
    setRunningId(control.id)
    setResult(null)
    try {
      const nextResult = await control.run()
      const localizedResult = { ...nextResult, title: label }
      setResult(localizedResult)
      setActivityLog((items) => [
        {
          id: control.id,
          ok: localizedResult.ok,
          label,
          at: new Date().toLocaleTimeString(),
          warning: localizedResult.warning
        },
        ...items
      ].slice(0, 12))
    } catch (error) {
      const failure = {
        ok: false,
        title: label,
        warning: error instanceof Error ? error.message : String(error)
      }
      setResult(failure)
      setActivityLog((items) => [
        {
          id: control.id,
          ok: false,
          label,
          at: new Date().toLocaleTimeString(),
          warning: failure.warning
        },
        ...items
      ].slice(0, 12))
    } finally {
      setRunningId(null)
    }
  }

  async function copySnippet(example: RunnableExample) {
    const mulby = (window as Window & { mulby?: any }).mulby
    if (mulby?.clipboard?.writeText) {
      await mulby.clipboard.writeText(example.code)
      setResult({ ok: true, title: localize(uiText.copiedSnippet, language), data: { id: example.id } })
      return
    }
    await navigator.clipboard?.writeText(example.code)
    setResult({ ok: true, title: localize(uiText.copiedSnippet, language), data: { id: example.id } })
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <BookOpen size={22} />
          </div>
          <div>
            <h1>{localize(uiText.brandTitle, language)}</h1>
            <p>
              {summary.publicApiCount} {localize(uiText.publicModules, language)} · {summary.restrictedApiCount}{' '}
              {localize(uiText.boundaryNotes, language)}
            </p>
          </div>
        </div>

        <div className="language-toggle" aria-label={localize(uiText.languageToggle, language)}>
          {languageOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={language === option.id ? 'active' : ''}
              onClick={() => setLanguage(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="search-box">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={localize(uiText.searchPlaceholder, language)}
          />
        </label>

        <nav className="module-nav" aria-label={localize(uiText.apiModules, language)}>
          {groups.map((group) => {
            const Icon = iconByCategory[group.category] ?? Layers3
            const label = getCategoryLabel(group.category, group.label, language)
            const description = language === 'zh' ? categoryTranslations[group.category]?.description ?? group.description : group.description
            return (
              <section key={group.category} className="nav-group">
                <div className="nav-group-title" title={description}>
                  <Icon size={14} />
                  <span>{label}</span>
                </div>
                {group.examples.map((module) => (
                  <button
                    key={module.code}
                    className={module.code === selected.code ? 'nav-item active' : 'nav-item'}
                    onClick={() => {
                      setSelectedCode(module.code)
                      setSelectedMethod(null)
                      setResult(null)
                    }}
                  >
                    <span>{getModuleTitle(module, language)}</span>
                    <small>{module.methods.length}</small>
                  </button>
                ))}
              </section>
            )
          })}
        </nav>
      </aside>

      <section className="content">
        <header className="content-header">
          <div>
            <div className="eyebrow">{selectedCategory}</div>
            <h2>{selectedTitle}</h2>
            <p>{selectedSummary}</p>
          </div>
          <div className="header-tools">

            <div className="activity-wrap">
              <button
                type="button"
                className="activity-toggle"
                onClick={() => setLogOpen((open) => !open)}
                aria-expanded={logOpen}
              >
                <TerminalSquare size={15} />
                <span>{localize(uiText.activityLog, language)}</span>
                <strong>{activityLog.length}</strong>
              </button>
              {logOpen ? (
                <div className="activity-popover">
                  <h4>{localize(uiText.activityLog, language)}</h4>
                  <div className="activity-log">
                    {activityLog.length ? (
                      activityLog.map((entry) => (
                        <div key={`${entry.id}:${entry.at}`} className={entry.ok ? 'log-row ok' : 'log-row error'}>
                          <span>{entry.at}</span>
                          <strong>{entry.label}</strong>
                          {entry.warning ? <small>{entry.warning}</small> : null}
                        </div>
                      ))
                    ) : (
                      <p>{localize(uiText.emptyLog, language)}</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {selected.playground ? (
          <section className="panel playground-panel">
            <div className="playground-header">
              <div>
                <span className="eyebrow">{localize(uiText.livePlayground, language)}</span>
                <h3>{localizeCopy(selected.playground.title, language)}</h3>
                <p>{localizeCopy(selected.playground.description, language)}</p>
              </div>
              <div className="result-view-list" aria-label={localize(uiText.resultViews, language)}>
                {selected.playground.resultViews.map((view) => (
                  <span key={view} className="pill">{view}</span>
                ))}
              </div>
            </div>

            <div className="playground-grid">
              <div className="playground-controls">
                {selected.playground.controls.map((control) => (
                  <button
                    key={control.id}
                    type="button"
                    className={control.cleanup ? 'playground-action cleanup' : 'playground-action'}
                    onClick={() => runPlaygroundControl(control)}
                    disabled={runningId === control.id}
                  >
                    <span>{localizeCopy(control.label, language)}</span>
                    <small>{localizeCopy(control.description, language)}</small>
                    <span className={`safety ${control.safety}`}>{localize(safetyTranslations[control.safety], language)}</span>
                  </button>
                ))}
              </div>

              <div className="playground-output">
                <section className="result-panel inline">
                  <h3>{localize(uiText.output, language)}</h3>
                  {result ? (
                    <div className={result.ok ? 'result ok' : 'result error'}>
                      <strong>{result.title}</strong>
                      {result.warning ? <p>{result.warning}</p> : null}
                      <pre><code>{formatValue(result.data)}</code></pre>
                    </div>
                  ) : (
                    <p className="empty-output">{localize(uiText.emptyOutput, language)}</p>
                  )}
                </section>
              </div>
            </div>
          </section>
        ) : null}

        <div className="detail-grid">
          <section className="panel module-panel">
            <div className="meta-row">
              {selected.contexts.map((context) => (
                <span key={context} className="pill">{context}</span>
              ))}
              {selected.permissions?.map((permission) => (
                <span key={permission} className="pill permission">{permission}</span>
              ))}
            </div>

            <h3>{localize(uiText.methods, language)}</h3>
            <div className="method-list">
              {selected.methods.map((method) => (
                <button
                  key={method}
                  type="button"
                  className={method === activeMethod ? 'method-chip active' : 'method-chip'}
                  onClick={() => setSelectedMethod(method)}
                >
                  <code>{method}</code>
                </button>
              ))}
            </div>

            {activeMethodDetail ? (
              <section className="method-detail" aria-live="polite">
                <div className="method-detail-header">
                  <span className="eyebrow">{localize(uiText.methodDetail, language)}</span>
                  <code>{activeMethodDetail.signature}</code>
                </div>
                <p>{localize(activeMethodDetail.summary, language)}</p>
                <div className="meta-row method-contexts">
                  {activeMethodDetail.contexts.map((context) => (
                    <span key={context} className="pill">{context}</span>
                  ))}
                </div>

                <h4>{localize(uiText.inputs, language)}</h4>
                <div className="method-io-list">
                  {activeMethodDetail.inputs.map((input) => (
                    <div key={`${activeMethodDetail.method}:${input.name}`} className="method-io-row">
                      <div>
                        <strong>{input.name}</strong>
                        <span>{input.required ? localize(uiText.required, language) : localize(uiText.optional, language)}</span>
                      </div>
                      <code>{input.type}</code>
                      <p>{localize(input.description, language)}</p>
                    </div>
                  ))}
                </div>

                <h4>{localize(uiText.returns, language)}</h4>
                <p>{localize(activeMethodDetail.returns, language)}</p>

                {activeMethodDetail.notes?.length ? (
                  <>
                    <h4>{localize(uiText.methodNotes, language)}</h4>
                    <ul className="notes-list">
                      {activeMethodDetail.notes.map((note) => (
                        <li key={note.en}>{localize(note, language)}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            ) : null}

            <h3>{localize(uiText.notes, language)}</h3>
            <ul className="notes-list">
              {selectedNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>

          <section className="panel examples-panel">
            <h3>{localize(selected.playground ? uiText.runnableReference : uiText.examples, language)}</h3>
            <div className="examples-list">
              {selected.examples.map((example) => (
                <article key={example.id} className="example-card">
                  <div className="example-card-header">
                    <div>
                      <h4>{getExampleLabel(example, language)}</h4>
                      <p>{getExampleDescription(example, language)}</p>
                    </div>
                    <span className={`safety ${example.safety}`}>{localize(safetyTranslations[example.safety], language)}</span>
                  </div>
                  <details className="code-disclosure" open={!selected.playground}>
                    <summary>{localize(uiText.referenceCode, language)}</summary>
                    <pre><code>{example.code}</code></pre>
                  </details>
                  <div className="example-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => copySnippet(example)}
                      title={localize(uiText.copySnippet, language)}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      className="run-button"
                      onClick={() => runExample(example)}
                      disabled={runningId === example.id}
                    >
                      <Play size={15} />
                      {runningId === example.id
                        ? localize(uiText.running, language)
                        : example.run
                          ? localize(uiText.run, language)
                          : localize(uiText.preview, language)}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        {selected.playground ? null : (
          <section className="panel result-panel">
            <h3>{localize(uiText.output, language)}</h3>
            {result ? (
              <div className={result.ok ? 'result ok' : 'result error'}>
                <strong>{result.title}</strong>
                {result.warning ? <p>{result.warning}</p> : null}
                <pre><code>{formatValue(result.data)}</code></pre>
              </div>
            ) : (
              <p className="empty-output">{localize(uiText.emptyOutput, language)}</p>
            )}
          </section>
        )}
      </section>
    </main>
  )
}
