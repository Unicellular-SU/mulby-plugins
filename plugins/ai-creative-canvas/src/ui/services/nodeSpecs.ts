import type { CardKind, CardStatus, MaterialKind } from '../types'
import type { ProviderConfig, VideoProviderCapabilities } from './providers/types'

export const NODE_SPEC_REGISTRY_VERSION = '1.2.0'

export type AgentNodeAction = 'reference' | 'create' | 'update-owned' | 'generate' | 'organize' | 'inspect-output'

export type NodeCondition =
  | { source: 'param'; key: string; equals: string | number | boolean }
  | { source: 'provider'; key: keyof VideoProviderCapabilities; equals: string | number | boolean }

export interface NodeInputSlotSpec {
  id: string
  label: string
  accepts: MaterialKind[]
  min: number
  max?: number
  ordered: boolean
  orderMeaning?: string[]
  requiredWhen?: NodeCondition
  description: string
}

export interface NodeParamOption {
  value: string | number
  label: string
}

export type NodeParamControl =
  | { type: 'select'; width?: number; numeric?: boolean }
  | { type: 'seed' }
  | { type: 'duration' }

export interface NodeParamSpec {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'enum'
  required: boolean
  default?: unknown
  enum?: NodeParamOption[]
  min?: number
  max?: number
  description: string
  providerBound?: 'aspects' | 'durations' | 'resolutions' | 'voices'
  visibleWhen?: NodeCondition
  /** 参数面板渲染提示；缺失表示该参数只供运行时/布局使用，不在通用面板展示。 */
  control?: NodeParamControl
}

export interface NodeOutputSpec {
  materialKind?: MaterialKind
  cardinality: 'none' | 'one' | 'parameter'
  cardinalityParam?: string
  cardFields: Array<'text' | 'assetUrl' | 'assetLocalPath' | 'mime'>
  supportsVersions: boolean
  description: string
}

export interface NodeSpec {
  version: 1
  kind: CardKind
  label: string
  purpose: string
  suitableFor: string[]
  unsuitableFor: string[]
  agent: {
    actions: AgentNodeAction[]
    defaultEnabled: boolean
    requiresApproval: AgentNodeAction[]
  }
  inputs: NodeInputSlotSpec[]
  params: NodeParamSpec[]
  output: NodeOutputSpec
  lifecycle: {
    generatable: boolean
    terminalStatuses: CardStatus[]
    retryableStatuses: CardStatus[]
  }
}

export interface NodeSpecContext {
  boardId?: string
  provider?: ProviderConfig
  videoCapabilities?: VideoProviderCapabilities
  params?: Record<string, unknown>
  projectDefaults?: {
    textModelId?: string
    imageModelId?: string
    panoModelId?: string
  }
}

export type ResolvedNodeSpec = NodeSpec

export interface NodeInputPolicy {
  accepted: readonly MaterialKind[]
  maxByKind?: Partial<Record<MaterialKind, number>>
}

