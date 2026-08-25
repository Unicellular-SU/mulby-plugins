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

// ============================================================================
// 词级 / 卡拉OK 字幕（#9，借鉴 OpenMontage CaptionOverlay + subtitle_gen 思路，自研重写）
// 短视频/社交成片标配：逐词弹出或卡拉OK高亮。本插件原仅 clip 级 SRT，此处补词级增量。
// 纯函数；词时序优先来自 TTS/转写，缺失时用 estimateWordTimings 在已知区间内按词长估算。
// ============================================================================

export interface CaptionWord {
  word: string
  startMs: number
  endMs: number
}
export type CaptionHighlight = 'none' | 'word_by_word' | 'karaoke'
export interface CaptionCue {
  startMs: number
  endMs: number
  words: CaptionWord[]
  text: string
}

const PUNCT = /^[\p{P}\p{S}]+$/u
const CJK = /[一-鿿぀-ヿ가-힯]/

/** 拆词：连续 ASCII/数字=一个词；CJK/日韩 逐字；标点附着到前一词。 */
function tokenizeWords(text: string): string[] {
  const raw = text.replace(/\s+/g, ' ').trim()
  if (!raw) return []
  const out: string[] = []
  const re = /[A-Za-z0-9'’\-]+|[一-鿿぀-ヿ가-힯]|[^\sA-Za-z0-9]/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const tok = m[0]
    if (PUNCT.test(tok) && out.length) out[out.length - 1] += tok
    else out.push(tok)
  }
  return out
}

/** 在 [startMs,endMs] 区间内按词长加权分配每词时序（无真实 TTS 时间戳时的估算兜底）。 */
export function estimateWordTimings(text: string, startMs: number, endMs: number): CaptionWord[] {
  const toks = tokenizeWords(text)
  if (!toks.length) return []
  const span = Math.max(0, endMs - startMs)
  const weight = (t: string) => (/[A-Za-z0-9]/.test(t) ? Math.max(1, t.replace(/[^A-Za-z0-9]/g, '').length) : 1.6)
  const weights = toks.map(weight)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let acc = startMs
  return toks.map((t, i) => {
    const dur = span * (weights[i] / total)
    const w: CaptionWord = { word: t, startMs: Math.round(acc), endMs: Math.round(acc + dur) }
    acc += dur
    return w
  })
}

/** 不区分大小写的纠错字典替换（保留前导空格与尾随标点）。dict: 错词→正确词。 */
export function applyCorrections(words: CaptionWord[], dict: Record<string, string>): CaptionWord[] {
  if (!dict || !Object.keys(dict).length) return words
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(dict)) lower[k.toLowerCase()] = v
  return words.map((w) => {
    const m = w.word.match(/^(\s*)(.*?)([\p{P}\p{S}]*)$/u)
    if (!m) return w
    const [, lead, core, tail] = m
    const repl = lower[core.toLowerCase()]
    return repl != null ? { ...w, word: `${lead}${repl}${tail}` } : w
  })
}

function hasCjk(words: CaptionWord[]): boolean {
  return words.some((w) => CJK.test(w.word))
}
function joinWords(words: CaptionWord[]): string {
  return words.map((w) => w.word).join(hasCjk(words) ? '' : ' ')
}
function toCue(words: CaptionWord[]): CaptionCue {
  return { startMs: words[0].startMs, endMs: words[words.length - 1].endMs, words: [...words], text: joinWords(words) }
}

export interface BuildCuesOpts {
  maxWords?: number
  maxChars?: number
  maxGapMs?: number
  maxDurMs?: number
}

/** 把词序列分组成字幕条：按最多词数/字符数、词间最大间隔、单条最大时长断句。 */
export function buildCues(words: CaptionWord[], opts?: BuildCuesOpts): CaptionCue[] {
  const maxWords = opts?.maxWords ?? 7
  const maxChars = opts?.maxChars ?? 30
  const maxGap = opts?.maxGapMs ?? 700
  const maxDur = opts?.maxDurMs ?? 5000
  const cues: CaptionCue[] = []
  let cur: CaptionWord[] = []
  const flush = () => {
    if (cur.length) {
      cues.push(toCue(cur))
      cur = []
    }
  }
  for (const w of words) {
    if (cur.length) {
      const prev = cur[cur.length - 1]
      const gap = w.startMs - prev.endMs
      const chars = cur.reduce((a, x) => a + x.word.length, 0) + w.word.length
      const dur = w.endMs - cur[0].startMs
      if (gap > maxGap || cur.length >= maxWords || chars > maxChars || dur > maxDur) flush()
    }
    cur.push(w)
  }
  flush()
  return cues
}

