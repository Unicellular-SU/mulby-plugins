/**
 * GitHub 发布闭环：OAuth Device Flow 登录 + 纯 REST API 一键提交插件 PR。
 *
 * 全程走宿主 `window.mulby.http`（宿主侧发起、无 CORS），不依赖本地 git/gh。
 * client_id 是公开信息（Device Flow 专为无法保存 secret 的客户端设计），可安全硬编码。
 */

export const GH_CLIENT_ID = 'Ov23livwOjasBMZrRwDj'
export const GH_SCOPE = 'public_repo'
export const REPO_OWNER = 'Unicellular-SU'
export const REPO_NAME = 'mulby-plugins'
export const BASE_BRANCH = 'main'

const http = () => (window as any)?.mulby?.http

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface HttpResponse { status: number; statusText: string; headers: Record<string, string>; data: string }

async function rawRequest(opts: { url: string; method?: string; headers?: Record<string, string>; body?: unknown; timeout?: number }): Promise<HttpResponse> {
  const h = http()
  if (!h?.request) throw new Error('当前环境不支持网络请求（需在 Mulby 中运行）')
  return await h.request(opts)
}

function parseJson(res: HttpResponse): any {
  try { return res.data ? JSON.parse(res.data) : {} } catch { return {} }
}

/** 调 GitHub REST API（api.github.com），自动带鉴权与版本头；非 2xx 抛带 message 的错误 */
async function ghApi(method: string, path: string, token: string, body?: unknown): Promise<any> {
  const res = await rawRequest({
    url: `https://api.github.com${path}`,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mulby-developer-tools',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body as any,
    timeout: 30000
  })
  const json = parseJson(res)
  if (res.status < 200 || res.status >= 300) {
    const msg = json?.message || res.statusText || `HTTP ${res.status}`
    const err = new Error(msg) as Error & { status?: number; body?: any }
    err.status = res.status
    err.body = json
    throw err
  }
  return json
}

// ---------------- Device Flow ----------------

export interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

/** 第一步：申请设备码 */
export async function requestDeviceCode(): Promise<DeviceCode> {
  const res = await rawRequest({
    url: 'https://github.com/login/device/code',
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: { client_id: GH_CLIENT_ID, scope: GH_SCOPE },
    timeout: 30000
  })
  const d = parseJson(res)
  if (!d?.device_code) throw new Error(d?.error_description || '申请设备码失败，请重试')
  return d as DeviceCode
}

/**
 * 第二步：轮询换取 access_token。用户在浏览器授权后返回 token。
 * @param shouldCancel 返回 true 时中止轮询
 */
