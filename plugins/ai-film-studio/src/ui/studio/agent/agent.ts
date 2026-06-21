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
  storyboards?: { videoDesc: string; prompt?: string; duration?: number; cast?: string[]; chainFromPrev?: boolean }[]
  /** 用户明确要求「出图/生成/成片」时为 true：应用方案后自动一键成片 */
  autoGenerate?: boolean
}

const CONTRACT = `
你必须**只输出一个 JSON 对象**（不要任何额外文字、解释或 markdown 代码块围栏），结构如下：
{
  "reply": "给用户的简短中文说明（你做了什么、下一步建议）",
  "script": { "name": "剧本名", "content": "剧本正文（分场/对白/动作）" },
  "assets": [ { "type": "role|scene|prop", "name": "名称", "desc": "中文外貌/特征描述", "prompt": "英文图像生成提示词" } ],
  "storyboards": [ { "videoDesc": "中文画面描述：主体+动作+环境+情绪+光影", "prompt": "英文关键帧提示词", "duration": 5, "cast": ["出场资产名"], "chainFromPrev": false } ],
  "autoGenerate": false   // 仅当用户明确要求「出图/生成/直接成片」时设 true，自动一键成片
}
规则：
- 字段都可选；本轮只产出用户要求的部分，**已存在的内容不要重复**（按名字去重）。
- assets 的 name 要与 storyboards 的 cast 名字一致，便于关联。
- 分镜按叙事顺序排列；紧接上一镜「同一连贯动作/同场不切」的镜头 chainFromPrev=true（关键帧会承接上一帧保持连贯），真正硬切/换场=false。
- 全程使用项目设定的画风与对白语言。`

function parsePlan(raw: string): AgentPlan {
  let s = (raw || '').trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  const obj = JSON.parse(s) as Record<string, unknown>
  return {
    reply: typeof obj.reply === 'string' ? obj.reply : '已处理。',
    script: obj.script && typeof obj.script === 'object' ? (obj.script as AgentPlan['script']) : undefined,
    assets: Array.isArray(obj.assets) ? (obj.assets as AgentPlan['assets']) : undefined,
    storyboards: Array.isArray(obj.storyboards) ? (obj.storyboards as AgentPlan['storyboards']) : undefined,
    autoGenerate: obj.autoGenerate === true,
  }
}

/** 让 Agent 基于当前项目 + 用户输入产出结构化方案 */
export async function runAgentPlan(doc: ProjectDoc, userText: string): Promise<AgentPlan> {
  const ai = window.mulby?.ai
  if (!ai?.call) throw new Error('宿主 AI 不可用（请在宿主配置文本模型）')
  const model = useGraphStore.getState().selectedModel
  if (!model) throw new Error('未配置文本模型（请在「设置」选择）')
  const base = getAgentSkill('production_agent_decision')
  const pack = getStylePack(doc.meta.artStyle)
  const ctx = [
    '## 当前项目',
    `名称：${doc.meta.name}；画风：${pack?.label ?? doc.meta.artStyle}；画幅：${doc.meta.videoRatio}；对白语言：${doc.meta.dialogueLang ?? '中文'}`,
    doc.meta.directorManual ? `导演手册：${doc.meta.directorManual}` : '',
    `已有资产：${doc.assets.map((a) => `${a.name}(${a.type})`).join('、') || '无'}`,
    `已有分镜：${doc.storyboards.length} 个`,
    doc.scripts[0]?.content ? `已有剧本：\n${doc.scripts[0].content.slice(0, 2000)}` : '尚无剧本',
  ]
    .filter(Boolean)
    .join('\n')
  const system = [base, ctx, CONTRACT].filter(Boolean).join('\n\n')
  const r = await runText({ model, system, user: userText, jsonMode: true })
  return parsePlan(r.content)
}
