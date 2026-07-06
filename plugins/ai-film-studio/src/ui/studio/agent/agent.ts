/**
 * Toonflow 式重构 · 阶段3a：制片 Agent（结构化方案版）。
 *
 * 用宿主 ai.call（经 runText，json 模式）让 LLM 把「一句话/故事/指令」拆成结构化方案
 * （剧本 + 资产 + 分镜），再确定性地应用到 projectStore。注入 agent skill + 项目画风。
 * 先用结构化输出而非原生 tool-loop：可靠、可验收；后续 3b 升级为流式 tool-calling。
 */
import { runText } from '../../services/textEngine'
import { getAgentSkill } from '../../services/skillSystem'
import { getStylePack } from '../../services/stylePacks'
import { useGraphStore } from '../../store/graphStore'
import { recallContext, getMemoryConfig } from './memory'
import { makeProjectReadTools } from './agentTools'
import { resolveAgentEpisodeTarget } from './episodeTarget'
import { PLANNED_HANDOFF_STORYBOARD_RULE } from './policy'
import type { ProjectDoc } from '../../domain/types'
import { cleanAssetAliases } from '../../domain/assetAliases'

export interface AgentPlan {
  reply: string
  script?: { name?: string; content: string }
  assets?: { type: 'role' | 'scene' | 'prop'; name: string; aliases?: string[]; desc?: string; prompt?: string }[]
  storyboards?: {
    videoDesc: string
    prompt?: string
    duration?: number
    sceneId?: string
    ensureScope?: boolean
    scopeKind?: 'episode' | 'scene' | 'storyboard'
    cast?: string[]
    castRefs?: {
      assetId?: string
      assetName?: string
      name?: string
      variantId?: string
      variantLabel?: string
      roleInShot?: 'lead' | 'supporting' | 'background'
      note?: string
    }[]
    dialogues?: { character: string; line: string; emotion?: string }[]
    chainFromPrev?: boolean
    replaceIndex?: number
  }[]
  /** 用户明确要求「出图/生成/成片」时为 true：应用方案后自动一键成片 */
  autoGenerate?: boolean
}

const CONTRACT = `
你必须**只输出一个 JSON 对象**（不要任何额外文字、解释或 markdown 代码块围栏），结构如下：
{
  "reply": "给用户的简短中文说明（你做了什么、下一步建议）",
  "script": { "name": "剧本名", "content": "剧本正文（分场/对白/动作）" },
  "assets": [ { "type": "role|scene|prop", "name": "名称", "aliases": ["别名/称谓"], "desc": "中文外貌/特征描述", "prompt": "英文图像生成提示词" } ],
  "storyboards": [ { "videoDesc": "中文画面描述：主体+动作+环境+情绪+光影", "prompt": "英文关键帧提示词", "duration": 5, "sceneId": "同一空间/连续动作的稳定场景组ID(可选)", "ensureScope": false, "scopeKind": "episode|scene|storyboard(可选)", "cast": ["出场资产名"], "castRefs": [{"assetName":"资产名","variantLabel":"妆容/服装/时期(可选)","roleInShot":"lead|supporting|background","note":"可选说明"}], "dialogues": [{"character":"出场角色名 或 旁白", "line":"台词原文", "emotion":"情绪(可选)"}], "chainFromPrev": false, "replaceIndex": 0 } ],
  "autoGenerate": false   // 仅当用户明确要求「出图/生成/直接成片」时设 true，自动一键成片
}
规则：
- 字段都可选；本轮只产出用户要求的部分，**已存在的内容不要重复**（按名字去重）。
- assets 的 name 要与 storyboards 的 cast 名字一致，便于关联；同一个人/场景有昵称、称谓或原著别称时写入 aliases，后续分镜可用别名匹配同一资产；同一角色有妆容/服装/年龄/时期变体时，在 castRefs 里写 assetName + variantLabel，不要只写进画面描述。
- 如果上下文、连续性报告或跨集承接线索显示某角色在上一相关剧集使用过具体变体，或本集已有适用变体，分镜必须用 castRefs 绑定 variantLabel/variantId；除非剧情明确恢复默认状态，不要只写 cast 让它回到主形象。
- 当分镜为了沿用上一形态或使用场景/分镜级形态而绑定了已有 variant 时，设置 ensureScope=true；若已写 sceneId，优先 scopeKind="scene"，只适用于单镜时用 "storyboard"，整集都适用时用 "episode"。
- **对白**：把该镜涉及的台词逐句填进 dialogues；character 必须是出场角色名（与 cast/资产名一致）或"旁白"；line 为台词原文，emotion 可选；该镜无台词则省略 dialogues 或给空数组。
- 分镜按叙事顺序排列；同一空间或连续动作的镜头写稳定 sceneId，用于同场景资产和角色形态一致性检查；替换已有分镜且发生换场时必须写新的 sceneId，确实不属于任何场景组时可写空字符串清除旧 sceneId；紧接上一镜「同一连贯动作/同场不切」的镜头 chainFromPrev=true（关键帧会承接上一帧保持连贯），真正硬切/换场=false。
- **修改已有分镜**：要改第 N 个已有分镜，就在该 storyboard 里带 replaceIndex=N（用上面「已有分镜」列表里的编号，从 1 开始），它会就地替换（关键帧会失效需重生）；新增镜头不要带 replaceIndex。
- 全程使用项目设定的画风与对白语言。`

function stripJsonEnvelope(raw: string): string {
  const trimmed = (raw || '').trim()
  let s = trimmed
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
  if (fence) s = fence[1].trim()
  return s
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  let s = stripJsonEnvelope(raw)
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  if (!s || s[0] !== '{') return null
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function textFromKeys(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const text = cleanText(obj[key])
    if (text) return text
  }
  return undefined
}

