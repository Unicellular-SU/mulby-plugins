import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CalendarDays, ClipboardCheck, CloudSun, Copy, Droplets, Eye, FileText, Loader2, MapPin, Search, Wind } from 'lucide-react'
import { useMulby } from './hooks/useMulby'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

interface GeoLocationCandidate {
  name: string
  country?: string
  countryCode?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone?: string
}

interface CurrentWeatherSummary {
  time: string
  temperature: number | null
  apparentTemperature: number | null
  humidity: number | null
  windSpeed: number | null
  visibility: number | null
  weatherText: string
  icon: string
  isDay: boolean | null
}

interface ForecastDaySummary {
  date: string
  maxTemperature: number | null
  minTemperature: number | null
  weatherText: string
  icon: string
}

interface WeatherCardData {
  query: string
  location: GeoLocationCandidate
  current: CurrentWeatherSummary
  forecast: ForecastDaySummary[]
  units: {
    temperature: '°C'
    windSpeed: 'km/h'
    visibility: 'm'
  }
  provider: 'Open-Meteo'
  fetchedAt: string
}

function formatNumber(value: number | null, suffix = '') {
  return value === null ? '—' : `${Math.round(value)}${suffix}`
}

function formatVisibility(value: number | null) {
  if (value === null) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(1)} km`
  return `${Math.round(value)} m`
}

function formatDate(dateText: string) {
  if (!dateText) return '—'
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText
  return new Intl.DateTimeFormat('zh-CN', { weekday: 'short', month: 'numeric', day: 'numeric' }).format(date)
}

function formatPlainDate(dateText: string) {
  if (!dateText) return '—'
  const date = new Date(`${dateText}T00:00:00`)
  if (Number.isNaN(date.getTime())) return dateText
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).format(date)
}

function formatTime(timeText: string) {
  if (!timeText) return '刚刚更新'
  const date = new Date(timeText)
  if (Number.isNaN(date.getTime())) return timeText.replace('T', ' ')
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function locationLabel(location?: GeoLocationCandidate) {
  if (!location) return '全球城市天气查询'
  return [location.name, location.admin1, location.country].filter(Boolean).join(' · ')
}

function formatWeatherPlainText(weather: WeatherCardData) {
  const lines = [
    `天气卡片｜${locationLabel(weather.location)}`,
    `查询：${weather.query}`,
    `当前：${weather.current.icon} ${weather.current.weatherText}，${formatNumber(weather.current.temperature, weather.units.temperature)}`,
    `体感：${formatNumber(weather.current.apparentTemperature, weather.units.temperature)}｜湿度：${formatNumber(weather.current.humidity, '%')}｜风速：${formatNumber(weather.current.windSpeed, ` ${weather.units.windSpeed}`)}｜能见度：${formatVisibility(weather.current.visibility)}`,
    `更新：${formatTime(weather.current.time || weather.fetchedAt)}`,
    '',
    '未来三日预报：',
    ...weather.forecast.map((day) => `- ${formatPlainDate(day.date)}：${day.icon} ${day.weatherText}，${formatNumber(day.maxTemperature, '°')} / ${formatNumber(day.minTemperature, '°')}`),
    '',
    `数据来源：${weather.provider}`
  ]

  return lines.join('\n')
}

function formatWeatherMarkdown(weather: WeatherCardData) {
  const forecastRows = weather.forecast.map((day) => (
    `| ${formatPlainDate(day.date)} | ${day.icon} ${day.weatherText} | ${formatNumber(day.maxTemperature, '°')} | ${formatNumber(day.minTemperature, '°')} |`
  ))

  return [
    `# ${locationLabel(weather.location)} 天气卡片`,
    '',
    `> 查询：${weather.query}｜更新：${formatTime(weather.current.time || weather.fetchedAt)}｜数据来源：${weather.provider}`,
    '',
    `## 当前天气`,
    '',
    `**${weather.current.icon} ${weather.current.weatherText}** · **${formatNumber(weather.current.temperature, weather.units.temperature)}**`,
    '',
    `- 体感温度：${formatNumber(weather.current.apparentTemperature, weather.units.temperature)}`,
    `- 湿度：${formatNumber(weather.current.humidity, '%')}`,
    `- 风速：${formatNumber(weather.current.windSpeed, ` ${weather.units.windSpeed}`)}`,
    `- 能见度：${formatVisibility(weather.current.visibility)}`,
    '',
    `## 未来三日预报`,
    '',
    '| 日期 | 天气 | 最高 | 最低 |',
    '| --- | --- | --- | --- |',
    ...forecastRows
  ].join('\n')
}

