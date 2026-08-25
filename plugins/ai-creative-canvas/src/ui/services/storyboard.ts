import { useGraph } from '../store/graphStore'
import type { AnchorReference, Board, Card, Shot, StoryboardDocV2, StoryboardShotV2, WorkflowOwnershipV1 } from '../types'
import {
  backlinkFor,
  createStoryboardDoc,
  normalizeStoryboardDoc,
  readStoryboardDoc,
  storyboardBacklink,
  storyboardShotFingerprint
} from './storyboardV2'
import { findFreeCardSpot } from './cardPlacement'

function ai() {
  return window.mulby.ai
}
import { toast, type ToastType } from '../store/toastStore'
function notify(msg: string, type?: string) {
  toast(msg, (type as ToastType) || 'info')
}

// 容错时长解析：数字 / 时:分:秒 / 区间取中值 / 取首个数字
export function parseDurationSeconds(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return isFinite(v) && v > 0 ? v : undefined
  const s = String(v).trim()
  if (!s) return undefined
  const hms = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (hms) {
    const a = Number(hms[1])
    const b = Number(hms[2])
    return hms[3] ? a * 3600 + b * 60 + Number(hms[3]) : a * 60 + b
  }
  const range = s.match(/(\d+(?:\.\d+)?)\s*[-~～至到]\s*(\d+(?:\.\d+)?)/)
  if (range) return (Number(range[1]) + Number(range[2])) / 2
  const num = s.match(/\d+(?:\.\d+)?/)
  return num ? Number(num[0]) : undefined
}

export function getRowsTotalDurationSeconds(shots: Shot[]): number {
  return shots.reduce((t, s) => t + (s.duration || 0), 0)
}

export function computeStoryboardIntent(shots: Shot[]): { shotCount: number; totalDurationSeconds: number } {
  return { shotCount: shots.length, totalDurationSeconds: Math.round(getRowsTotalDurationSeconds(shots)) }
}

