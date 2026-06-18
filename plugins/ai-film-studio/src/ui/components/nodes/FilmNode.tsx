import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Lock, LockOpen, Loader2 } from 'lucide-react'
import { getNodeDef, CATEGORY_META, PORT_COLORS } from '../../nodes/nodeDefs'
import { useGraphStore, type FilmNode as FilmNodeType, type FilmNodeData, type PortValue } from '../../store/graphStore'

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
  if (v.items && v.items.length) {
    const t = v.items[0]?.type
    if (t === 'video') return `视频 · ${v.items.length} 段`
    if (t === 'audio') return `音频 · ${v.items.length}`
    return `图像 · ${v.items.length} 张`
  }
  if (v.type === 'json' && v.json && typeof v.json === 'object') {
    const j = v.json as Record<string, unknown>
    if (Array.isArray(j.scenes)) return `剧本 · ${j.scenes.length} 场`
    if (Array.isArray(j.shots)) return `分镜 · ${j.shots.length} 镜`
    if (Array.isArray(j.characters)) return `角色 · ${j.characters.length} 个`
    return 'JSON 已生成'
  }
  if (v.type === 'image') return '图像已生成'
  if (v.type === 'video') return '视频已生成'
  if (v.type === 'audio') return '音频已生成'
  if (v.text) return truncate(v.text, 64)
  return ''
}

function firstMedia(data: FilmNodeData): { type: 'image' | 'video'; url: string; count: number } | null {
  const outs = data.outputs
  if (!outs) return null
  for (const v of Object.values(outs)) {
    if (!v) continue
    const list = v.items && v.items.length ? v.items : [v]
    const head = list.find((x) => (x.type === 'image' || x.type === 'video') && x.url)
    if (head && head.url && (head.type === 'image' || head.type === 'video')) {
      return { type: head.type, url: head.url, count: list.filter((x) => x.url).length }
    }
  }
  return null
}

/** 全部图像/视频产物（用于在画布上铺成网格，生成一张展示一张） */
function mediaTiles(data: FilmNodeData): { type: 'image' | 'video'; url: string }[] {
  const outs = data.outputs
  if (!outs) return []
  for (const v of Object.values(outs)) {
    if (!v) continue
    const list = v.items && v.items.length ? v.items : [v]
    const got = list
      .filter((x) => (x.type === 'image' || x.type === 'video') && x.url)
      .map((x) => ({ type: x.type as 'image' | 'video', url: x.url as string }))
    if (got.length) return got
  }
  return []
}

type DataRow = { title: string; sub?: string; chips?: string[] }

/** 文本节点的 json 产物（剧本/分镜/角色/大纲） */
function jsonOutput(data: FilmNodeData): Record<string, unknown> | null {
  const outs = data.outputs
  if (!outs) return null
  for (const v of Object.values(outs)) {
    if (v && v.type === 'json' && v.json && typeof v.json === 'object') return v.json as Record<string, unknown>
  }
  return null
}

/** 把剧本/分镜/角色/大纲格式化为画布上可展开的卡片行 */
function dataCard(kind: string, json: Record<string, unknown> | null): { label: string; rows: DataRow[] } | null {
  if (!json) return null
  const s = (x: unknown) => (x == null ? '' : String(x))
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : [])
  if (kind === 'script-gen' && Array.isArray(json.scenes)) {
    const rows = arr(json.scenes).map((sc, i) => ({
      title: s(sc.slug) || `场 ${i + 1}`,
      sub: s(sc.summary),
      chips: [
        s(sc.location),
        s(sc.time),
        Array.isArray(sc.dialogues) && sc.dialogues.length ? `${sc.dialogues.length} 句对白` : '',
      ].filter(Boolean),
    }))
    return { label: `剧本 · ${rows.length} 场`, rows }
  }
  if (kind === 'storyboard' && Array.isArray(json.shots)) {
    const rows = arr(json.shots).map((sh, i) => ({
      title: s(sh.id) || `镜 ${i + 1}`,
      sub: s(sh.description) || s(sh.prompt),
      chips: [s(sh.shotSize), s(sh.camera), sh.duration ? `${sh.duration}s` : ''].filter(Boolean),
    }))
    return { label: `分镜 · ${rows.length} 镜`, rows }
  }
  if (kind === 'char-sheet' && Array.isArray(json.characters)) {
    const rows = arr(json.characters).map((c, i) => ({
      title: s(c.name) || `角色 ${i + 1}`,
      sub: s(c.appearance) || s(c.description),
      chips: [c.voiceId ? `音色 ${s(c.voiceId)}` : '', Array.isArray(c.arc) && c.arc.length ? '有弧线' : ''].filter(Boolean),
    }))
    return { label: `角色 · ${rows.length} 个`, rows }
  }
  if (kind === 'outline' && Array.isArray(json.beats)) {
    const rows = arr(json.beats).map((b, i) => ({
      title: s(b.type) || `节拍 ${i + 1}`,
      sub: s(b.summary),
      chips: [s(b.emotion)].filter(Boolean),
    }))
    return { label: `大纲 · ${rows.length} 节拍`, rows }
  }
  return null
}

