import { useGraph } from '../store/graphStore'
import type { Board, Shot } from '../types'

function ai(): any {
  return (window as any).mulby.ai
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
      if (src && src.assetUrl && (src.kind === 'image' || src.kind === 'source')) ids.add(src.id)
    }
  }
  const tc = board.cards[textCardId]
  for (const rid of tc?.refIds || []) {
    const c = board.cards[rid]
    if (c && c.assetUrl && (c.kind === 'image' || c.kind === 'source')) ids.add(rid)
  }
  return [...ids]
}

// 把镜头表落地为镜头图卡（每镜一张，带一致性参考、连引用、网格排布）
export function materializeShots(cardId: string, shots: Shot[]): void {
  const g = useGraph.getState()
  const board0 = g.getActiveBoard()
  const base = board0.cards[cardId]
  if (!base || !shots.length) return
  const refs = consistencyRefs(cardId, board0)
  const W = 280
  const H = 320
  const cols = 4
  const gapX = 40
  const gapY = 48
  const baseX = base.x + base.w + 140
  const baseY = base.y
  const ids: string[] = []
  shots.forEach((shot, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const center = { x: baseX + col * (W + gapX) + W / 2, y: baseY + row * (H + gapY) + H / 2 }
    const id = useGraph.getState().addCard('image', center, {
      title: `镜${shot.shotNumber ?? i + 1}${shot.shotSize ? '·' + shot.shotSize : ''}`,
      prompt: shotPrompt(shot),
      refIds: [...refs],
      meta: { shot }
    })
    ids.push(id)
    useGraph.getState().addEdgeBetween(cardId, id)
  })
  useGraph.getState().setSelection(ids)
  notify(`已落地 ${shots.length} 个镜头卡${refs.length ? `，带 ${refs.length} 张一致性参考` : ''}（顶部「生成选中」批量出图）`, 'success')
}

// 镜头图 → 视频卡（优先用该镜头的视频提示词；以该图为首帧/参考）
export function shotToVideo(imageCardId: string): void {
  const g = useGraph.getState()
  const c = g.getActiveBoard().cards[imageCardId]
  if (!c) return
  const shot = (c.meta as any)?.shot as Shot | undefined
  const motion = (shot?.videoPrompt && shot.videoPrompt.trim()) || ((shot?.camera ? `运镜：${shot.camera}。` : '') + (shot?.desc || ''))
  const prompt = (motion || c.prompt || '').trim()
  const center = { x: c.x + c.w / 2, y: c.y + c.h + 200 }
  const title = (c.title || '镜头').replace(/^镜/, '片')
  const id = g.addCard('video', center, {
    title,
    prompt,
    refIds: [imageCardId],
    params: { duration: shot?.duration || 5, aspect: (c.params?.aspect as string) || '16:9' }
  })
  g.addEdgeBetween(imageCardId, id)
  g.setSelection([id])
  notify('已创建视频卡（以该镜头为首帧），点「生成」出片', 'success')
}
