import type {
  AgentCommandName,
  AssetRole,
  Card,
  ProjectDoc,
  Shot,
  WorkflowCreativeBrief,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStatus
} from '../types'
import { uid } from '../util'
import { resolveModelId } from './models'
import { storyboardSourceFingerprint, storyboardSourceText } from './storyboardV2'

const COMMANDS = new Set<AgentCommandName>([
  'save_storyboard', 'materialize_images', 'generate_images',
  'create_videos', 'generate_videos', 'prepare_timeline'
])
const STEP_STATUSES = new Set<WorkflowStepStatus>(['pending', 'running', 'checkpoint', 'completed', 'error', 'canceled', 'stale'])
const RUN_STATUSES = new Set<WorkflowStatus>(['planned', 'running', 'paused', 'completed', 'error', 'canceled', 'stale'])
const ASSET_ROLES = new Set<AssetRole>(['character', 'scene', 'prop', 'voice', 'style', 'music', 'reference'])

const WORKFLOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'audience', 'aspect', 'totalDuration', 'ending', 'anchorSuggestions', 'shots'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    audience: { type: 'string' },
    aspect: { type: 'string' },
    totalDuration: { type: 'number' },
    ending: { type: 'string' },
    anchorSuggestions: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object', additionalProperties: false,
        required: ['role', 'name', 'description'],
        properties: {
          role: { type: 'string', enum: [...ASSET_ROLES] },
          name: { type: 'string' },
          description: { type: 'string' }
        }
      }
    },
    shots: {
      type: 'array', minItems: 1, maxItems: 50,
      items: {
        type: 'object', additionalProperties: false,
        required: ['shotNumber', 'desc', 'scene', 'character', 'action', 'emotion', 'shotSize', 'camera', 'duration', 'imagePrompt', 'videoPrompt', 'dialogue', 'sfx', 'anchorNames'],
        properties: {
          shotNumber: { type: 'number' }, desc: { type: 'string' }, scene: { type: 'string' },
          character: { type: 'string' }, action: { type: 'string' }, emotion: { type: 'string' },
          shotSize: { type: 'string' }, camera: { type: 'string' }, duration: { type: 'number' },
          imagePrompt: { type: 'string' }, videoPrompt: { type: 'string' }, dialogue: { type: 'string' }, sfx: { type: 'string' },
          anchorNames: { type: 'array', maxItems: 12, items: { type: 'string' } }
        }
      }
    }
  }
} as const

export interface WorkflowPlanningInput {
  sourceCard: Card
  sourceBoardId: string
  project?: ProjectDoc
  goal: string
  audience?: string
  aspect?: string
  totalDuration?: number
  ending?: string
  selectedSkillIds?: string[]
}

function cleanText(value: unknown, fallback = '', limit = 8000): string {
  return (typeof value === 'string' ? value : value == null ? '' : String(value)).trim().slice(0, limit) || fallback
}

function positive(value: unknown, fallback: number, max = 3600): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.min(max, n) : fallback
}

function normalizeShot(value: any, index: number): Shot {
  return {
    shotNumber: index + 1,
    desc: cleanText(value?.desc, `镜头 ${index + 1}`, 1200),
    scene: cleanText(value?.scene, '', 400),
    character: cleanText(value?.character, '', 400),
    action: cleanText(value?.action, '', 500),
    emotion: cleanText(value?.emotion, '', 200),
    shotSize: cleanText(value?.shotSize, '中景', 80),
    camera: cleanText(value?.camera, '固定镜头', 200),
    duration: positive(value?.duration, 5, 60),
    imagePrompt: cleanText(value?.imagePrompt, cleanText(value?.desc, '', 1200), 2400),
    videoPrompt: cleanText(value?.videoPrompt, cleanText(value?.action, '', 500), 2400),
    dialogue: cleanText(value?.dialogue, '', 1000),
    sfx: cleanText(value?.sfx, '', 500),
    anchorNames: Array.isArray(value?.anchorNames) ? [...new Set<string>(value.anchorNames.map((item: unknown) => cleanText(item, '', 100)).filter(Boolean))].slice(0, 12) : []
  }
}

