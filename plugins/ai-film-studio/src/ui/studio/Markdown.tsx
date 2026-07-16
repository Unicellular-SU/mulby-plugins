/**
 * 轻量自包含 Markdown 渲染器（无第三方依赖，Vite 构建零风险）。
 * 覆盖 AI 对话常见语法：标题 / 粗斜体 / 行内代码 / 代码块 / 有序无序列表（含嵌套）/
 * 引用 / 分割线 / 链接 / 删除线 / GFM 表格 / 段落（软换行→<br>）。
 * 面向「渲染得好看」而非 100% CommonMark 合规——够用、稳定、可控样式。
 */
import React from 'react'

// ---------------- 行内解析：粗体/斜体/行内代码/删除线/链接 ----------------

/** URL 协议白名单：拦截 javascript:/data:/file: 等伪协议（内容来自不可信的 AI/工具输出）。 */
function sanitizeUrl(raw: string): string {
  const u = raw.trim().replace(/[\u0000-\u001f]/g, '')
  return /^(https?:|mailto:|#|\/)/i.test(u) ? u : ''
}

const boldItalic = (m: RegExpExecArray, key: string): React.ReactNode => (
  <strong key={key}>
    <em>{parseInline(m[1])}</em>
  </strong>
)

// 顺序即优先级的一部分：三连标记（粗斜体）在双/单标记之前，避免 ***x*** 残留字面星号
const INLINE_PATTERNS: { re: RegExp; render: (m: RegExpExecArray, key: string) => React.ReactNode }[] = [
  { re: /`([^`]+)`/, render: (m, key) => <code key={key} className="afs-md__code">{m[1]}</code> },
  { re: /\*\*\*([^*]+?)\*\*\*/, render: boldItalic },
  { re: /(?<![A-Za-z0-9_])___([^_]+?)___(?![A-Za-z0-9_])/, render: boldItalic },
  { re: /\*\*([^*]+?)\*\*/, render: (m, key) => <strong key={key}>{parseInline(m[1])}</strong> },
  { re: /(?<![A-Za-z0-9_])__([^_]+?)__(?![A-Za-z0-9_])/, render: (m, key) => <strong key={key}>{parseInline(m[1])}</strong> },
  { re: /~~([^~]+?)~~/, render: (m, key) => <del key={key}>{parseInline(m[1])}</del> },
  { re: /\*([^*\n]+?)\*/, render: (m, key) => <em key={key}>{parseInline(m[1])}</em> },
  { re: /(?<![A-Za-z0-9_])_([^_\n]+?)_(?![A-Za-z0-9_])/, render: (m, key) => <em key={key}>{parseInline(m[1])}</em> },
  {
    re: /\[([^\]]+)\]\(([^)\s]+)\)/,
    render: (m, key) => {
      const href = sanitizeUrl(m[2])
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer" className="afs-md__a">
          {parseInline(m[1])}
        </a>
      ) : (
        <span key={key}>{parseInline(m[1])}</span>
      )
    },
  },
]

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let rest = text
  let k = 0
  while (rest) {
    let best: { idx: number; len: number; node: React.ReactNode } | null = null
    for (const p of INLINE_PATTERNS) {
      const m = p.re.exec(rest)
      if (m && (best === null || m.index < best.idx)) best = { idx: m.index, len: m[0].length, node: p.render(m, `i${k}`) }
    }
    if (!best) {
      nodes.push(rest)
      break
    }
    if (best.idx > 0) nodes.push(rest.slice(0, best.idx))
    nodes.push(best.node)
    rest = rest.slice(best.idx + best.len)
    k++
  }
  return nodes
}

// ---------------- 块级解析 ----------------

// GFM 分隔行必须含竖线：避免把普通 '---'（分割线）误判成表格分隔行
const isTableSep = (line: string): boolean =>
  line.includes('|') && line.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line)
const isHr = (line: string): boolean => /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)
const isListLine = (line: string): boolean => /^\s*([-*+]|\d+[.)])\s+/.test(line)

function isBlockStart(line: string): boolean {
  return (
    /^\s*(#{1,6}\s|>|```|~~~)/.test(line) ||
    isListLine(line) ||
    isHr(line)
  )
}

