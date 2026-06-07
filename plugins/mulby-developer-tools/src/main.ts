/**
 * Mulby 开发者工具 — 后端入口
 *
 * 除生命周期钩子外，这里导出一组 `rpc` host 方法，作为 Vibe Coding 阶段
 * 「AI 自主生成代码」的工具。前端 `window.mulby.ai.call({ tools })` 时，宿主会
 * 自动注入 `toolContext.pluginName`，AI 选择的工具名经兜底执行器路由到本插件
 * 同名 host 方法（见 docs/apis/ai.md 方式 A）。这些工具用 Node fs 直接读写磁盘，
 * 并以「会话根目录」做边界校验，确保 AI 只能在目标插件目录内操作。
 *
 * 2.0 增量：
 * - 写入前快照（按会话根目录隔离），配套 vibe_changes / vibe_rollback，
 *   让前端能在交付页展示「本次改动」diff 并一键回滚（改造模式的安全网）。
 * - 集成 CodeGraph 代码知识图谱（cg_status / cg_context / cg_impact），
 *   改造/扩展阶段把「与需求相关的代码上下文」一次性喂给 AI，减少反复 read_file
 *   的工具调用与 token。库不可用（运行时 Node 不支持 node:sqlite 等）时优雅降级，
 *   回到原有 read_file 流程，零回归。
 */
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync
} from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

declare const __dirname: string

// ---------------- Git 版本管理（可选，优雅降级） ----------------

/** 在指定仓库目录执行 git（用 -c 内联配置，绝不修改用户全局 git config） */
function git(root: string, args: string[], timeoutMs = 20_000): { ok: boolean; code: number; out: string; err: string } {
  const res = spawnSync('git', [
    '-C', root,
    '-c', 'user.email=vibe@mulby.local',
    '-c', 'user.name=Mulby Vibe',
    '-c', 'commit.gpgsign=false',
    ...args
  ], { encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 })
  if (res.error) return { ok: false, code: -1, out: '', err: res.error.message }
  return { ok: res.status === 0, code: res.status ?? -1, out: res.stdout || '', err: res.stderr || '' }
}

let gitAvailableCache: boolean | undefined
function gitAvailable(): boolean {
  if (gitAvailableCache !== undefined) return gitAvailableCache
  try {
    const r = spawnSync('git', ['--version'], { encoding: 'utf-8', timeout: 5_000 })
    gitAvailableCache = r.status === 0
  } catch {
    gitAvailableCache = false
  }
  return gitAvailableCache
}

// ---------------- 影子快照仓库（shadow snapshot，参考 opencode） ----------------
// 历史存放在用户数据目录下的「独立 git-dir」，--work-tree 指向插件目录：
// 快照/回滚完全不在插件目录创建 .git，绝不污染用户自己的版本控制（哪怕用户自己 git init 管这个插件）。

/** 快照库根目录（与插件目录物理隔离） */
function snapshotsBaseDir(): string {
  return join(homedir(), '.mulby', 'vibe-snapshots')
}
/** 某插件根目录对应的影子 git-dir（按绝对路径 hash 命名，互不冲突） */
function shadowGitDir(root: string): string {
  const key = createHash('sha1').update(resolve(root)).digest('hex').slice(0, 16)
  return join(snapshotsBaseDir(), `${key}.git`)
}
/** 快照排除项（写入影子库 info/exclude）：大目录与产物，避免快照膨胀 */
const SNAPSHOT_EXCLUDES = [
  'node_modules/', 'dist/', 'build/', '.git/', '.codegraph/', '.vibe-backup/',
  '.vite/', '.DS_Store', '*.inplugin', '*.log', ''
].join('\n')
/** 单文件快照体积上限（>2MB 物理跳过，参考 opencode 的大文件拦截） */
const MAX_SNAPSHOT_FILE_BYTES = 2_000_000

/** 在影子库上执行 git（自动带 --git-dir 与 --work-tree） */
function sgit(root: string, args: string[], timeoutMs = 20_000) {
  return git(root, ['--git-dir', shadowGitDir(root), '--work-tree', root, ...args], timeoutMs)
}

/** 影子库是否已就绪（git 可用且已 init） */
function shadowRepoReady(root: string): boolean {
  return gitAvailable() && existsSync(shadowGitDir(root))
}

/** 确保影子库存在（首次 init + 关 bare + 写 info/exclude；excludes 每次刷新） */
function ensureShadowRepo(root: string): { ok: boolean; err?: string } {
  if (!gitAvailable()) return { ok: false, err: '系统未安装 git' }
  const gitDir = shadowGitDir(root)
  try {
    if (!existsSync(gitDir)) {
      mkdirSync(gitDir, { recursive: true })
      const init = git(root, ['--git-dir', gitDir, 'init', '-q'])
      if (!init.ok) return { ok: false, err: init.err || 'git init 失败' }
      sgit(root, ['config', 'core.bare', 'false'])
    }
    try { writeFileSync(join(gitDir, 'info', 'exclude'), SNAPSHOT_EXCLUDES, 'utf-8') } catch { /* 忽略 */ }
    return { ok: true }
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : 'init 失败' }
  }
}