export function normalizeWorkflowBrief(raw: unknown, fallback: Partial<WorkflowCreativeBrief> = {}): WorkflowCreativeBrief {
  const value = raw && typeof raw === 'object' ? raw as any : {}
  const rawShots: unknown[] = Array.isArray(value.shots) ? value.shots.slice(0, 50) : []
  const shots: Shot[] = rawShots.map((shot, index) => normalizeShot(shot, index)).filter((shot) => !!(shot.desc || shot.imagePrompt))
  const targetDuration = positive(value.totalDuration, shots.reduce((sum: number, shot: Shot) => sum + (shot.duration || 0), 0) || positive(fallback.totalDuration, 30))
  return {
    title: cleanText(value.title, fallback.title || '剧本转短片', 120),
    summary: cleanText(value.summary, fallback.summary || '', 1000),
    audience: cleanText(value.audience, fallback.audience || '通用观众', 200),
    aspect: cleanText(value.aspect, fallback.aspect || '16:9', 20),
    totalDuration: targetDuration,
    ending: cleanText(value.ending, fallback.ending || '自然收束', 500),
    anchorSuggestions: (Array.isArray(value.anchorSuggestions) ? value.anchorSuggestions : []).flatMap((item: any) => {
      const role = cleanText(item?.role) as AssetRole
      const name = cleanText(item?.name, '', 100)
      if (!ASSET_ROLES.has(role) || !name) return []
      return [{ role, name, description: cleanText(item?.description, '', 600) }]
    }).slice(0, 20),
    shots
  }
}

export function fixedWorkflowSteps(): WorkflowStep[] {
  const items: Array<[AgentCommandName, string, string, boolean]> = [
    ['save_storyboard', '确认创作规格', '检查受众、画幅、总时长、结尾和角色/场景设定后保存故事板。', true],
    ['materialize_images', '落地静帧卡片', '按镜头表幂等创建或同步图片卡片。', false],
    ['generate_images', '生成镜头静帧', '仅生成尚未完成或已失效的静帧卡片。', false],
    ['create_videos', '确认静帧并创建视频卡', '检查静帧后，以每镜选定图片作为首帧创建视频卡。', true],
    ['generate_videos', '生成视频片段', '按 Provider 能力与时长设置生成镜头视频。', false],
    ['prepare_timeline', '送入时间线', '选择所有已生成片段并打开时间线，最终合成仍由用户确认。', false]
  ]
  return items.map(([command, title, description, requiresApproval], index) => ({
    id: `step-${index + 1}-${command}`,
    command, title, description, requiresApproval,
    status: 'pending', outputCardIds: []
  }))
}

export function createWorkflowRun(input: WorkflowPlanningInput, brief: WorkflowCreativeBrief): WorkflowRun {
  const now = Date.now()
  return {
    version: 1,
    id: uid('workflow'),
    recipe: 'script-to-short-film',
    sourceBoardId: input.sourceBoardId,
    sourceCardId: input.sourceCard.id,
    goal: cleanText(input.goal, '把剧本制作成短片', 1200),
    status: 'planned',
    sourceFingerprint: storyboardSourceFingerprint(input.sourceCard),
    selectedSkillIds: [...new Set(input.selectedSkillIds || [])].slice(0, 12),
    brief,
    steps: fixedWorkflowSteps(),
    logs: [{ id: uid('log'), at: now, level: 'info', message: '创作计划已生成，等待确认。' }],
    createdAt: now,
    updatedAt: now
  }
}

function parseJson(content: unknown): unknown {
  const text = typeof content === 'string' ? content : ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('模型没有返回可解析的创作计划')
  try { return JSON.parse(match[0]) } catch { throw new Error('创作计划 JSON 解析失败，请重试') }
}

