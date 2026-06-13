import React, { useMemo, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { FileItem } from '../../utils'
import { useMulby } from '../../hooks/useMulby'
import { PreviewMeta, FileInfo } from './PreviewChrome'
import { HighlightBlock } from './CodePreview'
import TextPreview from './TextPreview'

interface Props {
  file: FileItem
  text: string
  fileInfo: FileInfo | null
}

// 单个节点最多渲染多少子项，避免超大数组/对象一次性铺出上万行 DOM 导致卡死
const MAX_CHILDREN = 200
// pretty 文本超过该体积时，「原始」视图改用纯文本而非语法高亮（Prism 对超大文本会卡）
const RAW_HIGHLIGHT_LIMIT = 150 * 1024

function formatLeaf(v: unknown): { text: string; cls: string } {
  if (v === null) return { text: 'null', cls: 'json-null' }
  if (typeof v === 'string') return { text: `"${v}"`, cls: 'json-string' }
  if (typeof v === 'number') return { text: String(v), cls: 'json-number' }
  if (typeof v === 'boolean') return { text: String(v), cls: 'json-boolean' }
  return { text: String(v), cls: 'json-val' }
}

function JsonNode({
  name,
  value,
  depth,
  autoOpenDepth,
}: {
  name: string | null
  value: unknown
  depth: number
  autoOpenDepth: number
}) {
  const [open, setOpen] = useState(depth < autoOpenDepth)
  const isObject = value !== null && typeof value === 'object'
  const keyLabel = name !== null ? <span className="json-key">"{name}"</span> : null

  if (!isObject) {
    const leaf = formatLeaf(value)
    return (
      <div className="json-row" style={{ paddingLeft: depth * 14 + 6 }}>
        {keyLabel}
        {name !== null && <span className="json-colon">:&nbsp;</span>}
        <span className={leaf.cls}>{leaf.text}</span>
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries: Array<[string, unknown]> = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>)
  const openB = isArray ? '[' : '{'
  const closeB = isArray ? ']' : '}'
  const shown = entries.length > MAX_CHILDREN ? entries.slice(0, MAX_CHILDREN) : entries
  const hidden = entries.length - shown.length

  return (
    <div>
      <div
        className="json-row json-branch"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {keyLabel}
        {name !== null && <span className="json-colon">:&nbsp;</span>}
        <span className="json-bracket">
          {openB}
          {!open && <span className="json-collapsed"> … {entries.length} {closeB}</span>}
        </span>
      </div>
      {open && (
        <>
          {shown.map(([k, v]) => (
            <JsonNode key={k} name={isArray ? null : k} value={v} depth={depth + 1} autoOpenDepth={autoOpenDepth} />
          ))}
          {hidden > 0 && (
            <div className="json-row json-collapsed" style={{ paddingLeft: (depth + 1) * 14 + 6 }}>
              … 还有 {hidden} 项未显示
            </div>
          )}
          <div className="json-row" style={{ paddingLeft: depth * 14 + 6 }}>
            <span className="json-bracket">{closeB}</span>
          </div>
        </>
      )}
    </div>
  )
}

export default function JsonPreview({ file, text, fileInfo }: Props) {
  const { theme } = useMulby()
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [text])
  const pretty = useMemo(() => (parsed.ok ? JSON.stringify(parsed.value, null, 2) : ''), [parsed])
  const [view, setView] = useState<'tree' | 'raw'>('tree')

  // 非法 JSON：退化为纯文本预览
  if (!parsed.ok) {
    return <TextPreview file={file} text={text} fileInfo={fileInfo} />
  }

  // 大文件：树默认只展开根，避免初次渲染铺开过多节点
  const autoOpenDepth = text.length > 50 * 1024 ? 1 : 4
  const rawTooBig = pretty.length > RAW_HIGHLIGHT_LIMIT

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="preview-toolbar">
        <button className={`preview-toggle${view === 'tree' ? ' active' : ''}`} onClick={() => setView('tree')}>
          树
        </button>
        <button className={`preview-toggle${view === 'raw' ? ' active' : ''}`} onClick={() => setView('raw')}>
          原始
        </button>
      </div>
      {view === 'tree' ? (
        <div className="code-scroll json-tree">
          <JsonNode name={null} value={parsed.value} depth={0} autoOpenDepth={autoOpenDepth} />
        </div>
      ) : rawTooBig ? (
        <div className="code-host">
          <pre className="text-preview" style={{ whiteSpace: 'pre' }}>{pretty}</pre>
        </div>
      ) : (
        <div className="code-host">
          <HighlightBlock text={pretty} language="json" wrap={false} dark={theme === 'dark'} />
        </div>
      )}
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