/** 取消暂存超过体积上限的大文件（2MB 物理拦截），避免快照膨胀 */
function unstageOversized(root: string): void {
  const staged = sgit(root, ['diff', '--cached', '--name-only'])
  if (!staged.ok) return
  for (const rel of staged.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
    try {
      const abs = join(root, rel)
      if (existsSync(abs) && statSync(abs).size > MAX_SNAPSHOT_FILE_BYTES) {
        sgit(root, ['reset', '-q', '--', rel])
      }
    } catch { /* 忽略单个文件 */ }
  }
}

/** 生成一个快照（commit 到影子库）。无改动且已有基线时返回 nochange:true。 */
function takeSnapshot(root: string, message: string): { ok: boolean; available?: boolean; nochange?: boolean; hash?: string; reason?: string } {
  if (!gitAvailable()) return { ok: false, available: false, reason: '系统未安装 git' }
  const ensured = ensureShadowRepo(root)
  if (!ensured.ok) return { ok: false, available: true, reason: ensured.err }
  sgit(root, ['add', '-A'])
  unstageOversized(root)
  const hasHead = sgit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).ok
  const staged = sgit(root, ['diff', '--cached', '--name-only'])
  if (hasHead && staged.ok && !staged.out.trim()) return { ok: true, nochange: true }
  const c = sgit(root, ['commit', '-q', '--allow-empty', '-m', String(message || '快照').slice(0, 200)])
  if (!c.ok) return { ok: false, available: true, reason: c.err || '快照失败' }
  const head = sgit(root, ['rev-parse', '--short', 'HEAD'])
  return { ok: true, hash: head.ok ? head.out.trim() : '' }
}

/**
 * 回滚到某快照：① 先把当前态存一份（可逆）② 用目标树覆盖工作区（批量，失败降级单文件自愈）
 * ③ 物理强删未跟踪残留（AI 新建但不在目标快照里的垃圾文件），node_modules 等被 exclude 不删。
 */
function restoreSnapshot(root: string, hash: string): { ok: boolean; available?: boolean; hash?: string; removed?: number; reason?: string } {
  if (!gitAvailable()) return { ok: false, available: false, reason: '系统未安装 git' }
  const ensured = ensureShadowRepo(root)
  if (!ensured.ok) return { ok: false, available: true, reason: ensured.err }
  if (!hash) return { ok: false, available: true, reason: '缺少目标版本 hash' }
  // ① 回滚前先快照当前态（不丢任何东西，可再前进）
  sgit(root, ['add', '-A'])
  unstageOversized(root)
  const dirty = sgit(root, ['diff', '--cached', '--name-only'])
  if (dirty.ok && dirty.out.trim()) sgit(root, ['commit', '-q', '-m', '自动保存：回滚前的当前状态'])
  // ② 用目标树覆盖索引+工作区（批量），失败降级单文件 checkout 自愈
  const rt = sgit(root, ['read-tree', '-u', '--reset', hash])
  if (!rt.ok) {
    const files = sgit(root, ['ls-tree', '-r', '--name-only', hash])
    if (!files.ok) return { ok: false, available: true, reason: rt.err || '回滚失败' }
    for (const rel of files.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      sgit(root, ['checkout', hash, '--', rel])
    }
  }
  // ③ 物理强删未跟踪残留（exclude 的 node_modules/dist 等不会被列出，安全）
  let removed = 0
  const others = sgit(root, ['ls-files', '--others', '--exclude-standard'])
  if (others.ok) {
    for (const rel of others.out.split('\n').map((s) => s.trim()).filter(Boolean)) {
      try {
        const abs = join(root, rel)
        if (abs !== root && abs.startsWith(root + sep)) {
          rmSync(abs, { force: true })
          removed += 1
        }
      } catch { /* 忽略单个文件 */ }
    }
  }
  return { ok: true, hash, removed }
}

/** 读取/写入 manifest.json 的 version 并做语义化自增 */
function bumpManifestVersion(root: string, level: 'patch' | 'minor' | 'major'): { ok: boolean; version?: string; err?: string } {
  const mfPath = join(root, 'manifest.json')
  if (!existsSync(mfPath)) return { ok: false, err: 'manifest.json 不存在' }
  let mf: any
  try { mf = JSON.parse(readFileSync(mfPath, 'utf-8')) } catch (e) { return { ok: false, err: 'manifest.json 解析失败' } }
  const cur = String(mf.version || '1.0.0')
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)/)
  let major = m ? parseInt(m[1], 10) : 1
  let minor = m ? parseInt(m[2], 10) : 0
  let patch = m ? parseInt(m[3], 10) : 0
  if (level === 'major') { major++; minor = 0; patch = 0 }
  else if (level === 'minor') { minor++; patch = 0 }
  else patch++
  const next = `${major}.${minor}.${patch}`
  mf.version = next
  try { writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n', 'utf-8') } catch { return { ok: false, err: '写入 manifest.json 失败' } }
  return { ok: true, version: next }
}

export function onLoad() {}
export function onUnload() {
  // 释放可能持有的 CodeGraph sqlite 句柄
  for (const root of [...cgByRoot.keys()]) closeCodeGraph(root)
}
export function onEnable() {}
export function onDisable() {}

export async function run(_context: unknown) {}

/** 当前 Vibe 会话允许写入的根目录（由 vibe_begin 设置） */
let sessionRoot = ''

