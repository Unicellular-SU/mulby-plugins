/**
 * 字幕生成（M5）：把分镜 JSON（{shots:[...]} 或 {scenes:[...]}）按片段时长
 * 对齐为 SRT。片段 i 取 shots[i] 的对白/字幕/描述，时间轴按各片段时长累加。
 * 时长用各视频节点的 duration 参数（实际生成时长可能略有出入，已在文档说明）。
 */

export interface SrtClip {
  duration: number
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

function fmtTime(sec: number): string {
  const ms = Math.round((sec - Math.floor(sec)) * 1000)
  const s = Math.floor(sec) % 60
  const m = Math.floor(sec / 60) % 60
  const h = Math.floor(sec / 3600)
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
  let t = 0
  let idx = 1
  const lines: string[] = []
  for (let i = 0; i < clips.length; i++) {
    const dur = Math.max(0.5, Number(clips[i].duration) || 5)
    const start = t
    const end = t + dur
    t = end
    const text = shotText(shots[i])
    if (!text) continue
    lines.push(String(idx++))
    lines.push(`${fmtTime(start)} --> ${fmtTime(end)}`)
    lines.push(text)
    lines.push('')
  }
  return idx > 1 ? lines.join('\n') : ''
}
