import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { getNodeDef, CATEGORY_META, PORT_COLORS } from '../../nodes/nodeDefs'
import type { FilmNode as FilmNodeType, FilmNodeData, PortValue } from '../../store/graphStore'

const ROW_H = 24
const TOP_PAD = 8

function truncate(s: string, n: number): string {
  const t = s.trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

function paramSummary(data: FilmNodeData): string {
  const p = data.params || {}
  if (typeof p.text === 'string' && p.text.trim()) return truncate(p.text, 64)
  if (typeof p.style === 'string' && p.style.trim()) return `画风：${truncate(p.style, 40)}`
  return ''
}

function outputSummary(data: FilmNodeData): string {
  const outs = data.outputs
  if (!outs) return ''
  const v = Object.values(outs)[0] as PortValue | undefined
  if (!v) return ''
  if (v.type === 'json' && v.json && typeof v.json === 'object') {
    const j = v.json as Record<string, unknown>
    if (Array.isArray(j.scenes)) return `剧本 · ${j.scenes.length} 场`
    if (Array.isArray(j.shots)) return `分镜 · ${j.shots.length} 镜`
    if (Array.isArray(j.characters)) return `角色 · ${j.characters.length} 个`
    return 'JSON 已生成'
  }
  if (v.type === 'image') return '图像已生成'
  if (v.text) return truncate(v.text, 64)
  return ''
}

function firstMedia(data: FilmNodeData): { type: 'image' | 'video'; url: string } | null {
  const outs = data.outputs
  if (!outs) return null
  for (const v of Object.values(outs)) {
    if (v && (v.type === 'image' || v.type === 'video') && v.url) return { type: v.type, url: v.url }
  }
  return null
}

function FilmNodeComp({ data, selected }: NodeProps<FilmNodeType>) {
  const def = getNodeDef(data.kind)
  if (!def) {
    return <div className="afs-node afs-node--error">未知节点：{data.kind}</div>
  }
  const cat = CATEGORY_META[def.category]
  const Icon = def.icon
  const rows = Math.max(def.inputs.length, def.outputs.length, 1)
  const bodyH = rows * ROW_H + TOP_PAD

  const media = firstMedia(data)
  const previewImg = data.status === 'running' ? data.previewUrl : ''

  let footer: { cls: string; text: string } | null = null
  if (data.status === 'error') {
    footer = { cls: 'afs-node__footer--error', text: data.error || '运行出错' }
  } else if (data.status === 'running') {
    const tail = data.stream ? truncate(data.stream.slice(-80), 80) : ''
    footer = { cls: 'afs-node__footer--running', text: tail ? `生成中… ${tail}` : '生成中…' }
  } else if (data.status === 'done') {
    const s = outputSummary(data)
    if (s) footer = { cls: 'afs-node__footer--done', text: s }
  }
  if (!footer) {
    const ps = paramSummary(data)
    if (ps) footer = { cls: '', text: ps }
  }

  return (
    <div
      className={`afs-node${selected ? ' afs-node--selected' : ''}`}
      style={selected ? { boxShadow: `0 0 0 2px ${cat.color}` } : undefined}
    >
      <div className="afs-node__header" style={{ background: cat.color }}>
        <Icon size={13} strokeWidth={2.2} />
        <span className="afs-node__title">{data.title || def.label}</span>
        <span className={`afs-node__status afs-node__status--${data.status}`} title={data.status} />
      </div>

      <div className="afs-node__body" style={{ height: bodyH }}>
        {def.inputs.map((p, i) => {
          const top = TOP_PAD + i * ROW_H + ROW_H / 2
          return (
            <div key={`in-${p.id}`}>
              <Handle
                id={p.id}
                type="target"
                position={Position.Left}
                style={{ top, background: PORT_COLORS[p.type] }}
              />
              <span className="afs-port afs-port--in" style={{ top }}>
                {p.label}
              </span>
            </div>
          )
        })}
        {def.outputs.map((p, i) => {
          const top = TOP_PAD + i * ROW_H + ROW_H / 2
          return (
            <div key={`out-${p.id}`}>
              <Handle
                id={p.id}
                type="source"
                position={Position.Right}
                style={{ top, background: PORT_COLORS[p.type] }}
              />
              <span className="afs-port afs-port--out" style={{ top }}>
                {p.label}
              </span>
            </div>
          )
        })}
      </div>

      {previewImg ? (
        <div className="afs-node__thumb">
          <img src={previewImg} alt="" draggable={false} />
          <span className="afs-node__thumb-badge">生成中…</span>
        </div>
      ) : (
        media && (
          <div className="afs-node__thumb">
            {media.type === 'video' ? (
              <video src={media.url} muted loop playsInline preload="metadata" />
            ) : (
              <img src={media.url} alt="" draggable={false} />
            )}
          </div>
        )
      )}

      {footer && !media && !previewImg && <div className={`afs-node__summary ${footer.cls}`}>{footer.text}</div>}
    </div>
  )
}

export default memo(FilmNodeComp)
