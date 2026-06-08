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
import { emojiForShortcode } from './emoji'
import { parseTable } from './tableModel'

export interface HideRange {
  from: number
  to: number
}

export interface MarkRange {
  from: number
  to: number
  cls: string
  /**
   * Optional DOM attributes for the rendered span (e.g. a sanitized inline
   * `style` from `<span style="…">`). Applied via Decoration.mark's `attributes`,
   * never via innerHTML, and the style string is sanitized to a safe subset.
   */
  attrs?: Record<string, string>
}

export interface LineClass {
  /** A position inside the target line. */
  pos: number
  cls: string
}

export type WidgetKind =
  | 'image'
  | 'hr'
  | 'checkbox'
  | 'bullet'
  | 'table'
  | 'math'
  | 'dl'
  | 'emoji'
  | 'mermaid'
  | 'details'

export interface WidgetRange {
  from: number
  to: number
  kind: WidgetKind
  data: Record<string, string>
  /** Block-level replacement (replaces whole lines), e.g. tables / display math. */
  block?: boolean
  /**
   * For a standalone image whose line is being edited: render the image *below*
   * the line (an inserted block widget) instead of replacing the source, so the
   * raw `![alt](url)` stays visible above the still-rendered image. This avoids
   * the large layout jump that hiding/showing the image would cause.
   */
  reveal?: boolean
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
  // Ranges already consumed by a rendered construct (code / table / image / hr /
  // math). Used to keep the regex-based $math$ / ==highlight== detection out of
  // code spans and out of blocks that are already replaced by a widget.
  const occupied: HideRange[] = []
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

  // Per-token reveal (Obsidian-style): an inline construct keeps its raw source
  // visible only when a selection range actually touches *its* [from, to] span —
  // not merely its line. This lets you click one `**bold**` in a mixed line and
  // reveal only that token's markers while the rest of the line stays rendered.
  // Boundaries are inclusive so a caret resting right at an edge still reveals it.
  const isRangeActive = (from: number, to: number): boolean => {
    for (const range of state.selection.ranges) {
      if (range.from <= to && range.to >= from) {
        return true
      }
    }
    return false
  }

