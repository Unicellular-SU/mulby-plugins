import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Upload,
  Trash2,
  Image as ImageIcon,
  Video,
  Music,
  Sparkles,
  Plus,
  X,
  PlusSquare,
  Users,
  Mountain,
  Brush,
  FolderPlus,
} from 'lucide-react'
import { useAssetStore, type ElementKind, type ElementRef } from '../../store/assetStore'
import { useGraphStore } from '../../store/graphStore'
import { resolveAssetUrl, type AssetRecord, type AssetType } from '../../services/assetRegistry'
import { loadAsset, toDataUrl } from '../../services/assets'

function fmtBytes(n?: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function readFile(file: File): Promise<{ name: string; mime: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      const m = s.match(/^data:([^;]+);base64,(.*)$/)
      resolve({ name: file.name, mime: m?.[1] || file.type || 'application/octet-stream', base64: m?.[2] || '' })
    }
    r.onerror = () => reject(new Error('读取失败'))
    r.readAsDataURL(file)
  })
}

const TYPE_ICON: Record<AssetType, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: Music }
const TYPE_LABEL: Record<AssetType, string> = { image: '图片', video: '视频', audio: '音频' }

/** 素材缩略：图片/视频出缩略，音频出图标 */
export function AssetThumb({ rec }: { rec: AssetRecord }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let on = true
    if (rec.type === 'audio') return
    void resolveAssetUrl(rec).then((u) => on && setUrl(u))
    return () => {
      on = false
    }
  }, [rec.id, rec.type])
  const Icon = TYPE_ICON[rec.type]
  if (rec.type === 'image') return url ? <img src={url} alt="" /> : <div className="afs-lib__ph"><Icon size={24} /></div>
  if (rec.type === 'video') return url ? <video src={url} muted preload="metadata" /> : <div className="afs-lib__ph"><Icon size={24} /></div>
  return (
    <div className="afs-lib__ph afs-lib__ph--audio">
      <Icon size={24} />
    </div>
  )
}

/** 角色/场景参考图缩略（按附件 assetId） */
export function RefThumb({ assetId }: { assetId?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let on = true
    if (!assetId) return
    void loadAsset(assetId).then((a) => a && on && setUrl(toDataUrl(a.base64, a.mime)))
    return () => {
      on = false
    }
  }, [assetId])
  return url ? <img src={url} alt="" /> : <div className="afs-lib__ph"><ImageIcon size={20} /></div>
}

export default function AssetsView({ onInserted }: { onInserted: () => void }) {
  const [tab, setTab] = useState<'assets' | 'elements'>('assets')
  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">素材库</h2>
        <div className="afs-subtabs">
          <button className={`afs-subtab${tab === 'assets' ? ' is-active' : ''}`} onClick={() => setTab('assets')}>
            素材（图片 / 视频 / 音频）
          </button>
          <button className={`afs-subtab${tab === 'elements' ? ' is-active' : ''}`} onClick={() => setTab('elements')}>
            角色 / 场景库
          </button>
        </div>
      </div>
      {tab === 'assets' ? <AssetGallery onInserted={onInserted} /> : <ElementLibrary onInserted={onInserted} />}
    </div>
  )
}