function arrayFromKeys(obj: Record<string, unknown>, keys: string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = obj[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

function formatDialogueLine(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!isRecord(value)) return ''
  const speaker = textFromKeys(value, ['character', 'speaker', 'name', '角色', '人物']) ?? '角色'
  const line = textFromKeys(value, ['line', 'text', 'content', 'dialogue', '台词', '对白'])
  const emotion = textFromKeys(value, ['emotion', '情绪'])
  return line ? `${speaker}${emotion ? `（${emotion}）` : ''}：${line}` : ''
}

function formatBeatLine(value: unknown): string {
  if (typeof value === 'string') return `- ${value.trim()}`
  if (!isRecord(value)) return ''
  const desc = textFromKeys(value, ['videoDesc', 'description', 'summary', 'action', 'content', 'text', '画面', '描述', '动作'])
  const dialogues = arrayFromKeys(value, ['dialogues', 'dialogue', 'lines', '台词', '对白'])
    ?.map(formatDialogueLine)
    .filter(Boolean)
    .join('\n  ')
  const main = desc ?? JSON.stringify(value)
  return [`- ${main}`, dialogues ? `  ${dialogues}` : ''].filter(Boolean).join('\n')
}

function formatScriptScene(value: unknown, index: number): string {
  if (typeof value === 'string') return `第 ${index + 1} 场\n${value.trim()}`
  if (!isRecord(value)) return ''
  const title = textFromKeys(value, ['title', 'name', 'sceneName', 'scene', 'slug', 'heading', '标题', '场名'])
  const location = textFromKeys(value, ['location', 'place', '地点', '场景'])
  const time = textFromKeys(value, ['time', 'dayTime', '时间'])
  const header = [title ?? `第 ${index + 1} 场`, location, time].filter(Boolean).join(' / ')
  const body = textFromKeys(value, ['summary', 'description', 'action', 'content', 'text', '简介', '描述', '动作'])
  const dialogues = arrayFromKeys(value, ['dialogues', 'dialogue', 'lines', '台词', '对白'])
    ?.map(formatDialogueLine)
    .filter(Boolean)
    .join('\n')
  const beats = arrayFromKeys(value, ['beats', 'shots', '镜头', '节拍'])
    ?.map(formatBeatLine)
    .filter(Boolean)
    .join('\n')
  const parts = [header, body, dialogues, beats].filter((part): part is string => !!part?.trim())
  return parts.length > 1 ? parts.join('\n') : `${header}\n${JSON.stringify(value, null, 2)}`
}

function formatStructuredScript(obj: Record<string, unknown>): string | undefined {
  const scenes = arrayFromKeys(obj, ['scenes', '场次', '场景', '分场'])
  if (scenes?.length) return scenes.map(formatScriptScene).filter(Boolean).join('\n\n')
  const acts = arrayFromKeys(obj, ['acts', 'segments', '幕', '段落'])
  if (acts?.length) return acts.map(formatScriptScene).filter(Boolean).join('\n\n')
  return undefined
}

function normalizeScriptCandidate(value: unknown, fallbackName?: string): AgentPlan['script'] | undefined {
  const directText = cleanText(value)
  if (directText) return { name: fallbackName, content: directText }
  if (!isRecord(value)) return undefined

  const name = textFromKeys(value, ['name', 'title', 'scriptName', '剧本名', '标题']) ?? fallbackName
  const content = textFromKeys(value, ['content', 'scriptContent', 'screenplay', 'text', 'body', '正文', '剧本正文'])
  if (content) return { name, content }

  const nested =
    normalizeScriptCandidate(value.script, name) ??
    normalizeScriptCandidate(value['剧本'], name) ??
    normalizeScriptCandidate(value.screenplay, name)
  if (nested?.content) return { name: nested.name ?? name, content: nested.content }

  const structured = formatStructuredScript(value)
  return structured ? { name, content: structured } : undefined
}

function looksLikeScriptText(text: string): boolean {
  return (
    /(第\s*[0-9一二三四五六七八九十]+\s*[场幕镜]|场景|内景|外景|对白|旁白|INT\.|EXT\.|动作[:：]|人物[:：]|镜头\s*\d+)/i.test(text) ||
    text.length >= 200
  )
}

function parseScriptOutput(raw: string): AgentPlan['script'] | undefined {
  const parsed = parsePlan(raw).script
  if (parsed?.content?.trim()) return { name: parsed.name, content: parsed.content.trim() }
  if (parseJsonObject(raw)) return undefined
  const text = stripJsonEnvelope(raw)
  if (looksLikeScriptText(text)) return { name: '剧本', content: text.trim() }
  return undefined
}

function parsePlan(raw: string): AgentPlan {
  const trimmed = (raw || '').trim()
  const obj = parseJsonObject(trimmed)
  // 无 JSON 对象（空/纯文本）：当作纯文字回复，不抛裸 SyntaxError
  if (!obj) return { reply: trimmed || '（模型未返回内容，请重试）' }
  const script =
    normalizeScriptCandidate(obj.script) ??
    normalizeScriptCandidate(obj['剧本']) ??
    normalizeScriptCandidate(obj.screenplay) ??
    normalizeScriptCandidate(obj)
  return {
    reply: typeof obj.reply === 'string' ? obj.reply : '已处理。',
    script,
    assets: Array.isArray(obj.assets) ? (obj.assets as AgentPlan['assets']) : undefined,
    storyboards: Array.isArray(obj.storyboards) ? (obj.storyboards as AgentPlan['storyboards']) : undefined,
    autoGenerate: obj.autoGenerate === true,
  }
}

function formatEpisodeContext(doc: ProjectDoc): string {
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  if (!episodes.length) return '剧集：单集兼容模式。项目级资产跨集共享，当前剧本/分镜/时间线按工作区写入。'
  const current = episodes.find((episode) => episode.id === doc.currentEpisodeId) ?? episodes[0]
  const rows = episodes
    .map((episode) => {
      const marker = episode.id === current.id ? '（当前）' : ''
      const summary = episode.summary ? `；梗概：${episode.summary.slice(0, 120)}` : ''
      const recap = episode.productionRecap ? `；制作回顾：${episode.productionRecap.slice(0, 160)}` : ''
      const scripts = episode.id === current.id ? doc.scripts : episode.scripts
      const storyboards = episode.id === current.id ? doc.storyboards : episode.storyboards
      const clips = episode.id === current.id ? doc.clips : episode.clips
      const film = episode.filmPath ? '已成片' : episode.filmError ? `合成失败：${episode.filmError.slice(0, 80)}` : '未合成'
      const plan = episode.plan
      const planText = plan
        ? `；计划：${[plan.hook ? `hook=${plan.hook}` : '', plan.conflict ? `冲突=${plan.conflict}` : '', plan.cliffhanger ? `结尾=${plan.cliffhanger}` : '']
            .filter(Boolean)
            .join('；')
            .slice(0, 180)}`
        : ''
      return `${episode.index + 1}. ${episode.title}${marker}：剧本 ${scripts.length}，分镜 ${storyboards.length}，片段 ${clips.length}，${film}${summary}${planText}${recap}`
    })
    .join('\n')
  return [
    `当前剧集：第 ${current.index + 1} 集「${current.title}」（id: ${current.id}）。`,
    '项目级资产跨集共享；剧本、分镜、视频片段、时间线按当前剧集写入。处理指定集时先确认或切换到目标剧集。',
    `剧集列表：\n${rows}`,
  ].join('\n')
}

function formatSeriesBibleContext(doc: ProjectDoc): string {
  const bible = doc.seriesBible
  if (!bible) return ''
  const parts = [
    bible.logline ? `logline：${bible.logline}` : '',
    bible.theme ? `主题：${bible.theme}` : '',
    bible.synopsis ? `整季梗概：${bible.synopsis.slice(0, 800)}` : '',
    bible.worldRules ? `世界规则：${bible.worldRules.slice(0, 500)}` : '',
    bible.continuityRules?.length ? `连续性规则：\n${bible.continuityRules.map((rule, index) => `${index + 1}. ${rule}`).join('\n').slice(0, 1000)}` : '',
    bible.plannedEpisodeCount ? `计划集数：${bible.plannedEpisodeCount}` : '',
  ].filter(Boolean)
  return parts.length ? `## 系列圣经\n${parts.join('\n')}` : ''
}

function formatCurrentEpisodeNovelContext(doc: ProjectDoc): string {
  const current = doc.episodes?.find((episode) => episode.id === doc.currentEpisodeId)
  const ids = current?.novelChapterIds ?? []
  if (!current || !ids.length) return ''
  const wanted = new Set(ids)
  const chapters = doc.novel.filter((chapter) => wanted.has(chapter.id))
  if (!chapters.length) return ''
  return `## 当前剧集原著范围\n第 ${current.index + 1} 集「${current.title}」已分配 ${chapters.length} 个原著章节，改编当前集时优先使用这些章节，不要串到未分配章节：\n${chapters
    .map((chapter) => (chapter.event ? `【${chapter.title}】事件：${chapter.event}` : `【${chapter.title}】\n${chapter.text.slice(0, 1200)}`))
    .join('\n\n')
    .slice(0, 6000)}`
}

/** 当前项目上下文（决策层 + 各执行子 Agent 共用）。memoryText 给定时替代默认近期对话（§6.6 召回） */
function buildContext(doc: ProjectDoc, memoryText?: string): string {
  const pack = getStylePack(doc.meta.artStyle)
  const naive = doc.memory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '你'}：${m.content}`)
    .join('\n')
  // memoryText（recallContext）已自带分节标题；naive 兜底再加「近期对话」标题
  const recent = memoryText ?? (naive ? `## 近期对话\n${naive}` : '')
  return [
    '## 当前项目',
    `名称：${doc.meta.name}；画风：${pack?.label ?? doc.meta.artStyle}；画幅：${doc.meta.videoRatio}；对白语言：${doc.meta.dialogueLang ?? '中文'}`,
    doc.meta.directorManual ? `导演手册（全局风格/节奏意图，务必遵循）：${doc.meta.directorManual}` : '',
    formatSeriesBibleContext(doc),
    formatEpisodeContext(doc),
    `已有资产：${doc.assets.map((a) => `${a.name}${a.aliases?.length ? ` alias:${a.aliases.join('/')}` : ''}(${a.type})`).join('、') || '无'}`,
    doc.storyboards.length
      ? `已有分镜（${doc.storyboards.length} 个，新增的分镜要承接这些、不要重复）：\n${[...doc.storyboards]
          .sort((a, b) => a.index - b.index)
          .map((s, i) => `${i + 1}. ${s.videoDesc.slice(0, 60)}`)
          .join('\n')}`
      : '尚无分镜',
    doc.scripts[0]?.content ? `已有剧本：\n${doc.scripts[0].content.slice(0, 2000)}` : '尚无剧本',
    formatCurrentEpisodeNovelContext(doc),
    doc.novel.length
      ? `## 原著（${doc.novel.length} 章，按此改编剧本，可分集/分段，不丢关键信息）\n${doc.novel
          .map((c) => (c.event ? `【${c.title}】事件：${c.event}` : `【${c.title}】\n${c.text}`))
          .join('\n\n')
          .slice(0, 8000)}`
      : '',
    recent,
  ]
    .filter(Boolean)
    .join('\n')
}

