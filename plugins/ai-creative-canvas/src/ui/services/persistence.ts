import type { Board, ProjectDoc } from '../types'
import { SCHEMA_VERSION } from '../types'

export const PLUGIN_ID = 'ai-creative-canvas'
// 旧版单工程键（仅用于一次性迁移到多工程命名空间）
const LEGACY_CURRENT = 'project:current'
const LEGACY_BOARD_PREFIX = 'project:board:'
// 多工程：注册表 + 每工程命名空间分片
const KEY_REGISTRY = 'projects:index'
const kCurrent = (pid: string) => `proj:${pid}:current`
const kBoard = (pid: string) => `proj:${pid}:board:`
const kRecovery = (pid: string) => `proj:${pid}:recovery`
const kRecBoard = (pid: string) => `proj:${pid}:rec:board:`

function storage() {
  return (window as any).mulby?.storage
}

// ── 分片持久化：manifest(去重 cards/edges/annotations) + 每画布一个分片 ──
// 增量：仅重写「引用变化」的画布分片（依赖 store 不可变更新——未改画布保持同引用）。
// 顺序：先写分片、后写 manifest——manifest 只指向已落盘的分片，崩溃时不至于指向半截数据。
type HeavyShard = { cards: Board['cards']; edges: Board['edges']; annotations: Board['annotations'] }
function lightBoard(b: Board): Board {
  return { ...b, cards: {}, edges: {}, annotations: [] }
}

async function writeSharded(
  p: ProjectDoc,
  manifestKey: string,
  prefix: string,
  baseline: Map<string, Board>,
  extra?: Record<string, unknown>
): Promise<Map<string, Board>> {
  const s = storage()
  if (!s) return baseline
  const next = new Map<string, Board>()
  // 写改动画布的分片
  for (const b of p.boards) {
    next.set(b.id, b)
    if (baseline.get(b.id) !== b) {
      const shard: HeavyShard = { cards: b.cards, edges: b.edges, annotations: b.annotations ?? [] }
      await s.set(prefix + b.id, shard, PLUGIN_ID)
    }
  }
  // 删除已移除画布的孤儿分片
  for (const id of baseline.keys()) {
    if (!next.has(id)) {
      if (s.delete) await s.delete(prefix + id, PLUGIN_ID)
      else await s.set(prefix + id, null, PLUGIN_ID)
    }
  }
  // 最后写 manifest（去重 heavy 字段 + 标记 _sharded）
  const manifest = { ...p, boards: p.boards.map(lightBoard), _sharded: true, ...extra }
  await s.set(manifestKey, manifest, PLUGIN_ID)
  return next
}

// 读回：拼装 manifest + 各分片。无 _sharded 视为旧版全量 blob，原样返回（下次保存自动转分片）。
async function readSharded(manifestKey: string, prefix: string): Promise<{ doc: ProjectDoc; savedAt?: number } | null> {
  const s = storage()
  if (!s) return null
  const m: any = await s.get(manifestKey, PLUGIN_ID)
  if (!m || typeof m !== 'object' || !Array.isArray(m.boards)) return null
  if (!m._sharded) return { doc: m as ProjectDoc } // 旧版全量
  const { _sharded, _savedAt, ...rest } = m
  void _sharded
  const boards: Board[] = []
  for (const b of m.boards as Board[]) {
    const shard: any = await s.get(prefix + b.id, PLUGIN_ID)
    boards.push({ ...b, cards: shard?.cards ?? {}, edges: shard?.edges ?? {}, annotations: shard?.annotations ?? [] })
  }
  return { doc: { ...(rest as ProjectDoc), boards }, savedAt: typeof _savedAt === 'number' ? _savedAt : undefined }
}

const VALID_KINDS = new Set(['image', 'video', 'text', 'audio', 'source', 'group', 'note'])