export const NODE_ASPECT_OPTIONS: NodeParamOption[] = [
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

const CAMERA_OPTIONS: NodeParamOption[] = [
  { value: '', label: '运镜·无' },
  { value: '缓慢推近', label: '推近' },
  { value: '缓慢拉远', label: '拉远' },
  { value: '向左平移', label: '左移' },
  { value: '向右平移', label: '右移' },
  { value: '环绕运镜', label: '环绕' },
  { value: '手持轻微晃动', label: '手持' }
]

const GENERATABLE_LIFECYCLE: NodeSpec['lifecycle'] = {
  generatable: true,
  terminalStatuses: ['done', 'error'],
  retryableStatuses: ['error']
}

const STATIC_LIFECYCLE: NodeSpec['lifecycle'] = {
  generatable: false,
  terminalStatuses: ['idle', 'done', 'error'],
  retryableStatuses: []
}

const referenceInput = (description: string): NodeInputSlotSpec => ({
  id: 'references',
  label: '参考素材',
  accepts: ['text', 'image'],
  min: 0,
  ordered: true,
  description
})

export const NODE_SPECS: Record<CardKind, NodeSpec> = {
  text: {
    version: 1,
    kind: 'text',
    label: '文本',
    purpose: '生成或承载提示词、脚本、分析结果和导演增强文本。',
    suitableFor: ['创意脚本', '提示词整理', '镜头分析', '导演增强'],
    unsuitableFor: ['直接保存二进制媒体', '替代图片或视频产物'],
    agent: {
      actions: ['reference', 'create', 'generate', 'inspect-output'],
      defaultEnabled: true,
      requiresApproval: ['generate']
    },
    inputs: [referenceInput('文本作为主要上下文，图片可作为多模态分析参考。')],
    params: [
      {
        key: 'temperature',
        label: '发散程度',
        type: 'number',
        required: false,
        default: 0.7,
        enum: [{ value: 0.3, label: '严谨' }, { value: 0.7, label: '均衡' }, { value: 1, label: '发散' }],
        description: '控制文本生成的稳定性与发散程度。',
        control: { type: 'select', width: 92, numeric: true }
      },
      {
        key: 'shotCount',
        label: '镜头数量',
        type: 'number',
        required: false,
        default: 0,
        enum: [{ value: 0, label: '镜数·自动' }, { value: 4, label: '镜数·4' }, { value: 6, label: '镜数·6' }, { value: 8, label: '镜数·8' }, { value: 12, label: '镜数·12' }],
        description: '分镜类文本任务的目标镜头数，0 表示自动。',
        control: { type: 'select', width: 96, numeric: true }
      }
    ],
    output: {
      materialKind: 'text',
      cardinality: 'one',
      cardFields: ['text'],
      supportsVersions: false,
      description: '单份文本结果，写入卡片 text 字段。'
    },
    lifecycle: GENERATABLE_LIFECYCLE
  },
  image: {
    version: 1,
    kind: 'image',
    label: '图片',
    purpose: '生成角色、产品、场景、静帧或基于参考图的图片结果。',
    suitableFor: ['角色设定', '产品设定', '场景设定', '分镜静帧', '图片编辑'],
    unsuitableFor: ['时间连续运动', '音频输出'],
    agent: {
      actions: ['reference', 'create', 'generate', 'inspect-output'],
      defaultEnabled: true,
      requiresApproval: ['generate']
    },
    inputs: [referenceInput('文本描述画面要求；图片按顺序作为身份、构图或风格参考。')],
    params: [
      {
        key: 'aspect',
        label: '画幅',
        type: 'enum',
        required: false,
        default: '1:1',
        enum: NODE_ASPECT_OPTIONS,
        description: '生成图片的宽高比。',
        control: { type: 'select', width: 78 }
      },
      {
        key: 'resolution',
        label: '分辨率',
        type: 'enum',
        required: false,
        default: '1K',
        enum: [{ value: '1K', label: '1K' }, { value: '2K', label: '2K' }, { value: '4K', label: '4K' }],
        description: '图片输出分辨率档位。',
        control: { type: 'select', width: 68 }
      },
      {
        key: 'count',
        label: '结果数量',
        type: 'number',
        required: false,
        default: 1,
        enum: [{ value: 1, label: '×1' }, { value: 2, label: '×2' }, { value: 3, label: '×3' }, { value: 4, label: '×4' }],
        min: 1,
        max: 4,
        description: '一次生成的候选图片数量。',
        control: { type: 'select', width: 62, numeric: true }
      },
      {
        key: 'seed',
        label: '随机种子',
        type: 'number',
        required: false,
        min: 0,
        description: '用于复现或微调同一生成方向。',
        control: { type: 'seed' }
      }
    ],
    output: {
      materialKind: 'image',
      cardinality: 'parameter',
      cardinalityParam: 'count',
      cardFields: ['assetUrl', 'assetLocalPath', 'mime'],
      supportsVersions: true,
      description: '1–4 张图片；主结果写入卡片，全部候选保存在结果集与版本中。'
    },
    lifecycle: GENERATABLE_LIFECYCLE
  },
  pano: {
    version: 1,
    kind: 'pano',
    label: '全景',
    purpose: '生成固定 2:1 的 360° 环境全景和导演台背景。',
    suitableFor: ['360° 场景', '空间环境基准', '导演台背景'],
    unsuitableFor: ['普通比例单帧', '视频输出'],
    agent: {
      actions: ['reference', 'create', 'generate', 'inspect-output'],
      defaultEnabled: true,
      requiresApproval: ['generate']
    },
    inputs: [referenceInput('文本描述空间；图片可作为环境、风格或材质参考。')],
    params: [
      {
        key: 'resolution',
        label: '分辨率',
        type: 'enum',
        required: false,
        default: '2K',
        enum: [{ value: '2K', label: '2K' }, { value: '4K', label: '4K' }],
        description: '全景图输出分辨率，画幅固定为 2:1。',
        control: { type: 'select', width: 68 }
      },
      {
        key: 'seed',
        label: '随机种子',
        type: 'number',
        required: false,
        min: 0,
        description: '用于复现或微调同一生成方向。',
        control: { type: 'seed' }
      }
    ],
    output: {
      materialKind: 'image',
      cardinality: 'one',
      cardFields: ['assetUrl', 'assetLocalPath', 'mime'],
      supportsVersions: true,
      description: '单张 2:1 全景图片。'
    },
    lifecycle: GENERATABLE_LIFECYCLE
  },
  video: {
    version: 1,
    kind: 'video',
    label: '视频',
    purpose: '生成文生视频、图生视频、参考视频驱动或带首尾关键帧约束的视频片段。',
    suitableFor: ['广告镜头', '角色动作', '产品演示', '首尾帧转场', '多素材混合参考'],
    unsuitableFor: ['静态设定图', '纯文本分析'],
    agent: {
      actions: ['reference', 'create', 'generate', 'inspect-output'],
      defaultEnabled: true,
      requiresApproval: ['generate']
    },
    inputs: [
      {
        id: 'prompt-context',
        label: '文本要求',
        accepts: ['text'],
        min: 0,
        ordered: true,
        description: '上游脚本、镜头描述与本节点补充要求。'
      },
      {
        id: 'image-references',
        label: '画面参考',
        accepts: ['image'],
        min: 0,
        max: 9,
        ordered: true,
        orderMeaning: ['第 1 张', '第 2 张', '后续参考图'],
        description: '按 Provider 能力消费有序图片；首尾帧模式只使用前两张。'
      },
      {
        id: 'video-references',
        label: '视频参考',
        accepts: ['video'],
        min: 0,
        max: 3,
        ordered: true,
        description: '需要 Provider 显式声明支持；当前发送公开 http(s) 视频 URL。'
      }
    ],
    params: [
      {
        key: 'aspect',
        label: '画幅',
        type: 'enum',
        required: false,
        default: '1:1',
        enum: NODE_ASPECT_OPTIONS,
        description: '视频画幅，由 Provider 能力限制。',
        providerBound: 'aspects',
        control: { type: 'select', width: 78 }
      },
      {
        key: 'resolution',
        label: '分辨率',
        type: 'enum',
        required: false,
        enum: [],
        description: '视频输出分辨率；Provider 未声明时不显示。',
        providerBound: 'resolutions',
        visibleWhen: { source: 'provider', key: 'resolutions', equals: true },
        control: { type: 'select', width: 82 }
      },
      {
        key: 'camera',
        label: '运镜',
        type: 'enum',
        required: false,
        default: '',
        enum: CAMERA_OPTIONS,
        description: '镜头运动方向。',
        control: { type: 'select', width: 84 }
      },
      {
        key: 'motion',
        label: '运动强度',
        type: 'enum',
        required: false,
        default: '适中',
        enum: [{ value: '轻微', label: '运动·轻微' }, { value: '适中', label: '运动·适中' }, { value: '强烈', label: '运动·强烈' }],
        description: '主体和镜头的整体运动幅度。',
        control: { type: 'select', width: 88 }
      },
      {
        key: 'refMode',
        label: '参考模式',
        type: 'enum',
        required: false,
        default: 'omni',
        enum: [{ value: 'auto', label: '参考·自动识别' }, { value: 'omni', label: '参考·通用' }, { value: 'keyframe', label: '参考·首尾帧' }],
        description: '自动模式按图片/视频数量让 Provider 推断；首尾帧模式只发送两张图片。',
        visibleWhen: { source: 'provider', key: 'imageToVideo', equals: true },
        control: { type: 'select', width: 100 }
      },
      {
        key: 'seed',
        label: '随机种子',
        type: 'number',
        required: false,
        min: 0,
        description: '用于复现或微调同一生成方向。',
        control: { type: 'seed' }
      },
      {
        key: 'duration',
        label: '时长',
        type: 'number',
        required: false,
        description: 'Provider 支持的原始视频时长档位。',
        providerBound: 'durations',
        control: { type: 'duration' }
      },
      {
        key: 'plannedDuration',
        label: '成片使用时长',
        type: 'number',
        required: false,
        min: 0.1,
        max: 3600,
        description: '最终时间线实际使用的镜头长度；Provider 原始素材可更长。'
      }
    ],
    output: {
      materialKind: 'video',
      cardinality: 'one',
      cardFields: ['assetUrl', 'assetLocalPath', 'mime'],
      supportsVersions: true,
      description: '单个视频片段；实际时长和 Provider 参数记录在生成结果中。'
    },
    lifecycle: GENERATABLE_LIFECYCLE
  },
  audio: {
    version: 1,
    kind: 'audio',
    label: '音频',
    purpose: '把文本内容转换为单个 TTS 配音音频。',
    suitableFor: ['旁白', '角色台词', '临时配音'],
    unsuitableFor: ['音乐生成', '视频原生音轨'],
    agent: {
      actions: ['reference', 'create', 'generate', 'inspect-output'],
      defaultEnabled: true,
      requiresApproval: ['generate']
    },
    inputs: [{
      id: 'script',
      label: '配音文本',
      accepts: ['text'],
      min: 0,
      ordered: true,
      description: '本节点文本或上游文本作为朗读内容。'
    }],
    params: [
      {
        key: 'voice',
        label: '音色',
        type: 'enum',
        required: false,
        default: 'alloy',
        enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map((value) => ({ value, label: value })),
        description: 'TTS 音色。',
        providerBound: 'voices',
        control: { type: 'select', width: 92 }
      },
      {
        key: 'speed',
        label: '语速',
        type: 'number',
        required: false,
        default: 1,
        enum: [{ value: 0.75, label: '0.75×' }, { value: 1, label: '1×' }, { value: 1.25, label: '1.25×' }, { value: 1.5, label: '1.5×' }],
        description: '配音播放速度。',
        control: { type: 'select', width: 76, numeric: true }
      },
      {
        key: 'format',
        label: '格式',
        type: 'enum',
        required: false,
        default: 'mp3',
        enum: [{ value: 'mp3', label: 'mp3' }, { value: 'wav', label: 'wav' }, { value: 'opus', label: 'opus' }],
        description: '音频文件格式。',
        control: { type: 'select', width: 76 }
      }
    ],
    output: {
      materialKind: 'audio',
      cardinality: 'one',
      cardFields: ['assetUrl', 'assetLocalPath', 'mime'],
      supportsVersions: false,
      description: '单个 TTS 音频文件。'
    },
    lifecycle: GENERATABLE_LIFECYCLE
  },
  source: {
    version: 1,
    kind: 'source',
    label: '素材',
    purpose: '承载用户导入的只读图片、视频、音频或文本资源。',
    suitableFor: ['外部参考素材', '品牌资产', '用户已有媒体'],
    unsuitableFor: ['直接生成', '覆盖原始文件'],
    agent: {
      actions: ['reference', 'inspect-output'],
      defaultEnabled: true,
      requiresApproval: []
    },
    inputs: [],
    params: [],
    output: {
      cardinality: 'one',
      cardFields: ['text', 'assetUrl', 'assetLocalPath', 'mime'],
      supportsVersions: false,
      description: '媒体类型由导入文件 MIME 决定；Agent 只能引用和读取，不能生成或覆盖。'
    },
    lifecycle: STATIC_LIFECYCLE
  },
  group: {
    version: 1,
    kind: 'group',
    label: '分组',
    purpose: '组织画布上的阶段、区域与相关卡片。',
    suitableFor: ['空间分区', '阶段整理', '折叠一组卡片'],
    unsuitableFor: ['生成媒体', '作为生成输入'],
    agent: {
      actions: ['organize', 'inspect-output'],
      defaultEnabled: false,
      requiresApproval: []
    },
    inputs: [],
    params: [
      { key: 'color', label: '颜色', type: 'string', required: false, default: '#6366f1', description: '分组视觉颜色。' },
      { key: 'collapsed', label: '折叠', type: 'boolean', required: false, default: false, description: '是否折叠分组内容。' }
    ],
    output: {
      cardinality: 'none',
      cardFields: [],
      supportsVersions: false,
      description: '不产生媒体结果。'
    },
    lifecycle: STATIC_LIFECYCLE
  },
  note: {
    version: 1,
    kind: 'note',
    label: '便签',
    purpose: '保存用户在画布上的自由备注。',
    suitableFor: ['人工备注', '待办提醒'],
    unsuitableFor: ['生成提示词', '媒体产物', 'Agent 自动占位'],
    agent: {
      actions: [],
      defaultEnabled: false,
      requiresApproval: []
    },
    inputs: [],
    params: [],
    output: {
      cardinality: 'none',
      cardFields: [],
      supportsVersions: false,
      description: '不产生可供下游消费的媒体结果。'
    },
    lifecycle: STATIC_LIFECYCLE
  }
}

export function isRegisteredNodeKind(kind: string): kind is CardKind {
  return Object.prototype.hasOwnProperty.call(NODE_SPECS, kind)
}

export function getNodeSpec(kind: CardKind): NodeSpec {
  return NODE_SPECS[kind]
}

function cloneNodeSpec(spec: NodeSpec): ResolvedNodeSpec {
  return {
    ...spec,
    suitableFor: [...spec.suitableFor],
    unsuitableFor: [...spec.unsuitableFor],
    agent: {
      actions: [...spec.agent.actions],
      defaultEnabled: spec.agent.defaultEnabled,
      requiresApproval: [...spec.agent.requiresApproval]
    },
    inputs: spec.inputs.map((input) => ({
      ...input,
      accepts: [...input.accepts],
      orderMeaning: input.orderMeaning ? [...input.orderMeaning] : undefined
    })),
    params: spec.params.map((param) => ({
      ...param,
      enum: param.enum?.map((option) => ({ ...option })),
      control: param.control ? { ...param.control } : undefined
    })),
    output: { ...spec.output, cardFields: [...spec.output.cardFields] },
    lifecycle: {
      ...spec.lifecycle,
      terminalStatuses: [...spec.lifecycle.terminalStatuses],
      retryableStatuses: [...spec.lifecycle.retryableStatuses]
    }
  }
}

/** 合并 Provider 和当前卡片参数，返回可供 UI、预检与 Agent 快照共同消费的节点契约。 */
export function resolveNodeSpec(kind: CardKind, context: NodeSpecContext = {}): ResolvedNodeSpec {
  const resolved = cloneNodeSpec(getNodeSpec(kind))
  if (kind !== 'video') return resolved

  const capabilities = context.videoCapabilities ?? context.provider?.capabilities
  const supportsImages = capabilities ? capabilities.imageToVideo !== false : true
  const supportsLastFrame = capabilities ? capabilities.lastFrame !== false : true
  const declaredImageMax = capabilities?.referenceInputs?.images?.max
  const imageMax = capabilities
    ? Math.max(0, Number.isInteger(declaredImageMax) ? Number(declaredImageMax) : supportsImages ? (supportsLastFrame ? 2 : 1) : 0)
    : 9
  const videoMax = capabilities ? Math.max(0, Number(capabilities.referenceInputs?.videos?.max) || 0) : 3
  const modes = capabilities?.referenceInputs?.images?.modes || (supportsLastFrame ? ['single', 'keyframes'] : ['single'])
  const supportsMulti = modes.includes('multi') || imageMax > 2
  const refMode = context.params?.refMode === 'keyframe' ? 'keyframe' : context.params?.refMode === 'auto' ? 'auto' : 'omni'

  if (!supportsImages || imageMax === 0) {
    resolved.inputs = resolved.inputs.filter((input) => !input.accepts.includes('image'))
  } else {
    const imageInput = resolved.inputs.find((input) => input.id === 'image-references')
    if (imageInput) {
      imageInput.max = supportsLastFrame && refMode === 'keyframe'
        ? Math.min(2, imageMax)
        : supportsMulti ? imageMax : Math.min(1, imageMax)
      imageInput.orderMeaning = supportsLastFrame && refMode === 'keyframe'
        ? ['首帧', '尾帧']
        : supportsMulti ? ['第 1 张', '第 2 张', '后续参考图'] : ['首帧或通用参考']
    }
  }

  const videoInput = resolved.inputs.find((input) => input.id === 'video-references')
  if (!videoInput || videoMax === 0 || refMode === 'keyframe') {
    resolved.inputs = resolved.inputs.filter((input) => input.id !== 'video-references')
  } else {
    videoInput.max = videoMax
  }

  const referenceMode = resolved.params.find((param) => param.key === 'refMode')
  if (!referenceMode || (!imageMax && !videoMax)) {
    resolved.params = resolved.params.filter((param) => param.key !== 'refMode')
  } else {
    referenceMode.default = supportsMulti || videoMax > 0 ? 'auto' : 'omni'
    referenceMode.enum = [
      ...(supportsMulti || videoMax > 0 ? [{ value: 'auto', label: '参考·自动识别' }] : []),
      ...(imageMax ? [{ value: 'omni', label: supportsMulti ? '参考·多图' : '参考·首帧' }] : []),
      ...(supportsLastFrame && imageMax > 1 ? [{ value: 'keyframe', label: '参考·首尾帧' }] : [])
    ]
  }

  const aspect = resolved.params.find((param) => param.key === 'aspect')
  if (aspect && capabilities?.aspects?.length) {
    aspect.enum = capabilities.aspects.map((value) => ({ value, label: value }))
    aspect.default = capabilities.aspects[0]
  }

  const resolutions = capabilities?.resolutions
  const resolution = resolved.params.find((param) => param.key === 'resolution')
  if (!resolutions?.length) {
    resolved.params = resolved.params.filter((param) => param.key !== 'resolution')
  } else if (resolution) {
    resolution.enum = resolutions.map((value) => ({ value, label: value }))
    resolution.default = resolutions[0]
  }

  const duration = resolved.params.find((param) => param.key === 'duration')
  if (duration && capabilities?.durations?.length) {
    duration.enum = capabilities.durations.map((value) => ({ value, label: `${value}s` }))
  }

  return resolved
}

export function inputPolicyFromSpec(spec: NodeSpec): NodeInputPolicy {
  const accepted: MaterialKind[] = []
  const maximums: Partial<Record<MaterialKind, number>> = {}
  const unlimited = new Set<MaterialKind>()

  for (const input of spec.inputs) {
    for (const kind of input.accepts) {
      if (!accepted.includes(kind)) accepted.push(kind)
      if (input.max == null) unlimited.add(kind)
      else maximums[kind] = (maximums[kind] || 0) + input.max
    }
  }

  for (const kind of unlimited) delete maximums[kind]
  return Object.keys(maximums).length ? { accepted, maxByKind: maximums } : { accepted }
}

export function resolveNodeInputPolicy(kind: CardKind, context: NodeSpecContext = {}): NodeInputPolicy {
  return inputPolicyFromSpec(resolveNodeSpec(kind, context))
}