  // For block widgets (tables, display math): reveal the raw source only when a
  // selection range sits *entirely inside* the block — i.e. the caret is in it,
  // or the user is selecting text within it. A selection that merely spans across
  // the block (e.g. a drag that passes over a table) keeps it rendered, so the
  // layout doesn't shift mid-drag and the block can be selected as a unit. This,
  // together with the widgets' `ignoreEvent` returning false, makes a single
  // click on a rendered block reveal its source for editing.
  const isBlockActive = (from: number, to: number): boolean => {
    for (const range of state.selection.ranges) {
      if (range.from >= from && range.to <= to) {
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

  // Structural indent (in columns) of the line containing `pos`. Used so block
  // widgets nested in a list render indented under their list item instead of
  // jumping to the far-left margin.
  const indentColsAt = (pos: number): number =>
    leadingIndentColumns(doc.lineAt(pos).text)

  // Blockquote nesting depth of the line containing `pos`. Used so block widgets
  // nested in a quote draw the quote bar(s) themselves (the line they replace
  // can't carry the quote line-class) and strip the `>` prefixes from their
  // source so they parse/render correctly.
  const quoteDepthAt = (pos: number): number => quoteDepth(doc.lineAt(pos).text)

  // Emits an image widget. A *standalone* image (the only content on its single
  // line) becomes a block widget: replaced by the image when idle, and — while
  // the line is being edited — kept rendered *below* the revealed source (the
  // `reveal` flag) so editing doesn't make the image vanish and jump the layout.
  // An image embedded inline in text keeps the simpler inline replace.
  const pushImageWidget = (from: number, to: number, data: Record<string, string>) => {
    const line = doc.lineAt(from)
    const oneLine = line.number === doc.lineAt(Math.min(to, doc.length)).number
    const standalone = oneLine && line.text.trim() === doc.sliceString(from, to).trim()
    if (standalone) {
      widgets.push({
        from: line.from,
        to: line.to,
        kind: 'image',
        data: { ...data, indent: String(leadingIndentColumns(line.text)) },
        block: true,
        reveal: isActive(line.from, line.to)
      })
      occupied.push({ from: line.from, to: line.to })
    } else if (!isRangeActive(from, to)) {
      widgets.push({ from, to, kind: 'image', data })
      occupied.push({ from, to })
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
        // Reveal both markers when the caret is anywhere inside the emphasis
        // span (the word between the markers), not only on the markers.
        const span = node.node.parent ?? node.node
        if (!isRangeActive(span.from, span.to)) {
          hideRange(node.from, node.to)
        }
        return
      }

      if (name === 'InlineCode') {
        marks.push({ from: node.from, to: node.to, cls: 'cm-md-code' })
        occupied.push({ from: node.from, to: node.to })
        return
      }

      // Inline code backticks: hide only when the mark belongs to InlineCode
      // (leave fenced-code fences alone so the block layout is preserved).
      if (name === 'CodeMark') {
        const parent = node.node.parent
        if (parent && parent.name === 'InlineCode' && !isRangeActive(parent.from, parent.to)) {
          hideRange(node.from, node.to)
        }
        return
      }

      if (name === 'Link') {
        // A linked image [![alt](img)](href) is rendered by its inner Image node
        // as a single image unit — don't also half-hide it as a link (which would
        // leave the image showing and the click going to "open link").
        if (node.node.getChild('Image')) {
          return
        }
        // Only render inline links ([label](url)); leave reference/bare links raw.
        const url = node.node.getChild('URL')
        if (url && !isRangeActive(node.from, node.to)) {
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
        const inner = node.node
        const url = inner.getChild('URL')
        const urlText = url ? doc.sliceString(url.from, url.to) : ''
        const alt = extractImageAlt(doc.sliceString(node.from, node.to))
        // For a linked image [![alt](img)](href), the render/edit unit is the
        // wrapping Link, so the whole construct reveals as one when edited and a
        // click lands on a plain image (not a link span).
        const parent = inner.parent
        const linkParent = parent && parent.name === 'Link' ? parent : null
        pushImageWidget(linkParent ? linkParent.from : node.from, linkParent ? linkParent.to : node.to, {
          url: urlText,
          alt
        })
        return
      }

      if (name === 'HorizontalRule') {
        if (!isActive(node.from, node.to)) {
          widgets.push({ from: node.from, to: node.to, kind: 'hr', data: {} })
          occupied.push({ from: node.from, to: node.to })
        }
        return
      }

      if (name === 'Blockquote') {
        // Nested blockquotes appear as Blockquote-inside-Blockquote in the tree;
        // only the outermost one drives the per-line classing (it spans every
        // line). Each line's nesting depth is read from its leading '>' markers
        // so `>`, `> >`, `> > >` render with 1/2/3 distinct bars + indentation.
        let ancestor = node.node.parent
        while (ancestor) {
          if (ancestor.name === 'Blockquote') {
            return
          }
          ancestor = ancestor.parent
        }
        const startLine = doc.lineAt(node.from).number
        const endLine = doc.lineAt(Math.min(node.to, doc.length)).number
        for (let n = startLine; n <= endLine; n += 1) {
          const line = doc.line(n)
          const depth = Math.min(quoteDepth(line.text) || 1, 4)
          lineClasses.push({ pos: line.from, cls: 'cm-md-quote' })
          lineClasses.push({ pos: line.from, cls: `cm-md-quote-${depth}` })
        }
        return
      }

      if (name === 'QuoteMark') {
        // Hide the ">" marker off the active line; the bar comes from the line class.
        if (!isActive(node.from, node.to)) {
          let end = node.to
          if (doc.sliceString(end, end + 1) === ' ') {
            end += 1
          }
          hideRange(node.from, end)
        }
        return
      }

      if (name === 'Table') {
        // A GFM table renders as a real table (block widget). Two cases:
        //   - Top-level table: ALWAYS rendered as an interactive, in-place
        //     editable grid (Obsidian-style). Clicking a cell edits it directly
        //     instead of switching the whole block to raw source — no layout
        //     churn from toggling source/render. (The grid stays put; only the
        //     focused cell swaps to raw text, handled in the widget.)
        //   - Table nested in a blockquote: rendered read-only, revealed as raw
        //     source when a selection sits inside it (editing through the `>`
        //     prefixes is unsafe to write back).
        // A malformed table (parse fails) emits no widget so its raw source shows
        // and can be fixed by hand.
        const from = doc.lineAt(node.from).from
        const to = doc.lineAt(Math.min(node.to, doc.length)).to
        const qd = quoteDepthAt(from)
        const raw = doc.sliceString(from, to)
        if (qd > 0) {
          if (!isBlockActive(from, to)) {
            widgets.push({
              from,
              to,
              kind: 'table',
              data: {
                source: stripQuotePrefix(raw, qd),
                indent: String(indentColsAt(from)),
                quoteDepth: String(qd)
              },
              block: true
            })
            occupied.push({ from, to })
            return false
          }
          return undefined
        }
        if (parseTable(raw)) {
          widgets.push({
            from,
            to,
            kind: 'table',
            data: {
              source: raw,
              indent: String(indentColsAt(from)),
              quoteDepth: '0'
            },
            block: true
          })
          occupied.push({ from, to })
          return false // don't decorate inside the replaced block
        }
        return undefined // malformed: leave the raw source visible to fix
      }

      if (name === 'ListMark') {
        // Render bullet-list markers (-, *, +) as a • dot; leave ordered-list
        // numbers as-is. Skip when the line is being edited.
        const list = node.node.parent?.parent
        if (list && list.name === 'BulletList' && !isActive(node.from, node.to)) {
          widgets.push({ from: node.from, to: node.to, kind: 'bullet', data: {} })
        }
        return
      }

      if (name === 'FencedCode') {
        // Give every line of the block a class so it reads as a code block, plus
        // open/close classes on the fence lines for rounded-corner styling.
        const startLine = doc.lineAt(node.from).number
        const endLine = doc.lineAt(Math.min(node.to, doc.length)).number
        occupied.push({ from: node.from, to: Math.min(node.to, doc.length) })
        // Off the active block, hide the ``` fences + language so only the code
        // shows (the fence lines collapse to a thin cap); reveal them while the
        // caret is inside so the block can be edited.
        const blockActive = isActive(node.from, node.to)

        // ```mermaid blocks render as a diagram when not being edited.
        let fenceLang = ''
        for (let child = node.node.firstChild; child; child = child.nextSibling) {
          if (child.name === 'CodeInfo') {
            fenceLang = doc.sliceString(child.from, child.to).trim().toLowerCase()
          }
        }
        if (fenceLang === 'mermaid' && !blockActive) {
          const from = doc.line(startLine).from
          const to = doc.line(endLine).to
          const hasBody = startLine + 1 <= endLine - 1
          const code = hasBody
            ? doc.sliceString(doc.line(startLine + 1).from, doc.line(endLine - 1).to)
            : ''
          const qd = quoteDepthAt(from)
          widgets.push({
            from,
            to,
            kind: 'mermaid',
            data: {
              code: qd > 0 ? stripQuotePrefix(code, qd) : code,
              indent: String(indentColsAt(from)),
              quoteDepth: String(qd)
            },
            block: true
          })
          occupied.push({ from, to })
          return false
        }
        const hasLang = fenceLang.length > 0
        for (let n = startLine; n <= endLine; n += 1) {
          const line = doc.line(n)
          lineClasses.push({ pos: line.from, cls: 'cm-md-codeblock' })
          if (n === startLine) {
            lineClasses.push({ pos: line.from, cls: 'cm-md-codeblock-open' })
          }
          if (n === endLine) {
            lineClasses.push({ pos: line.from, cls: 'cm-md-codeblock-close' })
          }
          if (!blockActive && n === endLine) {
            lineClasses.push({ pos: line.from, cls: 'cm-md-codefence' })
          }
          if (!blockActive && n === startLine) {
            // Open fence: when the block declares a language, keep that token
            // visible as a right-aligned label in the top cap; otherwise collapse
            // the fence line to a thin cap like the closing fence.
            lineClasses.push({ pos: line.from, cls: hasLang ? 'cm-md-codeblock-lang' : 'cm-md-codefence' })
          }
        }
        if (!blockActive) {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            // Always hide the ``` markers. Keep CodeInfo (the language) visible —
            // it renders as the top-right label.
            if (child.name === 'CodeMark') {
              hideRange(child.from, child.to)
            }
          }
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

  // Constructs the markdown grammar (GFM) doesn't model — TeX math ($…$, $$…$$)
  // and ==highlight== — are detected with a text scan over the regions not
  // already consumed by code / tables / images / rules. Block math is detected
  // first so inline math doesn't match the inner "$".
  const text = doc.toString()

  for (const m of findBlockMathMatches(text)) {
    if (rangesOverlap(m.start, m.end, occupied)) {
      continue
    }
    const startLine = doc.lineAt(m.start)
    const endLine = doc.lineAt(Math.min(m.end, doc.length))
    const leadOnly = startLine.text.slice(0, m.start - startLine.from).trim() === ''
    const trailOnly = endLine.text.slice(m.end - endLine.from).trim() === ''
    if (leadOnly && trailOnly) {
      // Standalone $$…$$ block: reveal only when a selection is inside it, so a
      // drag spanning across it doesn't toggle the layout (same rule as tables).
      if (isBlockActive(startLine.from, endLine.to)) {
        continue
      }
      const qd = quoteDepthAt(startLine.from)
      widgets.push({
        from: startLine.from,
        to: endLine.to,
        kind: 'math',
        data: {
          tex: qd > 0 ? stripQuotePrefix(m.inner, qd) : m.inner,
          display: '1',
          indent: String(leadingIndentColumns(startLine.text)),
          quoteDepth: String(qd)
        },
        block: true
      })
      occupied.push({ from: startLine.from, to: endLine.to })
    } else {
      // Inline-positioned display math: reveal when the caret is inside it.
      if (isRangeActive(m.start, m.end)) {
        continue
      }
      widgets.push({ from: m.start, to: m.end, kind: 'math', data: { tex: m.inner, display: '1' } })
      occupied.push({ from: m.start, to: m.end })
    }
  }

  for (const m of findInlineMathMatches(text)) {
    if (rangesOverlap(m.start, m.end, occupied) || isRangeActive(m.start, m.end)) {
      continue
    }
    widgets.push({ from: m.start, to: m.end, kind: 'math', data: { tex: m.inner, display: '' } })
    occupied.push({ from: m.start, to: m.end })
  }

  for (const m of findHighlightMatches(text)) {
    if (rangesOverlap(m.start, m.end, occupied)) {
      continue
    }
    // Always style the highlighted span; only hide the "==" fences when the
    // caret isn't inside this span so the marker can be edited where it sits.
    marks.push({ from: m.start, to: m.end, cls: 'cm-md-highlight' })
    if (!isRangeActive(m.start, m.end)) {
      hideRange(m.start, m.start + 2)
      hideRange(m.end - 2, m.end)
    }
    occupied.push({ from: m.start, to: m.end })
  }

  // HTML comments: hide single-line ones off the active line; dim multi-line ones
  // with a mark (a line-spanning hide can't be provided from the plugin).
  for (const c of findHtmlComments(text)) {
    if (rangesOverlap(c.start, c.end, occupied)) {
      continue
    }
    occupied.push({ from: c.start, to: c.end })
    if (isRangeActive(c.start, c.end)) {
      continue
    }
    const singleLine = doc.lineAt(c.start).number === doc.lineAt(Math.min(c.end, doc.length)).number
    if (singleLine) {
      hideRange(c.start, c.end)
    } else {
      marks.push({ from: c.start, to: c.end, cls: 'cm-md-comment' })
    }
  }

  // <details>…</details> -> collapsible block widget. Scanned before <dl> so a
  // dl nested inside the details isn't also matched separately.
  for (const d of findHtmlDetails(text)) {
    if (rangesOverlap(d.start, d.end, occupied)) {
      continue
    }
    const from = doc.lineAt(d.start).from
    const to = doc.lineAt(Math.min(d.end, doc.length)).to
    occupied.push({ from, to })
    if (isBlockActive(from, to)) {
      continue
    }
    const qd = quoteDepthAt(from)
    const raw = doc.sliceString(from, to)
    widgets.push({
      from,
      to,
      kind: 'details',
      data: {
        source: qd > 0 ? stripQuotePrefix(raw, qd) : raw,
        indent: String(indentColsAt(from)),
        quoteDepth: String(qd)
      },
      block: true
    })
  }

  // <dl>…</dl> definition lists -> block widget (revealed when selected inside).
  for (const d of findHtmlDefinitionLists(text)) {
    if (rangesOverlap(d.start, d.end, occupied)) {
      continue
    }
    const from = doc.lineAt(d.start).from
    const to = doc.lineAt(Math.min(d.end, doc.length)).to
    occupied.push({ from, to })
    if (isBlockActive(from, to)) {
      continue
    }
    const qd = quoteDepthAt(from)
    const raw = doc.sliceString(from, to)
    widgets.push({
      from,
      to,
      kind: 'dl',
      data: {
        source: qd > 0 ? stripQuotePrefix(raw, qd) : raw,
        indent: String(indentColsAt(from)),
        quoteDepth: String(qd)
      },
      block: true
    })
  }

  // <img …> with optional width/height -> image widget (same standalone/block
  // treatment as Markdown images).
  for (const img of findHtmlImages(text)) {
    if (rangesOverlap(img.start, img.end, occupied)) {
      continue
    }
    pushImageWidget(img.start, img.end, {
      url: img.src,
      alt: img.alt,
      width: img.width,
      height: img.height
    })
  }

  // <sup>/<sub>/<mark> -> styled spans; hide the tags off the active line.
  for (const t of findHtmlInlineTags(text)) {
    if (rangesOverlap(t.start, t.end, occupied)) {
      continue
    }
    occupied.push({ from: t.start, to: t.end })
    const cls =
      t.tag === 'sup'
        ? 'cm-md-sup'
        : t.tag === 'sub'
          ? 'cm-md-sub'
          : t.tag === 'u'
            ? 'cm-md-underline'
            : t.tag === 'kbd'
              ? 'cm-md-kbd'
              : 'cm-md-highlight'
    marks.push({ from: t.innerStart, to: t.innerEnd, cls })
    if (!isRangeActive(t.start, t.end)) {
      hideRange(t.start, t.innerStart)
      hideRange(t.innerEnd, t.end)
    }
  }

  // <span style="…">…</span> -> styled span (sanitized inline style applied via
  // a mark's attributes, never innerHTML). Bare <span> just shows its content.
  for (const s of findHtmlStyledSpans(text)) {
    if (rangesOverlap(s.start, s.end, occupied)) {
      continue
    }
    occupied.push({ from: s.start, to: s.end })
    if (s.style) {
      marks.push({ from: s.innerStart, to: s.innerEnd, cls: 'cm-md-styled', attrs: { style: s.style } })
    }
    if (!isRangeActive(s.start, s.end)) {
      hideRange(s.start, s.innerStart)
      hideRange(s.innerEnd, s.end)
    }
  }

  // Per-line metadata: footnote definitions ([^id]: …) get a styled marker;
  // reference-style link definitions ([label]: url "title") are dimmed whole.
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n)
    if (line.text.length === 0 || active.has(n) || rangesOverlap(line.from, line.to, occupied)) {
      continue
    }
    const fd = findFootnoteDefinition(line.text)
    if (fd.ok) {
      marks.push({ from: line.from, to: line.from + fd.markerLen, cls: 'cm-md-footnote-def' })
      occupied.push({ from: line.from, to: line.from + fd.markerLen })
      continue
    }
    if (findReferenceDefinition(line.text).ok) {
      marks.push({ from: line.from, to: line.to, cls: 'cm-md-linkdef' })
      occupied.push({ from: line.from, to: line.to })
    }
  }

  // Autolinks <url> / <email>: hide the angle brackets, style as a link.
  for (const a of findAutolinks(text)) {
    if (rangesOverlap(a.start, a.end, occupied)) {
      continue
    }
    occupied.push({ from: a.start, to: a.end })
    marks.push({ from: a.start + 1, to: a.end - 1, cls: 'cm-md-link' })
    if (!isRangeActive(a.start, a.end)) {
      hideRange(a.start, a.start + 1)
      hideRange(a.end - 1, a.end)
    }
  }

  // Footnote references [^id] -> superscript marker (hide the brackets).
  for (const f of findFootnoteRefs(text)) {
    if (rangesOverlap(f.start, f.end, occupied)) {
      continue
    }
    occupied.push({ from: f.start, to: f.end })
    marks.push({ from: f.labelStart, to: f.labelEnd, cls: 'cm-md-footnote-ref' })
    if (!isRangeActive(f.start, f.end)) {
      hideRange(f.start, f.labelStart)
      hideRange(f.labelEnd, f.end)
    }
  }

  // :shortcode: emoji -> emoji widget (off the active line).
  for (const e of findEmojiShortcodes(text)) {
    if (rangesOverlap(e.start, e.end, occupied)) {
      continue
    }
    occupied.push({ from: e.start, to: e.end })
    if (!isRangeActive(e.start, e.end)) {
      widgets.push({ from: e.start, to: e.end, kind: 'emoji', data: { emoji: e.emoji } })
    }
  }

  return { hides, marks, lineClasses, widgets }
}

/** True when [from, to) intersects any of the given ranges. */
function rangesOverlap(from: number, to: number, ranges: HideRange[]): boolean {
  for (const r of ranges) {
    if (from < r.to && r.from < to) {
      return true
    }
  }
  return false
}

export interface RawMatch {
  start: number
  end: number
  /** The inner payload (math TeX / highlighted text), already trimmed for math. */
  inner: string
}

/**
 * Finds `==highlight==` spans on a single line. The inner text must be padded by
 * non-space (so `== a ==` and stray "a == b" comparisons don't match) and may not
 * contain "=".
 */
export function findHighlightMatches(text: string): RawMatch[] {
  const out: RawMatch[] = []
  const re = /==([^\n=]+?)==/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]
    if (inner.length > 0 && inner.trim() === inner) {
      out.push({ start: m.index, end: m.index + m[0].length, inner })
    }
  }
  return out
}

// --- Inline / block HTML the markdown grammar leaves as raw text -----------
// A safe, fixed subset is rendered (never via innerHTML of user content):
// <sup>/<sub>/<mark> as styled spans, <!-- … --> comments hidden, <img …> with
// size, and <dl> definition lists. These are detected with scoped scans over
// the regions not already consumed by code / tables / math.

export interface HtmlTagMatch {
  tag: 'sup' | 'sub' | 'mark' | 'u' | 'kbd'
  start: number
  innerStart: number
  innerEnd: number
  end: number
}

/** Finds paired inline tags `<sup>`, `<sub>`, `<mark>`, `<u>`, `<kbd>` and their inner range. */
export function findHtmlInlineTags(text: string): HtmlTagMatch[] {
  const out: HtmlTagMatch[] = []
  const re = /<(sup|sub|mark|u|kbd)>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tag = m[1].toLowerCase() as HtmlTagMatch['tag']
    const start = m.index
    const innerStart = start + m[1].length + 2 // "<tag>"
    const innerEnd = innerStart + m[2].length
    const end = start + m[0].length
    if (innerEnd > innerStart) {
      out.push({ tag, start, innerStart, innerEnd, end })
    }
  }
  return out
}

export interface StyledSpanMatch {
  start: number
  innerStart: number
  innerEnd: number
  end: number
  /** Already-sanitized inline style (may be empty if nothing safe remained). */
  style: string
}

// CSS properties allowed on a rendered `<span style="…">`. Kept to visual,
// non-layout-breaking, side-effect-free properties.
const SAFE_STYLE_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'font-weight',
  'font-style',
  'font-size',
  'font-family',
  'text-decoration',
  'text-decoration-color',
  'text-transform',
  'letter-spacing',
  'opacity'
])

