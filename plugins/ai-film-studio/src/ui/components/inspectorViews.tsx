import { useState } from 'react'
import { FolderOpen, ChevronRight, ChevronDown } from 'lucide-react'
import type { PortValue } from '../store/graphStore'
import { basename } from '../services/download'

function openFolder(p?: string) {
  if (p) window.mulby?.shell?.showItemInFolder?.(p)
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

// ============ 结构化 JSON 卡片 ============
function SceneList({ j }: { j: Record<string, unknown> }) {
  const scenes = (j.scenes as Array<Record<string, unknown>>) || []
  return (
    <div className="afs-cards">
      {j.title || j.logline ? (
        <div className="afs-card afs-card--head">
          {j.title ? <div className="afs-card__title">{String(j.title)}</div> : null}
          {j.logline ? <div className="afs-card__sub">{String(j.logline)}</div> : null}
          <div className="afs-card__meta">
            {[j.theme, j.tone].filter(Boolean).map((x, k) => (
              <span key={k} className="afs-chip">{String(x)}</span>
            ))}
          </div>
        </div>
      ) : null}
      {scenes.map((s, i) => (
        <div className="afs-card" key={String(s.id || s.slug || i)}>
          <div className="afs-card__title">{String(s.slug || s.id || `场景 ${i + 1}`)}</div>
          <div className="afs-card__meta">
            {[s.location, s.time].filter(Boolean).map((x, k) => (
              <span key={k} className="afs-chip">{String(x)}</span>
            ))}
          </div>
          {s.summary ? <div className="afs-card__text">{String(s.summary)}</div> : null}
          {Array.isArray(s.dialogues) && (s.dialogues as unknown[]).length > 0 ? (
            <div className="afs-card__dlg">
              {(s.dialogues as Array<Record<string, unknown>>).map((d, k) => (
                <div key={k}>
                  {d.character ? <b>{String(d.character)}：</b> : null}
                  {String(d.line ?? '')}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ShotList({ j }: { j: Record<string, unknown> }) {
  const shots = (j.shots as Array<Record<string, unknown>>) || []
  return (
    <div className="afs-cards">
      {shots.map((s, i) => (
        <div className="afs-card" key={String(s.id || i)}>
          <div className="afs-card__title">
            {String(s.id || `镜头 ${i + 1}`)}
            {s.scene ? <span className="afs-card__sub"> · {String(s.scene)}</span> : null}
          </div>
          <div className="afs-card__meta">
            {[s.shotSize, s.camera, s.duration != null ? `${s.duration}s` : '', s.location, s.mood]
              .filter(Boolean)
              .map((x, k) => (
                <span key={k} className="afs-chip">{String(x)}</span>
              ))}
          </div>
          {s.description ? <div className="afs-card__text">{String(s.description)}</div> : null}
          {s.prompt ? <div className="afs-card__prompt">{String(s.prompt)}</div> : null}
        </div>
      ))}
    </div>
  )
}

function CharList({ j }: { j: Record<string, unknown> }) {
  const chars = (j.characters as Array<Record<string, unknown>>) || []
  return (
    <div className="afs-cards">
      {chars.map((c, i) => (
        <div className="afs-card" key={String(c.name || i)}>
          <div className="afs-card__title">{String(c.name || `角色 ${i + 1}`)}</div>
          {c.appearance ? <div className="afs-card__text">外貌：{String(c.appearance)}</div> : null}
          {c.description ? <div className="afs-card__text">{String(c.description)}</div> : null}
        </div>
      ))}
    </div>
  )
}

function RawJson({ json, defaultOpen = false }: { json: unknown; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  let text = ''
  try {
    text = JSON.stringify(json, null, 2)
  } catch {
    text = String(json)
  }
  return (
    <div className="afs-raw">
      <button className="afs-raw__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 原始 JSON
      </button>
      {open ? <pre className="afs-result__pre">{text}</pre> : null}
    </div>
  )
}

export function JsonView({ json }: { json: unknown }) {
  const j = rec(json)
  if (Array.isArray(j.scenes))
    return (
      <>
        <SceneList j={j} />
        <RawJson json={json} />
      </>
    )
  if (Array.isArray(j.shots))
    return (
      <>
        <ShotList j={j} />
        <RawJson json={json} />
      </>
    )
  if (Array.isArray(j.characters))
    return (
      <>
        <CharList j={j} />
        <RawJson json={json} />
      </>
    )
  return <RawJson json={json} defaultOpen />
}

// ============ 媒体画廊 ============
function MediaTile({ v }: { v: PortValue }) {
  const name = typeof v.meta?.name === 'string' ? v.meta.name : typeof v.meta?.shot === 'string' ? v.meta.shot : ''
  return (
    <div className="afs-tile">
      {v.type === 'video' ? (
        <video className="afs-tile__media" src={v.url} controls preload="metadata" />
      ) : v.type === 'audio' ? (
        <audio className="afs-tile__audio" src={v.url} controls />
      ) : (
        <img className="afs-tile__media" src={v.url} alt={name} />
      )}
      {(name || v.localPath) && (
        <div className="afs-tile__bar">
          {name ? (
            <span className="afs-tile__name" title={name}>
              {name}
            </span>
          ) : (
            <span />
          )}
          {v.localPath ? (
            <button className="afs-tile__folder" title={`已存本地：${basename(v.localPath)}`} onClick={() => openFolder(v.localPath)}>
              <FolderOpen size={12} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

// 单个输出端口产物的富渲染：扇出→画廊；JSON→卡片；媒体→播放；文本→pre
export function OutputView({ value }: { value: PortValue }) {
  const rawItems = value.items && value.items.length ? value.items : null
  if (rawItems) {
    const items = rawItems.filter((it) => !!it.url)
    if (items.length === 0) return <div className="afs-inspector__note">（{rawItems.length} 项产物，暂无可显示内容）</div>
    return (
      <div>
        <div className="afs-gallery__count">{items.length} 项</div>
        <div className="afs-gallery">
          {items.map((it, i) => (
            <MediaTile key={it.assetId || it.url || `item-${i}`} v={it} />
          ))}
        </div>
      </div>
    )
  }
  if (value.type === 'json') return <JsonView json={value.json} />
  if ((value.type === 'image' || value.type === 'video' || value.type === 'audio') && value.url) {
    return (
      <div className="afs-gallery">
        <MediaTile v={value} />
      </div>
    )
  }
  const text = value.text ?? ''
  if (text) return <pre className="afs-result__pre">{text}</pre>
  return <div className="afs-inspector__note">（无内容）</div>
}

// 输入端口的紧凑摘要（输入区用）
export function InputSummary({ value }: { value: PortValue }) {
  if (value.items && value.items.length) {
    const first = value.items[0]
    if (first?.type === 'image' && first.url) {
      return (
        <span className="afs-inmini">
          <img className="afs-inthumb" src={first.url} alt="" /> ×{value.items.length}
        </span>
      )
    }
    return <span className="afs-inmini">{value.items.length} 项</span>
  }
  if (value.type === 'json') {
    const j = rec(value.json)
    if (Array.isArray(j.scenes)) return <span className="afs-inmini">剧本 · {j.scenes.length} 场</span>
    if (Array.isArray(j.shots)) return <span className="afs-inmini">分镜 · {j.shots.length} 镜</span>
    if (Array.isArray(j.characters)) return <span className="afs-inmini">角色 · {j.characters.length} 个</span>
    return <span className="afs-inmini">JSON</span>
  }
  if (value.type === 'image' && value.url) return <img className="afs-inthumb" src={value.url} alt="" />
  if (value.type === 'video') return <span className="afs-inmini">视频</span>
  if (value.type === 'audio') return <span className="afs-inmini">音频</span>
  if (value.text) return <span className="afs-inmini">{value.text.slice(0, 40)}</span>
  return <span className="afs-inspector__note">空</span>
}
