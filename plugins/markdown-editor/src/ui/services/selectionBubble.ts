// Helpers for driving the floating AI bubble from Toast UI Editor selections.
// Kept DOM-free except for optional Window/Selection inputs so logic is testable.

import type Editor from '@toast-ui/editor'
import type { BubbleRect } from './bubble'

const WYSIWYG_SURFACE = '.toastui-editor-ww-container .toastui-editor-contents'
const MARKDOWN_SURFACE = '.toastui-editor-md-container .ProseMirror'

export function getEditorSurfaces(host: HTMLElement): HTMLElement[] {
  return [
    host.querySelector<HTMLElement>(WYSIWYG_SURFACE),
    host.querySelector<HTMLElement>(MARKDOWN_SURFACE)
  ].filter((node): node is HTMLElement => node instanceof HTMLElement)
}

export function isNodeInEditorSurfaces(host: HTMLElement, node: Node | null | undefined): boolean {
  if (!node) {
    return false
  }
  return getEditorSurfaces(host).some((surface) => surface.contains(node))
}

function editorHasTextSelection(editor: Editor): boolean {
  try {
    const text = editor.getSelectedText()?.trim() ?? ''
    if (text.length > 0) {
      return true
    }
    const range = editor.getSelection()
    return Array.isArray(range) && range.length === 2 && range[0] !== range[1]
  } catch {
    return false
  }
}

function rectFromDomSelection(selection: Selection): BubbleRect | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) {
    return null
  }
  const range = selection.getRangeAt(0)
  const domRect = range.getBoundingClientRect()
  const clientRects = range.getClientRects()
  const source =
    domRect.width > 0 || domRect.height > 0
      ? domRect
      : clientRects.length > 0
        ? clientRects[clientRects.length - 1]
        : domRect

  if (!source || (source.width === 0 && source.height === 0 && clientRects.length === 0)) {
    return null
  }

  return {
    left: source.left,
    top: source.top,
    right: source.right,
    bottom: source.bottom,
    width: source.width,
    height: source.height
  }
}

function fallbackRect(host: HTMLElement): BubbleRect {
  const hostRect = host.getBoundingClientRect()
  const left = hostRect.left + Math.min(hostRect.width / 2, 240)
  const top = hostRect.top + 96
  return { left, top, right: left, bottom: top, width: 0, height: 0 }
}

export interface SelectionBubbleSnapshot {
  text: string
  anchor: BubbleRect
}

/**
 * Reads the current editor selection for the floating AI bubble.
 * Prefers Toast UI APIs (stable in wysiwyg + markdown) and falls back to DOM
 * selection geometry when available.
 */
export function readSelectionBubbleSnapshot(
  editor: Editor,
  host: HTMLElement,
  domSelection: Selection | null = typeof window === 'undefined' ? null : window.getSelection()
): SelectionBubbleSnapshot | null {
  if (!editorHasTextSelection(editor)) {
    return null
  }

  const text = editor.getSelectedText()?.trim() ?? domSelection?.toString().trim() ?? ''
  if (!text) {
    return null
  }

  if (domSelection && domSelection.rangeCount > 0 && !domSelection.isCollapsed) {
    const anchorNode = domSelection.anchorNode
    const focusNode = domSelection.focusNode
    if (isNodeInEditorSurfaces(host, anchorNode) && isNodeInEditorSurfaces(host, focusNode)) {
      const anchor = rectFromDomSelection(domSelection)
      if (anchor) {
        return { text, anchor }
      }
    }
  }

  return { text, anchor: fallbackRect(host) }
}
