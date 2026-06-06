// Pure, DOM-free model for the Obsidian-style live preview. Given a CodeMirror
// EditorState (markdown language), it walks the syntax tree and produces a set
// of decoration descriptors: which markup markers to hide, which spans to style,
// which lines to class, and which ranges to replace with widgets (images, rules,
// task checkboxes).
//
// The "reveal on the active line" behavior — the hallmark of Obsidian's Live
// Preview — is implemented here: any construct whose lines intersect a selection
// range keeps its raw Markdown visible so it can be edited; everything else is
// rendered.
//
// Keeping this DOM-free (no EditorView) makes the tricky range math unit-testable
// in Node; the thin ViewPlugin in `livePreview.ts` only turns these descriptors
// into actual CodeMirror Decorations.

import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

export interface HideRange {
  from: number
  to: number
}

export interface MarkRange {
  from: number
  to: number
  cls: string
}

export interface LineClass {
  /** A position inside the target line. */
  pos: number
  cls: string
}

export type WidgetKind = 'image' | 'hr' | 'checkbox'

export interface WidgetRange {
  from: number
  to: number
  kind: WidgetKind
  data: Record<string, string>
}

export interface LivePreviewDecorations {
  hides: HideRange[]
  marks: MarkRange[]
  lineClasses: LineClass[]
  widgets: WidgetRange[]
}

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  SetextHeading1: 'cm-md-h1',
  SetextHeading2: 'cm-md-h2'
}

/** Collects the set of line numbers intersected by any selection range. */
export function activeLineNumbers(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let line = startLine; line <= endLine; line += 1) {
      lines.add(line)
    }
  }
  return lines
}

/**
 * Walks the markdown syntax tree and returns decoration descriptors for the
 * live preview. Constructs whose lines are "active" (touched by a selection)
 * are left as raw source so they can be edited.
 */
export function computeLivePreview(state: EditorState): LivePreviewDecorations {
  const hides: HideRange[] = []
  const marks: MarkRange[] = []
  const lineClasses: LineClass[] = []
  const widgets: WidgetRange[] = []
  const active = activeLineNumbers(state)
  const doc = state.doc

  const isActive = (from: number, to: number): boolean => {
    const startLine = doc.lineAt(from).number
    const endLine = doc.lineAt(Math.min(to, doc.length)).number
    for (let line = startLine; line <= endLine; line += 1) {
      if (active.has(line)) {
        return true
      }
    }
    return false
  }

  const hideRange = (from: number, to: number) => {
    if (to > from) {
      hides.push({ from, to })
    }
  }

  const tree = syntaxTree(state)
  tree.iterate({
    enter: (node) => {
      const name = node.name

      // Headings: style the whole line, hide the leading "### " marker.
      const headingClass = HEADING_CLASS[name]
      if (headingClass) {
        lineClasses.push({ pos: node.from, cls: headingClass })
        return
      }

      if (name === 'HeaderMark') {
        if (!isActive(node.from, node.to)) {
          // Include the single trailing space after ATX "#"s when present.
          let end = node.to
          if (doc.sliceString(end, end + 1) === ' ') {
            end += 1
          }
          hideRange(node.from, end)
        }
        return
      }

      if (name === 'StrongEmphasis') {
        marks.push({ from: node.from, to: node.to, cls: 'cm-md-strong' })
        return
      }
      if (name === 'Emphasis') {
        marks.push({ from: node.from, to: node.to, cls: 'cm-md-em' })
        return
      }
      if (name === 'Strikethrough') {
        marks.push({ from: node.from, to: node.to, cls: 'cm-md-strike' })
        return
      }

      if (name === 'EmphasisMark' || name === 'StrikethroughMark') {
        if (!isActive(node.from, node.to)) {
          hideRange(node.from, node.to)
        }
        return
      }

      if (name === 'InlineCode') {
        marks.push({ from: node.from, to: node.to, cls: 'cm-md-code' })
        return
      }

      // Inline code backticks: hide only when the mark belongs to InlineCode
      // (leave fenced-code fences alone so the block layout is preserved).
      if (name === 'CodeMark') {
        const parent = node.node.parent
        if (parent && parent.name === 'InlineCode' && !isActive(node.from, node.to)) {
          hideRange(node.from, node.to)
        }
        return
      }

      if (name === 'Link') {
        // Only render inline links ([label](url)); leave reference/bare links raw.
        const url = node.node.getChild('URL')
        if (url && !isActive(node.from, node.to)) {
          // Hide the leading "[" and the trailing "](url)" so only the label
          // shows; style the label as a link.    [label](url)
          const labelStart = findLabelEnd(state, node.from, node.to)
          if (labelStart >= 0) {
            hideRange(node.from, node.from + 1) // the "["
            hideRange(labelStart, node.to) // the "](url)" tail
            marks.push({ from: node.from + 1, to: labelStart, cls: 'cm-md-link' })
          }
        }
        return
      }

      if (name === 'Image') {
        if (!isActive(node.from, node.to)) {
          const inner = node.node
          const url = inner.getChild('URL')
          const urlText = url ? doc.sliceString(url.from, url.to) : ''
          const alt = extractImageAlt(doc.sliceString(node.from, node.to))
          widgets.push({
            from: node.from,
            to: node.to,
            kind: 'image',
            data: { url: urlText, alt }
          })
        }
        return
      }

      if (name === 'HorizontalRule') {
        if (!isActive(node.from, node.to)) {
          widgets.push({ from: node.from, to: node.to, kind: 'hr', data: {} })
        }
        return
      }

      if (name === 'Blockquote') {
        lineClasses.push({ pos: node.from, cls: 'cm-md-quote' })
        return
      }

      if (name === 'FencedCode') {
        // Give every line of the block a class so it reads as a code block.
        const startLine = doc.lineAt(node.from).number
        const endLine = doc.lineAt(Math.min(node.to, doc.length)).number
        for (let n = startLine; n <= endLine; n += 1) {
          const line = doc.line(n)
          lineClasses.push({ pos: line.from, cls: 'cm-md-codeblock' })
        }
        return
      }

      if (name === 'Task') {
        // GFM task item: render the "[ ]"/"[x]" marker as a checkbox.
        const inner = node.node
        const marker = inner.getChild('TaskMarker')
        if (marker && !isActive(marker.from, marker.to)) {
          const checked = doc.sliceString(marker.from, marker.to).toLowerCase().includes('x')
          widgets.push({
            from: marker.from,
            to: marker.to,
            kind: 'checkbox',
            data: { checked: checked ? '1' : '' }
          })
        }
        return
      }
    }
  })

  return { hides, marks, lineClasses, widgets }
}

/**
 * Finds the absolute offset of a link label's closing "]" within a Link node —
 * i.e. the start of the "](url)" tail that should be hidden. Returns -1 when not
 * found.
 */
function findLabelEnd(state: EditorState, from: number, to: number): number {
  const text = state.doc.sliceString(from, to)
  // Find the "](" sequence that separates label from destination.
  const idx = text.indexOf('](')
  if (idx < 0) {
    return -1
  }
  return from + idx // absolute position of "]"
}

/** Extracts the alt text from an image's raw `![alt](url)` source. */
export function extractImageAlt(source: string): string {
  const match = /^!\[([^\]]*)\]/.exec(source)
  return match ? match[1] : ''
}
