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
import type { ProjectDoc } from '../../domain/types'

export interface AgentPlan {
  reply: string
  script?: { name?: string; content: string }
  assets?: { type: 'role' | 'scene' | 'prop'; name: string; desc?: string; prompt?: string }[]
  storyboards?: { videoDesc: string; prompt?: string; duration?: number; cast?: string[]; chainFromPrev?: boolean; replaceIndex?: number }[]
  /** 用户明确要求「出图/生成/成片」时为 true：应用方案后自动一键成片 */
  autoGenerate?: boolean
}

const CONTRACT = `
你必须**只输出一个 JSON 对象**（不要任何额外文字、解释或 markdown 代码块围栏），结构如下：
{
  "reply": "给用户的简短中文说明（你做了什么、下一步建议）",
  "script": { "name": "剧本名", "content": "剧本正文（分场/对白/动作）" },
  "assets": [ { "type": "role|scene|prop", "name": "名称", "desc": "中文外貌/特征描述", "prompt": "英文图像生成提示词" } ],
  "storyboards": [ { "videoDesc": "中文画面描述：主体+动作+环境+情绪+光影", "prompt": "英文关键帧提示词", "duration": 5, "cast": ["出场资产名"], "chainFromPrev": false, "replaceIndex": 0 } ],
  "autoGenerate": false   // 仅当用户明确要求「出图/生成/直接成片」时设 true，自动一键成片
}
规则：
- 字段都可选；本轮只产出用户要求的部分，**已存在的内容不要重复**（按名字去重）。
- assets 的 name 要与 storyboards 的 cast 名字一致，便于关联。
- 分镜按叙事顺序排列；紧接上一镜「同一连贯动作/同场不切」的镜头 chainFromPrev=true（关键帧会承接上一帧保持连贯），真正硬切/换场=false。
- **修改已有分镜**：要改第 N 个已有分镜，就在该 storyboard 里带 replaceIndex=N（用上面「已有分镜」列表里的编号，从 1 开始），它会就地替换（关键帧会失效需重生）；新增镜头不要带 replaceIndex。
- 全程使用项目设定的画风与对白语言。`

function parsePlan(raw: string): AgentPlan {
  const trimmed = (raw || '').trim()
  let s = trimmed
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  // 无 JSON 对象（空/纯文本）：当作纯文字回复，不抛裸 SyntaxError
  if (!s || s[0] !== '{') return { reply: trimmed || '（模型未返回内容，请重试）' }
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(s) as Record<string, unknown>
  } catch {
    return { reply: trimmed || '（模型输出无法解析，请重试或换个说法）' }
  }
  return {
    reply: typeof obj.reply === 'string' ? obj.reply : '已处理。',
    script: obj.script && typeof obj.script === 'object' ? (obj.script as AgentPlan['script']) : undefined,
    assets: Array.isArray(obj.assets) ? (obj.assets as AgentPlan['assets']) : undefined,
    storyboards: Array.isArray(obj.storyboards) ? (obj.storyboards as AgentPlan['storyboards']) : undefined,
    autoGenerate: obj.autoGenerate === true,
  }
}

