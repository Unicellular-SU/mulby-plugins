import type {
  AgentCommandName,
  AssetRole,
  Card,
  ProjectDoc,
  Shot,
  WorkflowCreativeBrief,
  WorkflowProductBrief,
  WorkflowRecipeId,
  WorkflowRun,
  WorkflowStep,
  WorkflowStepStatus,
  WorkflowStatus
} from '../types'
import { uid } from '../util'
import { resolveModelId } from './models'
import { storyboardSourceFingerprint, storyboardSourceText } from './storyboardV2'
import { getWorkflowRecipe, isWorkflowRecipeId } from './workflowRecipes'
import { assetAnchorsForBoard } from './semanticAssets'

const COMMANDS = new Set<AgentCommandName>([
  'save_storyboard', 'materialize_continuity', 'generate_continuity', 'lock_continuity',
  'materialize_images', 'generate_images',
  'create_videos', 'generate_videos', 'prepare_timeline'
])
const LEGACY_COMMANDS: AgentCommandName[] = [
  'save_storyboard', 'materialize_images', 'generate_images',
  'create_videos', 'generate_videos', 'prepare_timeline'
]
const STEP_STATUSES = new Set<WorkflowStepStatus>(['pending', 'running', 'checkpoint', 'completed', 'error', 'canceled', 'stale'])
const RUN_STATUSES = new Set<WorkflowStatus>(['planned', 'running', 'paused', 'completed', 'error', 'canceled', 'stale'])
const ASSET_ROLES = new Set<AssetRole>(['character', 'scene', 'prop', 'voice', 'style', 'music', 'reference'])

const WORKFLOW_PROPERTIES = {
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
} as const

const SCRIPT_WORKFLOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'audience', 'aspect', 'totalDuration', 'ending', 'anchorSuggestions', 'shots'],
  properties: WORKFLOW_PROPERTIES
} as const

const PRODUCT_WORKFLOW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'audience', 'aspect', 'totalDuration', 'ending', 'anchorSuggestions', 'shots', 'product'],
  properties: {
    ...WORKFLOW_PROPERTIES,
    product: {
      type: 'object',
      additionalProperties: false,
      required: ['productName', 'brandText', 'campaignObjective', 'coreProposition', 'sellingPoints', 'mandatoryElements', 'callToAction'],
      properties: {
        productName: { type: 'string' },
        brandText: { type: 'string' },
        campaignObjective: { type: 'string' },
        coreProposition: { type: 'string' },
        sellingPoints: { type: 'array', maxItems: 12, items: { type: 'string' } },
        mandatoryElements: { type: 'array', maxItems: 12, items: { type: 'string' } },
        callToAction: { type: 'string' }
      }
    }
  }
} as const

