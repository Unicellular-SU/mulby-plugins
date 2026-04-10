import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  Binary,
  Clock3,
  Copy,
  Database,
  Gauge,
  Globe,
  History,
  LandPlot,
  Ruler,
  Thermometer,
  Trash2,
  Upload,
  Waves,
  Weight
} from 'lucide-react'
import { convertByCategory, parseSmartInput } from './core/conversionEngine'
import { categoryMap, categoryOrder, CategoryCode, getDefaultUnits, UnitDefinition } from './core/unitCatalog'
import { CurrencyRatePayload, fetchRatesViaHttp } from './core/currencyService'
import { useConverterStore } from './state/store'
import { useMulby } from './hooks/useMulby'

const PLUGIN_ID = 'unit-converter'
const SETTINGS_KEY = 'converter:settings'
const HISTORY_KEY = 'converter:history'
const RATES_CACHE_KEY = 'converter:rates'

const categoryIconMap: Record<CategoryCode, React.ComponentType<{ size?: number }>> = {
  length: Ruler,
  weight: Weight,
  temperature: Thermometer,
  currency: Globe,
  data: Database,
  time: Clock3,
  area: LandPlot,
  volume: Waves,
  speed: Gauge,
  base: Binary
}

function formatTime(time: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(time)
}

function parseCategoryGuess(rawInput: string): { category?: CategoryCode; unitId?: string; value: string } {
  const plain = rawInput.trim()
  if (!plain) {
    return { value: '' }
  }

  for (const category of categoryOrder) {
    const parsed = parseSmartInput(plain, category)
    if (parsed.suggestedUnitId) {
      return {
        category,
        unitId: parsed.suggestedUnitId,
        value: parsed.value
      }
    }
  }

  return { value: plain }
}

function getBestMatchedUnitId(
  keywordRaw: string,
  units: Array<{ id: string; label: string; symbol: string; aliases: string[] }>
): string | null {
  const keyword = keywordRaw.trim().toLowerCase()
  if (!keyword || units.length === 0) {
    return null
  }

  const exact = units.find(
    (unit) =>
      unit.symbol.toLowerCase() === keyword ||
      unit.label.toLowerCase() === keyword ||
      unit.aliases.some((alias) => alias.toLowerCase() === keyword)
  )
  if (exact) {
    return exact.id
  }

  const prefix = units.find(
    (unit) =>
      unit.symbol.toLowerCase().startsWith(keyword) ||
      unit.label.toLowerCase().startsWith(keyword) ||
      unit.aliases.some((alias) => alias.toLowerCase().startsWith(keyword))
  )
  if (prefix) {
    return prefix.id
  }

  return units[0].id
}

function isValidCategory(value: unknown): value is CategoryCode {
  return typeof value === 'string' && categoryMap.has(value as CategoryCode)
}

function isValidUnitId(category: CategoryCode, unitId: string): boolean {
  if (category === 'currency') {
    return /^[A-Z]{3}$/.test(unitId)
  }
  const categoryDef = categoryMap.get(category)
  if (!categoryDef) {
    return false
  }
  return categoryDef.units.some((unit) => unit.id === unitId)
}

const CURRENCY_ZH_CN_LABELS: Record<string, string> = {
  AUD: '澳大利亚元',
  BRL: '巴西雷亚尔',
  CAD: '加拿大元',
  CHF: '瑞士法郎',
  CNY: '人民币',
  CZK: '捷克克朗',
  DKK: '丹麦克朗',
  EUR: '欧元',
  GBP: '英镑',
  HKD: '港元',
  HUF: '匈牙利福林',
  IDR: '印尼盾',
  ILS: '以色列新谢克尔',
  INR: '印度卢比',
  ISK: '冰岛克朗',
  JPY: '日元',
  KRW: '韩元',
  MXN: '墨西哥比索',
  MYR: '马来西亚林吉特',
  NOK: '挪威克朗',
  NZD: '新西兰元',
  PHP: '菲律宾比索',
  PLN: '波兰兹罗提',
  RON: '罗马尼亚列伊',
  SEK: '瑞典克朗',
  SGD: '新加坡元',
  THB: '泰铢',
  TRY: '土耳其里拉',
  USD: '美元',
  ZAR: '南非兰特'
}

