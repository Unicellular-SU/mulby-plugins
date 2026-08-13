import { useGraph } from '../store/graphStore'
import type { AnchorReference, Board, Card, Shot, StoryboardDocV2, StoryboardShotV2 } from '../types'
import {
  backlinkFor,
  createStoryboardDoc,
  normalizeStoryboardDoc,
  readStoryboardDoc,
  storyboardBacklink,
  storyboardShotFingerprint
} from './storyboardV2'

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
  return hint ? `${hint}：${base}` : base
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
export function materializeStoryboardShots(cardId: string, value: StoryboardDocV2, selectedShotIds?: ReadonlySet<string>): MaterializeStoryboardResult | null {
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
    const baseX = owner.x + owner.w + 140
    const baseY = owner.y
    let created = 0
    let updated = 0
    const cardIds: string[] = []
    let linksChanged = false
    const shots = doc0.shots.map((shot, index) => {
      if (selectedShotIds && !selectedShotIds.has(shot.id)) return shot
      const col = index % cols
      const row = Math.floor(index / cols)
      const center = { x: baseX + col * (W + gapX) + W / 2, y: baseY + row * (H + gapY) + H / 2 }
      let imageCardId = shot.imageCardId
      let imageCard = imageCardId ? tx.getCard(imageCardId) : undefined
      if (!validLinkedCard(imageCard, doc0, shot, 'image')) {
        imageCardId = undefined
        imageCard = undefined
      }
      const title = `镜${shot.shotNumber ?? index + 1}${shot.shotSize ? '·' + shot.shotSize : ''}`
      const prompt = shotPrompt(shot)
      const anchorRefs = anchorReferences(shot, imageCard)
      const fingerprint = storyboardShotFingerprint(shot)
      if (!imageCard) {
        imageCardId = tx.createCard('image', center, {
          w: W,
          h: H,
          title,
          prompt,
          refIds: [...refs],
          anchorRefs,
          meta: { shot: legacyShot(shot), storyboardBacklink: backlinkFor(doc0, shot, 'image') }
        })
        imageCard = tx.getCard(imageCardId)
        created++
        linksChanged = true
      } else {
        const oldBacklink = storyboardBacklink(imageCard)
        const hasOutput = !!(imageCard.assetUrl || imageCard.assetLocalPath)
        const stale = !!(imageCard.meta as any)?.storyboardInputStale || (hasOutput && oldBacklink?.materializedFingerprint !== fingerprint)
        const meta = { ...(imageCard.meta || {}), shot: legacyShot(shot), storyboardBacklink: backlinkFor(doc0, shot, 'image') } as Record<string, unknown>
        if (stale) meta.storyboardInputStale = true
        else delete meta.storyboardInputStale
        const needsUpdate = imageCard.title !== title
          || imageCard.prompt !== prompt
          || !sameJson(imageCard.refIds, refs)
          || !sameJson(imageCard.anchorRefs || [], anchorRefs)
          || !sameJson(imageCard.meta, meta)
        if (needsUpdate) {
          tx.updateCard(imageCard.id, { title, prompt, refIds: [...refs], anchorRefs, meta })
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
export function shotToVideo(imageCardId: string): string | null {
  const g = useGraph.getState()
  const boardId = g.boardIdOfCard(imageCardId)
  const board = g.project.boards.find((item) => item.id === boardId)
  const c = board?.cards[imageCardId]
  if (!c) return null
  const shot = (c.meta as any)?.shot as Shot | undefined
  const motion = (shot?.videoPrompt && shot.videoPrompt.trim()) || ((shot?.camera ? `运镜：${shot.camera}。` : '') + (shot?.desc || ''))
  const prompt = (motion || c.prompt || '').trim()
  const center = { x: c.x + c.w / 2, y: c.y + c.h + 200 }
  const title = (c.title || '镜头').replace(/^镜/, '片')
  const imageBacklink = storyboardBacklink(c)
  const owner = imageBacklink && board
    ? Object.values(board.cards).find((candidate) => readStoryboardDoc(candidate)?.id === imageBacklink.storyboardId)
    : undefined
  const doc0 = owner ? readStoryboardDoc(owner) : null
  const storyboardShot = doc0?.shots.find((item) => item.id === imageBacklink?.shotId)
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
        params: { duration: shot?.duration || 5, aspect: (c.params?.aspect as string) || '16:9' },
        meta: storyboardShot && doc0 ? { storyboardBacklink: backlinkFor(doc0, storyboardShot, 'video') } : {}
      })
      created = true
    } else {
      videoId = existing.id
      const meta = { ...(existing.meta || {}), storyboardBacklink: backlinkFor(doc0!, storyboardShot!, 'video') } as Record<string, unknown>
      const hasOutput = !!(existing.assetUrl || existing.assetLocalPath)
      if (hasOutput && (existing.prompt !== prompt || storyboardBacklink(existing)?.materializedFingerprint !== storyboardShotFingerprint(storyboardShot!))) meta.storyboardInputStale = true
      const params = { ...existing.params, duration: shot?.duration || 5, aspect: (c.params?.aspect as string) || '16:9' }
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
