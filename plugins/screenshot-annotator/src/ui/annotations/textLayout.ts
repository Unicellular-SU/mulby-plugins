// 文字标注的度量与换行布局（从 App.tsx 搬移；测量改为与绘制一致的真实字体度量）。

import { TEXT_BOX_MIN_WIDTH } from './constants'
import type { Rect, TextAnnotation } from './types'

// 与 drawTextAnnotation 完全一致的字体定义，保证「包围盒/命中区域」与「实际绘制」同源。
export function getTextAnnotationFont(fontSize: number) {
  return `700 ${fontSize}px "Segoe UI", "PingFang SC", sans-serif`
}

let sharedMeasureContext: CanvasRenderingContext2D | null = null

function getSharedMeasureContext() {
  if (!sharedMeasureContext) {
    sharedMeasureContext = document.createElement('canvas').getContext('2d')
  }
  return sharedMeasureContext
}

function isWideTextCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  )
}

function estimateTextWidth(text: string, fontSize: number) {
  return Array.from(text).reduce((width, character) => {
    if (character === ' ') {
      return width + fontSize * 0.34
    }

    if (isWideTextCharacter(character)) {
      return width + fontSize
    }

    return width + fontSize * 0.58
  }, 0)
}

/** 用与绘制一致的字体测量文字宽度；canvas 不可用时退回字符宽度估算。 */
function measureTextWidth(text: string, fontSize: number) {
  const context = getSharedMeasureContext()
  if (!context) {
    return estimateTextWidth(text, fontSize)
  }

  context.font = getTextAnnotationFont(fontSize)
  return context.measureText(text).width
}

export function getTextBoxWidth(annotation: TextAnnotation) {
  const fontSize = Math.max(14, annotation.size)

  if (annotation.boxWidth && Number.isFinite(annotation.boxWidth)) {
    return Math.max(TEXT_BOX_MIN_WIDTH, fontSize * 4, annotation.boxWidth)
  }

  const paddingX = Math.max(8, fontSize * 0.28)
  const estimatedWidth = annotation.text.split(/\r?\n/).reduce((maxWidth, line) => {
    return Math.max(maxWidth, measureTextWidth(line, fontSize))
  }, 0)

  return Math.max(TEXT_BOX_MIN_WIDTH, fontSize * 4, estimatedWidth + paddingX * 2)
}

export function wrapTextParagraph(
  paragraph: string,
  maxWidth: number,
  measureText: (text: string) => number
) {
  if (!paragraph) {
    return ['']
  }

  const lines: string[] = []
  let currentLine = ''

  Array.from(paragraph.replace(/\t/g, ' ')).forEach((character) => {
    const nextLine = `${currentLine}${character}`
    if (currentLine && measureText(nextLine) > maxWidth) {
      lines.push(currentLine.trimEnd())
      currentLine = character.trimStart()
      return
    }

    currentLine = nextLine
  })

  lines.push(currentLine.trimEnd())
  return lines
}

export function getWrappedTextLines(
  annotation: TextAnnotation,
  measureText?: (text: string) => number
) {
  const fontSize = Math.max(14, annotation.size)
  const paddingX = Math.max(8, fontSize * 0.28)
  const boxWidth = getTextBoxWidth(annotation)
  const maxLineWidth = Math.max(fontSize, boxWidth - paddingX * 2)
  const measure = measureText ?? ((line: string) => measureTextWidth(line, fontSize))
  const lines = annotation.text.split(/\r?\n/).flatMap((paragraph) =>
    wrapTextParagraph(paragraph, maxLineWidth, measure)
  )

  return lines.length ? lines : ['']
}

export function getTextBounds(annotation: TextAnnotation): Rect {
  const fontSize = Math.max(14, annotation.size)
  const paddingX = Math.max(8, fontSize * 0.28)
  const paddingY = Math.max(6, fontSize * 0.2)
  const lineHeight = fontSize * 1.25
  const displayLines = getWrappedTextLines(annotation)

  return {
    x: annotation.point.x,
    y: annotation.point.y,
    width: Math.max(TEXT_BOX_MIN_WIDTH, getTextBoxWidth(annotation), paddingX * 2),
    height: displayLines.length * lineHeight + paddingY * 2
  }
}
