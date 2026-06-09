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

/** 从上游 plugins.json 读取某插件的已发布版本；不存在返回 null */
export async function fetchPublishedVersion(pluginId: string): Promise<string | null> {
  try {
    const res = await rawRequest({
      url: `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BASE_BRANCH}/plugins.json`,
      method: 'GET',
      timeout: 20000
    })
    if (res.status !== 200) return null
    const idx = parseJson(res)
    const list: any[] = Array.isArray(idx?.plugins) ? idx.plugins : []
    const hit = list.find((p) => (p?.id || p?.name) === pluginId)
    return hit?.version ? String(hit.version) : null
  } catch {
    return null
  }
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
 * 返回 PR 的 html_url。
 */
export async function publishPluginPR(params: PublishParams, onProgress?: (msg: string) => void): Promise<{ prUrl: string; reused: boolean }> {
  const { token, login, pluginName, version, files, title, body } = params
  const fork = `${login}/${REPO_NAME}`
  const branch = sanitizeBranch(`publish/${pluginName}-v${version}`)

  // 1. 基线 commit/tree
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
    return { prUrl: pr.html_url, reused: false }
  } catch (e) {
    if ((e as any)?.status === 422) {
      const existing = await ghApi('GET', `/repos/${REPO_OWNER}/${REPO_NAME}/pulls?head=${login}:${branch}&state=open`, token)
      if (Array.isArray(existing) && existing[0]?.html_url) return { prUrl: existing[0].html_url, reused: true }
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