function buildCurrencyUnits(
  rateMap: Record<string, number>,
  currencies: Record<string, string>,
  selected: string[]
): UnitDefinition[] {
  const codes = new Set<string>([...Object.keys(rateMap), ...Object.keys(currencies), ...selected])
  return Array.from(codes)
    .filter((code) => /^[A-Z]{3}$/.test(code))
    .sort((a, b) => a.localeCompare(b))
    .map((code) => ({
      id: code,
      label: CURRENCY_ZH_CN_LABELS[code] ?? currencies[code] ?? code,
      symbol: code,
      aliases: [code.toLowerCase()],
      toBase: (value) => value,
      fromBase: (value) => value
    }))
}

export default function App() {
  const mulby = useMulby(PLUGIN_ID)
  const {
    category,
    input,
    fromUnitId,
    toUnitId,
    precision,
    scientific,
    batchMode,
    history,
    rates,
    rateStatus,
    rateError,
    setCategory,
    setInput,
    setFromUnitId,
    setToUnitId,
    swapUnits,
    setPrecision,
    setScientific,
    setBatchMode,
    setRates,
    setRateStatus,
    setHistory,
    addHistory,
    clearHistory,
    applyHistory
  } = useConverterStore()

  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')
  const [batchInput, setBatchInput] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const lastAutoHistoryKeyRef = useRef('')
  const scientificToggleRafRef = useRef<number | null>(null)

  const categoryDef = categoryMap.get(category)!
  const currencyUnits = useMemo(
    () => buildCurrencyUnits(rates.rates, rates.currencies ?? {}, [fromUnitId, toUnitId]),
    [rates.rates, rates.currencies, fromUnitId, toUnitId]
  )
  const activeUnits = category === 'currency' ? currencyUnits : categoryDef.units
  const parsedInput = useMemo(() => parseSmartInput(input, category), [input, category])
  const activeValue = parsedInput.value || input

  const result = useMemo(
    () =>
      convertByCategory({
        category,
        valueRaw: activeValue,
        fromUnitId,
        toUnitId,
        precision,
        scientific,
        currencyRates: rates.rates
      }),
    [activeValue, category, fromUnitId, toUnitId, precision, scientific, rates.rates]
  )

  const filteredFromUnits = useMemo(
    () =>
      activeUnits.filter((unit) => {
        const keyword = fromFilter.trim().toLowerCase()
        if (!keyword) {
          return true
        }
        return (
          unit.label.toLowerCase().includes(keyword) ||
          unit.symbol.toLowerCase().includes(keyword) ||
          unit.aliases.some((alias) => alias.toLowerCase().includes(keyword))
        )
      }),
    [activeUnits, fromFilter]
  )

  const filteredToUnits = useMemo(
    () =>
      activeUnits.filter((unit) => {
        const keyword = toFilter.trim().toLowerCase()
        if (!keyword) {
          return true
        }
        return (
          unit.label.toLowerCase().includes(keyword) ||
          unit.symbol.toLowerCase().includes(keyword) ||
          unit.aliases.some((alias) => alias.toLowerCase().includes(keyword))
        )
      }),
    [activeUnits, toFilter]
  )

  useEffect(() => {
    const targetUnitId = getBestMatchedUnitId(fromFilter, filteredFromUnits)
    if (targetUnitId && targetUnitId !== fromUnitId) {
      setFromUnitId(targetUnitId)
    }
  }, [filteredFromUnits, fromFilter, fromUnitId, setFromUnitId])

  useEffect(() => {
    const targetUnitId = getBestMatchedUnitId(toFilter, filteredToUnits)
    if (targetUnitId && targetUnitId !== toUnitId) {
      setToUnitId(targetUnitId)
    }
  }, [filteredToUnits, setToUnitId, toFilter, toUnitId])

  const batchResults = useMemo(() => {
    if (!batchMode) {
      return []
    }
    const lines = batchInput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    return lines.map((line) => {
      const parsed = parseSmartInput(line, category)
      const resolvedFrom = parsed.suggestedUnitId ?? fromUnitId
      const converted = convertByCategory({
        category,
        valueRaw: parsed.value || line,
        fromUnitId: resolvedFrom ?? fromUnitId,
        toUnitId,
        precision,
        scientific,
        currencyRates: rates.rates
      })
      return {
        source: line,
        output: converted.output,
        error: converted.error
      }
    })
  }, [batchMode, batchInput, category, fromUnitId, toUnitId, precision, scientific, rates.rates])

  useEffect(() => {
    setFromFilter('')
    setToFilter('')
  }, [category])

  useEffect(() => {
    const queryTheme = new URLSearchParams(window.location.search).get('theme')
    const hasPresetDarkClass = document.documentElement.classList.contains('dark')
    const systemPrefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    const currentTheme = (queryTheme as 'light' | 'dark' | null) ?? (hasPresetDarkClass || systemPrefersDark ? 'dark' : 'light')
    document.documentElement.classList.toggle('dark', currentTheme === 'dark')
    window.mulby?.onThemeChange?.((newTheme) => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit((payload) => {
      const guessed = parseCategoryGuess(payload.input ?? '')
      if (guessed.category) {
        setCategory(guessed.category)
      }
      if (guessed.unitId) {
        setFromUnitId(guessed.unitId)
      }
      if (guessed.value) {
        setInput(guessed.value)
      }
    })
  }, [setCategory, setFromUnitId, setInput])

  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      try {
        const settings = (await mulby.storage.get(SETTINGS_KEY)) as
          | { precision?: number; scientific?: boolean; category?: CategoryCode; fromUnitId?: string; toUnitId?: string }
          | undefined
        const savedHistory = (await mulby.storage.get(HISTORY_KEY)) as typeof history | undefined
        const cachedRates = (await mulby.storage.get(RATES_CACHE_KEY)) as typeof rates | undefined

        if (cancelled) {
          return
        }

        if (typeof settings?.precision === 'number') {
          setPrecision(Math.min(10, Math.max(2, settings.precision)))
        }
        if (typeof settings?.scientific === 'boolean') {
          setScientific(settings.scientific)
        }
        const restoredCategory = isValidCategory(settings?.category) ? settings.category : 'length'
        if (isValidCategory(settings?.category)) {
          setCategory(settings.category)
        } else if (settings?.category) {
          setCategory(restoredCategory)
        }
        const defaults = getDefaultUnits(restoredCategory)
        if (settings?.fromUnitId) {
          setFromUnitId(isValidUnitId(restoredCategory, settings.fromUnitId) ? settings.fromUnitId : defaults.fromUnitId)
        }
        if (settings?.toUnitId) {
          setToUnitId(isValidUnitId(restoredCategory, settings.toUnitId) ? settings.toUnitId : defaults.toUnitId)
        }
        if (Array.isArray(savedHistory)) {
          setHistory(savedHistory)
        }
        if (cachedRates && cachedRates.rates) {
          setRates(cachedRates)
        }
      } finally {
        if (!cancelled) {
          setHydrated(true)
        }
      }
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [mulby.storage, setCategory, setFromUnitId, setHistory, setPrecision, setRates, setScientific, setToUnitId])

  useEffect(() => {
    if (!hydrated) {
      return
    }
    void mulby.storage.set(SETTINGS_KEY, {
      category,
      fromUnitId,
      toUnitId,
      precision,
      scientific
    })
    void mulby.storage.set(HISTORY_KEY, history)
  }, [category, fromUnitId, toUnitId, precision, scientific, history, hydrated, mulby.storage])

  const refreshRates = useCallback(
    async (manual = false) => {
      setRateStatus('loading')
      try {
        const online = await mulby.network.isOnline()
        if (!online) {
          throw new Error('当前离线')
        }
        const payload = await fetchRatesViaHttp(mulby.http.get)
        setRates(payload)
        setRateStatus('success')
        await mulby.storage.set(RATES_CACHE_KEY, payload)
        if (manual) {
          mulby.notification.show('汇率已刷新。', 'success')
        }
      } catch (error) {
        const fallback = (await mulby.storage.get(RATES_CACHE_KEY)) as CurrencyRatePayload | undefined
        const errorMessage = error instanceof Error ? error.message : '汇率更新失败'
        if (fallback?.rates) {
          setRates(fallback)
          setRateStatus('offline', errorMessage)
          if (manual) {
            mulby.notification.show('汇率更新失败，已使用缓存。', 'warning')
          }
          return
        }
        setRateStatus('offline', errorMessage)
        if (manual) {
          mulby.notification.show('汇率刷新失败。', 'warning')
        }
      }
    },
    [mulby.http, mulby.network, mulby.notification, mulby.storage, setRateStatus, setRates]
  )

  useEffect(() => {
    let cancelled = false
    async function runPeriodicRefresh() {
      await refreshRates(false)
      if (cancelled) {
        return
      }
    }

    void runPeriodicRefresh()
    const timer = window.setInterval(() => void runPeriodicRefresh(), 60 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [refreshRates])

  useEffect(() => {
    if (!hydrated || batchMode) {
      return
    }
    if (!activeValue.trim() || result.error || result.output === '-') {
      return
    }

    const key = `${category}|${activeValue}|${fromUnitId}|${toUnitId}|${result.output}`
    if (lastAutoHistoryKeyRef.current === key) {
      return
    }

    const timer = window.setTimeout(() => {
      if (lastAutoHistoryKeyRef.current === key) {
        return
      }
      addHistory({
        category,
        input: activeValue,
        fromUnitId,
        toUnitId,
        output: result.output
      })
      lastAutoHistoryKeyRef.current = key
    }, 300)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeValue, addHistory, batchMode, category, fromUnitId, hydrated, result.error, result.output, toUnitId])

  useEffect(() => {
    return () => {
      if (scientificToggleRafRef.current !== null) {
        window.cancelAnimationFrame(scientificToggleRafRef.current)
      }
    }
  }, [])

  async function handleCopyResult() {
    if (result.error || result.output === '-') {
      mulby.notification.show('当前结果不可复制。', 'warning')
      return
    }
    await mulby.clipboard.writeText(result.output)
    mulby.notification.show('已复制转换结果。', 'success')
  }

  const handleExportJson = async () => {
    await mulby.clipboard.writeText(JSON.stringify(history, null, 2))
    mulby.notification.show('历史 JSON 已复制到剪贴板。', 'success')
  }

  const handleExportCsv = async () => {
    const csv = ['time,category,input,from,to,output']
      .concat(
        history.map((item) =>
          [formatTime(item.createdAt), item.category, item.input, item.fromUnitId, item.toUnitId, item.output]
            .map((column) => `"${String(column).replace(/"/g, '""')}"`)
            .join(',')
        )
      )
      .join('\n')
    await mulby.clipboard.writeText(csv)
    mulby.notification.show('历史 CSV 已复制到剪贴板。', 'success')
  }

  const handleScientificToggle = (checked: boolean) => {
    if (scientificToggleRafRef.current !== null) {
      window.cancelAnimationFrame(scientificToggleRafRef.current)
    }
    scientificToggleRafRef.current = window.requestAnimationFrame(() => {
      setScientific(checked)
      scientificToggleRafRef.current = null
    })
  }

  return (
    <div className="shell">
      {category === 'currency' ? (
        <header className="rate-bar glass-panel">
          <div className="rate-item">USD: {rates.rates.USD?.toFixed(2) ?? '-'}</div>
          <div className="rate-item">EUR: {rates.rates.EUR?.toFixed(2) ?? '-'}</div>
          <div className="rate-item">CNY: {rates.rates.CNY?.toFixed(2) ?? '-'}</div>
          <div className={`rate-status ${rateStatus}`} aria-live="polite">
            {rateStatus === 'offline' ? `离线缓存 · ${rateError ?? ''}` : `更新于 ${formatTime(rates.updatedAt || Date.now())}`}
          </div>
        </header>
      ) : null}

      <main className="layout">
        <aside className="left-column glass-panel">
          <h2>转换类别</h2>
          <nav className="category-nav">
            {categoryOrder.map((item) => {
              const Icon = categoryIconMap[item]
              const current = categoryMap.get(item)!
              return (
                <button key={item} className={`category-item ${category === item ? 'active' : ''}`} onClick={() => setCategory(item)}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{current.label}</span>
                </button>
              )
            })}
          </nav>
        </aside>

        <section className="center-column glass-panel">
          <div className="section-head">
            <h2>{categoryDef.label}转换</h2>
            <div className="actions-inline">
              <button onClick={() => setBatchMode(!batchMode)}>{batchMode ? '关闭批量' : '批量模式'}</button>
            </div>
          </div>

          {!batchMode ? (
            <>
              <input
                className="value-input"
                aria-label="输入待转换的值"
                name="converter-value"
                autoComplete="off"
                value={input}
                onChange={(event) => {
                  const next = event.target.value
                  setInput(next)
                }}
                onBlur={(event) => {
                  const suggestion = parseSmartInput(event.target.value, category)
                  if (suggestion.suggestedUnitId) {
                    setFromUnitId(suggestion.suggestedUnitId)
                  }
                }}
                placeholder='输入数值，支持 "100km" 或 "1.2e3"'
              />

              <div className="select-grid">
                <div className="select-block">
                  <label htmlFor="from-unit-filter">源单位</label>
                  <input
                    id="from-unit-filter"
                    className="unit-filter"
                    name="from-unit-filter"
                    aria-label="筛选源单位"
                    autoComplete="off"
                    value={fromFilter}
                    onChange={(event) => setFromFilter(event.target.value)}
                    placeholder="搜索单位"
                  />
                  <select
                    aria-label="选择源单位"
                    value={fromUnitId}
                    onChange={(event) => setFromUnitId(event.target.value)}
                  >
                    {filteredFromUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label} ({unit.symbol})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  className="swap-button"
                  aria-label="交换源单位和目标单位"
                  onClick={() => {
                    swapUnits()
                    setFromFilter('')
                    setToFilter('')
                  }}
                  title="交换单位"
                >
                  <ArrowRightLeft size={16} aria-hidden="true" />
                </button>

                <div className="select-block">
                  <label htmlFor="to-unit-filter">目标单位</label>
                  <input
                    id="to-unit-filter"
                    className="unit-filter"
                    name="to-unit-filter"
                    aria-label="筛选目标单位"
                    autoComplete="off"
                    value={toFilter}
                    onChange={(event) => setToFilter(event.target.value)}
                    placeholder="搜索单位"
                  />
                  <select
                    aria-label="选择目标单位"
                    value={toUnitId}
                    onChange={(event) => setToUnitId(event.target.value)}
                  >
                    {filteredToUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.label} ({unit.symbol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="result-panel">
                <div className="result-title">转换结果</div>
                <div className={`result-value ${result.error ? 'error' : ''}`}>{result.error ? result.error : result.output}</div>
                {category === 'base' && result.basePreview ? (
                  <div className="base-preview">
                    <span>BIN: {result.basePreview.bin}</span>
                    <span>OCT: {result.basePreview.oct}</span>
                    <span>DEC: {result.basePreview.dec}</span>
                    <span>HEX: {result.basePreview.hex}</span>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="batch-panel">
              <textarea
                aria-label="批量输入待转换的值，每行一个"
                name="batch-values"
                autoComplete="off"
                value={batchInput}
                onChange={(event) => setBatchInput(event.target.value)}
                placeholder="每行一个值，例如: 100km"
              />
              <div className="batch-result">
                {batchResults.map((item, index) => (
                  <div key={`${item.source}-${index}`} className="batch-row">
                    <span>{item.source}</span>
                    <strong>{item.error ? item.error : item.output}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="advanced-row">
            <label>
              精度: {precision}
              <input
                type="range"
                min={2}
                max={10}
                value={precision}
                onChange={(event) => setPrecision(Number(event.target.value))}
              />
            </label>
            <label className="switch">
              <input type="checkbox" checked={scientific} onChange={(event) => handleScientificToggle(event.target.checked)} />
              科学计数法
            </label>
          </div>

          <div className="action-row">
            <button onClick={handleCopyResult}>
              <Copy size={14} aria-hidden="true" /> 复制结果
            </button>
            {category === 'currency' ? (
              <button onClick={() => void refreshRates(true)}>
                <Upload size={14} aria-hidden="true" /> 刷新汇率
              </button>
            ) : null}
          </div>
        </section>

        <aside className="right-column glass-panel">
          <div className="section-head">
            <h2>
              <History size={16} aria-hidden="true" /> 最近历史
            </h2>
            <span>最多 10 条</span>
          </div>

          <div className="history-list">
            {history.length === 0 ? (
              <div className="history-empty">暂无历史记录</div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="history-item">
                  <div className="history-main">
                    <strong>
                      {item.input} {item.fromUnitId} → {item.output} {item.toUnitId}
                    </strong>
                    <span>{formatTime(item.createdAt)}</span>
                  </div>
                  <button
                    onClick={() => {
                      applyHistory(item.id)
                      mulby.notification.show('已应用该历史记录。', 'success')
                    }}
                  >
                    重做
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="history-actions">
            <button onClick={handleExportJson}>导出 JSON</button>
            <button onClick={handleExportCsv}>导出 CSV</button>
            <button
              onClick={() => {
                clearHistory()
                mulby.notification.show('历史已清空。', 'success')
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> 清空
            </button>
          </div>
        </aside>
      </main>
    </div>
  )
}