function splitRow(line: string): string[] {
  let s = line.trim()
  s = s.replace(/^\|/, '').replace(/\|$/, '')
  return s.split('|').map((c) => c.trim())
}

/** 列表：按缩进构树（支持任意层嵌套 + 换行续行）。 */
function renderList(block: string[]): React.ReactNode {
  interface Item {
    indent: number
    ordered: boolean
    content: string
    children: Item[]
  }
  const roots: Item[] = []
  const stack: Item[] = []
  for (const raw of block) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(raw)
    if (!m) {
      if (stack.length) stack[stack.length - 1].content += ' ' + raw.trim()
      continue
    }
    const indent = m[1].length
    const item: Item = { indent, ordered: /\d/.test(m[2]), content: m[3], children: [] }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(item)
    else roots.push(item)
    stack.push(item)
  }
  const renderItems = (items: Item[]): React.ReactNode => {
    // 同层可能混排有序/无序：按连续同类型分组，各自成 ol/ul，保真序号/项目符号
    const groups: Item[][] = []
    for (const it of items) {
      const last = groups[groups.length - 1]
      if (last && last[0].ordered === it.ordered) last.push(it)
      else groups.push([it])
    }
    return groups.map((g, gi) => {
      const Tag = (g[0].ordered ? 'ol' : 'ul') as 'ol' | 'ul'
      return (
        <Tag key={gi} className={g[0].ordered ? 'afs-md__ol' : 'afs-md__ul'}>
          {g.map((it, idx) => (
            <li key={idx}>
              {parseInline(it.content)}
              {it.children.length ? renderItems(it.children) : null}
            </li>
          ))}
        </Tag>
      )
    })
  }
  return roots.length ? renderItems(roots) : null
}

function renderBlocks(md: string): React.ReactNode[] {
  const lines = (md ?? '').replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  let k = 0
  const push = (n: React.ReactNode) => out.push(<React.Fragment key={k++}>{n}</React.Fragment>)

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }

    // 代码块 ``` / ~~~
    const fence = /^(\s*)(```+|~~~+)\s*([\w+-]*)\s*$/.exec(line)
    if (fence) {
      const closeChar = fence[2][0]
      const lang = fence[3]
      const buf: string[] = []
      i++
      while (i < lines.length && !new RegExp('^\\s*\\' + closeChar + '{3,}\\s*$').test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过收尾围栏
      push(
        <pre className="afs-md__pre">
          {lang ? <span className="afs-md__lang">{lang}</span> : null}
          <code>{buf.join('\n')}</code>
        </pre>,
      )
      continue
    }

    // 标题
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const level = Math.min(h[1].length, 6)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      push(<Tag className={`afs-md__h afs-md__h${level}`}>{parseInline(h[2].trim())}</Tag>)
      i++
      continue
    }

    // 分割线
    if (isHr(line)) {
      push(<hr className="afs-md__hr" />)
      i++
      continue
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      push(<blockquote className="afs-md__quote">{renderBlocks(buf.join('\n'))}</blockquote>)
      continue
    }

    // GFM 表格：当前行含 |，下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() && !isBlockStart(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      push(
        <div className="afs-md__tablewrap">
          <table className="afs-md__table">
            <thead>
              <tr>{header.map((c, ci) => <th key={ci}>{parseInline(c)}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {header.map((_, ci) => (
                    <td key={ci}>{parseInline(r[ci] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    // 列表（含续行与嵌套）
    if (isListLine(line)) {
      const buf: string[] = []
      while (i < lines.length && (isListLine(lines[i]) || (lines[i].trim() !== '' && /^\s{2,}\S/.test(lines[i])))) {
        buf.push(lines[i])
        i++
      }
      push(renderList(buf))
      continue
    }

    // 段落（软换行 → <br>）
    const buf: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isBlockStart(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      buf.push(lines[i])
      i++
    }
    push(
      <p className="afs-md__p">
        {buf.map((ln, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 ? <br /> : null}
            {parseInline(ln)}
          </React.Fragment>
        ))}
      </p>,
    )
  }
  return out
}

/** 渲染一段 markdown 文本。inline=true 时用于单行/紧凑场景（去外边距）。 */
export default function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={`afs-md${className ? ' ' + className : ''}`}>{renderBlocks(text ?? '')}</div>
}
