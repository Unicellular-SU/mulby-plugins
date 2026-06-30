import { memo, useEffect, useMemo, useState } from 'react'
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { Lock, LockOpen, Loader2, RotateCcw, Maximize2, X, Play, type LucideIcon } from 'lucide-react'
import { getNodeDef } from '../../nodes/nodeDefs'
import { useGraphStore, type FilmNode as FilmNodeType, type FilmNodeData, type PortValue, type GenItem } from '../../store/graphStore'
import { useMediaUrl, useInView, hasMedia, type MediaRef } from '../../services/mediaUrl'
import { useUiStore, type LightboxItem } from '../../store/uiStore'

const ROW_H = 24
const TOP_PAD = 8
const TILE = 76

const asStr = (x: unknown): string => (typeof x === 'string' ? x : '')

/** 单缩略图：经 useMediaUrl 解析 ref→URL（附件 blob:/本地 file:///远程透传） */
function MediaThumb({ refv, type }: { refv: MediaRef; type: 'image' | 'video' }) {
  const url = useMediaUrl(refv)
  if (!url) return null
  return type === 'video' ? (
    <video src={url} muted loop playsInline preload="metadata" />
  ) : (
    <img src={url} alt="" draggable={false} />
  )
}

/** M30 逐项瓦片：done→媒体缩略，failed→红框✗(hover 看错误)，pending/running→旋转；角标标镜头/变体 */
function GenItemTile({ item, onOpen }: { item: GenItem; onOpen?: () => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('300px')
  const isDone = item.status === 'done' && !!item.ref
  const url = useMediaUrl(isDone && inView ? (item.ref as MediaRef) : null)
  return (
    <div
      ref={ref}
      className={`afs-node__tile${item.status === 'failed' ? ' afs-node__tile--failed' : ''}${isDone && onOpen ? ' afs-node__tile--click nodrag' : ''}`}
      style={{ width: TILE, height: TILE }}
      title={item.status === 'failed' ? `${item.key || ''} 失败：${item.error || ''}` : isDone && onOpen ? `${item.key || ''}（点击看大图）` : item.key}
      onClick={isDone && onOpen ? (e) => { e.stopPropagation(); onOpen() } : undefined}
    >
      {isDone ? (
        url ? (
          item.mediaType === 'video' ? (
            <video src={url} muted loop playsInline preload="metadata" />
          ) : (
            <img src={url} alt="" draggable={false} />
          )
        ) : null
      ) : item.status === 'failed' ? (
        <X size={20} className="afs-node__tile-x" aria-label="生成失败" />
      ) : (
        <Loader2 size={18} className="afs-spin" />
      )}
      {item.key ? <span className="afs-node__tile-cap">{item.key}</span> : null}
    </div>
  )
}

/** 网格 tile：useInView 惰性挂载（离屏不解析 blob、不挂 <img>/<video>） */
function NodeTile({ refv, type, onOpen }: { refv: MediaRef; type: 'image' | 'video'; onOpen?: () => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('300px')
  const url = useMediaUrl(inView ? refv : null)
  return (
    <div
      className={`afs-node__tile${onOpen ? ' afs-node__tile--click nodrag' : ''}`}
      ref={ref}
      style={{ width: TILE, height: TILE }}
      title={onOpen ? '点击看大图' : undefined}
      onClick={onOpen ? (e) => { e.stopPropagation(); onOpen() } : undefined}
    >
      {url ? (
        type === 'video' ? (
          <video src={url} muted loop playsInline preload="metadata" />
        ) : (
          <img src={url} alt="" draggable={false} />
        )
      ) : null}
    </div>
  )
}

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

function firstMedia(data: FilmNodeData): { type: 'image' | 'video'; ref: PortValue; count: number } | null {
  const outs = data.outputs
  if (!outs) return null
  for (const v of Object.values(outs)) {
    if (!v) continue
    const list = v.items && v.items.length ? v.items : [v]
    const head = list.find((x) => (x.type === 'image' || x.type === 'video') && hasMedia(x))
    if (head && (head.type === 'image' || head.type === 'video')) {
      return { type: head.type, ref: head, count: list.filter((x) => hasMedia(x)).length }
    }
  }
  return null
}

/** 全部图像/视频产物（用于在画布上铺成网格，生成一张展示一张） */
function mediaTiles(data: FilmNodeData): { type: 'image' | 'video'; ref: PortValue }[] {
  const outs = data.outputs
  if (!outs) return []
  for (const v of Object.values(outs)) {
    if (!v) continue
    const list = v.items && v.items.length ? v.items : [v]
    const got = list
      .filter((x) => (x.type === 'image' || x.type === 'video') && hasMedia(x))
      .map((x) => ({ type: x.type as 'image' | 'video', ref: x }))
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

// 单图/单视频「媒体即节点」：长边钳到 [FRAME_SHORT_MIN, FRAME_LONG]，按真实比例出框
const FRAME_LONG = 280
const FRAME_SHORT_MIN = 120
function frameSize(ar: number | null): { w: number; h: number } {
  if (!ar || !Number.isFinite(ar) || ar <= 0) return { w: 220, h: 168 } // 测量前的中性默认(≈4:3)
  if (ar >= 1) {
    const w = FRAME_LONG
    return { w, h: Math.max(FRAME_SHORT_MIN, Math.round(w / ar)) } // 横图：宽=长边
  }
  const h = FRAME_LONG
  return { w: Math.max(FRAME_SHORT_MIN, Math.round(h * ar)), h } // 竖图：高=长边
}

/**
 * 媒体框节点：单张图/单个视频时，媒体本身即节点（按比例铺满），连接点直接从媒体左右边引出。
 * 比例在 onLoad/onLoadedMetadata 实测后定，再调 useUpdateNodeInternals 让连线锚点跟随重算。
 */
function MediaFrameNode({
  id,
  data,
  def,
  catColor,
  Icon,
  selected,
  refv,
  type,
  onOpen,
}: {
  id: string
  data: FilmNodeData
  def: NonNullable<ReturnType<typeof getNodeDef>>
  catColor: string
  Icon: LucideIcon
  selected: boolean
  refv: MediaRef
  type: 'image' | 'video'
  onOpen: () => void
}) {
  const updateNodeInternals = useUpdateNodeInternals()
  const url = useMediaUrl(refv)
  const [ar, setAr] = useState<number | null>(null)
  const { w, h } = frameSize(ar)
  // 尺寸定下/变化后通知 React Flow 重算句柄位置，否则连线指向旧锚点
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, w, h, updateNodeInternals])
  const ins = def.inputs
  const outs = def.outputs
  return (
    <div
      className={`afs-node afs-node--media${selected ? ' afs-node--selected' : ''}${data.locked ? ' afs-node--locked' : ''}`}
      style={{
        width: w,
        ...(selected ? { boxShadow: `0 0 0 2px ${catColor}` } : data.locked ? { boxShadow: '0 0 0 1.5px var(--afs-warning)' } : null),
      }}
    >
      {/* 媒体区可拖动节点（无 nodrag）；看大图改用「右上展开按钮」或「双击」，避免与拖拽/选中冲突 */}
      <div
        className="afs-node__frame"
        style={{ height: h }}
        title="拖动移动 · 双击看大图"
        onDoubleClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
      >
        {url ? (
          type === 'video' ? (
            <video
              src={url}
              muted
              playsInline
              preload="metadata"
              onClick={(e) => e.stopPropagation()}
              onLoadedMetadata={(e) => {
                const t = e.currentTarget
                if (t.videoWidth && t.videoHeight) setAr(t.videoWidth / t.videoHeight)
              }}
            />
          ) : (
            <img
              src={url}
              alt=""
              draggable={false}
              // 单击媒体不冒泡到 React Flow 的 onNodeClick → 双击预览时不会顺带选中节点弹出右侧抽屉
              onClick={(e) => e.stopPropagation()}
              onLoad={(e) => {
                const t = e.currentTarget
                if (t.naturalWidth && t.naturalHeight) setAr(t.naturalWidth / t.naturalHeight)
              }}
            />
          )
        ) : (
          <div className="afs-node__frame-ph">
            <Loader2 size={20} className="afs-spin" />
          </div>
        )}
        {type === 'video' && (
          <button
            type="button"
            className="afs-node__frame-play nodrag"
            title="播放（全屏 Lightbox）"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            <Play size={16} fill="currentColor" />
          </button>
        )}
        <div className="afs-node__frame-head">
          <Icon size={12} strokeWidth={2.2} style={{ color: catColor }} />
          <span className="afs-node__frame-title">{data.title || def.label}</span>
          <button
            type="button"
            className="afs-node__lock nodrag"
            title="看大图（也可双击媒体）"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              padding: 0,
              border: 'none',
              background: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              opacity: 0.8,
            }}
          >
            <Maximize2 size={10} strokeWidth={2.2} />
          </button>
          <button
            type="button"
            className="afs-node__lock nodrag"
            title={data.locked ? '已锁定：重跑跳过、保留结果（点击解锁）' : '锁定此节点：重跑不覆盖产物'}
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
              border: 'none',
              background: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              opacity: data.locked ? 1 : 0.75,
            }}
          >
            {data.locked ? <Lock size={10} strokeWidth={2.4} /> : <LockOpen size={10} strokeWidth={2.2} />}
          </button>
          <span className={`afs-node__status afs-node__status--${data.status}`} title={data.status} />
        </div>
      </div>
      {ins.map((p, i) => {
        const top = (h * (i + 1)) / (ins.length + 1)
        return (
          <div key={`in-${p.id}`}>
            <Handle id={p.id} type="target" position={Position.Left} style={{ top, background: `var(--afs-type-${p.type})` }} />
            <span className="afs-port afs-port--in afs-port--onmedia" style={{ top }}>
              {p.label}
            </span>
          </div>
        )
      })}
      {outs.map((p, i) => {
        const top = (h * (i + 1)) / (outs.length + 1)
        return (
          <div key={`out-${p.id}`}>
            <Handle id={p.id} type="source" position={Position.Right} style={{ top, background: `var(--afs-type-${p.type})` }} />
            <span className="afs-port afs-port--out afs-port--onmedia" style={{ top }}>
              {p.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function FilmNodeComp({ id, data, selected }: NodeProps<FilmNodeType>) {
  const def = getNodeDef(data.kind)
  if (!def) {
    return <div className="afs-node afs-node--error">未知节点：{data.kind}</div>
  }
  const catVar = `var(--afs-cat-${def.category})`
  const Icon = def.icon
  const rows = Math.max(def.inputs.length, def.outputs.length, 1)
  const bodyH = rows * ROW_H + TOP_PAD

  // 派生值 memo 化（次要收益）：当本节点 data 引用未变时不重算 O(n) 扫描
  const media = useMemo(() => firstMedia(data), [data])
  const previewImg = data.status === 'running' ? data.previewUrl : ''
  // 实时铺开：扇出（多张）时在画布上铺成网格，已生成的填图、未生成的占位旋转
  const tiles = useMemo(() => mediaTiles(data), [data])
  // M30：有逐项状态(运行中 或 收尾保留的失败)时按 items 渲染（含失败红框）；否则回退到产物瓦片+占位
  const genItems = data.gen?.items
  const hasItems = !!genItems && genItems.length > 0
  const runningTotal = data.status === 'running' ? Number(data.gen?.total ?? 0) : 0
  const gridCount = Math.max(hasItems ? genItems!.length : runningTotal, tiles.length)
  const showGrid = !previewImg && gridCount > 1
  const pending = Math.max(0, runningTotal - tiles.length)
  const cols = Math.min(4, Math.max(1, gridCount))
  const failedCount = hasItems ? genItems!.filter((it) => it.status === 'failed').length : 0
  // M32：点瓦片→应用级 Lightbox 看大图/播视频。灯箱项 = 已成功项(有 items 时) 或 全部产物瓦片
  const openLightbox = useUiStore((s) => s.openLightbox)
  const openResultViewer = useUiStore((s) => s.openResultViewer)
  const doneItems = hasItems ? genItems!.filter((it) => it.status === 'done' && it.ref) : []
  // 统一灯箱：每张图带节点上下文(nodeId/port/index)+元信息，支持灯箱内对话改图/重生成 + 展示标题/提示词
  const outKey =
    (data.outputs &&
      Object.keys(data.outputs).find((k) => {
        const o = data.outputs![k]
        return !!o && (!!o.items?.length || !!o.assetId || !!o.url)
      })) ||
    def.outputs[0]?.id
  const nodeTitle = data.title || def.label
  const nodePrompt = asStr(data.params?.prompt)
  const toLb = (refv: PortValue, idx: number, type: 'image' | 'video'): LightboxItem => ({
    ref: refv as MediaRef,
    type,
    nodeId: id,
    port: outKey,
    index: idx, // lbItems 顺序 = 该输出 items 的密集下标，正是 edit/regen 所需 index
    title: nodeTitle,
    meta: refv.meta,
    prompt: asStr(refv.meta?.prompt) || asStr(refv.meta?.description) || nodePrompt,
  })
  const lbItems: LightboxItem[] = hasItems
    ? doneItems.map((it, k) => toLb(it.ref as PortValue, k, (it.mediaType || 'image') as 'image' | 'video'))
    : tiles.map((t, k) => toLb(t.ref, k, t.type))
  const lbIndexByIdx = useMemo(() => {
    const m = new Map<number, number>()
    doneItems.forEach((it, k) => m.set(it.idx, k))
    return m
  }, [doneItems])
  // M32：运行时进度条 N/总 · X失败
  const progTotal = hasItems ? genItems!.length : runningTotal
  const doneCount = hasItems ? genItems!.filter((it) => it.status === 'done').length : tiles.length
  const showProgress = data.status === 'running' && progTotal > 1
  const gridWidth = cols * (TILE + 4) + 12
  // 文本节点：把剧本/分镜/角色/大纲格式化成画布卡片（实时增长）
  const card = useMemo(
    () => (def.category === 'text' && !showGrid ? dataCard(data.kind, jsonOutput(data)) : null),
    [def.category, showGrid, data]
  )
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

  // 单张图/单个视频：媒体即节点，按真实比例展示、连线从媒体边引出（所有展示单媒体的节点都适用）
  const singleMedia = !!media && media.count === 1 && !showGrid && !showData && !previewImg && data.status !== 'running'
  if (singleMedia && media) {
    return (
      <MediaFrameNode
        id={id}
        data={data}
        def={def}
        catColor={catVar}
        Icon={Icon}
        selected={selected}
        refv={media.ref}
        type={media.type}
        onOpen={() => openLightbox(lbItems, 0)}
      />
    )
  }

  return (
    <div
      className={`afs-node${selected ? ' afs-node--selected' : ''}${data.locked ? ' afs-node--locked' : ''}`}
      style={{
        ...(showGrid ? { width: Math.max(200, gridWidth) } : showData ? { width: 300 } : null),
        ...(selected
          ? { boxShadow: `0 0 0 2px ${catVar}` }
          : data.locked
            ? { boxShadow: '0 0 0 1.5px var(--afs-warning)' }
            : null),
      }}
    >
      <div
        className="afs-node__header"
        style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${catVar} 24%, var(--afs-panel-2)), color-mix(in srgb, ${catVar} 8%, var(--afs-panel-2)))` }}
      >
        <Icon size={13} strokeWidth={2.2} style={{ color: catVar }} />
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
                style={{ top, background: `var(--afs-type-${p.type})` }}
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
                style={{ top, background: `var(--afs-type-${p.type})` }}
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
          {hasItems ? (
            genItems!.map((it) => (
              <GenItemTile
                key={`g${it.idx}`}
                item={it}
                onOpen={it.status === 'done' ? () => openLightbox(lbItems, lbIndexByIdx.get(it.idx) ?? 0) : undefined}
              />
            ))
          ) : (
            <>
              {tiles.map((t, i) => (
                <NodeTile key={`t${i}`} refv={t.ref} type={t.type} onOpen={() => openLightbox(lbItems, i)} />
              ))}
              {Array.from({ length: pending }).map((_, i) => (
                <div className="afs-node__tile afs-node__tile--pending" key={`p${i}`} style={{ width: TILE, height: TILE }}>
                  <Loader2 size={18} className="afs-spin" />
                </div>
              ))}
            </>
          )}
        </div>
      ) : showData && card ? (
        <div className="afs-node__data">
          <div
            className="afs-node__data-head afs-node__data-head--click nodrag"
            title="查看全文（剧本/分镜/角色完整内容）"
            onClick={(e) => {
              e.stopPropagation()
              openResultViewer(id)
            }}
          >
            <span>{card.label}</span>
            <span className="afs-node__data-more">查看全文</span>
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
          <div
            className={`afs-node__thumb${lbItems.length ? ' afs-node__tile--click nodrag' : ''}`}
            title={lbItems.length ? '点击看大图' : undefined}
            onClick={lbItems.length ? (e) => { e.stopPropagation(); openLightbox(lbItems, 0) } : undefined}
          >
            <MediaThumb refv={media.ref} type={media.type} />
            {media.count > 1 ? <span className="afs-node__thumb-badge">×{media.count}</span> : null}
          </div>
        )
      )}

      {showProgress && (
        <div className="afs-node__progress" title={`已完成 ${doneCount}/${progTotal}${failedCount ? `，${failedCount} 失败` : ''}`}>
          <div className="afs-node__progress-bar" style={{ width: `${progTotal ? Math.round((doneCount / progTotal) * 100) : 0}%` }} />
          <span className="afs-node__progress-txt">
            {doneCount}/{progTotal}
            {failedCount ? ` · ${failedCount}失败` : ''}
          </span>
        </div>
      )}

      {failedCount > 0 && data.status !== 'running' && (
        <button
          type="button"
          className="afs-node__retry nodrag"
          title="只重新生成失败的那几项，已成功的不重烧"
          onClick={(e) => {
            e.stopPropagation()
            void useGraphStore.getState().retryFailedItems(id)
          }}
        >
          <RotateCcw size={11} /> 重试失败项 ({failedCount})
        </button>
      )}

      {footer && !media && !previewImg && !showGrid && !showData && (
        <div className={`afs-node__summary ${footer.cls}`}>{footer.text}</div>
      )}
    </div>
  )
}

export default memo(FilmNodeComp)