export async function pollForToken(
  device: DeviceCode,
  shouldCancel: () => boolean = () => false
): Promise<string> {
  let wait = Math.max(device.interval || 5, 5)
  const deadline = Date.now() + (device.expires_in || 900) * 1000
  while (Date.now() < deadline) {
    if (shouldCancel()) throw new Error('已取消登录')
    await sleep(wait * 1000)
    if (shouldCancel()) throw new Error('已取消登录')
    const res = await rawRequest({
      url: 'https://github.com/login/oauth/access_token',
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: { client_id: GH_CLIENT_ID, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
      timeout: 30000
    })
    const d = parseJson(res)
    if (d?.access_token) return d.access_token as string
    switch (d?.error) {
      case 'authorization_pending': break
      case 'slow_down': wait += 5; break
      case 'expired_token': throw new Error('设备码已过期，请重新登录')
      case 'access_denied': throw new Error('已取消授权')
      default: if (d?.error) throw new Error(d.error_description || d.error)
    }
  }
  throw new Error('登录超时，请重试')
}

// ---------------- 用户 / Fork ----------------

export interface GhUser { login: string; avatar_url?: string; name?: string }

export async function getUser(token: string): Promise<GhUser> {
  return await ghApi('GET', '/user', token)
}

/** 确保当前用户已有上游仓库的 fork（不存在则创建并等待就绪） */
export async function ensureFork(token: string, login: string, onProgress?: (msg: string) => void): Promise<void> {
  // 已存在直接用
  try {
    await ghApi('GET', `/repos/${login}/${REPO_NAME}`, token)
    return
  } catch (e) {
    if ((e as any)?.status !== 404) throw e
  }
  onProgress?.('正在 Fork 仓库…')
  await ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/forks`, token, {})
  // fork 是异步的，轮询直到可用（最多 ~40s）
  for (let i = 0; i < 20; i++) {
    await sleep(2000)
    try {
      await ghApi('GET', `/repos/${login}/${REPO_NAME}`, token)
      return
    } catch (e) {
      if ((e as any)?.status !== 404) throw e
    }
  }
  throw new Error('Fork 仓库超时，请稍后重试')
}

// ---------------- 已发布版本（判断新增/更新） ----------------

/** 商店索引内存缓存：批量维护检查时只拉一次 plugins.json，避免每个插件一个请求 */
let publishedIndexCache: { at: number; map: Map<string, string> } | null = null
const PUBLISHED_INDEX_TTL = 5 * 60_000

/**
 * 拉取上游 plugins.json 并按 id/name 建索引（id→version）。免 token（raw.githubusercontent.com）。
 * forceFresh 跳过内存缓存；网络失败返回 null（区别于「索引里没有」的空 Map）。
 */
export async function fetchPublishedIndex(forceFresh = false): Promise<Map<string, string> | null> {
  if (!forceFresh && publishedIndexCache && Date.now() - publishedIndexCache.at < PUBLISHED_INDEX_TTL) {
    return publishedIndexCache.map
  }
  try {
    const res = await rawRequest({
      url: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BASE_BRANCH}/plugins.json`,
      method: 'GET',
      timeout: 20000
    })
    if (res.status !== 200) return null
    const idx = parseJson(res)
    const list: any[] = Array.isArray(idx?.plugins) ? idx.plugins : []
    const map = new Map<string, string>()
    for (const p of list) {
      const version = p?.version ? String(p.version) : ''
      if (!version) continue
      // id 与 name 都建索引：上游索引按 id、发布目录按 name，两边查询口径不一致时都能命中
      if (p?.id) map.set(String(p.id), version)
      if (p?.name) map.set(String(p.name), version)
    }
    publishedIndexCache = { at: Date.now(), map }
    return map
  } catch {
    return null
  }
}

/** 从上游 plugins.json 读取某插件的已发布版本；不存在返回 null */
export async function fetchPublishedVersion(pluginId: string): Promise<string | null> {
  const map = await fetchPublishedIndex()
  return map?.get(pluginId) ?? null
}

