import type { ProjectDoc } from '../types'
import { SCHEMA_VERSION } from '../types'

export const PLUGIN_ID = 'ai-creative-canvas'
const KEY_CURRENT = 'project:current'
const KEY_RECOVERY = 'project:recovery'

function storage() {
  return (window as any).mulby?.storage
}

// schemaVersion 迁移脚手架：按版本累进升级（当前 v1，暂无迁移；未来在此追加 if (v < N) {…}）
export function migrateProject(doc: ProjectDoc): ProjectDoc {
  let d = doc
  const v = typeof d.schemaVersion === 'number' ? d.schemaVersion : 0
  // 示例占位：if (v < 2) { d = { ...d, /* 升级字段 */ } }
  if (v !== SCHEMA_VERSION) d = { ...d, schemaVersion: SCHEMA_VERSION }
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