/**
 * 写入快照：root(绝对) -> (相对路径 -> 原始内容)。
 * 值为 string 表示文件原本存在且记录了原文；值为 null 表示文件原本不存在（新增）。
 * 仅在「会话内首次写入某路径」时记录，确保 before 反映的是会话开始时的状态。
 * 跨 vibe_end 保留，便于交付页在生成结束后仍能展示/回滚；下次 vibe_begin({fresh:true}) 才清空。
 */
const snapshotsByRoot = new Map<string, Map<string, string | null>>()

/** 生成时忽略的目录/文件 */
const IGNORED = new Set(['node_modules', 'dist', 'build', '.git', '.DS_Store', '.vite', '.codegraph'])
/** 单文件读取上限（字符） */
const MAX_READ_CHARS = 200_000
/** 单文件写入上限（字节） */
const MAX_WRITE_BYTES = 1_000_000
/** list_dir 返回条目上限（仅用于「结构概览」，配合 truncated 标记） */
const MAX_LIST_ENTRIES = 400
/** 内容扫描（grep / 一致性校验）遍历文件上限：远高于 list_dir，避免大项目静默漏扫文件 */
const MAX_SCAN_ENTRIES = 5000
/** changes 接口里单文件 before/after 的内容上限（避免 IPC 过大） */
const MAX_DIFF_CHARS = 60_000

/** 构建失败日志是否提示「依赖缺失」（与宿主 buildPlugin 的判定保持一致），用于自动 npm install 兜底 */
function looksLikeMissingDeps(log: string): boolean {
  const text = (log || '').toLowerCase()
  return (
    text.includes('command not found') ||
    text.includes('cannot find module') ||
    text.includes('module not found') ||
    text.includes('cannot find package') ||
    text.includes('err_module_not_found') ||
    text.includes('could not determine executable to run') ||
    text.includes('is not recognized') ||
    text.includes('esbuild: not found') ||
    text.includes('vite: not found')
  )
}

/** 把可能是相对/绝对的路径解析为指定根目录内的绝对路径，越界则抛错 */
function resolveInside(root: string, inputPath: string): string {
  if (!root) {
    throw new Error('Vibe 会话未初始化：请先调用 vibe_begin({ root })')
  }
  const raw = String(inputPath || '').trim()
  if (!raw) throw new Error('path 不能为空')
  const abs = resolve(root, raw)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`拒绝越界访问：${abs} 不在会话目录 ${root} 内`)
  }
  return abs
}

/** 把可能是相对/绝对的路径解析为当前会话根目录内的绝对路径，越界则抛错 */
function resolveInRoot(inputPath: string): string {
  return resolveInside(sessionRoot, inputPath)
}

/** 递归列出文件（相对路径），跳过依赖/产物目录，限量返回。limit 默认按 list_dir 概览上限 */
function walk(dir: string, baseForRel: string, acc: string[], limit: number = MAX_LIST_ENTRIES): void {
  if (acc.length >= limit) return
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (acc.length >= limit) return
    if (IGNORED.has(name)) continue
    const full = join(dir, name)
    let isDir = false
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walk(full, baseForRel, acc, limit)
    } else {
      acc.push(relative(baseForRel, full).split(sep).join('/'))
    }
  }
}

/** 把简单 glob（支持 * 与 **）转为正则，匹配相对路径 */
function globToRegExp(glob: string): RegExp | null {
  const g = String(glob || '').trim()
  if (!g) return null
  const esc = g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = esc.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  try { return new RegExp('^' + body + '$') } catch { return null }
}


/** 记录某路径在会话内的首次原始状态（用于回滚/diff） */
function recordSnapshot(root: string, rel: string, abs: string): void {
  let snaps = snapshotsByRoot.get(root)
  if (!snaps) {
    snaps = new Map<string, string | null>()
    snapshotsByRoot.set(root, snaps)
  }
  if (snaps.has(rel)) return // 仅记录首次
  if (existsSync(abs) && statSync(abs).isFile()) {
    try {
      snaps.set(rel, readFileSync(abs, 'utf-8'))
    } catch {
      snaps.set(rel, null)
    }
  } else {
    snaps.set(rel, null) // 原本不存在 → 新增
  }
}

// ---------------- CodeGraph 集成（可选，优雅降级） ----------------

/** 缓存：库构造器；'unavailable' 表示加载失败已确认 */
let CodeGraphCtor: any = undefined
/** root(绝对) -> CodeGraph 实例 */
const cgByRoot = new Map<string, any>()

/** 懒加载 CodeGraph 库；不可用返回 null（已缓存判定结果） */
async function loadCodeGraph(): Promise<any | null> {
  if (CodeGraphCtor === 'unavailable') return null
  if (CodeGraphCtor !== undefined) return CodeGraphCtor
  try {
    const mod: any = await import('@colbymchenry/codegraph')
    CodeGraphCtor = mod?.default ?? mod?.CodeGraph ?? null
    if (!CodeGraphCtor) CodeGraphCtor = 'unavailable'
  } catch {
    CodeGraphCtor = 'unavailable'
  }
  return CodeGraphCtor === 'unavailable' ? null : CodeGraphCtor
}