// 列别名归一：英文/中文多键 → 统一字段；空白视为缺失
function pick(s: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = s?.[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return undefined
}

// LLM 把故事/剧本拆成导演级镜头表；区分「图片提示词」(静帧) 与「视频提示词」(运镜/时序)
export async function generateShots(sourceText: string, modelId: string | null, count = 0): Promise<Shot[]> {
  const countRule = count > 0 ? `正好生成 ${count} 个镜头。` : '镜头数量按内容自然切分（短广告 8-20，剧情片 20-60，上限 100）。'
  const system =
    '你是资深影视分镜导演。把给定故事/剧本/素材拆解成一组可直接拍摄/生成的电影镜头表。\n' +
    '【拆分规则】相邻镜头在因果、空间与道具上保持连续，避免跳切；同一场景的镜头共享场景与角色设定；每个镜头聚焦一个清晰的画面动作。' +
    countRule +
    '\n【图片提示词规则·静帧】用于文生图，是该镜头定格画面的完整总览（主体/角色外观/服装/场景/光线/构图/风格）；禁止出现时间词、运动词与声音词。\n' +
    '【视频提示词规则·动态】用于图生视频，必须包含「景别 + 至少一个运镜」（推/拉/摇/移/跟/升降/手持等），把情绪转译成可见的微表情/呼吸/肢体与时序节奏；与图片提示词不得互相复制。\n' +
    '【对白格式】dialogue 用「声线质感+语速+情绪底色:"台词"」，无对白留空。\n' +
    '只输出合法 JSON（不要 markdown 围栏），结构：{"shots":[{"shotNumber":镜号数字,"scene":"场景","character":"出场角色","characterDesc":"角色外观/服装要点","desc":"画面描述","action":"主体动作","emotion":"情绪基调","shotSize":"景别(远景/全景/中景/近景/特写/大特写)","camera":"机位与运镜","duration":时长秒数字,"imagePrompt":"静帧图片提示词","videoPrompt":"动态视频提示词","dialogue":"对白","sfx":"音效/环境声"}]}。中文输出。'
  const option: any = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: sourceText }
    ],
    params: { responseFormat: 'json_object' }
  }
  if (modelId) option.model = modelId

  const msg = await ai().call(option)
  let text = typeof msg?.content === 'string' ? msg.content : ''
  const braced = /\{[\s\S]*\}/.exec(text)
  if (braced) text = braced[0]
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('分镜结果解析失败，请重试')
  }
  const raw = Array.isArray(data?.shots) ? data.shots : Array.isArray(data) ? data : []
  let shots: Shot[] = raw
    .map((s: any, i: number) => {
      const desc = pick(s, ['desc', 'description', 'visualDescription', '画面描述', '画面', '描述']) ?? ''
      const imagePrompt = pick(s, ['imagePrompt', 'imagePromptText', 'stillPrompt', '图片提示词', '静帧提示词']) ?? desc
      const num = pick(s, ['shotNumber', 'shot', 'no', 'index', '镜号', '序号'])
      const shot: Shot = {
        shotNumber: num ? Number(num.replace(/[^\d.]/g, '')) || i + 1 : i + 1,
        desc,
        scene: pick(s, ['scene', 'location', '场景', '地点']),
        character: pick(s, ['character', 'characters', 'role', '角色', '人物']),
        characterDesc: pick(s, ['characterDesc', 'characterDescription', '角色描述', '人物设定', '外观']),
        action: pick(s, ['action', '动作', '行为']),
        emotion: pick(s, ['emotion', 'mood', '情绪', '情感']),
        shotSize: pick(s, ['shotSize', 'shotType', 'size', '景别']),
        camera: pick(s, ['camera', 'cameraMovement', 'movement', '机位', '运镜', '镜头运动']),
        duration: parseDurationSeconds(pick(s, ['duration', 'durationSec', 'time', '时长', '时间'])),
        dialogue: pick(s, ['dialogue', 'line', 'lines', '对白', '台词']),
        sfx: pick(s, ['sfx', 'sound', 'soundEffect', '音效', '环境声', '声音']),
        imagePrompt: imagePrompt || desc,
        videoPrompt: pick(s, ['videoPrompt', 'motionPrompt', '动态提示词', '视频提示词'])
      }
      return shot
    })
    .filter((s: Shot) => s.desc || s.imagePrompt)
  if (count > 0 && shots.length > count) shots = shots.slice(0, count)
  return shots
}

function shotPrompt(s: Shot): string {
  const base = (s.imagePrompt && s.imagePrompt.trim()) || s.desc
  const hint = [s.shotSize, s.camera].filter(Boolean).join('，')
  const visual = hint ? `${hint}：${base}` : base
  const anchorIds = Array.isArray((s as StoryboardShotV2).anchorIds) ? (s as StoryboardShotV2).anchorIds : []
  const continuity = anchorIds.flatMap((anchorId) => {
    const anchor = useGraph.getState().project.assetAnchors?.[anchorId]
    if (!anchor || (anchor.mediaKind !== 'image' && anchor.mediaKind !== 'video')) return []
    return [`「${anchor.name}」${anchor.description ? `：${anchor.description}` : ''}`]
  })
  if (!continuity.length) return visual
  return `${visual}\n\n连续性锁定：严格参考已附视觉设定图，保持以下主体在所有镜头中的身份、结构、材质、服装和配色不变；只改变本镜头要求的动作、表情、机位和构图。${continuity.join('；')}`
}

