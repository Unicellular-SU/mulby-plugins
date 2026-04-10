export type CategoryCode =
  | 'length'
  | 'weight'
  | 'temperature'
  | 'currency'
  | 'data'
  | 'time'
  | 'area'
  | 'volume'
  | 'speed'
  | 'base'

export type UnitDefinition = {
  id: string
  label: string
  symbol: string
  aliases: string[]
  toBase: (value: number) => number
  fromBase: (value: number) => number
}

export type CategoryDefinition = {
  code: CategoryCode
  label: string
  units: UnitDefinition[]
}

function ratioUnit(id: string, label: string, symbol: string, ratioToBase: number, aliases: string[]): UnitDefinition {
  return {
    id,
    label,
    symbol,
    aliases,
    toBase: (value) => value * ratioToBase,
    fromBase: (value) => value / ratioToBase
  }
}

export const categoryOrder: CategoryCode[] = [
  'length',
  'weight',
  'temperature',
  'currency',
  'data',
  'time',
  'area',
  'volume',
  'speed',
  'base'
]

const lengthUnits: UnitDefinition[] = [
  ratioUnit('meter', '米', 'm', 1, ['m', 'meter', 'meters', '米']),
  ratioUnit('kilometer', '千米', 'km', 1000, ['km', 'kilometer', 'kilometers', '千米', '公里']),
  ratioUnit('centimeter', '厘米', 'cm', 0.01, ['cm', 'centimeter', 'centimeters', '厘米']),
  ratioUnit('millimeter', '毫米', 'mm', 0.001, ['mm', 'millimeter', 'millimeters', '毫米']),
  ratioUnit('inch', '英寸', 'in', 0.0254, ['in', 'inch', 'inches', '英寸']),
  ratioUnit('foot', '英尺', 'ft', 0.3048, ['ft', 'foot', 'feet', '英尺']),
  ratioUnit('yard', '码', 'yd', 0.9144, ['yd', 'yard', 'yards', '码']),
  ratioUnit('mile', '英里', 'mi', 1609.344, ['mi', 'mile', 'miles', '英里'])
]

const weightUnits: UnitDefinition[] = [
  ratioUnit('kilogram', '千克', 'kg', 1, ['kg', 'kilogram', 'kilograms', '千克', '公斤']),
  ratioUnit('gram', '克', 'g', 0.001, ['g', 'gram', 'grams', '克']),
  ratioUnit('milligram', '毫克', 'mg', 0.000001, ['mg', 'milligram', 'milligrams', '毫克']),
  ratioUnit('ton', '吨', 't', 1000, ['t', 'ton', 'tons', '吨']),
  ratioUnit('pound', '磅', 'lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds', '磅']),
  ratioUnit('ounce', '盎司', 'oz', 0.028349523125, ['oz', 'ounce', 'ounces', '盎司'])
]

const temperatureUnits: UnitDefinition[] = [
  {
    id: 'celsius',
    label: '摄氏度',
    symbol: 'C',
    aliases: ['c', 'celsius', '摄氏度', '℃'],
    toBase: (value) => value,
    fromBase: (value) => value
  },
  {
    id: 'fahrenheit',
    label: '华氏度',
    symbol: 'F',
    aliases: ['f', 'fahrenheit', '华氏度', '℉'],
    toBase: (value) => (value - 32) * (5 / 9),
    fromBase: (value) => value * (9 / 5) + 32
  },
  {
    id: 'kelvin',
    label: '开尔文',
    symbol: 'K',
    aliases: ['k', 'kelvin', '开尔文'],
    toBase: (value) => value - 273.15,
    fromBase: (value) => value + 273.15
  }
]

const dataUnits: UnitDefinition[] = [
  ratioUnit('byte', '字节', 'B', 1, ['b', 'byte', 'bytes', '字节']),
  ratioUnit('kilobyte', '千字节', 'KB', 1024, ['kb', 'kib', 'kilobyte', '千字节']),
  ratioUnit('megabyte', '兆字节', 'MB', 1024 ** 2, ['mb', 'mib', 'megabyte', '兆字节']),
  ratioUnit('gigabyte', '吉字节', 'GB', 1024 ** 3, ['gb', 'gib', 'gigabyte', '吉字节']),
  ratioUnit('terabyte', '太字节', 'TB', 1024 ** 4, ['tb', 'tib', 'terabyte', '太字节']),
  ratioUnit('bit', '比特', 'bit', 1 / 8, ['bit', 'bits', '比特'])
]

const timeUnits: UnitDefinition[] = [
  ratioUnit('second', '秒', 's', 1, ['s', 'sec', 'second', 'seconds', '秒']),
  ratioUnit('minute', '分钟', 'min', 60, ['min', 'minute', 'minutes', '分钟']),
  ratioUnit('hour', '小时', 'h', 3600, ['h', 'hr', 'hour', 'hours', '小时']),
  ratioUnit('day', '天', 'd', 86400, ['d', 'day', 'days', '天']),
  ratioUnit('week', '周', 'wk', 604800, ['wk', 'week', 'weeks', '周'])
]