function ensureModel(): string {
  if (!window.mulby?.ai?.call) throw new Error('宿主 AI 不可用（请在宿主配置文本模型）')
  const model = useGraphStore.getState().selectedModel
  if (!model) throw new Error('未配置文本模型（请在「设置」选择）')
  return model
}

async function callJson(
  model: string,
  skill: string,
  ctx: string,
  contract: string,
  userText: string,
  onReasoning?: (delta: string) => void,
): Promise<AgentPlan> {
  const system = [skill, ctx, contract].filter(Boolean).join('\n\n')
  const r = await runText({ model, system, user: userText, jsonMode: true, onReasoning })
  return parsePlan(r.content)
}

/** 工具增强循环（§6.1）的 system 提示词：决策 skill + 项目上下文 + 工具使用说明 */
export function buildToolLoopSystem(doc: ProjectDoc, memoryText?: string): string {
  const TOOL_GUIDE =
    '你是 AI 制片。工具返回的是当前项目的实时状态；凡是用户要求续写、修改、对齐已有内容、查询当前状态，先调用读取工具核对，不要只凭摘要猜测。' +
    '多集项目先用 get_series_bible/get_episodes/get_project_overview 确认整季蓝图和当前剧集；用户指定第几集或新一集时，先 switch_episode 或 create_episode 再写入。' +
    '只读工具：get_project_overview/get_workspace（项目概览）、get_series_bible（系列圣经和每集计划）、get_episodes（剧集列表）、get_continuity_report（跨集资产/变体一致性审计）、get_episode_handoff（当前集跨集承接线索）、get_script（完整剧本）、get_storyboards（完整分镜）、get_assets（完整资产）、' +
    'get_novel（原著/章节事件）、get_storyboard_table（设计层大纲/分镜表）、get_timeline（时间线/视频段）、search_project（关键词搜索）。' +
    '写入/生成工具：update_series_bible（更新整季蓝图）、upsert_episode_plan（更新单集 hook/冲突/结尾钩子和必需资产/变体）、create_episode（新建并切换剧集）、create_episodes（批量新建空剧集）、switch_episode（切换剧集）、rename_episode（改剧集名）、assign_episode_chapters（把原著章节分配到剧集）、distribute_episode_chapters（按顺序均分原著章节到现有剧集）、upsert_script（写剧本）、add_asset（加项目级共享资产）、update_asset（改已有资产名称/别名/描述/提示词）、upsert_asset_variant（创建/更新资产变体）、set_asset_variant_scope（增量标记变体适用分镜/场景/剧集）、generate_asset_variant（生成变体参考图）、add_storyboard（加当前剧集分镜）、set_storyboard_asset_ref（修正既有分镜出场资产引用）、set_storyboard_cast_variant（修正既有分镜变体绑定）、set_storyboard_scene_asset（修正连续场景资产绑定）、generate_asset、generate_keyframe、generate_clip。' +
    '用户要求规划整季、拆多集、维护角色弧光或只做大纲时，优先 update_series_bible/upsert_episode_plan，不要直接重写已有剧本；生成单集剧本/分镜时必须遵守对应 Episode.plan 的 requiredAssetIds 和 requiredVariantIds。' +
    PLANNED_HANDOFF_STORYBOARD_RULE +
    '续写下一集、处理换装妆容或承接上一集状态时，先读取 get_episode_handoff；如果 handoff/continuity 指出上一相关剧集使用过具体形态，或当前分镜/场景/剧集已有适用变体，分镜必须通过 castRefs 绑定 variantLabel/variantId，除非剧情明确恢复默认状态。' +
    '连续场景里的同一角色默认保持同一形态；get_continuity_report 返回 scene_group_missing_asset 或 scene_group_asset_mismatch 时，用 set_storyboard_scene_asset 补齐或统一同一 sceneId 的场景资产；返回 scene_group_variant_mismatch 时，除非剧情明确发生换装/状态变化，否则用 set_storyboard_cast_variant 统一同一 sceneId 里的角色变体。' +
    'get_continuity_report 返回 episode_variant_available 且有多个 candidateVariantIds 时，先按剧情选择正确形态，再用 set_storyboard_cast_variant 绑定；不要继续让分镜使用主形象。' +
    'get_continuity_report 返回 variant_out_of_episode_scope 时，用 set_asset_variant_scope 追加对应分镜/场景/剧集适用范围，不要用 upsert_asset_variant 重写已有范围数组。' +
    'get_continuity_report 返回 asset_state_changed_variant 时，若剧情明确换装/妆容/受伤/时期变化，用 set_asset_variant_scope 标记当前 variantId 适用于本集；否则用 set_storyboard_cast_variant 绑定 previousVariantId 沿用上一形态，并传 ensureScope=true 补当前使用范围。' +
    'get_continuity_report 返回 duplicate_asset_name 或 duplicate_asset_alias 时，优先复用已有资产；需要调整名称或 aliases 用 update_asset，不要用 add_asset 再创建同名/同别名资产。' +
    'get_continuity_report 返回 unused_project_asset 时，如果资产应在当前或指定剧集出场，用 set_storyboard_asset_ref 加入合适分镜；不要只口头说明复用。' +
    '分镜需要指定同一角色的妆容/服装/时期时，先 get_assets 查看 variants，再给 add_storyboard 传 castRefs（assetName 或 assetId + variantLabel 或 variantId）；同一空间/连续动作传稳定 sceneId，承接上一形态或场景/分镜级形态时传 ensureScope=true 和合适 scopeKind。' +
    '执行复杂任务时先规划，再按需读取真实状态，最后调用写入/生成工具完成用户需求；资产名要与分镜 cast 一致，昵称/称谓写 aliases 以便后续复用同一资产。全部做完后用一句中文说明你做了什么。'
  return [getAgentSkill('production_agent_decision'), buildContext(doc, memoryText), TOOL_GUIDE].filter(Boolean).join('\n\n')
}