// 修复历史「跨板串卡」bug 残留：异步生成途中切换画布曾把结果以 {...undefined, ...patch}
// 写到错的画布，产出缺 kind/几何的畸形卡。这里按画布剔除畸形卡并清理悬空连线，
// 让被它顶掉/盖住的原卡恢复显示（合法卡必有 kind 与有限 x/y/w/h，过滤零误伤）。
function sanitizeBoards(d: ProjectDoc): ProjectDoc {
  if (!Array.isArray(d.boards)) return d
  let changed = false
  const boards = d.boards.map((b) => {
    if (!b || !b.cards) return b
    const cards: Record<string, (typeof b.cards)[string]> = {}
    let dropped = false
    for (const [id, c] of Object.entries(b.cards)) {
      const ok =
        !!c &&
        typeof (c as { kind?: unknown }).kind === 'string' &&
        VALID_KINDS.has((c as { kind: string }).kind) &&
        Number.isFinite((c as { x?: number }).x) &&
        Number.isFinite((c as { y?: number }).y) &&
        Number.isFinite((c as { w?: number }).w) &&
        Number.isFinite((c as { h?: number }).h)
      if (ok) cards[id] = c
      else dropped = true
    }
    if (!dropped) return b
    changed = true
    const edges: Record<string, (typeof b.edges)[string]> = {}
    for (const [eid, e] of Object.entries(b.edges || {})) {
      if (cards[e.source] && cards[e.target]) edges[eid] = e
    }
    return { ...b, cards, edges }
  })
  return changed ? { ...d, boards } : d
}

// schemaVersion 迁移脚手架：按版本累进升级（当前 v1，暂无迁移；未来在此追加 if (v < N) {…}）
export function migrateProject(doc: ProjectDoc): ProjectDoc {
  let d = doc
  const v = typeof d.schemaVersion === 'number' ? d.schemaVersion : 0
  // 示例占位：if (v < 2) { d = { ...d, /* 升级字段 */ } }
  if (v > SCHEMA_VERSION) {
    // 来自更高版本（如他人较新插件导出）：不要降级 schemaVersion，避免静默丢未知字段；仅告警后按现状清理
    console.warn(`[ai-creative-canvas] 工程 schemaVersion ${v} 高于当前 ${SCHEMA_VERSION}，可能有无法识别的新字段（已保留原数据）`)
  } else if (v < SCHEMA_VERSION) {
    d = { ...d, schemaVersion: SCHEMA_VERSION }
  }
  d = sanitizeBoards(d) // 清理跨板串卡 bug 残留的畸形卡
  // 风格包：工程级 → 画布级迁移（旧工程把全局值复制到各画布，使其各自独立可改）
  if ((d.stylePackId || d.style) && Array.isArray(d.boards) && d.boards.some((b) => b.stylePackId === undefined && b.style === undefined)) {
    d = { ...d, boards: d.boards.map((b) => ({ ...b, stylePackId: b.stylePackId ?? d.stylePackId, style: b.style ?? d.style })) }
  }
  return d
}

// 上次落盘的画布引用基线（增量判定）；按工程区分——切换工程时重置。
let baselineProjectId: string | null = null
let mainBaseline = new Map<string, Board>()
let recBaseline = new Map<string, Board>()
function ensureBaselineFor(pid: string) {
  if (baselineProjectId !== pid) {
    baselineProjectId = pid
    mainBaseline = new Map()
    recBaseline = new Map()
  }
}

// 刚载入某工程后用其画布引用播种主存基线：随后的首次自动保存只重写 manifest（不重复全量写分片）。
export function seedMainBaseline(pid: string, doc: ProjectDoc) {
  baselineProjectId = pid
  mainBaseline = new Map(doc.boards.map((b) => [b.id, b]))
  recBaseline = new Map()
}

// ── 工程注册表（轻量元信息）──
export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  cardCount: number
  cover?: string | null // 首张图片卡的 assetUrl（封面，best-effort）
}
export interface Registry {
  activeId: string | null
  items: ProjectMeta[]
}

export function metaOf(doc: ProjectDoc): ProjectMeta {
  let cardCount = 0
  let cover: string | null = null
  for (const b of doc.boards || []) {
    for (const c of Object.values(b.cards || {})) {
      cardCount++
      if (!cover && (c.kind === 'image' || c.kind === 'source') && c.assetUrl) cover = c.assetUrl
    }
  }
  return { id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt, cardCount, cover }
}

