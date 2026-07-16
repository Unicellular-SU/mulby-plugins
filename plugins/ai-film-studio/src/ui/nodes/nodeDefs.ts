import {
  Image as ImageIcon,
  ListTree,
  Box,
  Video,
  PenLine,
  Users,
  Mountain,
  Wand2,
  Eye,
  Download,
  Type,
  Frame,
  Clapperboard,
  Film,
  Music,
  Music2,
  Mic,
  Layers,
  Brush,
  Combine,
  ZoomIn,
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
    desc: '角色资产：按描述生成单张人物图 / 上传图片 / 连「参考图」用素材图生成。输出「角色」(身份+参考图打包成一条)，一根线直连关键帧保持一致性',
    icon: Users,
    // 「参考图」入口：连入素材图即按图生成该角色（img2img），不连则按文字描述生成
    inputs: [{ id: 'ref', label: '参考图', type: 'image' }],
    // 单一输出「角色」：身份(JSON) 与参考图打包同行，下游一根线即可，无需再分别连身份/图
    outputs: [{ id: 'out', label: '角色', type: 'json' }],
    params: [
      { key: 'name', label: '角色名', control: 'text', placeholder: '如：小明' },
      { key: 'appearance', label: '外貌/服饰', control: 'textarea', placeholder: '外貌、服饰、特征…（用于「运行此节点」按描述生成人物图）' },
      { key: 'identity', label: '身份特征(跨期不变·可选)', control: 'textarea', placeholder: '脸型/五官/体型/标志特征(疤·痣·瞳色)，age-neutral；多时期角色填这里，各期外观放下方「时期变体」' },
      { key: 'refPrompt', label: '英文提示词(可选)', control: 'textarea', placeholder: '用于生成的英文 prompt，可留空' },
      {
        key: 'variantsJson',
        label: '时期变体(JSON·高级·可选)',
        control: 'textarea',
        placeholder: '多时期角色：[{"id":"youth","label":"少年","appearance":"16岁清瘦布衣"}]（连入「角色设定图」会逐变体各出一张设定板）',
      },
      {
        key: 'voiceId',
        label: '音色(配音)',
        control: 'select',
        options: ['', 'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
        default: '',
      },
      { key: 'size', label: '尺寸', control: 'select', options: ['1024x1024', '768x1024', '1024x768'], default: '1024x1024' },
    ],
  },
  {
    kind: 'scene',
    category: 'input',
    label: '场景',
    desc: '场景资产：按文字生成概念图 / 上传图片 / 连「参考图」用素材图生成。输出「场景」(设定+参考图打包)，一根线直连关键帧',
    icon: Mountain,
    inputs: [{ id: 'ref', label: '参考图', type: 'image' }],
    outputs: [{ id: 'out', label: '场景', type: 'json' }],
    params: [
      { key: 'name', label: '场景名', control: 'text', placeholder: '如：咖啡馆' },
      { key: 'description', label: '描述', control: 'textarea', placeholder: '环境、氛围、光线…（用于「运行此节点」文字生成概念图）' },
      { key: 'refPrompt', label: '英文提示词(可选)', control: 'textarea', placeholder: '用于生成的英文 prompt，可留空' },
      { key: 'variant', label: '变体(时段/天气，可选)', control: 'text', placeholder: '如：黄昏 / 雨夜（留空=基础场景板）' },
    ],
  },
  {
    kind: 'prop',
    category: 'input',
    label: '物品',
    desc: '道具/物品资产：按文字生成干净物品图 / 上传图片 / 连「参考图」用素材图生成。输出「物品」(身份+参考图打包)，一根线直连关键帧，按名跨镜一致',
    icon: Box,
    inputs: [{ id: 'ref', label: '参考图', type: 'image' }],
    outputs: [{ id: 'out', label: '物品', type: 'json' }],
    params: [
      { key: 'name', label: '物品名', control: 'text', placeholder: '如：发光的剑' },
      { key: 'description', label: '外观/描述', control: 'textarea', placeholder: '材质、形状、颜色、特征…（用于「运行此节点」文字生成物品图）' },
      { key: 'refPrompt', label: '英文提示词(可选)', control: 'textarea', placeholder: '用于生成的英文 prompt，可留空' },
      { key: 'variant', label: '变体(状态，可选)', control: 'text', placeholder: '如：破损 / 发光 / 完好（留空=基础）' },
      { key: 'size', label: '尺寸', control: 'select', options: ['1024x1024', '768x1024', '1024x768'], default: '1024x1024' },
    ],
  },
  // 全局画风/画幅统一由顶栏 🎨「全局设定」面板（项目级）注入所有生成节点，不再用画布节点。

  // —— 文本 AI ——
  {
    kind: 'outline',
    category: 'text',
    label: '故事大纲',
    desc: '把故事梳理为幕/节拍/角色弧线（Save-the-Cat / Story-Circle）',
    icon: ListTree,
    inputs: [{ id: 'in', label: '故事', type: 'text' }],
    outputs: [{ id: 'out', label: '大纲', type: 'json' }],
    params: [
      { key: 'structure', label: '结构模板', control: 'select', options: ['Save-the-Cat', 'Story-Circle'], default: 'Save-the-Cat' },
      { key: 'instruction', label: '附加要求', control: 'textarea', placeholder: '可选：主题/篇幅/视角…' },
    ],
  },
  {
    kind: 'script-gen',
    category: 'text',
    label: '剧本生成',
    desc: '把故事扩展为分场剧本（场次/对白/动作）',
    icon: PenLine,
    inputs: [{ id: 'in', label: '故事/大纲', type: 'any' }],
    outputs: [{ id: 'out', label: '剧本', type: 'json' }],
    params: [
      { key: 'targetLength', label: '成片体量', control: 'select', options: ['跟随全局', '微短片', '短片', '单集', '长片'], default: '跟随全局' },
      { key: 'sceneCount', label: '目标场数(0=按体量)', control: 'number', default: 0 },
      { key: 'instruction', label: '附加要求', control: 'textarea', placeholder: '可选：风格/篇幅/视角…' },
    ],
  },
  {
    kind: 'storyboard',
    category: 'text',
    label: '分镜脚本',
    desc: '把剧本拆解为镜头表（景别/运镜/时长）',
    icon: Film,
    inputs: [{ id: 'in', label: '剧本', type: 'json' }],
    outputs: [{ id: 'out', label: '分镜', type: 'json' }],
    params: [
      { key: 'shotMode', label: '拆解粒度', control: 'select', options: ['每场N镜', '总量自适应'], default: '每场N镜' },
      { key: 'shotsPerScene', label: '每场镜头数', control: 'number', default: 3 },
      { key: 'maxShots', label: '镜头总数上限(0=不限)', control: 'number', default: 0 },
    ],
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
    label: '角色设定图',
    desc: '由「角色」生成单张 16:9 设定图：左半正面+侧面两个面部特写，右半正/侧/背全身（共 5 视图），纯白背景（一次出图，省钱）。输出仍是「角色」(身份+设定图打包)，直连关键帧',
    icon: Users,
    inputs: [{ id: 'role', label: '角色', type: 'json' }],
    outputs: [{ id: 'out', label: '角色', type: 'json' }],
    params: [{ key: 'size', label: '尺寸', control: 'select', options: ['1344x768', '1280x720', '1024x1024'], default: '1344x768' }],
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
    desc: '由分镜生成镜头首帧；连入的「角色/场景/物品」按名匹配进画做一致性，「参考图」端口的散图直接作为视觉参考',
    icon: Frame,
    inputs: [
      { id: 'shot', label: '分镜/描述', type: 'any' },
      { id: 'chars', label: '角色', type: 'json' },
      { id: 'scene', label: '场景', type: 'json' },
      { id: 'props', label: '物品', type: 'json' },
      { id: 'ref', label: '参考图', type: 'image' },
    ],
    outputs: [{ id: 'out', label: '关键帧', type: 'image' }],
    params: [{ key: 'size', label: '尺寸', control: 'select', options: ['1280x720', '720x1280', '1024x1024'], default: '1280x720' }],
  },
  {
    kind: 'image-edit',
    category: 'image',
    label: '图生图/重绘',
    desc: '把连入的原图按文本指令重绘/风格迁移/局部修改；可连附加参考图（多图条件生成）。原图多张则逐张处理',
    icon: Brush,
    inputs: [
      { id: 'image', label: '原图', type: 'image' },
      { id: 'ref', label: '参考图(可选)', type: 'image' },
      { id: 'prompt', label: '指令(可选)', type: 'text' },
    ],
    outputs: [{ id: 'out', label: '图片', type: 'image' }],
    params: [{ key: 'instruction', label: '编辑指令', control: 'textarea', placeholder: '如：改成赛博朋克夜景 / 把外套改成红色（也可连「指令」文本口）' }],
  },
  {
    kind: 'upscale',
    category: 'image',
    label: '高清重绘',
    desc: '把连入的图按原内容/构图重绘并增强细节、提升清晰度（经图像模型重绘，非纯像素放大）。多张逐张处理',
    icon: ZoomIn,
    inputs: [{ id: 'image', label: '原图', type: 'image' }],
    outputs: [{ id: 'out', label: '高清图', type: 'image' }],
    params: [{ key: 'instruction', label: '增强提示(可选)', control: 'text', placeholder: '可留空；如：保留线条、提升材质细节' }],
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
      { id: 'shot', label: '分镜(可选)', type: 'json' },
      { id: 'refVideo', label: '参考视频(可选)', type: 'video' },
      { id: 'refAudio', label: '参考音频/配乐(可选)', type: 'audio' },
    ],
    outputs: [{ id: 'out', label: '视频', type: 'video' }],
    params: [
      { key: 'duration', label: '时长(秒)', control: 'number', default: 5 },
      { key: 'motion', label: '运镜/动作', control: 'textarea', placeholder: '描述画面如何运动…' },
      {
        key: 'audioMode',
        label: '音频',
        control: 'select',
        options: ['无声', '模型自带声', '外置合成'],
        default: '无声',
      },
      {
        key: 'continuity',
        label: '镜头顺接',
        control: 'select',
        // 顺接：让上一镜的尾帧=下一镜的首帧（首尾帧补间），消除割裂感。仅在「连贯动作」处接，硬切处不接。
        // 默认开：配合关键帧链式生成（承接镜头由上一帧派生），同段相邻片段无缝衔接、不再诡异扭曲。
        options: ['关闭', '连贯镜头尾接首'],
        default: '连贯镜头尾接首',
      },
      // seed 锁定：>0 时整段片段共用同一 seed，跨片段风格/运动更一致（0=随机，供应商不支持则忽略）
      { key: 'seed', label: '随机种子(0=随机)', control: 'number', default: 0 },
    ],
  },
  {
    kind: 't2v',
    category: 'video',
    label: '文生视频',
    desc: '由文本直接生成视频片段',
    icon: Video,
    inputs: [
      { id: 'in', label: '提示', type: 'text' },
      { id: 'shot', label: '分镜(可选)', type: 'json' },
    ],
    outputs: [{ id: 'out', label: '视频', type: 'video' }],
    params: [
      { key: 'duration', label: '时长(秒)', control: 'number', default: 5 },
      {
        key: 'audioMode',
        label: '音频',
        control: 'select',
        options: ['无声', '模型自带声', '外置合成'],
        default: '无声',
      },
      { key: 'seed', label: '随机种子(0=随机)', control: 'number', default: 0 },
    ],
  },
  {
    kind: 'lipsync',
    category: 'video',
    label: '口型同步',
    desc: '把对白音频驱动到无声视频/静帧的口型（Sync.so / Wav2Lip / Runway Act-Two；需 lipsync 能力供应商）',
    icon: Mic,
    inputs: [
      { id: 'video', label: '视频/静帧', type: 'video' },
      { id: 'audio', label: '对白音频', type: 'audio' },
    ],
    outputs: [{ id: 'out', label: '口型视频', type: 'video' }],
    params: [{ key: 'providerOverride', label: '供应商(可选)', control: 'text', placeholder: '留空用默认 lipsync 供应商' }],
  },

  // —— 音频 ——
  {
    kind: 'tts',
    category: 'audio',
    label: '配音 (TTS)',
    desc: '由文本合成旁白/配音（语音供应商在「模型供应商」面板统一配置）',
    icon: Mic,
    inputs: [
      { id: 'in', label: '文本', type: 'text' },
      { id: 'dialogues', label: '对白(分场)', type: 'json' },
      { id: 'chars', label: '角色(voiceId)', type: 'json' },
    ],
    outputs: [{ id: 'out', label: '音频', type: 'audio' }],
    params: [
      { key: 'text', label: '配音文本', control: 'textarea', placeholder: '可留空，改为连接上游文本' },
      { key: 'model', label: '模型(可选覆盖)', control: 'text', placeholder: '留空用供应商默认，如 tts-1' },
      { key: 'voice', label: '音色', control: 'select', options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'], default: 'alloy' },
      { key: 'speed', label: '语速', control: 'number', default: 1 },
    ],
  },
  {
    kind: 'bgm',
    category: 'audio',
    label: '配乐 (BGM)',
    desc: '按文本描述生成背景音乐，接入合成节点做配乐。复用异步供应商框架（需 music-capable 供应商，推荐 custom-http 音乐端点）',
    icon: Music2,
    inputs: [{ id: 'in', label: '描述/风格', type: 'text' }],
    outputs: [{ id: 'out', label: '音乐', type: 'audio' }],
    params: [
      { key: 'prompt', label: '音乐描述', control: 'textarea', placeholder: '如：舒缓钢琴、紧张鼓点、史诗管弦…（也可连上游文本）' },
      { key: 'duration', label: '时长(秒)', control: 'number', default: 15 },
    ],
  },
  {
    kind: 'sfx',
    category: 'audio',
    label: '音效 (SFX)',
    desc: '由分镜的 sfx/ambient 字段按镜头扇出生成音效片段，接入合成节点（复用 music-capable 供应商）',
    icon: Music,
    inputs: [{ id: 'shots', label: '分镜', type: 'json' }],
    outputs: [{ id: 'out', label: '音效', type: 'audio' }],
    params: [{ key: 'duration', label: '时长(秒)', control: 'number', default: 3 }],
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
    kind: 'merge',
    category: 'output',
    label: '合并/收集',
    desc: '把多路同类产物（视频/图/音频）收集为一组：顺序拼接 / 按下标配对(zip) / 按 charId·name·key 对齐(by-key)',
    icon: Combine,
    inputs: [{ id: 'in', label: '多路输入', type: 'any' }],
    outputs: [{ id: 'out', label: '合集', type: 'any' }],
    params: [{ key: 'mode', label: '合并方式', control: 'select', options: ['concat', 'zip', 'by-key'], default: 'concat' }],
  },
  {
    kind: 'foreach',
    category: 'output',
    label: '逐项展开',
    desc: '把 json 数组（如 shots/scenes）或合集物化成多项 items[]，逐项喂给下游（显式扇出，不引入循环边）',
    icon: ListTree,
    inputs: [{ id: 'in', label: '数组/合集', type: 'any' }],
    outputs: [{ id: 'item', label: '每项', type: 'any' }],
    params: [{ key: 'arrayKey', label: '数组字段', control: 'text', placeholder: 'json 数组字段名，如 shots/scenes（留空=用 items[]）' }],
  },
  {
    kind: 'timeline',
    category: 'output',
    label: '时间线',
    desc: '把片段+分镜排成可编辑 EDL（顺序/时长/分镜关联）；直连合成节点即按此拼接（音频轨为元数据，仍走合成的音频口）',
    icon: Layers,
    inputs: [
      { id: 'clips', label: '视频片段', type: 'video' },
      { id: 'shots', label: '分镜', type: 'json' },
      { id: 'audio', label: '配音/音乐', type: 'audio' },
    ],
    outputs: [{ id: 'out', label: 'EDL', type: 'any' }],
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
      // 默认「淡入淡出」=整片首尾淡黑场（不在每个镜间加溶解），片间仍是干净硬切，不破坏顺接的无缝衔接，又有成片的开合感。
      // 想每镜都溶解可选「交叉淡化」（注意会软化连贯片段的无缝接点）。
      { key: 'transition', label: '转场', control: 'select', options: ['无转场', '交叉淡化', '淡入淡出'], default: '淡入淡出' },
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
