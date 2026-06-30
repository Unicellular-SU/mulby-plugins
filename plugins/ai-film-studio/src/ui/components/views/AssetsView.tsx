import { useEffect, useMemo, useRef, useState } from 'react'
import Select from '../ui/Select'
import Segmented from '../ui/Segmented'
import EmptyState from '../ui/EmptyState'
import Skeleton from '../ui/Skeleton'
import Tabs from '../ui/Tabs'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import Modal from '../ui/Modal'
import Tooltip from '../ui/Tooltip'
import { Field, Input, Textarea } from '../ui/Field'
import { useConfirm } from '../ui/ConfirmDialog'
import { usePrompt } from '../ui/PromptDialog'
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
  Box,
  Brush,
  FolderPlus,
  Search,
} from 'lucide-react'
import { useAssetStore, type ElementKind, type ElementRef } from '../../store/assetStore'
import { useGraphStore } from '../../store/graphStore'
import { type AssetRecord, type AssetType } from '../../services/assetRegistry'
import { loadAssetUrl } from '../../services/assets'
import { useMediaUrl, useInView } from '../../services/mediaUrl'

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
  // 窗口化：稳定的 ph 容器承载 useInView ref；离屏不解析 blob（避免大画廊一次性几百次 attachment.get）
  const [ref, inView] = useInView<HTMLDivElement>('400px')
  const url = useMediaUrl(rec.type !== 'audio' && inView ? rec : null)
  const Icon = TYPE_ICON[rec.type]
  const phClass = `afs-lib__ph${rec.type === 'audio' ? ' afs-avph--audio' : ''}`
  return (
    <div className={phClass} ref={ref}>
      {rec.type === 'image' && url ? (
        <img className="afs-thumb__overlay" src={url} alt="" />
      ) : rec.type === 'video' && url ? (
        <video className="afs-thumb__overlay" src={url} muted preload="metadata" />
      ) : (
        <Icon size={24} />
      )}
    </div>
  )
}

