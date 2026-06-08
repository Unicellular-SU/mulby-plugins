// Detects what construct the editor's right-click landed on so the context menu
// can offer the right actions. This is the CodeMirror-coupled counterpart of the
// pure `services/contextMenu.ts` menu builder: it inspects the DOM target and the
// syntax tree to classify the click as a link / image / table cell / plain text,
// and returns the precise document range (and table cell coordinates) the menu's
// actions operate on.

import { syntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

export type EditorNodeContext =
  | { kind: 'link'; url: string; from: number; to: number }
  | { kind: 'image'; url: string; from: number; to: number }
  | { kind: 'table'; from: number; to: number; row: number; col: number; header: boolean }
  | { kind: 'text' }

/** Slices the URL child of a Link/Image node (empty when there isn't one). */
function urlOfNode(view: EditorView, node: SyntaxNode): string {
  const url = node.getChild('URL')
  return url ? view.state.doc.sliceString(url.from, url.to) : ''
}

/** Finds the enclosing Table node's range, probing a couple of nearby offsets. */
function tableNodeRange(view: EditorView, pos: number): { from: number; to: number } | null {
  const tree = syntaxTree(view.state)
  const len = view.state.doc.length
  for (const p of [pos, Math.min(pos + 1, len), Math.max(pos - 1, 0)]) {
    for (let node: SyntaxNode | null = tree.resolveInner(p, 1); node; node = node.parent) {
      if (node.name === 'Table') {
        return { from: node.from, to: node.to }
      }
    }
  }
  return null
}

/**
 * Classifies a link/image at `pos` from the syntax tree. A linked image
 * `[![alt](img)](href)` resolves to a single image unit spanning the whole link
 * (so "delete image" removes the construct cleanly, not just the inner image).
 */
function linkImageAt(view: EditorView, pos: number): EditorNodeContext | null {
  const tree = syntaxTree(view.state)
  const len = view.state.doc.length
  for (const p of [pos, Math.max(0, pos - 1), Math.min(len, pos + 1)]) {
    for (let node: SyntaxNode | null = tree.resolveInner(p, 1); node; node = node.parent) {
      if (node.name === 'Image') {
        const parent = node.parent
        if (parent && parent.name === 'Link') {
          return { kind: 'image', url: urlOfNode(view, node), from: parent.from, to: parent.to }
        }
        return { kind: 'image', url: urlOfNode(view, node), from: node.from, to: node.to }
      }
      if (node.name === 'Link') {
        const img = node.getChild('Image')
        if (img) {
          return { kind: 'image', url: urlOfNode(view, img), from: node.from, to: node.to }
        }
        return { kind: 'link', url: urlOfNode(view, node), from: node.from, to: node.to }
      }
    }
  }
  return null
}

/**
 * Describes what a right-click at `pos` (and DOM `target`) landed on. Table cells
 * are detected from the rendered widget's `data-row`/`data-col` attributes (the
 * widget is atomic, so the syntax tree can't pinpoint the cell); links and images
 * are detected from the syntax tree, with a DOM hint used to re-anchor `pos` onto
 * a rendered widget/mark for a reliable hit.
 */
export function describeNodeAt(view: EditorView, target: HTMLElement | null, pos: number): EditorNodeContext {
  // Table cell (editable, non-quoted table widget) — read coordinates off the DOM.
  const cell = target?.closest?.('.cm-md-cellbody')
  if (cell instanceof HTMLElement) {
    const root = cell.closest('.cm-md-table')
    if (root instanceof HTMLElement) {
      const range = tableNodeRange(view, view.posAtDOM(root))
      if (range) {
        const row = Number.parseInt(cell.dataset.row ?? '0', 10)
        const col = Number.parseInt(cell.dataset.col ?? '0', 10)
        return { kind: 'table', from: range.from, to: range.to, row, col, header: row < 0 }
      }
    }
  }

  // Re-anchor onto a rendered image/link so the hit is reliable even when the
  // coordinate hit-test lands on the widget edge.
  let probe = pos
  const imgWrap = target?.closest?.('.cm-md-image-wrap')
  const linkEl = target?.closest?.('.cm-md-link')
  if (imgWrap instanceof HTMLElement) {
    probe = view.posAtDOM(imgWrap)
  } else if (linkEl instanceof HTMLElement) {
    probe = view.posAtDOM(linkEl)
  }

  return linkImageAt(view, probe) ?? { kind: 'text' }
}
