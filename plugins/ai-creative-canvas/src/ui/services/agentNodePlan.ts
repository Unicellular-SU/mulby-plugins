import type {
  AgentNodePlanV1,
  AgentPlanCheckpoint,
  AgentPlannedInput,
  AgentPlannedNode,
  AssetAnchor,
  AssetRole,
  MaterialKind,
  ProjectDoc,
  WorkflowContinuitySubjectKind,
  WorkflowRun
} from '../types'
import { isRegisteredNodeKind, resolveNodeSpec } from './nodeSpecs'
import { assetAnchorsForBoard, materialFromAnchor } from './semanticAssets'
import { isUsableMaterial } from './references'
import {
  continuitySubjectKind,
  referencePrompt,
  visualContinuitySuggestions,
  workflowStylePrompt
} from './workflowContinuity'

const MATERIAL_KINDS = new Set<MaterialKind>(['image', 'video', 'audio', 'text'])
const ASSET_ROLES = new Set<AssetRole>(['character', 'scene', 'prop', 'voice', 'style', 'music', 'reference'])
const SUBJECT_KINDS = new Set<WorkflowContinuitySubjectKind>([
  'product-master', 'product-packaging', 'product-brand', 'product-action', 'product-detail',
  'character-master', 'scene', 'style', 'prop', 'reference'
])
const POLICIES = new Set<AgentPlannedNode['generationPolicy']>(['materialize-only', 'generate-after-approval', 'reuse-if-ready'])

function clean(value: unknown, max: number, fallback = ''): string {
  return (typeof value === 'string' ? value : value == null ? '' : String(value)).trim().slice(0, max) || fallback
}

function normalized(value: unknown): string {
  return clean(value, 1000).toLocaleLowerCase().replace(/[\s·•_\-—–:：,，。.!！?？()（）【】\[\]"'“”‘’]/g, '')
}

function idPart(value: unknown, fallback: string): string {
  const result = clean(value, 80).toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '')
  return result || fallback
}

function visualAnchorForSuggestion(run: WorkflowRun, project: ProjectDoc | undefined, name: string): AssetAnchor | undefined {
  if (!project) return undefined
  const wanted = normalized(name)
  return assetAnchorsForBoard(project, run.sourceBoardId).find((anchor) => {
    const names = [anchor.name, ...(anchor.aliases || [])].map(normalized)
    return names.includes(wanted) && anchor.mediaKind === 'image' && isUsableMaterial(materialFromAnchor(anchor, project))
  })
}

function sourceInput(run: WorkflowRun, purpose = '创作 Brief 与镜头上下文'): AgentPlannedInput {
  return { slot: 'references', sourceType: 'card', sourceId: run.sourceCardId, priority: 0, purpose }
}

function expected(kind: MaterialKind, quantity: number, purpose: string): AgentPlannedNode['expectedOutput'] {
  return { materialKind: kind, quantity, purpose }
}

function noOutput(purpose: string): AgentPlannedNode['expectedOutput'] {
  return { quantity: 0, purpose }
}

const EMPTY_SCENE_NAMES = new Set(['', '无', '无场景', '未指定', '未知', '不适用', 'none', 'n/a'])

function recurringScenes(run: WorkflowRun): Array<{ name: string; normalizedName: string }> {
  const counts = new Map<string, { name: string; count: number }>()
  for (const shot of run.brief.shots) {
    const name = clean(shot.scene, 160)
    const normalizedName = normalized(name)
    if (!normalizedName || EMPTY_SCENE_NAMES.has(name.toLocaleLowerCase()) || /^(无|未指定|未知|不适用)/.test(name)) continue
    const current = counts.get(normalizedName)
    counts.set(normalizedName, { name: current?.name || name, count: (current?.count || 0) + 1 })
  }
  return [...counts.entries()]
    .filter(([, item]) => item.count >= 2)
    .slice(0, 3)
    .map(([normalizedName, item]) => ({ name: item.name, normalizedName }))
}

/** 结构化对白可包含声线说明；TTS 只朗读引号内的实际台词。 */
export function spokenDialogue(value: unknown): string {
  const source = clean(value, 2000)
  if (!source) return ''
  const quoted = [...source.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1].trim()).filter(Boolean)
  if (quoted.length) return quoted.join('\n')
  return source.replace(/^[^：:]{1,80}[：:]\s*/, '').trim()
}

