import type { ProjectDoc } from '../types'
import { SCHEMA_VERSION } from '../types'

export const PLUGIN_ID = 'ai-creative-canvas'
const KEY_CURRENT = 'project:current'
const KEY_RECOVERY = 'project:recovery'

function storage() {
  return (window as any).mulby?.storage
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
  if (v !== SCHEMA_VERSION) d = { ...d, schemaVersion: SCHEMA_VERSION }
  d = sanitizeBoards(d) // 清理跨板串卡 bug 残留的畸形卡
  // 风格包：工程级 → 画布级迁移（旧工程把全局值复制到各画布，使其各自独立可改）
  if ((d.stylePackId || d.style) && Array.isArray(d.boards) && d.boards.some((b) => b.stylePackId === undefined && b.style === undefined)) {
    d = { ...d, boards: d.boards.map((b) => ({ ...b, stylePackId: b.stylePackId ?? d.stylePackId, style: b.style ?? d.style })) }
  }
  return d
}

export async function loadProject(): Promise<ProjectDoc | null> {
  try {
    const v = await storage()?.get(KEY_CURRENT, PLUGIN_ID)
    if (v && typeof v === 'object' && Array.isArray((v as ProjectDoc).boards)) return migrateProject(v as ProjectDoc)
    return null
  } catch {
    return null
  }
}

export async function saveProject(p: ProjectDoc): Promise<boolean> {
  try {
    await storage()?.set(KEY_CURRENT, p, PLUGIN_ID)
    return true
  } catch {
    return false
  }
}

// ── 崩溃恢复快照（独立键；写的是"未提交主存的改动缓冲"，主存成功后清除）──
export interface RecoverySnap {
  doc: ProjectDoc
  savedAt: number
}

export async function saveRecovery(p: ProjectDoc, savedAt: number): Promise<void> {
  try {
    await storage()?.set(KEY_RECOVERY, { doc: p, savedAt }, PLUGIN_ID)
  } catch {
    /* ignore */
  }
}

export async function loadRecovery(): Promise<RecoverySnap | null> {
  try {
    const v = await storage()?.get(KEY_RECOVERY, PLUGIN_ID)
    if (v && typeof v === 'object' && (v as RecoverySnap).doc && Array.isArray((v as RecoverySnap).doc.boards)) return migrateRecovery(v as RecoverySnap)
    return null
  } catch {
    return null
  }
}

function migrateRecovery(r: RecoverySnap): RecoverySnap {
  return { ...r, doc: migrateProject(r.doc) }
}

export async function clearRecovery(): Promise<void> {
  try {
    const s = storage()
    if (s?.delete) await s.delete(KEY_RECOVERY, PLUGIN_ID)
    else await s?.set(KEY_RECOVERY, null, PLUGIN_ID)
  } catch {
    /* ignore */
  }
}