/** 当前项目上下文（决策层 + 各执行子 Agent 共用） */
function buildContext(doc: ProjectDoc): string {
  const pack = getStylePack(doc.meta.artStyle)
  const recent = doc.memory
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-6)
    .map((m) => `${m.role === 'user' ? '用户' : '你'}：${m.content}`)
    .join('\n')
  return [
    '## 当前项目',
    `名称：${doc.meta.name}；画风：${pack?.label ?? doc.meta.artStyle}；画幅：${doc.meta.videoRatio}；对白语言：${doc.meta.dialogueLang ?? '中文'}`,
    doc.meta.directorManual ? `导演手册（全局风格/节奏意图，务必遵循）：${doc.meta.directorManual}` : '',
    `已有资产：${doc.assets.map((a) => `${a.name}(${a.type})`).join('、') || '无'}`,
    doc.storyboards.length
      ? `已有分镜（${doc.storyboards.length} 个，新增的分镜要承接这些、不要重复）：\n${[...doc.storyboards]
          .sort((a, b) => a.index - b.index)
          .map((s, i) => `${i + 1}. ${s.videoDesc.slice(0, 60)}`)
          .join('\n')}`
      : '尚无分镜',
    doc.scripts[0]?.content ? `已有剧本：\n${doc.scripts[0].content.slice(0, 2000)}` : '尚无剧本',
    doc.novel.length
      ? `## 原著（${doc.novel.length} 章，按此改编剧本，可分集/分段，不丢关键信息）\n${doc.novel
          .map((c) => (c.event ? `【${c.title}】事件：${c.event}` : `【${c.title}】\n${c.text}`))
          .join('\n\n')
          .slice(0, 8000)}`
      : '',
    recent ? `## 近期对话\n${recent}` : '',
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

async function callJson(model: string, skill: string, ctx: string, contract: string, userText: string): Promise<AgentPlan> {
  const system = [skill, ctx, contract].filter(Boolean).join('\n\n')
  const r = await runText({ model, system, user: userText, jsonMode: true })
  return parsePlan(r.content)
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
- autoGenerate：用户明确要求「出图/直接成片」时 true。`

const SCRIPT_SKILL =
  '你是「编剧」。把用户的素材（一句话/故事/小说/指令）改编成结构化短剧剧本：分场、对白、动作。遵循项目画风与对白语言。' +
  '已有剧本则在其基础上修改/续写。只输出 JSON：{"script":{"name":"剧本名","content":"剧本正文"}}'
const ASSETS_SKILL =
  '你是「美术设定」。从本轮剧本提炼需要的资产：人物(role)/场景(scene)/物品(prop)。每个给中文描述 desc + 英文生成提示词 prompt。' +
  '已存在的资产（见上下文）不要重复。只输出 JSON：{"assets":[{"type":"role|scene|prop","name":"","desc":"","prompt":""}]}'
const STORYBOARD_SKILL =
  '你是「导演/分镜师」。把剧本拆成可执行镜头表：每镜画面描述 videoDesc（主体+动作+环境+情绪+光影）、英文关键帧 prompt、时长 duration(4-15)、' +
  '出场资产名 cast（与资产名一致）。紧接同一连贯动作/同场不切的镜头 chainFromPrev=true。要改已有第 N 镜用 replaceIndex=N(1-based)。' +
  '只输出 JSON：{"storyboards":[{"videoDesc":"","prompt":"","duration":5,"cast":[],"chainFromPrev":false}]}'

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

/**
 * 分阶段管线：决策层决定要做哪些环节，再由各执行子 Agent（聚焦提示词）依次产出剧本/资产/分镜。
 * 比单次 mega-prompt 质量更高（每个子 Agent 只干一件事），并通过 onStage 暴露进度。
 */
export async function runAgentPipeline(doc: ProjectDoc, userText: string, onStage?: (label: string) => void): Promise<AgentPlan> {
  const model = ensureModel()
  const ctx = buildContext(doc)

  onStage?.('制片决策…')
  const decisionRaw = await runText({
    model,
    system: [getAgentSkill('production_agent_decision'), ctx, DECIDE_CONTRACT].filter(Boolean).join('\n\n'),
    user: userText,
    jsonMode: true,
  })
  const decision = parseDecision(decisionRaw.content)
  const plan: AgentPlan = { reply: decision.reply, autoGenerate: decision.autoGenerate }

  if (decision.tasks.includes('script')) {
    onStage?.('编剧：写剧本…')
    plan.script = (await callJson(model, SCRIPT_SKILL, ctx, '', userText)).script
  }
  if (decision.tasks.includes('assets')) {
    onStage?.('美术：设计资产…')
    const aCtx = plan.script ? `${ctx}\n## 本轮剧本\n${plan.script.content.slice(0, 3000)}` : ctx
    plan.assets = (await callJson(model, ASSETS_SKILL, aCtx, '', userText)).assets
  }
  if (decision.tasks.includes('storyboard')) {
    onStage?.('导演：拆分镜…')
    const aList = (plan.assets ?? []).map((a) => `${a.name}(${a.type})`).join('、')
    const sCtx =
      ctx +
      (plan.script ? `\n## 本轮剧本\n${plan.script.content.slice(0, 3000)}` : '') +
      (aList ? `\n## 本轮新增资产\n${aList}` : '')
    plan.storyboards = (await callJson(model, STORYBOARD_SKILL, sCtx, '', userText)).storyboards
  }
  return plan
}
