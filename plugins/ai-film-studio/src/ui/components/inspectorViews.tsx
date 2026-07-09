import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, ChevronRight, ChevronDown, Pencil, BookmarkPlus } from 'lucide-react'
import { useGraphStore, type PortValue } from '../store/graphStore'
import { useAssetStore, type CanvasOutputViewRole, type ElementKind } from '../store/assetStore'
import type { Asset } from '../domain/types'
import { basename } from '../services/download'
import { useMediaUrl, useInView, hasMedia, type MediaRef } from '../services/mediaUrl'
import { useProjectStore } from '../store/projectStore'
import { useUiStore, type LightboxItem } from '../store/uiStore'
import { useAssetHubStore } from '../store/assetHubStore'
import type { LibraryEntity, LibraryEntityKind } from '../services/assetHub'
import { appendAdoptionRecord, purposeBeforeFromMeta } from '../services/assetHubAdoption'

const asStr = (x: unknown): string => (typeof x === 'string' ? x : '')

function openFolder(p?: string) {
  if (p) window.mulby?.shell?.showItemInFolder?.(p)
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const viewLabels: Record<CanvasOutputViewRole, string> = {
  primary: '主图',
  front: '正面图',
  side: '侧面图',
  back: '背面图',
  concept: '概念图',
  reference: '参考图',
}

function normalizeViewRole(value: unknown): CanvasOutputViewRole {
  if (value === 'front' || value === 'side' || value === 'back' || value === 'concept' || value === 'reference') return value
  return 'primary'
}

function metaKind(value: unknown): ElementKind | undefined {
  if (value === 'character' || value === 'scene' || value === 'prop') return value
  return undefined
}

type ProjectImageAsset = Asset & { type: 'role' | 'scene' | 'prop' }
type CanvasProjectSaveTarget = {
  key: string
  assetId: string
  variantId?: string
  label: string
  title: string
  assetType: ProjectImageAsset['type']
  aliases: string[]
  libraryEntityId?: string
  libraryVariantId?: string
}

type CanvasIdentitySaveTarget = {
  key: string
  entityId: string
  libraryVariantId?: string
  variantLabel?: string
  label: string
  title: string
  entityKind: LibraryEntityKind
  aliases: string[]
}

const projectAssetTypeLabels: Record<ProjectImageAsset['type'], string> = {
  role: '角色',
  scene: '场景',
  prop: '道具',
}

function projectTypeFromMetaKind(kind: ElementKind | undefined): ProjectImageAsset['type'] | undefined {
  if (kind === 'character') return 'role'
  if (kind === 'scene' || kind === 'prop') return kind
  return undefined
}

function isProjectImageAsset(asset: Asset): asset is ProjectImageAsset {
  return (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop') && !asset.parentAssetId
}

function uniqueEntities(items: LibraryEntity[]): LibraryEntity[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function entityKindMatches(kind: ElementKind | undefined, entityKind: LibraryEntityKind) {
  if (!kind) return entityKind !== 'voice'
  if (kind === 'character') return entityKind === 'character'
  return entityKind === kind
}

function resolveHintedLibraryEntity(entities: LibraryEntity[], value: PortValue): LibraryEntity | null {
  if (value.type !== 'image' || !value.assetId) return null
  const activeEntities = entities.filter((entity) => !entity.archived && entity.kind !== 'voice')
  const meta = rec(value.meta)
  const entityId = asStr(meta.libraryEntityId)
  const charId = asStr(meta.charId)
  const name = asStr(meta.name)
  const kind = metaKind(meta.kind)
  let matches = entityId ? activeEntities.filter((entity) => entity.id === entityId) : []
  if (!matches.length && (charId || name)) {
    matches = activeEntities.filter((entity) => {
      if (!entityKindMatches(kind, entity.kind)) return false
      const byCharId = charId && (entity.id === charId || entity.legacyElement?.charId === charId || entity.name === charId)
      const byName = name && (entity.name === name || entity.aliases?.includes(name))
      return !!byCharId || !!byName
    })
  }
  const unique = uniqueEntities(matches)
  return unique.length === 1 ? unique[0] : null
}

function targetViewTitle(target: CanvasIdentitySaveTarget, view: CanvasOutputViewRole): string {
  return `${target.title}的${viewLabels[view]}`
}

function addIdentityTarget(list: CanvasIdentitySaveTarget[], target: CanvasIdentitySaveTarget) {
  if (list.some((item) => item.key === target.key)) return
  list.push(target)
}

function buildIdentitySaveTargets(entities: LibraryEntity[], values: PortValue[]): CanvasIdentitySaveTarget[] {
  const targets: CanvasIdentitySaveTarget[] = []
  for (const entity of entities) {
    if (entity.archived || entity.kind === 'voice') continue
    const aliases = [entity.name, ...(entity.aliases ?? []), entity.id].filter(Boolean)
    addIdentityTarget(targets, {
      key: entity.id,
      entityId: entity.id,
      label: `身份 · ${entity.name}`,
      title: `保存到身份资产「${entity.name}」`,
      entityKind: entity.kind,
      aliases,
    })
    for (const variant of entity.variants ?? []) {
      addIdentityTarget(targets, {
        key: `${entity.id}::${variant.id}`,
        entityId: entity.id,
        libraryVariantId: variant.id,
        variantLabel: variant.label,
        label: `身份变体 · ${entity.name} / ${variant.label}`,
        title: `保存到身份资产「${entity.name}」的变体「${variant.label}」`,
        entityKind: entity.kind,
        aliases,
      })
    }
  }

  for (const value of values) {
    const entity = resolveHintedLibraryEntity(entities, value)
    if (!entity) continue
    const meta = rec(value.meta)
    const variantId = asStr(meta.libraryVariantId) || asStr(meta.variantId)
    if (!variantId) continue
    const variantLabel =
      asStr(meta.variantLabel) ||
      entity.variants?.find((variant) => variant.id === variantId)?.label ||
      variantId
    addIdentityTarget(targets, {
      key: `${entity.id}::${variantId}`,
      entityId: entity.id,
      libraryVariantId: variantId,
      variantLabel,
      label: `身份变体 · ${entity.name} / ${variantLabel}`,
      title: `保存到身份资产「${entity.name}」的变体「${variantLabel}」`,
      entityKind: entity.kind,
      aliases: [entity.name, ...(entity.aliases ?? []), entity.id].filter(Boolean),
    })
  }
  return targets
}

function resolveIdentitySaveTargetKey(targets: CanvasIdentitySaveTarget[], entities: LibraryEntity[], value: PortValue | undefined): string {
  if (!value || value.type !== 'image') return ''
  const entity = resolveHintedLibraryEntity(entities, value)
  if (!entity) return ''
  const meta = rec(value.meta)
  const variantId = asStr(meta.libraryVariantId) || asStr(meta.variantId)
  const key = variantId ? `${entity.id}::${variantId}` : entity.id
  return targets.some((target) => target.key === key) ? key : ''
}

function buildProjectSaveTargets(assets: Asset[] | undefined): CanvasProjectSaveTarget[] {
  return (assets ?? []).filter(isProjectImageAsset).flatMap((asset) => {
    const libraryEntityId = asset.libraryLink?.entityId || asset.elementId
    const aliases = [asset.name, ...(asset.aliases ?? []), asset.id, ...(libraryEntityId ? [libraryEntityId] : [])].filter(Boolean)
    const base: CanvasProjectSaveTarget = {
      key: asset.id,
      assetId: asset.id,
      label: `项目主图 · ${asset.name}`,
      title: `保存到${projectAssetTypeLabels[asset.type]}项目资产「${asset.name}」主图`,
      assetType: asset.type,
      aliases,
      libraryEntityId,
    }
    const variants: CanvasProjectSaveTarget[] = (asset.variants ?? []).map((variant) => ({
      key: `${asset.id}::${variant.id}`,
      assetId: asset.id,
      variantId: variant.id,
      label: `项目变体 · ${asset.name} / ${variant.label}`,
      title: `保存到${projectAssetTypeLabels[asset.type]}项目资产「${asset.name}」的变体「${variant.label}」`,
      assetType: asset.type,
      aliases,
      libraryEntityId,
      libraryVariantId: variant.libraryVariantId,
    }))
    return [base, ...variants]
  })
}

function uniqueTargetKey(targets: CanvasProjectSaveTarget[]): string {
  const keys = new Set(targets.map((target) => target.key))
  return keys.size === 1 ? targets[0]?.key || '' : ''
}

function resolveProjectSaveTargetKey(targets: CanvasProjectSaveTarget[], value: PortValue | undefined): string {
  if (!value || value.type !== 'image') return ''
  const meta = rec(value.meta)
  const projectAssetId = asStr(meta.projectAssetId)
  const projectVariantId = asStr(meta.projectVariantId)
  if (projectAssetId) {
    const exactKey = projectVariantId ? `${projectAssetId}::${projectVariantId}` : projectAssetId
    if (targets.some((target) => target.key === exactKey)) return exactKey
  }

  const libraryEntityId = asStr(meta.libraryEntityId)
  const libraryVariantId = asStr(meta.libraryVariantId) || asStr(meta.variantId)
  if (libraryEntityId && libraryVariantId) {
    const variantMatch = uniqueTargetKey(
      targets.filter((target) => target.libraryEntityId === libraryEntityId && target.libraryVariantId === libraryVariantId)
    )
    if (variantMatch) return variantMatch
  }
  if (libraryEntityId) {
    const entityMatch = uniqueTargetKey(
      targets.filter((target) => target.libraryEntityId === libraryEntityId && (!libraryVariantId || !target.variantId))
    )
    if (entityMatch) return entityMatch
  }

  const kind = projectTypeFromMetaKind(metaKind(meta.kind))
  const charId = asStr(meta.charId)
  const name = asStr(meta.name)
  if (!charId && !name) return ''
  return uniqueTargetKey(
    targets.filter((target) => {
      if (kind && target.assetType !== kind) return false
      return target.aliases.includes(charId) || target.aliases.includes(name)
    })
  )
}

function firstImageOutput(value: PortValue): PortValue | undefined {
  if (value.items?.length) return value.items.find((item) => item.type === 'image' && hasMedia(item))
  return value.type === 'image' && hasMedia(value) ? value : undefined
}

function mediaOutputsForValue(value: PortValue): PortValue[] | null {
  if (value.items?.length) return value.items.filter((it) => hasMedia(it))
  if ((value.type === 'image' || value.type === 'video' || value.type === 'audio') && hasMedia(value)) return [value]
  return null
}

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
type MediaTileAction = { label: string; title?: string; disabled?: boolean; onClick: () => void }

function MediaTile({
  v,
  onClick,
  action,
  actions,
}: {
  v: PortValue
  onClick?: () => void
  action?: MediaTileAction
  actions?: MediaTileAction[]
}) {
  const name = typeof v.meta?.name === 'string' ? v.meta.name : typeof v.meta?.shot === 'string' ? v.meta.shot : ''
  const [inViewRef, inView] = useInView<HTMLDivElement>('400px')
  // 视频惰性挂载（离屏不解析 blob/不挂 <video>）；图/音频随挂随解析
  const lazy = v.type === 'video'
  const url = useMediaUrl(!lazy || inView ? v : null)
  const tileActions = actions ?? (action ? [action] : [])
  return (
    <div className="afs-tile" ref={inViewRef}>
      {!url ? (
        <div className="afs-tile__media" />
      ) : v.type === 'video' ? (
        <video className="afs-tile__media" src={url} controls preload="metadata" />
      ) : v.type === 'audio' ? (
        <audio className="afs-tile__audio" src={url} controls />
      ) : (
        <img
          className={`afs-tile__media${onClick ? ' afs-tile__media--click' : ''}`}
          src={url}
          alt={name}
          onClick={onClick}
          title={onClick ? '点击查看大图 / 对话修改' : undefined}
        />
      )}
      {(name || v.localPath || tileActions.length) && (
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
          {tileActions.length ? (
            <span className="afs-tile__actions">
              {tileActions.map((item) => (
                <button
                  key={item.label}
                  className="afs-tile__save"
                  disabled={item.disabled}
                  title={item.title}
                  onClick={(e) => {
                    e.stopPropagation()
                    item.onClick()
                  }}
                >
                  <BookmarkPlus size={11} />
                  <span>{item.label}</span>
                </button>
              ))}
            </span>
          ) : null}
        </div>
      )}
    </div>
  )
}

// 大图灯箱 + 对话改图 + 重新生成（操作期间保持打开并显示 loading，完成后大图自动刷新）
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
  nodeId,
  port,
  title,
  nodePrompt,
  onEditText,
}: {
  value: PortValue
  nodeId?: string
  port?: string
  title?: string
  nodePrompt?: string
  onEditText?: (text: string) => string | null
}) {
  const openLightbox = useUiStore((s) => s.openLightbox)
  const hubLoaded = useAssetHubStore((s) => s.loaded)
  const hubEntities = useAssetHubStore((s) => s.entities)
  const refreshAssetHub = useAssetHubStore((s) => s.refresh)
  const assetStoreLoaded = useAssetStore((s) => s.loaded)
  const loadAssetStore = useAssetStore((s) => s.load)
  const promoteCanvasOutputs = useAssetStore((s) => s.promoteCanvasOutputs)
  const projectDoc = useProjectStore((s) => s.doc)
  const promoteCanvasImageToProjectAsset = useProjectStore((s) => s.promoteCanvasImageToProjectAsset)
  const markOutputAsProjectAsset = useGraphStore((s) => s.markOutputAsProjectAsset)
  const markOutputAsLibraryEntity = useGraphStore((s) => s.markOutputAsLibraryEntity)
  const canvasProjectId = useGraphStore((s) => s.currentId)
  const canvasProjectName = useGraphStore((s) => s.projectName)
  const mediaList = useMemo(() => mediaOutputsForValue(value), [value])
  const imageMediaList = useMemo(() => (mediaList ?? []).filter((it) => it.type === 'image' && !!it.assetId), [mediaList])
  const identitySaveTargets = useMemo(() => buildIdentitySaveTargets(hubEntities, imageMediaList), [hubEntities, imageMediaList])
  const hintedIdentityTargetKey = useMemo(
    () => resolveIdentitySaveTargetKey(identitySaveTargets, hubEntities, firstImageOutput(value)),
    [hubEntities, identitySaveTargets, value]
  )
  const projectSaveTargets = useMemo(() => buildProjectSaveTargets(projectDoc?.assets), [projectDoc?.assets])
  const hintedProjectTargetKey = useMemo(
    () => resolveProjectSaveTargetKey(projectSaveTargets, firstImageOutput(value)),
    [projectSaveTargets, value]
  )
  const projectChoiceScope = `${nodeId || ''}:${port || ''}`
  const identityChoiceScope = `${nodeId || ''}:${port || ''}`
  const [identityTargetChoice, setIdentityTargetChoice] = useState<{ scope: string; key: string | null }>({ scope: '', key: null })
  const [projectTargetChoice, setProjectTargetChoice] = useState<{ scope: string; key: string | null }>({ scope: '', key: null })
  const explicitIdentityTargetKey =
    identityTargetChoice.scope === identityChoiceScope &&
    (identityTargetChoice.key === '' || identitySaveTargets.some((target) => target.key === identityTargetChoice.key))
      ? identityTargetChoice.key
      : null
  const selectedIdentityTargetKey =
    explicitIdentityTargetKey ?? (hintedIdentityTargetKey || (identitySaveTargets.length === 1 ? identitySaveTargets[0].key : ''))
  const selectedIdentityTarget = identitySaveTargets.find((target) => target.key === selectedIdentityTargetKey)
  const explicitProjectTargetKey =
    projectTargetChoice.scope === projectChoiceScope &&
    (projectTargetChoice.key === '' || projectSaveTargets.some((target) => target.key === projectTargetChoice.key))
      ? projectTargetChoice.key
      : null
  const selectedProjectTargetKey =
    explicitProjectTargetKey ?? (hintedProjectTargetKey || (projectSaveTargets.length === 1 ? projectSaveTargets[0].key : ''))
  const selectedProjectTarget = projectSaveTargets.find((target) => target.key === selectedProjectTargetKey)
  useEffect(() => {
    if (!hubLoaded) void refreshAssetHub()
  }, [hubLoaded, refreshAssetHub])

  if (value.type === 'json' || value.type === 'text' || (!value.items && value.text && !value.url)) {
    return <EditableValue value={value} onEditText={onEditText} />
  }

  const rawItems = value.items && value.items.length ? value.items : null

  if (mediaList) {
    if (mediaList.length === 0) return <div className="afs-inspector__note">（暂无可显示内容）</div>
    // 统一灯箱：图/视频点开即与节点预览同一窗口（看大图 / 对话改图 / 重新生成 / 标题·提示词等元信息）
    const lbItems: LightboxItem[] = mediaList
      .filter((it) => it.type === 'image' || it.type === 'video')
      .map((it) => ({
        ref: it as MediaRef,
        type: it.type as 'image' | 'video',
        nodeId,
        port,
        index: rawItems ? rawItems.indexOf(it) : 0, // 全量 items 下标，正是 edit/regen 所需
        title,
        meta: it.meta,
        prompt: asStr(it.meta?.prompt) || asStr(it.meta?.description) || nodePrompt,
      }))
    const openAt = (it: PortValue) => {
      const i = lbItems.findIndex((x) => x.ref === (it as MediaRef))
      if (i >= 0) openLightbox(lbItems, i)
    }
    const saveToIdentity = async (it: PortValue, itemIndex?: number) => {
      if (!selectedIdentityTarget || !it.assetId) {
        window.mulby?.notification?.show('请先选择要写入的身份资产或身份变体', 'warning')
        return
      }
      const view = normalizeViewRole(it.meta?.view)
      if (!assetStoreLoaded) await loadAssetStore()
      const count = await promoteCanvasOutputs([{ assetId: it.assetId, meta: it.meta }], {
        kind: 'libraryEntity',
        entityId: selectedIdentityTarget.entityId,
        libraryVariantId: selectedIdentityTarget.libraryVariantId,
        variantLabel: selectedIdentityTarget.variantLabel,
        view,
      })
      if (count > 0) {
        if (nodeId && port) {
          await markOutputAsLibraryEntity(
            nodeId,
            port,
            it.assetId,
            {
              libraryEntityId: selectedIdentityTarget.entityId,
              libraryVariantId: selectedIdentityTarget.libraryVariantId,
              variantLabel: selectedIdentityTarget.variantLabel,
              view,
            },
            itemIndex
          )
        }
        const entity = hubEntities.find((item) => item.id === selectedIdentityTarget.entityId)
        const existingPrimary = selectedIdentityTarget.libraryVariantId
          ? entity?.variants?.find((variant) => variant.id === selectedIdentityTarget.libraryVariantId)?.mediaRefs?.some((ref) => !!ref.assetId)
          : entity?.mediaRefs?.some((ref) => !!ref.assetId)
        await appendAdoptionRecord({
          sourceSurface: 'canvas',
          sourceProjectId: canvasProjectId || undefined,
          sourceProjectName: canvasProjectName || undefined,
          sourceNodeId: nodeId,
          sourceNodeTitle: title,
          sourcePort: port,
          sourceItemIndex: itemIndex,
          mediaAssetId: it.assetId,
          localPath: typeof it.localPath === 'string' ? it.localPath : undefined,
          url: typeof it.url === 'string' ? it.url : undefined,
          prompt: asStr(it.meta?.prompt) || asStr(it.meta?.description) || nodePrompt || undefined,
          model: asStr(it.meta?.model) || undefined,
          purposeBefore: purposeBeforeFromMeta(it.meta),
          target: {
            kind: 'libraryEntity',
            entityId: selectedIdentityTarget.entityId,
            libraryVariantId: selectedIdentityTarget.libraryVariantId,
            view,
          },
          action: existingPrimary ? 'overwrite' : 'save',
        })
        await refreshAssetHub()
      }
      window.mulby?.notification?.show(
        count > 0 ? `已${targetViewTitle(selectedIdentityTarget, view)}` : '没有可保存的画布输出',
        count > 0 ? 'success' : 'warning'
      )
    }
    const saveToProjectAsset = async (it: PortValue, itemIndex?: number) => {
      if (!it.assetId || !selectedProjectTarget) {
        window.mulby?.notification?.show('请先选择要写入的项目资产或项目变体', 'warning')
        return
      }
      const projectAsset = projectDoc?.assets?.find((asset) => asset.id === selectedProjectTarget.assetId)
      const existingRef = selectedProjectTarget.variantId
        ? projectAsset?.variants?.find((variant) => variant.id === selectedProjectTarget.variantId)?.refImageId
        : projectAsset?.refImageId
      const changed = promoteCanvasImageToProjectAsset({
        assetId: selectedProjectTarget.assetId,
        variantId: selectedProjectTarget.variantId,
        refImageId: it.assetId,
      })
      if (changed) {
        if (nodeId && port) {
          await markOutputAsProjectAsset(
            nodeId,
            port,
            it.assetId,
            {
              projectId: projectDoc?.meta.id,
              projectAssetId: selectedProjectTarget.assetId,
              projectVariantId: selectedProjectTarget.variantId,
              libraryEntityId: selectedProjectTarget.libraryEntityId,
              libraryVariantId: selectedProjectTarget.libraryVariantId,
            },
            itemIndex
          )
        }
        if (projectDoc?.meta.id) {
          await appendAdoptionRecord({
            sourceSurface: 'canvas',
            sourceProjectId: canvasProjectId || undefined,
            sourceProjectName: canvasProjectName || undefined,
            sourceNodeId: nodeId,
            sourceNodeTitle: title,
            sourcePort: port,
            sourceItemIndex: itemIndex,
            mediaAssetId: it.assetId,
            localPath: typeof it.localPath === 'string' ? it.localPath : undefined,
            url: typeof it.url === 'string' ? it.url : undefined,
            prompt: asStr(it.meta?.prompt) || asStr(it.meta?.description) || nodePrompt || undefined,
            model: asStr(it.meta?.model) || undefined,
            purposeBefore: purposeBeforeFromMeta(it.meta),
            target: {
              kind: 'projectAsset',
              projectId: projectDoc.meta.id,
              assetId: selectedProjectTarget.assetId,
              variantId: selectedProjectTarget.variantId,
              libraryEntityId: selectedProjectTarget.libraryEntityId,
              libraryVariantId: selectedProjectTarget.libraryVariantId,
            },
            action: existingRef ? 'overwrite' : 'save',
          })
        }
        await refreshAssetHub()
      }
      window.mulby?.notification?.show(
        changed ? `已保存到${selectedProjectTarget.label}` : '未找到可写入的项目资产目标',
        changed ? 'success' : 'warning'
      )
    }
    const canSaveImageToIdentity = imageMediaList.length > 0 && identitySaveTargets.length > 0
    const canSaveImageToProject = mediaList.some((it) => it.type === 'image' && !!it.assetId) && projectSaveTargets.length > 0
    return (
      <div>
        {rawItems ? <div className="afs-gallery__count">{mediaList.length} 项</div> : null}
        {canSaveImageToIdentity ? (
          <div className="afs-gallery__toolbar">
            <span className="afs-gallery__toolbar-label">保存到身份资产</span>
            <select
              className="afs-gallery__target"
              value={selectedIdentityTargetKey}
              onChange={(e) => setIdentityTargetChoice({ scope: identityChoiceScope, key: e.target.value })}
            >
              <option value="">选择身份资产/变体</option>
              {identitySaveTargets.map((target) => (
                <option key={target.key} value={target.key}>
                  {target.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {canSaveImageToProject ? (
          <div className="afs-gallery__toolbar">
            <span className="afs-gallery__toolbar-label">保存到项目</span>
            <select
              className="afs-gallery__target"
              value={selectedProjectTargetKey}
              onChange={(e) => setProjectTargetChoice({ scope: projectChoiceScope, key: e.target.value })}
            >
              <option value="">选择项目资产/变体</option>
              {projectSaveTargets.map((target) => (
                <option key={target.key} value={target.key}>
                  {target.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="afs-gallery">
          {mediaList.map((it, i) => {
            const itemIndex = rawItems ? rawItems.indexOf(it) : undefined
            const actions: MediaTileAction[] = []
            if (it.type === 'image' && identitySaveTargets.length) {
              const view = normalizeViewRole(it.meta?.view)
              actions.push({
                label: '存身份',
                title: selectedIdentityTarget ? targetViewTitle(selectedIdentityTarget, view) : '先选择要写入的身份资产或身份变体',
                disabled: !selectedIdentityTarget || !it.assetId,
                onClick: () => void saveToIdentity(it, itemIndex),
              })
            }
            if (it.type === 'image' && projectSaveTargets.length) {
              actions.push({
                label: '存项目',
                title: selectedProjectTarget?.title || '先选择要写入的项目资产或项目变体',
                disabled: !selectedProjectTarget || !it.assetId,
                onClick: () => void saveToProjectAsset(it, itemIndex),
              })
            }
            return (
              <MediaTile
                key={it.assetId || it.url || `item-${i}`}
                v={it}
                onClick={it.type === 'image' || it.type === 'video' ? () => openAt(it) : undefined}
                actions={actions}
              />
            )
          })}
        </div>
      </div>
    )
  }
  return <div className="afs-inspector__note">（无内容）</div>
}

/** 输入区缩略图：经 useMediaUrl 解析（去 hydration 后输入项可能只有 assetId） */
function InThumb({ refv }: { refv: MediaRef }) {
  const url = useMediaUrl(refv)
  return url ? <img className="afs-inthumb" src={url} alt="" /> : <span className="afs-inthumb afs-inthumb--ph" />
}

// 输入端口的紧凑摘要（输入区用）
export function InputSummary({ value }: { value: PortValue }) {
  if (value.items && value.items.length) {
    const first = value.items[0]
    if (first?.type === 'image' && hasMedia(first)) {
      return (
        <span className="afs-inmini">
          <InThumb refv={first} /> ×{value.items.length}
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
  if (value.type === 'image' && hasMedia(value)) return <InThumb refv={value} />
  if (value.type === 'video') return <span className="afs-inmini">视频</span>
  if (value.type === 'audio') return <span className="afs-inmini">音频</span>
  if (value.text) return <span className="afs-inmini">{value.text.slice(0, 40)}</span>
  return <span className="afs-inspector__note">空</span>
}