// 文本卡上游连入/引用的图像（角色/场景）→ 每个镜头的一致性参考图
function consistencyRefs(textCardId: string, board: Board): string[] {
  const ids = new Set<string>()
  for (const e of Object.values(board.edges)) {
    if (e.target === textCardId) {
      const src = board.cards[e.source]
      if (src && src.assetUrl && (src.kind === 'image' || src.kind === 'pano' || src.kind === 'source')) ids.add(src.id)
    }
  }
  const tc = board.cards[textCardId]
  for (const rid of tc?.refIds || []) {
    const c = board.cards[rid]
    if (c && c.assetUrl && (c.kind === 'image' || c.kind === 'pano' || c.kind === 'source')) ids.add(rid)
  }
  return [...ids]
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function legacyShot(shot: StoryboardShotV2): Shot {
  const {
    id: _id,
    order: _order,
    anchorIds: _anchorIds,
    imageCardId: _imageCardId,
    videoCardId: _videoCardId,
    audioCardId: _audioCardId,
    sourceRange: _sourceRange,
    version: _version,
    ...value
  } = shot
  void _id
  void _order
  void _anchorIds
  void _imageCardId
  void _videoCardId
  void _audioCardId
  void _sourceRange
  void _version
  return value
}

function validLinkedCard(card: Card | undefined, doc: StoryboardDocV2, shot: StoryboardShotV2, stage: 'image' | 'video' | 'audio'): boolean {
  if (!card) return false
  const backlink = storyboardBacklink(card)
  return !!backlink && backlink.storyboardId === doc.id && backlink.shotId === shot.id && backlink.stage === stage
}

function anchorReferences(shot: StoryboardShotV2, existing?: Card): AnchorReference[] {
  const anchors = useGraph.getState().project.assetAnchors || {}
  const acceptedAt = new Map((existing?.anchorRefs || []).map((ref) => [ref.anchorId, ref.acceptedAt]))
  return shot.anchorIds.flatMap((anchorId) => {
    const anchor = anchors[anchorId]
    return anchor ? [{ anchorId, mention: anchor.name, acceptedAt: acceptedAt.get(anchorId) || Date.now() }] : []
  })
}

function writeStoryboardMeta(owner: Card, doc: StoryboardDocV2): Record<string, unknown> {
  const meta = { ...(owner.meta || {}), storyboardV2: doc } as Record<string, unknown>
  delete meta.shots
  return meta
}

/** 保存故事板并修复失效 cardId；镜头输入变化时只标记已落地卡片，不自动重跑。 */
export function saveStoryboardDoc(cardId: string, value: StoryboardDocV2): StoryboardDocV2 | null {
  const g = useGraph.getState()
  const boardId = g.boardIdOfCard(cardId)
  if (!boardId) return null
  const board = g.project.boards.find((item) => item.id === boardId)
  if (!board) return null
  let result: StoryboardDocV2 | null = null
  g.applyGraphTransaction('保存故事板', (tx) => {
    const owner = tx.getCard(cardId)
    if (!owner) return
    let doc = normalizeStoryboardDoc(value, owner)
    if (!doc) return
    let repaired = false
    const shots = doc.shots.map((shot) => {
      let next = shot
      for (const [key, stage] of [['imageCardId', 'image'], ['videoCardId', 'video'], ['audioCardId', 'audio']] as const) {
        const linkedId = next[key]
        if (!linkedId) continue
        const linked = tx.getCard(linkedId)
        if (!validLinkedCard(linked, doc!, next, stage)) {
          next = { ...next, [key]: undefined }
          repaired = true
          continue
        }
        const backlink = storyboardBacklink(linked)
        if (backlink?.materializedFingerprint !== storyboardShotFingerprint(next) && !(linked!.meta as any)?.storyboardInputStale) {
          tx.updateCard(linkedId, { meta: { ...(linked!.meta || {}), storyboardInputStale: true } })
        }
      }
      return next
    })
    if (repaired) doc = { ...doc, shots, updatedAt: Date.now() }
    const activeShotIds = new Set(doc.shots.map((shot) => shot.id))
    for (const candidate of Object.values(board.cards)) {
      const backlink = storyboardBacklink(candidate)
      if (!backlink || backlink.storyboardId !== doc.id || activeShotIds.has(backlink.shotId)) continue
      const current = tx.getCard(candidate.id)
      if (!current) continue
      const meta = { ...(current.meta || {}) } as Record<string, unknown>
      delete meta.storyboardBacklink
      delete meta.storyboardInputStale
      tx.updateCard(current.id, { meta })
    }
    const nextMeta = writeStoryboardMeta(owner, doc)
    if (!sameJson(owner.meta, nextMeta)) tx.updateCard(owner.id, { meta: nextMeta })
    result = doc
  }, boardId)
  return result
}

export interface MaterializeStoryboardResult {
  doc: StoryboardDocV2
  cardIds: string[]
  created: number
  updated: number
}

export interface MaterializeStoryboardOptions {
  /** 工作流计划画幅；普通故事板未指定时保留卡片原设置。 */
  aspect?: string
  /** 工作流局部重规划时，只同步允许执行的镜头；未选中的镜头与故事板链接保持不变。 */
  selectedShotIds?: ReadonlySet<string>
  /** 只标记本次由 Agent 新建的卡片；同步用户已有卡片时不会接管归属。 */
  ownershipForShot?: (shot: StoryboardShotV2, index: number) => WorkflowOwnershipV1 | undefined
  /** 为每个镜头补充节点计划已经解析到当前画布的只读参考卡。 */
  refIdsForShot?: (shot: StoryboardShotV2, index: number) => string[]
}

export interface MaterializeStoryboardAudioOptions {
  ownershipForShot?: (shot: StoryboardShotV2, index: number) => WorkflowOwnershipV1 | undefined
  speechForShot?: (shot: StoryboardShotV2, index: number) => string
  paramsForShot?: (shot: StoryboardShotV2, index: number, timelineOffset: number) => Record<string, unknown>
}

export interface ShotToVideoOptions {
  aspect?: string
  /** 最终时间线实际使用的镜头长度。 */
  plannedDuration?: number
  /** Provider 请求的原始素材长度，可大于计划剪辑长度。 */
  generationDuration?: number
  /** 只写入本次由 Agent 新建的视频卡。 */
  ownership?: WorkflowOwnershipV1
}

export interface LayoutStoryboardResult {
  cardIds: string[]
  moved: number
}

/**
 * 仅重排当前故事板已有的图片/视频/音频产物卡：每镜一行、各阶段一列。
 * 不移动故事板所有者和自由画布中的其他节点；整个操作只有一个 undo。
 */
export function layoutStoryboardCards(cardId: string, value: StoryboardDocV2): LayoutStoryboardResult | null {
  const g = useGraph.getState()
  const boardId = g.boardIdOfCard(cardId)
  if (!boardId) return null
  let result: LayoutStoryboardResult | null = null
  g.applyGraphTransaction('按镜头顺序排版', (tx) => {
    const owner = tx.getCard(cardId)
    if (!owner) return
    const doc = normalizeStoryboardDoc(value, owner)
    if (!doc) return
    const ordered = [...doc.shots].sort((a, b) => a.order - b.order)
    const stageOffsets = { image: 0, video: 360, audio: 720 } as const
    const baseX = owner.x + owner.w + 120
    const baseY = owner.y
    const rowGap = 370
    let moved = 0
    const cardIds: string[] = []
    ordered.forEach((shot, row) => {
      for (const [key, stage] of [['imageCardId', 'image'], ['videoCardId', 'video'], ['audioCardId', 'audio']] as const) {
        const linkedId = shot[key]
        const linked = linkedId ? tx.getCard(linkedId) : undefined
        if (!linkedId || !validLinkedCard(linked, doc, shot, stage)) continue
        const x = Math.round(baseX + stageOffsets[stage])
        const y = Math.round(baseY + row * rowGap)
        if (linked!.x !== x || linked!.y !== y) {
          tx.updateCard(linkedId, { x, y })
          moved++
        }
        cardIds.push(linkedId)
      }
    })
    tx.select(cardIds)
    result = { cardIds, moved }
  }, boardId)
  return result
}

/**
 * 幂等落地故事板图片卡：已有 backlink 时原位同步，没有时才创建。
 * 故事板写回、卡片更新、连线与选择在同一图事务中完成。
 */
export function materializeStoryboardShots(cardId: string, value: StoryboardDocV2, selectedShotIds?: ReadonlySet<string>, options?: MaterializeStoryboardOptions): MaterializeStoryboardResult | null {
  const g = useGraph.getState()
  const boardId = g.boardIdOfCard(cardId)
  if (!boardId) return null
  let result: MaterializeStoryboardResult | null = null
  g.applyGraphTransaction('同步故事板镜头', (tx) => {
    const owner = tx.getCard(cardId)
    if (!owner) return
    const doc0 = normalizeStoryboardDoc(value, owner)
    if (!doc0) return
    const board = g.project.boards.find((item) => item.id === boardId)
    if (!board) return
    const refs = consistencyRefs(cardId, board)
    const W = 280
    const H = 320
    const cols = 4
    const gapX = 40
    const gapY = 48
    const pendingShots = doc0.shots.filter((shot) => {
      if ((selectedShotIds || options?.selectedShotIds) && !(selectedShotIds || options?.selectedShotIds)!.has(shot.id)) return false
      const linked = shot.imageCardId ? board.cards[shot.imageCardId] : undefined
      return !validLinkedCard(linked, doc0, shot, 'image')
    })
    const pendingColumns = Math.min(cols, Math.max(1, pendingShots.length))
    const pendingRows = Math.ceil(pendingShots.length / pendingColumns)
    const totalW = pendingColumns * W + Math.max(0, pendingColumns - 1) * gapX
    const totalH = pendingRows * H + Math.max(0, pendingRows - 1) * gapY
    const spot = pendingShots.length
      ? findFreeCardSpot(board, totalW, totalH, owner.x + owner.w + 140 + totalW / 2, owner.y + totalH / 2)
      : null
    const pendingPositions = new Map(pendingShots.map((shot, pendingIndex) => {
      const col = pendingIndex % pendingColumns
      const row = Math.floor(pendingIndex / pendingColumns)
      return [shot.id, {
        x: spot!.x - totalW / 2 + col * (W + gapX) + W / 2,
        y: spot!.y - totalH / 2 + row * (H + gapY) + H / 2
      }] as const
    }))
    let created = 0
    let updated = 0
    const cardIds: string[] = []
    let linksChanged = false
    const shots = doc0.shots.map((shot, index) => {
      if ((selectedShotIds || options?.selectedShotIds) && !(selectedShotIds || options?.selectedShotIds)!.has(shot.id)) return shot
      let imageCardId = shot.imageCardId
      let imageCard = imageCardId ? tx.getCard(imageCardId) : undefined
      if (!validLinkedCard(imageCard, doc0, shot, 'image')) {
        imageCardId = undefined
        imageCard = undefined
      }
      const title = `镜${shot.shotNumber ?? index + 1}${shot.shotSize ? '·' + shot.shotSize : ''}`
      const prompt = shotPrompt(shot)
      const shotRefs = [...new Set([...refs, ...(options?.refIdsForShot?.(shot, index) || [])])].filter((id) => !!board.cards[id])
      const anchorRefs = anchorReferences(shot, imageCard)
      const fingerprint = storyboardShotFingerprint(shot)
      const aspect = typeof options?.aspect === 'string' && options.aspect.trim() ? options.aspect.trim() : undefined
      const ownership = options?.ownershipForShot?.(shot, index)
      if (!imageCard) {
        const center = pendingPositions.get(shot.id)
        if (!center) return shot
        imageCardId = tx.createCard('image', center, {
          w: W,
          h: H,
          title,
          prompt,
          refIds: shotRefs,
          anchorRefs,
          ...(aspect ? { params: { aspect } } : {}),
          meta: {
            shot: legacyShot(shot),
            storyboardBacklink: backlinkFor(doc0, shot, 'image'),
            ...(ownership ? { workflowOwnershipV1: ownership } : {})
          }
        })
        imageCard = tx.getCard(imageCardId)
        created++
        linksChanged = true
      } else {
        const oldBacklink = storyboardBacklink(imageCard)
        const hasOutput = !!(imageCard.assetUrl || imageCard.assetLocalPath)
        const params = aspect ? { ...imageCard.params, aspect } : imageCard.params
        const paramsChanged = !sameJson(imageCard.params, params)
        const stale = !!(imageCard.meta as any)?.storyboardInputStale || (hasOutput && (oldBacklink?.materializedFingerprint !== fingerprint || paramsChanged))
        const meta = { ...(imageCard.meta || {}), shot: legacyShot(shot), storyboardBacklink: backlinkFor(doc0, shot, 'image') } as Record<string, unknown>
        if (stale) meta.storyboardInputStale = true
        else delete meta.storyboardInputStale
        const needsUpdate = imageCard.title !== title
          || imageCard.prompt !== prompt
          || !sameJson(imageCard.refIds, shotRefs)
          || !sameJson(imageCard.anchorRefs || [], anchorRefs)
          || paramsChanged
          || !sameJson(imageCard.meta, meta)
        if (needsUpdate) {
          tx.updateCard(imageCard.id, { title, prompt, refIds: shotRefs, anchorRefs, params, meta })
          updated++
        }
      }
      if (imageCardId) {
        tx.ensureEdge(cardId, imageCardId)
        cardIds.push(imageCardId)
      }
      if (imageCardId !== shot.imageCardId) {
        linksChanged = true
        return { ...shot, imageCardId }
      }
      return shot
    })
    const doc = linksChanged ? { ...doc0, shots, updatedAt: Date.now() } : doc0
    const ownerNow = tx.getCard(owner.id) || owner
    const nextMeta = writeStoryboardMeta(ownerNow, doc)
    if (!sameJson(ownerNow.meta, nextMeta)) tx.updateCard(owner.id, { meta: nextMeta })
    tx.select(cardIds)
    result = { doc, cardIds, created, updated }
  }, boardId)
  return result
}

/** 幂等落地有对白的 TTS 卡；工作流调用时只会更新属于同一 run/plan node 的卡片。 */
export function materializeStoryboardAudio(cardId: string, value: StoryboardDocV2, options?: MaterializeStoryboardAudioOptions): MaterializeStoryboardResult | null {
  const graph = useGraph.getState()
  const boardId = graph.boardIdOfCard(cardId)
  const board = graph.project.boards.find((candidate) => candidate.id === boardId)
  if (!boardId || !board) return null
  let result: MaterializeStoryboardResult | null = null
  graph.applyGraphTransaction('同步故事板配音', (tx) => {
    const owner = tx.getCard(cardId)
    if (!owner) return
    const doc0 = normalizeStoryboardDoc(value, owner)
    if (!doc0) return
    let elapsed = 0
    const speakable = doc0.shots.flatMap((shot, index) => {
      const offset = elapsed
      elapsed += Number(shot.duration || 0)
      const speech = String(options?.speechForShot?.(shot, index) ?? shot.dialogue ?? '').trim()
      return speech ? [{ shot, index, speech, offset }] : []
    })
    const W = 320
    const H = 160
    const cols = Math.min(3, Math.max(1, speakable.length))
    const rows = Math.ceil(speakable.length / cols)
    const totalW = cols * W + Math.max(0, cols - 1) * 36
    const totalH = rows * H + Math.max(0, rows - 1) * 36
    const spot = speakable.length
      ? findFreeCardSpot(board, totalW, totalH, owner.x + owner.w + 140 + totalW / 2, owner.y + owner.h + 180 + totalH / 2)
      : null
    const positions = new Map(speakable.map((item, position) => {
      const col = position % cols
      const row = Math.floor(position / cols)
      return [item.shot.id, {
        x: spot!.x - totalW / 2 + col * (W + 36) + W / 2,
        y: spot!.y - totalH / 2 + row * (H + 36) + H / 2
      }] as const
    }))
    let created = 0
    let updated = 0
    let linksChanged = false
    const cardIds: string[] = []
    const byShot = new Map(speakable.map((item) => [item.shot.id, item]))
    const shots = doc0.shots.map((shot, index) => {
      const item = byShot.get(shot.id)
      if (!item) return shot
      const ownership = options?.ownershipForShot?.(shot, index)
      let audio = shot.audioCardId ? tx.getCard(shot.audioCardId) : undefined
      if (!validLinkedCard(audio, doc0, shot, 'audio')) audio = undefined
      if (audio && ownership) {
        const currentOwnership = (audio.meta as any)?.workflowOwnershipV1 as WorkflowOwnershipV1 | undefined
        if (currentOwnership?.runId !== ownership.runId || currentOwnership.planNodeId !== ownership.planNodeId) audio = undefined
      }
      const title = `配音${shot.shotNumber ?? index + 1}`
      const params = {
        voice: 'alloy', speed: 1, format: 'mp3',
        ...(options?.paramsForShot?.(shot, index, item.offset) || {}),
        timelineOffset: item.offset,
        plannedDuration: Number(shot.duration || 0)
      }
      const metaFor = (base: Record<string, unknown>) => ({
        ...base,
        storyboardBacklink: backlinkFor(doc0, shot, 'audio'),
        ...(ownership ? { workflowOwnershipV1: ownership } : {})
      })
      let audioCardId = audio?.id
      if (!audio) {
        audioCardId = tx.createCard('audio', positions.get(shot.id)!, {
          w: W, h: H, title, prompt: item.speech, params,
          meta: metaFor({})
        })
        created++
        linksChanged = true
      } else {
        const nextMeta = metaFor(audio.meta || {})
        const changed = audio.title !== title || audio.prompt !== item.speech || !sameJson(audio.params, params) || !sameJson(audio.meta, nextMeta)
        if (changed) {
          const hasOutput = !!(audio.assetUrl || audio.assetLocalPath)
          tx.updateCard(audio.id, {
            title, prompt: item.speech, params,
            meta: hasOutput ? { ...nextMeta, storyboardInputStale: true } : nextMeta
          })
          updated++
        }
      }
      if (!audioCardId) return shot
      // 配音卡的本地 prompt 就是唯一朗读正文；不连接故事板源文本，避免 TTS 把剧本/导演说明一起念出。
      cardIds.push(audioCardId)
      if (audioCardId !== shot.audioCardId) {
        linksChanged = true
        return { ...shot, audioCardId }
      }
      return shot
    })
    const doc = linksChanged ? { ...doc0, shots, updatedAt: Date.now() } : doc0
    const ownerNow = tx.getCard(owner.id) || owner
    const nextMeta = writeStoryboardMeta(ownerNow, doc)
    if (!sameJson(ownerNow.meta, nextMeta)) tx.updateCard(owner.id, { meta: nextMeta })
    tx.select(cardIds)
    result = { doc, cardIds, created, updated }
  }, boardId)
  return result
}

// 把镜头表落地为镜头图卡（每镜一张，带一致性参考、连引用、网格排布）
export function materializeShots(cardId: string, shots: Shot[]): void {
  const g = useGraph.getState()
  const boardId = g.boardIdOfCard(cardId)
  const board0 = g.project.boards.find((board) => board.id === boardId)
  const base = board0?.cards[cardId]
  if (!base || !shots.length) return
  const doc = createStoryboardDoc(base, shots, readStoryboardDoc(base))
  const materialized = materializeStoryboardShots(cardId, doc)
  if (!materialized) return
  const refs = consistencyRefs(cardId, board0)
  notify(`已同步 ${materialized.cardIds.length} 个镜头卡（新建 ${materialized.created}，更新 ${materialized.updated}）${refs.length ? `，带 ${refs.length} 张一致性参考` : ''}`, 'success')
}

// 镜头图 → 视频卡（优先用该镜头的视频提示词；以该图为首帧/参考）
export function shotToVideo(imageCardId: string, options?: ShotToVideoOptions): string | null {
  const g = useGraph.getState()
  const boardId = g.boardIdOfCard(imageCardId)
  const board = g.project.boards.find((item) => item.id === boardId)
  const c = board?.cards[imageCardId]
  if (!c) return null
  const shot = (c.meta as any)?.shot as Shot | undefined
  const motion = (shot?.videoPrompt && shot.videoPrompt.trim()) || ((shot?.camera ? `运镜：${shot.camera}。` : '') + (shot?.desc || ''))
  const plannedDuration = Number(options?.plannedDuration) > 0 ? Number(options?.plannedDuration) : shot?.duration || 5
  const generationDuration = Number(options?.generationDuration) > 0 ? Number(options?.generationDuration) : plannedDuration
  const timingHint = generationDuration > plannedDuration + 0.05
    ? `剪辑计划只使用本素材前 ${plannedDuration}s：核心动作必须在前 ${plannedDuration}s 内完成并形成清晰切点，后续画面自然保持。`
    : ''
  const prompt = [motion || c.prompt || '', timingHint].filter(Boolean).join('\n\n').trim()
  const center = findFreeCardSpot(board!, 320, 280, c.x + c.w / 2, c.y + c.h + 200)
  const title = (c.title || '镜头').replace(/^镜/, '片')
  const imageBacklink = storyboardBacklink(c)
  const owner = imageBacklink && board
    ? Object.values(board.cards).find((candidate) => readStoryboardDoc(candidate)?.id === imageBacklink.storyboardId)
    : undefined
  const doc0 = owner ? readStoryboardDoc(owner) : null
  const storyboardShot = doc0?.shots.find((item) => item.id === imageBacklink?.shotId)
  const aspect = (typeof options?.aspect === 'string' && options.aspect.trim()) || (c.params?.aspect as string) || '16:9'
  const videoParams = { duration: generationDuration, plannedDuration, aspect }
  let videoId: string | null = null
  let created = false
  g.applyGraphTransaction('创建分镜视频卡', (tx) => {
    let existing = storyboardShot?.videoCardId ? tx.getCard(storyboardShot.videoCardId) : undefined
    if (storyboardShot && doc0 && !validLinkedCard(existing, doc0, storyboardShot, 'video')) existing = undefined
    if (!existing) {
      videoId = tx.createCard('video', center, {
        title,
        prompt,
        refIds: [imageCardId],
        params: videoParams,
        meta: {
          ...(storyboardShot && doc0 ? { storyboardBacklink: backlinkFor(doc0, storyboardShot, 'video') } : {}),
          ...(options?.ownership ? { workflowOwnershipV1: options.ownership } : {})
        }
      })
      created = true
    } else {
      videoId = existing.id
      const meta = { ...(existing.meta || {}), storyboardBacklink: backlinkFor(doc0!, storyboardShot!, 'video') } as Record<string, unknown>
      const hasOutput = !!(existing.assetUrl || existing.assetLocalPath)
      const params = { ...existing.params, ...videoParams }
      if (hasOutput && (existing.prompt !== prompt || !sameJson(existing.params, params) || storyboardBacklink(existing)?.materializedFingerprint !== storyboardShotFingerprint(storyboardShot!))) meta.storyboardInputStale = true
      if (existing.title !== title || existing.prompt !== prompt || !sameJson(existing.refIds, [imageCardId]) || !sameJson(existing.params, params) || !sameJson(existing.meta, meta)) {
        tx.updateCard(existing.id, { title, prompt, refIds: [imageCardId], params, meta })
      }
    }
    if (!videoId) return
    tx.ensureEdge(imageCardId, videoId)
    if (owner && doc0 && storyboardShot && storyboardShot.videoCardId !== videoId) {
      const doc = { ...doc0, shots: doc0.shots.map((item) => item.id === storyboardShot.id ? { ...item, videoCardId: videoId! } : item), updatedAt: Date.now() }
      tx.updateCard(owner.id, { meta: writeStoryboardMeta(owner, doc) })
    }
    tx.select([videoId])
  }, boardId)
  if (videoId) notify(created ? '已创建视频卡（以该镜头为首帧），点「生成」出片' : '已同步并定位已有视频卡', 'success')
  return videoId
}