function extractHostCallError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const maybeError = (result as { error?: unknown; message?: unknown }).error ?? (result as { message?: unknown }).message
  return typeof maybeError === 'string' && maybeError.trim() ? maybeError.trim() : null
}

function friendlyErrorMessage(error: unknown, fallback = '天气查询失败，请稍后重试') {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : extractHostCallError(error) ?? fallback

  if (/请输入城市名|城市名过长|未找到城市|没有返回可用|定位坐标/.test(rawMessage)) {
    return rawMessage
  }

  if (/NetworkError|Failed to fetch|fetch failed|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|timeout|超时|网络/i.test(rawMessage)) {
    return '网络连接异常，无法获取天气数据；请检查网络后重试。'
  }

  if (/HTTP\s*(4\d\d|5\d\d)|天气服务请求失败|response/i.test(rawMessage)) {
    return '天气服务暂时不可用，请稍后再试。'
  }

  if (/parse|JSON|无法解析/i.test(rawMessage)) {
    return '天气服务返回的数据格式异常，请稍后重试。'
  }

  return rawMessage || fallback
}

function isWeatherCardData(value: unknown): value is WeatherCardData {
  if (!value || typeof value !== 'object') return false
  const data = value as WeatherCardData
  return Boolean(
    data.location &&
    typeof data.location.name === 'string' &&
    data.current &&
    typeof data.current.weatherText === 'string' &&
    Array.isArray(data.forecast) &&
    data.forecast.length > 0
  )
}

const SAVED_LOCATION_KEY = 'lastCurrentLocation'

interface SavedCurrentLocation {
  latitude: number
  longitude: number
  label: string
}

function isSavedCurrentLocation(value: unknown): value is SavedCurrentLocation {
  if (!value || typeof value !== 'object') return false
  const data = value as SavedCurrentLocation
  return Number.isFinite(data.latitude) && Number.isFinite(data.longitude) && typeof data.label === 'string'
}

function buildResolvedLocationLabel(location: GeoLocationCandidate) {
  return locationLabel(location)
}

async function notifyUser(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  try {
    await window.mulby?.notification?.show?.(message, type)
  } catch {
    // 通知失败不应打断主流程，界面状态会继续展示消息。
  }
}