/** 单次结构化方案（兜底/简单场景）：一通调用产出剧本+资产+分镜 */
export async function runAgentPlan(doc: ProjectDoc, userText: string): Promise<AgentPlan> {
  const model = ensureModel()
  return callJson(model, getAgentSkill('production_agent_decision'), buildContext(doc), CONTRACT, userText)
}

// ============ 分阶段子 Agent（Toonflow 3 层：决策 → 执行 剧本/资产/分镜）============

type StageTask = 'script' | 'assets' | 'storyboard'

const DECIDE_CONTRACT = `
只输出一个 JSON 对象（无额外文字/围栏）：{"reply":"给用户的简短中文说明","tasks":["script"|"assets"|"storyboard"...],"autoGenerate":false}
- tasks：本轮要做的环节（用户只想改剧本就只列 ["script"]；要从头出片列 ["script","assets","storyboard"]；只想加镜头列 ["storyboard"]）。
- 用户说「列出人物和场景」「生成需要的资产」「资产没看到」「角色/场景/道具/素材」时，tasks 必须包含 "assets"。
- 用户说「N 个镜头」「分镜」「短片」「视频片段」时，tasks 必须包含 "storyboard"。
- 用户说「把故事改成」「改编」「写剧本/短剧/对白」时，tasks 必须包含 "script"。
- autoGenerate：用户明确要求「出图/直接成片」时 true。`