/** semver 比较：a > b 返回 1，a < b 返回 -1，相等 0（忽略 prerelease 细节，够发布门禁用） */
export function semverCmp(a: string, b: string): number {
  const pa = String(a).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

// ---------------- 提交 PR ----------------

export interface PublishFile { path: string; content: string; encoding: 'utf-8' | 'base64' }

export interface PublishParams {
  token: string
  login: string
  pluginName: string
  version: string
  files: PublishFile[]
  isUpdate: boolean
  title: string
  body: string
}

function sanitizeBranch(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

/**
 * 在用户 fork 上建分支、用 Git Data API 一次提交推送整棵源码树，再向上游开 PR。
 * 返回 PR 的 html_url、编号与是否复用既有 PR。
 */
export async function publishPluginPR(params: PublishParams, onProgress?: (msg: string) => void): Promise<{ prUrl: string; prNumber: number; branch: string; reused: boolean }> {
  const { token, login, pluginName, version, files, title, body } = params
  const fork = `${login}/${REPO_NAME}`
  const branch = sanitizeBranch(`publish/${pluginName}-v${version}`)

  // 1. 基线：以「fork 自己 main 的最新提交」为基（Git Data API 不能跨库引用上游对象，会 404）。
  //    新建的 fork 会从上游当前状态创建，因此天然带最新 CI workflow；
  //    仅「发布前就已存在且陈旧的 fork」需要用户在 GitHub「Sync fork」一次（详见交付说明）。
  onProgress?.('读取仓库基线…')
  const ref = await ghApi('GET', `/repos/${fork}/git/ref/heads/${BASE_BRANCH}`, token)
  const baseSha: string = ref?.object?.sha
  if (!baseSha) throw new Error('未取到 fork 的基线分支')
  const baseCommit = await ghApi('GET', `/repos/${fork}/git/commits/${baseSha}`, token)
  const baseTreeSha: string = baseCommit?.tree?.sha

  // 2. 逐文件创建 blob
  const treeEntries: Array<{ path: string; mode: string; type: 'blob'; sha: string }> = []
  let i = 0
  for (const f of files) {
    i++
    onProgress?.(`上传文件 ${i}/${files.length}：${f.path}`)
    const blob = await ghApi('POST', `/repos/${fork}/git/blobs`, token, { content: f.content, encoding: f.encoding })
    treeEntries.push({ path: `plugins/${pluginName}/${f.path}`, mode: '100644', type: 'blob', sha: blob.sha })
  }

  // 3. tree + commit
  onProgress?.('生成提交…')
  const newTree = await ghApi('POST', `/repos/${fork}/git/trees`, token, { base_tree: baseTreeSha, tree: treeEntries })
  const commit = await ghApi('POST', `/repos/${fork}/git/commits`, token, { message: title, tree: newTree.sha, parents: [baseSha] })

  // 4. 建/更新分支 ref
  try {
    await ghApi('POST', `/repos/${fork}/git/refs`, token, { ref: `refs/heads/${branch}`, sha: commit.sha })
  } catch (e) {
    if ((e as any)?.status === 422) {
      await ghApi('PATCH', `/repos/${fork}/git/refs/heads/${branch}`, token, { sha: commit.sha, force: true })
    } else {
      throw e
    }
  }

  // 5. 开 PR（已存在则复用）
  onProgress?.('创建 Pull Request…')
  try {
    const pr = await ghApi('POST', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls`, token, {
      title, body, head: `${login}:${branch}`, base: BASE_BRANCH, maintainer_can_modify: true
    })
    return { prUrl: pr.html_url, prNumber: pr.number, branch, reused: false }
  } catch (e) {
    if ((e as any)?.status === 422) {
      const existing = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?head=${login}:${branch}&state=open`, token)
      if (Array.isArray(existing) && existing[0]?.html_url) return { prUrl: existing[0].html_url, prNumber: existing[0].number, branch, reused: true }
    }
    throw e
  }
}

/** 简易敏感信息扫描（发布前提醒）：在文本文件里找疑似 token/密钥 */
export function scanSecrets(files: PublishFile[]): Array<{ path: string; hint: string }> {
  const hits: Array<{ path: string; hint: string }> = []
  const patterns: Array<{ re: RegExp; hint: string }> = [
    { re: /gh[pousr]_[A-Za-z0-9]{20,}/, hint: 'GitHub Token' },
    { re: /sk-[A-Za-z0-9]{20,}/, hint: 'API Key（sk-）' },
    { re: /AKIA[0-9A-Z]{16}/, hint: 'AWS Access Key' },
    { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, hint: '私钥' },
    { re: /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i, hint: '疑似硬编码密钥' }
  ]
  for (const f of files) {
    if (f.encoding !== 'utf-8') continue
    for (const p of patterns) {
      if (p.re.test(f.content)) { hits.push({ path: f.path, hint: p.hint }); break }
    }
  }
  return hits
}

// ---------------- 版本建议 ----------------

/** 给出建议的下一个版本号（patch + 1）；解析失败时原样返回 */
export function nextPatchVersion(version: string): string {
  const m = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return version
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

// ---------------- PR / CI 状态查询 ----------------

export interface PullStatus {
  state: 'open' | 'closed'
  merged: boolean
  headSha: string
  /** 普通评论 + 代码行评论总数（审查意见入口的角标） */
  commentCount: number
}

/** 查询 PR 的开关 / 合并状态与 head commit sha */
export async function getPullStatus(token: string, prNumber: number): Promise<PullStatus> {
  const pr = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`, token)
  return {
    state: pr?.state === 'closed' ? 'closed' : 'open',
    merged: !!pr?.merged,
    headSha: pr?.head?.sha || '',
    commentCount: (Number(pr?.comments) || 0) + (Number(pr?.review_comments) || 0)
  }
}

export type ChecksState = 'none' | 'in_progress' | 'success' | 'failure'
export interface ChecksStatus { state: ChecksState; total: number; passed: number; failed: number }

/** 比较两条 check-run 谁更新：先按 started_at，再按 id（单调递增）兜底 */
function checkRunNewer(a: any, b: any): boolean {
  const ta = Date.parse(a?.started_at || a?.completed_at || '') || 0
  const tb = Date.parse(b?.started_at || b?.completed_at || '') || 0
  if (ta !== tb) return ta > tb
  return (Number(a?.id) || 0) > (Number(b?.id) || 0)
}

/** 聚合某 commit 的 check-runs：有失败→failure，有未完成→in_progress，全过→success，无→none */
export async function getChecksStatus(token: string, sha: string): Promise<ChecksStatus> {
  if (!sha) return { state: 'none', total: 0, passed: 0, failed: 0 }
  const res = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/commits/${sha}/check-runs`, token)
  const runs: any[] = Array.isArray(res?.check_runs) ? res.check_runs : []
  if (runs.length === 0) return { state: 'none', total: 0, passed: 0, failed: 0 }
  // 同一 commit 多次触发/重跑会留下多条同名 check-run（旧失败 + 新成功，分属不同 check_suite）。
  // GitHub 只认每个名字「最新」那条，这里按 name 去重、保留最近一条（started_at→id）再聚合，
  // 否则旧的失败记录会让状态长期误显示为「未通过」。
  const latest = new Map<string, any>()
  for (const r of runs) {
    const key = String(r?.name ?? r?.id)
    const prev = latest.get(key)
    if (!prev || checkRunNewer(r, prev)) latest.set(key, r)
  }
  let passed = 0, failed = 0, running = 0
  for (const r of latest.values()) {
    if (r?.status !== 'completed') { running++; continue }
    const c = r?.conclusion
    if (c === 'success' || c === 'neutral' || c === 'skipped') passed++
    else failed++ // failure / cancelled / timed_out / action_required / stale
  }
  const state: ChecksState = failed > 0 ? 'failure' : running > 0 ? 'in_progress' : 'success'
  return { state, total: latest.size, passed, failed }
}

export type PublishLiveState = 'merged' | 'closed' | 'ci_failed' | 'ci_running' | 'ci_passed' | 'open'
export type ReviewState = 'changes_requested' | 'approved' | 'commented' | 'none'
export interface PublishLive { state: PublishLiveState; pull: PullStatus; checks: ChecksStatus; review: ReviewState }

/**
 * 聚合 PR 的人工审查结论（GitHub 的口径：每个 reviewer 以其最新一次 APPROVED/CHANGES_REQUESTED 为准）：
 * 任一 reviewer 最新为「要求修改」→ changes_requested；否则有通过 → approved；只有评论 → commented。
 */
export async function getReviewState(token: string, prNumber: number): Promise<ReviewState> {
  try {
    const reviews = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}/reviews?per_page=100`, token)
    if (!Array.isArray(reviews) || reviews.length === 0) return 'none'
    const latestByUser = new Map<string, string>()
    let commented = false
    for (const r of reviews) {
      const user = r?.user?.login
      const state = String(r?.state || '')
      if (!user || r?.user?.type === 'Bot') continue
      if (state === 'COMMENTED') { commented = true; continue }
      if (state === 'APPROVED' || state === 'CHANGES_REQUESTED') latestByUser.set(user, state) // 按时间升序返回，后写覆盖
    }
    const states = [...latestByUser.values()]
    if (states.includes('CHANGES_REQUESTED')) return 'changes_requested'
    if (states.includes('APPROVED')) return 'approved'
    return commented ? 'commented' : 'none'
  } catch {
    return 'none'
  }
}

/** 综合查询：先看 PR 是否合并/关闭，未关闭再看 CI 检查与审查结论，归一成一个状态供 UI 显示 */
export async function fetchPublishLive(token: string, prNumber: number): Promise<PublishLive> {
  const pull = await getPullStatus(token, prNumber)
  let checks: ChecksStatus = { state: 'none', total: 0, passed: 0, failed: 0 }
  let review: ReviewState = 'none'
  let state: PublishLiveState
  if (pull.merged) state = 'merged'
  else if (pull.state === 'closed') state = 'closed'
  else {
    ;[checks, review] = await Promise.all([getChecksStatus(token, pull.headSha), getReviewState(token, prNumber)])
    state = checks.state === 'failure' ? 'ci_failed'
      : checks.state === 'in_progress' ? 'ci_running'
      : checks.state === 'success' ? 'ci_passed'
      : 'open'
  }
  return { state, pull, checks, review }
}

// ---------------- 审查意见（评论回流） ----------------

export interface PrFeedbackItem {
  kind: 'review' | 'line' | 'comment'
  author: string
  /** review 专有：APPROVED / CHANGES_REQUESTED / COMMENTED */
  state?: string
  body: string
  /** 代码行评论专有：文件路径与行号 */
  path?: string
  line?: number
  createdAt: number
}

export interface PrFeedback { reviewState: ReviewState; items: PrFeedbackItem[] }

const isBotUser = (u: any): boolean => u?.type === 'Bot' || /\[bot\]$/i.test(String(u?.login || ''))

/**
 * 拉取 PR 的全部「人话意见」：reviews 正文 + 代码行评论 + 普通评论，按时间排序。
 * 过滤 bot（CI 机器人评论）与自己（selfLogin）的发言——只保留需要响应的审查意见。
 */
export async function fetchPrFeedback(token: string, prNumber: number, selfLogin?: string): Promise<PrFeedback> {
  const base = `/repos/${REPO_OWNER}/${REPO_NAME}`
  const [reviews, lineComments, issueComments] = await Promise.all([
    ghApi('GET', `${base}/pulls/${prNumber}/reviews?per_page=100`, token).catch(() => []),
    ghApi('GET', `${base}/pulls/${prNumber}/comments?per_page=100`, token).catch(() => []),
    ghApi('GET', `${base}/issues/${prNumber}/comments?per_page=100`, token).catch(() => [])
  ])
  const items: PrFeedbackItem[] = []
  const keep = (u: any) => !isBotUser(u) && (!selfLogin || u?.login !== selfLogin)

  for (const r of Array.isArray(reviews) ? reviews : []) {
    if (!keep(r?.user) || r?.state === 'PENDING') continue
    const body = String(r?.body || '').trim()
    if (!body && r?.state !== 'CHANGES_REQUESTED') continue // 纯 APPROVED 无正文不算「意见」
    items.push({
      kind: 'review', author: r?.user?.login || '', state: String(r?.state || ''),
      body: body || '（要求修改，未附说明，详见代码行评论）',
      createdAt: Date.parse(r?.submitted_at || '') || 0
    })
  }
  for (const c of Array.isArray(lineComments) ? lineComments : []) {
    if (!keep(c?.user)) continue
    const body = String(c?.body || '').trim()
    if (!body) continue
    items.push({
      kind: 'line', author: c?.user?.login || '', body,
      path: c?.path ? String(c.path) : undefined,
      line: typeof c?.line === 'number' ? c.line : (typeof c?.original_line === 'number' ? c.original_line : undefined),
      createdAt: Date.parse(c?.created_at || '') || 0
    })
  }
  for (const c of Array.isArray(issueComments) ? issueComments : []) {
    if (!keep(c?.user)) continue
    const body = String(c?.body || '').trim()
    if (!body) continue
    items.push({ kind: 'comment', author: c?.user?.login || '', body, createdAt: Date.parse(c?.created_at || '') || 0 })
  }
  items.sort((a, b) => a.createdAt - b.createdAt)

  // reviewState 与 getReviewState 同口径（复用已拉到的 reviews，不再发请求）
  const latestByUser = new Map<string, string>()
  let commented = items.length > 0
  for (const r of Array.isArray(reviews) ? reviews : []) {
    const user = r?.user?.login
    const state = String(r?.state || '')
    if (!user || isBotUser(r?.user)) continue
    if (state === 'APPROVED' || state === 'CHANGES_REQUESTED') latestByUser.set(user, state)
  }
  const states = [...latestByUser.values()]
  const reviewState: ReviewState = states.includes('CHANGES_REQUESTED') ? 'changes_requested'
    : states.includes('APPROVED') ? 'approved'
    : commented ? 'commented' : 'none'
  return { reviewState, items }
}

// ---------------- 本地登录态 / 发布记录持久化 ----------------

export const GH_TOKEN_KEY = 'gh-token'
export const GH_LOGIN_KEY = 'gh-login'

const storage = () => (window as any)?.mulby?.storage

/** 读取本地保存的 GitHub token（未登录返回空串） */
export async function getStoredToken(): Promise<string> {
  try { return (await storage()?.get?.(GH_TOKEN_KEY)) || '' } catch { return '' }
}

export interface PublishRecord {
  pluginId: string
  displayName?: string
  version: string
  prNumber: number
  prUrl: string
  branch: string
  isUpdate: boolean
  submittedAt: number
}

/** 按插件目录路径作 key，避免插件 id/name 在不同环节取值不一致 */
const recordKey = (root: string) => `publish-record:${root}`

export async function savePublishRecord(root: string, rec: PublishRecord): Promise<void> {
  try { await storage()?.set?.(recordKey(root), JSON.stringify(rec)) } catch { /* ignore */ }
}

export async function loadPublishRecord(root: string): Promise<PublishRecord | null> {
  try {
    const raw = await storage()?.get?.(recordKey(root))
    if (!raw) return null
    const r = typeof raw === 'string' ? JSON.parse(raw) : raw
    return r && typeof r === 'object' && r.prNumber ? (r as PublishRecord) : null
  } catch { return null }
}

export async function clearPublishRecord(root: string): Promise<void> {
  try { await storage()?.remove?.(recordKey(root)) } catch { /* ignore */ }
}

/** 读取本地保存的 GitHub 登录名（未登录返回空串） */
export async function getStoredLogin(): Promise<string> {
  try { return (await storage()?.get?.(GH_LOGIN_KEY)) || '' } catch { return '' }
}

// ---------------- 网络发现 / 重新触发 CI ----------------

/** 仓库 PR 列表内存缓存：批量维护检查时多个插件共享一次拉取 */
let prListCache: { at: number; list: any[] } | null = null
const PR_LIST_TTL = 60_000

/** 拉取上游仓库最近 100 条 PR（带 60s 内存缓存）；失败抛错 */
export async function listRepoPRs(token: string, forceFresh = false): Promise<any[]> {
  if (!forceFresh && prListCache && Date.now() - prListCache.at < PR_LIST_TTL) return prListCache.list
  const list = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=all&per_page=100&sort=created&direction=desc`, token)
  const arr = Array.isArray(list) ? list : []
  prListCache = { at: Date.now(), list: arr }
  return arr
}

