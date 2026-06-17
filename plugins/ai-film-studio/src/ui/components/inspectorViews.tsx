import { useState } from 'react'
import { FolderOpen, ChevronRight, ChevronDown, X, Pencil, Wand2, Loader2 } from 'lucide-react'
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
function MediaTile({ v, onClick }: { v: PortValue; onClick?: () => void }) {
  const name = typeof v.meta?.name === 'string' ? v.meta.name : typeof v.meta?.shot === 'string' ? v.meta.shot : ''
  return (
    <div className="afs-tile">
      {v.type === 'video' ? (
        <video className="afs-tile__media" src={v.url} controls preload="metadata" />
      ) : v.type === 'audio' ? (
        <audio className="afs-tile__audio" src={v.url} controls />
      ) : (
        <img
          className={`afs-tile__media${onClick ? ' afs-tile__media--click' : ''}`}
          src={v.url}
          alt={name}
          onClick={onClick}
          title={onClick ? '点击查看大图 / 对话修改' : undefined}
        />
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

// 大图灯箱 + 对话改图 + 重新生成（操作期间保持打开并显示 loading，完成后大图自动刷新）
function Lightbox({
  url,
  onClose,
  onEdit,
  onRegen,
}: {
  url?: string
  onClose: () => void
  onEdit?: (prompt: string) => Promise<void>
  onRegen?: () => Promise<void>
}) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  if (!url) return null
  const doEdit = async () => {
    if (!prompt.trim() || !onEdit || busy) return
    setBusy(true)
    try {
      await onEdit(prompt.trim())
      setPrompt('')
    } finally {
      setBusy(false)
    }
  }
  const doRegen = async () => {
    if (!onRegen || busy) return
    setBusy(true)
    try {
      await onRegen()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="afs-lightbox" onClick={busy ? undefined : onClose}>
      <div className="afs-lightbox__panel" onClick={(e) => e.stopPropagation()}>
        <button className="afs-lightbox__close" onClick={onClose} disabled={busy}>
          <X size={18} />
        </button>
        <div className="afs-lightbox__imgwrap">
          <img className="afs-lightbox__img" src={url} alt="" />
          {busy ? (
            <div className="afs-lightbox__loading">
              <Loader2 size={28} className="afs-spin" />
              <span>生成中…</span>
            </div>
          ) : null}
        </div>
        {onEdit || onRegen ? (
          <div className="afs-lightbox__edit">
            {onRegen ? (
              <button className="afs-btn afs-btn--mini" disabled={busy} onClick={doRegen} title="按当前上游/参考图重新生成这一张">
                重新生成
              </button>
            ) : null}
            {onEdit ? (
              <>
                <Wand2 size={14} />
                <input
                  className="afs-field__input"
                  placeholder="描述如何修改这张图（img2img）…"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doEdit()
                  }}
                  disabled={busy}
                />
                <button className="afs-btn afs-btn--mini" disabled={!prompt.trim() || busy} onClick={doEdit}>
                  {busy ? <Loader2 size={13} className="afs-spin" /> : '修改'}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// 文本/JSON 二次编辑
function EditableValue({
  value,
  onEditText,
}: {
  value: PortValue
  onEditText?: (text: string) => string | null
}) {
  const isJson = value.type === 'json'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [err, setErr] = useState('')
  const startEdit = () => {
    let t = ''
    if (isJson) {
      try {
        t = JSON.stringify(value.json, null, 2)
      } catch {
        t = value.text || ''
      }
    } else {
      t = value.text || ''
    }
    setDraft(t)
    setErr('')
    setEditing(true)
  }
  const save = () => {
    const e = onEditText ? onEditText(draft) : '编辑不可用'
    if (e) setErr(e)
    else setEditing(false)
  }
  if (editing) {
    return (
      <div>
        <textarea className="afs-field__input afs-editbox" rows={isJson ? 12 : 8} value={draft} onChange={(e) => setDraft(e.target.value)} />
        {err ? <div className="afs-editerr">{err}</div> : null}
        <div className="afs-result__actions">
          <button className="afs-btn afs-btn--mini" onClick={save}>
            保存
          </button>
          <button className="afs-btn afs-btn--mini" onClick={() => setEditing(false)}>
            取消
          </button>
        </div>
      </div>
    )
  }
  return (
    <div>
      {isJson ? <JsonView json={value.json} /> : <pre className="afs-result__pre">{value.text ?? ''}</pre>}
      {onEditText ? (
        <button className="afs-raw__toggle" onClick={startEdit}>
          <Pencil size={12} /> 编辑{isJson ? ' JSON' : ''}
        </button>
      ) : null}
    </div>
  )
}

// 单个输出端口产物的富渲染：扇出→画廊（图可点开大图/对话改图）；JSON/文本→可编辑；视频/音频→播放
export function OutputView({
  value,
  onEditImage,
  onRegenImage,
  onEditText,
}: {
  value: PortValue
  onEditImage?: (index: number, prompt: string) => Promise<void>
  onRegenImage?: (index: number) => Promise<void>
  onEditText?: (text: string) => string | null
}) {
  const [lightbox, setLightbox] = useState<number | null>(null)

  if (value.type === 'json' || value.type === 'text' || (!value.items && value.text && !value.url)) {
    return <EditableValue value={value} onEditText={onEditText} />
  }

  const rawItems = value.items && value.items.length ? value.items : null
  const mediaList: PortValue[] | null = rawItems
    ? rawItems.filter((it) => !!it.url)
    : (value.type === 'image' || value.type === 'video' || value.type === 'audio') && value.url
      ? [value]
      : null

  if (mediaList) {
    if (mediaList.length === 0) return <div className="afs-inspector__note">（暂无可显示内容）</div>
    const isImage = mediaList[0].type === 'image'
    return (
      <div>
        {rawItems ? <div className="afs-gallery__count">{mediaList.length} 项</div> : null}
        <div className="afs-gallery">
          {mediaList.map((it, i) => (
            <MediaTile
              key={it.assetId || it.url || `item-${i}`}
              v={it}
              onClick={it.type === 'image' ? () => setLightbox(i) : undefined}
            />
          ))}
        </div>
        {lightbox != null && mediaList[lightbox] ? (
          <Lightbox
            url={mediaList[lightbox].url}
            onClose={() => setLightbox(null)}
            onEdit={isImage && onEditImage ? (prompt) => onEditImage(lightbox, prompt) : undefined}
            onRegen={isImage && onRegenImage ? () => onRegenImage(lightbox) : undefined}
          />
        ) : null}
      </div>
    )
  }
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
