import { convertBase, deriveBaseView } from './baseConverter'
import { CategoryCode, categoryMap, findUnitByAlias } from './unitCatalog'
import { convertCurrency } from './currencyService'

export type ParsedSmartInput = {
  value: string
  suggestedUnitId?: string
}

export type ConversionResult = {
  output: string
  numeric?: number
  error?: string
  basePreview?: Record<'bin' | 'oct' | 'dec' | 'hex', string>
}

function parseValue(valueRaw: string): number {
  const normalized = valueRaw.trim()
  if (!normalized) {
    throw new Error('请输入数值')
  }
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) {
    throw new Error('无效数值，支持普通数字和科学计数法')
  }
  return numeric
}

function formatNumeric(value: number, precision: number, scientific: boolean): string {
  if (scientific) {
    return value.toExponential(precision)
  }
  return Number(value.toFixed(precision)).toString()
}

export function parseSmartInput(rawInput: string, category: CategoryCode): ParsedSmartInput {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return { value: '' }
  }

  if (category === 'base') {
    return { value: trimmed.replace(/\s+/g, '') }
  }

  const matched = trimmed.match(/^([+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([a-zA-Z\u4e00-\u9fa5°℃℉/²³]+)?$/i)
  if (!matched) {
    return { value: trimmed }
  }

  const value = matched[1]
  const alias = matched[2]
  if (!alias) {
    return { value }
  }

  const unitId = findUnitByAlias(category, alias)
  if (!unitId) {
    return { value }
  }

  return { value, suggestedUnitId: unitId }
}

export function convertByCategory(input: {
  category: CategoryCode
  valueRaw: string
  fromUnitId: string
  toUnitId: string
  precision: number
  scientific: boolean
  currencyRates: Record<string, number>
}): ConversionResult {
  const { category, valueRaw, fromUnitId, toUnitId, precision, scientific, currencyRates } = input

  try {
    if (category === 'base') {
      const output = convertBase(valueRaw, fromUnitId, toUnitId)
      return { output, basePreview: deriveBaseView(valueRaw, fromUnitId) }
    }

    const numericInput = parseValue(valueRaw)

    if (category === 'currency') {
      const converted = convertCurrency(numericInput, fromUnitId, toUnitId, currencyRates)
      return { output: formatNumeric(converted, precision, scientific), numeric: converted }
    }

    const categoryDef = categoryMap.get(category)
    if (!categoryDef) {
      return { output: '-', error: '未知分类' }
    }

    const fromUnit = categoryDef.units.find((unit) => unit.id === fromUnitId)
    const toUnit = categoryDef.units.find((unit) => unit.id === toUnitId)
    if (!fromUnit || !toUnit) {
      return { output: '-', error: '单位选择无效' }
    }

    const baseValue = fromUnit.toBase(numericInput)
    const converted = toUnit.fromBase(baseValue)
    return { output: formatNumeric(converted, precision, scientific), numeric: converted }
  } catch (error) {
    return {
      output: '-',
      error: error instanceof Error ? error.message : '转换失败'
    }
  }
}
