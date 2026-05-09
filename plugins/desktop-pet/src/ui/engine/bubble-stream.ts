export interface BubbleStreamPayload {
  reply: string
  reasoning: string
}

export const PET_CURRENT_BUBBLE_STORAGE_KEY = 'pet-current-bubble-stream'

export interface BubblePreviewState extends BubbleStreamPayload {
  reasoningPreview: string
  reasoningChars: number
  hasReasoning: boolean
  statusLabel: '思考中' | '已思考' | ''
}

export interface BubbleDetailState extends BubbleStreamPayload {
  reasoningChars: number
}

export interface BubbleWindowSize {
  width: number
  height: number
}

const MAX_PREVIEW_REASONING_LINES = 4
const MAX_PREVIEW_REASONING_CHARS = 177
const MIN_BUBBLE_WIDTH = 120
const MAX_BUBBLE_WIDTH = 260
const BUBBLE_HORIZONTAL_PADDING = 16
const BUBBLE_VERTICAL_PADDING = 10
const BUBBLE_OUTER_PADDING = 8
const BUBBLE_ARROW_HEIGHT = 8
const BUBBLE_ARROW_OVERLAP = 4
const BUBBLE_BORDER_ALLOWANCE = 2
const BUBBLE_FLEX_GAP = 4
const BUBBLE_TEXT_LINE_HEIGHT = 15.4
const BUBBLE_META_LINE_HEIGHT = 11
const BUBBLE_REASONING_PREVIEW_LINE_HEIGHT = 12.15
const BUBBLE_REASONING_PREVIEW_VERTICAL_PADDING = 8
const BUBBLE_REASONING_PREVIEW_BORDER = 2
const BUBBLE_HINT_LINE_HEIGHT = 11
const BUBBLE_HEIGHT_SAFETY = 6

export function normalizeBubbleStreamPayload(raw: string | { reply?: unknown; reasoning?: unknown }): BubbleStreamPayload {
  if (typeof raw === 'string') {
    return { reply: raw, reasoning: '' }
  }

  if (!raw || typeof raw !== 'object') {
    return { reply: '', reasoning: '' }
  }

  return {
    reply: typeof raw.reply === 'string' ? raw.reply : '',
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
  }
}

export function buildBubblePreviewState(payload: BubbleStreamPayload): BubblePreviewState {
  const reply = payload.reply
  const reasoning = payload.reasoning
  const reasoningChars = reasoning.length
  const hasReasoning = reasoning.trim().length > 0
  const statusLabel = hasReasoning ? (reply.trim() ? '已思考' : '思考中') : ''

  return {
    reply,
    reasoning,
    reasoningPreview: !reply.trim() && hasReasoning ? tailLines(reasoning, MAX_PREVIEW_REASONING_LINES) : '',
    reasoningChars,
    hasReasoning,
    statusLabel,
  }
}

export function buildBubbleDetailState(payload: BubbleStreamPayload): BubbleDetailState {
  return {
    reply: payload.reply,
    reasoning: payload.reasoning,
    reasoningChars: payload.reasoning.length,
  }
}

export function estimateBubbleWindowSize(payload: BubbleStreamPayload | string): BubbleWindowSize {
  const normalized = normalizeBubbleStreamPayload(payload)
  const preview = buildBubblePreviewState(normalized)
  const measurementText = [
    preview.statusLabel,
    preview.reasoningPreview,
    preview.reply,
    preview.hasReasoning ? '点击查看完整思考' : '',
  ].filter(Boolean).join('\n')
  const len = measurementText.length
  const width = len <= 12
    ? MIN_BUBBLE_WIDTH
    : len <= 25
      ? 160
      : len <= 50
        ? 200
        : Math.min(MAX_BUBBLE_WIDTH, 200 + Math.ceil((len - 50) / 20) * 10)
  const contentWidth = Math.max(4, width - BUBBLE_HORIZONTAL_PADDING)
  const charsPerLine = Math.max(4, Math.floor(contentWidth / 12))

  const parts: number[] = []
  if (preview.hasReasoning) {
    parts.push(BUBBLE_META_LINE_HEIGHT)
  }
  if (preview.reasoningPreview) {
    const lines = countWrappedLines(preview.reasoningPreview, charsPerLine)
    parts.push(
      Math.ceil(lines * BUBBLE_REASONING_PREVIEW_LINE_HEIGHT)
      + BUBBLE_REASONING_PREVIEW_VERTICAL_PADDING
      + BUBBLE_REASONING_PREVIEW_BORDER
    )
  }
  if (preview.reply) {
    parts.push(Math.ceil(countWrappedLines(preview.reply, charsPerLine) * BUBBLE_TEXT_LINE_HEIGHT))
  }
  if (preview.hasReasoning) {
    parts.push(BUBBLE_HINT_LINE_HEIGHT)
  }

  if (!parts.length) {
    parts.push(Math.ceil(countWrappedLines(measurementText, charsPerLine) * BUBBLE_TEXT_LINE_HEIGHT))
  }

  const gaps = Math.max(0, parts.length - 1) * BUBBLE_FLEX_GAP
  const height = Math.ceil(
    parts.reduce((sum, part) => sum + part, 0)
    + gaps
    + BUBBLE_VERTICAL_PADDING
    + BUBBLE_OUTER_PADDING
    + BUBBLE_ARROW_HEIGHT
    - BUBBLE_ARROW_OVERLAP
    + BUBBLE_BORDER_ALLOWANCE
    + BUBBLE_HEIGHT_SAFETY
  )

  return { width, height }
}

function tailLines(text: string, maxLines: number): string {
  const tail = text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(-maxLines)
    .join('\n')

  if (tail.length <= MAX_PREVIEW_REASONING_CHARS) return tail
  return `${tail.slice(-(MAX_PREVIEW_REASONING_CHARS - 3)).trimStart()}...`
}

function countWrappedLines(text: string, charsPerLine: number): number {
  const rows = text.split(/\r?\n/)
  return rows.reduce((sum, row) => {
    const len = row.length
    return sum + Math.max(1, Math.ceil(len / charsPerLine))
  }, 0)
}