/** 带超时的 Promise，超时抛错 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} 超时（>${ms}ms）`)), ms))
  ])
}

/** 获取/创建某根目录的 CodeGraph 实例（首次会建图，可能较慢） */
async function ensureCodeGraph(root: string): Promise<any | null> {
  const CG = await loadCodeGraph()
  if (!CG) return null
  const existing = cgByRoot.get(root)
  if (existing) return existing
  let inst: any
  if (typeof CG.isInitialized === 'function' && CG.isInitialized(root)) {
    inst = await withTimeout(CG.open(root, { sync: true }), 60_000, 'CodeGraph.open')
  } else {
    inst = await withTimeout(CG.init(root, { index: true }), 90_000, 'CodeGraph.index')
  }
  cgByRoot.set(root, inst)
  return inst
}

/** 关闭并清理某根目录的 CodeGraph 实例 */
function closeCodeGraph(root: string): void {
  const inst = cgByRoot.get(root)
  if (inst) {
    try { inst.close?.() } catch { /* ignore */ }
    cgByRoot.delete(root)
  }
}

export const rpc = {
  /**
   * 开启一个生成会话，锁定允许读写的根目录（必须是已存在的目录）。
   * @param input.root 会话根目录
   * @param input.fresh 为 true 时清空该根目录的历史快照（标记新会话开始）
   */
  vibe_begin(input: { root?: string; fresh?: boolean }) {
    const root = resolve(String(input?.root || '').trim())
    if (!root) throw new Error('缺少 root')
    if (!existsSync(root)) throw new Error(`目录不存在：${root}`)
    if (!statSync(root).isDirectory()) throw new Error(`不是目录：${root}`)
    sessionRoot = root
    if (input?.fresh) {
      snapshotsByRoot.set(root, new Map<string, string | null>())
    } else if (!snapshotsByRoot.has(root)) {
      snapshotsByRoot.set(root, new Map<string, string | null>())
    }
    // 影子库自动快照：在 AI 改动之前留一个还原点（"AI 写崩→一键回到改动前"）。
    // nochange 时跳过；失败不影响会话（git 不可用等优雅降级）。
    try { takeSnapshot(root, input?.fresh ? '新会话基线' : 'AI 改动前') } catch { /* 忽略 */ }
    return { ok: true, root }
  },

  /** 结束会话：解除当前根目录锁定并释放 CodeGraph 句柄；快照保留以供交付页 diff/回滚 */
  vibe_end() {
    if (sessionRoot) closeCodeGraph(sessionRoot)
    sessionRoot = ''
    return { ok: true }
  },

  /** 列出会话目录内的文件（相对路径数组），供 AI 了解脚手架结构 */
  list_dir(input: { path?: string }) {
    const base = resolveInRoot(input?.path || '.')
    if (!existsSync(base)) return { exists: false, files: [] as string[] }
    const acc: string[] = []
    walk(base, sessionRoot, acc)
    return {
      exists: true,
      root: sessionRoot,
      truncated: acc.length >= MAX_LIST_ENTRIES,
      files: acc
    }
  },

  /** 读取会话目录内的文本文件 */
  read_file(input: { path?: string }) {
    const abs = resolveInRoot(input?.path || '')
    if (!existsSync(abs)) return { exists: false, content: '' }
    if (statSync(abs).isDirectory()) throw new Error(`是目录而非文件：${input?.path}`)
    let content = readFileSync(abs, 'utf-8')
    let truncated = false
    if (content.length > MAX_READ_CHARS) {
      content = content.slice(0, MAX_READ_CHARS)
      truncated = true
    }
    return { exists: true, content, truncated }
  },

  /** 写入会话目录内的文件（自动递归创建父目录；写入前记录原文快照） */
  write_file(input: { path?: string; content?: string }) {
    const abs = resolveInRoot(input?.path || '')
    const content = String(input?.content ?? '')
    const bytes = Buffer.byteLength(content, 'utf-8')
    if (bytes > MAX_WRITE_BYTES) {
      throw new Error(`内容过大（${bytes} 字节 > ${MAX_WRITE_BYTES}）`)
    }
    const rel = relative(sessionRoot, abs).split(sep).join('/') || abs
    recordSnapshot(sessionRoot, rel, abs)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
    return { ok: true, path: rel, bytes }
  },

  /**
   * 对会话目录内的已存在文件做「查找替换」式增量编辑（比整文件 write_file 更省 token、改大文件更稳）。
   * oldText 必须与文件内容逐字匹配（含缩进/换行）；默认要求唯一匹配，多处需 replaceAll:true。
   */
  edit_file(input: { path?: string; oldText?: string; newText?: string; replaceAll?: boolean }) {
    const abs = resolveInRoot(input?.path || '')
    if (!existsSync(abs)) throw new Error(`文件不存在：${input?.path}（新文件请用 write_file 创建）`)
    if (statSync(abs).isDirectory()) throw new Error(`是目录而非文件：${input?.path}`)
    const oldText = String(input?.oldText ?? '')
    const newText = String(input?.newText ?? '')
    if (!oldText) throw new Error('oldText 不能为空')
    const content = readFileSync(abs, 'utf-8')
    const count = content.split(oldText).length - 1
    if (count === 0) throw new Error('未找到 oldText：请确保与文件内容完全一致（含缩进与换行），或先 read_file 核对')
    if (count > 1 && !input?.replaceAll) throw new Error(`oldText 匹配到 ${count} 处：请提供更长的唯一上下文，或传 replaceAll:true`)
    const updated = input?.replaceAll ? content.split(oldText).join(newText) : content.replace(oldText, newText)
    const bytes = Buffer.byteLength(updated, 'utf-8')
    if (bytes > MAX_WRITE_BYTES) throw new Error(`内容过大（${bytes} 字节 > ${MAX_WRITE_BYTES}）`)
    const rel = relative(sessionRoot, abs).split(sep).join('/') || abs
    recordSnapshot(sessionRoot, rel, abs)
    writeFileSync(abs, updated, 'utf-8')
    return { ok: true, path: rel, replaced: input?.replaceAll ? count : 1, bytes }
  },

  /** 在会话目录内按内容搜索（文本或正则），可选 glob 过滤文件，返回命中行 */
  grep(input: { query?: string; glob?: string; isRegex?: boolean; ignoreCase?: boolean; maxResults?: number }) {
    if (!sessionRoot) throw new Error('Vibe 会话未初始化：请先调用 vibe_begin({ root })')
    const q = String(input?.query || '')
    if (!q) throw new Error('query 不能为空')
    let re: RegExp
    try {
      const pattern = input?.isRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      re = new RegExp(pattern, input?.ignoreCase ? 'i' : '')
    } catch {
      throw new Error('正则表达式无效')
    }
    const globRe = input?.glob ? globToRegExp(input.glob) : null
    const files: string[] = []
    walk(sessionRoot, sessionRoot, files, MAX_SCAN_ENTRIES)
    const max = Math.min(typeof input?.maxResults === 'number' ? input.maxResults : 100, 500)
    const matches: Array<{ path: string; line: number; text: string }> = []
    for (const rel of files) {
      if (globRe && !globRe.test(rel)) continue
      let content: string
      try { content = readFileSync(join(sessionRoot, rel), 'utf-8') } catch { continue }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, 300) })
          if (matches.length >= max) return { truncated: true, matches }
        }
      }
    }
    return { truncated: false, matches }
  },

  /** 在会话目录跑 `npm run build`，返回构建是否通过与日志尾部，供 AI 自检与自纠正 */
  async build_check() {
    if (!sessionRoot) throw new Error('Vibe 会话未初始化：请先调用 vibe_begin({ root })')
    const cwd = sessionRoot
    const runCmd = (cmd: string, timeoutMs = 180_000) =>
      new Promise<{ code: number | null; timedOut?: boolean; log: string }>((res) => {
        let out = ''
        let child: ReturnType<typeof spawn>
        try {
          child = spawn(cmd, { cwd, shell: true, env: process.env })
        } catch (e) {
          res({ code: -1, log: e instanceof Error ? e.message : '无法启动进程' })
          return
        }
        const timer = setTimeout(() => {
          try { child.kill() } catch { /* ignore */ }
          res({ code: -1, timedOut: true, log: (out.slice(-6000) + '\n[命令超时被终止]') })
        }, timeoutMs)
        child.stdout?.on('data', (d) => { out += d.toString() })
        child.stderr?.on('data', (d) => { out += d.toString() })
        child.on('error', (e) => { clearTimeout(timer); res({ code: -1, log: (out + '\n' + (e?.message || '进程错误')).slice(-6000) }) })
        child.on('close', (code) => { clearTimeout(timer); res({ code, log: out.slice(-6000) }) })
      })

    const first = await runCmd('npm run build')
    if (first.code === 0) return { success: true, code: 0, log: first.log }
    // 兜底：新脚手架/未装依赖时 npm run build 会因 vite/esbuild 缺失而必失败。
    // 与宿主 buildPlugin 一致——命中依赖缺失特征则自动 npm install 后重试一次，避免 AI「自检构建」每次都失败。
    if (looksLikeMissingDeps(first.log) && !first.timedOut) {
      const install = await runCmd('npm install --no-audit --no-fund', 300_000)
      const retry = await runCmd('npm run build')
      const log = (
        `${first.log}\n\n[auto-fix] 检测到依赖缺失，已自动 npm install 后重试构建\n` +
        `${install.log}\n\n[auto-fix] 重试构建结果\n${retry.log}`
      ).slice(-6000)
      return { success: retry.code === 0, code: retry.code ?? undefined, log }
    }
    return { success: false, code: first.code ?? undefined, timedOut: first.timedOut, log: first.log }
  },


  /**
   * 契约一致性静态校验：把 develop-mulby-plugin 技能 Handoff Checklist 里
   * 「manifest 必须与真实文件/代码对得上」那一类检查变成可机械执行的门禁，
   * 取代以往只靠 prompt 散文叮嘱 + 人工核对。纯只读，可在构建前后反复调用。
   *
   * 返回 issues（error 会阻断「就绪」判定，warn/info 仅提示）。AI 在生成结束前应
   * 调用本工具并据 error 自行修复；交付页也会自动展示并提供「AI 修复一致性问题」。
   */
  check_conformance(input: { root?: string }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    type Issue = { level: 'error' | 'warn' | 'info'; code: string; message: string; hint?: string }
    const issues: Issue[] = []
    if (!root || !existsSync(root)) {
      return { ok: false, ran: false, issues: [{ level: 'error', code: 'no-root', message: '目标目录不存在' }] as Issue[] }
    }
    const mfPath = join(root, 'manifest.json')
    if (!existsSync(mfPath)) {
      return { ok: false, ran: true, issues: [{ level: 'error', code: 'no-manifest', message: '缺少 manifest.json' }] as Issue[] }
    }
    let mf: any
    try {
      mf = JSON.parse(readFileSync(mfPath, 'utf-8'))
    } catch {
      return { ok: false, ran: true, issues: [{ level: 'error', code: 'manifest-parse', message: 'manifest.json 无法解析（JSON 语法错误）' }] as Issue[] }
    }

    // 收集源码文本（src/** 与根级脚本），用于「功能码被引用 / 工具已注册」的启发式检查
    const srcFiles: string[] = []
    const srcDir = join(root, 'src')
    if (existsSync(srcDir)) walk(srcDir, root, srcFiles, MAX_SCAN_ENTRIES)
    let combined = ''
    for (const rel of srcFiles) {
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|html)$/.test(rel)) continue
      try { combined += '\n' + readFileSync(join(root, rel), 'utf-8') } catch { /* ignore */ }
    }
    const has = (s: string) => combined.includes(s)

    const features: any[] = Array.isArray(mf.features) ? mf.features : []
    if (features.length === 0) {
      issues.push({ level: 'error', code: 'no-features', message: 'manifest.features 为空，插件没有任何可触发的功能' })
    }
    features.forEach((f, i) => {
      if (!f || !String(f.code || '').trim()) {
        issues.push({ level: 'error', code: 'feature-no-code', message: `features[${i}] 缺少 code` })
      }
    })

    // —— UI 形态一致性：声明 ui 入口 ⟺ 有 ui/detached 功能 ⟺ 有界面源码 ——
    const declaresUi = typeof mf.ui === 'string' && mf.ui.trim().length > 0
    const hasUiFeature = features.some((f) => f && (f.mode === 'ui' || f.mode === 'detached'))
    const uiSrcExists = srcFiles.some((r) => r.startsWith('src/ui/') && /\.(tsx|jsx|html)$/.test(r))
    if (declaresUi && !uiSrcExists) {
      issues.push({ level: 'error', code: 'ui-declared-no-source', message: 'manifest 声明了 ui 入口，但 src/ui 下没有界面源码', hint: '要么补齐 src/ui 入口与组件，要么从 manifest 去掉 ui（无界面插件）' })
    }
    if (!declaresUi && hasUiFeature) {
      issues.push({ level: 'error', code: 'ui-feature-no-entry', message: '存在 ui/detached 功能，但 manifest 未声明 ui 入口，窗口将无法打开', hint: '给 manifest 加 ui 入口并实现界面，或把该功能改为 silent' })
    }
    if (declaresUi && !hasUiFeature) {
      issues.push({ level: 'warn', code: 'ui-entry-no-feature', message: 'manifest 声明了 ui 入口，但没有任何 ui/detached 功能会用到它' })
    }
    if (!declaresUi && uiSrcExists) {
      issues.push({ level: 'info', code: 'ui-source-unused', message: 'src/ui 存在界面源码，但 manifest 未声明 ui 入口（可能是多余的脚手架残留）' })
    }

    // —— 每个 feature.code 应在源码中被处理（多功能时才查，单功能常不分支，避免误报）——
    if (features.length > 1) {
      for (const f of features) {
        const code = String(f?.code || '').trim()
        if (code && !has(code)) {
          issues.push({ level: 'warn', code: 'feature-unhandled', message: `功能「${code}」在源码中未被引用，可能没有对应的处理分支`, hint: '后端在 run(context) 中用 context.featureCode 区分，前端按功能码路由/渲染' })
        }
      }
    }

    // —— manifest.tools 必须在 host-worker 内 register ——
    const tools: any[] = Array.isArray(mf.tools) ? mf.tools : []
    if (tools.length) {
      const hasRegisterCall = /\.tools\.register\s*\(/.test(combined)
      if (!hasRegisterCall) {
        issues.push({ level: 'error', code: 'tools-not-registered', message: 'manifest.tools 已声明，但源码中找不到任何 tools.register(...) 调用', hint: '在 onLoad 里用 mulby.tools.register(name, handler) / context.api.tools.register 注册每个工具' })
      } else {
        for (const t of tools) {
          const name = String(t?.name || '').trim()
          if (name && !has(name)) {
            issues.push({ level: 'error', code: 'tool-handler-missing', message: `声明的工具「${name}」未在源码中注册 handler` })
          }
        }
      }
    }

    // —— preload 路径必须存在 ——
    if (typeof mf.preload === 'string' && mf.preload.trim()) {
      if (!existsSync(join(root, mf.preload))) {
        issues.push({ level: 'error', code: 'preload-missing', message: `manifest.preload 指向的文件不存在：${mf.preload}` })
      }
    }

    // —— 后端源码与构建产物（产物缺失只提示，因为可能尚未构建）——
    if (!srcFiles.includes('src/main.ts') && !has('export') ) {
      issues.push({ level: 'warn', code: 'no-backend-src', message: '未找到后端源码 src/main.ts' })
    }
    if (typeof mf.main === 'string' && mf.main.trim() && !existsSync(join(root, mf.main))) {
      issues.push({ level: 'info', code: 'not-built', message: `构建产物尚未生成：${mf.main}（构建后出现）` })
    }

    const ok = !issues.some((i) => i.level === 'error')
    const errors = issues.filter((i) => i.level === 'error').length
    const warns = issues.filter((i) => i.level === 'warn').length
    return { ok, ran: true, issues, summary: ok ? (warns ? `通过（${warns} 处提示）` : '通过') : `${errors} 处需修复` }
  },

  /**
   * 列出本次会话相对开始时的改动（新增/修改），供交付页 diff 展示。
   * @param input.root 目标根目录（一般是 createdPath）
   */
  vibe_changes(input: { root?: string }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    if (!root) return { root: '', changes: [] as Array<{ path: string; status: string; before: string | null; after: string | null }> }
    const snaps = snapshotsByRoot.get(root)
    if (!snaps || snaps.size === 0) return { root, changes: [] }
    const changes: Array<{ path: string; status: 'added' | 'modified' | 'deleted'; before: string | null; after: string | null; truncated?: boolean }> = []
    for (const [rel, before] of snaps.entries()) {
      let abs: string
      try { abs = resolveInside(root, rel) } catch { continue }
      const nowExists = existsSync(abs) && statSync(abs).isFile()
      const after = nowExists ? readFileSync(abs, 'utf-8') : null
      let status: 'added' | 'modified' | 'deleted'
      if (before === null) {
        if (!nowExists) continue // 新增后又被回滚/删除，无净改动
        status = 'added'
      } else if (!nowExists) {
        status = 'deleted'
      } else {
        if (after === before) continue // 无净改动
        status = 'modified'
      }
      const clip = (s: string | null) => (s != null && s.length > MAX_DIFF_CHARS ? s.slice(0, MAX_DIFF_CHARS) : s)
      const truncated = (before != null && before.length > MAX_DIFF_CHARS) || (after != null && after.length > MAX_DIFF_CHARS)
      changes.push({ path: rel, status, before: clip(before), after: clip(after), truncated })
    }
    changes.sort((a, b) => a.path.localeCompare(b.path))
    return { root, changes }
  },

  /**
   * 回滚本次会话的全部改动：新增文件被删除，修改文件还原为原文。回滚后清空快照。
   * @param input.root 目标根目录
   */
  vibe_rollback(input: { root?: string }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    if (!root) throw new Error('缺少 root')
    const snaps = snapshotsByRoot.get(root)
    if (!snaps || snaps.size === 0) return { ok: true, restored: 0, removed: 0 }
    let restored = 0
    let removed = 0
    const errors: string[] = []
    for (const [rel, before] of snaps.entries()) {
      let abs: string
      try { abs = resolveInside(root, rel) } catch { continue }
      try {
        if (before === null) {
          if (existsSync(abs)) { rmSync(abs, { force: true }); removed++ }
        } else {
          mkdirSync(dirname(abs), { recursive: true })
          writeFileSync(abs, before, 'utf-8')
          restored++
        }
      } catch (e) {
        errors.push(`${rel}: ${e instanceof Error ? e.message : '回滚失败'}`)
      }
    }
    snapshotsByRoot.set(root, new Map<string, string | null>())
    return { ok: errors.length === 0, restored, removed, errors }
  },

  /** 探测 CodeGraph 是否可用（运行时能否加载库） */
  async cg_status() {
    const CG = await loadCodeGraph()
    return { available: !!CG }
  },

  /**
   * 基于代码知识图谱，构建与需求相关的代码上下文（markdown），供注入 AI 提示词。
   * 首次调用会对目标目录建图（可能耗时）；失败/超时则返回 available:false 优雅降级。
   * @param input.root 目标插件目录
   * @param input.query 需求/任务描述（自然语言）
   */
  async cg_context(input: { root?: string; query?: string; maxNodes?: number; maxCodeBlocks?: number }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    const query = String(input?.query || '').trim()
    if (!root || !query) return { available: false, reason: '缺少 root 或 query' }
    try {
      const inst = await ensureCodeGraph(root)
      if (!inst) return { available: false, reason: '当前运行时不支持 CodeGraph（需 Node 22.5+ 的 node:sqlite）' }
      const md = await withTimeout(
        inst.buildContext(query, {
          format: 'markdown',
          includeCode: true,
          maxNodes: typeof input?.maxNodes === 'number' ? input.maxNodes : 30,
          maxCodeBlocks: typeof input?.maxCodeBlocks === 'number' ? input.maxCodeBlocks : 8
        }),
        45_000,
        'CodeGraph.buildContext'
      )
      let nodeCount = 0
      let fileCount = 0
      try {
        const s = inst.getStats?.()
        nodeCount = s?.nodeCount ?? 0
        fileCount = s?.fileCount ?? 0
      } catch { /* ignore */ }
      const markdown = String(md ?? '')
      return { available: true, markdown: markdown.slice(0, 24_000), nodeCount, fileCount }
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : 'CodeGraph 构建上下文失败' }
    }
  },

  /**
   * 评估改动某符号的影响半径（受影响文件列表），用于交付/契约页提示。best-effort。
   * @param input.root 目标插件目录
   * @param input.symbol 要查询的符号名（函数/类/方法）
   */
  async cg_impact(input: { root?: string; symbol?: string; depth?: number }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    const symbol = String(input?.symbol || '').trim()
    if (!root || !symbol) return { available: false, reason: '缺少 root 或 symbol' }
    try {
      const inst = await ensureCodeGraph(root)
      if (!inst) return { available: false }
      const results = inst.searchNodes?.(symbol, { limit: 1 }) || []
      if (!results.length) return { available: true, found: false, symbol }
      const nodeId = results[0]?.node?.id
      if (!nodeId) return { available: true, found: false, symbol }
      const sub = inst.getImpactRadius?.(nodeId, typeof input?.depth === 'number' ? input.depth : 2)
      const files = new Set<string>()
      const nodes = sub?.nodes
      if (nodes && typeof nodes.forEach === 'function') {
        nodes.forEach((n: any) => {
          const f = n?.file || n?.filePath || n?.path
          if (typeof f === 'string' && f) files.add(f)
        })
      }
      return { available: true, found: true, symbol, impactedFiles: [...files].slice(0, 50), count: files.size }
    } catch (e) {
      return { available: false, reason: e instanceof Error ? e.message : 'impact 失败' }
    }
  },

  /** 版本管理：探测 git 是否可用 + 该目录是否已有影子快照历史 */
  vcs_status(input: { root?: string }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    if (!gitAvailable()) return { available: false, reason: '系统未安装 git' }
    if (!root || !existsSync(root)) return { available: true, repo: false }
    return { available: true, repo: shadowRepoReady(root) }
  },

  /**
   * 提交一个版本快照（自动 init 仓库）。无改动返回 nochange:true。
   * 可选 bump：提交前对 manifest.json 版本号自增；可选 tag：打 v<version> 标签。
   */
  vcs_commit(input: { root?: string; message?: string; bump?: 'patch' | 'minor' | 'major'; tag?: boolean }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    if (!root || !existsSync(root)) return { ok: false, reason: '目录不存在' }
    if (!gitAvailable()) return { ok: false, available: false, reason: '系统未安装 git' }
    let version: string | undefined
    if (input?.bump) {
      const b = bumpManifestVersion(root, input.bump)
      if (b.ok) version = b.version
    } else {
      try { version = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'))?.version } catch { /* ignore */ }
    }
    // 写入影子库（不污染插件目录）
    const snap = takeSnapshot(root, String(input?.message || '更新'))
    if (!snap.ok) return { ok: false, available: snap.available, reason: snap.reason }
    if (snap.nochange) return { ok: true, nochange: true, version }
    if (input?.tag && version) sgit(root, ['tag', '-f', `v${version}`])
    return { ok: true, hash: snap.hash, version }
  },

  /** 读取版本历史（提交列表，含 tag 引用） */
  vcs_log(input: { root?: string; limit?: number }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    if (!gitAvailable()) return { available: false, commits: [] as unknown[] }
    if (!root || !shadowRepoReady(root)) return { available: true, repo: false, commits: [] as unknown[] }
    const limit = Math.min(typeof input?.limit === 'number' ? input.limit : 50, 200)
    const SEP = '\x1f'
    const r = sgit(root, ['log', '-n', String(limit), `--pretty=format:%H${SEP}%h${SEP}%s${SEP}%cI${SEP}%D`])
    if (!r.ok) return { available: true, repo: true, commits: [] as unknown[] }
    const commits = r.out.split('\n').filter(Boolean).map((line) => {
      const [hash, short, message, dateISO, refs] = line.split(SEP)
      const tags = (refs || '').split(',').map((s) => s.trim()).filter((s) => s.startsWith('tag: ')).map((s) => s.slice(5))
      return { hash, short, message, dateISO, tags }
    })
    return { available: true, repo: true, commits }
  },

  /** 查看某次提交的改动（patch）；不传 hash 看工作区相对 HEAD 的改动 */
  vcs_diff(input: { root?: string; hash?: string }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    if (!gitAvailable() || !root || !shadowRepoReady(root)) return { available: false, patch: '' }
    const hash = String(input?.hash || '').trim()
    const r = hash
      ? sgit(root, ['show', '--no-color', '--stat', '-p', hash])
      : sgit(root, ['diff', '--no-color', 'HEAD'])
    let patch = r.out || ''
    let truncated = false
    if (patch.length > 80_000) { patch = patch.slice(0, 80_000); truncated = true }
    return { available: true, patch, truncated }
  },

  /**
   * 回滚到某版本：先把未提交改动自动存为一个提交（不丢东西），再用该提交文件覆盖工作区。
   * 覆盖后工作区为未提交状态，交由前端重新构建载入并提交一条「回滚」记录。
   */
  vcs_restore(input: { root?: string; hash?: string }) {
    const root = resolve(String(input?.root || sessionRoot || '').trim())
    const hash = String(input?.hash || '').trim()
    // 影子库回滚：回滚前自动快照（可逆）→ 目标树覆盖工作区（批量，失败降级单文件）→ 物理删未跟踪残留
    return restoreSnapshot(root, hash)
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin
