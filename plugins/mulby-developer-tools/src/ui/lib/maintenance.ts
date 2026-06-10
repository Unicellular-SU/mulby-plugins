/**
 * 维护闭环 · 状态聚合：回答「发布之后，我的插件现在怎么样了？」
 *
 * 聚合四个状态源（全部已有，不依赖宿主/CI 改动）：
 * 1. 本地版本   —— 插件目录 manifest.json（免 token）
 * 2. 商店版本   —— 上游 plugins.json 索引（免 token，raw）
 * 3. PR / CI    —— GitHub PR 列表 + check-runs（需登录）
 * 4. 审查结论   —— GitHub reviews（需登录）
 *
 * 防限流：商店索引 / PR 列表模块级共享缓存（github.ts 内）+ 逐插件串行 +
 * storage 持久化缓存（TTL 10min，重开工作台先秒显旧值再后台刷新）。
 */

import {
  fetchPublishedIndex, listRepoPRs, matchPluginPR, fetchPublishLive,
  getStoredToken, getStoredLogin, semverCmp,
  type PublishLiveState, type ReviewState
} from './github'

export type VersionRelation = 'unpublished' | 'ahead' | 'synced' | 'behind' | 'unknown'

export interface MaintenancePr {
  number: number
  url: string
  state: PublishLiveState
  review: ReviewState
  /** 普通评论 + 代码行评论总数（审查意见入口角标） */
  feedbackCount: number
}

export interface MaintenanceStatus {
  pluginPath: string
  pluginId: string
  localVersion: string
  storeVersion: string | null
  relation: VersionRelation
  pr: MaintenancePr | null
  /** 需要开发者处理：CI 失败 / 被要求修改 / 本地版本落后商店 */
  needsAttention: boolean
  /** needsAttention 的人话原因（徽标 tooltip / 汇总提醒用） */
  attentionReason: string
  /** 已发布过且本地版本更高 → 可以发更新 */
  canPublishUpdate: boolean
  checkedAt: number
}

export interface MaintenanceTarget { path: string; id: string }

const CACHE_KEY = 'maint-cache-v1'
const CACHE_TTL = 10 * 60_000

const storage = () => (window as any)?.mulby?.storage
const fsApi = () => (window as any)?.mulby?.filesystem

// ---------------- storage 缓存 ----------------

export async function loadMaintenanceCache(): Promise<Record<string, MaintenanceStatus>> {
  try {
    const raw = await storage()?.get?.(CACHE_KEY)
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw
    return obj && typeof obj === 'object' ? (obj as Record<string, MaintenanceStatus>) : {}
  } catch { return {} }
}

