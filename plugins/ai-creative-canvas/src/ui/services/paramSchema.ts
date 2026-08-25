import type { Card } from '../types'
import type { VideoProviderCapabilities } from './providers/types'
import { NODE_ASPECT_OPTIONS, resolveNodeSpec, type NodeParamSpec } from './nodeSpecs'

// 声明式参数字段：image/video/audio/text 共用一套 Field + 单一渲染器（ParamControls）
export type ParamField =
  | { type: 'select'; key: string; width?: number; default: string; numeric?: boolean; options: { value: string; label: string }[] }
  | { type: 'seed'; key: string }
  | { type: 'duration'; key: string }

// 比例策略：统一画幅档位（image/video 共用；computeSize 已可解析任意 W:H）
export const ASPECTS = NODE_ASPECT_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))

function toParamField(param: NodeParamSpec): ParamField | null {
  const control = param.control
  if (!control) return null
  if (control.type === 'seed' || control.type === 'duration') return { type: control.type, key: param.key }
  return {
    type: 'select',
    key: param.key,
    width: control.width,
    default: param.default == null ? '' : String(param.default),
    numeric: control.numeric,
    options: (param.enum || []).map((option) => ({ value: String(option.value), label: option.label }))
  }
}

export function getParamSchema(card: Card, videoCapabilities?: VideoProviderCapabilities): ParamField[] {
  return resolveNodeSpec(card.kind, { params: card.params, videoCapabilities }).params
    .map(toParamField)
    .filter((field): field is ParamField => field !== null)
}