/** 在 PR 列表中按分支名（publish/<name>-v*，已 sanitize）匹配当前用户为某插件提交的最新 PR */
export function matchPluginPR(list: any[], login: string, pluginName: string): PublishRecord | null {
  if (!login || !pluginName) return null
  const prefix = sanitizeBranch(`publish/${pluginName}-v`)
  const hit = list.find((pr: any) =>
    typeof pr?.head?.ref === 'string' && pr.head.ref.startsWith(prefix) &&
    (pr?.head?.repo?.owner?.login === login || pr?.user?.login === login)
  )
  if (!hit) return null
  return {
    pluginId: pluginName,
    version: String(hit.head.ref.slice(prefix.length) || ''),
    prNumber: hit.number,
    prUrl: hit.html_url,
    branch: hit.head.ref,
    isUpdate: /^update\(/.test(String(hit.title || '')),
    submittedAt: hit.created_at ? Date.parse(hit.created_at) : Date.now()
  }
}

/**
 * 不依赖本地记录，直接从上游仓库按分支名（publish/<name>-v*，已 sanitize）发现
 * 当前用户为某插件提交过的最新 PR —— 本地 storage 被清空 / 换机器后仍能回显。
 */
export async function discoverPluginPR(token: string, login: string, pluginName: string): Promise<PublishRecord | null> {
  if (!login || !pluginName) return null
  return matchPluginPR(await listRepoPRs(token), login, pluginName)
}

/**
 * 关闭再重开 PR 以重新触发 CI：让 GitHub 用「当前 base」重算测试合并提交、跑最新 workflow。
 * 单纯 re-run 会复用旧合并提交（旧 workflow），所以这里用 close + reopen。
 */
export async function rerunPR(token: string, prNumber: number): Promise<void> {
  await ghApi('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`, token, { state: 'closed' })
  await sleep(1500)
  await ghApi('PATCH', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`, token, { state: 'open' })
}