function fmtMs(ms: number, sep: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor(t / 60000) % 60
  const s = Math.floor(t / 1000) % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(t % 1000, 3)}`
}
function fmtAss(ms: number): string {
  const t = Math.max(0, Math.round(ms))
  const h = Math.floor(t / 3600000)
  const m = Math.floor(t / 60000) % 60
  const s = Math.floor(t / 1000) % 60
  return `${h}:${pad(m)}:${pad(s)}.${pad(Math.floor((t % 1000) / 10), 2)}`
}

/** 渲染 SRT。highlight=none 按条；word_by_word/karaoke 逐词弹出（SRT 无高亮能力）。 */
export function renderSrt(cues: CaptionCue[], highlight: CaptionHighlight = 'none'): string {
  const lines: string[] = []
  let idx = 1
  const emit = (start: number, end: number, text: string) => {
    if (!text.trim()) return
    lines.push(String(idx++), `${fmtMs(start, ',')} --> ${fmtMs(end, ',')}`, text, '')
  }
  for (const c of cues) {
    if (highlight === 'none') emit(c.startMs, c.endMs, c.text)
    else for (const w of c.words) emit(w.startMs, w.endMs, w.word.trim())
  }
  return idx > 1 ? lines.join('\n') : ''
}

/** 渲染 WebVTT。karaoke 用 VTT 内联时间戳标签实现逐词高亮。 */
export function renderVtt(cues: CaptionCue[], highlight: CaptionHighlight = 'none'): string {
  const out: string[] = ['WEBVTT', '']
  for (const c of cues) {
    if (highlight === 'karaoke') {
      const sep = hasCjk(c.words) ? '' : ' '
      const body = c.words.map((w, i) => (i === 0 ? w.word : `${sep}<${fmtMs(w.startMs, '.')}>${w.word}`)).join('')
      out.push(`${fmtMs(c.startMs, '.')} --> ${fmtMs(c.endMs, '.')}`, body, '')
    } else if (highlight === 'word_by_word') {
      for (const w of c.words) out.push(`${fmtMs(w.startMs, '.')} --> ${fmtMs(w.endMs, '.')}`, w.word.trim(), '')
    } else {
      out.push(`${fmtMs(c.startMs, '.')} --> ${fmtMs(c.endMs, '.')}`, c.text, '')
    }
  }
  return out.length > 2 ? out.join('\n') : ''
}

export interface AssStyleOpts {
  fontName?: string
  fontSize?: number
  /** 已唱/激活色 #RRGGBB */
  highlightColor?: string
  /** 未唱/底色 #RRGGBB */
  baseColor?: string
  outline?: number
  marginV?: number
  playResX?: number
  playResY?: number
}

function toAssColor(hex: string): string {
  const h = hex.replace('#', '')
  const r = h.slice(0, 2)
  const g = h.slice(2, 4)
  const b = h.slice(4, 6)
  return `&H00${b}${g}${r}`.toUpperCase()
}

/** 渲染 ASS（卡拉OK \kf 逐词扫色填充），供 ffmpeg `ass` 滤镜烧录。 */
export function renderAss(cues: CaptionCue[], opts?: AssStyleOpts): string {
  const font = opts?.fontName ?? 'Arial'
  const size = opts?.fontSize ?? 48
  const primary = toAssColor(opts?.highlightColor ?? '#FFD400') // 已唱（PrimaryColour，\kf 扫过后的颜色）
  const secondary = toAssColor(opts?.baseColor ?? '#FFFFFF') // 未唱（SecondaryColour）
  const outline = opts?.outline ?? 2
  const marginV = opts?.marginV ?? 60
  const w = opts?.playResX ?? 1280
  const h = opts?.playResY ?? 720
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${size},${primary},${secondary},&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${outline},1,2,40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const events = cues.map((c) => {
    const sep = hasCjk(c.words) ? '' : ' '
    const text = c.words
      .map((wd, i) => {
        const cs = Math.max(1, Math.round((wd.endMs - wd.startMs) / 10))
        return `{\\kf${cs}}${wd.word}${i < c.words.length - 1 ? sep : ''}`
      })
      .join('')
    return `Dialogue: 0,${fmtAss(c.startMs)},${fmtAss(c.endMs)},Default,,0,0,0,,${text}`
  })
  return [...header, ...events].join('\n') + '\n'
}

/** 字幕用文本：只取对白行（无 speaker 前缀/换行），其次 subtitle/caption（不回退 description，太长不适合字幕）。 */
function captionText(shot: Record<string, unknown> | undefined): string {
  if (!shot) return ''
  const dials = shot.dialogues as Array<Record<string, unknown>> | undefined
  if (Array.isArray(dials) && dials.length) {
    const t = dials.map((d) => String(d.line ?? '').trim()).filter(Boolean).join(' ')
    if (t) return t
  }
  return String(shot.subtitle ?? shot.caption ?? '').trim()
}

/**
 * 从片段时长 + 分镜 JSON 生成词级字幕条：按 clip 区间取台词、估算逐词时序、可选纠错、分组成条。
 * 复用 buildSrt 的同款 shotId 键匹配 / 下标兜底。无真实 TTS 时间戳时用估算。
 */
export function buildCaptionsFromClips(
  clips: SrtClip[],
  subsJson: unknown,
  opts?: BuildCuesOpts & { corrections?: Record<string, string> }
): CaptionCue[] {
  const shots = extractShots(subsJson)
  if (shots.length === 0) return []
  const byId = new Map<string, Record<string, unknown>>()
  for (const s of shots) {
    const sid = s.id != null ? String(s.id) : ''
    if (sid) byId.set(sid, s)
  }
  let t = 0
  const cues: CaptionCue[] = []
  for (let i = 0; i < clips.length; i++) {
    const dur = Math.max(0.5, Number(clips[i].duration) || 5)
    const startMs = t * 1000
    const endMs = (t + dur) * 1000
    t += dur
    const sid = clips[i].shotId
    const shot = (sid != null && byId.get(String(sid))) || shots[i]
    const text = captionText(shot)
    if (!text) continue
    let words = estimateWordTimings(text, startMs, endMs)
    if (opts?.corrections) words = applyCorrections(words, opts.corrections)
    // 按 clip 分别成条——避免一条字幕跨两镜（混入不同镜/不同说话人的台词）
    cues.push(...buildCues(words, opts))
  }
  return cues
}
