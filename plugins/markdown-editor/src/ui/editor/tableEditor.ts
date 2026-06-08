// Interactive table widget DOM for the live preview. Renders a GFM table that
// stays rendered (never switches the whole block to raw source) and is edited
// in place — Obsidian-style:
//   - Each cell is a contenteditable region. Idle, it shows its inline-Markdown
//     render; on focus it swaps to the raw cell text so it can be edited.
//   - Edits accumulate in an in-memory model and are written back to the document
//     only when focus leaves the whole table, so moving between cells never
//     rebuilds the widget (which would drop focus).
//   - Hover-revealed controls add a row/column at the end, delete a row/column,
//     cycle a column's alignment, and drag a row/column to a new position. Those
//     structural edits commit immediately.
// The contenteditable lives in a *child* element (CodeMirror forces the widget
// root to contenteditable=false); the TableWidget returns true from ignoreEvent
// and ignoreMutation so CodeMirror doesn't fight the in-cell editing.

import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import type { EditorView } from '@codemirror/view'
import {
  addColumn,
  addRow,
  escapeCell,
  moveColumn,
  moveRow,
  nextAlign,
  parseTable,
  removeColumn,
  removeRow,
  serializeTable,
  setColumnAlign,
  unescapeCell,
  type TableAlign,
  type TableData
} from './tableModel'
import { renderMarkdownDocument, renderMarkdownInline } from '../services/markdownHtml'

/** Finds the document range of the Table node enclosing (or starting at) `pos`. */
function tableRangeAt(view: EditorView, pos: number): { from: number; to: number } | null {
  const tree = syntaxTree(view.state)
  const tries = [pos, Math.min(pos + 1, view.state.doc.length), Math.max(pos - 1, 0)]
  for (const p of tries) {
    for (let node: SyntaxNode | null = tree.resolveInner(p, 1); node; node = node.parent) {
      if (node.name === 'Table') {
        return { from: node.from, to: node.to }
      }
    }
  }
  return null
}

function styleAlign(el: HTMLElement, align: TableAlign): void {
  if (align !== 'none') {
    el.style.textAlign = align
  }
}

function ctlButton(className: string, title: string, glyph: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `cm-md-table-ctl ${className}`
  btn.title = title
  btn.tabIndex = -1
  // Controls are never editable text — keep them out of the contenteditable model.
  btn.contentEditable = 'false'
  btn.textContent = glyph
  return btn
}

/** Glyph shown on the alignment toggle for the column's current alignment. */
function alignGlyph(align: TableAlign): string {
  switch (align) {
    case 'left':
      return '\u2966' // ⥦ leftwards
    case 'center':
      return '\u2261' // ≡ centered bars
    case 'right':
      return '\u2967' // ⥧ rightwards
    default:
      return '\u2194' // ↔ none
  }
}

function alignLabel(align: TableAlign): string {
  switch (align) {
    case 'left':
      return '左对齐'
    case 'center':
      return '居中'
    case 'right':
      return '右对齐'
    default:
      return '默认'
  }
}

