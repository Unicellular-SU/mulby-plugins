// CodeMirror 6 view layer for the Obsidian-style live preview. It turns the
// pure descriptors from `livePreviewModel` into CodeMirror Decorations:
//   - hidden marker ranges  -> replace decorations (collapsed)
//   - styled spans          -> mark decorations (bold/italic/code/link…)
//   - block lines           -> line decorations (heading/quote sizing)
//   - images / rules / tasks-> widget decorations
// The set is rebuilt on every doc/selection/viewport change, which is what makes
// the raw Markdown reveal itself on the active line.

import { Facet, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType
} from '@codemirror/view'
import { computeLivePreview } from './livePreviewModel'

/** Resolves a Markdown image href into a URL the <img> can actually load. */
export const imageUrlResolver = Facet.define<(href: string) => string, (href: string) => string>({
  combine: (values) => (values.length > 0 ? values[0] : (href: string) => href)
})

class HrWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const hr = document.createElement('hr')
    hr.className = 'cm-md-hr'
    return hr
  }
  ignoreEvent() {
    return false
  }
}

class ImageWidget extends WidgetType {
  constructor(
    private readonly url: string,
    private readonly alt: string,
    private readonly resolve: (href: string) => string
  ) {
    super()
  }
  eq(other: ImageWidget) {
    return other.url === this.url && other.alt === this.alt
  }
  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image-wrap'
    const img = document.createElement('img')
    img.className = 'cm-md-image'
    img.src = this.resolve(this.url)
    img.alt = this.alt
    img.title = this.alt
    img.loading = 'lazy'
    wrap.appendChild(img)
    return wrap
  }
}

class CheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked
  }
  toDOM() {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-md-checkbox'
    box.checked = this.checked
    return box
  }
  ignoreEvent() {
    return false
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const model = computeLivePreview(view.state)
  const resolve = view.state.facet(imageUrlResolver)
  const ranges: Range<Decoration>[] = []

  for (const line of model.lineClasses) {
    const lineStart = view.state.doc.lineAt(line.pos).from
    ranges.push(Decoration.line({ class: line.cls }).range(lineStart))
  }
  for (const mark of model.marks) {
    if (mark.to > mark.from) {
      ranges.push(Decoration.mark({ class: mark.cls }).range(mark.from, mark.to))
    }
  }
  for (const hide of model.hides) {
    if (hide.to > hide.from) {
      ranges.push(Decoration.replace({}).range(hide.from, hide.to))
    }
  }
  for (const widget of model.widgets) {
    if (widget.kind === 'image') {
      ranges.push(
        Decoration.replace({
          widget: new ImageWidget(widget.data.url ?? '', widget.data.alt ?? '', resolve)
        }).range(widget.from, widget.to)
      )
    } else if (widget.kind === 'hr') {
      ranges.push(Decoration.replace({ widget: new HrWidget() }).range(widget.from, widget.to))
    } else if (widget.kind === 'checkbox') {
      ranges.push(
        Decoration.replace({ widget: new CheckboxWidget(widget.data.checked === '1') }).range(
          widget.from,
          widget.to
        )
      )
    }
  }

  // Decoration.set sorts by (from, startSide) for us — doing it manually is
  // brittle because line/mark/replace decorations have different internal sides.
  return Decoration.set(ranges, true)
}

/** Toggles a GFM task checkbox in the source when its widget is clicked. */
function toggleTaskAt(view: EditorView, pos: number): boolean {
  const line = view.state.doc.lineAt(pos)
  const match = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/.exec(line.text)
  if (!match) {
    return false
  }
  const markerPos = line.from + match[1].length
  const next = match[2] === ' ' ? 'x' : ' '
  view.dispatch({ changes: { from: markerPos, to: markerPos + 1, insert: next } })
  return true
}

export function livePreviewExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view)
      }
      update(update: ViewUpdate) {
        // Never rebuild decorations mid-IME-composition: replacing/collapsing
        // ranges interrupts composition (e.g. Chinese input). Just map the
        // existing set through the change so positions stay valid; a full
        // rebuild happens on the next non-composing update.
        if (update.view.composing) {
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes)
          }
          return
        }
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view)
        }
      }
    },
    {
      decorations: (value) => value.decorations,
      eventHandlers: {
        mousedown: (event, view) => {
          const target = event.target as HTMLElement
          if (target && target.classList.contains('cm-md-checkbox')) {
            const pos = view.posAtDOM(target)
            if (toggleTaskAt(view, pos)) {
              event.preventDefault()
              return true
            }
          }
          return false
        }
      }
    }
  )
  return plugin
}