function FilmNodeComp({ id, data, selected }: NodeProps<FilmNodeType>) {
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
  // 实时铺开：扇出（多张）时在画布上铺成网格，已生成的填图、未生成的占位旋转
  const tiles = mediaTiles(data)
  const genTotal = data.status === 'running' ? Number(data.gen?.total ?? 0) : 0
  const gridCount = Math.max(genTotal, tiles.length)
  const showGrid = !previewImg && gridCount > 1
  const pending = Math.max(0, genTotal - tiles.length)
  const cols = Math.min(4, Math.max(1, gridCount))
  const TILE = 76
  const gridWidth = cols * (TILE + 4) + 12
  // 文本节点：把剧本/分镜/角色/大纲格式化成画布卡片（实时增长）
  const card = def.category === 'text' && !showGrid ? dataCard(data.kind, jsonOutput(data)) : null
  const showData = !!card && card.rows.length > 0

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
      className={`afs-node${selected ? ' afs-node--selected' : ''}${data.locked ? ' afs-node--locked' : ''}`}
      style={{
        ...(showGrid ? { width: Math.max(200, gridWidth) } : showData ? { width: 300 } : null),
        ...(selected
          ? { boxShadow: `0 0 0 2px ${cat.color}` }
          : data.locked
            ? { boxShadow: '0 0 0 1.5px #f59e0b' }
            : null),
      }}
    >
      <div className="afs-node__header" style={{ background: cat.color }}>
        <Icon size={13} strokeWidth={2.2} />
        <span className="afs-node__title">{data.title || def.label}</span>
        <button
          type="button"
          className="afs-node__lock nodrag"
          title={data.locked ? '已锁定：重跑时跳过、保留结果（点击解锁）' : '锁定此节点：重跑不覆盖其产物'}
          onClick={(e) => {
            e.stopPropagation()
            useGraphStore.getState().toggleNodeLock(id)
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            padding: 0,
            marginRight: 4,
            border: 'none',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            opacity: data.locked ? 1 : 0.55,
          }}
        >
          {data.locked ? <Lock size={11} strokeWidth={2.4} /> : <LockOpen size={11} strokeWidth={2.2} />}
        </button>
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
      ) : showGrid ? (
        <div
          className="afs-node__grid"
          style={{ gridTemplateColumns: `repeat(${cols}, ${TILE}px)` }}
        >
          {tiles.map((t, i) => (
            <div className="afs-node__tile" key={`t${i}`} style={{ width: TILE, height: TILE }}>
              {t.type === 'video' ? (
                <video src={t.url} muted loop playsInline preload="metadata" />
              ) : (
                <img src={t.url} alt="" draggable={false} />
              )}
            </div>
          ))}
          {Array.from({ length: pending }).map((_, i) => (
            <div className="afs-node__tile afs-node__tile--pending" key={`p${i}`} style={{ width: TILE, height: TILE }}>
              <Loader2 size={18} className="afs-spin" />
            </div>
          ))}
        </div>
      ) : showData && card ? (
        <div className="afs-node__data">
          <div className="afs-node__data-head">
            <span>{card.label}</span>
            {data.status === 'running' && <Loader2 size={11} className="afs-spin" />}
          </div>
          <div className="afs-node__data-list nowheel">
            {card.rows.map((r, i) => (
              <div className="afs-data-row" key={i}>
                <div className="afs-data-row__top">
                  <span className="afs-data-row__title">{r.title}</span>
                  {r.chips?.map((c, j) => (
                    <span className="afs-chip" key={j}>
                      {c}
                    </span>
                  ))}
                </div>
                {r.sub ? <div className="afs-data-row__sub">{truncate(r.sub, 96)}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        media && (
          <div className="afs-node__thumb">
            {media.type === 'video' ? (
              <video src={media.url} muted loop playsInline preload="metadata" />
            ) : (
              <img src={media.url} alt="" draggable={false} />
            )}
            {media.count > 1 ? <span className="afs-node__thumb-badge">×{media.count}</span> : null}
          </div>
        )
      )}

      {footer && !media && !previewImg && !showGrid && !showData && (
        <div className={`afs-node__summary ${footer.cls}`}>{footer.text}</div>
      )}
    </div>
  )
}

export default memo(FilmNodeComp)