const SCRIPT_SKILL =
  '你是「编剧」。把用户的素材（一句话/故事/小说/指令）改编成结构化短剧剧本：分场、对白、动作。遵循项目画风与对白语言。' +
  '如果上下文给出了「当前剧集原著范围」或章节分配，当前集剧本必须优先只改编这些章节；跨集伏笔可以点到为止，不要把其他集剧情提前写完。' +
  '已有剧本则在其基础上修改/续写。必须把完整剧本正文放进 script.content，不要只在 reply 里说已生成。只输出 JSON：{"script":{"name":"剧本名","content":"剧本正文"}}'
const ASSETS_SKILL =
  '你是「美术设定」。从当前剧本提炼需要的资产：人物(role)/场景(scene)/物品(prop)。当前剧本可能来自本轮新剧本，也可能来自工具读取到的已有剧本/get_script。' +
  '每个资产给中文描述 desc + 英文生成提示词 prompt。已存在的资产（见上下文）不要重复；如果用户明确要求补资产且已有资产为空/缺失，不允许返回空数组，至少提炼角色和主要场景。' +
  '资产名要能被分镜 cast 直接引用；昵称、称谓、原著别称写 aliases。只输出 JSON：{"assets":[{"type":"role|scene|prop","name":"","aliases":[],"desc":"","prompt":""}]}'
const STORYBOARD_SKILL =
  '你是「导演/分镜师」。把剧本拆成可执行镜头表：每镜画面描述 videoDesc（主体+动作+环境+情绪+光影）、英文关键帧 prompt、时长 duration(4-15)、' +
  '出场资产名 cast（与资产名一致）、对白 dialogues（把该镜台词逐句填入：character 为出场角色名或"旁白"，line 为台词原文，emotion 可选；无台词则空数组）。' +
  '同一空间、同一连续动作或同一场景段落的镜头必须写相同 sceneId；换场时更换 sceneId，替换已有分镜且不再属于任何场景组时可写 sceneId="" 清除旧值。sceneId 用稳定短标识，不要每镜都新造。' +
  '同一角色有妆容/服装/年龄/时期差异时，额外输出 castRefs：[{"assetName":"资产名","variantLabel":"变体标签","roleInShot":"lead"}]，让分镜绑定到具体变体。' +
  PLANNED_HANDOFF_STORYBOARD_RULE +
  '如果上下文里的 get_episode_handoff、get_continuity_report 或已有资产 variants 显示上一相关剧集使用过某角色具体形态，或本集已有适用形态，相关分镜必须在 castRefs 写 variantLabel/variantId；除非剧本明确写出恢复默认形象，不要只写 cast 或把变体只放进画面描述。' +
  '当你为了承接上一形态或使用已有场景/分镜级形态而绑定 variant 时，给该分镜写 ensureScope=true；有 sceneId 时优先 scopeKind="scene"，只适用于单镜时用 "storyboard"，整集适用才用 "episode"。' +
  '当连续性报告出现 episode_variant_available、asset_state_regressed_to_main 或 asset_state_changed_variant 时，优先把分镜输出为绑定候选/上一形态/新形态的 castRefs，避免生成后再回退或漂移到错误形态。' +
  '同一 sceneId 的连续分镜里，同一角色默认保持同一 castRefs 形态；只有镜头内明确发生换装、化妆、受伤或状态转变时，才切换 variantLabel/variantId。' +
  '紧接同一连贯动作/同场不切的镜头 chainFromPrev=true。要改已有第 N 镜用 replaceIndex=N(1-based)。' +
  '只输出 JSON：{"storyboards":[{"videoDesc":"","prompt":"","duration":5,"sceneId":"","ensureScope":false,"scopeKind":"scene","cast":[],"castRefs":[],"dialogues":[{"character":"","line":"","emotion":""}],"chainFromPrev":false}]}'

function parseDecision(raw: string): { reply: string; tasks: StageTask[]; autoGenerate: boolean } {
  const fallback = { reply: '已处理。', tasks: ['script', 'assets', 'storyboard'] as StageTask[], autoGenerate: false }
  try {
    let s = (raw || '').trim()
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
    if (fence) s = fence[1].trim()
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a < 0 || b <= a) return fallback
    const obj = JSON.parse(s.slice(a, b + 1)) as Record<string, unknown>
    const tasks = Array.isArray(obj.tasks)
      ? (obj.tasks.filter((t) => t === 'script' || t === 'assets' || t === 'storyboard') as StageTask[])
      : fallback.tasks
    return {
      reply: typeof obj.reply === 'string' ? obj.reply : '已处理。',
      tasks: tasks.length ? tasks : fallback.tasks,
      autoGenerate: obj.autoGenerate === true,
    }
  } catch {
    return fallback
  }
}

const TASK_ORDER: StageTask[] = ['script', 'assets', 'storyboard']

