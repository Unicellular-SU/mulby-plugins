import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUiStore, type LightboxItem } from '../store/uiStore'
import { useGraphStore, type PortValue } from '../store/graphStore'
import { getNodeDef } from '../nodes/nodeDefs'
import { useMediaUrl, useInView, hasMedia, type MediaRef } from '../services/mediaUrl'

/** M33 统一结果查看器：节点产物看全——剧本/分镜/角色结构化可读(含台词)、媒体网格点开 Lightbox、文本全文 */
export default function ResultViewer() {
  const nodeId = useUiStore((s) => s.resultViewer)
  const close = useUiStore((s) => s.closeResultViewer)
  const lightboxOpen = useUiStore((s) => !!s.lightbox)
  const node = useGraphStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId) : undefined))
  // Esc 关闭（但 Lightbox 在上层时让其先关，避免一次 Esc 连关两层）
  useEffect(() => {
    if (!nodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !lightboxOpen) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodeId, lightboxOpen, close])
  if (!nodeId || !node) return null
  const def = getNodeDef(node.data.kind)
  const v = node.data.outputs ? (Object.values(node.data.outputs).find(Boolean) as PortValue | undefined) : undefined

  return (
    <div className="afs-rv" onClick={close}>
      <div className="afs-rv__panel" role="dialog" aria-modal="true" aria-labelledby="afs-rv-title" onClick={(e) => e.stopPropagation()}>
        <div className="afs-rv__head">
          <span className="afs-rv__title" id="afs-rv-title">{node.data.title || def?.label} · 结果</span>
          <button className="afs-rv__close" onClick={close} title="关闭 (Esc)" aria-label="关闭 (Esc)">
            <X size={18} />
          </button>
        </div>
        <div className="afs-rv__body nowheel">{v ? <Content kind={node.data.kind} v={v} /> : <div className="afs-rv__empty">暂无产物</div>}</div>
      </div>
    </div>
  )
}

function Content({ kind, v }: { kind: string; v: PortValue }) {
  // 媒体（图/视频）网格
  const items = v.items && v.items.length ? v.items : [v]
  const media = items.filter((x) => (x.type === 'image' || x.type === 'video') && hasMedia(x))
  if (media.length) return <MediaGrid items={media} />
  // 结构化 JSON
  if (v.type === 'json' && v.json && typeof v.json === 'object') return <JsonStructured kind={kind} json={v.json as Record<string, unknown>} />
  // 纯文本
  if (v.text) return <pre className="afs-rv__pre">{v.text}</pre>
  return <div className="afs-rv__empty">无可展示内容</div>
}

function MediaGrid({ items }: { items: PortValue[] }) {
  const open = useUiStore((s) => s.openLightbox)
  const lb: LightboxItem[] = items.map((x) => ({ ref: x as MediaRef, type: x.type as 'image' | 'video' }))
  return (
    <div className="afs-rv__grid">
      {items.map((x, i) => (
        <RvTile key={i} refv={x as MediaRef} type={x.type as 'image' | 'video'} cap={String(x.meta?.shot ?? x.meta?.name ?? i + 1)} onOpen={() => open(lb, i)} />
      ))}
    </div>
  )
}

function RvTile({ refv, type, cap, onOpen }: { refv: MediaRef; type: 'image' | 'video'; cap: string; onOpen: () => void }) {
  const [ref, inView] = useInView<HTMLDivElement>('600px')
  const url = useMediaUrl(inView ? refv : null)
  return (
    <div className="afs-rv__tile" ref={ref} onClick={onOpen} title={`${cap}（点击看大图）`}>
      {url ? type === 'video' ? <video src={url} muted loop playsInline preload="metadata" /> : <img src={url} alt="" /> : null}
      <span className="afs-rv__tile-cap">{cap}</span>
    </div>
  )
}

const s = (x: unknown) => (x == null ? '' : String(x))
const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : [])

function Chips({ items }: { items: (string | false | undefined)[] }) {
  const cs = items.filter(Boolean) as string[]
  return cs.length ? (
    <div className="afs-rv__chips">
      {cs.map((c, i) => (
        <span className="afs-chip" key={i}>
          {c}
        </span>
      ))}
    </div>
  ) : null
}

