import type { Card } from '../types'

// 声明式参数字段：image/video/audio/text 共用一套 Field + 单一渲染器（ParamControls）
export type ParamField =
  | { type: 'select'; key: string; width?: number; default: string; numeric?: boolean; options: { value: string; label: string }[] }
  | { type: 'seed'; key: string }
  | { type: 'duration'; key: string }

// 比例策略：统一画幅档位（image/video 共用；computeSize 已可解析任意 W:H）
export const ASPECTS = [
  { value: '1:1', label: '1:1' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '21:9', label: '21:9' },
  { value: '2:1', label: '2:1' }
]

const CAMERA = [
  { value: '', label: '运镜·无' },
  { value: '缓慢推近', label: '推近' },
  { value: '缓慢拉远', label: '拉远' },
  { value: '向左平移', label: '左移' },
  { value: '向右平移', label: '右移' },
  { value: '环绕运镜', label: '环绕' },
  { value: '手持轻微晃动', label: '手持' }
]

export function getParamSchema(card: Card): ParamField[] {
  switch (card.kind) {
    case 'image':
      return [
        { type: 'select', key: 'aspect', width: 78, default: '1:1', options: ASPECTS },
        { type: 'select', key: 'resolution', width: 68, default: '1K', options: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' }] },
        { type: 'select', key: 'count', width: 62, default: '1', numeric: true, options: [{ value: '1', label: '×1' }, { value: '2', label: '×2' }, { value: '3', label: '×3' }, { value: '4', label: '×4' }] },
        { type: 'seed', key: 'seed' }
      ]
    case 'pano': // 360 全景卡：比例强制 2:1、单张，仅暴露分辨率（≥2K）与种子
      return [
        { type: 'select', key: 'resolution', width: 68, default: '2K', options: [{ value: '2K', label: '2K' }, { value: '4K', label: '4K' }] },
        { type: 'seed', key: 'seed' }
      ]
    case 'video':
      return [
        { type: 'select', key: 'aspect', width: 78, default: '16:9', options: ASPECTS },
        { type: 'select', key: 'camera', width: 84, default: '', options: CAMERA },
        { type: 'select', key: 'motion', width: 88, default: '适中', options: [{ value: '轻微', label: '运动·轻微' }, { value: '适中', label: '运动·适中' }, { value: '强烈', label: '运动·强烈' }] },
        { type: 'select', key: 'refMode', width: 100, default: 'omni', options: [{ value: 'omni', label: '参考·通用' }, { value: 'keyframe', label: '参考·首尾帧' }] },
        { type: 'seed', key: 'seed' },
        { type: 'duration', key: 'duration' }
      ]
    case 'audio':
      return [
        { type: 'select', key: 'voice', width: 92, default: 'alloy', options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((v) => ({ value: v, label: v })) },
        { type: 'select', key: 'speed', width: 76, default: '1', numeric: true, options: [{ value: '0.75', label: '0.75×' }, { value: '1', label: '1×' }, { value: '1.25', label: '1.25×' }, { value: '1.5', label: '1.5×' }] },
        { type: 'select', key: 'format', width: 76, default: 'mp3', options: [{ value: 'mp3', label: 'mp3' }, { value: 'wav', label: 'wav' }, { value: 'opus', label: 'opus' }] }
      ]
    case 'text':
      return [
        { type: 'select', key: 'temperature', width: 92, default: '0.7', numeric: true, options: [{ value: '0.3', label: '严谨' }, { value: '0.7', label: '均衡' }, { value: '1', label: '发散' }] },
        { type: 'select', key: 'shotCount', width: 96, default: '0', numeric: true, options: [{ value: '0', label: '镜数·自动' }, { value: '4', label: '镜数·4' }, { value: '6', label: '镜数·6' }, { value: '8', label: '镜数·8' }, { value: '12', label: '镜数·12' }] }
      ]
    default:
      return []
  }
}
