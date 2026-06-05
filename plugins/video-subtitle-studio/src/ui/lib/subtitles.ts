export interface SubtitleWord {
  startMs: number
  endMs: number
  text: string
  confidence?: number
}

export interface SubtitleCue {
  id: string
  startMs: number
  endMs: number
  text: string
  translation?: string
  speaker?: string
  confidence?: number
  words?: SubtitleWord[]
}

function clampMs(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0))
}

function formatTime(ms: number, separator: ',' | '.') {
  const totalMs = clampMs(ms)
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1000)
  const millis = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`
}

export function formatSrtTime(ms: number) {
  return formatTime(ms, ',')
}

export function formatVttTime(ms: number) {
  return formatTime(ms, '.')
}

function cueLines(cue: SubtitleCue) {
  const lines = [cue.text.trim()]
  if (cue.translation?.trim()) lines.push(cue.translation.trim())
  return lines.filter(Boolean)
}

export function exportSrt(cues: SubtitleCue[]) {
  return cues
    .map((cue, index) => [
      String(index + 1),
      `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
      ...cueLines(cue),
      ''
    ].join('\n'))
    .join('\n')
}

export function exportVtt(cues: SubtitleCue[]) {
  return [
    'WEBVTT',
    '',
    ...cues.flatMap((cue) => [
      `${formatVttTime(cue.startMs)} --> ${formatVttTime(cue.endMs)}`,
      ...cueLines(cue),
      ''
    ])
  ].join('\n')
}

export function exportJson(cues: SubtitleCue[]) {
  return JSON.stringify(cues, null, 2)
}

function clampBoundaryMs(cue: SubtitleCue, splitMs: number) {
  return Math.max(cue.startMs + 1, Math.min(Math.round(splitMs), cue.endMs - 1))
}

function splitTextAtIndex(text: string, index: number): [string, string] {
  const length = text.length
  if (length === 0) return ['', '']
  const clamped = Math.max(0, Math.min(index, length))
  // For space-separated text, snap to the nearest word boundary so we don't cut words apart.
  const hasSpaces = /\s/.test(text)
  if (hasSpaces) {
    const before = text.lastIndexOf(' ', clamped - 1)
    const after = text.indexOf(' ', clamped)
    const snap = clamped - (before >= 0 ? before : -1) <= (after >= 0 ? after : length) - clamped && before > 0 ? before : after > 0 ? after : clamped
    return [text.slice(0, snap).trim(), text.slice(snap).trim()]
  }
  return [text.slice(0, clamped).trim(), text.slice(clamped).trim()]
}

function buildSplitPair(cue: SubtitleCue, boundaryMs: number, leftText: string, rightText: string, leftWords?: SubtitleWord[], rightWords?: SubtitleWord[]): [SubtitleCue, SubtitleCue] {
  const left: SubtitleCue = { ...cue, id: `${cue.id}-1`, endMs: boundaryMs, text: leftText }
  const right: SubtitleCue = { ...cue, id: `${cue.id}-2`, startMs: boundaryMs, text: rightText }
  if (leftWords) left.words = leftWords
  else delete left.words
  if (rightWords) right.words = rightWords
  else delete right.words
  // Translation cannot be meaningfully split; keep it only on the left to avoid duplication.
  if (cue.translation) delete right.translation
  return [left, right]
}

/** Split by a text-cursor index. Time boundary is derived from the character ratio. */
export function splitByText(cue: SubtitleCue, textIndex: number): [SubtitleCue, SubtitleCue] {
  const length = cue.text.length || 1
  const ratio = Math.max(0, Math.min(textIndex / length, 1))
  const boundaryMs = clampBoundaryMs(cue, cue.startMs + (cue.endMs - cue.startMs) * ratio)
  const [leftText, rightText] = splitTextAtIndex(cue.text, textIndex)
  return buildSplitPair(cue, boundaryMs, leftText, rightText)
}

/** Split by a time point. Text boundary is derived from the time ratio. */
export function splitByTime(cue: SubtitleCue, splitMs: number): [SubtitleCue, SubtitleCue] {
  const boundaryMs = clampBoundaryMs(cue, splitMs)
  const span = cue.endMs - cue.startMs || 1
  const ratio = (boundaryMs - cue.startMs) / span
  const textIndex = Math.round(cue.text.length * ratio)
  const [leftText, rightText] = splitTextAtIndex(cue.text, textIndex)
  return buildSplitPair(cue, boundaryMs, leftText, rightText)
}

/** Split before the word at wordIndex using its exact timestamp and text. */
export function splitByWord(cue: SubtitleCue, wordIndex: number): [SubtitleCue, SubtitleCue] {
  const words = cue.words ?? []
  if (wordIndex <= 0 || wordIndex >= words.length) {
    // Nothing meaningful to split on; fall back to a midpoint split.
    return splitByTime(cue, Math.round((cue.startMs + cue.endMs) / 2))
  }
  const boundaryMs = clampBoundaryMs(cue, words[wordIndex].startMs)
  const leftWords = words.slice(0, wordIndex)
  const rightWords = words.slice(wordIndex)
  const joiner = /\s/.test(cue.text) ? ' ' : ''
  const leftText = leftWords.map((word) => word.text).join(joiner).trim()
  const rightText = rightWords.map((word) => word.text).join(joiner).trim()
  return buildSplitPair(cue, boundaryMs, leftText, rightText, leftWords, rightWords)
}

/** Backwards-compatible helper: split at a time point, optionally using a preferred text index. */
export function splitSubtitle(cue: SubtitleCue, splitMs: number, preferredTextIndex?: number): [SubtitleCue, SubtitleCue] {
  const boundaryMs = clampBoundaryMs(cue, splitMs)
  const textIndex = preferredTextIndex ?? Math.floor(cue.text.length / 2)
  const [leftText, rightText] = splitTextAtIndex(cue.text, textIndex)
  return buildSplitPair(cue, boundaryMs, leftText, rightText)
}

export function mergeSubtitles(left: SubtitleCue, right: SubtitleCue): SubtitleCue {
  const words = [...(left.words ?? []), ...(right.words ?? [])]
  const confidence =
    typeof left.confidence === 'number' && typeof right.confidence === 'number'
      ? (left.confidence + right.confidence) / 2
      : left.confidence ?? right.confidence

  return {
    ...left,
    endMs: Math.max(left.endMs, right.endMs),
    text: [left.text.trim(), right.text.trim()].filter(Boolean).join(' '),
    translation: [left.translation?.trim(), right.translation?.trim()].filter(Boolean).join(' ') || undefined,
    ...(words.length ? { words } : {}),
    ...(typeof confidence === 'number' ? { confidence } : {})
  }
}