/** Moves the caret to the end of a contenteditable element. */
function placeCaretAtEnd(el: HTMLElement): void {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  if (sel) {
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

/**
 * Builds the interactive, in-place editable table DOM. `view` locates the table's
 * source range and dispatches edits; `source` is the raw Markdown of the table.
 */
export function buildInteractiveTable(view: EditorView, source: string): HTMLElement {
  const root = document.createElement('div')
  root.className = 'cm-md-table'

  const work = parseTable(source)
  if (!work) {
    // Not a parseable table: fall back to a plain rendered table.
    root.innerHTML = renderMarkdownDocument(source)
    return root
  }

  // Serialized form of the table as last written to the document. Used to skip a
  // no-op commit when focus leaves the table without any real change.
  let committed = serializeTable(work)

  // Reads/writes the working model for a cell element (row -1 = header row).
  const cellCoords = (el: HTMLElement): { row: number; col: number } => ({
    row: Number.parseInt(el.dataset.row ?? '0', 10),
    col: Number.parseInt(el.dataset.col ?? '0', 10)
  })
  const getCellValue = (el: HTMLElement): string => {
    const { row, col } = cellCoords(el)
    return row < 0 ? work.headers[col] ?? '' : work.rows[row]?.[col] ?? ''
  }
  const setCellValue = (el: HTMLElement, value: string): void => {
    const { row, col } = cellCoords(el)
    if (row < 0) {
      if (col >= 0 && col < work.headers.length) {
        work.headers[col] = value
      }
    } else if (work.rows[row] && col >= 0 && col < work.rows[row].length) {
      work.rows[row][col] = value
    }
  }

  // Cells currently in raw-edit mode (showing source text instead of a render).
  const editing = new WeakSet<HTMLElement>()

  const enterRaw = (cell: HTMLElement, caretToEnd: boolean): void => {
    if (editing.has(cell)) {
      return
    }
    editing.add(cell)
    const v = getCellValue(cell)
    cell.dataset.orig = v
    cell.textContent = unescapeCell(v)
    cell.classList.add('cm-md-cell-editing')
    if (caretToEnd) {
      placeCaretAtEnd(cell)
    }
  }

  const exitRaw = (cell: HTMLElement): void => {
    if (!editing.has(cell)) {
      return
    }
    editing.delete(cell)
    const escaped = escapeCell(cell.textContent ?? '')
    setCellValue(cell, escaped)
    cell.classList.remove('cm-md-cell-editing')
    cell.innerHTML = renderMarkdownInline(escaped)
    delete cell.dataset.orig
  }

  // Writes the working model back to the document. CodeMirror then rebuilds the
  // widget from the new Markdown. A no-op when nothing changed.
  const commitWork = (): void => {
    const insert = serializeTable(work)
    if (insert === committed) {
      return
    }
    const pos = view.posAtDOM(root)
    const range = tableRangeAt(view, pos)
    if (!range) {
      return
    }
    committed = insert
    view.dispatch({ changes: { from: range.from, to: range.to, insert } })
  }

  // Applies a structural change (add / remove / move / align) immediately.
  const commitStructural = (next: TableData): void => {
    const insert = serializeTable(next)
    if (insert === committed) {
      return
    }
    const pos = view.posAtDOM(root)
    const range = tableRangeAt(view, pos)
    if (!range) {
      return
    }
    committed = insert
    view.dispatch({ changes: { from: range.from, to: range.to, insert } })
  }

  const cellAt = (row: number, col: number): HTMLElement | null =>
    root.querySelector<HTMLElement>(`.cm-md-cellbody[data-row="${row}"][data-col="${col}"]`)

  // Drag state shared across the table's grips/targets.
  let dragKind: 'row' | 'col' | null = null
  let dragIndex = -1
  const clearDropMarks = () => {
    root.querySelectorAll('.cm-md-drop-target').forEach((el) => el.classList.remove('cm-md-drop-target'))
  }

  const frame = document.createElement('div')
  frame.className = 'cm-md-table-frame'

  const scroll = document.createElement('div')
  scroll.className = 'cm-md-table-scroll'

  const table = document.createElement('table')
  table.className = 'cm-md-table-el'

  // Builds an editable cell body for the given coordinates (row -1 = header).
  const buildCellBody = (row: number, col: number, value: string): HTMLElement => {
    const body = document.createElement('span')
    body.className = 'cm-md-cellbody'
    body.contentEditable = 'true'
    body.spellcheck = false
    body.dataset.row = String(row)
    body.dataset.col = String(col)
    body.innerHTML = renderMarkdownInline(value)
    return body
  }

  // ---- header ----
  const thead = document.createElement('thead')
  const headTr = document.createElement('tr')
  work.headers.forEach((cell, colIndex) => {
    const th = document.createElement('th')
    styleAlign(th, work.aligns[colIndex])

    const tools = document.createElement('div')
    tools.className = 'cm-md-col-tools'
    tools.contentEditable = 'false'

    const grip = ctlButton('cm-md-col-grip', '拖动调整列顺序', '\u2630')
    grip.draggable = true
    grip.addEventListener('dragstart', (e) => {
      e.stopPropagation()
      dragKind = 'col'
      dragIndex = colIndex
      e.dataTransfer?.setData('text/plain', 'col')
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
      }
    })
    grip.addEventListener('dragend', () => {
      dragKind = null
      dragIndex = -1
      clearDropMarks()
    })
    tools.appendChild(grip)

    const align = ctlButton(
      'cm-md-col-align',
      `列对齐：${alignLabel(work.aligns[colIndex])}（点击切换）`,
      alignGlyph(work.aligns[colIndex])
    )
    align.addEventListener('click', (e) => {
      e.preventDefault()
      commitStructural(setColumnAlign(work, colIndex, nextAlign(work.aligns[colIndex])))
    })
    tools.appendChild(align)

    const del = ctlButton('cm-md-col-del', '删除此列', '\u2715')
    del.addEventListener('click', (e) => {
      e.preventDefault()
      commitStructural(removeColumn(work, colIndex))
    })
    tools.appendChild(del)

    th.appendChild(tools)
    th.appendChild(buildCellBody(-1, colIndex, cell))

    // Column drop target.
    th.addEventListener('dragover', (e) => {
      if (dragKind === 'col') {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move'
        }
        clearDropMarks()
        th.classList.add('cm-md-drop-target')
      }
    })
    th.addEventListener('drop', (e) => {
      if (dragKind === 'col' && dragIndex >= 0) {
        e.preventDefault()
        e.stopPropagation()
        commitStructural(moveColumn(work, dragIndex, colIndex))
      }
    })

    headTr.appendChild(th)
  })
  thead.appendChild(headTr)
  table.appendChild(thead)

  // ---- body ----
  const tbody = document.createElement('tbody')
  work.rows.forEach((row, rowIndex) => {
    const tr = document.createElement('tr')
    row.forEach((cell, colIndex) => {
      const td = document.createElement('td')
      styleAlign(td, work.aligns[colIndex])

      if (colIndex === 0) {
        const tools = document.createElement('div')
        tools.className = 'cm-md-row-tools'
        tools.contentEditable = 'false'

        const grip = ctlButton('cm-md-row-grip', '拖动调整行顺序', '\u2630')
        grip.draggable = true
        grip.addEventListener('dragstart', (e) => {
          e.stopPropagation()
          dragKind = 'row'
          dragIndex = rowIndex
          e.dataTransfer?.setData('text/plain', 'row')
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
          }
        })
        grip.addEventListener('dragend', () => {
          dragKind = null
          dragIndex = -1
          clearDropMarks()
        })
        tools.appendChild(grip)

        const del = ctlButton('cm-md-row-del', '删除此行', '\u2715')
        del.addEventListener('click', (e) => {
          e.preventDefault()
          commitStructural(removeRow(work, rowIndex))
        })
        tools.appendChild(del)

        td.appendChild(tools)
      }

      td.appendChild(buildCellBody(rowIndex, colIndex, cell))
      tr.appendChild(td)
    })

    tr.addEventListener('dragover', (e) => {
      if (dragKind === 'row') {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move'
        }
        clearDropMarks()
        tr.classList.add('cm-md-drop-target')
      }
    })
    tr.addEventListener('drop', (e) => {
      if (dragKind === 'row' && dragIndex >= 0) {
        e.preventDefault()
        e.stopPropagation()
        commitStructural(moveRow(work, dragIndex, rowIndex))
      }
    })

    tbody.appendChild(tr)
  })
  table.appendChild(tbody)
  scroll.appendChild(table)
  frame.appendChild(scroll)

  // ---- add-column rail (right edge) ----
  const addCol = ctlButton('cm-md-add-col', '在末尾添加一列', '\uFF0B')
  addCol.addEventListener('click', (e) => {
    e.preventDefault()
    commitStructural(addColumn(work, work.headers.length))
  })
  frame.appendChild(addCol)

  // ---- add-row bar (bottom edge) ----
  const addRowBtn = ctlButton('cm-md-add-row', '在末尾添加一行', '\uFF0B')
  addRowBtn.addEventListener('click', (e) => {
    e.preventDefault()
    commitStructural(addRow(work, work.rows.length))
  })
  frame.appendChild(addRowBtn)

  // ---- in-place cell editing (delegated on the root) ----
  const cellFromEvent = (e: Event): HTMLElement | null => {
    const t = e.target as HTMLElement | null
    return t?.closest?.('.cm-md-cellbody') as HTMLElement | null
  }

  // mousedown: swap the clicked cell to raw text *before* the browser places the
  // caret, so a single click lands the caret near the click point in the source.
  root.addEventListener('mousedown', (e) => {
    const cell = cellFromEvent(e)
    if (cell && !editing.has(cell)) {
      enterRaw(cell, false)
    }
  })
  // focusin (keyboard navigation): swap to raw with the caret at the end.
  root.addEventListener('focusin', (e) => {
    const cell = cellFromEvent(e)
    if (cell && !editing.has(cell)) {
      enterRaw(cell, true)
    }
  })
  // Keep the working model current as the user types (so a structural control
  // clicked mid-edit sees the latest cell text).
  root.addEventListener('input', (e) => {
    const cell = cellFromEvent(e)
    if (cell && editing.has(cell)) {
      setCellValue(cell, escapeCell(cell.textContent ?? ''))
    }
  })
  // focusout: re-render the cell that lost focus; if focus left the whole table,
  // write the accumulated edits back to the document.
  root.addEventListener('focusout', (e) => {
    const cell = cellFromEvent(e)
    if (cell) {
      exitRaw(cell)
    }
    const related = (e as FocusEvent).relatedTarget as Node | null
    if (!related || !root.contains(related)) {
      commitWork()
    }
  })
  // Keyboard: Enter/Tab navigate between cells (no newlines in a cell); Escape
  // cancels the current cell's edit.
  root.addEventListener('keydown', (e) => {
    const cell = cellFromEvent(e)
    if (!cell) {
      return
    }
    const { row, col } = cellCoords(cell)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const next = cellAt(row + 1, col)
      if (next) {
        next.focus()
      } else {
        cell.blur()
        view.focus()
      }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const cols = work.headers.length
      const forward = !e.shiftKey
      let r = row
      let c = col + (forward ? 1 : -1)
      if (c >= cols) {
        c = 0
        r += 1
      } else if (c < 0) {
        c = cols - 1
        r -= 1
      }
      const next = cellAt(r, c)
      if (next) {
        next.focus()
      } else {
        cell.blur()
        view.focus()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      const orig = cell.dataset.orig ?? getCellValue(cell)
      cell.textContent = unescapeCell(orig)
      setCellValue(cell, orig)
      cell.blur()
      view.focus()
    }
  })

  root.appendChild(frame)
  return root
}