function Dialogues({ d }: { d: unknown }) {
  const lines = arr(d)
  if (!lines.length) return null
  return (
    <div className="afs-rv__dlg">
      {lines.map((l, i) => (
        <div key={i}>
          <b>{s(l.character || l.speaker)}</b>：{s(l.line)}
          {l.emotion ? <i> （{s(l.emotion)}）</i> : null}
        </div>
      ))}
    </div>
  )
}

/** 结构化 JSON：剧本/分镜/角色/大纲 全文可读（不截断）；其余回退原始 JSON */
function JsonStructured({ kind, json }: { kind: string; json: Record<string, unknown> }) {
  if (kind === 'storyboard' && Array.isArray(json.shots)) {
    const segs = arr(json.segments)
    return (
      <div className="afs-rv__list">
        {segs.length ? (
          <div className="afs-rv__seg">
            段落：{segs.map((g) => `${s(g.label) || s(g.id)}（${s(g.mood)}）`).join(' · ')}
          </div>
        ) : null}
        {arr(json.shots).map((sh, i) => (
          <div className="afs-rv__row" key={i}>
            <div className="afs-rv__row-h">
              <b>{s(sh.id) || `镜 ${i + 1}`}</b>
              <Chips
                items={[
                  s(sh.shotSize),
                  s(sh.camera),
                  sh.duration ? `${sh.duration}s` : '',
                  sh.segmentId ? `段 ${s(sh.segmentId)}` : '',
                  sh.continuousFromPrev === true || s(sh.continuousFromPrev) === 'true' ? '顺接' : '',
                ]}
              />
            </div>
            {sh.description ? <div className="afs-rv__row-sub">{s(sh.description)}</div> : null}
            <Dialogues d={sh.dialogues} />
            {sh.prompt ? <div className="afs-rv__row-prompt">prompt：{s(sh.prompt)}</div> : null}
          </div>
        ))}
      </div>
    )
  }
  if (kind === 'script-gen' && Array.isArray(json.scenes)) {
    return (
      <div className="afs-rv__list">
        {arr(json.scenes).map((sc, i) => (
          <div className="afs-rv__row" key={i}>
            <div className="afs-rv__row-h">
              <b>{s(sc.slug) || `场 ${i + 1}`}</b>
              <Chips items={[s(sc.location), s(sc.time)]} />
            </div>
            {sc.summary ? <div className="afs-rv__row-sub">{s(sc.summary)}</div> : null}
            <Dialogues d={sc.dialogues} />
          </div>
        ))}
      </div>
    )
  }
  if (kind === 'char-sheet' && Array.isArray(json.characters)) {
    return (
      <div className="afs-rv__list">
        {arr(json.characters).map((c, i) => (
          <div className="afs-rv__row" key={i}>
            <div className="afs-rv__row-h">
              <b>{s(c.name) || `角色 ${i + 1}`}</b>
              <Chips
                items={[c.voiceId ? `音色 ${s(c.voiceId)}` : '', Array.isArray(c.variants) ? `${(c.variants as unknown[]).length} 个时期变体` : '']}
              />
            </div>
            {c.identity ? <div className="afs-rv__row-sub">身份：{s(c.identity)}</div> : null}
            {c.appearance ? <div className="afs-rv__row-sub">外观：{s(c.appearance)}</div> : null}
            {Array.isArray(c.variants) && (c.variants as unknown[]).length ? (
              <div className="afs-rv__chips">
                {arr(c.variants).map((vv, k) => (
                  <span className="afs-chip" key={k}>
                    {s(vv.label) || s(vv.id)}：{s(vv.appearance)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    )
  }
  if (kind === 'outline' && Array.isArray(json.beats)) {
    return (
      <div className="afs-rv__list">
        {arr(json.beats).map((b, i) => (
          <div className="afs-rv__row" key={i}>
            <div className="afs-rv__row-h">
              <b>{s(b.type) || `节拍 ${i + 1}`}</b>
              <Chips items={[s(b.emotion)]} />
            </div>
            {b.summary ? <div className="afs-rv__row-sub">{s(b.summary)}</div> : null}
          </div>
        ))}
      </div>
    )
  }
  return <pre className="afs-rv__pre">{JSON.stringify(json, null, 2)}</pre>
}