/**
 * Sanitizes an inline `style` string to a safe subset: only whitelisted
 * properties are kept, and any value carrying a dangerous token (url(),
 * expression(), javascript:, @import, comments, angle brackets) is dropped.
 * This never produces script execution — it's a defense-in-depth filter applied
 * before the value is set via setAttribute (never innerHTML).
 */
export function sanitizeInlineStyle(style: string): string {
  const out: string[] = []
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) {
      continue
    }
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (!prop || !value || !SAFE_STYLE_PROPS.has(prop)) {
      continue
    }
    if (/[<>]|url\s*\(|expression\s*\(|javascript:|@import|\/\*|\*\//i.test(value)) {
      continue
    }
    out.push(`${prop}: ${value}`)
  }
  return out.join('; ')
}

/** Finds `<span …>…</span>` runs, extracting the inner range and a sanitized style. */
export function findHtmlStyledSpans(text: string): StyledSpanMatch[] {
  const out: StyledSpanMatch[] = []
  const re = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const attrs = m[1]
    const start = m.index
    const innerStart = start + '<span'.length + attrs.length + 1 // "<span" + attrs + ">"
    const innerEnd = innerStart + m[2].length
    const end = start + m[0].length
    if (innerEnd <= innerStart) {
      continue
    }
    out.push({ start, innerStart, innerEnd, end, style: sanitizeInlineStyle(readHtmlAttr(attrs, 'style')) })
  }
  return out
}

