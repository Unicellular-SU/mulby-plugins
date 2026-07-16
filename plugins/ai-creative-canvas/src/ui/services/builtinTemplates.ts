import type { CardKind, GroupTemplate } from '../types'
import { CARD_DEFAULT_SIZE } from '../types'

// 内置演示模板：纯结构（无产物），供新手从空画布一键搭出常见链路。
// id 以 'builtin-' 前缀标识，listTemplates 合并展示、不可删除（删除只作用于用户存储）。
export function isBuiltinTemplate(id: string): boolean {
  return id.startsWith('builtin-')
}

type TplCard = GroupTemplate['members'][number]['card']
function card(kind: CardKind, x: number, y: number, title: string, prompt = '', params: Record<string, unknown> = {}): TplCard {
  const { w, h } = CARD_DEFAULT_SIZE[kind]
  return {
    kind, x, y, w, h, title, prompt,
    modelId: null, providerId: null, params,
    status: 'idle', progress: 0, error: null,
    mime: null, text: null, refIds: [], assets: [], meta: {}
  }
}

const T0 = 0 // 模板 createdAt/updatedAt 固定 0（内置、不随时间变）

export const BUILTIN_TEMPLATES: GroupTemplate[] = [
  {
    id: 'builtin-text2img',
    name: '文生图基础链',
    createdAt: T0,
    updatedAt: T0,
    group: { w: 700, h: 400, title: '文生图基础链', params: { collapsed: false } },
    members: [
      { localId: 'm0', parentLocalId: null, card: card('text', 24, 60, '提示词', '描述你想要的画面，如：赛博朋克城市夜景，霓虹灯，雨后街道') },
      { localId: 'm1', parentLocalId: null, card: card('image', 360, 40, '出图') }
    ],
    edges: [{ source: 'm0', target: 'm1', kind: 'ref' }]
  },
  {
    id: 'builtin-img2video',
    name: '图生视频链',
    createdAt: T0,
    updatedAt: T0,
    group: { w: 700, h: 380, title: '图生视频链', params: { collapsed: false } },
    members: [
      { localId: 'm0', parentLocalId: null, card: card('image', 24, 50, '首帧图', '一张作为首帧的图片（可先文生图或拖入素材）') },
      { localId: 'm1', parentLocalId: null, card: card('video', 340, 40, '生成视频', '基于首帧的运动描述，如：镜头缓慢推进') }
    ],
    edges: [{ source: 'm0', target: 'm1', kind: 'ref' }]
  },
  {
    id: 'builtin-storyboard-fanout',
    name: '分镜扇出',
    createdAt: T0,
    updatedAt: T0,
    group: { w: 720, h: 640, title: '分镜扇出', params: { collapsed: false } },
    members: [
      { localId: 'm0', parentLocalId: null, card: card('text', 24, 200, '分镜脚本', '一句话描述整段故事，AI 扩写为多个镜头') },
      { localId: 'm1', parentLocalId: null, card: card('image', 380, 20, '镜头 1') },
      { localId: 'm2', parentLocalId: null, card: card('image', 380, 200, '镜头 2') },
      { localId: 'm3', parentLocalId: null, card: card('image', 380, 380, '镜头 3') }
    ],
    edges: [
      { source: 'm0', target: 'm1', kind: 'ref' },
      { source: 'm0', target: 'm2', kind: 'ref' },
      { source: 'm0', target: 'm3', kind: 'ref' }
    ]
  }
]