export interface WorkflowPlanningInput {
  recipe?: WorkflowRecipeId
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

function cleanList(value: unknown, limit = 12): string[] {
  return Array.isArray(value)
    ? [...new Set<string>(value.map((item) => cleanText(item, '', 300)).filter(Boolean))].slice(0, limit)
    : []
}

function normalizeProductBrief(value: any, fallback?: Partial<WorkflowProductBrief>): WorkflowProductBrief {
  const sellingPoints = cleanList(value?.sellingPoints)
  const mandatoryElements = cleanList(value?.mandatoryElements)
  return {
    productName: cleanText(value?.productName, fallback?.productName || '未命名产品', 160),
    brandText: cleanText(value?.brandText, fallback?.brandText || '', 160) || undefined,
    campaignObjective: cleanText(value?.campaignObjective, fallback?.campaignObjective || '建立产品认知', 500),
    coreProposition: cleanText(value?.coreProposition, fallback?.coreProposition || '', 800),
    sellingPoints: sellingPoints.length ? sellingPoints : cleanList(fallback?.sellingPoints),
    mandatoryElements: mandatoryElements.length ? mandatoryElements : cleanList(fallback?.mandatoryElements),
    callToAction: cleanText(value?.callToAction, fallback?.callToAction || '', 500)
  }
}

/** 把各镜头的“剪辑使用时长”按权重缩放到目标成片总时长，精确到 0.1 秒。 */
export function fitShotsToTotalDuration(shots: Shot[], totalDuration: number): Shot[] {
  if (!shots.length) return []
  const targetUnits = Math.max(shots.length, Math.round(positive(totalDuration, shots.length / 10) * 10))
  const remainingUnits = targetUnits - shots.length
  const weights = shots.map((shot) => positive(shot.duration, 1, 3600))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || shots.length
  const shares = weights.map((weight) => (remainingUnits * weight) / weightTotal)
  const extra = shares.map(Math.floor)
  let undistributed = remainingUnits - extra.reduce((sum, value) => sum + value, 0)
  const order = shares.map((share, index) => ({ index, remainder: share - extra[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (let index = 0; index < undistributed; index++) extra[order[index % order.length].index]++
  return shots.map((shot, index) => ({ ...shot, duration: (1 + extra[index]) / 10 }))
}

export function normalizeWorkflowBrief(raw: unknown, fallback: Partial<WorkflowCreativeBrief> = {}, recipe?: WorkflowRecipeId, targetTotalDuration?: number): WorkflowCreativeBrief {
  const value = raw && typeof raw === 'object' ? raw as any : {}
  const rawShots: unknown[] = Array.isArray(value.shots) ? value.shots.slice(0, 50) : []
  const normalizedShots: Shot[] = rawShots.map((shot, index) => normalizeShot(shot, index)).filter((shot) => !!(shot.desc || shot.imagePrompt))
  const reportedDuration = positive(value.totalDuration, normalizedShots.reduce((sum: number, shot: Shot) => sum + (shot.duration || 0), 0) || positive(fallback.totalDuration, 30))
  const targetDuration = positive(targetTotalDuration, reportedDuration)
  const shots = fitShotsToTotalDuration(normalizedShots, targetDuration)
  const product = recipe === 'product-ad-film' || value.product || fallback.product
    ? normalizeProductBrief(value.product, fallback.product)
    : undefined
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
    shots,
    ...(product ? { product } : {})
  }
}

export function fixedWorkflowSteps(recipe: WorkflowRecipeId = 'script-to-short-film'): WorkflowStep[] {
  return getWorkflowRecipe(recipe).steps.map(({ command, title, description, requiresApproval }, index) => ({
    id: `step-${index + 1}-${command}`,
    command, title, description, requiresApproval,
    status: 'pending', outputCardIds: []
  }))
}

export function createWorkflowRun(input: WorkflowPlanningInput, brief: WorkflowCreativeBrief): WorkflowRun {
  const now = Date.now()
  const recipe = input.recipe || 'script-to-short-film'
  const definition = getWorkflowRecipe(recipe)
  return {
    version: 1,
    id: uid('workflow'),
    recipe,
    sourceBoardId: input.sourceBoardId,
    sourceCardId: input.sourceCard.id,
    goal: cleanText(input.goal, definition.defaultGoal, 1200),
    status: 'planned',
    sourceFingerprint: storyboardSourceFingerprint(input.sourceCard),
    selectedSkillIds: [...new Set(input.selectedSkillIds || [])].slice(0, 12),
    brief,
    steps: fixedWorkflowSteps(recipe),
    logs: [{ id: uid('log'), at: now, level: 'info', message: `「${definition.label}」计划已生成，等待确认。` }],
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

export async function planWorkflow(input: WorkflowPlanningInput): Promise<WorkflowRun> {
  const recipe = input.recipe || 'script-to-short-film'
  const definition = getWorkflowRecipe(recipe)
  const source = storyboardSourceText(input.sourceCard)
  if (!source) throw new Error(`请选择包含${definition.sourceLabel.replace('卡片', '')}内容的文本卡片`)
  const model = await resolveModelId('text', input.sourceCard.modelId, null)
  const constraints = {
    goal: cleanText(input.goal, definition.defaultGoal),
    audience: cleanText(input.audience, '未指定'),
    aspect: cleanText(input.aspect, '16:9'),
    totalDuration: positive(input.totalDuration, definition.defaultDuration),
    ending: cleanText(input.ending, definition.defaultEnding)
  }
  const board = input.project?.boards.find((item) => item.id === input.sourceBoardId)
  const boardCards = Object.values(board?.cards || {})
  const boardAnchors = input.project ? assetAnchorsForBoard(input.project, input.sourceBoardId) : []
  const boardAnchorIds = new Set(boardAnchors.map((anchor) => anchor.id))
  const contextualCardIds = [...new Set([
    ...(input.sourceCard.refIds || []),
    ...Object.values(board?.edges || {}).filter((edge) => edge.target === input.sourceCard.id).map((edge) => edge.source)
  ])].slice(0, 20)
  const projectContext = {
    stylePackId: board?.stylePackId || input.project?.stylePackId || '',
    customStyle: board?.style || input.project?.style || '',
    sourceAnchorRefs: (input.sourceCard.anchorRefs || []).filter((reference) => boardAnchorIds.has(reference.anchorId)),
    existingAnchors: boardAnchors.slice(0, 80).map((anchor) => ({
      role: anchor.role,
      name: anchor.name,
      aliases: anchor.aliases,
      description: anchor.description,
      tags: anchor.tags,
      locked: anchor.locked,
      mediaAvailable: !anchor.mediaMissing
    })),
    referencedCards: contextualCardIds.flatMap((id) => {
      const card = boardCards.find((candidate) => candidate.id === id)
      return card ? [{ kind: card.kind, title: card.title, description: (card.text || card.prompt || '').slice(0, 1600), hasMedia: !!(card.assetUrl || card.assetLocalPath) }] : []
    })
  }
  const schema = recipe === 'product-ad-film' ? PRODUCT_WORKFLOW_SCHEMA : SCRIPT_WORKFLOW_SCHEMA
  const option: AiOption = {
    ...(model ? { model } : {}),
    messages: [
      {
        role: 'system',
        content: definition.systemPrompt
      },
      { role: 'user', content: `创作约束：${JSON.stringify(constraints)}\n工程上下文：${JSON.stringify(projectContext)}\n\n${definition.sourceHeading}：\n${source.slice(0, 30000)}` }
    ],
    params: { responseFormat: 'json_schema', jsonSchema: schema as unknown as Record<string, unknown>, jsonSchemaName: definition.schemaName, strict: true },
    skills: input.selectedSkillIds?.length ? { mode: 'manual', skillIds: input.selectedSkillIds } : { mode: 'off' },
    mcp: { mode: 'off' },
    internalTools: [],
    capabilities: [],
    toolingPolicy: { enableInternalTools: false },
    maxToolSteps: 0
  }
  const response = await window.mulby.ai.call(option)
  const brief = normalizeWorkflowBrief(parseJson(response?.content), { ...constraints, title: definition.label }, recipe, constraints.totalDuration)
  if (!brief.shots.length) throw new Error(`创作计划没有有效镜头，请调整${definition.sourceLabel.replace('卡片', '')}后重试`)
  return createWorkflowRun({ ...input, recipe }, brief)
}

/** 兼容现有调用方；新界面使用 planWorkflow 按所选配方规划。 */
export async function planScriptWorkflow(input: WorkflowPlanningInput): Promise<WorkflowRun> {
  return planWorkflow({ ...input, recipe: 'script-to-short-film' })
}

export async function listEnabledWorkflowSkills(): Promise<AiSkillRecord[]> {
  try { return await window.mulby.ai.skills.listEnabled() } catch { return [] }
}

export async function previewWorkflowSkills(input: WorkflowPlanningInput): Promise<AiSkillPreview | null> {
  if (!input.selectedSkillIds?.length) return null
  const definition = getWorkflowRecipe(input.recipe || 'script-to-short-film')
  try {
    return await window.mulby.ai.skills.preview({
      skillIds: input.selectedSkillIds,
      prompt: `${definition.label}\n${input.goal}\n${storyboardSourceText(input.sourceCard).slice(0, 3000)}`,
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
    if (!raw || raw.version !== 1 || !isWorkflowRecipeId(raw.recipe)) continue
    const recipe = raw.recipe
    const definition = getWorkflowRecipe(recipe)
    const sourceCard = project.boards.flatMap((board) => Object.values(board.cards)).find((card) => card.id === raw.sourceCardId)
    if (!sourceCard || sourceCard.kind !== 'text') continue
    const parsedSteps: WorkflowStep[] = (Array.isArray(raw.steps) ? raw.steps as unknown[] : []).map((step) => validStep(step)).filter((step): step is WorkflowStep => !!step)
    const canonicalSteps = fixedWorkflowSteps(recipe)
    const isCanonical = parsedSteps.length === canonicalSteps.length && parsedSteps.every((step, index) => step.command === canonicalSteps[index].command)
    const isLegacy = parsedSteps.length === LEGACY_COMMANDS.length && parsedSteps.every((step, index) => step.command === LEGACY_COMMANDS[index])
    if (!isCanonical && !isLegacy) continue
    const migratedSteps = isLegacy
      ? canonicalSteps.map((canonical) => {
          const legacy = parsedSteps.find((step) => step.command === canonical.command)
          if (legacy) return legacy
          const at = Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now()
          return {
            ...canonical,
            status: 'completed' as const,
            completedAt: at,
            ...(canonical.requiresApproval ? { approvedAt: at } : {})
          }
        })
      : parsedSteps
    // 标题、说明和检查点权限来自本地配方，不信任工程文件中的可篡改副本。
    const steps = migratedSteps.map((step, index) => ({
      ...step,
      title: canonicalSteps[index].title,
      description: canonicalSteps[index].description,
      requiresApproval: canonicalSteps[index].requiresApproval
    }))
    const id = cleanText(raw.id, key, 160)
    if (!id) continue
    const loadedStatus: WorkflowStatus = RUN_STATUSES.has(raw.status) ? raw.status : 'paused'
    const status = loadedStatus === 'running' ? 'paused' : loadedStatus
    result[id] = {
      version: 1, id, recipe,
      sourceBoardId: cleanText(raw.sourceBoardId, project.activeBoardId, 160),
      sourceCardId: sourceCard.id,
      goal: cleanText(raw.goal, definition.defaultGoal, 1200),
      status,
      sourceFingerprint: cleanText(raw.sourceFingerprint, storyboardSourceFingerprint(sourceCard), 160),
      selectedSkillIds: Array.isArray(raw.selectedSkillIds) ? [...new Set<string>(raw.selectedSkillIds.map((value: unknown) => String(value)))].slice(0, 12) : [],
      brief: normalizeWorkflowBrief(raw.brief, { title: definition.label, totalDuration: definition.defaultDuration, ending: definition.defaultEnding }, recipe),
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