function shotUsesSuggestion(run: WorkflowRun, shotIndex: number, name: string, subjectKind: WorkflowContinuitySubjectKind): boolean {
  const shot = run.brief.shots[shotIndex]
  if (!shot) return false
  const wanted = normalized(name)
  if (!wanted) return false
  const explicit = new Set((shot.anchorNames || []).map(normalized))
  if (explicit.has(wanted)) return true
  const visible = normalized([shot.character, shot.scene, shot.desc, shot.action, shot.imagePrompt].filter(Boolean).join(' '))
  if (visible.includes(wanted)) return true
  if (subjectKind === 'product-master') {
    const product = normalized(run.brief.product?.productName)
    return !!product && visible.includes(product)
  }
  return false
}

function continuityDependencies(nodes: AgentPlannedNode[]): void {
  const master = nodes.find((node) => node.semanticSubjectKind === 'product-master')
  const packaging = nodes.find((node) => node.semanticSubjectKind === 'product-packaging')
  const character = nodes.find((node) => node.semanticSubjectKind === 'character-master')
  for (const node of nodes) {
    const dependencies: AgentPlannedNode[] = []
    if (master && node.id !== master.id && ['product-packaging', 'product-brand', 'product-action', 'product-detail'].includes(node.semanticSubjectKind || '')) dependencies.push(master)
    if (packaging && node.semanticSubjectKind === 'product-brand' && node.id !== packaging.id) dependencies.push(packaging)
    if (character && node.semanticSubjectKind === 'product-action' && node.id !== character.id) dependencies.push(character)
    node.dependsOn = dependencies.map((dependency) => dependency.id)
    node.inputs.push(...dependencies.map((dependency, index) => ({
      slot: 'references',
      sourceType: 'planned-node' as const,
      sourceId: dependency.id,
      priority: index + 1,
      purpose: dependency.semanticSubjectKind === 'product-master'
        ? '产品身份主参考'
        : dependency.semanticSubjectKind === 'character-master'
          ? '角色身份次参考'
          : '包装与品牌参考'
    })))
  }
}

