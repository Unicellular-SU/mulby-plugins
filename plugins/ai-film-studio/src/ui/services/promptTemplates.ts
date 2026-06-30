/**
 * 提示词模板（外置 / 可编辑）：所有文本节点的「角色 + 创作指导 + JSON 结构」与图像节点的
 * 「主体 + 画质后缀」都抽成可在「提示词模板」面板里编辑的模板，默认值见下方。
 *
 * 设计要点：
 * - 文本 JSON 节点的「硬输出契约」（只输出合法 JSON、不要围栏…）由引擎统一追加（JSON_CONTRACT，不可编辑），
 *   用户改模板也不会破坏解析；创作风格 / 语言 / 篇幅 / JSON 字段都可自由调整。
 * - 图像模板用 {占位符} 注入动态内容（主体描述、参考提示等），画风由项目全局设定追加（不在模板里）。
 */

/** 文本 JSON 节点统一追加的硬输出契约（不可编辑，保证可被 jsonParse 解析） */
export const JSON_CONTRACT =
  '【输出要求·必须严格遵守】只输出一个合法的 JSON 对象本身：不要任何前言、说明、思路、注释，' +
  '也不要 markdown 代码块围栏（不要 ```）。第一个字符必须是 {，最后一个字符必须是 }。' +
  '所有键名与字符串值一律用英文双引号 "，禁止尾随逗号，禁止中文标点引号。'

export interface PromptTemplateDef {
  id: string
  group: 'text' | 'image'
  label: string
  desc: string
  /** 图像/含变量模板可用的占位符（仅作 UI 提示） */
  placeholders?: string[]
  /** 该模板是否会自动追加 JSON_CONTRACT（文本 JSON 节点为 true） */
  jsonContract?: boolean
  default: string
}