/** 角色/场景参考图缩略（按附件 assetId） */
export function RefThumb({ assetId }: { assetId?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let on = true
    if (!assetId) return
    // blob: URL 生命周期由 assets.ts 字节缓存拥有，组件仅用 mounted 守卫，绝不在此 revoke
    void loadAssetUrl(assetId).then((u) => u && on && setUrl(u))
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
      <div className="afs-surface__head afs-avhead">
        <h2 className="afs-surface__title">素材库</h2>
        <Tabs
          ariaLabel="素材库视图"
          value={tab}
          onChange={(v) => setTab(v as 'assets' | 'elements')}
          tabs={[
            { value: 'assets', label: '素材（图片 / 视频 / 音频）' },
            { value: 'elements', label: '角色 / 场景库' },
          ]}
        />
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

  const confirm = useConfirm()
  const prompt = usePrompt()

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
    if (!(await confirm({ title: '清理未引用素材', message: '清理「未被任何工程 / 角色场景库 / 上传素材 / 快照」引用的附件？此操作不可撤销。', confirmLabel: '清理', danger: true }))) return
    await saveProject() // 先落盘当前工程，避免刚生成未保存的素材被误判为孤儿
    const r = await runGc()
    window.mulby?.notification?.show(`已清理 ${r.removed} 个未引用素材，释放 ${fmtBytes(r.freedBytes)}`, 'success')
  }

  const onInsert = async (rec: AssetRecord) => {
    await insertAssetNode(rec)
    onInserted()
  }

  const onNewBoard = async () => {
    const name = await prompt({ title: '新建合集', placeholder: '合集名称', confirmLabel: '创建' })
    if (name && name.trim()) await createBoard(name.trim())
  }
  const onRenameBoard = async (id: string, cur: string) => {
    const name = await prompt({ title: '重命名合集', placeholder: '合集名称', defaultValue: cur })
    if (name && name.trim()) await renameBoard(id, name.trim())
  }
  const onDeleteBoard = async (id: string) => {
    if (await confirm({ title: '删除合集', message: '删除该合集？（素材不会被删除，仅归为未分组）', confirmLabel: '删除', danger: true })) {
      await deleteBoard(id)
      if (boardF === id) setBoardF('all')
    }
  }
  const onDeleteAsset = async (id: string) => {
    if (await confirm({ title: '删除上传素材', message: '删除该上传素材？', confirmLabel: '删除', danger: true })) removeAsset(id)
  }
  const boardCount = (id?: string) => assets.filter((a) => (id ? a.boardId === id : !a.boardId)).length

  const counts = useMemo(() => {
    const c = { all: assets.length, image: 0, video: 0, audio: 0 } as Record<string, number>
    for (const a of assets) c[a.type]++
    return c
  }, [assets])

  return (
    <>
      <div className="afs-avgallery">
        <aside className="afs-boards">
          <div className="afs-boards__head">
            <span>合集</span>
            <IconButton size="sm" icon={<FolderPlus size={14} />} aria-label="新建合集" onClick={onNewBoard} />
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
              <IconButton
                size="sm"
                className="afs-boards__act"
                icon={<Brush size={12} />}
                aria-label="重命名"
                onClick={() => onRenameBoard(b.id, b.name)}
              />
              <IconButton
                size="sm"
                variant="danger"
                className="afs-boards__act"
                icon={<Trash2 size={12} />}
                aria-label="删除合集"
                onClick={() => onDeleteBoard(b.id)}
              />
            </div>
          ))}
        </aside>

        <div className="afs-avcol">
          <div className="afs-avtoolbar">
            <Segmented
              ariaLabel="按类型筛选"
              size="sm"
              value={typeF}
              onChange={(v) => setTypeF(v as 'all' | 'image' | 'video' | 'audio')}
              options={(['all', 'image', 'video', 'audio'] as const).map((t) => ({
                value: t,
                label: `${t === 'all' ? '全部' : TYPE_LABEL[t]} ${counts[t]}`,
              }))}
            />
            <span className="afs-avtoolbar__divider" />
            <Segmented
              ariaLabel="按来源筛选"
              size="sm"
              value={roleF}
              onChange={(v) => setRoleF(v as 'all' | 'generated' | 'uploaded')}
              options={[
                { value: 'all', label: '全部来源' },
                { value: 'generated', label: '生成' },
                { value: 'uploaded', label: '上传' },
              ]}
            />
            <span className="afs-avtoolbar__spacer" />
            <div className="afs-avsearch">
              <Search size={13} className="afs-avsearch__icon" aria-hidden />
              <input
                type="search"
                className="afs-avsearch__input"
                placeholder="搜索名称 / 标签 / 工程…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button className="afs-avsearch__clear" onClick={() => setQ('')} aria-label="清除搜索" type="button">
                  <X size={12} />
                </button>
              )}
            </div>
            <Tooltip content="附件库占用">
              <span className="afs-avusage">
                占用 {usage.count} 项 · {fmtBytes(usage.bytes)}
              </span>
            </Tooltip>
            <Button variant="secondary" size="sm" leadingIcon={Sparkles} disabled={busy} onClick={onGc} title="清理未引用素材（修复附件存储泄漏）">
              清理未引用
            </Button>
            <Button variant="gradient" size="sm" glow leadingIcon={Upload} disabled={busy} onClick={() => fileRef.current?.click()}>
              上传素材
            </Button>
          </div>

          <div className="afs-avscroll">
            {filtered.length === 0 ? (
              loaded ? (
                <EmptyState icon={ImageIcon} title="暂无素材" description="生成的图片 / 视频 / 音频会自动入库，也可上传本地素材。" />
              ) : (
                <div className="afs-avtiles" role="status" aria-label="加载中…">
                  <Skeleton count={8} height={150} radius={12} />
                </div>
              )
            ) : (
              <div className="afs-avtiles">
                {filtered.map((a) => {
                  const canInsert = a.type === 'image' || a.type === 'audio'
                  return (
                    <div key={a.id} className="afs-avcard">
                      <div className="afs-avcard__thumb" onClick={() => setPreview(a)} title="预览">
                        <AssetThumb rec={a} />
                        <span className="afs-avpill afs-avpill--type">{TYPE_LABEL[a.type]}</span>
                        {a.role === 'uploaded' && <span className="afs-avpill afs-avpill--src">上传</span>}
                      </div>
                      <div className="afs-avcard__name" title={a.name || a.nodeKind || a.id}>
                        {a.name || a.nodeKind || '未命名'}
                      </div>
                      <div className="afs-avcard__meta">
                        {a.projectName ? a.projectName : a.role === 'uploaded' ? '本地上传' : '生成'} · {fmtBytes(a.bytes)}
                      </div>
                      {boards.length > 0 && (
                        <Select
                          size="sm"
                          block
                          className="afs-avcard__board"
                          value={a.boardId || ''}
                          onChange={(v) => moveAsset(a.id, v || undefined)}
                          options={[{ value: '', label: '未分组' }, ...boards.map((b) => ({ value: b.id, label: b.name }))]}
                          title="移动到合集"
                          ariaLabel="移动到合集"
                        />
                      )}
                      <div className="afs-avcard__foot">
                        {canInsert && (
                          <Button variant="secondary" size="sm" leadingIcon={PlusSquare} onClick={() => onInsert(a)} title="插入到当前工程画布">
                            插入画布
                          </Button>
                        )}
                        {a.role === 'uploaded' && (
                          <IconButton
                            variant="danger"
                            size="sm"
                            className="afs-avcard__foot--push"
                            icon={<Trash2 size={13} />}
                            aria-label="删除上传素材"
                            onClick={() => onDeleteAsset(a.id)}
                          />
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
  const url = useMediaUrl(rec)
  return (
    <div className="afs-avlightbox" onClick={onClose}>
      <div className="afs-avlightbox__panel" onClick={(e) => e.stopPropagation()}>
        <div className="afs-avlightbox__close">
          <IconButton variant="onmedia" icon={<X size={18} />} aria-label="关闭" onClick={onClose} />
        </div>
        <div className="afs-avlightbox__media">
          {rec.type === 'image' && url && <img src={url} alt="" />}
          {rec.type === 'video' && url && <video src={url} controls autoPlay />}
          {rec.type === 'audio' && url && <audio src={url} controls autoPlay />}
        </div>
        <div className="afs-avlightbox__info">
          <div className="afs-avlightbox__name">{rec.name || rec.nodeKind || '未命名'}</div>
          <div>
            {TYPE_LABEL[rec.type]} · {rec.mime} · {fmtBytes(rec.bytes)}
            {rec.durationSec ? ` · ${rec.durationSec}s` : ''}
          </div>
          <div className="afs-avlightbox__sub">
            来源：{rec.role === 'uploaded' ? '本地上传' : `生成${rec.projectName ? `（${rec.projectName}）` : ''}`}
            {rec.nodeKind ? ` · 节点：${rec.nodeKind}` : ''}
          </div>
        </div>
      </div>
    </div>
  )
}

// ===================== 角色 / 场景 / 物品 Elements 库 =====================
const KIND_ICON: Record<ElementKind, typeof Users> = { character: Users, scene: Mountain, prop: Box }
const KIND_LABEL: Record<ElementKind, string> = { character: '角色', scene: '场景', prop: '物品' }

function ElementLibrary({ onInserted }: { onInserted: () => void }) {
  const elements = useAssetStore((s) => s.elements)
  const assets = useAssetStore((s) => s.assets)
  const loaded = useAssetStore((s) => s.loaded)
  const load = useAssetStore((s) => s.load)
  const saveElement = useAssetStore((s) => s.saveElement)
  const removeElement = useAssetStore((s) => s.removeElement)
  const insertElementNode = useGraphStore((s) => s.insertElementNode)

  const confirm = useConfirm()

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
  const onDeleteElement = async (el: ElementRef) => {
    if (await confirm({ title: '删除', message: `删除「${el.name}」？`, confirmLabel: '删除', danger: true })) removeElement(el.id)
  }

  return (
    <>
      <div className="afs-avtoolbar">
        <div className="afs-lib__hint">角色 / 场景 / 物品定义一次、跨工程复用（一致性底座）。「插入画布」生成绑定参考图的资产节点。</div>
        <span className="afs-avtoolbar__spacer" />
        <Button variant="secondary" size="sm" leadingIcon={Users} onClick={() => setEditing({ kind: 'character', name: '', refAssetIds: [] })}>
          新建角色
        </Button>
        <Button variant="secondary" size="sm" leadingIcon={Mountain} onClick={() => setEditing({ kind: 'scene', name: '', refAssetIds: [] })}>
          新建场景
        </Button>
        <Button variant="secondary" size="sm" leadingIcon={Box} onClick={() => setEditing({ kind: 'prop', name: '', refAssetIds: [] })}>
          新建物品
        </Button>
      </div>

      <div className="afs-avscroll">
        {elements.length === 0 ? (
          loaded ? (
            <EmptyState icon={Users} title="暂无角色 / 场景" description="新建，或在画布的人物 / 场景节点点「保存到库」。" />
          ) : (
            <div className="afs-avtiles" role="status" aria-label="加载中…">
              <Skeleton count={6} height={150} radius={12} />
            </div>
          )
        ) : (
          <div className="afs-avtiles">
            {elements.map((el) => {
              const Icon = KIND_ICON[el.kind]
              return (
                <div key={el.id} className="afs-avcard">
                  <div className="afs-avcard__thumb" onClick={() => onInsert(el)} title="插入到画布">
                    <RefThumb assetId={el.refAssetIds?.[0]} />
                    <span className="afs-avpill afs-avpill--type">
                      <Icon size={11} /> {KIND_LABEL[el.kind]}
                    </span>
                  </div>
                  <div className="afs-avcard__name" title={el.name}>
                    {el.name}
                  </div>
                  <div className="afs-avcard__meta">{el.description ? el.description.slice(0, 28) : '无描述'}</div>
                  <div className="afs-avcard__foot">
                    <Button variant="secondary" size="sm" leadingIcon={PlusSquare} onClick={() => onInsert(el)} title="插入到当前工程画布">
                      插入画布
                    </Button>
                    <IconButton size="sm" icon={<Brush size={13} />} aria-label="编辑" onClick={() => setEditing(el)} />
                    <IconButton
                      variant="danger"
                      size="sm"
                      className="afs-avcard__foot--push"
                      icon={<Trash2 size={13} />}
                      aria-label="删除"
                      onClick={() => onDeleteElement(el)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editing && (
        <ElementEditor
          editing={editing}
          setEditing={setEditing}
          imageAssets={imageAssets}
          onSave={onSave}
        />
      )}
    </>
  )
}

function ElementEditor({
  editing,
  setEditing,
  imageAssets,
  onSave,
}: {
  editing: Partial<ElementRef> & { kind: ElementKind }
  setEditing: (v: (Partial<ElementRef> & { kind: ElementKind }) | null) => void
  imageAssets: AssetRecord[]
  onSave: () => void
}) {
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) setEditing(null)
      }}
      title={`${editing.id ? '编辑' : '新建'}${KIND_LABEL[editing.kind]}`}
      size="sheet"
      footer={
        <>
          <Button variant="secondary" onClick={() => setEditing(null)}>
            取消
          </Button>
          <Button variant="gradient" leadingIcon={Plus} onClick={onSave}>
            保存
          </Button>
        </>
      }
    >
      <Field label="名称">
        <Input
          value={editing.name || ''}
          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          placeholder={editing.kind === 'character' ? '如：小明' : editing.kind === 'prop' ? '如：发光的剑' : '如：咖啡馆'}
        />
      </Field>
      <Field label={editing.kind === 'character' ? '外貌 / 设定' : editing.kind === 'prop' ? '外观 / 描述' : '环境 / 氛围'}>
        <Textarea rows={3} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
      </Field>
      <Field label="英文提示词（可选）">
        <Textarea rows={2} value={editing.prompt || ''} onChange={(e) => setEditing({ ...editing, prompt: e.target.value })} />
      </Field>
      {editing.kind === 'character' && (
        <>
          <Field label="身份特征（跨期不变 · 可选）">
            <Textarea
              rows={2}
              value={editing.identity || ''}
              onChange={(e) => setEditing({ ...editing, identity: e.target.value })}
              placeholder="脸型/五官/体型/标志记号(疤·痣·瞳色)，age-neutral；多时期角色填这里，各期外观放下方变体"
            />
          </Field>
          <Field label="时期 / 形态变体（少年→暮年 · 可选）">
            {(editing.appearanceVariants || []).map((v, i) => (
              <div key={i} className="afs-avvariant">
                <Input
                  placeholder="时期标签(如:少年)"
                  value={v.label || ''}
                  onChange={(e) => {
                    const vs = [...(editing.appearanceVariants || [])]
                    vs[i] = { ...vs[i], label: e.target.value, id: vs[i].id || e.target.value }
                    setEditing({ ...editing, appearanceVariants: vs })
                  }}
                />
                <Input
                  placeholder="该期外观（年龄/服饰/特征）"
                  value={v.appearance || ''}
                  onChange={(e) => {
                    const vs = [...(editing.appearanceVariants || [])]
                    vs[i] = { ...vs[i], appearance: e.target.value }
                    setEditing({ ...editing, appearanceVariants: vs })
                  }}
                />
                <IconButton
                  size="sm"
                  icon={<X size={13} />}
                  aria-label="删除该变体"
                  onClick={() => setEditing({ ...editing, appearanceVariants: (editing.appearanceVariants || []).filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={Plus}
              onClick={() => setEditing({ ...editing, appearanceVariants: [...(editing.appearanceVariants || []), { id: '', label: '' }] })}
            >
              添加时期变体
            </Button>
          </Field>
        </>
      )}
      <Field label="参考图（从图片素材选，可选）">
        {imageAssets.length === 0 ? (
          <div className="afs-avnote">暂无图片素材，可先在「素材」上传或生成</div>
        ) : (
          <div className="afs-avrefgrid">
            {imageAssets.map((a) => {
              const picked = (editing.refAssetIds || []).includes(a.assetId!)
              return (
                <button
                  key={a.id}
                  type="button"
                  className="afs-avreftile"
                  aria-pressed={picked}
                  onClick={() => setEditing({ ...editing, refAssetIds: picked ? [] : [a.assetId!] })}
                  title={a.name || a.assetId}
                >
                  <RefThumb assetId={a.assetId} />
                </button>
              )
            })}
          </div>
        )}
      </Field>
    </Modal>
  )
}
