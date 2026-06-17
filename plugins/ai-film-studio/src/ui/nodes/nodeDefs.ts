import {
  Image as ImageIcon,
  Video,
  PenLine,
  Users,
  Mountain,
  Wand2,
  Eye,
  Download,
  Type,
  Settings2,
  Frame,
  Clapperboard,
  Film,
  Music,
  Mic,
  Layers,
  type LucideIcon,
} from 'lucide-react'

// ============ 端口类型系统 ============
export type PortType = 'text' | 'json' | 'image' | 'video' | 'audio' | 'any'
export type NodeCategory = 'input' | 'text' | 'image' | 'video' | 'audio' | 'output'

export interface PortDef {
  id: string
  label: string
  type: PortType
}

export interface ParamDef {
  key: string
  label: string
  control: 'text' | 'textarea' | 'number' | 'select'
  options?: string[]
  placeholder?: string
  default?: string | number
}

export interface NodeDef {
  kind: string
  category: NodeCategory
  label: string
  desc: string
  icon: LucideIcon
  inputs: PortDef[]
  outputs: PortDef[]
  params: ParamDef[]
}

// ============ 分类元数据 ============
export const CATEGORY_META: Record<NodeCategory, { label: string; color: string }> = {
  input: { label: '输入', color: '#64748b' },
  text: { label: '文本 AI', color: '#3b82f6' },
  image: { label: '图像 AI', color: '#a855f7' },
  video: { label: '视频 AI', color: '#ef4444' },
  audio: { label: '音频', color: '#14b8a6' },
  output: { label: '输出', color: '#10b981' },
}

export const CATEGORY_ORDER: NodeCategory[] = ['input', 'text', 'image', 'video', 'audio', 'output']

// ============ 端口颜色 ============
export const PORT_COLORS: Record<PortType, string> = {
  text: '#60a5fa',
  json: '#fbbf24',
  image: '#c084fc',
  video: '#f87171',
  audio: '#34d399',
  any: '#94a3b8',
}