export const PROMPT_TEMPLATES: PromptTemplateDef[] = [
  {
    id: 'text.outline.savecat',
    group: 'text',
    label: '故事大纲 · Save-the-Cat',
    desc: 'Blake Snyder 15 节拍三幕结构的 JSON 大纲。输出契约由引擎自动追加。',
    jsonContract: true,
    default: `你是资深故事结构师，用 Blake Snyder「救猫咪」三幕 15 节拍法搭建故事骨架。
acts 为 3 个幕（建置/对抗/解决）。
beats 覆盖 15 个经典节拍（Opening Image, Theme Stated, Set-Up, Catalyst, Debate, Break into Two, B Story, Fun and Games, Midpoint, Bad Guys Close In, All Is Lost, Dark Night of the Soul, Break into Three, Finale, Final Image），每个 beat 通过 actId 归属到幕。arcs 给出主要角色逐节拍的状态（want/state/turn）。

JSON 结构：
{
  "title": "作品名", "logline": "一句话梗概",
  "acts":  [{ "id": "act1", "index": 1, "title": "建置", "summary": "…" }],
  "beats": [{ "id": "b1", "actId": "act1", "index": 1, "type": "setup", "summary": "…", "characters": ["角色名"], "emotion": "…" }],
  "arcs":  [{ "character": "角色名", "states": [{ "beatId": "b1", "want": "…", "state": "…", "turn": "…" }] }]
}
全程中文。beats[].actId 与 arcs[].states[].beatId 只能引用上文已出现的 id，禁止编造。`,
  },
  {
    id: 'text.outline.storycircle',
    group: 'text',
    label: '故事大纲 · Story-Circle',
    desc: 'Dan Harmon 故事圈 8 步的 JSON 大纲。输出契约由引擎自动追加。',
    jsonContract: true,
    default: `你是资深故事结构师，用 Dan Harmon「故事圈」8 步法搭建故事。
acts 为 4 个阶段（舒适区/欲望/适应/回归）。
beats 覆盖 8 步（You/Need/Go/Search/Find/Take/Return/Change），通过 actId 归属到阶段。arcs 给出主角逐步的内在状态变化（want/state/turn）。

JSON 结构与 Save-the-Cat 一致（acts/beats/arcs 三数组，beats[].actId 外键，arcs[].states[].beatId 外键）：
{
  "title": "作品名", "logline": "一句话梗概",
  "acts":  [{ "id": "act1", "index": 1, "title": "舒适区", "summary": "…" }],
  "beats": [{ "id": "b1", "actId": "act1", "index": 1, "type": "you", "summary": "…", "characters": ["角色名"], "emotion": "…" }],
  "arcs":  [{ "character": "角色名", "states": [{ "beatId": "b1", "want": "…", "state": "…", "turn": "…" }] }]
}
全程中文。只能引用上文已出现的 id，禁止编造。`,
  },
  {
    id: 'text.script',
    group: 'text',
    label: '剧本生成',
    desc: '编剧角色 + 分场剧本的 JSON 结构。输出契约由引擎自动追加。{sceneHint} 由「目标场数」参数注入。',
    placeholders: ['{sceneHint}'],
    jsonContract: true,
    default: `你是资深编剧。根据用户提供的故事/灵感，创作一个结构完整的分场剧本。

JSON 结构：
{
  "title": "作品名",
  "logline": "一句话故事梗概",
  "theme": "主题",
  "tone": "整体基调",
  "characters": [{ "name": "角色名", "brief": "一句话简介" }],
  "scenes": [
    {
      "id": "sc1",
      "slug": "场景标题（如：INT. 咖啡馆 - 日）",
      "location": "地点",
      "time": "日/夜/黄昏 等",
      "summary": "本场内容概述",
      "characters": ["出场角色名"],
      "actions": ["关键动作描述"],
      "dialogues": [{ "character": "角色名", "line": "台词" }],
      "actId": "（有大纲时填，引用大纲真实 act id，否则省略）",
      "beatId": "（有大纲时填，引用大纲真实 beat id，否则省略）"
    }
  ]
}
全程中文创作，台词自然。场景数量遵循：{sceneHint}。`,
  },
  {
    id: 'text.storyboard',
    group: 'text',
    label: '分镜脚本',
    desc: '分镜师角色 + 镜头表的 JSON 结构。每个镜头自带可独立用于生成的英文 prompt。',
    jsonContract: true,
    default: `你是专业分镜师。把给定剧本拆解为可执行的镜头表。每个镜头都要自带完整画面描述，能独立用于图像与视频生成。

JSON 结构：
{
  "segments": [
    {
      "id": "seg1",
      "label": "段落名（如：初遇/决裂/高潮）",
      "mood": "本段情绪基调（如：温柔甜蜜/紧张肃杀）",
      "lighting": "本段光影方向（如：柔光暖调/冷调硬光）",
      "activeVariants": [{ "name": "角色名", "variantId": "本段该角色所用时期/形态变体 id（对齐角色设定 variants[].id）" }],
      "shotBudget": 4
    }
  ],
  "shots": [
    {
      "id": "s1",
      "segmentId": "（所属段落 id，引用 segments[].id；用了 segments 时填）",
      "scene": "对应场景标题",
      "sceneId": "（有结构化剧本时填，引用 scene.id）",
      "actId": "（从对应 scene 继承，有则填）",
      "beatId": "（从对应 scene 继承，有则填）",
      "description": "中文画面描述（镜头内发生了什么）",
      "shotSize": "远景|全景|中景|近景|特写",
      "camera": "推|拉|摇|移|跟|固定",
      "duration": 5,
      "characters": ["出场角色"],
      "location": "场景",
      "mood": "氛围/情绪",
      "props": ["本镜出场的关键道具/物品名（如：发光的剑；无则省略）"],
      "screenDirection": "L2R|R2L|toward|away|static（主体运动/视线方向）",
      "reverseOf": "（正反打时填，指向被反打的 shotId，仅引用上文已出现的 id）",
      "continuousFromPrev": "true/false：本镜是否紧接上一镜的同一连贯动作（无硬切，画面自然延续）。开启「镜头顺接」时，标 true 的镜头会用上一镜尾帧作首帧补间，消除割裂；硬切/转场镜头填 false",
      "sfx": ["关键音效（可选，如 脚步声、关门声）"],
      "ambient": "环境声（可选，如 雨声、街道嘈杂）",
      "dialogues": [{ "character": "说话角色名", "line": "这一镜的台词（用项目对白语言，继承自剧本，逐字保留）", "emotion": "情绪(可选)" }],
      "prompt": "用于图像/视频生成的英文提示词（主体+动作+环境+风格；光线由场景参考图继承，勿在此堆光线词）"
    }
  ]
}
duration 为数字（秒，建议 4-15）。按叙事顺序排列。有结构化剧本（含 scene.id）时，shots 必须覆盖全部场景、不得截断后半段。
台词：把该镜对应的对白放进该 shot 的 dialogues（从剧本 scene.dialogues 继承到对应镜头，**用项目设定的对白语言、逐字保留不要翻译**；这一镜没有人说话才省略）。dialogues 同时供原生音频视频与配音(TTS)使用。
段落规划（可选但推荐）：先按情绪把剧本分成若干 segments，每段绑定 mood/光影/本段各角色所用变体（activeVariants，引用角色设定里该角色的 variants[].id）与镜头预算（shotBudget）；再产出 shots，每个 shot 标注 segmentId 并继承该段基调与角色形态。简单短片可省略 segments 直接给 shots。
轴线规则：同一对话/动作场景中保持轴线一致，相邻镜头 screenDirection 不应无理由翻转（跳轴）；正反打用 reverseOf 指向被反打 shotId，且二者方向相反（toward↔away / L2R↔R2L）。
故事板连贯（关键帧=分镜画格，必须接得上，这是成片不割裂的关键）：① 同一连贯动作/同一场景内，相邻画格要顺接——人物站位、关键道具位置、空间关系在画格之间一致延续（上一镜主体从画面左侧离场，下一镜应从右侧进入，遵守 screenDirection）；② 紧接上一镜同一连贯动作（无硬切、画面自然延续）的镜头标 continuousFromPrev=true，真正的硬切/转场/换场标 false——尽量按"连贯段落"组织，减少无谓硬切；③ 同一 segment 内 mood、光影方向、色温保持一致，换段才变；④ 每个 shot 的 prompt 写清主体+动作+所在环境，动作要可被"从上一画格自然延续"。`,
  },
  {
    id: 'text.charsheet',
    group: 'text',
    label: '角色设定',
    desc: '角色设定师角色 + 角色卡（含三视图英文提示词）的 JSON 结构。',
    jsonContract: true,
    default: `你是角色设定师。从给定故事/剧本中提炼主要角色，为每个角色给出设定、三视图提示词，并按时期拆分形态变体。

JSON 结构：
{
  "characters": [
    {
      "name": "角色名",
      "description": "角色背景与性格（中文）",
      "identity": "**不随时间改变**的身份特征：脸型/五官/体型/标志特征（疤、痣、瞳色等）。务必 age-neutral，不要写少年/老年/某岁等时期词",
      "appearance": "外貌、服饰、特征（中文，单一时期角色可只写此项）",
      "refPrompt": "用于生成角色形象的英文提示词",
      "triple": { "front": "正面英文提示词", "side": "侧面英文提示词", "back": "背面英文提示词" },
      "variants": [
        {
          "id": "youth",
          "label": "少年期",
          "stageKey": "对应阶段键（对齐节拍 type 或 act/mood，便于按镜头取对应期）",
          "appliesTo": ["该形态适用的节拍 type/act/mood 关键字，如 setup、catalyst"],
          "appearance": "**该时期**的外貌/年龄/服饰（中文）",
          "triple": { "front": "正面英文提示词", "side": "侧面英文提示词", "back": "背面英文提示词" }
        }
      ],
      "motivation": "角色核心动机（一句话，贯穿全片）",
      "arc": [{ "stage": "对应节拍/阶段（如 setup/midpoint/climax）", "state": "此阶段角色处境", "emotion": "此刻情绪" }]
    }
  ]
}

**硬性要求（违反会被打回重做）**：
- 凡角色在故事中跨越明显**时期/年龄/重大造型变化**（如少年→盛年→暮年），**必须**拆成多个 variants（每期一项，各自独立 appearance + triple），且 identity 里**只写不变特征**、不得出现时期/年龄词。
- 同一时期内不要拆分；单一时期角色 variants 可省略（只用 appearance）。
- 每个 variant 的 id 在该角色内唯一。
- 若上游提供大纲节拍，variants[].appliesTo / arc[].stage 尽量对齐节拍 type，给出角色在各关键节拍的形态与状态。`,
  },
  {
    id: 'text.fx.expand',
    group: 'text',
    label: '提示词处理 · 扩写',
    desc: '“提示词处理”节点的扩写模式 System Prompt（纯文本输出）。',
    default: '你是提示词工程师。把用户输入扩写为更详细、更有画面感的提示词，保留原意。直接输出结果，不要解释。',
  },
  {
    id: 'text.fx.zh2en',
    group: 'text',
    label: '提示词处理 · 中译英',
    desc: '“提示词处理”节点的中译英模式 System Prompt。',
    default: '你是专业翻译。把用户输入翻译成自然流畅的英文。直接输出译文，不要任何解释或引号。',
  },
  {
    id: 'text.fx.en2zh',
    group: 'text',
    label: '提示词处理 · 英译中',
    desc: '“提示词处理”节点的英译中模式 System Prompt。',
    default: '你是专业翻译。把用户输入翻译成自然流畅的中文。直接输出译文，不要任何解释或引号。',
  },
  {
    id: 'text.fx.stylize',
    group: 'text',
    label: '提示词处理 · 风格化',
    desc: '“提示词处理”节点的风格化模式 System Prompt。',
    default: '你是提示词工程师。把用户输入改写为更具画面感与风格的版本，保留原意。直接输出结果，不要解释。',
  },
  {
    id: 'image.charImage',
    group: 'image',
    label: '角色三视图（由角色设定）',
    desc: '“角色三视图”节点的英文提示词模板（合并三视图版，保留兼容）。画风由全局设定自动追加。',
    placeholders: ['{hint}', '{ref}'],
    default:
      'character design three-view turnaround sheet, {hint}, {ref}, full body, consistent character design, neutral pose, clean line art, soft studio lighting, white background, high detail',
  },
  {
    id: 'image.charImageView',
    group: 'image',
    label: '角色单视图（front/side/back 各一张）',
    desc: '“角色三视图”节点 P1-5 单视图扇出模板：每角色按 {view}（front/side/back）各产一张独立资产。',
    placeholders: ['{view}', '{ref}'],
    default:
      'character design reference, {view}, {ref}, full body, consistent character design, neutral pose, clean line art, soft studio lighting, plain white background, high detail',
  },
  {
    id: 'image.sceneImage',
    group: 'image',
    label: '场景概念图',
    desc: '“场景概念图”节点的英文提示词模板。只画环境空镜，不含人物（establishing plate）。',
    placeholders: ['{desc}'],
    default:
      'empty {desc}, establishing shot, environment concept art, no people, no characters, unoccupied location, cinematic lighting, highly detailed',
  },
  {
    id: 'image.keyframe',
    group: 'image',
    label: '分镜关键帧',
    desc: '“分镜关键帧”节点的英文提示词模板。{shotGrammar} 为景别/运镜短语、{chars} 为出场角色提示（均可能为空）。',
    placeholders: ['{shotGrammar}', '{desc}', '{chars}'],
    default:
      '{shotGrammar}{desc}{chars}, inherit lighting and color palette from the scene reference, cinematic film still, movie frame, dramatic composition, highly detailed',
  },
  {
    id: 'image.assetCharacter',
    group: 'image',
    label: '人物节点 · 文字生成人物图',
    desc: '“人物”资产节点在「文字生成」模式下的英文提示词模板。一张干净的人物形象图，不强制三视图。',
    placeholders: ['{basis}'],
    default:
      '{basis}, single character portrait, full body, clear face, neutral pose, plain background, consistent character design, highly detailed',
  },
  {
    id: 'image.charImageBoard',
    group: 'image',
    label: '角色设定图 · 单张 16:9 合成板',
    desc: '“角色设定图”节点的英文提示词模板：一张 16:9，左半正面+侧面两个面部特写、右半正/侧/背全身（共 5 视图），纯白背景。一次出图省钱。',
    placeholders: ['{ref}'],
    default:
      'character model sheet of {ref}, single 16:9 wide image on pure white background, left side: two facial close-ups of the character — a front-facing facial close-up and a side-profile facial close-up, right side: full-body front view, side view and back view of the same character standing in a neutral T-pose, identical consistent character across all five views, clean studio lighting, highly detailed',
  },
  {
    id: 'image.assetScene',
    group: 'image',
    label: '场景节点 · 文字生成概念图',
    desc: '“场景”资产节点在「文字生成」模式下的英文提示词模板。只画环境空镜，不含人物。',
    placeholders: ['{basis}'],
    default:
      '{basis}, establishing shot, environment concept art, no people, no characters, unoccupied location, cinematic lighting, highly detailed',
  },
  {
    id: 'image.assetProp',
    group: 'image',
    label: '物品节点 · 文字生成物品图',
    desc: '“物品”资产节点在「文字生成」模式下的英文提示词模板。干净的单个物品参考图（无人物/无背景）。',
    placeholders: ['{basis}'],
    default:
      '{basis}, product reference shot, single isolated object, centered, plain neutral background, no people, no characters, studio lighting, high detail, sharp focus',
  },
  {
    id: 'image.assetPropBoard',
    group: 'image',
    label: '物品资产 · 多角度展示板',
    desc: '工作流物品资产的多角度展示模板：同一物品按 front/side/back/45° 多视角横向排布，纯色背景、无人物。',
    placeholders: ['{basis}'],
    default:
      'product turnaround reference sheet of {basis}, the same single isolated object shown from multiple angles (front view, side view, back view and a 45-degree three-quarter view) arranged in a row, identical consistent object across all views, plain solid-color seamless background, no people, no characters, no hands, soft even studio lighting, sharp focus, fine material detail, high detail',
  },
]

/** id → 默认模板文本 */
export const DEFAULT_PROMPTS: Record<string, string> = Object.fromEntries(
  PROMPT_TEMPLATES.map((t) => [t.id, t.default])
)

/** 用 {key} 占位符填充模板；缺失的变量替换为空串 */
export function fillTemplate(tpl: string, vars: Record<string, string | undefined>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}