export async function planScriptWorkflow(input: WorkflowPlanningInput): Promise<WorkflowRun> {
  const source = storyboardSourceText(input.sourceCard)
  if (!source) throw new Error('请选择包含剧本、故事或创意说明的文本卡片')
  const model = await resolveModelId('text', input.sourceCard.modelId, null)
  const constraints = {
    goal: cleanText(input.goal, '把剧本制作成短片'),
    audience: cleanText(input.audience, '未指定'),
    aspect: cleanText(input.aspect, '16:9'),
    totalDuration: positive(input.totalDuration, 30),
    ending: cleanText(input.ending, '自然收束')
  }
  const board = input.project?.boards.find((item) => item.id === input.sourceBoardId)
  const allCards = input.project?.boards.flatMap((item) => Object.values(item.cards)) || []
  const contextualCardIds = [...new Set([
    ...(input.sourceCard.refIds || []),
    ...Object.values(board?.edges || {}).filter((edge) => edge.target === input.sourceCard.id).map((edge) => edge.source)
  ])].slice(0, 20)
  const projectContext = {
    stylePackId: board?.stylePackId || input.project?.stylePackId || '',
    customStyle: board?.style || input.project?.style || '',
    sourceAnchorRefs: input.sourceCard.anchorRefs || [],
    existingAnchors: Object.values(input.project?.assetAnchors || {}).slice(0, 80).map((anchor) => ({
      role: anchor.role,
      name: anchor.name,
      aliases: anchor.aliases,
      description: anchor.description,
      tags: anchor.tags,
      locked: anchor.locked,
      mediaAvailable: !anchor.mediaMissing
    })),
    referencedCards: contextualCardIds.flatMap((id) => {
      const card = allCards.find((candidate) => candidate.id === id)
      return card ? [{ kind: card.kind, title: card.title, text: (card.text || card.prompt || '').slice(0, 1600), hasMedia: !!(card.assetUrl || card.assetLocalPath) }] : []
    })
  }
  const option: AiOption = {
    ...(model ? { model } : {}),
    messages: [
      {
        role: 'system',
        content: '你是资深短片导演与分镜师。只负责把用户剧本整理为结构化创作规格和镜头草案；不要输出工具调用、命令、代码或执行步骤。静帧提示词描述单一可见时刻，视频提示词必须描述动作节奏和明确运镜。镜头总时长应接近目标时长，前后角色、服装、场景和道具保持连续。优先复用工程已有语义锚点的准确名称，并把每镜实际使用的名称写入 anchorNames；不得臆造已有锚点的媒体内容。画布风格应融入 imagePrompt 与 videoPrompt。'
      },
      { role: 'user', content: `创作约束：${JSON.stringify(constraints)}\n工程上下文：${JSON.stringify(projectContext)}\n\n原始剧本：\n${source.slice(0, 30000)}` }
    ],
    params: { responseFormat: 'json_schema', jsonSchema: WORKFLOW_SCHEMA as unknown as Record<string, unknown>, jsonSchemaName: 'short_film_creative_brief', strict: true },
    skills: input.selectedSkillIds?.length ? { mode: 'manual', skillIds: input.selectedSkillIds } : { mode: 'off' },
    mcp: { mode: 'off' },
    internalTools: [],
    capabilities: [],
    toolingPolicy: { enableInternalTools: false },
    maxToolSteps: 0
  }
  const response = await window.mulby.ai.call(option)
  const brief = normalizeWorkflowBrief(parseJson(response?.content), constraints)
  if (!brief.shots.length) throw new Error('创作计划没有有效镜头，请调整剧本后重试')
  return createWorkflowRun(input, brief)
}

export async function listEnabledWorkflowSkills(): Promise<AiSkillRecord[]> {
  try { return await window.mulby.ai.skills.listEnabled() } catch { return [] }
}

export async function previewWorkflowSkills(input: WorkflowPlanningInput): Promise<AiSkillPreview | null> {
  if (!input.selectedSkillIds?.length) return null
  try {
    return await window.mulby.ai.skills.preview({
      skillIds: input.selectedSkillIds,
      prompt: `${input.goal}\n${storyboardSourceText(input.sourceCard).slice(0, 3000)}`,
      option: { skills: { mode: 'manual', skillIds: input.selectedSkillIds }, mcp: { mode: 'off' }, internalTools: [], capabilities: [], toolingPolicy: { enableInternalTools: false } }
    })
  } catch {
    return null
  }
}