// ============ 节点定义（M0 起步集，覆盖全部分类） ============
export const NODE_DEFS: NodeDef[] = [
  // —— 输入 ——
  {
    kind: 'story',
    category: 'input',
    label: '故事输入',
    desc: '一句话或一段故事，作为创作起点',
    icon: Clapperboard,
    inputs: [],
    outputs: [{ id: 'out', label: '故事', type: 'text' }],
    params: [{ key: 'text', label: '故事内容', control: 'textarea', placeholder: '输入一句话或一段故事…' }],
  },
  {
    kind: 'text',
    category: 'input',
    label: '文本片段',
    desc: '任意文本，可作为提示词/补充设定',
    icon: Type,
    inputs: [],
    outputs: [{ id: 'out', label: '文本', type: 'text' }],
    params: [{ key: 'text', label: '文本', control: 'textarea', placeholder: '输入文本…' }],
  },
  {
    kind: 'image-input',
    category: 'input',
    label: '参考图',
    desc: '上传参考图（M2 接入上传）',
    icon: ImageIcon,
    inputs: [],
    outputs: [{ id: 'out', label: '图片', type: 'image' }],
    params: [],
  },
  {
    kind: 'audio-input',
    category: 'input',
    label: '音频素材',
    desc: '上传本地配乐/音效，作为成片音轨',
    icon: Music,
    inputs: [],
    outputs: [{ id: 'out', label: '音频', type: 'audio' }],
    params: [],
  },
  {
    kind: 'character',
    category: 'input',
    label: '人物',
    desc: '独立定义一个角色（名称/外貌/英文提示词），可直连角色三视图/关键帧，跨镜复用',
    icon: Users,
    inputs: [],
    outputs: [{ id: 'out', label: '角色', type: 'json' }],
    params: [
      { key: 'name', label: '角色名', control: 'text', placeholder: '如：小明' },
      { key: 'appearance', label: '外貌/服饰', control: 'textarea', placeholder: '外貌、服饰、特征…' },
      { key: 'refPrompt', label: '英文提示词(可选)', control: 'textarea', placeholder: '用于生成的英文 prompt，可留空' },
    ],
  },
  {
    kind: 'scene',
    category: 'input',
    label: '场景',
    desc: '独立定义一个场景（名称/描述/英文提示词），可直连场景概念图/关键帧',
    icon: Mountain,
    inputs: [],
    outputs: [{ id: 'out', label: '场景', type: 'json' }],
    params: [
      { key: 'name', label: '场景名', control: 'text', placeholder: '如：咖啡馆' },
      { key: 'description', label: '描述', control: 'textarea', placeholder: '环境、氛围、光线…' },
      { key: 'refPrompt', label: '英文提示词(可选)', control: 'textarea', placeholder: '用于生成的英文 prompt，可留空' },
    ],
  },
  {
    kind: 'global-style',
    category: 'input',
    label: '全局设定',
    desc: '画风/画幅/风格，注入下游所有生成节点',
    icon: Settings2,
    inputs: [],
    outputs: [{ id: 'out', label: '设定', type: 'json' }],
    params: [
      { key: 'aspectRatio', label: '画幅', control: 'select', options: ['16:9', '9:16', '1:1'], default: '16:9' },
      { key: 'style', label: '画风', control: 'text', placeholder: '如：电影感、赛博朋克、水彩…' },
    ],
  },

  // —— 文本 AI ——
  {
    kind: 'script-gen',
    category: 'text',
    label: '剧本生成',
    desc: '把故事扩展为分场剧本（场次/对白/动作）',
    icon: PenLine,
    inputs: [{ id: 'in', label: '故事', type: 'text' }],
    outputs: [{ id: 'out', label: '剧本', type: 'json' }],
    params: [{ key: 'instruction', label: '附加要求', control: 'textarea', placeholder: '可选：风格/篇幅/视角…' }],
  },
  {
    kind: 'storyboard',
    category: 'text',
    label: '分镜脚本',
    desc: '把剧本拆解为镜头表（景别/运镜/时长）',
    icon: Film,
    inputs: [{ id: 'in', label: '剧本', type: 'json' }],
    outputs: [{ id: 'out', label: '分镜', type: 'json' }],
    params: [{ key: 'shotCount', label: '目标镜头数', control: 'number', default: 8 }],
  },
  {
    kind: 'char-sheet',
    category: 'text',
    label: '角色设定',
    desc: '生成角色描述与三视图提示词',
    icon: Users,
    inputs: [{ id: 'in', label: '剧本/故事', type: 'any' }],
    outputs: [{ id: 'out', label: '角色', type: 'json' }],
    params: [],
  },
  {
    kind: 'prompt-fx',
    category: 'text',
    label: '提示词处理',
    desc: '扩写 / 中英互译 / 风格化',
    icon: Wand2,
    inputs: [{ id: 'in', label: '文本', type: 'text' }],
    outputs: [{ id: 'out', label: '文本', type: 'text' }],
    params: [{ key: 'mode', label: '模式', control: 'select', options: ['扩写', '中译英', '英译中', '风格化'], default: '扩写' }],
  },

  // —— 图像 AI ——
  {
    kind: 'char-image',
    category: 'image',
    label: '角色三视图',
    desc: '由角色设定生成统一画风的三视图',
    icon: Users,
    inputs: [
      { id: 'role', label: '角色', type: 'json' },
      { id: 'style', label: '设定', type: 'json' },
    ],
    outputs: [{ id: 'out', label: '角色图', type: 'image' }],
    params: [{ key: 'size', label: '尺寸', control: 'select', options: ['1024x1024', '768x1024', '1024x768'], default: '1024x1024' }],
  },
  {
    kind: 'scene-image',
    category: 'image',
    label: '场景概念图',
    desc: '生成场景设定/概念图',
    icon: Mountain,
    inputs: [{ id: 'in', label: '描述', type: 'any' }],
    outputs: [{ id: 'out', label: '场景图', type: 'image' }],
    params: [{ key: 'size', label: '尺寸', control: 'select', options: ['1344x768', '1024x1024', '768x1344'], default: '1344x768' }],
  },
  {
    kind: 'keyframe',
    category: 'image',
    label: '分镜关键帧',
    desc: '由分镜+参考图生成镜头首帧',
    icon: Frame,
    inputs: [
      { id: 'shot', label: '分镜/描述', type: 'any' },
      { id: 'chars', label: '人物(可选)', type: 'json' },
      { id: 'ref', label: '参考图', type: 'image' },
    ],
    outputs: [{ id: 'out', label: '关键帧', type: 'image' }],
    params: [{ key: 'size', label: '尺寸', control: 'select', options: ['1280x720', '720x1280', '1024x1024'], default: '1280x720' }],
  },

  // —— 视频 AI ——
  {
    kind: 'i2v',
    category: 'video',
    label: '图生视频',
    desc: '由关键帧首帧（可选尾帧）生成视频片段；连尾帧即首尾帧约束补间',
    icon: Video,
    inputs: [
      { id: 'frame', label: '首帧', type: 'image' },
      { id: 'tail', label: '尾帧(可选)', type: 'image' },
      { id: 'prompt', label: '提示', type: 'text' },
    ],
    outputs: [{ id: 'out', label: '视频', type: 'video' }],
    params: [
      { key: 'duration', label: '时长(秒)', control: 'number', default: 5 },
      { key: 'motion', label: '运镜/动作', control: 'textarea', placeholder: '描述画面如何运动…' },
    ],
  },
  {
    kind: 't2v',
    category: 'video',
    label: '文生视频',
    desc: '由文本直接生成视频片段',
    icon: Video,
    inputs: [{ id: 'in', label: '提示', type: 'text' }],
    outputs: [{ id: 'out', label: '视频', type: 'video' }],
    params: [{ key: 'duration', label: '时长(秒)', control: 'number', default: 5 }],
  },

  // —— 音频 ——
  {
    kind: 'tts',
    category: 'audio',
    label: '配音 (TTS)',
    desc: '由文本合成旁白/配音（OpenAI 兼容语音）',
    icon: Mic,
    inputs: [{ id: 'in', label: '文本', type: 'text' }],
    outputs: [{ id: 'out', label: '音频', type: 'audio' }],
    params: [
      { key: 'text', label: '配音文本', control: 'textarea', placeholder: '可留空，改为连接上游文本' },
      { key: 'baseURL', label: '接口地址', control: 'text', placeholder: 'https://api.openai.com/v1' },
      { key: 'model', label: '模型', control: 'text', default: 'tts-1' },
      { key: 'voice', label: '音色', control: 'select', options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'], default: 'alloy' },
      { key: 'speed', label: '语速', control: 'number', default: 1 },
    ],
  },

  // —— 输出 ——
  {
    kind: 'preview',
    category: 'output',
    label: '预览',
    desc: '预览上游产物（文本/图/视频）',
    icon: Eye,
    inputs: [{ id: 'in', label: '内容', type: 'any' }],
    outputs: [],
    params: [],
  },
  {
    kind: 'compose',
    category: 'output',
    label: '影片合成',
    desc: '把多个视频片段按时间线拼成一条带字幕/配音的成片（ffmpeg）',
    icon: Layers,
    inputs: [
      { id: 'clips', label: '视频片段', type: 'video' },
      { id: 'audio', label: '配音/音乐', type: 'audio' },
      { id: 'subs', label: '字幕(分镜)', type: 'json' },
    ],
    outputs: [{ id: 'out', label: '成片', type: 'video' }],
    params: [
      {
        key: 'resolution',
        label: '分辨率',
        control: 'select',
        options: ['1280x720', '1920x1080', '720x1280', '1080x1920', '1024x1024'],
        default: '1280x720',
      },
      { key: 'fps', label: '帧率', control: 'number', default: 24 },
      { key: 'subtitleMode', label: '字幕', control: 'select', options: ['关闭', '烧录字幕', '软字幕'], default: '关闭' },
    ],
  },
  {
    kind: 'export',
    category: 'output',
    label: '导出',
    desc: '把成片/片段另存到本机指定位置',
    icon: Download,
    inputs: [{ id: 'in', label: '视频', type: 'video' }],
    outputs: [],
    params: [],
  },
]

const DEF_MAP: Record<string, NodeDef> = Object.fromEntries(NODE_DEFS.map((d) => [d.kind, d]))

export function getNodeDef(kind: string): NodeDef | undefined {
  return DEF_MAP[kind]
}

export function getDefsByCategory(category: NodeCategory): NodeDef[] {
  return NODE_DEFS.filter((d) => d.category === category)
}