// ===================== 素材画廊（多模态）=====================
function AssetGallery({ onInserted }: { onInserted: () => void }) {
  const assets = useAssetStore((s) => s.assets)
  const usage = useAssetStore((s) => s.usage)
  const busy = useAssetStore((s) => s.busy)
  const loaded = useAssetStore((s) => s.loaded)
  const load = useAssetStore((s) => s.load)
  const upload = useAssetStore((s) => s.upload)
  const removeAsset = useAssetStore((s) => s.removeAsset)
  const runGc = useAssetStore((s) => s.runGc)
  const boards = useAssetStore((s) => s.boards)
  const createBoard = useAssetStore((s) => s.createBoard)
  const renameBoard = useAssetStore((s) => s.renameBoard)
  const deleteBoard = useAssetStore((s) => s.deleteBoard)
  const moveAsset = useAssetStore((s) => s.moveAsset)
  const insertAssetNode = useGraphStore((s) => s.insertAssetNode)
  const saveProject = useGraphStore((s) => s.saveProject)

  const fileRef = useRef<HTMLInputElement>(null)
  const [typeF, setTypeF] = useState<'all' | AssetType>('all')
  const [roleF, setRoleF] = useState<'all' | 'generated' | 'uploaded'>('all')
  const [boardF, setBoardF] = useState<string>('all') // 'all' | 'none' | boardId
  const [q, setQ] = useState('')
  const [preview, setPreview] = useState<AssetRecord | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return assets
      .filter((a) => (typeF === 'all' ? true : a.type === typeF))
      .filter((a) => (roleF === 'all' ? true : a.role === roleF))
      .filter((a) => (boardF === 'all' ? true : boardF === 'none' ? !a.boardId : a.boardId === boardF))
      .filter((a) =>
        kw
          ? `${a.name || ''} ${(a.tags || []).join(' ')} ${a.projectName || ''} ${a.nodeKind || ''}`.toLowerCase().includes(kw)
          : true
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [assets, typeF, roleF, boardF, q])

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const payload = await Promise.all(files.map(readFile))
    await upload(payload.filter((p) => p.base64))
  }

  const onGc = async () => {
    if (!window.confirm('清理「未被任何工程 / 角色场景库 / 上传素材 / 快照」引用的附件？此操作不可撤销。')) return
    await saveProject() // 先落盘当前工程，避免刚生成未保存的素材被误判为孤儿
    const r = await runGc()
    window.mulby?.notification?.show(`已清理 ${r.removed} 个未引用素材，释放 ${fmtBytes(r.freedBytes)}`, 'success')
  }

  const onInsert = async (rec: AssetRecord) => {
    await insertAssetNode(rec)
    onInserted()
  }

  const onNewBoard = async () => {
    const name = window.prompt('新建合集名称')
    if (name && name.trim()) await createBoard(name.trim())
  }
  const onRenameBoard = async (id: string, cur: string) => {
    const name = window.prompt('重命名合集', cur)
    if (name && name.trim()) await renameBoard(id, name.trim())
  }
  const onDeleteBoard = async (id: string) => {
    if (window.confirm('删除该合集？（素材不会被删除，仅归为未分组）')) {
      await deleteBoard(id)
      if (boardF === id) setBoardF('all')
    }
  }
  const boardCount = (id?: string) => assets.filter((a) => (id ? a.boardId === id : !a.boardId)).length

  const counts = useMemo(() => {
    const c = { all: assets.length, image: 0, video: 0, audio: 0 } as Record<string, number>
    for (const a of assets) c[a.type]++
    return c
  }, [assets])

  return (
    <>
      <div className="afs-boards-layout">
        <aside className="afs-boards">
          <div className="afs-boards__head">
            <span>合集</span>
            <button onClick={onNewBoard} title="新建合集">
              <FolderPlus size={14} />
            </button>
          </div>
          <button className={`afs-boards__row${boardF === 'all' ? ' is-active' : ''}`} onClick={() => setBoardF('all')}>
            <span>全部素材</span>
            <span className="afs-boards__n">{assets.length}</span>
          </button>
          <button className={`afs-boards__row${boardF === 'none' ? ' is-active' : ''}`} onClick={() => setBoardF('none')}>
            <span>未分组</span>
            <span className="afs-boards__n">{boardCount()}</span>
          </button>
          {boards.map((b) => (
            <div key={b.id} className={`afs-boards__item${boardF === b.id ? ' is-active' : ''}`}>
              <button className="afs-boards__row" onClick={() => setBoardF(b.id)}>
                <span title={b.name}>{b.name}</span>
                <span className="afs-boards__n">{boardCount(b.id)}</span>
              </button>
              <button className="afs-boards__act" onClick={() => onRenameBoard(b.id, b.name)} title="重命名">
                <Brush size={12} />
              </button>
              <button className="afs-boards__act" onClick={() => onDeleteBoard(b.id)} title="删除合集">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </aside>

        <div className="afs-boards__main">
          <div className="afs-lib__bar">
            <div className="afs-lib__filters">
              {(['all', 'image', 'video', 'audio'] as const).map((t) => (
                <button key={t} className={`afs-chip${typeF === t ? ' is-active' : ''}`} onClick={() => setTypeF(t)}>
                  {t === 'all' ? '全部' : TYPE_LABEL[t]}
                  <span className="afs-chip__n">{counts[t]}</span>
                </button>
              ))}
              <span className="afs-lib__sep" />
              {(['all', 'generated', 'uploaded'] as const).map((r) => (
                <button key={r} className={`afs-chip${roleF === r ? ' is-active' : ''}`} onClick={() => setRoleF(r)}>
                  {r === 'all' ? '全部来源' : r === 'generated' ? '生成' : '上传'}
                </button>
              ))}
            </div>
            <input className="afs-lib__search" placeholder="搜索名称 / 标签 / 工程…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="afs-lib__actions">
              <span className="afs-lib__usage" title="附件库占用">
                占用 {usage.count} 项 · {fmtBytes(usage.bytes)}
              </span>
              <button className="afs-btn" disabled={busy} onClick={onGc} title="清理未引用素材（修复附件存储泄漏）">
                <Sparkles size={15} /> 清理未引用
              </button>
              <button className="afs-btn afs-btn--save" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> 上传素材
              </button>
            </div>
          </div>

          <div className="afs-lib__scroll">
            {filtered.length === 0 ? (
              <div className="afs-lib__empty">{loaded ? '暂无素材。生成的图片/视频/音频会自动入库，也可上传本地素材。' : '加载中…'}</div>
            ) : (
              <div className="afs-lib__grid">
                {filtered.map((a) => {
                  const canInsert = a.type === 'image' || a.type === 'audio'
                  return (
                    <div key={a.id} className="afs-acard">
                      <div className="afs-acard__thumb" onClick={() => setPreview(a)} title="预览">
                        <AssetThumb rec={a} />
                        <span className="afs-acard__type">{TYPE_LABEL[a.type]}</span>
                        {a.role === 'uploaded' && <span className="afs-acard__src">上传</span>}
                      </div>
                      <div className="afs-acard__name" title={a.name || a.nodeKind || a.id}>
                        {a.name || a.nodeKind || '未命名'}
                      </div>
                      <div className="afs-acard__meta">
                        {a.projectName ? a.projectName : a.role === 'uploaded' ? '本地上传' : '生成'} · {fmtBytes(a.bytes)}
                      </div>
                      {boards.length > 0 && (
                        <select
                          className="afs-acard__board"
                          value={a.boardId || ''}
                          onChange={(e) => moveAsset(a.id, e.target.value || undefined)}
                          title="移动到合集"
                        >
                          <option value="">未分组</option>
                          {boards.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="afs-acard__actions">
                        {canInsert && (
                          <button onClick={() => onInsert(a)} title="插入到当前工程画布">
                            <PlusSquare size={13} /> 插入画布
                          </button>
                        )}
                        {a.role === 'uploaded' && (
                          <button
                            className="afs-acard__del"
                            title="删除上传素材"
                            onClick={() => window.confirm('删除该上传素材？') && removeAsset(a.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={onPick} />
      {preview && <Lightbox rec={preview} onClose={() => setPreview(null)} />}
    </>
  )
}

function Lightbox({ rec, onClose }: { rec: AssetRecord; onClose: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let on = true
    void resolveAssetUrl(rec).then((u) => on && setUrl(u))
    return () => {
      on = false
    }
  }, [rec])
  return (
    <div className="afs-lightbox" onClick={onClose}>
      <div className="afs-lightbox__panel" onClick={(e) => e.stopPropagation()}>
        <button className="afs-lightbox__close" onClick={onClose}>
          <X size={18} />
        </button>
        <div className="afs-lightbox__media">
          {rec.type === 'image' && url && <img src={url} alt="" />}
          {rec.type === 'video' && url && <video src={url} controls autoPlay />}
          {rec.type === 'audio' && url && <audio src={url} controls autoPlay />}
        </div>
        <div className="afs-lightbox__meta">
          <div className="afs-lightbox__name">{rec.name || rec.nodeKind || '未命名'}</div>
          <div>
            {TYPE_LABEL[rec.type]} · {rec.mime} · {fmtBytes(rec.bytes)}
            {rec.durationSec ? ` · ${rec.durationSec}s` : ''}
          </div>
          <div className="afs-lightbox__sub">
            来源：{rec.role === 'uploaded' ? '本地上传' : `生成${rec.projectName ? `（${rec.projectName}）` : ''}`}
            {rec.nodeKind ? ` · 节点：${rec.nodeKind}` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

// ===================== 角色 / 场景 Elements 库 =====================
const KIND_ICON: Record<ElementKind, typeof Users> = { character: Users, scene: Mountain }
const KIND_LABEL: Record<ElementKind, string> = { character: '角色', scene: '场景' }

function ElementLibrary({ onInserted }: { onInserted: () => void }) {
  const elements = useAssetStore((s) => s.elements)
  const assets = useAssetStore((s) => s.assets)
  const loaded = useAssetStore((s) => s.loaded)
  const load = useAssetStore((s) => s.load)
  const saveElement = useAssetStore((s) => s.saveElement)
  const removeElement = useAssetStore((s) => s.removeElement)
  const insertElementNode = useGraphStore((s) => s.insertElementNode)

  const [editing, setEditing] = useState<(Partial<ElementRef> & { kind: ElementKind }) | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const imageAssets = useMemo(() => assets.filter((a) => a.type === 'image' && a.assetId), [assets])

  const onInsert = async (el: ElementRef) => {
    await insertElementNode(el)
    onInserted()
  }
  const onSave = async () => {
    if (!editing || !editing.name?.trim()) {
      window.mulby?.notification?.show('请填写名称', 'warning')
      return
    }
    await saveElement({ ...editing, kind: editing.kind, name: editing.name.trim() })
    setEditing(null)
  }

  return (
    <>
      <div className="afs-lib__bar">
        <div className="afs-lib__hint">角色 / 场景定义一次、跨工程复用（一致性底座）。「插入画布」生成绑定参考图的人物 / 场景节点。</div>
        <div className="afs-lib__actions">
          <button className="afs-btn" onClick={() => setEditing({ kind: 'character', name: '', refAssetIds: [] })}>
            <Users size={15} /> 新建角色
          </button>
          <button className="afs-btn" onClick={() => setEditing({ kind: 'scene', name: '', refAssetIds: [] })}>
            <Mountain size={15} /> 新建场景
          </button>
        </div>
      </div>

      <div className="afs-lib__scroll">
        {elements.length === 0 ? (
          <div className="afs-lib__empty">{loaded ? '暂无角色 / 场景。新建，或在画布的人物 / 场景节点点「保存到库」。' : '加载中…'}</div>
        ) : (
          <div className="afs-lib__grid">
            {elements.map((el) => {
              const Icon = KIND_ICON[el.kind]
              return (
                <div key={el.id} className="afs-acard">
                  <div className="afs-acard__thumb" onClick={() => onInsert(el)} title="插入到画布">
                    <RefThumb assetId={el.refAssetIds?.[0]} />
                    <span className="afs-acard__type">
                      <Icon size={11} /> {KIND_LABEL[el.kind]}
                    </span>
                  </div>
                  <div className="afs-acard__name" title={el.name}>
                    {el.name}
                  </div>
                  <div className="afs-acard__meta">{el.description ? el.description.slice(0, 28) : '无描述'}</div>
                  <div className="afs-acard__actions">
                    <button onClick={() => onInsert(el)} title="插入到当前工程画布">
                      <PlusSquare size={13} /> 插入画布
                    </button>
                    <button onClick={() => setEditing(el)} title="编辑">
                      <Brush size={13} />
                    </button>
                    <button className="afs-acard__del" onClick={() => window.confirm(`删除「${el.name}」？`) && removeElement(el.id)} title="删除">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing && (
        <div className="afs-lightbox" onClick={() => setEditing(null)}>
          <div className="afs-elform" onClick={(e) => e.stopPropagation()}>
            <div className="afs-elform__head">
              <span>{editing.id ? '编辑' : '新建'}{KIND_LABEL[editing.kind]}</span>
              <button className="afs-lightbox__close" onClick={() => setEditing(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="afs-field">
              <label className="afs-field__label">名称</label>
              <input className="afs-field__input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={editing.kind === 'character' ? '如：小明' : '如：咖啡馆'} />
            </div>
            <div className="afs-field">
              <label className="afs-field__label">{editing.kind === 'character' ? '外貌 / 设定' : '环境 / 氛围'}</label>
              <textarea className="afs-field__input" rows={3} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="afs-field">
              <label className="afs-field__label">英文提示词（可选）</label>
              <textarea className="afs-field__input" rows={2} value={editing.prompt || ''} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} />
            </div>
            <div className="afs-field">
              <label className="afs-field__label">参考图（从图片素材选，可选）</label>
              {imageAssets.length === 0 ? (
                <div className="afs-inspector__note">暂无图片素材，可先在「素材」上传或生成</div>
              ) : (
                <div className="afs-elform__refs">
                  {imageAssets.map((a) => {
                    const picked = (editing.refAssetIds || []).includes(a.assetId!)
                    return (
                      <button
                        key={a.id}
                        className={`afs-elform__ref${picked ? ' is-picked' : ''}`}
                        onClick={() => setEditing({ ...editing, refAssetIds: picked ? [] : [a.assetId!] })}
                        title={a.name || a.assetId}
                      >
                        <RefThumb assetId={a.assetId} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="afs-elform__actions">
              <button className="afs-btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button className="afs-btn afs-btn--save" onClick={onSave}>
                <Plus size={14} /> 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
