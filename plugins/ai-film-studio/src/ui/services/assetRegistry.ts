/**
 * 素材注册表（全局，跨工程）：为「素材库」提供可检索的多模态素材索引，并修复附件存储泄漏。
 *
 * 现状问题（见 docs/ai-film-studio-workbench-redesign.md §1.3）：素材只散落在节点 outputs 里、
 * 无索引；deleteAsset 从未被调用 → storage.attachment 只写不删、无界泄漏。
 *
 * 本模块：
 * - 维护 `assets:registry`（AssetRecord[]）作为素材索引（图片/视频/音频 多模态）。
 * - backfill：扫描所有工程节点 outputs，把已有生成素材登记进来（幂等）。
 * - 上传入库：图片/音频走 attachment，视频走 filesystem（可能 >50MB）。
 * - GC：用 attachment.list() 全量 ∖（工程引用 ∪ Elements 引用 ∪ 上传素材）→ 删除孤儿，回收泄漏。
 *
 * 仅读 KV/attachment/filesystem 这些已确认存在的宿主 API；不改 PortValue/executor 语义。
 */
import { nanoid } from 'nanoid'
import { loadAssetUrl, deleteAsset, saveAsset, isEphemeralUrl } from './assets'
import { writeBase64, toFileUrl } from './fsutil'

const PLUGIN_ID = 'ai-film-studio'
const KEY_REGISTRY = 'assets:registry'
const KEY_BOARDS = 'assets:boards'
const KEY_INDEX = 'projects:index'
const KEY_ELEMENTS = 'elements:library'
const KEY_SNAPSHOTS = 'snapshots'
const projectKey = (id: string) => `project:${id}`

export type AssetType = 'image' | 'video' | 'audio'
export type AssetRole = 'generated' | 'uploaded'

export interface AssetRecord {
  id: string
  type: AssetType
  mime: string
  name?: string
  tags?: string[]
  role: AssetRole
  // 二进制位置（三选一）：assetId=附件库；localPath=文件系统；url=远程
  assetId?: string
  localPath?: string
  url?: string
  durationSec?: number
  bytes?: number
  // 来源（generated）
  projectId?: string
  projectName?: string
  nodeKind?: string
  /** 所属合集（Board）；未分组为 undefined */
  boardId?: string
  createdAt: number
}

/** 素材合集（Board，InvokeAI 式）：把素材分组归置 */
export interface Board {
  id: string
  name: string
  createdAt: number
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}
async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, PLUGIN_ID)
  } catch {
    // 忽略
  }
}

export function typeFromMime(mime?: string): AssetType {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('video')) return 'video'
  if (m.startsWith('audio')) return 'audio'
  return 'image'
}

export async function loadRegistry(): Promise<AssetRecord[]> {
  const v = await kvGet<AssetRecord[]>(KEY_REGISTRY)
  return Array.isArray(v) ? v : []
}
async function saveRegistry(list: AssetRecord[]): Promise<void> {
  await kvSet(KEY_REGISTRY, list)
}

// ===== 合集（Boards）=====
export async function loadBoards(): Promise<Board[]> {
  const v = await kvGet<Board[]>(KEY_BOARDS)
  return Array.isArray(v) ? v : []
}
async function saveBoards(list: Board[]): Promise<void> {
  await kvSet(KEY_BOARDS, list)
}
export async function createBoard(name: string): Promise<Board> {
  const b: Board = { id: `bd_${nanoid(6)}`, name: name.trim() || '未命名合集', createdAt: Date.now() }
  const list = await loadBoards()
  list.push(b)
  await saveBoards(list)
  return b
}
export async function renameBoard(id: string, name: string): Promise<void> {
  const list = await loadBoards()
  const i = list.findIndex((b) => b.id === id)
  if (i < 0) return
  list[i] = { ...list[i], name: name.trim() || list[i].name }
  await saveBoards(list)
}
export async function deleteBoard(id: string): Promise<void> {
  await saveBoards((await loadBoards()).filter((b) => b.id !== id))
  // 解绑该合集下的素材（不删素材，仅归为未分组）
  const reg = await loadRegistry()
  let changed = false
  for (const r of reg)
    if (r.boardId === id) {
      r.boardId = undefined
      changed = true
    }
  if (changed) await saveRegistry(reg)
}
export async function setAssetBoard(assetRecordId: string, boardId?: string): Promise<void> {
  const reg = await loadRegistry()
  const r = reg.find((x) => x.id === assetRecordId)
  if (!r) return
  r.boardId = boardId
  await saveRegistry(reg)
}