/** Finds HTML comments `<!-- … -->`. */
export function findHtmlComments(text: string): RawMatch[] {
  const out: RawMatch[] = []
  const re = /<!--[\s\S]*?-->/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, inner: m[0] })
  }
  return out
}

export interface HtmlImageMatch {
  start: number
  end: number
  src: string
  alt: string
  width: string
  height: string
}

/** Reads a single HTML attribute value (double/single/unquoted) from a tag. */
function readHtmlAttr(tag: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return m ? m[2] ?? m[3] ?? m[4] ?? '' : ''
}

/** Finds raw `<img …>` tags (used for HTML images with explicit sizing). */
export function findHtmlImages(text: string): HtmlImageMatch[] {
  const out: HtmlImageMatch[] = []
  const re = /<img\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tag = m[0]
    const src = readHtmlAttr(tag, 'src')
    if (!src) {
      continue
    }
    out.push({
      start: m.index,
      end: m.index + tag.length,
      src,
      alt: readHtmlAttr(tag, 'alt'),
      width: readHtmlAttr(tag, 'width'),
      height: readHtmlAttr(tag, 'height')
    })
  }
  return out
}

export interface DefinitionItem {
  /** True for a `<dt>` term, false for a `<dd>` description. */
  term: boolean
  text: string
}

function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

/** Parses the dt/dd items out of a `<dl>…</dl>` block (text only, XSS-safe). */
export function parseDefinitionList(source: string): DefinitionItem[] {
  const out: DefinitionItem[] = []
  const re = /<(dt|dd)>([\s\S]*?)<\/\1>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    out.push({ term: m[1].toLowerCase() === 'dt', text: stripHtmlTags(m[2]).trim() })
  }
  return out
}

/** Finds `<dl>…</dl>` definition-list blocks. */
export function findHtmlDefinitionLists(text: string): RawMatch[] {
  const out: RawMatch[] = []
  const re = /<dl>[\s\S]*?<\/dl>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, inner: m[0] })
  }
  return out
}

/** Finds `<details>…</details>` collapsible blocks (with optional attributes). */
export function findHtmlDetails(text: string): RawMatch[] {
  const out: RawMatch[] = []
  const re = /<details\b[^>]*>[\s\S]*?<\/details>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, inner: m[0] })
  }
  return out
}

export interface DetailsParts {
  /** Whether the source declares `<details open>` (rendered expanded). */
  open: boolean
  /** Plain-text summary label (markup stripped for safety). */
  summary: string
  /** Markdown body between </summary> and </details>. */
  body: string
}

/** Splits a `<details>` block source into its open flag, summary, and body. */
export function parseDetails(source: string): DetailsParts {
  const open = /^<details\b[^>]*\bopen\b/i.test(source)
  const inner = source.replace(/^<details\b[^>]*>/i, '').replace(/<\/details>\s*$/i, '')
  const sm = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner)
  const summary = sm ? stripHtmlTags(sm[1]).trim() || '详情' : '详情'
  const body = (sm ? inner.slice(sm.index + sm[0].length) : inner).trim()
  return { open, summary, body }
}

