/// <reference path="./types/mulby.d.ts" />
// 运行时由 Mulby 宿主注入全局 API 代理（无需从参数中获取）
declare const mulby: any

type WeatherUnit = 'celsius'

interface GeoLocationCandidate {
  id?: number
  name: string
  country?: string
  countryCode?: string
  admin1?: string
  latitude: number
  longitude: number
  timezone?: string
  population?: number
}

interface CurrentWeatherSummary {
  time: string
  temperature: number | null
  apparentTemperature: number | null
  humidity: number | null
  windSpeed: number | null
  visibility: number | null
  weatherCode: number | null
  weatherText: string
  icon: string
  isDay: boolean | null
}

interface ForecastDaySummary {
  date: string
  maxTemperature: number | null
  minTemperature: number | null
  weatherCode: number | null
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

interface OpenMeteoGeocodeResult {
  id?: number
  name?: string
  latitude?: number
  longitude?: number
  elevation?: number
  feature_code?: string
  country_code?: string
  admin1?: string
  country?: string
  timezone?: string
  population?: number
}

interface OpenMeteoGeocodeResponse {
  results?: OpenMeteoGeocodeResult[]
}

interface OpenMeteoForecastResponse {
  current?: Record<string, unknown>
  daily?: Record<string, unknown[]>
}

export function onLoad() {
  // Register background subscriptions or plugin tools here when needed.
}

export function onUnload() {
  // Clean up subscriptions, timers, or external resources here.
}

export function onEnable() {
  // Called when the plugin is enabled.
}

export function onDisable() {
  // Called when the plugin is disabled.
}

// run 是插件入口，context 由宿主注入（包含 featureCode / input / attachments / api）
export async function run(context: BackendPluginContext) {
  if (context.featureCode === 'generate_weather_card') {
    // UI 功能由前端负责展示；这里只保留入口校验，避免启动时弹出无关提示。
    return
  }
}

const WEATHER_CODE_MAP: Record<number, { text: string; dayIcon: string; nightIcon?: string }> = {
  0: { text: '晴朗', dayIcon: '☀️', nightIcon: '🌙' },
  1: { text: '大部晴朗', dayIcon: '🌤️', nightIcon: '🌙' },
  2: { text: '局部多云', dayIcon: '⛅', nightIcon: '☁️' },
  3: { text: '阴天', dayIcon: '☁️' },
  45: { text: '雾', dayIcon: '🌫️' },
  48: { text: '霜雾', dayIcon: '🌫️' },
  51: { text: '小毛毛雨', dayIcon: '🌦️' },
  53: { text: '中等毛毛雨', dayIcon: '🌦️' },
  55: { text: '密集毛毛雨', dayIcon: '🌧️' },
  56: { text: '冻毛毛雨', dayIcon: '🌧️' },
  57: { text: '强冻毛毛雨', dayIcon: '🌧️' },
  61: { text: '小雨', dayIcon: '🌦️' },
  63: { text: '中雨', dayIcon: '🌧️' },
  65: { text: '大雨', dayIcon: '🌧️' },
  66: { text: '冻雨', dayIcon: '🌧️' },
  67: { text: '强冻雨', dayIcon: '🌧️' },
  71: { text: '小雪', dayIcon: '🌨️' },
  73: { text: '中雪', dayIcon: '🌨️' },
  75: { text: '大雪', dayIcon: '❄️' },
  77: { text: '雪粒', dayIcon: '❄️' },
  80: { text: '小阵雨', dayIcon: '🌦️' },
  81: { text: '中等阵雨', dayIcon: '🌧️' },
  82: { text: '强阵雨', dayIcon: '⛈️' },
  85: { text: '小阵雪', dayIcon: '🌨️' },
  86: { text: '强阵雪', dayIcon: '❄️' },
  95: { text: '雷暴', dayIcon: '⛈️' },
  96: { text: '雷暴伴小冰雹', dayIcon: '⛈️' },
  99: { text: '雷暴伴强冰雹', dayIcon: '⛈️' }
}

function encodeQuery(value: string) {
  return encodeURIComponent(value.trim())
}

function requireCityName(city: unknown): string {
  const normalized = typeof city === 'string' ? city.trim() : ''
  if (!normalized) {
    throw new Error('请输入城市名')
  }
  if (normalized.length > 80) {
    throw new Error('城市名过长，请输入更简短的名称')
  }
  return normalized
}

function ensureCoordinate(value: unknown, label: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numberValue)) {
    throw new Error(`${label}无效，无法查询当前位置天气`)
  }
  return numberValue
}

function ensureFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function toWeatherText(code: number | null) {
  if (code === null) return { text: '未知天气', icon: '🌡️' }
  const mapped = WEATHER_CODE_MAP[code]
  return mapped ? { text: mapped.text, icon: mapped.dayIcon } : { text: `天气代码 ${code}`, icon: '🌡️' }
}

function toWeatherIcon(code: number | null, isDay?: boolean | null) {
  if (code === null) return '🌡️'
  const mapped = WEATHER_CODE_MAP[code]
  if (!mapped) return '🌡️'
  return isDay === false && mapped.nightIcon ? mapped.nightIcon : mapped.dayIcon
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await mulby.http.get(url)
  if (!response || typeof response.status !== 'number') {
    throw new Error('网络响应异常')
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`天气服务请求失败（HTTP ${response.status}）`)
  }

  const payload = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)

  try {
    return JSON.parse(payload) as T
  } catch {
    throw new Error('天气服务返回了无法解析的数据')
  }
}

function normalizeLocation(item: OpenMeteoGeocodeResult): GeoLocationCandidate | null {
  if (!item || typeof item !== 'object') return null
  const latitude = ensureFiniteNumber(item.latitude)
  const longitude = ensureFiniteNumber(item.longitude)
  if (!item.name || latitude === null || longitude === null) return null

  return {
    id: item.id,
    name: item.name,
    country: item.country,
    countryCode: item.country_code,
    admin1: item.admin1,
    latitude,
    longitude,
    timezone: item.timezone,
    population: item.population
  }
}

async function geocodeCity(city: string): Promise<GeoLocationCandidate> {
  const params = `name=${encodeQuery(city)}&count=5&language=zh&format=json`
  const data = await fetchJson<OpenMeteoGeocodeResponse>(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
  const resultCount = Array.isArray(data.results) ? data.results.length : 0
  const candidates = (Array.isArray(data.results) ? data.results : [])
    .map(normalizeLocation)
    .filter((item): item is GeoLocationCandidate => Boolean(item))
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))

  if (resultCount > 0 && candidates.length === 0) {
    throw new Error('城市搜索结果缺少有效经纬度，请尝试输入更完整的地名')
  }

  if (candidates.length === 0) {
    throw new Error(`未找到城市「${city}」，请检查拼写或尝试输入更完整的地名`)
  }

  return candidates[0]
}

function pickArrayItem<T>(array: unknown[] | undefined, index: number): T | null {
  return Array.isArray(array) && index < array.length ? (array[index] as T) : null
}