/** 将现有 Creative Brief 确定性投影为节点计划；模型不直接提交节点、坐标或命令。 */
export function projectWorkflowNodePlan(run: WorkflowRun, project?: ProjectDoc): AgentNodePlanV1 {
  const directorGuide: AgentPlannedNode = {
    id: 'director-guide',
    kind: 'text',
    intent: '把创作 Brief 提炼为后续节点共用的简洁导演与提示词基准',
    title: '导演创作指南',
    prompt: [
      `为「${run.brief.title || run.goal}」编写一份简洁、可直接供后续图像和视频生成使用的导演创作指南。`,
      `最终画幅：${run.brief.aspect}；最终成片总时长：${run.brief.totalDuration}s。`,
      '只保留叙事目标、统一视觉语法、摄影/灯光/色彩、节奏、连续性禁区和品牌强制元素。不要改写对白，不要输出执行步骤。'
    ].join('\n'),
    params: { temperature: 0.3, shotCount: 0 },
    inputs: [sourceInput(run)],
    expectedOutput: expected('text', 1, '后续生成节点共用的导演创作基准'),
    generationPolicy: 'generate-after-approval',
    dependsOn: []
  }

  const continuity = visualContinuitySuggestions(run).map((suggestion, index): AgentPlannedNode => {
    const subjectKind = continuitySubjectKind(run, suggestion)
    const anchor = visualAnchorForSuggestion(run, project, suggestion.name)
    const planId = `continuity-${index + 1}-${idPart(suggestion.name, 'subject')}`
    return {
      id: planId,
      kind: 'image',
      intent: anchor ? `复用已就绪视觉设定「${suggestion.name}」` : `建立「${suggestion.name}」的统一视觉基准`,
      semanticRole: suggestion.role,
      semanticSubjectKind: subjectKind,
      title: `设定·${suggestion.name}`,
      prompt: referencePrompt(run, suggestion),
      params: { aspect: '1:1', resolution: '1K', count: 1 },
      inputs: anchor
        ? [{ slot: 'references', sourceType: 'anchor', sourceId: anchor.id, priority: 0, purpose: '复用已锁定或已有视觉基准' }]
        : [sourceInput(run), { slot: 'references', sourceType: 'planned-node', sourceId: directorGuide.id, priority: 1, purpose: '统一导演与视觉规则' }],
      expectedOutput: expected('image', 1, `${suggestion.name}的统一视觉身份参考`),
      generationPolicy: anchor ? 'reuse-if-ready' : 'generate-after-approval',
      dependsOn: []
    }
  })
  continuityDependencies(continuity)

  const environments = recurringScenes(run).map(({ name, normalizedName }, index): AgentPlannedNode => {
    const sceneContinuity = continuity.find((node) => node.semanticSubjectKind === 'scene' && normalized(node.title.replace(/^设定·/, '')) === normalizedName)
    const dependencies = [directorGuide, ...(sceneContinuity ? [sceneContinuity] : [])]
    return {
      id: `environment-${index + 1}-${idPart(name, 'scene')}`,
      kind: 'pano',
      intent: `建立重复场景「${name}」的 360° 空间环境基准`,
      semanticRole: 'scene',
      title: `全景·${name}`,
      prompt: [
        `为重复出现的核心场景「${name}」生成一张完整的 360° 等距柱状环境全景。`,
        '固定空间布局、材质、色彩、光线方向与可识别地标；画面无人物、无前景主体、无文字、无水印，左右边缘可无缝衔接。'
      ].join('\n'),
      params: { resolution: '2K' },
      inputs: dependencies.map((node, priority) => ({
        slot: 'references', sourceType: 'planned-node' as const, sourceId: node.id, priority,
        purpose: node.id === directorGuide.id ? '统一导演与视觉规则' : '场景视觉身份参考'
      })),
      expectedOutput: expected('image', 1, `${name}的固定 2:1 导演环境全景`),
      generationPolicy: 'generate-after-approval',
      dependsOn: dependencies.map((node) => node.id)
    }
  })

  const style = workflowStylePrompt(run)
  const stills = run.brief.shots.map((shot, index): AgentPlannedNode => {
    const linked = continuity.filter((node) => node.semanticSubjectKind !== 'style' && shotUsesSuggestion(run, index, node.title.replace(/^设定·/, ''), node.semanticSubjectKind || 'reference'))
    const environment = environments.find((node) => normalized(node.title.replace(/^全景·/, '')) === normalized(shot.scene))
    const dependencies = [directorGuide, ...linked, ...(environment ? [environment] : [])]
    const basePrompt = clean(shot.imagePrompt || shot.desc, 8000, `镜头 ${index + 1}`)
    return {
      id: `shot-image-${index + 1}`,
      kind: 'image',
      intent: `生成镜头 ${shot.shotNumber || index + 1} 的可确认静帧`,
      title: `镜${shot.shotNumber || index + 1}${shot.shotSize ? `·${shot.shotSize}` : ''}`,
      prompt: [basePrompt, style ? `视觉风格：${style}` : ''].filter(Boolean).join('\n'),
      params: { aspect: run.brief.aspect, resolution: '1K', count: 1 },
      inputs: [
        sourceInput(run, '镜头与故事上下文'),
        ...dependencies.map((node, priority) => ({
          slot: 'references', sourceType: 'planned-node' as const, sourceId: node.id,
          priority: priority + 1,
          purpose: node.id === directorGuide.id ? '统一导演与提示词基准' : node.kind === 'pano' ? '镜头空间环境参考' : `${node.title.replace(/^设定·/, '')}视觉身份参考`
        }))
      ],
      expectedOutput: expected('image', 1, `镜头 ${shot.shotNumber || index + 1} 的首帧与构图基准`),
      generationPolicy: 'generate-after-approval',
      dependsOn: dependencies.map((node) => node.id)
    }
  })

  const videos = run.brief.shots.map((shot, index): AgentPlannedNode => {
    const still = stills[index]
    const plannedDuration = Number(shot.duration || 5)
    return {
      id: `shot-video-${index + 1}`,
      kind: 'video',
      intent: `由镜头 ${shot.shotNumber || index + 1} 的已确认静帧生成视频素材`,
      title: `片${shot.shotNumber || index + 1}`,
      prompt: clean(shot.videoPrompt || shot.action || shot.desc, 8000, `镜头 ${index + 1} 动态`),
      params: { aspect: run.brief.aspect, plannedDuration, refMode: 'omni' },
      inputs: [{ slot: 'image-references', sourceType: 'planned-node', sourceId: still.id, priority: 0, purpose: '首帧与主体身份参考' }],
      expectedOutput: expected('video', 1, `成片使用 ${plannedDuration}s 的镜头视频素材`),
      generationPolicy: 'generate-after-approval',
      dependsOn: [still.id]
    }
  })

  let elapsed = 0
  const audio = run.brief.shots.flatMap((shot, index): AgentPlannedNode[] => {
    const timelineOffset = elapsed
    elapsed += Number(shot.duration || 0)
    const dialogue = spokenDialogue(shot.dialogue)
    if (!dialogue) return []
    return [{
      id: `shot-audio-${index + 1}`,
      kind: 'audio',
      intent: `为镜头 ${shot.shotNumber || index + 1} 生成与时间线对齐的对白或旁白`,
      title: `配音${shot.shotNumber || index + 1}`,
      prompt: dialogue,
      params: { voice: 'alloy', speed: 1, format: 'mp3' },
      inputs: [],
      expectedOutput: expected('audio', 1, `镜头 ${shot.shotNumber || index + 1} 的配音，时间线偏移 ${timelineOffset}s`),
      generationPolicy: 'generate-after-approval',
      dependsOn: []
    }]
  })

  const groupDefinitions = [
    { id: 'group-planning', title: '分组·创作策划', color: '#8b5cf6', members: [directorGuide] },
    { id: 'group-continuity', title: '分组·视觉设定', color: '#06b6d4', members: continuity },
    { id: 'group-environments', title: '分组·空间环境', color: '#10b981', members: environments },
    { id: 'group-stills', title: '分组·镜头静帧', color: '#f59e0b', members: stills },
    { id: 'group-media', title: '分组·视频与配音', color: '#ec4899', members: [...videos, ...audio] }
  ]
  const groups: AgentPlannedNode[] = groupDefinitions.filter((group) => group.members.length).map((group) => ({
    id: group.id,
    kind: 'group',
    intent: '仅在本地整理本次 Agent 新建的阶段产物，不调用模型、不移动用户卡片',
    title: group.title,
    prompt: '',
    params: { color: group.color, collapsed: false },
    inputs: [],
    expectedOutput: noOutput('画布阶段分组，不产生媒体'),
    generationPolicy: 'materialize-only',
    dependsOn: group.members.map((node) => node.id)
  }))

  const checkpoints: AgentPlanCheckpoint[] = [
    {
      id: 'checkpoint-brief', title: '确认创作规格', description: '确认画幅、总时长、镜头和视觉主体后才开始创建生成卡片。',
      afterNodeIds: [], requiresApproval: true
    },
    ...(continuity.length ? [{
      id: 'checkpoint-continuity', title: '确认并锁定视觉设定', description: '确认人物、产品、包装、Logo、道具和场景身份后再生成镜头。',
      afterNodeIds: continuity.map((node) => node.id), requiresApproval: true
    }] : []),
    ...(environments.length ? [{
      id: 'checkpoint-environments', title: '确认并应用全景环境', description: '确认核心场景的空间、光线和材质后，再将全景载入 3D 导演台。',
      afterNodeIds: environments.map((node) => node.id), requiresApproval: true
    }] : []),
    {
      id: 'checkpoint-stills', title: '确认静帧并创建视频卡', description: '确认所有镜头静帧后才提交视频任务。',
      afterNodeIds: stills.map((node) => node.id), requiresApproval: true
    },
    ...(audio.length ? [{
      id: 'checkpoint-audio', title: '确认镜头台词', description: '确认实际朗读文本和音色后再创建配音；导演说明不会被朗读。',
      afterNodeIds: audio.map((node) => node.id), requiresApproval: true
    }] : [])
  ]

  return {
    version: 1,
    id: `node-plan-${run.id}`,
    boardId: run.sourceBoardId,
    goal: run.goal,
    capabilitySnapshotHash: run.capabilitySnapshotHash || '',
    nodes: [directorGuide, ...continuity, ...environments, ...stills, ...videos, ...audio, ...groups],
    checkpoints
  }
}