/** 去重键：附件 id / 本地路径 / 远程 url */
function refKey(r: { assetId?: string; localPath?: string; url?: string }): string {
  return r.assetId || r.localPath || (r.url && !isEphemeralUrl(r.url) ? r.url : '') || ''
}

/**
 * 解析素材为可显示 URL（附件→blob:；文件→file://；远程→原样）。
 * 注意：附件分支经 assets.ts 字节缓存返回 blob:，其生命周期由该缓存拥有，调用方不可 revoke。
 * React 组件请用 useMediaUrl（M6）而非直接调本函数。
 */
export async function resolveAssetUrl(rec: Pick<AssetRecord, 'assetId' | 'localPath' | 'url'>): Promise<string> {
  if (rec.assetId) {
    const url = await loadAssetUrl(rec.assetId)
    if (url) return url
  }
  if (rec.localPath) return toFileUrl(rec.localPath)
  if (rec.url) return rec.url
  return ''
}

// ===== 遍历工程节点 outputs（含扇出 items）=====
interface PV {
  type?: string
  assetId?: string
  url?: string
  localPath?: string
  mime?: string
  durationSec?: number
  items?: PV[]
  meta?: Record<string, unknown>
}
interface ProjNode {
  data?: { kind?: string; outputs?: Record<string, PV> }
}
function* eachPortValue(nodes: ProjNode[]): Generator<{ pv: PV; nodeKind: string }> {
  for (const n of nodes || []) {
    const outs = n?.data?.outputs
    if (!outs) continue
    const nodeKind = n?.data?.kind || ''
    for (const v of Object.values(outs)) {
      if (!v) continue
      const list = v.items && v.items.length ? v.items : [v]
      for (const it of list) if (it) yield { pv: it, nodeKind }
    }
  }
}

async function listProjects(): Promise<{ id: string; name: string; nodes: ProjNode[] }[]> {
  const index = (await kvGet<{ id: string; name: string }[]>(KEY_INDEX)) || []
  const out: { id: string; name: string; nodes: ProjNode[] }[] = []
  for (const meta of index) {
    const p = await kvGet<{ nodes?: ProjNode[] }>(projectKey(meta.id))
    if (p) out.push({ id: meta.id, name: meta.name, nodes: p.nodes || [] })
  }
  return out
}

/** 从所有工程节点 outputs 回填生成素材（幂等：按 refKey 去重） */
export async function backfillFromProjects(): Promise<AssetRecord[]> {
  const registry = await loadRegistry()
  const seen = new Set(registry.map(refKey).filter(Boolean))
  const projects = await listProjects()
  let changed = false
  for (const proj of projects) {
    for (const { pv, nodeKind } of eachPortValue(proj.nodes)) {
      const t = pv.type
      if (t !== 'image' && t !== 'video' && t !== 'audio') continue
      const key = refKey(pv)
      if (!key || seen.has(key)) continue
      seen.add(key)
      registry.push({
        id: `ar_${nanoid(8)}`,
        type: t,
        mime: pv.mime || (t === 'image' ? 'image/png' : t === 'video' ? 'video/mp4' : 'audio/mpeg'),
        role: 'generated',
        assetId: pv.assetId,
        localPath: pv.localPath,
        url: pv.url && !isEphemeralUrl(pv.url) ? pv.url : undefined,
        durationSec: pv.durationSec,
        name: typeof pv.meta?.name === 'string' ? (pv.meta.name as string) : undefined,
        projectId: proj.id,
        projectName: proj.name,
        nodeKind,
        createdAt: Date.now(),
      })
      changed = true
    }
  }
  if (changed) await saveRegistry(registry)
  return registry
}

