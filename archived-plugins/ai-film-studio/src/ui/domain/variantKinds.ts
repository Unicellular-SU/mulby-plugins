import type { AssetVariant } from './types'

export type VariantKind = NonNullable<AssetVariant['variantKind']>

export const VARIANT_KIND_LABELS: Record<VariantKind, string> = {
  age: '年龄/时期',
  outfit: '服装',
  makeup: '妆容',
  injury: '伤情',
  state: '状态',
  time: '时段',
  weather: '天气',
  custom: '自定义',
}

export const VARIANT_KIND_OPTIONS: Array<{ value: '' | VariantKind; label: string }> = [
  { value: '', label: '未分类' },
  ...Object.entries(VARIANT_KIND_LABELS).map(([value, label]) => ({ value: value as VariantKind, label })),
]

export function variantKindLabel(kind?: AssetVariant['variantKind']): string {
  return kind ? VARIANT_KIND_LABELS[kind] : ''
}

export function variantLabelWithKind(label: string, kind?: AssetVariant['variantKind']): string {
  const text = label.trim() || '未命名形态'
  const kindLabel = variantKindLabel(kind)
  return kindLabel ? `${text} · ${kindLabel}` : text
}