function paramValue(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, 1000)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  return undefined
}

function sanitizeInput(raw: any): AgentPlannedInput | null {
  const sourceType = raw?.sourceType
  if (!['card', 'anchor', 'planned-node'].includes(sourceType)) return null
  const slot = clean(raw?.slot, 80)
  const sourceId = clean(raw?.sourceId, 160)
  if (!slot || !sourceId) return null
  const priority = Math.max(0, Math.min(1000, Math.floor(Number(raw?.priority) || 0)))
  return { slot, sourceType, sourceId, priority, purpose: clean(raw?.purpose, 300) }
}

/** 工程恢复时只保留计划 Schema 白名单字段；坐标、路径、Provider URL 和任意命令都会被丢弃。 */
export function sanitizeAgentNodePlan(raw: unknown, boardId?: string): AgentNodePlanV1 | null {
  const value = raw as any
  if (!value || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.checkpoints)) return null
  const id = clean(value.id, 160)
  const resolvedBoardId = clean(value.boardId, 160)
  if (!id || !resolvedBoardId || (boardId && resolvedBoardId !== boardId)) return null
  const nodes: AgentPlannedNode[] = value.nodes.slice(0, 128).flatMap((rawNode: any) => {
    if (!rawNode || !isRegisteredNodeKind(rawNode.kind)) return []
    const nodeId = clean(rawNode.id, 160)
    if (!nodeId) return []
    const allowedParamKeys = new Set(resolveNodeSpec(rawNode.kind).params.map((param) => param.key))
    const params = Object.fromEntries(Object.entries(rawNode.params && typeof rawNode.params === 'object' && !Array.isArray(rawNode.params) ? rawNode.params : {})
      .slice(0, 40).flatMap(([key, item]) => {
        const next = paramValue(item)
        return next === undefined || !allowedParamKeys.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key) ? [] : [[clean(key, 80), next]]
      }))
    const materialKind = MATERIAL_KINDS.has(rawNode.expectedOutput?.materialKind) ? rawNode.expectedOutput.materialKind as MaterialKind : undefined
    const generationPolicy = POLICIES.has(rawNode.generationPolicy) ? rawNode.generationPolicy : 'materialize-only'
    const inputs = (Array.isArray(rawNode.inputs) ? rawNode.inputs as unknown[] : []).slice(0, 32)
      .map((item) => sanitizeInput(item)).filter((input): input is AgentPlannedInput => !!input)
    return [{
      id: nodeId,
      kind: rawNode.kind,
      intent: clean(rawNode.intent, 500),
      ...(ASSET_ROLES.has(rawNode.semanticRole) ? { semanticRole: rawNode.semanticRole as AssetRole } : {}),
      ...(SUBJECT_KINDS.has(rawNode.semanticSubjectKind) ? { semanticSubjectKind: rawNode.semanticSubjectKind as WorkflowContinuitySubjectKind } : {}),
      title: clean(rawNode.title, 160, rawNode.kind),
      prompt: clean(rawNode.prompt, 8000),
      params,
      inputs,
      expectedOutput: {
        ...(materialKind ? { materialKind } : {}),
        quantity: Math.max(0, Math.min(20, Math.floor(Number(rawNode.expectedOutput?.quantity) || 0))),
        purpose: clean(rawNode.expectedOutput?.purpose, 500)
      },
      generationPolicy,
      dependsOn: [...new Set<string>((Array.isArray(rawNode.dependsOn) ? rawNode.dependsOn : []).map((item: unknown) => clean(item, 160)).filter(Boolean))].slice(0, 64)
    }]
  })
  const checkpoints: AgentPlanCheckpoint[] = value.checkpoints.slice(0, 20).flatMap((rawCheckpoint: any) => {
    const checkpointId = clean(rawCheckpoint?.id, 160)
    if (!checkpointId) return []
    return [{
      id: checkpointId,
      title: clean(rawCheckpoint.title, 160, '用户检查点'),
      description: clean(rawCheckpoint.description, 800),
      afterNodeIds: [...new Set<string>((Array.isArray(rawCheckpoint.afterNodeIds) ? rawCheckpoint.afterNodeIds : []).map((item: unknown) => clean(item, 160)).filter(Boolean))].slice(0, 128),
      requiresApproval: !!rawCheckpoint.requiresApproval
    }]
  })
  return {
    version: 1,
    id,
    boardId: resolvedBoardId,
    goal: clean(value.goal, 1200),
    capabilitySnapshotHash: clean(value.capabilitySnapshotHash, 160),
    nodes,
    checkpoints
  }
}

export function plannedNodesForCommand(run: WorkflowRun, command: string): AgentPlannedNode[] {
  const nodes = run.nodePlan?.nodes || []
  if (command === 'materialize_texts' || command === 'generate_texts') return nodes.filter((node) => node.kind === 'text')
  if (command === 'materialize_continuity' || command === 'generate_continuity' || command === 'lock_continuity') return nodes.filter((node) => !!node.semanticSubjectKind)
  if (command === 'materialize_environments' || command === 'generate_environments' || command === 'apply_environment') return nodes.filter((node) => node.kind === 'pano')
  if (command === 'materialize_images' || command === 'generate_images') return nodes.filter((node) => node.kind === 'image' && !node.semanticSubjectKind)
  if (command === 'create_videos' || command === 'generate_videos') return nodes.filter((node) => node.kind === 'video')
  if (command === 'create_audio' || command === 'generate_audio') return nodes.filter((node) => node.kind === 'audio')
  if (command === 'organize_groups') return nodes.filter((node) => node.kind === 'group')
  if (command === 'prepare_timeline') return nodes.filter((node) => node.kind === 'video' || node.kind === 'audio')
  return []
}