async function saveMaintenanceCache(map: Record<string, MaintenanceStatus>): Promise<void> {
  try { await storage()?.set?.(CACHE_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

// ---------------- 单插件检查 ----------------

async function readLocalManifest(path: string): Promise<{ version: string; name: string; id: string } | null> {
  const fs = fsApi()
  if (!fs?.readFile) return null
  try {
    const raw = await fs.readFile(`${path}/manifest.json`, 'utf-8')
    const text = typeof raw === 'string'
      ? raw
      : new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
    const m = JSON.parse(text)
    return {
      version: String(m?.version || ''),
      name: String(m?.name || ''),
      id: String(m?.id || m?.name || '')
    }
  } catch { return null }
}

function deriveAttention(relation: VersionRelation, pr: MaintenancePr | null): { needs: boolean; reason: string } {
  if (pr?.state === 'ci_failed') return { needs: true, reason: `PR #${pr.number} CI 未通过` }
  if (pr && pr.state !== 'merged' && pr.state !== 'closed' && pr.review === 'changes_requested') {
    return { needs: true, reason: `PR #${pr.number} 被要求修改` }
  }
  if (relation === 'behind') return { needs: true, reason: '本地版本低于商店版（可能在别处发过更新）' }
  return { needs: false, reason: '' }
}

/**
 * 检查单个插件的维护状态。storeIndex/prList 由批量入口预取共享；
 * 任一状态源失败只降级该维度（unknown / 无 PR），不抛错。
 */
async function checkOne(
  target: MaintenanceTarget,
  storeIndex: Map<string, string> | null,
  prList: any[] | null,
  token: string,
  login: string
): Promise<MaintenanceStatus> {
  const manifest = await readLocalManifest(target.path)
  const pluginId = manifest?.id || target.id
  const localVersion = manifest?.version || ''

  // 商店版本：id 与 name 都查（上游索引两者都收录）
  let storeVersion: string | null = null
  let relation: VersionRelation = 'unknown'
  if (storeIndex) {
    storeVersion = storeIndex.get(pluginId) ?? (manifest?.name ? storeIndex.get(manifest.name) ?? null : null)
    if (!storeVersion) relation = 'unpublished'
    else if (!localVersion) relation = 'unknown'
    else {
      const c = semverCmp(localVersion, storeVersion)
      relation = c > 0 ? 'ahead' : c < 0 ? 'behind' : 'synced'
    }
  }

  // PR 状态：发布分支按 manifest.name 命名，优先用 name 匹配，回退 id
  let pr: MaintenancePr | null = null
  if (token && login && prList) {
    const rec = matchPluginPR(prList, login, manifest?.name || pluginId) || matchPluginPR(prList, login, pluginId)
    if (rec) {
      try {
        const live = await fetchPublishLive(token, rec.prNumber)
        pr = {
          number: rec.prNumber, url: rec.prUrl,
          state: live.state, review: live.review,
          feedbackCount: live.pull.commentCount
        }
      } catch {
        pr = { number: rec.prNumber, url: rec.prUrl, state: 'open', review: 'none', feedbackCount: 0 }
      }
    }
  }

  const att = deriveAttention(relation, pr)
  return {
    pluginPath: target.path,
    pluginId,
    localVersion,
    storeVersion,
    relation,
    pr,
    needsAttention: att.needs,
    attentionReason: att.reason,
    canPublishUpdate: relation === 'ahead',
    checkedAt: Date.now()
  }
}

// ---------------- 批量刷新（串行 + 缓存） ----------------

let inflight = false

/**
 * 批量检查维护状态：缓存未过期的直接回调旧值，过期/缺失的串行逐个查询并增量回调。
 * 重复调用（进行中）直接忽略。未登录自动降级为仅版本对比。
 */
export async function refreshMaintenance(
  targets: MaintenanceTarget[],
  onUpdate: (st: MaintenanceStatus) => void,
  opts?: { force?: boolean }
): Promise<void> {
  if (inflight || targets.length === 0) return
  inflight = true
  try {
    const cache = await loadMaintenanceCache()
    const now = Date.now()
    const stale: MaintenanceTarget[] = []
    for (const t of targets) {
      const hit = cache[t.path]
      if (!opts?.force && hit && now - hit.checkedAt < CACHE_TTL) onUpdate(hit)
      else stale.push(t)
    }
    if (stale.length === 0) return

    // 共享状态源各拉一次；登录态缺失 → prList 为 null（降级仅版本对比）
    const [token, login] = await Promise.all([getStoredToken(), getStoredLogin()])
    const storeIndex = await fetchPublishedIndex(opts?.force)
    let prList: any[] | null = null
    if (token && login) {
      try { prList = await listRepoPRs(token, opts?.force) } catch { prList = null }
    }

    for (const t of stale) {
      try {
        const st = await checkOne(t, storeIndex, prList, token, login)
        cache[t.path] = st
        onUpdate(st)
      } catch { /* 单插件失败跳过，不阻塞其余 */ }
    }
    await saveMaintenanceCache(cache)
  } finally {
    inflight = false
  }
}

// ---------------- UI 文案辅助 ----------------

/** 版本关系一行话（详情页维护状态行用） */
export function relationText(st: MaintenanceStatus): string {
  switch (st.relation) {
    case 'unpublished': return '未发布到商店'
    case 'ahead': return `本地 v${st.localVersion} · 商店 v${st.storeVersion} — 有未发布的改动`
    case 'synced': return `与商店同步（v${st.localVersion}）`
    case 'behind': return `本地 v${st.localVersion} 低于商店 v${st.storeVersion}`
    default: return ''
  }
}
