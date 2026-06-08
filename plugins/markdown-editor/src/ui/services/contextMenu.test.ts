import assert from 'node:assert/strict'
import { buildContextMenu, type MenuItem } from './contextMenu'

/** Collects every (including nested) item id into a flat set. */
function ids(items: MenuItem[]): Set<string> {
  const out = new Set<string>()
  const walk = (list: MenuItem[]) => {
    for (const item of list) {
      out.add(item.id)
      if (item.submenu) {
        walk(item.submenu)
      }
    }
  }
  walk(items)
  return out
}

/** Finds an item by id anywhere in the tree. */
function find(items: MenuItem[], id: string): MenuItem | undefined {
  for (const item of items) {
    if (item.id === id) {
      return item
    }
    if (item.submenu) {
      const hit = find(item.submenu, id)
      if (hit) {
        return hit
      }
    }
  }
  return undefined
}

// Plain text, no selection: paste + insert + AI + find/select-all, no cut/copy/format.
{
  const m = buildContextMenu({ hasSelection: false, node: null })
  const set = ids(m)
  assert.ok(set.has('paste'), 'has paste')
  assert.ok(set.has('insert') && set.has('ins-table'), 'has insert submenu')
  assert.ok(set.has('ai'), 'no-selection menu includes the AI item')
  assert.ok(set.has('find') && set.has('replace') && set.has('select-all'), 'has find/replace/select-all')
  assert.ok(!set.has('cut') && !set.has('copy'), 'no cut/copy without a selection')
  assert.ok(!set.has('format') && !set.has('convert'), 'no format/convert without a selection')
}

// Selection: cut/copy/paste + format/convert/make-link, and NO AI item (the
// floating bubble already appears on selection).
{
  const m = buildContextMenu({ hasSelection: true, node: null })
  const set = ids(m)
  assert.ok(set.has('cut') && set.has('copy') && set.has('paste'), 'clipboard trio on selection')
  assert.ok(set.has('format') && set.has('fmt-bold'), 'format submenu')
  assert.ok(set.has('convert') && set.has('cv-h2'), 'convert submenu')
  assert.ok(set.has('make-link'), 'make-link on selection')
  assert.ok(!set.has('ai'), 'no AI item with a selection (bubble already shows)')
  assert.ok(!set.has('insert'), 'no insert submenu with a selection')
}

// Link node: open/copy/edit/unlink present.
{
  const m = buildContextMenu({ hasSelection: false, node: 'link' })
  const set = ids(m)
  assert.ok(
    ['link-open', 'link-copy', 'link-edit', 'link-unlink'].every((id) => set.has(id)),
    'all link actions present'
  )
}

// Image node: copy/open/remove present.
{
  const m = buildContextMenu({ hasSelection: false, node: 'image' })
  const set = ids(m)
  assert.ok(
    ['image-copy', 'image-open', 'image-remove'].every((id) => set.has(id)),
    'all image actions present'
  )
}

// Table body cell: row submenu offers above + below + delete.
{
  const m = buildContextMenu({ hasSelection: false, node: 'table' })
  const set = ids(m)
  assert.ok(set.has('table-row-above') && set.has('table-row-below'), 'row insert above + below')
  assert.ok(set.has('table-col-left') && set.has('table-col-right'), 'col insert left + right')
  assert.ok(set.has('table-align-center'), 'column alignment options')
  assert.equal(find(m, 'table-row-del')?.disabled, undefined, 'body row delete enabled')
}

// Table header cell: no "insert above", and "delete row" is disabled.
{
  const m = buildContextMenu({ hasSelection: false, node: 'table', tableHeader: true })
  const set = ids(m)
  assert.ok(!set.has('table-row-above'), 'no insert-above on the header row')
  assert.ok(set.has('table-row-below'), 'still offers insert-below')
  assert.equal(find(m, 'table-row-del')?.disabled, true, 'header row delete disabled')
}

console.log('markdown-editor contextMenu unit tests passed')