// --- Links / footnotes / emoji (Batch B) -----------------------------------

export interface AutolinkMatch {
  start: number
  end: number
  /** Visible address (URL or email). */
  inner: string
  /** Full href the link points at (email gets a mailto: prefix). */
  href: string
  email: boolean
}

/** Finds CommonMark autolinks `<https://…>` and `<a@b.com>`. */
export function findAutolinks(text: string): AutolinkMatch[] {
  const out: AutolinkMatch[] = []
  const re = /<((?:https?|ftp|mailto):[^>\s]+|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]
    const email = !/^[a-z]+:/i.test(inner)
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      inner,
      href: email ? `mailto:${inner}` : inner,
      email
    })
  }
  return out
}

/** Finds a reference-style link definition `[label]: url "title"` on its own line. */
export function findReferenceDefinition(lineText: string): { ok: boolean } {
  return { ok: /^[ \t]{0,3}\[[^\]]+\]:\s+\S+/.test(lineText) }
}

export interface FootnoteRefMatch {
  start: number
  end: number
  labelStart: number
  labelEnd: number
}

/** Finds footnote references `[^id]` (excludes a definition `[^id]:`). */
export function findFootnoteRefs(text: string): FootnoteRefMatch[] {
  const out: FootnoteRefMatch[] = []
  const re = /\[\^([^\]\s]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // Skip a definition marker `[^id]:` at the start of its line.
    if (text[m.index + m[0].length] === ':') {
      const lineStart = text.lastIndexOf('\n', m.index - 1) + 1
      if (text.slice(lineStart, m.index).trim() === '') {
        continue
      }
    }
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      labelStart: m.index + 2,
      labelEnd: m.index + 2 + m[1].length
    })
  }
  return out
}

