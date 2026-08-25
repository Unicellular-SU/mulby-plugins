import type {
  AgentCommandName,
  AgentPlannedNode,
  Card,
  CardKind,
  DirectorEnvironment,
  DirectorScene,
  WorkflowOwnershipV1,
  WorkflowRun
} from '../types'
import { useGraph } from '../store/graphStore'
import { uid } from '../util'
import { findFreeCardSpot } from './cardPlacement'
import { loadImageInput } from './media'
import { materialFromAnchor } from './semanticAssets'
import { plannedNodesForCommand } from './agentNodePlan'
import { runnableAgentNodes } from './agentNodeRuntime'

const MATERIALIZED_KINDS = new Set<CardKind>(['text', 'pano'])
const DIRECTOR_ASSET_LIMIT_BYTES = 50 * 1024 * 1024

function ownershipOf(card: Card | undefined): WorkflowOwnershipV1 | undefined {
  return (card?.meta as any)?.workflowOwnershipV1 as WorkflowOwnershipV1 | undefined
}

export function ownedCardForPlanNode(run: WorkflowRun, planNodeId: string): Card | undefined {
  const board = useGraph.getState().project.boards.find((candidate) => candidate.id === run.sourceBoardId)
  return Object.values(board?.cards || {}).find((card) => {
    const ownership = ownershipOf(card)
    return ownership?.runId === run.id && ownership.planNodeId === planNodeId && ownership.boardId === run.sourceBoardId
  })
}

function createOperation(run: WorkflowRun, planNodeId: string) {
  return run.compiledPlan?.operations.find((operation) => operation.type === 'create-owned-card' && operation.planNodeId === planNodeId)
}

export function workflowOwnershipForNode(run: WorkflowRun, planNodeId: string): WorkflowOwnershipV1 {
  const operation = createOperation(run, planNodeId)
  return {
    version: 1,
    runId: run.id,
    planNodeId,
    operationId: operation?.id || `op-create-${planNodeId}`,
    createdBy: 'agent',
    boardId: run.sourceBoardId
  }
}

/** 只解析当前工作流画布中的输入；计划节点优先返回同一 run 拥有的卡片。 */
export function resolvedPlanInputCardIds(run: WorkflowRun, node: AgentPlannedNode): string[] {
  const graph = useGraph.getState()
  const project = graph.project
  const board = project.boards.find((candidate) => candidate.id === run.sourceBoardId)
  if (!board) return []
  return [...node.inputs].sort((left, right) => left.priority - right.priority).flatMap((input) => {
    if (input.sourceType === 'card') return board.cards[input.sourceId] ? [input.sourceId] : []
    if (input.sourceType === 'planned-node') {
      const owned = ownedCardForPlanNode(run, input.sourceId)
      if (owned && board.cards[owned.id]) return [owned.id]
      const planned = run.nodePlan?.nodes.find((candidate) => candidate.id === input.sourceId)
      if (planned?.generationPolicy === 'reuse-if-ready' && planned.inputs[0]) {
        return resolvedPlanInputCardIds(run, planned)
      }
      return []
    }
    const anchor = Object.values(project.assetAnchors || {}).find((candidate) => candidate.id === input.sourceId && candidate.source?.boardId === run.sourceBoardId)
    if (!anchor) return []
    const material = materialFromAnchor(anchor, project)
    return material.cardId && board.cards[material.cardId] ? [material.cardId] : []
  }).filter((id, index, ids) => ids.indexOf(id) === index)
}

