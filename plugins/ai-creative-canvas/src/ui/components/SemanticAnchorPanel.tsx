import { useEffect, useState } from 'react'
import { Check, LockKeyhole, Plus, Tag, Trash2, X } from 'lucide-react'
import type { AssetRole, Card } from '../types'
import { useGraph } from '../store/graphStore'
import { toast } from '../store/toastStore'
import { confirmDialog } from '../store/dialogStore'
import {
  ASSET_ROLES,
  ASSET_ROLE_LABEL,
  anchorForSourceCard,
  pinnableMediaFromCard
} from '../services/semanticAssets'
import { suggestAssetAnchors } from '../services/referenceSuggestions'

function csv(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]
}

function defaultRole(card: Card): AssetRole {
  if (card.kind === 'audio') return 'voice'
  if (card.kind === 'text') return 'reference'
  return 'reference'
}

export function SemanticAnchorPanel({ card }: { card: Card }) {
  const project = useGraph((state) => state.project)
  const anchor = anchorForSourceCard(project, card.id)
  const eligible = card.kind === 'image' || card.kind === 'pano' || card.kind === 'source' || card.kind === 'text' || card.kind === 'audio'
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<AssetRole>(anchor?.role || defaultRole(card))
  const [name, setName] = useState(anchor?.name || (card.title.startsWith('AI ') || card.title === '素材' ? '' : card.title))
  const [aliases, setAliases] = useState((anchor?.aliases || []).join('，'))
  const [description, setDescription] = useState(anchor?.description || '')
  const [tags, setTags] = useState((anchor?.tags || []).join('，'))
  const hasPinnableMedia = !!pinnableMediaFromCard(card)
  const [locked, setLocked] = useState(anchor?.locked || (!anchor && hasPinnableMedia))

  if (!eligible) return null

  const resetAndOpen = () => {
    const current = anchorForSourceCard(useGraph.getState().project, card.id)
    setRole(current?.role || defaultRole(card))
    setName(current?.name || (card.title.startsWith('AI ') || card.title === '素材' ? '' : card.title))
    setAliases((current?.aliases || []).join('，'))
    setDescription(current?.description || '')
    setTags((current?.tags || []).join('，'))
    setLocked(current?.locked || (!current && !!pinnableMediaFromCard(card)))
    setOpen(true)
  }

  const save = () => {
    const nextName = name.trim()
    if (!nextName) {
      toast('请填写锚点名称', 'warning')
      return
    }
    const id = useGraph.getState().upsertAssetAnchor(card.id, {
      id: anchor?.id,
      role,
      name: nextName,
      aliases: csv(aliases),
      description: description.trim(),
      tags: csv(tags),
      locked: locked && hasPinnableMedia
    })
    if (!id) {
      toast('锚点保存失败', 'error')
      return
    }
    setOpen(false)
    toast(anchor ? '语义锚点已更新' : '已创建语义锚点', 'success')
  }

  const remove = async () => {
    if (!anchor) return
    const ok = await confirmDialog({
      title: '删除语义锚点',
      message: `删除“${anchor.name}”后，引用它的节点会解除稳定绑定，但不会删除源卡片。确定？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      danger: true
    })
    if (!ok) return
    useGraph.getState().removeAssetAnchor(anchor.id)
    setOpen(false)
    toast('语义锚点已删除', 'success')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={resetAndOpen}
        className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-[10px] ${anchor ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300' : 'opacity-55 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10'}`}
        title={anchor ? '编辑角色、场景、道具等语义身份' : '把当前节点登记为可复用的角色、场景或道具锚点'}
      >
        <Tag size={11} />
        {anchor ? `${ASSET_ROLE_LABEL[anchor.role]} · ${anchor.name}` : '设为语义锚点'}
        {anchor?.locked && <LockKeyhole size={10} />}
        {anchor?.mediaMissing && <span className="text-amber-600 dark:text-amber-300">资源缺失</span>}
      </button>
    )
  }

  return (
    <div className="rounded-lg border p-2 text-[11px] space-y-1.5" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="flex items-center gap-1.5">
        <Tag size={12} className="text-violet-500" />
        <span className="font-medium">语义锚点</span>
        <span className="opacity-45">一张卡片登记一个主要身份</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded p-0.5 opacity-50 hover:opacity-100"><X size={12} /></button>
      </div>
      <div className="grid grid-cols-[110px_1fr] gap-1.5">
        <select value={role} onChange={(event) => setRole(event.target.value as AssetRole)} className="ace-input py-1 text-[11px]">
          {ASSET_ROLES.map((value) => <option key={value} value={value}>{ASSET_ROLE_LABEL[value]}</option>)}
        </select>
        <input value={name} onChange={(event) => setName(event.target.value)} className="ace-input py-1 text-[11px]" placeholder="名称，例如：祖父、厨房、产品包装" />
      </div>
      <input value={aliases} onChange={(event) => setAliases(event.target.value)} className="ace-input py-1 text-[11px]" placeholder="别名，逗号分隔，例如：爷爷，外公" />
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="ace-input ace-noscroll resize-none text-[11px]" placeholder="稳定特征或用途，例如：白发、灰色针织衫、说话缓慢" />
      <input value={tags} onChange={(event) => setTags(event.target.value)} className="ace-input py-1 text-[11px]" placeholder="标签，逗号分隔" />
      <div className="flex items-center gap-2">
        <label className={`inline-flex items-center gap-1 ${hasPinnableMedia ? 'cursor-pointer' : 'opacity-45'}`} title={hasPinnableMedia ? '固定当前产物；源卡片以后重新生成不会改变该锚点' : '当前节点尚无可固定的媒体或文本产物'}>
          <input type="checkbox" checked={locked && hasPinnableMedia} disabled={!hasPinnableMedia} onChange={(event) => setLocked(event.target.checked)} />
          锁定当前产物
        </label>
        {!hasPinnableMedia && <span className="opacity-45">可先保存身份，产出内容后再锁定</span>}
        {anchor && <button type="button" onClick={() => void remove()} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-red-500 hover:bg-red-500/10"><Trash2 size={11} /> 删除</button>}
        <button type="button" onClick={save} className={`${anchor ? '' : 'ml-auto'} inline-flex items-center gap-1 rounded bg-violet-500 px-2 py-1 text-white hover:bg-violet-600`}>
          {anchor ? <Check size={11} /> : <Plus size={11} />} 保存
        </button>
      </div>
    </div>
  )
}

export function AnchorSuggestions({ card, contextText }: { card: Card; contextText: string }) {
  const project = useGraph((state) => state.project)
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const [suggestions, setSuggestions] = useState(() => suggestAssetAnchors(card, project, contextText))
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSuggestions(suggestAssetAnchors(card, project, contextText).filter((item) => !ignored.has(item.anchor.id)))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [card, project, contextText, ignored])
  if (!suggestions.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px]">
      <span className="shrink-0 opacity-50">建议引用：</span>
      {suggestions.map(({ anchor, material, reasons }) => (
        <span key={anchor.id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-violet-500/10 pl-1 pr-0.5 py-0.5 text-violet-700 dark:text-violet-200" title={reasons.join(' · ')}>
          {material.thumbUrl && <img src={material.thumbUrl} className="h-4 w-4 rounded-full object-cover" alt="" />}
          <span className="max-w-[130px] truncate">{ASSET_ROLE_LABEL[anchor.role]} · {anchor.name}</span>
          <span className="max-w-[100px] truncate opacity-55">{reasons[0]}</span>
          <button
            type="button"
            onClick={() => {
              const added = useGraph.getState().addAnchorReference(card.id, anchor.id)
              if (added) setSuggestions((current) => current.filter((item) => item.anchor.id !== anchor.id))
              toast(added ? `已引用${ASSET_ROLE_LABEL[anchor.role]}“${anchor.name}”` : '该锚点当前不可用', added ? 'success' : 'warning')
            }}
            className="rounded-full bg-violet-500 px-1.5 py-0.5 text-white hover:bg-violet-600"
          >
            引用
          </button>
          <button type="button" onClick={() => { setIgnored((current) => new Set(current).add(anchor.id)); setSuggestions((current) => current.filter((item) => item.anchor.id !== anchor.id)) }} title="本次忽略" className="rounded-full p-0.5 opacity-45 hover:opacity-100"><X size={9} /></button>
        </span>
      ))}
    </div>
  )
}