/** Tests whether a line is a footnote definition `[^id]: …`. */
export function findFootnoteDefinition(lineText: string): { ok: boolean; markerLen: number } {
  const m = /^(\[\^[^\]\s]+\]:)/.exec(lineText)
  return { ok: !!m, markerLen: m ? m[1].length : 0 }
}

export interface EmojiMatch {
  start: number
  end: number
  emoji: string
}

/** Finds `:shortcode:` runs that map to a known emoji. */
export function findEmojiShortcodes(text: string): EmojiMatch[] {
  const out: EmojiMatch[] = []
  const re = /:([a-z0-9_+-]+):/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const emoji = emojiForShortcode(m[1])
    if (emoji) {
      out.push({ start: m.index, end: m.index + m[0].length, emoji })
    }
  }
  return out
}

/** Finds display math `$$…$$`, which may span multiple lines. */
export function findBlockMathMatches(text: string): RawMatch[] {
  const out: RawMatch[] = []
  const re = /\$\$([\s\S]+?)\$\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim()
    if (inner.length > 0) {
      out.push({ start: m.index, end: m.index + m[0].length, inner })
    }
  }
  return out
}

/**
 * Finds inline math `$…$` on a single line. The inner expression must be padded
 * by non-space, and a currency guard skips "$5 … $10" style text (a digit right
 * after the closing "$", or an alphanumeric right before the opening "$").
 */