function validStep(raw: any): WorkflowStep | null {
  if (!raw || !COMMANDS.has(raw.command) || typeof raw.id !== 'string') return null
  return {
    id: raw.id.slice(0, 160),
    command: raw.command,
    title: cleanText(raw.title, raw.command, 160),
    description: cleanText(raw.description, '', 800),
    status: STEP_STATUSES.has(raw.status) ? (raw.status === 'running' ? 'pending' : raw.status) : 'pending',
    requiresApproval: !!raw.requiresApproval,
    ...(Number.isFinite(raw.approvedAt) ? { approvedAt: raw.approvedAt } : {}),
    ...(Number.isFinite(raw.startedAt) ? { startedAt: raw.startedAt } : {}),
    ...(Number.isFinite(raw.completedAt) ? { completedAt: raw.completedAt } : {}),
    outputCardIds: Array.isArray(raw.outputCardIds) ? ([...new Set<string>(raw.outputCardIds.map((value: unknown) => String(value)))].slice(0, 500)) : [],
    ...(typeof raw.error === 'string' && raw.error ? { error: raw.error.slice(0, 2000) } : {})
  }
}

/** 加载工程时清理外部/旧版本数据；running 降为 paused+pending，交由用户显式恢复。 */
export function sanitizeWorkflowRuns(project: ProjectDoc): Record<string, WorkflowRun> {
  const rawRuns = project.workflowRuns && typeof project.workflowRuns === 'object' && !Array.isArray(project.workflowRuns) ? project.workflowRuns : {}
  const result: Record<string, WorkflowRun> = {}
  for (const [key, raw] of Object.entries(rawRuns as Record<string, any>).slice(-50)) {
    if (!raw || raw.version !== 1 || raw.recipe !== 'script-to-short-film') continue
    const sourceCard = project.boards.flatMap((board) => Object.values(board.cards)).find((card) => card.id === raw.sourceCardId)
    if (!sourceCard || sourceCard.kind !== 'text') continue
    const steps: WorkflowStep[] = (Array.isArray(raw.steps) ? raw.steps as unknown[] : []).map((step) => validStep(step)).filter((step): step is WorkflowStep => !!step)
    const expectedCommands = fixedWorkflowSteps().map((step) => step.command)
    if (steps.length !== expectedCommands.length || steps.some((step, index) => step.command !== expectedCommands[index])) continue
    const id = cleanText(raw.id, key, 160)
    if (!id) continue
    const loadedStatus: WorkflowStatus = RUN_STATUSES.has(raw.status) ? raw.status : 'paused'
    const status = loadedStatus === 'running' ? 'paused' : loadedStatus
    result[id] = {
      version: 1, id, recipe: 'script-to-short-film',
      sourceBoardId: cleanText(raw.sourceBoardId, project.activeBoardId, 160),
      sourceCardId: sourceCard.id,
      goal: cleanText(raw.goal, '把剧本制作成短片', 1200),
      status,
      sourceFingerprint: cleanText(raw.sourceFingerprint, storyboardSourceFingerprint(sourceCard), 160),
      selectedSkillIds: Array.isArray(raw.selectedSkillIds) ? [...new Set<string>(raw.selectedSkillIds.map((value: unknown) => String(value)))].slice(0, 12) : [],
      brief: normalizeWorkflowBrief(raw.brief),
      steps,
      logs: (Array.isArray(raw.logs) ? raw.logs : []).slice(-200).flatMap((entry: any) => entry && typeof entry.message === 'string' ? [{
        id: cleanText(entry.id, uid('log'), 160), at: Number.isFinite(entry.at) ? entry.at : Date.now(),
        level: ['info', 'success', 'warning', 'error'].includes(entry.level) ? entry.level : 'info',
        message: entry.message.slice(0, 2000), ...(typeof entry.stepId === 'string' ? { stepId: entry.stepId } : {})
      }] : []) as WorkflowRun['logs'],
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
    }
  }
  return result
}
