/**
 * 工作流模板（M6，M14–M20 重构）：预置常用流水线，一键载入为新工程。
 * 声明式定义节点（kind + 位置 + 参数覆盖）与连线（按节点下标 + 端口）；
 * instantiateTemplate 据此生成带新 id 的 FilmNode/Edge（默认参数取自 nodeDefs）。
 *
 * 模板覆盖当前节点体系：大纲(outline)、逐角色配音(tts dialogues/chars)、按场扇出(foreach)、
 * 角色三视图一致性、字幕、转场等。画风/画幅由顶栏「全局设定」统一注入所有生成节点。
 */
import { nanoid } from 'nanoid'
import type { Edge } from '@xyflow/react'
import { getNodeDef } from './nodes/nodeDefs'
import type { FilmNode } from './store/graphStore'

export interface TemplateNode {
  kind: string
  x: number
  y: number
  params?: Record<string, unknown>
}
export interface TemplateEdge {
  from: number
  fromHandle?: string // 默认 'out'
  to: number
  toHandle: string
}
export interface WorkflowTemplate {
  id: string
  name: string
  desc: string
  nodes: TemplateNode[]
  edges: TemplateEdge[]
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'quick-micro',
    name: '微短片速测（≈4 镜 · 最快出片）',
    desc: '一句话故事 → 剧本(微短片·1-2场) → 分镜(约3-5镜) → 角色三视图 → 关键帧 → 图生视频(原生台词+顺接) → 预览。跳过大纲，最省最快，用于快速验证效果（也可在「全局设定」把成片体量设为微短片，让任意流水线都出小片）。',
    nodes: [
      { kind: 'story', x: 60, y: 220 },
      { kind: 'script-gen', x: 320, y: 220, params: { targetLength: '微短片' } },
      { kind: 'storyboard', x: 580, y: 120 },
      { kind: 'char-sheet', x: 580, y: 380 },
      { kind: 'char-image', x: 820, y: 380 },
      { kind: 'keyframe', x: 840, y: 120 },
      { kind: 'i2v', x: 1080, y: 120, params: { audioMode: '模型自带声', continuity: '连贯镜头尾接首' } },
      { kind: 'preview', x: 1320, y: 120 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'in' }, // story → script-gen（微短片，无需大纲）
      { from: 1, to: 2, toHandle: 'in' }, // script → storyboard
      { from: 1, to: 3, toHandle: 'in' }, // script → char-sheet
      { from: 3, to: 4, toHandle: 'role' }, // char-sheet → char-image
      { from: 3, to: 5, toHandle: 'chars' }, // char-sheet → keyframe.chars
      { from: 4, to: 5, toHandle: 'ref' }, // char-image → keyframe.ref
      { from: 2, to: 5, toHandle: 'shot' }, // storyboard → keyframe
      { from: 5, to: 6, toHandle: 'frame' }, // keyframe → i2v
      { from: 6, to: 7, toHandle: 'in' }, // i2v → preview
    ],
  },
  {
    id: 'text-to-storyboard',
    name: '故事 → 分镜（文本预览）',
    desc: '一句话故事 → 大纲(节拍) → 剧本 → 分镜镜头表，纯文本快速预览结构（不出图，最省）',
    nodes: [
      { kind: 'story', x: 60, y: 200 },
      { kind: 'outline', x: 320, y: 200 },
      { kind: 'script-gen', x: 580, y: 200 },
      { kind: 'storyboard', x: 840, y: 200 },
      { kind: 'preview', x: 1100, y: 200 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'in' }, // story → outline
      { from: 1, to: 2, toHandle: 'in' }, // outline → script-gen（按节拍铺场，scene 带 actId/beatId）
      { from: 2, to: 3, toHandle: 'in' }, // script-gen → storyboard
      { from: 3, to: 4, toHandle: 'in' }, // storyboard → preview
    ],
  },
  {
    id: 'full-pipeline',
    name: '完整影视流水线（结构化 + 一致性 + 配音 + 字幕）',
    desc: '故事→大纲→剧本→分镜(可产段落 segments)→角色设定(自动按时期拆变体)/逐变体三视图+场景概念图→关键帧(按 charId+时期变体精确取图，跨镜一致)→图生视频→逐角色配音→合成→导出',
    nodes: [
      { kind: 'story', x: 40, y: 320 },
      { kind: 'outline', x: 260, y: 320 },
      { kind: 'script-gen', x: 480, y: 320 },
      { kind: 'storyboard', x: 720, y: 140 },
      { kind: 'char-sheet', x: 720, y: 440 },
      { kind: 'char-image', x: 960, y: 440 },
      { kind: 'scene-image', x: 960, y: 620 },
      { kind: 'keyframe', x: 1000, y: 140 },
      { kind: 'i2v', x: 1240, y: 140, params: { audioMode: '模型自带声', continuity: '连贯镜头尾接首' } },
      { kind: 'tts', x: 1240, y: 440 },
      { kind: 'compose', x: 1480, y: 320, params: { subtitleMode: '烧录字幕', transition: '淡入淡出' } },
      { kind: 'export', x: 1720, y: 320 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'in' }, // story → outline
      { from: 1, to: 2, toHandle: 'in' }, // outline → script-gen（节拍铺场）
      { from: 2, to: 3, toHandle: 'in' }, // script-gen → storyboard
      { from: 2, to: 4, toHandle: 'in' }, // script-gen → char-sheet（提炼角色 + 弧线）
      { from: 2, to: 6, toHandle: 'in' }, // script-gen → scene-image（按地点出场景概念图/master plate）
      { from: 3, to: 7, toHandle: 'shot' }, // storyboard → keyframe（按镜头扇出）
      { from: 4, to: 5, toHandle: 'role' }, // char-sheet → char-image（每角色三视图）
      { from: 4, to: 7, toHandle: 'chars' }, // char-sheet → keyframe.chars（名称匹配 + 此刻状态注入）
      { from: 5, to: 7, toHandle: 'ref' }, // char-image → keyframe.ref（人物参考图，跨镜一致）
      { from: 6, to: 7, toHandle: 'ref' }, // scene-image → keyframe.ref（场景参考图，按地点一致）
      { from: 7, to: 8, toHandle: 'frame' }, // keyframe → i2v（按关键帧扇出）
      { from: 8, to: 10, toHandle: 'clips' }, // i2v → compose
      { from: 2, to: 9, toHandle: 'dialogues' }, // script-gen → tts.dialogues（逐角色对白配音）
      { from: 4, to: 9, toHandle: 'chars' }, // char-sheet → tts.chars（音色映射）
      { from: 9, to: 10, toHandle: 'audio' }, // tts → compose.audio
      { from: 3, to: 10, toHandle: 'subs' }, // storyboard → compose 字幕
      { from: 10, to: 11, toHandle: 'in' }, // compose → export
    ],
  },
  {
    id: 'complex-script',
    name: '复杂剧本 · 按场扇出（长片不丢后半段 + 一致性）',
    desc: '故事→大纲→长片剧本→ForEach 按场拆分镜(每场独立生成再合并，storyboard 可设镜头总数上限防爆炸)；角色(按时期拆变体)三视图+场景概念图全局生成一次，关键帧据此跨镜保持人物(对期)/场景一致',
    nodes: [
      { kind: 'story', x: 40, y: 300 },
      { kind: 'outline', x: 260, y: 300 },
      { kind: 'script-gen', x: 480, y: 300, params: { targetLength: '长片' } },
      { kind: 'foreach', x: 720, y: 160, params: { arrayKey: 'scenes' } },
      { kind: 'storyboard', x: 940, y: 160 },
      { kind: 'char-sheet', x: 720, y: 460 },
      { kind: 'char-image', x: 960, y: 460 },
      { kind: 'scene-image', x: 960, y: 620 },
      { kind: 'keyframe', x: 1200, y: 160 },
      { kind: 'i2v', x: 1440, y: 160 },
      { kind: 'compose', x: 1680, y: 300, params: { subtitleMode: '烧录字幕' } },
      { kind: 'export', x: 1920, y: 300 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'in' }, // story → outline
      { from: 1, to: 2, toHandle: 'in' }, // outline → script-gen（长片，按节拍铺多场）
      { from: 2, to: 3, toHandle: 'in' }, // script-gen → foreach（把 scenes[] 物化成逐场 items）
      { from: 3, fromHandle: 'item', to: 4, toHandle: 'in' }, // foreach.item → storyboard（每场独立调用，合并 shots，不丢后半段）
      { from: 2, to: 5, toHandle: 'in' }, // script-gen(整剧本) → char-sheet（一次性提炼全部角色）
      { from: 5, to: 6, toHandle: 'role' }, // char-sheet → char-image（每角色三视图）
      { from: 2, to: 7, toHandle: 'in' }, // script-gen(整剧本) → scene-image（按地点出场景概念图）
      { from: 5, to: 8, toHandle: 'chars' }, // char-sheet → keyframe.chars（名称匹配 + 弧线状态）
      { from: 6, to: 8, toHandle: 'ref' }, // char-image → keyframe.ref（人物参考，跨镜一致）
      { from: 7, to: 8, toHandle: 'ref' }, // scene-image → keyframe.ref（场景参考，按地点一致）
      { from: 4, to: 8, toHandle: 'shot' }, // storyboard(合并后) → keyframe（按镜头扇出）
      { from: 8, to: 9, toHandle: 'frame' }, // keyframe → i2v
      { from: 9, to: 10, toHandle: 'clips' }, // i2v → compose
      { from: 4, to: 10, toHandle: 'subs' }, // storyboard → compose 字幕
      { from: 10, to: 11, toHandle: 'in' }, // compose → export
    ],
  },
  {
    id: 'character-variants',
    name: '角色跨时期一致性（少年→盛年→暮年）',
    desc: '故事跨越人物多个时期→角色设定自动按时期拆形态变体(variants)→角色三视图逐变体生成→分镜按段落/节拍选对应时期的角色图，杜绝"不同时期合到一张图/取错期"。需选「全局设定」风格包效果更佳。',
    nodes: [
      { kind: 'story', x: 40, y: 300, params: { text: '一个剑客的一生：少年时清瘦、布衣，拜师学艺；盛年时蓄须、玄铁战甲，成为征战的将军；暮年时白发、素袍，归隐山林。' } },
      { kind: 'outline', x: 260, y: 300 },
      { kind: 'script-gen', x: 480, y: 300 },
      { kind: 'storyboard', x: 720, y: 140 },
      { kind: 'char-sheet', x: 720, y: 460 },
      { kind: 'char-image', x: 980, y: 460 },
      { kind: 'keyframe', x: 1000, y: 140 },
      { kind: 'i2v', x: 1240, y: 140, params: { audioMode: '模型自带声', continuity: '连贯镜头尾接首' } },
      { kind: 'preview', x: 1480, y: 140 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'in' }, // story → outline（节拍，供变体 appliesTo 对齐）
      { from: 1, to: 2, toHandle: 'in' }, // outline → script-gen
      { from: 2, to: 3, toHandle: 'in' }, // script-gen → storyboard（可产 segments + 各段 activeVariants）
      { from: 2, to: 4, toHandle: 'in' }, // script-gen → char-sheet（自动按时期拆 variants）
      { from: 4, to: 5, toHandle: 'role' }, // char-sheet → char-image（每 角色×变体 一组三视图）
      { from: 4, to: 6, toHandle: 'chars' }, // char-sheet → keyframe.chars（解析本镜该用哪个时期变体）
      { from: 5, to: 6, toHandle: 'ref' }, // char-image → keyframe.ref（按 charId+variantId 精确取该期图）
      { from: 3, to: 6, toHandle: 'shot' }, // storyboard → keyframe（按镜头扇出）
      { from: 6, to: 7, toHandle: 'frame' }, // keyframe → i2v
      { from: 7, to: 8, toHandle: 'in' }, // i2v → preview
    ],
  },
  {
    id: 'assets-to-keyframe',
    name: '素材 → 三视图 → 关键帧（人物/场景/物品一致性）',
    desc: '「人物」三视图(img2img 自洽) + 「场景」概念图 + 「物品」参考图，按名/地点匹配喂关键帧，跨镜保持人物·场景·道具一致',
    nodes: [
      { kind: 'character', x: 60, y: 100, params: { name: '主角', appearance: '少年，黑色短发，深蓝色风衣', voiceId: 'onyx' } },
      { kind: 'scene', x: 60, y: 360, params: { name: '霓虹街道', description: '夜晚雨后的赛博朋克街道，霓虹倒影' } },
      { kind: 'prop', x: 60, y: 600, params: { name: '圣剑', description: '一把发光的蓝色长剑，剑刃刻有符文' } },
      { kind: 'text', x: 60, y: 840, params: { text: '主角举起圣剑站在霓虹街道上回望，电影感中景' } },
      { kind: 'char-image', x: 360, y: 100 },
      { kind: 'keyframe', x: 700, y: 380 },
      { kind: 'preview', x: 1020, y: 380 },
    ],
    edges: [
      { from: 0, fromHandle: 'out', to: 4, toHandle: 'role' }, // 人物身份 → char-image.role
      { from: 0, fromHandle: 'image', to: 4, toHandle: 'ref' }, // 人物参考图 → char-image.ref（img2img 锚定，三视图自洽）
      { from: 4, to: 5, toHandle: 'ref' }, // 三视图 → keyframe.ref（跨镜一致）
      { from: 0, fromHandle: 'out', to: 5, toHandle: 'chars' }, // 人物身份(含 charId/voiceId) → keyframe.chars
      { from: 1, fromHandle: 'image', to: 5, toHandle: 'ref' }, // 场景参考图 → keyframe.ref（按地点匹配）
      { from: 2, fromHandle: 'out', to: 5, toHandle: 'props' }, // 物品身份 → keyframe.props（名称匹配 + 提示）
      { from: 2, fromHandle: 'image', to: 5, toHandle: 'ref' }, // 物品参考图 → keyframe.ref（按物品名匹配）
      { from: 3, to: 5, toHandle: 'shot' }, // 文本镜头描述 → keyframe.shot
      { from: 5, to: 6, toHandle: 'in' }, // keyframe → preview
    ],
  },
  {
    id: 'clips-to-film',
    name: '片段 → 成片（配乐 + 转场）',
    desc: '参考图生视频 + 本地配乐，淡入淡出转场合成并导出成片',
    nodes: [
      { kind: 'image-input', x: 60, y: 120 },
      { kind: 'i2v', x: 360, y: 120 },
      { kind: 'audio-input', x: 60, y: 360 },
      { kind: 'compose', x: 660, y: 220, params: { transition: '淡入淡出' } },
      { kind: 'export', x: 960, y: 220 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'frame' }, // 参考图 → i2v 首帧
      { from: 1, to: 3, toHandle: 'clips' }, // i2v → compose
      { from: 2, to: 3, toHandle: 'audio' }, // 本地配乐 → compose.audio
      { from: 3, to: 4, toHandle: 'in' }, // compose → export
    ],
  },
]

/** 把模板实例化为可直接放入 store 的 nodes/edges（新 id、默认参数 + 覆盖） */
export function instantiateTemplate(tpl: WorkflowTemplate): { nodes: FilmNode[]; edges: Edge[] } {
  const ids = tpl.nodes.map(() => `n_${nanoid(6)}`)
  const nodes: FilmNode[] = tpl.nodes.map((tn, i) => {
    const def = getNodeDef(tn.kind)
    const params: Record<string, unknown> = {}
    if (def) for (const p of def.params) if (p.default !== undefined) params[p.key] = p.default
    Object.assign(params, tn.params || {})
    return {
      id: ids[i],
      type: 'film',
      position: { x: tn.x, y: tn.y },
      data: { kind: tn.kind, title: def?.label || tn.kind, params, status: 'idle' },
    }
  })
  const edges: Edge[] = tpl.edges.map((e, i) => ({
    id: `e_${nanoid(6)}_${i}`,
    source: ids[e.from],
    sourceHandle: e.fromHandle || 'out',
    target: ids[e.to],
    targetHandle: e.toHandle,
    type: 'default',
    animated: false,
  }))
  return { nodes, edges }
}
