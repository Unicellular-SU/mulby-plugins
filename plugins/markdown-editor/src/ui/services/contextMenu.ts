// Pure builder for the editor's right-click context menu. Given a description of
// what's under the click (a selection? a link / image / table cell?), it returns
// a menu-item tree. Keeping it DOM-free makes the (otherwise fiddly) "which items
// show in which context" logic unit-testable; the React component in
// `components/ContextMenu.tsx` only renders the tree and the App maps item ids to
// actions.

export interface MenuItem {
  /** Stable id dispatched on select (ignored for separators / parents). */
  id: string
  label?: string
  /** Right-aligned shortcut hint (display only). */
  shortcut?: string
  /** Renders a divider instead of a clickable row. */
  separator?: boolean
  /** Destructive action — styled in a warning color. */
  danger?: boolean
  disabled?: boolean
  /** Nested fly-out menu. */
  submenu?: MenuItem[]
}

/** What the right-click landed on, used to tailor the menu. */
export interface MenuContext {
  /** True when a non-empty selection exists. */
  hasSelection: boolean
  /** The construct under the click, or null for plain text. */
  node: 'link' | 'image' | 'table' | null
  /** For a table cell: true when the click is on the header row. */
  tableHeader?: boolean
}

const sep = (id: string): MenuItem => ({ id, separator: true })

/** Builds the context-aware menu tree for the given click context. */
export function buildContextMenu(ctx: MenuContext): MenuItem[] {
  const items: MenuItem[] = []

  // --- node-specific actions (shown first, then a divider) ---
  if (ctx.node === 'link') {
    items.push(
      { id: 'link-open', label: '打开链接' },
      { id: 'link-copy', label: '复制链接地址' },
      { id: 'link-edit', label: '编辑链接' },
      { id: 'link-unlink', label: '取消链接（保留文字）' },
      sep('sep-node')
    )
  } else if (ctx.node === 'image') {
    items.push(
      { id: 'image-copy', label: '复制图片地址' },
      { id: 'image-open', label: '打开预览' },
      { id: 'image-remove', label: '删除图片', danger: true },
      sep('sep-node')
    )
  } else if (ctx.node === 'table') {
    items.push(
      {
        id: 'table-row',
        label: '行',
        submenu: [
          ...(ctx.tableHeader ? [] : [{ id: 'table-row-above', label: '在上方插入行' }]),
          { id: 'table-row-below', label: '在下方插入行' },
          sep('sep-trow'),
          { id: 'table-row-del', label: '删除本行', danger: true, disabled: ctx.tableHeader }
        ]
      },
      {
        id: 'table-col',
        label: '列',
        submenu: [
          { id: 'table-col-left', label: '在左侧插入列' },
          { id: 'table-col-right', label: '在右侧插入列' },
          sep('sep-tcol'),
          { id: 'table-col-del', label: '删除本列', danger: true }
        ]
      },
      {
        id: 'table-align',
        label: '本列对齐',
        submenu: [
          { id: 'table-align-none', label: '默认' },
          { id: 'table-align-left', label: '左对齐' },
          { id: 'table-align-center', label: '居中' },
          { id: 'table-align-right', label: '右对齐' }
        ]
      },
      sep('sep-node')
    )
  }

  // --- clipboard ---
  if (ctx.hasSelection) {
    items.push({ id: 'cut', label: '剪切' }, { id: 'copy', label: '复制' })
  }
  items.push({ id: 'paste', label: '粘贴' }, sep('sep-clip'))

  // --- editing: format/convert on a selection, insert/AI otherwise ---
  if (ctx.hasSelection) {
    items.push(
      {
        id: 'format',
        label: '格式',
        submenu: [
          { id: 'fmt-bold', label: '加粗', shortcut: '⌘B' },
          { id: 'fmt-italic', label: '斜体', shortcut: '⌘I' },
          { id: 'fmt-strike', label: '删除线' },
          { id: 'fmt-code', label: '行内代码' },
          { id: 'fmt-highlight', label: '高亮' }
        ]
      },
      {
        id: 'convert',
        label: '转换为',
        submenu: [
          { id: 'cv-h1', label: '标题 1' },
          { id: 'cv-h2', label: '标题 2' },
          { id: 'cv-h3', label: '标题 3' },
          sep('sep-cv'),
          { id: 'cv-quote', label: '引用' },
          { id: 'cv-ul', label: '无序列表' },
          { id: 'cv-ol', label: '有序列表' },
          { id: 'cv-task', label: '任务列表' },
          { id: 'cv-codeblock', label: '代码块' }
        ]
      },
      { id: 'make-link', label: '转为链接' }
    )
  } else {
    items.push(
      {
        id: 'insert',
        label: '插入',
        submenu: [
          { id: 'ins-h2', label: '标题' },
          { id: 'ins-ul', label: '无序列表' },
          { id: 'ins-ol', label: '有序列表' },
          { id: 'ins-task', label: '任务列表' },
          { id: 'ins-quote', label: '引用' },
          { id: 'ins-codeblock', label: '代码块' },
          { id: 'ins-table', label: '表格' },
          { id: 'ins-hr', label: '分隔线' },
          sep('sep-ins'),
          { id: 'ins-link', label: '链接' },
          { id: 'ins-image', label: '图片' },
          { id: 'ins-math', label: '公式块' }
        ]
      },
      { id: 'ai', label: 'AI 工具条', shortcut: '⌘J' }
    )
  }
  items.push(sep('sep-edit'))

  // --- find / select-all (always available) ---
  items.push(
    { id: 'find', label: '查找', shortcut: '⌘F' },
    { id: 'replace', label: '替换', shortcut: '⌘H' },
    sep('sep-find'),
    { id: 'select-all', label: '全选', shortcut: '⌘A' }
  )

  return items
}
