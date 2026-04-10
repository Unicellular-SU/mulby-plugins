const baseMap: Record<string, number> = {
  bin: 2,
  oct: 8,
  dec: 10,
  hex: 16
}

const basePatternMap: Record<string, RegExp> = {
  bin: /^[+-]?[01]+$/,
  oct: /^[+-]?[0-7]+$/,
  dec: /^[+-]?\d+$/,
  hex: /^[+-]?[0-9a-fA-F]+$/
}

function normalizeInput(value: string): string {
  return value.trim().replace(/_/g, '')
}

function assertValidBaseInput(value: string, fromUnit: string) {
  const pattern = basePatternMap[fromUnit]
  if (!pattern) {
    throw new Error('不支持的进制类型')
  }
  if (!pattern.test(value)) {
    throw new Error('进制输入包含非法字符')
  }
}

export function convertBase(valueRaw: string, fromUnit: string, toUnit: string): string {
  const fromBase = baseMap[fromUnit]
  const toBase = baseMap[toUnit]

  if (!fromBase || !toBase) {
    throw new Error('不支持的进制类型')
  }

  const value = normalizeInput(valueRaw)
  if (!value) {
    return ''
  }

  assertValidBaseInput(value, fromUnit)
  const numeric = parseInt(value, fromBase)
  if (Number.isNaN(numeric)) {
    throw new Error('无效的进制输入')
  }

  return numeric.toString(toBase).toUpperCase()
}

export function deriveBaseView(valueRaw: string, fromUnit: string): Record<'bin' | 'oct' | 'dec' | 'hex', string> {
  const fromBase = baseMap[fromUnit]
  const value = normalizeInput(valueRaw)
  if (!value || !fromBase) {
    return { bin: '-', oct: '-', dec: '-', hex: '-' }
  }
  if (!basePatternMap[fromUnit]?.test(value)) {
    return { bin: '-', oct: '-', dec: '-', hex: '-' }
  }
  const numeric = parseInt(value, fromBase)
  if (Number.isNaN(numeric)) {
    return { bin: '-', oct: '-', dec: '-', hex: '-' }
  }
  return {
    bin: numeric.toString(2),
    oct: numeric.toString(8),
    dec: numeric.toString(10),
    hex: numeric.toString(16).toUpperCase()
  }
}