async function fetchWeatherByLocation(location: GeoLocationCandidate, query: string): Promise<WeatherCardData> {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: [
      'temperature_2m',
      'apparent_temperature',
      'relative_humidity_2m',
      'wind_speed_10m',
      'visibility',
      'weather_code',
      'is_day'
    ].join(','),
    daily: ['weather_code', 'temperature_2m_max', 'temperature_2m_min'].join(','),
    timezone: 'auto',
    forecast_days: '3',
    temperature_unit: 'celsius'
  })

  const data = await fetchJson<OpenMeteoForecastResponse>(`https://api.open-meteo.com/v1/forecast?${params.toString()}`)
  const current = data.current ?? {}
  const currentCode = ensureFiniteNumber(current.weather_code)
  const isDayValue = ensureFiniteNumber(current.is_day)
  const currentText = toWeatherText(currentCode)

  const dailyTime = data.daily?.time
  const dailyCodes = data.daily?.weather_code
  const dailyMax = data.daily?.temperature_2m_max
  const dailyMin = data.daily?.temperature_2m_min

  const forecast: ForecastDaySummary[] = Array.from({ length: 3 }, (_, index) => {
    const code = ensureFiniteNumber(pickArrayItem(dailyCodes, index))
    const text = toWeatherText(code)
    return {
      date: String(pickArrayItem<string>(dailyTime, index) ?? ''),
      maxTemperature: ensureFiniteNumber(pickArrayItem(dailyMax, index)),
      minTemperature: ensureFiniteNumber(pickArrayItem(dailyMin, index)),
      weatherCode: code,
      weatherText: text.text,
      icon: text.icon
    }
  }).filter((day) => Boolean(day.date))

  if (!current.time && forecast.length === 0) {
    throw new Error('天气服务没有返回可用的天气数据')
  }

  const hasCurrentMetric = [
    current.temperature_2m,
    current.apparent_temperature,
    current.relative_humidity_2m,
    current.wind_speed_10m,
    current.visibility,
    current.weather_code
  ].some((value) => ensureFiniteNumber(value) !== null)

  if (!hasCurrentMetric) {
    throw new Error('天气服务没有返回当前天气数据，请稍后重试或更换城市')
  }

  if (forecast.length === 0) {
    throw new Error('天气服务没有返回未来三日预报，请稍后重试')
  }

  return {
    query,
    location,
    current: {
      time: typeof current.time === 'string' ? current.time : '',
      temperature: ensureFiniteNumber(current.temperature_2m),
      apparentTemperature: ensureFiniteNumber(current.apparent_temperature),
      humidity: ensureFiniteNumber(current.relative_humidity_2m),
      windSpeed: ensureFiniteNumber(current.wind_speed_10m),
      visibility: ensureFiniteNumber(current.visibility),
      weatherCode: currentCode,
      weatherText: currentText.text,
      icon: toWeatherIcon(currentCode, isDayValue === null ? null : isDayValue === 1),
      isDay: isDayValue === null ? null : isDayValue === 1
    },
    forecast,
    units: {
      temperature: '°C',
      windSpeed: 'km/h',
      visibility: 'm'
    },
    provider: 'Open-Meteo',
    fetchedAt: new Date().toISOString()
  }
}

export async function getWeatherCardData(city: string): Promise<WeatherCardData> {
  const query = requireCityName(city)
  const location = await geocodeCity(query)
  return fetchWeatherByLocation(location, query)
}

function formatCoordinate(latitude: number, longitude: number) {
  const lat = latitude.toFixed(4)
  const lng = longitude.toFixed(4)
  return `${lat}, ${lng}`
}

function buildLocationName(location: GeoLocationCandidate) {
  return [location.name, location.admin1, location.country].filter(Boolean).join(' · ')
}

async function reverseGeocodeCoords(latitude: number, longitude: number): Promise<GeoLocationCandidate> {
  const fallbackName = formatCoordinate(latitude, longitude)
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    language: 'zh',
    format: 'json'
  })

  try {
    const data = await fetchJson<OpenMeteoGeocodeResponse>(`https://geocoding-api.open-meteo.com/v1/reverse?${params.toString()}`)
    const candidates = (Array.isArray(data.results) ? data.results : [])
      .map(normalizeLocation)
      .filter((item): item is GeoLocationCandidate => Boolean(item))
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    const resolved = candidates[0]

    if (resolved) {
      return {
        ...resolved,
        latitude,
        longitude,
        name: buildLocationName(resolved) || resolved.name || fallbackName
      }
    }
  } catch {
    // 逆地理编码失败不影响天气查询，按需求退回显示经纬度。
  }

  return {
    name: fallbackName,
    latitude,
    longitude,
    timezone: 'auto'
  }
}

export async function getWeatherCardDataByCoords(latitude: number, longitude: number): Promise<WeatherCardData> {
  const safeLatitude = ensureCoordinate(latitude, '纬度')
  const safeLongitude = ensureCoordinate(longitude, '经度')
  if (safeLatitude < -90 || safeLatitude > 90 || safeLongitude < -180 || safeLongitude > 180) {
    throw new Error('定位坐标超出有效范围，无法查询当前位置天气')
  }

  const location = await reverseGeocodeCoords(safeLatitude, safeLongitude)
  return fetchWeatherByLocation(location, location.name)
}

// ─── 供 UI 调用的后端方法 ───────────────────────────────────────────
// 使用 rpc 命名空间：参数 1:1 精准映射，不再有隐式 context 首参偏移。
// 前端调用示例：await window.mulby.host.call('weather-card', 'getWeatherCardData', city)

export const rpc = {
  async getWeatherCardData(city: string) {
    return getWeatherCardData(city)
  },
  async getWeatherCardDataByCoords(latitude: number, longitude: number) {
    return getWeatherCardDataByCoords(latitude, longitude)
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