export function findInlineMathMatches(text: string): RawMatch[] {
  const out: RawMatch[] = []
  const re = /\$([^\n$]+?)\$/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const inner = m[1]
    const start = m.index
    const end = start + m[0].length
    if (inner.length === 0 || inner.trim() !== inner) {
      continue
    }
    const before = start > 0 ? text[start - 1] : ''
    const after = end < text.length ? text[end] : ''
    if (/\d/.test(after) || /[A-Za-z0-9]/.test(before)) {
      continue
    }
    out.push({ start, end, inner })
  }
  return out
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

/**
 * GitHub-style anchor slug used to resolve in-document links `[text](#anchor)`:
 * lowercase, drop punctuation, collapse spaces to hyphens; keeps word characters
 * and CJK so Chinese headings get a usable anchor.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff -]+/g, '')
    .replace(/ +/g, '-')
}

/** Returns the anchor slug of an ATX heading line, or null when not a heading. */
export function headingSlug(lineText: string): string | null {
  const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(lineText)
  return m ? slugify(m[1]) : null
}

/**
 * Counts the blockquote nesting depth of a line from its leading `>` markers
 * (`> >` → 2). Returns 0 when the line has no quote prefix (a lazy
 * continuation line, which the caller treats as depth 1).
 */
export function quoteDepth(lineText: string): number {
  const m = /^[ \t]*((?:>[ \t]?)+)/.exec(lineText)
  return m ? (m[1].match(/>/g) ?? []).length : 0
}

/**
 * Counts a line's leading-indent columns (a tab counts as 4). This is the
 * structural indentation a block construct sits at when it's nested inside a
 * list (e.g. a table indented under a list item has leading spaces). It is used
 * to indent list-nested *block widgets* — tables, mermaid, display math,
 * definition lists, `<details>`, standalone images — which otherwise replace the
 * whole line and would render flush at the far-left margin, detached from the
 * list item that contains them. (Plain text, code and quotes keep their indent
 * for free because their leading whitespace is rendered as-is.)
 */
export function leadingIndentColumns(text: string): number {
  let cols = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === ' ') {
      cols += 1
    } else if (ch === '\t') {
      cols += 4
    } else {
      break
    }
  }
  return cols
}

/**
 * Strips up to `depth` leading blockquote markers (`>` + optional space) from
 * each line of `text`. Block constructs nested in a quote (tables, fenced code,
 * `$$` math, mermaid, `<dl>`, `<details>`) are rendered by a widget built from
 * the raw line range, which still carries the `> ` prefixes; this recovers the
 * inner source so the widget parses/renders correctly. Lazy-continuation lines
 * (no `>`) are left as-is.
 */
export function stripQuotePrefix(text: string, depth: number): string {
  if (depth <= 0) {
    return text
  }
  return text
    .split('\n')
    .map((line) => {
      let s = line
      for (let i = 0; i < depth; i += 1) {
        const m = /^[ \t]*>[ \t]?/.exec(s)
        if (!m) {
          break
        }
        s = s.slice(m[0].length)
      }
      return s
    })
    .join('\n')
}