function normalizeDecisionTasks(tasks: StageTask[], userText: string): StageTask[] {
  const text = userText.trim()
  const set = new Set<StageTask>(tasks)
  const wantsAssets =
    /(资产|素材|人物|角色|场景|道具|美术|列出.*(人物|角色|场景)|生成.*(资产|素材|人物|角色|场景|道具)|需要的资产|资产.*没|没看到.*资产)/.test(text) &&
    !/(不要|不需要|不用).*(资产|素材|人物|角色|场景|道具)/.test(text)
  const wantsStoryboard = /(分镜|镜头|短片|视频片段|短视频|[0-9一二三四五六七八九十]+\s*个\s*镜头)/.test(text)
  const wantsScript =
    /(把|将|请把|请将).*(故事|小说|原著|剧本).*(改成|改写成|改编成|整理成).*(剧本|短剧|对白|分场)?/.test(text) ||
    /(改编|改写|重写).*(故事|小说|原著|剧本|短剧|对白)/.test(text) ||
    /(写|创作|生成|产出|整理).*(剧本|短剧|对白|分场)/.test(text) ||
    /(续写|扩写|补写).*(剧本|短剧|对白|故事|小说)/.test(text) ||
    /剧本.*(修改|重写|改成|改写|续写|扩写|补写)/.test(text)

  if (wantsScript) set.add('script')
  if (wantsAssets) set.add('assets')
  if (wantsStoryboard) set.add('storyboard')
  return TASK_ORDER.filter((t) => set.has(t))
}

// —— 管线过程事件：供对话面板逐步可视化（每个子 Agent 的开始/思考流/产出摘要/完成）——
export type PipelineAgentId = 'decision' | 'script' | 'assets' | 'storyboard'
export type PipelineEvent =
  | { type: 'start'; agent: PipelineAgentId; title: string }
  | { type: 'reasoning'; agent: PipelineAgentId; delta: string }
  | { type: 'output'; agent: PipelineAgentId; summary: string }
  | { type: 'toolCall'; agent: PipelineAgentId; name: string; args: Record<string, unknown> }
  | { type: 'toolResult'; agent: PipelineAgentId; name: string; result: string }
  | { type: 'done'; agent: PipelineAgentId }

const AGENT_TITLES: Record<PipelineAgentId, string> = {
  decision: '制片决策',
  script: '编剧 · 写剧本',
  assets: '美术 · 设计资产',
  storyboard: '导演 · 拆分镜',
}
const TASK_ZH: Record<StageTask, string> = { script: '剧本', assets: '资产', storyboard: '分镜' }
const ASSET_ZH: Record<string, string> = { role: '角色', scene: '场景', prop: '物品' }
type PipelineToolRequest = { name: string; args?: Record<string, unknown>; limit?: number }
type PlanAsset = NonNullable<AgentPlan['assets']>[number]

const TOOL_CONTEXT_CAP = 24000
const PIPELINE_TOOL_GUIDE =
  '## 子 Agent 工具上下文\n' +
  '下面内容由本地项目读取工具在当前回合实时返回。它是事实来源：续写、修改、补分镜、补资产时优先以这些读取结果为准；前序子 Agent 产出的剧本/资产会先写入项目，后续子 Agent 应直接读取最新状态。\n' +
  `${PLANNED_HANDOFF_STORYBOARD_RULE}\n` +
  '多集续写、换装、妆容、受伤状态或时期变化要以 get_episode_handoff 和 get_continuity_report 为准；分镜子 Agent 看到上一相关剧集形态、本集适用变体、episode_variant_available、asset_state_regressed_to_main 或 asset_state_changed_variant 时，必须输出带 variantLabel/variantId 的 castRefs，除非剧本明确恢复默认状态。\n' +
  '如果 continuity 出现 scene_group_variant_mismatch，同一 sceneId 的连续分镜应统一同一角色形态，除非剧本明确描述该场内发生换装、化妆、受伤或状态转变。'

type ProjectDocSource = ProjectDoc | (() => ProjectDoc | null | undefined)
export type PipelineStage = StageTask
export type PipelineStagePlan = Pick<AgentPlan, 'script' | 'assets' | 'storyboards'>

function resolvePipelineDoc(source: ProjectDocSource): ProjectDoc {
  const doc = typeof source === 'function' ? source() : source
  if (!doc) throw new Error('项目已关闭或未打开')
  return doc
}

function capToolContext(result: string, limit = TOOL_CONTEXT_CAP): string {
  if (limit <= 0 || result.length <= limit) return result
  return `${result.slice(0, limit)}\n...（工具结果共 ${result.length} 字，已为上下文截断）`
}

async function readPipelineToolContext(
  getDoc: () => ProjectDoc,
  agent: PipelineAgentId,
  requests: PipelineToolRequest[],
  emit: (e: PipelineEvent) => void,
): Promise<string> {
  if (!requests.length) return ''
  const tools = makeProjectReadTools(getDoc)
  const chunks: string[] = []
  for (const req of requests) {
    const args = req.args ?? {}
    emit({ type: 'toolCall', agent, name: req.name, args })
    const tool = tools.find((t) => t.name === req.name)
    let result = ''
    try {
      result = tool ? await tool.execute(args) : `未找到读取工具：${req.name}`
    } catch (e) {
      result = `读取工具执行出错：${e instanceof Error ? e.message : String(e)}`
    }
    const capped = capToolContext(result, req.limit)
    emit({ type: 'toolResult', agent, name: req.name, result: capped })
    chunks.push(`### ${req.name}\n${capped}`)
  }
  return [PIPELINE_TOOL_GUIDE, ...chunks].join('\n\n')
}

function summarizeAssets(assets?: AgentPlan['assets']): string {
  // 防御 LLM 畸形输出：仅统计有名字/类型的项（与 applyPlan 去重口径一致，避免摘要抛错拖垮整轮）
  const valid = cleanAssets(assets)
  if (!valid.length) return '本轮无新增资产。'
  const byType: Record<string, string[]> = {}
  for (const a of valid) (byType[ASSET_ZH[a.type] ?? a.type] ??= []).push(a.name)
  return Object.entries(byType)
    .map(([t, ns]) => `- **${t}**：${ns.join('、')}`)
    .join('\n')
}

