import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import type { Board, Shot } from '../types'

function ai(): any {
  return (window as any).mulby.ai
}
function notify(msg: string, type?: string) {
  ;(window as any).mulby?.notification?.show?.(msg, type)
}

// 用 LLM 把故事/剧本拆成镜头表（结构化 JSON）。count>0 时固定镜数
export async function generateShots(sourceText: string, modelId: string | null, count = 0): Promise<Shot[]> {
  const countRule = count > 0 ? `正好生成 ${count} 个镜头。` : '镜头数量合理（通常 4-8 个，长内容可更多）。'
  const option: any = {
    messages: [
      {
        role: 'system',
        content:
          '你是专业影视分镜师。把给定的故事/剧本拆成一组电影镜头。' +
          countRule +
          '只输出一个合法 JSON 对象（不要 markdown 围栏）：' +
          '{"shots":[{"desc":"画面描述，具体、可视化，可直接用于文生图","shotSize":"景别(远景/全景/中景/近景/特写)","camera":"机位或运镜","duration":秒数(数字),"dialogue":"对白(可空)"}]}。中文。'
      },
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
    .map((s: any) => ({
      desc: String(s?.desc ?? s?.description ?? s?.画面 ?? '').trim(),
      shotSize: s?.shotSize ?? s?.景别 ?? undefined,
      camera: s?.camera ?? s?.机位 ?? s?.运镜 ?? undefined,
      duration: Number(s?.duration ?? s?.时长) || undefined,
      dialogue: s?.dialogue ?? s?.对白 ?? undefined
    }))
    .filter((s: Shot) => s.desc)
  if (count > 0 && shots.length > count) shots = shots.slice(0, count)
  return shots
}

function shotPrompt(s: Shot): string {
  const hint = [s.shotSize, s.camera].filter(Boolean).join('，')
  return hint ? `${hint}：${s.desc}` : s.desc
}

// 文本卡上游连入 / 显式引用的图像（角色/场景）→ 作为每个镜头的一致性参考图
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

// 从一张文本卡生成分镜，并扇出成多张图片卡（每镜一张，带一致性参考、连引用、网格排布）
export async function runStoryboard(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const card = g.getActiveBoard().cards[cardId]
  if (!card) return
  const src = (card.text && card.text.trim()) || (card.prompt && card.prompt.trim())
  if (!src) {
    notify('该卡片没有可用文本（先填写故事/剧本或先生成文本）', 'error')
    return
  }

  useTask.getState().inc()
  notify('正在生成分镜…')
  try {
    const count = Number(card.params?.shotCount) || 0
    const shots = await generateShots(src, card.modelId || useGraph.getState().project.defaultTextModel || null, count)
    if (!shots.length) throw new Error('未生成镜头')

    const board0 = useGraph.getState().getActiveBoard()
    const base = board0.cards[cardId]
    if (!base) return
    const refs = consistencyRefs(cardId, board0) // 角色/场景一致性参考
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
        title: `镜${i + 1}${shot.shotSize ? '·' + shot.shotSize : ''}`,
        prompt: shotPrompt(shot),
        refIds: [...refs], // 一致性参考图（多图参考）
        meta: { shot }
      })
      ids.push(id)
      useGraph.getState().addEdgeBetween(cardId, id)
    })

    useGraph.getState().setSelection(ids)
    const refNote = refs.length ? `，已带 ${refs.length} 张一致性参考` : ''
    notify(`已生成 ${shots.length} 个镜头卡${refNote}（已全选，点顶部「生成选中」批量出图）`, 'success')
  } catch (e: any) {
    notify('分镜失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

// 镜头图 → 视频卡（以该图为首帧/参考，连引用，沿用运镜与时长）
export function shotToVideo(imageCardId: string): void {
  const g = useGraph.getState()
  const c = g.getActiveBoard().cards[imageCardId]
  if (!c) return
  const shot = (c.meta as any)?.shot as Shot | undefined
  const motion = shot?.camera ? `运镜：${shot.camera}。` : ''
  const prompt = (motion + (shot?.desc || c.prompt || '')).trim()
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