function sameRecord(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function centerForNewCard(run: WorkflowRun, kind: CardKind, ordinal: number): { x: number; y: number } {
  const graph = useGraph.getState()
  const board = graph.project.boards.find((candidate) => candidate.id === run.sourceBoardId)!
  const source = board.cards[run.sourceCardId]
  const sizes = kind === 'text' ? { w: 340, h: 240 } : { w: 400, h: 240 }
  return findFreeCardSpot(
    board,
    sizes.w,
    sizes.h,
    (source?.x || 0) + (source?.w || 320) + 220 + ordinal * 40,
    (source?.y || 0) - 220 + ordinal * 40
  )
}

/** 物化由编译器授权的文本/全景卡；仅更新同一 run 已拥有的卡片。 */
export function materializeWorkflowPlanCards(run: WorkflowRun, command: AgentCommandName): string[] {
  const graph = useGraph.getState()
  const board = graph.project.boards.find((candidate) => candidate.id === run.sourceBoardId)
  if (!board) throw new Error('工作流画布已不存在')
  const nodes = runnableAgentNodes(run, plannedNodesForCommand(run, command)).filter((node) => MATERIALIZED_KINDS.has(node.kind))
  const ids: string[] = []
  nodes.forEach((node, index) => {
    const operation = createOperation(run, node.id)
    if (!operation || operation.type !== 'create-owned-card' || operation.kind !== node.kind) {
      throw new Error(`节点 ${node.title} 没有通过本地计划编译器授权`)
    }
    const refs = resolvedPlanInputCardIds(run, node)
    const existing = ownedCardForPlanNode(run, node.id)
    const ownership = workflowOwnershipForNode(run, node.id)
    graph.applyGraphTransaction(`准备${node.title}`, (tx) => {
      if (!existing) {
        const center = centerForNewCard(run, node.kind, index)
        const id = tx.createCard(node.kind, center, {
          ...(node.kind === 'text' ? { w: 340, h: 240 } : { w: 400, h: 240 }),
          title: operation.title,
          prompt: operation.prompt,
          params: { ...operation.resolvedParams },
          refIds: refs,
          meta: {
            workflowOwnershipV1: ownership,
            ...(node.kind === 'pano' ? { pano: true } : {})
          }
        })
        for (const refId of refs) tx.ensureEdge(refId, id, 'ref')
        ids.push(id)
        return
      }
      const hasOutput = node.kind === 'text'
        ? !!String(existing.text || '').trim()
        : !!(existing.assetUrl || existing.assetLocalPath)
      const changed = existing.title !== operation.title
        || existing.prompt !== operation.prompt
        || !sameRecord(existing.params, operation.resolvedParams)
        || !sameRecord(existing.refIds, refs)
      const meta = {
        ...(existing.meta || {}),
        workflowOwnershipV1: ownership,
        ...(node.kind === 'pano' ? { pano: true } : {}),
        ...(hasOutput && changed ? { storyboardInputStale: true } : {})
      }
      tx.updateCard(existing.id, {
        title: operation.title,
        prompt: operation.prompt,
        params: { ...operation.resolvedParams },
        refIds: refs,
        meta
      })
      for (const refId of refs) tx.ensureEdge(refId, existing.id, 'ref')
      ids.push(existing.id)
    }, run.sourceBoardId)
  })
  return ids
}

function panoramaMime(card: Card): string {
  if (card.mime?.startsWith('image/')) return card.mime
  if (/\.png(?:$|\?)/i.test(card.assetLocalPath || card.assetUrl || '')) return 'image/png'
  if (/\.webp(?:$|\?)/i.test(card.assetLocalPath || card.assetUrl || '')) return 'image/webp'
  return 'image/jpeg'
}

function defaultDirectorScene(environment: DirectorEnvironment): DirectorScene {
  return {
    schemaVersion: 2,
    subjects: [],
    cam: { pos: [0, 1.5, 4], target: [0, 1, 0], focal: 35 },
    shots: [],
    environment
  }
}

/** 将首个 Agent 全景复制进导演工程独立附件；不覆盖用户已经选择的其他环境。 */
export async function applyWorkflowPrimaryEnvironment(run: WorkflowRun): Promise<string[]> {
  const cards = runnableAgentNodes(run, plannedNodesForCommand(run, 'apply_environment'))
    .map((node) => ownedCardForPlanNode(run, node.id))
    .filter((card): card is Card => !!card && card.status === 'done' && !!(card.assetUrl || card.assetLocalPath))
  if (!cards.length) return []
  const source = cards[0]
  const current = useGraph.getState().project.director
  if (current?.environment?.sourceCardId === source.id) return [source.id]
  if (current?.environment && current.environment.sourceCardId !== source.id) return [source.id]
  const bytes = await loadImageInput({ url: source.assetUrl || undefined, localPath: source.assetLocalPath || undefined })
  if (!bytes) throw new Error('无法读取全景媒体，未能载入导演台')
  if (bytes.byteLength > DIRECTOR_ASSET_LIMIT_BYTES) throw new Error('全景图超过导演台 50MB 上限')
  const assetId = uid('director-env')
  const mime = panoramaMime(source)
  const result = await window.mulby.storage.attachment.put(assetId, bytes, mime)
  if (result === false || typeof result === 'object' && !result.ok) throw new Error(typeof result === 'object' ? result.error || '导演环境附件保存失败' : '导演环境附件保存失败')
  const environment: DirectorEnvironment = {
    assetId,
    name: source.title,
    mimeType: mime,
    description: source.prompt,
    source: 'canvas',
    sourceCardId: source.id,
    cameraHeight: 1.6,
    captureOrigin: [0, 1.6, 0]
  }
  useGraph.getState().setDirectorScene(current ? { ...current, schemaVersion: 2, environment } : defaultDirectorScene(environment))
  return [source.id]
}

function groupOperation(run: WorkflowRun, nodeId: string) {
  return run.compiledPlan?.operations.find((operation) => operation.type === 'organize-stage-group' && operation.planNodeId === nodeId)
}

/** 只移动同一 run 拥有的卡片，并用全局避让算法为每个阶段组寻找空位。 */
export function organizeWorkflowStageGroups(run: WorkflowRun): string[] {
  const output: string[] = []
  for (const groupNode of runnableAgentNodes(run, plannedNodesForCommand(run, 'organize_groups'))) {
    const operation = groupOperation(run, groupNode.id)
    if (!operation || operation.type !== 'organize-stage-group') continue
    const members = operation.memberPlanNodeIds
      .map((nodeId) => ownedCardForPlanNode(run, nodeId))
      .filter((card): card is Card => !!card && card.kind !== 'group')
    if (!members.length) continue
    const graph = useGraph.getState()
    const board = graph.project.boards.find((candidate) => candidate.id === run.sourceBoardId)
    if (!board) throw new Error('工作流画布已不存在')
    const existing = ownedCardForPlanNode(run, groupNode.id)
    const cols = Math.min(3, members.length)
    const rows = Math.ceil(members.length / cols)
    const cellW = Math.max(360, ...members.map((card) => card.w + 32))
    const cellH = Math.max(220, ...members.map((card) => card.h + 32))
    const width = cols * cellW + 56
    const height = rows * cellH + 84
    const ignore = new Set([...members.map((card) => card.id), ...(existing ? [existing.id] : [])])
    const source = board.cards[run.sourceCardId]
    const spot = findFreeCardSpot(board, width, height, (source?.x || 0) + width / 2, (source?.y || 0) + (source?.h || 0) + height / 2 + 160, { ignoreCardIds: ignore, scanStep: 180 })
    const ownership: WorkflowOwnershipV1 = {
      version: 1, runId: run.id, planNodeId: groupNode.id, operationId: operation.id,
      createdBy: 'agent', boardId: run.sourceBoardId
    }
    graph.applyGraphTransaction(`整理${operation.title}`, (tx) => {
      const groupId = existing?.id || tx.createCard('group', spot, {
        x: Math.round(spot.x - width / 2), y: Math.round(spot.y - height / 2),
        w: width, h: height, title: operation.title,
        params: { color: operation.color, collapsed: false },
        meta: { workflowOwnershipV1: ownership }
      })
      tx.updateCard(groupId, {
        x: Math.round(spot.x - width / 2), y: Math.round(spot.y - height / 2), w: width, h: height,
        title: operation.title, params: { ...(tx.getCard(groupId)?.params || {}), color: operation.color, collapsed: false },
        meta: { ...(tx.getCard(groupId)?.meta || {}), workflowOwnershipV1: ownership }
      })
      members.forEach((member, index) => {
        const col = index % cols
        const row = Math.floor(index / cols)
        tx.updateCard(member.id, {
          x: Math.round(spot.x - width / 2 + 28 + col * cellW + (cellW - member.w) / 2),
          y: Math.round(spot.y - height / 2 + 56 + row * cellH + (cellH - member.h) / 2),
          parentId: groupId
        })
      })
      tx.select([groupId])
      output.push(groupId)
    }, run.sourceBoardId)
  }
  return output
}