function cleanAssets(assets?: AgentPlan['assets']): PlanAsset[] {
  const seen = new Set<string>()
  const out: PlanAsset[] = []
  for (const a of assets ?? []) {
    if (!a?.name || (a.type !== 'role' && a.type !== 'scene' && a.type !== 'prop')) continue
    const name = String(a.name).trim()
    if (!name) continue
    const key = `${a.type}:${name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ type: a.type, name, aliases: cleanAssetAliases(a.aliases), desc: a.desc, prompt: a.prompt })
  }
  return out
}

function currentScriptContent(doc: ProjectDoc, plan: AgentPlan, episodeId?: string): string {
  if (plan.script?.content?.trim()) return plan.script.content.trim()
  const episode = episodeId ? doc.episodes?.find((item) => item.id === episodeId) : undefined
  const scripts = episode && episode.id !== doc.currentEpisodeId ? episode.scripts : doc.scripts
  return scripts[0]?.content?.trim() || ''
}

function summarizePlanResult(plan: AgentPlan, tasks: StageTask[]): string {
  const parts: string[] = []
  if (plan.script?.content) {
    parts.push(`已生成剧本${plan.script.name ? `《${plan.script.name}》` : ''}。`)
  }
  const assets = cleanAssets(plan.assets)
  if (assets.length) {
    const byType: Record<string, string[]> = {}
    for (const a of assets) (byType[ASSET_ZH[a.type] ?? a.type] ??= []).push(a.name)
    parts.push(`已生成 ${assets.length} 个资产数据：${Object.entries(byType).map(([t, ns]) => `${t} ${ns.join('、')}`).join('；')}。`)
  } else if (tasks.includes('assets')) {
    parts.push('美术没有产出可写入的新资产，我没有向资产列表写入空结果。')
  }
  const storyboards = (plan.storyboards ?? []).filter((s) => s && typeof s.videoDesc === 'string' && s.videoDesc.trim())
  if (storyboards.length) parts.push(`已生成 ${storyboards.length} 个分镜。`)
  if (!parts.length) return '本轮没有产生可写入的新内容。'
  return parts.join('\n')
}

function summarizeStoryboards(sbs?: AgentPlan['storyboards']): string {
  // 防御 LLM 畸形输出：缺 videoDesc（或非字符串）的分镜项跳过，避免 .slice 抛错（与 applyPlan 的 `if(!sb?.videoDesc) continue` 一致）
  const valid = (sbs ?? []).filter((s) => s && typeof s.videoDesc === 'string')
  if (!valid.length) return '本轮无新增分镜。'
  return valid
    .map((s, i) => {
      const tag = typeof s.replaceIndex === 'number' && s.replaceIndex > 0 ? `改镜 #${s.replaceIndex}` : `镜 ${i + 1}`
      const dl = s.dialogues?.length ? ` · ${s.dialogues.length} 句台词` : ''
      return `${i + 1}. **${tag}**（${s.duration ?? 5}s${dl}）${s.videoDesc.slice(0, 42)}`
    })
    .join('\n')
}

/**
 * 分阶段管线：决策层决定要做哪些环节，再由各执行子 Agent（聚焦提示词）依次产出剧本/资产/分镜。
 * 比单次 mega-prompt 质量更高（每个子 Agent 只干一件事），并通过 onEvent 逐步暴露过程
 *（开始/思考流/产出摘要/完成），供对话面板把「多 Agent 各做了什么」可视化。
 */
