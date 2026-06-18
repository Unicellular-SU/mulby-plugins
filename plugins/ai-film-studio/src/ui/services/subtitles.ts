/**
 * 字幕生成（M5）：把分镜 JSON（{shots:[...]} 或 {scenes:[...]}）按片段时长
 * 对齐为 SRT。片段 i 取 shots[i] 的对白/字幕/描述，时间轴按各片段时长累加。
 * 时长用各视频节点的 duration 参数（实际生成时长可能略有出入，已在文档说明）。
 */

export interface SrtClip {
  duration: number
  shotId?: string // P1-2：clip 对应的分镜 id（来自 i2v 产物 meta.shot）；用于按键匹配字幕，缺失回退下标
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

function fmtTime(sec: number): string {
  let whole = Math.floor(sec)
  let ms = Math.round((sec - whole) * 1000)
  if (ms >= 1000) {
    ms -= 1000
    whole += 1
  }
  const s = whole % 60
  const m = Math.floor(whole / 60) % 60
  const h = Math.floor(whole / 3600)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

function shotText(shot: Record<string, unknown> | undefined): string {
  if (!shot) return ''
  const dials = shot.dialogues as Array<Record<string, unknown>> | undefined
  if (Array.isArray(dials) && dials.length) {
    const t = dials
      .map((d) => `${d.character ? `${String(d.character)}：` : ''}${String(d.line ?? '')}`.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    if (t) return t
  }
  return String(
    shot.subtitle ?? shot.caption ?? shot.description ?? shot.summary ?? shot.slug ?? ''
  ).trim()
}

function extractShots(subsJson: unknown): Array<Record<string, unknown>> {
  const j = subsJson && typeof subsJson === 'object' ? (subsJson as Record<string, unknown>) : null
  if (!j) return []
  if (Array.isArray(j.shots)) return j.shots as Array<Record<string, unknown>>
  if (Array.isArray(j.scenes)) return j.scenes as Array<Record<string, unknown>>
  return []
}

/** 生成 SRT 文本；无可用字幕内容时返回空串 */
export function buildSrt(clips: SrtClip[], subsJson: unknown): string {
  const shots = extractShots(subsJson)
  if (shots.length === 0) return ''
  // P1-2：按 shot.id 建索引，clip 带 shotId 时键匹配（任一镜失败/重排都不错位），否则回退下标
  const byId = new Map<string, Record<string, unknown>>()
  for (const s of shots) {
    const sid = s.id != null ? String(s.id) : ''
    if (sid) byId.set(sid, s)
  }
  let t = 0
  let idx = 1
  const lines: string[] = []
  for (let i = 0; i < clips.length; i++) {
    const dur = Math.max(0.5, Number(clips[i].duration) || 5)
    const start = t
    const end = t + dur
    t = end
    const sid = clips[i].shotId
    const shot = (sid != null && byId.get(String(sid))) || shots[i]
    const text = shotText(shot)
    if (!text) continue
    lines.push(String(idx++))
    lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`)
    lines.push(text)
    lines.push('')
  }
  return idx > 1 ? lines.join('\n') : ''
}
