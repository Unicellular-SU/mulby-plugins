/// <reference path="./types/mulby.d.ts" />

declare const mulby: any;

type PluginContext = BackendPluginContext

const TAG = '[unit-converter]'

function log(message: string) {
  console.log(`${TAG} ${message}`)
}

// ── 内嵌轻量单位解析 & 转换（仅用于 MainPush 推送快捷结果）──

type UnitEntry = {
  id: string
  label: string
  symbol: string
  aliases: string[]
  category: string
  categoryLabel: string
  toBase: (v: number) => number
  fromBase: (v: number) => number
}

function ratio(id: string, label: string, symbol: string, r: number, aliases: string[], cat: string, catLabel: string): UnitEntry {
  return { id, label, symbol, aliases, category: cat, categoryLabel: catLabel, toBase: (v) => v * r, fromBase: (v) => v / r }
}

const ALL_UNITS: UnitEntry[] = [
  ratio('meter', '米', 'm', 1, ['m', 'meter', 'meters', '米'], 'length', '长度'),
  ratio('kilometer', '千米', 'km', 1000, ['km', 'kilometer', 'kilometers', '千米', '公里'], 'length', '长度'),
  ratio('centimeter', '厘米', 'cm', 0.01, ['cm', 'centimeter', 'centimeters', '厘米'], 'length', '长度'),
  ratio('millimeter', '毫米', 'mm', 0.001, ['mm', 'millimeter', 'millimeters', '毫米'], 'length', '长度'),
  ratio('inch', '英寸', 'in', 0.0254, ['in', 'inch', 'inches', '英寸'], 'length', '长度'),
  ratio('foot', '英尺', 'ft', 0.3048, ['ft', 'foot', 'feet', '英尺'], 'length', '长度'),
  ratio('yard', '码', 'yd', 0.9144, ['yd', 'yard', 'yards', '码'], 'length', '长度'),
  ratio('mile', '英里', 'mi', 1609.344, ['mi', 'mile', 'miles', '英里'], 'length', '长度'),

  ratio('kilogram', '千克', 'kg', 1, ['kg', 'kilogram', 'kilograms', '千克', '公斤'], 'weight', '重量'),
  ratio('gram', '克', 'g', 0.001, ['g', 'gram', 'grams', '克'], 'weight', '重量'),
  ratio('milligram', '毫克', 'mg', 0.000001, ['mg', 'milligram', 'milligrams', '毫克'], 'weight', '重量'),
  ratio('ton', '吨', 't', 1000, ['t', 'ton', 'tons', '吨'], 'weight', '重量'),
  ratio('pound', '磅', 'lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds', '磅'], 'weight', '重量'),
  ratio('ounce', '盎司', 'oz', 0.028349523125, ['oz', 'ounce', 'ounces', '盎司'], 'weight', '重量'),

  ratio('byte', '字节', 'B', 1, ['b', 'byte', 'bytes', '字节'], 'data', '数据'),
  ratio('kilobyte', 'KB', 'KB', 1024, ['kb', 'kib', 'kilobyte'], 'data', '数据'),
  ratio('megabyte', 'MB', 'MB', 1024 ** 2, ['mb', 'mib', 'megabyte'], 'data', '数据'),
  ratio('gigabyte', 'GB', 'GB', 1024 ** 3, ['gb', 'gib', 'gigabyte'], 'data', '数据'),
  ratio('terabyte', 'TB', 'TB', 1024 ** 4, ['tb', 'tib', 'terabyte'], 'data', '数据'),

  ratio('second', '秒', 's', 1, ['s', 'sec', 'second', 'seconds', '秒'], 'time', '时间'),
  ratio('minute', '分钟', 'min', 60, ['min', 'minute', 'minutes', '分钟'], 'time', '时间'),
  ratio('hour', '小时', 'h', 3600, ['h', 'hr', 'hour', 'hours', '小时'], 'time', '时间'),
  ratio('day', '天', 'd', 86400, ['d', 'day', 'days', '天'], 'time', '时间'),

  ratio('liter', '升', 'L', 1, ['l', 'liter', 'liters', '升'], 'volume', '体积'),
  ratio('milliliter', '毫升', 'mL', 0.001, ['ml', 'milliliter', '毫升'], 'volume', '体积'),
  ratio('gallon', '加仑', 'gal', 3.785411784, ['gal', 'gallon', 'gallons', '加仑'], 'volume', '体积'),

  ratio('square-meter', '平方米', 'm²', 1, ['m2', 'm²', '平方米'], 'area', '面积'),
  ratio('hectare', '公顷', 'ha', 10_000, ['ha', 'hectare', '公顷'], 'area', '面积'),
  ratio('acre', '英亩', 'ac', 4046.8564224, ['ac', 'acre', 'acres', '英亩'], 'area', '面积'),

  ratio('meter-per-second', '米/秒', 'm/s', 1, ['m/s', '米每秒'], 'speed', '速度'),
  ratio('kilometer-per-hour', '千米/时', 'km/h', 1 / 3.6, ['km/h', 'kph', '千米每小时'], 'speed', '速度'),
  ratio('mile-per-hour', '英里/时', 'mph', 0.44704, ['mph', '英里每小时'], 'speed', '速度'),
]

