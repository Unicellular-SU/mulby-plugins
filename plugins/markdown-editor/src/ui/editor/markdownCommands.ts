// Toolbar/editing commands for the CodeMirror markdown editor. Names mirror the
// previous Toast UI `exec(...)` commands so the App toolbar wiring is a drop-in
// replacement (App calls runMarkdownCommand(view, name, payload)).

import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'

/** Wraps each selection range with `before`/`after`, keeping the text selected. */
export function wrapSelection(view: EditorView, before: string, after: string = before): void {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to)
      const insert = `${before}${text}${after}`
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from + before.length, range.from + before.length + text.length)
      }
    })
  )
  view.focus()
}

/** Sets the heading level of the current line (replacing any existing level). */
export function setHeading(view: EditorView, level: number): void {
  const prefix = `${'#'.repeat(Math.min(Math.max(level, 1), 6))} `
  view.dispatch(
    view.state.changeByRange((range) => {
      const line = view.state.doc.lineAt(range.from)
      const cleaned = line.text.replace(/^\s*#{1,6}\s+/, '')
      const insert = `${prefix}${cleaned}`
      return {
        changes: { from: line.from, to: line.to, insert },
        range: EditorSelection.cursor(line.from + insert.length)
      }
    })
  )
  view.focus()
}

/** Prepends `prefix` to every line touched by the main selection. */
export function prefixLines(view: EditorView, prefix: string): void {
  const { state } = view
  const range = state.selection.main
  const startLine = state.doc.lineAt(range.from)
  const endLine = state.doc.lineAt(range.to)
  const changes: { from: number; insert: string }[] = []
  for (let n = startLine.number; n <= endLine.number; n += 1) {
    const line = state.doc.line(n)
    if (!line.text.startsWith(prefix)) {
      changes.push({ from: line.from, insert: prefix })
    }
  }
  if (changes.length > 0) {
    view.dispatch({ changes })
  }
  view.focus()
}

/** Inserts `text` as its own block at the caret (blank line padded). */
export function insertBlock(view: EditorView, text: string): void {
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `\n\n${text}\n` },
    selection: EditorSelection.cursor(range.from + text.length + 3)
  })
  view.focus()
}

/** Inserts plain text at the caret (or replaces the selection). */
export function insertText(view: EditorView, text: string): void {
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: EditorSelection.cursor(range.from + text.length)
  })
  view.focus()
}

/** Replaces the given range (or the live selection) with text. */
export function replaceSelection(
  view: EditorView,
  text: string,
  range?: { from: number; to: number } | null
): void {
  const target = range ?? view.state.selection.main
  view.dispatch({
    changes: { from: target.from, to: target.to, insert: text },
    selection: EditorSelection.cursor(target.from + text.length)
  })
  view.focus()
}

function addLink(view: EditorView, linkUrl: string, linkText: string): void {
  const range = view.state.selection.main
  const label = linkText || view.state.sliceDoc(range.from, range.to) || '链接'
  const insert = `[${label}](${linkUrl})`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length)
  })
  view.focus()
}

function addImage(view: EditorView, imageUrl: string, altText: string): void {
  const range = view.state.selection.main
  const insert = `![${altText}](${imageUrl})`
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.cursor(range.from + insert.length)
  })
  view.focus()
}

export interface CommandPayload {
  level?: number
  linkUrl?: string
  linkText?: string
  imageUrl?: string
  altText?: string
}

/**
 * Runs a named command, mapping the legacy Toast UI command names to their
 * CodeMirror equivalents.
 */
export function runMarkdownCommand(view: EditorView, name: string, payload: CommandPayload = {}): void {
  switch (name) {
    case 'undo':
      undo(view)
      view.focus()
      break
    case 'redo':
      redo(view)
      view.focus()
      break
    case 'bold':
      wrapSelection(view, '**')
      break
    case 'italic':
      wrapSelection(view, '*')
      break
    case 'strike':
      wrapSelection(view, '~~')
      break
    case 'code':
      wrapSelection(view, '`')
      break
    case 'highlight':
      wrapSelection(view, '==')
      break
    case 'heading':
      setHeading(view, payload.level ?? 1)
      break
    case 'blockQuote':
      prefixLines(view, '> ')
      break
    case 'bulletList':
      prefixLines(view, '- ')
      break
    case 'orderedList':
      prefixLines(view, '1. ')
      break
    case 'taskList':
      prefixLines(view, '- [ ] ')
      break
    case 'hr':
      insertBlock(view, '---')
      break
    case 'addLink':
      addLink(view, payload.linkUrl ?? '', payload.linkText ?? '')
      break
    case 'addImage':
      addImage(view, payload.imageUrl ?? '', payload.altText ?? '')
      break
    default:
      break
  }
}