export default function App() {
  const [city, setCity] = useState('')
  const [weather, setWeather] = useState<WeatherCardData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [copyingFormat, setCopyingFormat] = useState<'markdown' | 'text' | null>(null)
  const [message, setMessage] = useState('输入城市名，生成一张包含当前天气与未来三日预报的轻量卡片。')
  const [messageType, setMessageType] = useState<'info' | 'success' | 'warning' | 'error'>('info')
  const { host, storage } = useMulby('weather-card')
  const restoredLocationRef = useRef(false)

  const heroTone = useMemo(() => {
    if (!weather?.current.isDay && weather?.current.isDay !== null) return 'night'
    return 'day'
  }, [weather])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const initialInput = data.input?.trim()
      if (initialInput) setCity(initialInput)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function restoreSavedLocation() {
      if (restoredLocationRef.current) return
      restoredLocationRef.current = true

      try {
        const saved = await storage.get(SAVED_LOCATION_KEY)
        if (cancelled || !isSavedCurrentLocation(saved)) return
        if (city.trim() || weather || isLoading) return
        await queryWeatherFromSavedLocation(saved)
      } catch {
        // 读取上次定位失败时保持默认手动查询入口。
      }
    }

    void restoreSavedLocation()

    return () => {
      cancelled = true
    }
  }, [])

  async function queryWeather(nextCity = city) {
    const normalizedCity = nextCity.trim()

    if (isLoading) return

    if (!normalizedCity) {
      setWeather(null)
      setMessageType('warning')
      setMessage('请先输入城市名，例如：北京、上海、London 或 Tokyo。')
      await notifyUser('请先输入城市名', 'warning')
      return
    }

    if (normalizedCity.length > 80) {
      setWeather(null)
      setMessageType('warning')
      setMessage('城市名过长，请输入更简短的城市或地区名称。')
      await notifyUser('城市名过长，请输入更简短的名称', 'warning')
      return
    }

    setIsLoading(true)
    setMessageType('info')
    setMessage(`正在查询「${normalizedCity}」的天气…`)

    try {
      const result = await host.call('getWeatherCardData', normalizedCity)
      const hostError = extractHostCallError(result)

      if (!result?.success) {
        throw new Error(hostError ?? '天气查询未成功，请稍后重试')
      }

      if (!isWeatherCardData(result.data)) {
        throw new Error('天气服务没有返回完整的天气数据，请稍后重试或更换城市。')
      }

      setWeather(result.data)
      setMessageType('success')
      setMessage('天气卡片已生成')
    } catch (error) {
      const friendlyMessage = friendlyErrorMessage(error)
      setWeather(null)
      setMessageType('error')
      setMessage(friendlyMessage)
      await notifyUser(friendlyMessage, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  async function queryWeatherFromSavedLocation(saved: SavedCurrentLocation) {
    if (isLoading) return

    setIsLoading(true)
    setMessageType('info')
    setMessage(`正在查询上次定位「${saved.label}」的天气…`)

    try {
      const result = await window.mulby.host.call('weather-card', 'getWeatherCardDataByCoords', saved.latitude, saved.longitude)
      const hostError = extractHostCallError(result)

      if (!result?.success) {
        throw new Error(hostError ?? '上次定位天气查询未成功，请稍后重试')
      }

      if (!isWeatherCardData(result.data)) {
        throw new Error('天气服务没有返回完整的上次定位天气数据，请稍后重试。')
      }

      const label = buildResolvedLocationLabel(result.data.location)
      setCity(label)
      setWeather(result.data)
      setMessageType('success')
      setMessage(`已自动查询上次定位：${label}`)
      await storage.set(SAVED_LOCATION_KEY, {
        latitude: saved.latitude,
        longitude: saved.longitude,
        label
      })
    } catch (error) {
      const friendlyMessage = friendlyErrorMessage(error, '无法查询上次定位天气，可手动输入城市名。')
      setWeather(null)
      setMessageType('warning')
      setMessage(friendlyMessage)
    } finally {
      setIsLoading(false)
    }
  }

  async function queryWeatherByCurrentLocation() {
    if (isLoading) return

    const geolocation = window.mulby?.geolocation
    if (!geolocation) {
      const text = '当前 Mulby 版本不支持定位，请手动输入城市名。'
      setMessageType('warning')
      setMessage(text)
      await notifyUser(text, 'warning')
      return
    }

    setIsLoading(true)
    setMessageType('info')
    setMessage('正在获取当前位置…')

    try {
      let canGetPosition = await geolocation.canGetPosition()
      if (!canGetPosition) {
        const status = await geolocation.requestAccess()
        canGetPosition = status === 'granted'
      }

      if (!canGetPosition) {
        throw new Error('定位权限未开启，请授权后重试，或手动输入城市名。')
      }

      const position = await geolocation.getCurrentPosition({
        desiredAccuracy: 'balanced',
        allowFallback: true,
        timeoutMs: 10000
      })

      if (!Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) {
        throw new Error('无法获取有效当前位置，可手动输入城市名。')
      }

      setMessage('正在查询当前位置天气…')
      const result = await window.mulby.host.call('weather-card', 'getWeatherCardDataByCoords', position.latitude, position.longitude)
      const hostError = extractHostCallError(result)

      if (!result?.success) {
        throw new Error(hostError ?? '当前位置天气查询未成功，请稍后重试')
      }

      if (!isWeatherCardData(result.data)) {
        throw new Error('天气服务没有返回完整的当前位置天气数据，请稍后重试。')
      }

      const label = buildResolvedLocationLabel(result.data.location)
      setCity(label)
      setWeather(result.data)
      setMessageType('success')
      setMessage(`当前位置天气卡片已生成：${label}`)
      await storage.set(SAVED_LOCATION_KEY, {
        latitude: position.latitude,
        longitude: position.longitude,
        label
      })
    } catch (error) {
      const friendlyMessage = friendlyErrorMessage(error, '无法获取当前位置天气，可手动输入城市名。')
      setWeather(null)
      setMessageType('error')
      setMessage(friendlyMessage)
      await notifyUser(friendlyMessage, 'error')
    } finally {
      setIsLoading(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void queryWeather()
  }

  async function copyWeatherCard(format: 'markdown' | 'text') {
    if (!weather || copyingFormat) return

    const content = format === 'markdown' ? formatWeatherMarkdown(weather) : formatWeatherPlainText(weather)
    const label = format === 'markdown' ? 'Markdown' : '纯文本'

    try {
      setCopyingFormat(format)
      await window.mulby.clipboard.writeText(content)
      setMessageType('success')
      setMessage(`已复制${label}天气卡片到剪贴板`)
    } catch (error) {
      const friendlyMessage = friendlyErrorMessage(error, `复制${label}天气卡片失败`)
      setMessageType('error')
      setMessage(friendlyMessage)
      await notifyUser(friendlyMessage, 'error')
    } finally {
      setCopyingFormat(null)
    }
  }

  return (
    <div className="plugin-root">
      <header className="app-header">
        <div>
          <p className="eyebrow">Weather Card</p>
          <h1 className="header-title">天气卡片</h1>
        </div>
        <span className="header-icon" aria-hidden="true">☁️</span>
      </header>

      <main className="main">
        <section className="search-panel" aria-label="城市天气查询">
          <div className="search-copy">
            <h2>查询最近天气</h2>
            <p>支持中英文城市名，覆盖全球城市与地区。</p>
          </div>
          <form className="search-form" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="city-input">城市名</label>
            <div className="input-wrap">
              <Search size={18} />
              <input
                id="city-input"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                placeholder="输入城市，如 北京 / London / Tokyo"
                autoFocus
              />
            </div>
            <button className="btn-primary" type="submit" disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" size={16} /> : <CloudSun size={16} />}
              {isLoading ? '查询中' : '生成卡片'}
            </button>
            <button className="btn-secondary" type="button" onClick={() => void queryWeatherByCurrentLocation()} disabled={isLoading}>
              {isLoading ? <Loader2 className="spin" size={16} /> : <MapPin size={16} />}
              当前位置
            </button>
          </form>
          <p className={`status-text ${messageType}`} role="status">
            {messageType === 'error' || messageType === 'warning' ? <AlertCircle size={14} aria-hidden="true" /> : null}
            <span>{message}</span>
          </p>
        </section>

        {weather ? (
          <section className={`weather-card ${heroTone}`} aria-label={`${weather.query} 天气卡片`}>
            <div className="card-topline">
              <div className="location-line">
                <MapPin size={16} />
                <span>{locationLabel(weather.location)}</span>
              </div>
              <span className="provider-pill">{weather.provider}</span>
            </div>

            <div className="current-weather">
              <div className="weather-symbol" aria-hidden="true">{weather.current.icon}</div>
              <div className="temperature-block">
                <div className="temperature">{formatNumber(weather.current.temperature, weather.units.temperature)}</div>
                <div className="condition">{weather.current.weatherText}</div>
                <div className="updated-time">更新于 {formatTime(weather.current.time || weather.fetchedAt)}</div>
              </div>
            </div>

            <div className="metric-grid">
              <div className="metric-item">
                <CloudSun size={16} />
                <span>体感</span>
                <strong>{formatNumber(weather.current.apparentTemperature, weather.units.temperature)}</strong>
              </div>
              <div className="metric-item">
                <Droplets size={16} />
                <span>湿度</span>
                <strong>{formatNumber(weather.current.humidity, '%')}</strong>
              </div>
              <div className="metric-item">
                <Wind size={16} />
                <span>风速</span>
                <strong>{formatNumber(weather.current.windSpeed, ` ${weather.units.windSpeed}`)}</strong>
              </div>
              <div className="metric-item">
                <Eye size={16} />
                <span>能见度</span>
                <strong>{formatVisibility(weather.current.visibility)}</strong>
              </div>
            </div>

            <div className="forecast-section">
              <div className="section-title">
                <CalendarDays size={16} />
                <h2>未来三日预报</h2>
              </div>
              <div className="forecast-list">
                {weather.forecast.map((day) => (
                  <article className="forecast-day" key={day.date}>
                    <span className="forecast-date">{formatDate(day.date)}</span>
                    <span className="forecast-icon" aria-hidden="true">{day.icon}</span>
                    <span className="forecast-text">{day.weatherText}</span>
                    <strong className="forecast-temp">
                      {formatNumber(day.maxTemperature, '°')} / {formatNumber(day.minTemperature, '°')}
                    </strong>
                  </article>
                ))}
              </div>
            </div>

            <div className="export-section" aria-label="导出天气卡片">
              <button
                className="btn-copy"
                type="button"
                onClick={() => void copyWeatherCard('markdown')}
                disabled={copyingFormat !== null}
              >
                {copyingFormat === 'markdown' ? <ClipboardCheck size={16} /> : <FileText size={16} />}
                {copyingFormat === 'markdown' ? '复制中…' : '复制 Markdown'}
              </button>
              <button
                className="btn-copy ghost"
                type="button"
                onClick={() => void copyWeatherCard('text')}
                disabled={copyingFormat !== null}
              >
                {copyingFormat === 'text' ? <ClipboardCheck size={16} /> : <Copy size={16} />}
                {copyingFormat === 'text' ? '复制中…' : '复制纯文本'}
              </button>
            </div>
          </section>
        ) : (
          <section className="empty-card" aria-label="天气卡片占位">
            <div className="empty-illustration" aria-hidden="true">🌤️</div>
            <h2>等待生成天气卡片</h2>
            <p>输入城市后会展示温度、体感、湿度、风速、能见度和未来三日天气。</p>
          </section>
        )}
      </main>
    </div>
  )
}