const TEMPERATURE_UNITS: Record<string, { aliases: string[]; toC: (v: number) => number; fromC: (v: number) => number; symbol: string; label: string }> = {
  celsius: { aliases: ['c', 'celsius', '摄氏度', '℃'], toC: (v) => v, fromC: (v) => v, symbol: '℃', label: '摄氏度' },
  fahrenheit: { aliases: ['f', 'fahrenheit', '华氏度', '℉'], toC: (v) => (v - 32) * 5 / 9, fromC: (v) => v * 9 / 5 + 32, symbol: '℉', label: '华氏度' },
  kelvin: { aliases: ['k', 'kelvin', '开尔文'], toC: (v) => v - 273.15, fromC: (v) => v + 273.15, symbol: 'K', label: '开尔文' },
}

type ParsedInput = { value: number; unit: UnitEntry; raw: string } | { value: number; tempId: string; raw: string } | null

function parseInput(text: string): ParsedInput {
  const trimmed = text.trim()
  const match = trimmed.match(/^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([a-zA-Z\u4e00-\u9fa5°℃℉/²³]+)$/i)
  if (!match) return null

  const value = Number(match[1])
  if (!Number.isFinite(value)) return null

  const alias = match[2].toLowerCase()

  for (const [id, temp] of Object.entries(TEMPERATURE_UNITS)) {
    if (temp.aliases.includes(alias)) {
      return { value, tempId: id, raw: trimmed }
    }
  }

  for (const unit of ALL_UNITS) {
    if (unit.aliases.some((a) => a.toLowerCase() === alias)) {
      return { value, unit, raw: trimmed }
    }
  }

  return null
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1e9 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2)
  return Number(v.toPrecision(6)).toString()
}

type PushItem = { title: string; text: string }

function convertForPush(parsed: ParsedInput): PushItem[] {
  if (!parsed) return []

  if ('tempId' in parsed) {
    const source = TEMPERATURE_UNITS[parsed.tempId]
    const celsius = source.toC(parsed.value)
    const results: PushItem[] = []
    for (const [id, target] of Object.entries(TEMPERATURE_UNITS)) {
      if (id === parsed.tempId) continue
      const converted = target.fromC(celsius)
      results.push({
        title: `${fmt(converted)} ${target.symbol}`,
        text: `${parsed.raw} → ${target.label}`
      })
    }
    return results
  }

  const { value, unit } = parsed
  const baseValue = unit.toBase(value)
  const sameCategory = ALL_UNITS.filter((u) => u.category === unit.category && u.id !== unit.id)

  const results: PushItem[] = []
  for (const target of sameCategory) {
    const converted = target.fromBase(baseValue)
    if (converted === 0 && value !== 0) continue
    results.push({
      title: `${fmt(converted)} ${target.symbol}`,
      text: `${parsed.raw} → ${target.label}`
    })
  }

  return results.slice(0, 4)
}

// ── MainPush 注册 ──

let mainPushRegistered = false

function registerMainPush(api: any) {
  if (mainPushRegistered) return
  mainPushRegistered = true

  api.features.onMainPush((action: { code: string; type: string; payload: string }) => {
    const parsed = parseInput(action.payload)
    return convertForPush(parsed)
  })

  api.features.onMainPushSelect(async (action: { code: string; type: string; payload: string; option: { title: string; text: string } }) => {
    await api.clipboard.writeText(action.option.title)
    api.notification.show(`已复制: ${action.option.title}`)
    return false
  })

  log('MainPush 处理程序已注册')
}

// ── 生命周期 ──

export function onLoad() {
  log('插件已加载')
}

export function onUnload() {
  log('插件已卸载')
}

export function onEnable() {
  log('插件已启用')
}

export function onDisable() {
  log('插件已禁用')
}

export function onBackground({ api }: { api: any }) {
  log('后台模式启动')
  registerMainPush(api)
}

export async function run(context: PluginContext) {
  const featureCode = context.featureCode ?? 'open-converter'
  const input = context.input?.trim() ?? ''
  const api = context.api as any

  registerMainPush(api)

  if (featureCode === 'convert-selection' && !input) {
    mulby.notification.show('未检测到可转换内容，请先选中带单位的数值。', 'warning')
    return
  }

  log(`触发功能: ${featureCode}, 输入长度: ${input.length}`)
}

const plugin = { onLoad, onUnload, onEnable, onDisable, onBackground, run }
export default plugin