export async function loadRegistry(): Promise<Registry | null> {
  try {
    const v = await storage()?.get(KEY_REGISTRY, PLUGIN_ID)
    if (v && typeof v === 'object' && Array.isArray((v as Registry).items)) return v as Registry
    return null
  } catch {
    return null
  }
}

export async function saveRegistry(r: Registry): Promise<void> {
  try {
    await storage()?.set(KEY_REGISTRY, r, PLUGIN_ID)
  } catch {
    /* ignore */
  }
}

// 旧版单工程 → 多工程命名空间一次性迁移：无注册表但存在 project:current 时，
// 把旧工程作为首个/活动工程按命名空间另存（旧键留作孤儿、无害），并建注册表。
export async function migrateLegacyIfNeeded(): Promise<Registry | null> {
  const existing = await loadRegistry()
  if (existing) return existing
  try {
    const legacy = await readSharded(LEGACY_CURRENT, LEGACY_BOARD_PREFIX)
    if (!legacy) return null
    const doc = migrateProject(legacy.doc)
    await saveProject(doc.id, doc)
    const reg: Registry = { activeId: doc.id, items: [metaOf(doc)] }
    await saveRegistry(reg)
    return reg
  } catch {
    return null
  }
}

export async function loadProject(pid: string): Promise<ProjectDoc | null> {
  try {
    const r = await readSharded(kCurrent(pid), kBoard(pid))
    if (!r) return null
    return migrateProject(r.doc)
  } catch {
    return null
  }
}

export async function saveProject(pid: string, p: ProjectDoc): Promise<boolean> {
  try {
    ensureBaselineFor(pid)
    mainBaseline = await writeSharded(p, kCurrent(pid), kBoard(pid), mainBaseline)
    return true
  } catch {
    return false
  }
}

// 删除某工程的全部存储（manifest + 各分片 + 恢复）
export async function deleteProjectStorage(pid: string): Promise<void> {
  try {
    const s = storage()
    if (!s) return
    const del = async (k: string) => {
      if (s.delete) await s.delete(k, PLUGIN_ID)
      else await s.set(k, null, PLUGIN_ID)
    }
    for (const [key, prefix] of [[kCurrent(pid), kBoard(pid)], [kRecovery(pid), kRecBoard(pid)]] as const) {
      const m: any = await s.get(key, PLUGIN_ID)
      if (m && Array.isArray(m.boards)) for (const b of m.boards) await del(prefix + b.id)
      await del(key)
    }
    if (baselineProjectId === pid) baselineProjectId = null
  } catch {
    /* ignore */
  }
}

// ── 崩溃恢复快照（每工程独立；写的是"未提交主存的改动缓冲"，主存成功后清除）──
export interface RecoverySnap {
  doc: ProjectDoc
  savedAt: number
}

export async function saveRecovery(pid: string, p: ProjectDoc, savedAt: number): Promise<void> {
  try {
    ensureBaselineFor(pid)
    recBaseline = await writeSharded(p, kRecovery(pid), kRecBoard(pid), recBaseline, { _savedAt: savedAt })
  } catch {
    /* ignore */
  }
}

export async function loadRecovery(pid: string): Promise<RecoverySnap | null> {
  try {
    const r = await readSharded(kRecovery(pid), kRecBoard(pid))
    if (!r) return null
    return { doc: migrateProject(r.doc), savedAt: r.savedAt ?? 0 }
  } catch {
    return null
  }
}

// 仅删 manifest（分片与 recBaseline 保留）：主存成功后使「恢复」不再被提供，
// 而后续编辑仍按引用增量重写恢复分片，避免每次清空后又全量重写。
export async function clearRecovery(pid: string): Promise<void> {
  try {
    const s = storage()
    if (s?.delete) await s.delete(kRecovery(pid), PLUGIN_ID)
    else await s?.set(kRecovery(pid), null, PLUGIN_ID)
  } catch {
    /* ignore */
  }
}