export async function runAgentPipeline(
  docSource: ProjectDocSource,
  userText: string,
  onEvent?: (e: PipelineEvent) => void,
  onStagePlan?: (stage: PipelineStage, plan: PipelineStagePlan) => void | Promise<void>,
  options?: { episodeId?: string },
): Promise<AgentPlan> {
  const model = ensureModel()
  const cfg = await getMemoryConfig()
  const getDoc = () => resolvePipelineDoc(docSource)
  const targetEpisodeId = (): string | undefined => {
    const current = getDoc()
    return options?.episodeId ?? resolveAgentEpisodeTarget(current, userText)?.episode.id
  }
  const targetEpisodeArgs = (): Record<string, unknown> => {
    const current = getDoc()
    const episodeId = targetEpisodeId()
    return episodeId && current.episodes?.some((episode) => episode.id === episodeId) ? { episodeId } : {}
  }
  const makeBaseCtx = () => {
    const current = getDoc()
    return buildContext(current, recallContext(current, userText, cfg))
  }
  const stageApplied = async (stage: PipelineStage, fragment: PipelineStagePlan) => {
    await onStagePlan?.(stage, fragment)
  }
  const emit = onEvent ?? (() => {})
  const reasoner = (agent: PipelineAgentId) => (delta: string) => emit({ type: 'reasoning', agent, delta })

  // 决策层
  emit({ type: 'start', agent: 'decision', title: AGENT_TITLES.decision })
  const decisionToolCtx = await readPipelineToolContext(
    getDoc,
    'decision',
    [
      { name: 'get_project_overview', limit: 16000 },
      { name: 'get_episodes', limit: 12000 },
      { name: 'get_continuity_report', limit: 20000 },
    ],
    emit,
  )
  const decisionCtx = [makeBaseCtx(), decisionToolCtx].filter(Boolean).join('\n\n')
  const decisionRaw = await runText({
    model,
    system: [getAgentSkill('production_agent_decision'), decisionCtx, DECIDE_CONTRACT].filter(Boolean).join('\n\n'),
    user: userText,
    jsonMode: true,
    onReasoning: reasoner('decision'),
  })
  const parsedDecision = parseDecision(decisionRaw.content)
  const decision = { ...parsedDecision, tasks: normalizeDecisionTasks(parsedDecision.tasks, userText) }
  const plan: AgentPlan = { reply: decision.reply, autoGenerate: decision.autoGenerate }
  emit({
    type: 'output',
    agent: 'decision',
    summary: `**本轮规划**：${decision.tasks.map((t) => TASK_ZH[t]).join(' → ')}${
      decision.autoGenerate ? '，随后自动一键成片' : ''
    }。`,
  })
  emit({ type: 'done', agent: 'decision' })

  if (decision.tasks.includes('script')) {
    emit({ type: 'start', agent: 'script', title: AGENT_TITLES.script })
    const scriptToolCtx = await readPipelineToolContext(
      getDoc,
      'script',
      [
        { name: 'get_project_overview', limit: 12000 },
        { name: 'get_episodes', limit: 12000 },
        { name: 'get_script', args: { ...targetEpisodeArgs(), contentLimit: 50000 }, limit: 30000 },
        { name: 'get_novel', args: { includeText: true, textLimit: 6000 }, limit: 30000 },
        { name: 'get_storyboard_table', args: targetEpisodeArgs(), limit: 18000 },
      ],
      emit,
    )
    const scriptCtx = [makeBaseCtx(), scriptToolCtx].filter(Boolean).join('\n\n')
    const scriptRaw = await runText({
      model,
      system: [SCRIPT_SKILL, scriptCtx].filter(Boolean).join('\n\n'),
      user: userText,
      jsonMode: true,
      onReasoning: reasoner('script'),
    })
    plan.script = parseScriptOutput(scriptRaw.content)
    emit({
      type: 'output',
      agent: 'script',
      summary: plan.script?.content
        ? `已产出剧本${plan.script.name ? ` **《${plan.script.name}》**` : ''}（约 ${plan.script.content.length} 字）。`
        : '未产出剧本内容。',
    })
    await stageApplied('script', { script: plan.script })
    emit({ type: 'done', agent: 'script' })
  }
  if (decision.tasks.includes('assets')) {
    emit({ type: 'start', agent: 'assets', title: AGENT_TITLES.assets })
    const scriptSource = currentScriptContent(getDoc(), plan, targetEpisodeId())
    const assetsToolCtx = await readPipelineToolContext(
      getDoc,
      'assets',
      [
        { name: 'get_project_overview', limit: 12000 },
        { name: 'get_episodes', limit: 12000 },
        { name: 'get_assets', args: { includeImages: false }, limit: 30000 },
        { name: 'get_script', args: { ...targetEpisodeArgs(), contentLimit: 50000 }, limit: 30000 },
      ],
      emit,
    )
    const aCtx = [
      makeBaseCtx(),
      assetsToolCtx,
      scriptSource ? `## 当前剧本正文（美术资产提炼的主要来源）\n${scriptSource.slice(0, 30000)}` : '',
      plan.script ? `## 本轮新剧本（优先于工具中的旧剧本）\n${plan.script.content.slice(0, 30000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    plan.assets = cleanAssets((await callJson(model, ASSETS_SKILL, aCtx, '', userText, reasoner('assets'))).assets)
    if (!plan.assets.length && scriptSource) {
      const retrySkill =
        ASSETS_SKILL +
        '\n\n你上一次没有返回可写入资产，但当前任务明确需要资产。请只基于「当前剧本正文」提炼缺失资产；已有资产为空或缺失时，必须返回角色、主要场景和关键道具，不允许返回空数组。'
      const retryUser = `${userText}\n\n请从当前剧本正文中提炼并生成缺失资产数据；只输出 assets JSON。`
      plan.assets = cleanAssets((await callJson(model, retrySkill, aCtx, '', retryUser, reasoner('assets'))).assets)
    }
    emit({ type: 'output', agent: 'assets', summary: summarizeAssets(plan.assets) })
    await stageApplied('assets', { assets: plan.assets })
    emit({ type: 'done', agent: 'assets' })
  }
  if (decision.tasks.includes('storyboard')) {
    emit({ type: 'start', agent: 'storyboard', title: AGENT_TITLES.storyboard })
    const scriptSource = currentScriptContent(getDoc(), plan, targetEpisodeId())
    const storyboardToolCtx = await readPipelineToolContext(
      getDoc,
      'storyboard',
      [
        { name: 'get_project_overview', limit: 12000 },
        { name: 'get_episodes', limit: 12000 },
        { name: 'get_continuity_report', limit: 20000 },
        { name: 'get_episode_handoff', args: targetEpisodeArgs(), limit: 24000 },
        { name: 'get_storyboards', args: { ...targetEpisodeArgs(), count: 200, includePrompt: true, includeDialogues: true, includeAssets: true }, limit: 36000 },
        { name: 'get_assets', args: { includeImages: false }, limit: 30000 },
        { name: 'get_timeline', args: { ...targetEpisodeArgs(), includeClips: false }, limit: 18000 },
        { name: 'get_script', args: { ...targetEpisodeArgs(), contentLimit: 50000 }, limit: 30000 },
      ],
      emit,
    )
    const newAssets = plan.assets?.length ? JSON.stringify(plan.assets, null, 2).slice(0, 16000) : ''
    const sCtx = [
      makeBaseCtx(),
      storyboardToolCtx,
      scriptSource ? `## 当前剧本正文（分镜拆解的主要来源）\n${scriptSource.slice(0, 30000)}` : '',
      plan.script ? `## 本轮新剧本（优先于工具中的旧剧本）\n${plan.script.content.slice(0, 30000)}` : '',
      newAssets ? `## 本轮新增资产（与已有资产合并使用，cast 名称必须匹配）\n${newAssets}` : '',
    ]
      .filter(Boolean)
      .join('\n\n')
    plan.storyboards = (await callJson(model, STORYBOARD_SKILL, sCtx, '', userText, reasoner('storyboard'))).storyboards
    emit({ type: 'output', agent: 'storyboard', summary: summarizeStoryboards(plan.storyboards) })
    await stageApplied('storyboard', { storyboards: plan.storyboards })
    emit({ type: 'done', agent: 'storyboard' })
  }
  plan.reply = summarizePlanResult(plan, decision.tasks)
  return plan
}