const areaUnits: UnitDefinition[] = [
  ratioUnit('square-meter', '平方米', 'm²', 1, ['m2', 'm²', 'square meter', '平方米']),
  ratioUnit('square-kilometer', '平方千米', 'km²', 1_000_000, ['km2', 'km²', 'square kilometer', '平方千米']),
  ratioUnit('hectare', '公顷', 'ha', 10_000, ['ha', 'hectare', '公顷']),
  ratioUnit('square-foot', '平方英尺', 'ft²', 0.09290304, ['ft2', 'ft²', 'square foot', '平方英尺']),
  ratioUnit('acre', '英亩', 'ac', 4046.8564224, ['ac', 'acre', 'acres', '英亩'])
]

const volumeUnits: UnitDefinition[] = [
  ratioUnit('liter', '升', 'L', 1, ['l', 'liter', 'liters', '升']),
  ratioUnit('milliliter', '毫升', 'mL', 0.001, ['ml', 'milliliter', '毫升']),
  ratioUnit('cubic-meter', '立方米', 'm³', 1000, ['m3', 'm³', 'cubic meter', '立方米']),
  ratioUnit('gallon', '美制加仑', 'gal', 3.785411784, ['gal', 'gallon', 'gallons', '加仑']),
  ratioUnit('quart', '夸脱', 'qt', 0.946352946, ['qt', 'quart', '夸脱']),
  ratioUnit('pint', '品脱', 'pt', 0.473176473, ['pt', 'pint', '品脱'])
]

const speedUnits: UnitDefinition[] = [
  ratioUnit('meter-per-second', '米/秒', 'm/s', 1, ['m/s', 'meter per second', '米每秒']),
  ratioUnit('kilometer-per-hour', '千米/时', 'km/h', 1 / 3.6, ['km/h', 'kph', '千米每小时']),
  ratioUnit('mile-per-hour', '英里/时', 'mph', 0.44704, ['mph', 'mile per hour', '英里每小时']),
  ratioUnit('knot', '节', 'kn', 0.514444, ['kn', 'knot', '节'])
]

export const CURRENCY_UNITS: UnitDefinition[] = [
  ratioUnit('USD', '美元', 'USD', 1, ['usd', 'dollar', '美元']),
  ratioUnit('EUR', '欧元', 'EUR', 1, ['eur', 'euro', '欧元']),
  ratioUnit('CNY', '人民币', 'CNY', 1, ['cny', 'rmb', 'yuan', '人民币', '元']),
  ratioUnit('JPY', '日元', 'JPY', 1, ['jpy', 'yen', '日元']),
  ratioUnit('GBP', '英镑', 'GBP', 1, ['gbp', 'pound sterling', '英镑']),
  ratioUnit('HKD', '港币', 'HKD', 1, ['hkd', '港币'])
]

const baseUnits: UnitDefinition[] = [
  ratioUnit('bin', '二进制', 'BIN', 1, ['bin', 'binary', '二进制']),
  ratioUnit('oct', '八进制', 'OCT', 1, ['oct', 'octal', '八进制']),
  ratioUnit('dec', '十进制', 'DEC', 1, ['dec', 'decimal', '十进制']),
  ratioUnit('hex', '十六进制', 'HEX', 1, ['hex', 'hexadecimal', '十六进制'])
]

export const CATEGORIES: CategoryDefinition[] = [
  { code: 'length', label: '长度', units: lengthUnits },
  { code: 'weight', label: '重量', units: weightUnits },
  { code: 'temperature', label: '温度', units: temperatureUnits },
  { code: 'currency', label: '货币', units: CURRENCY_UNITS },
  { code: 'data', label: '数据', units: dataUnits },
  { code: 'time', label: '时间', units: timeUnits },
  { code: 'area', label: '面积', units: areaUnits },
  { code: 'volume', label: '体积', units: volumeUnits },
  { code: 'speed', label: '速度', units: speedUnits },
  { code: 'base', label: '进制', units: baseUnits }
]

export const categoryMap = new Map(CATEGORIES.map((category) => [category.code, category]))

export function getDefaultUnits(category: CategoryCode): { fromUnitId: string; toUnitId: string } {
  if (category === 'currency') {
    return { fromUnitId: 'USD', toUnitId: 'CNY' }
  }
  if (category === 'base') {
    return { fromUnitId: 'dec', toUnitId: 'hex' }
  }
  const categoryDef = categoryMap.get(category)
  if (!categoryDef || categoryDef.units.length < 2) {
    return { fromUnitId: '', toUnitId: '' }
  }
  return { fromUnitId: categoryDef.units[0].id, toUnitId: categoryDef.units[1].id }
}

export function findUnitByAlias(category: CategoryCode, aliasRaw: string): string | null {
  const alias = aliasRaw.trim().toLowerCase()
  const categoryDef = categoryMap.get(category)
  if (!categoryDef) {
    return null
  }
  const matched = categoryDef.units.find((unit) => unit.aliases.some((item) => item.toLowerCase() === alias))
  return matched?.id ?? null
}