/** 上传入库：图片/音频走附件库，视频走文件系统（可能 >50MB） */
export async function importAssetFile(input: { name: string; mime: string; base64: string }): Promise<AssetRecord> {
  const type = typeFromMime(input.mime)
  const bytes = Math.floor((input.base64.length * 3) / 4)
  const rec: AssetRecord = {
    id: `ar_${nanoid(8)}`,
    type,
    mime: input.mime,
    role: 'uploaded',
    name: input.name,
    bytes,
    createdAt: Date.now(),
  }
  if (type === 'video') {
    const ext = (input.mime.split('/')[1] || 'mp4').split(';')[0]
    rec.localPath = await writeBase64('library', `up_${rec.id}`, ext, input.base64)
  } else {
    rec.assetId = await saveAsset(input.base64, input.mime)
  }
  const registry = await loadRegistry()
  registry.push(rec)
  await saveRegistry(registry)
  return rec
}

/** 删除一条素材记录及其二进制（仅用于「上传」素材；生成素材的回收走 GC，避免误删在用产物） */
export async function removeAssetRecord(id: string): Promise<void> {
  const registry = await loadRegistry()
  const rec = registry.find((r) => r.id === id)
  if (!rec) return
  if (rec.assetId) await deleteAsset(rec.assetId)
  if (rec.localPath) {
    try {
      await window.mulby?.filesystem?.unlink(rec.localPath)
    } catch {
      // 文件可能已不存在，忽略
    }
  }
  await saveRegistry(registry.filter((r) => r.id !== id))
}

/** 附件库占用统计 */
export async function storageUsage(): Promise<{ count: number; bytes: number }> {
  try {
    const all = await window.mulby?.storage?.attachment?.list?.()
    if (!all) return { count: 0, bytes: 0 }
    return { count: all.length, bytes: all.reduce((a, x) => a + (x.size || 0), 0) }
  } catch {
    return { count: 0, bytes: 0 }
  }
}

/** 收集仍被引用的附件 assetId（工程节点 ∪ Elements 参考图 ∪ 上传素材根） */
async function collectReferenced(): Promise<Set<string>> {
  const referenced = new Set<string>()
  for (const proj of await listProjects()) {
    for (const { pv } of eachPortValue(proj.nodes)) if (pv.assetId) referenced.add(pv.assetId)
  }
  const elements = (await kvGet<{ refAssetIds?: string[] }[]>(KEY_ELEMENTS)) || []
  for (const el of elements) for (const aid of el.refAssetIds || []) referenced.add(aid)
  // 工程快照里引用的素材也要保护（避免回滚后图丢失）
  const snapshots = (await kvGet<{ nodes?: ProjNode[] }[]>(KEY_SNAPSHOTS)) || []
  for (const snap of snapshots) for (const { pv } of eachPortValue(snap.nodes || [])) if (pv.assetId) referenced.add(pv.assetId)
  // 上传到库的素材即使尚未上画布，也由注册表「根引用」保护
  for (const r of await loadRegistry()) if (r.role === 'uploaded' && r.assetId) referenced.add(r.assetId)
  return referenced
}

/** 清理未引用素材（标记-清除）：删除附件库里不再被任何工程/Elements/上传引用的孤儿，修复历史泄漏 */
export async function gcOrphans(): Promise<{ removed: number; freedBytes: number; removedIds: string[] }> {
  const att = window.mulby?.storage?.attachment
  if (!att?.list) return { removed: 0, freedBytes: 0, removedIds: [] }
  const all = await att.list()
  const referenced = await collectReferenced()
  let removed = 0
  let freedBytes = 0
  const removedIds = new Set<string>()
  for (const item of all) {
    if (referenced.has(item.id)) continue
    try {
      await att.remove(item.id)
      removed++
      freedBytes += item.size || 0
      removedIds.add(item.id)
    } catch {
      // 忽略单个失败
    }
  }
  if (removedIds.size) {
    const registry = await loadRegistry()
    await saveRegistry(registry.filter((r) => !(r.assetId && removedIds.has(r.assetId))))
  }
  // 返回 removedIds：调用方（assetStore.runGc）据此 releaseAsset，revoke 这些孤儿的 blob/字节缓存
  return { removed, freedBytes, removedIds: [...removedIds] }
}
