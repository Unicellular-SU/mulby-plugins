/// <reference path="./types/mulby.d.ts" />
import { ICON_MAP } from './shared/icons'

// 运行时由 Mulby 宿主注入全局 API 代理
declare const mulby: any

// ─── 数据模型 ───────────────────────────────────────────────────────
type ItemType = 'search' | 'workspace'

type ActionKind = 'url' | 'folder' | 'file' | 'command'

interface WorkspaceAction {
  kind: ActionKind
  value: string
  args?: string[]
}

interface LaunchItem {
  id: string
  type: ItemType
  title: string
  keywords: string[]
  icon?: string
  group?: string
  usageCount?: number
  lastUsed?: number
  // search 专用：含 {query} 占位符的 URL
  url?: string
  // workspace 专用：批量执行的动作
  actions?: WorkspaceAction[]
}

const STORAGE_KEY = 'launch:items'
const LAUNCH_FEATURE_CODE = 'launch'

// ─── 模块状态 ───────────────────────────────────────────────────────
let api: any = null
let items: LaunchItem[] = []
let loaded = false
let handlersRegistered = false

function getApi(): any {
  return api || (typeof mulby !== 'undefined' ? mulby : null)
}

function notify(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  try {
    getApi()?.notification?.show(message, type)
  } catch {
    /* notification 不可用时静默 */
  }
}

// ─── 首次使用的默认条目 ─────────────────────────────────────────────
function defaultItems(): LaunchItem[] {
  const now = Date.now()
  const make = (
    title: string,
    keywords: string[],
    url: string,
    icon: string
  ): LaunchItem => ({
    id: `seed-${keywords[0]}-${now}`,
    type: 'search',
    title,
    keywords,
    icon,
    group: '搜索引擎',
    url,
    usageCount: 0
  })
  return [
    make('Google', ['g', 'google'], 'https://www.google.com/search?q={query}', 'globe'),
    make('百度', ['bd', '百度'], 'https://www.baidu.com/s?wd={query}', 'search'),
    make('GitHub', ['gh', 'github'], 'https://github.com/search?q={query}&type=repositories', 'git-branch'),
    make('Bilibili', ['bili', 'b站'], 'https://search.bilibili.com/all?keyword={query}', 'play'),
    make('MDN', ['mdn'], 'https://developer.mozilla.org/zh-CN/search?q={query}', 'book-open')
  ]
}

// 将图标名渲染为 data URL（供 MainPush 结果项 icon 字段使用）
function iconDataUrl(name: string | undefined, fallback: string): string | undefined {
  const body = (name && ICON_MAP[name]) || ICON_MAP[fallback]
  if (!body) return undefined
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" ` +
    `fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64')
}

// 兼容旧数据：把 emoji / 未知图标统一迁移为内置图标名
function normalizeIcons(list: LaunchItem[]): boolean {
  let changed = false
  for (const it of list) {
    if (!it.icon || !ICON_MAP[it.icon]) {
      it.icon = it.type === 'search' ? 'search' : 'layers'
      changed = true
    }
  }
  return changed
}

// ─── 持久化 ─────────────────────────────────────────────────────────
async function loadItems(): Promise<void> {
  const a = getApi()
  if (!a?.storage) {
    items = []
    loaded = true
    return
  }
  try {
    const raw = await a.storage.get(STORAGE_KEY)
    if (Array.isArray(raw)) {
      items = raw as LaunchItem[]
      if (normalizeIcons(items)) await a.storage.set(STORAGE_KEY, items)
    } else {
      // 首次运行：写入默认条目
      items = defaultItems()
      await a.storage.set(STORAGE_KEY, items)
    }
  } catch {
    items = []
  }
  loaded = true
}

async function persistItems(): Promise<void> {
  const a = getApi()
  if (!a?.storage) return
  try {
    await a.storage.set(STORAGE_KEY, items)
  } catch {
    /* ignore */
  }
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await loadItems()
}

// ─── 匹配逻辑（驱动 MainPush） ──────────────────────────────────────
interface Match {
  item: LaunchItem
  query: string
  score: number
}

function matchItems(rawInput: string): Match[] {
  const q = (rawInput || '').trim()
  if (!q) return []
  const lower = q.toLowerCase()
  const firstSpace = q.indexOf(' ')
  const head = (firstSpace === -1 ? q : q.slice(0, firstSpace)).toLowerCase()
  const rest = firstSpace === -1 ? '' : q.slice(firstSpace + 1).trim()

  const matches: Match[] = []
  for (const item of items) {
    const kws = (item.keywords || []).map((k) => k.toLowerCase())
    const title = (item.title || '').toLowerCase()
    let score = 0
    let query = ''

    if (kws.includes(head)) {
      // 触发词精确命中：关键词 + 空格 + 搜索词
      score = 1000
      query = rest
    } else if (kws.some((k) => k.startsWith(head)) && head.length >= 1) {
      // 触发词前缀命中
      score = 400
      query = rest
    } else if (title.includes(lower) || kws.some((k) => k.includes(lower))) {
      // 标题/关键词模糊命中（无法确定搜索词）
      score = 150
      query = ''
    } else {
      continue
    }

    score += Math.min(item.usageCount || 0, 100)
    matches.push({ item, query, score })
  }

  matches.sort((a, b) => b.score - a.score)
  return matches.slice(0, 8)
}

function describeItem(m: Match): { title: string; text: string } {
  if (m.item.type === 'search') {
    if (m.query) {
      return {
        title: `${m.item.title}：${m.query}`,
        text: `在 ${m.item.title} 中搜索`
      }
    }
    return {
      title: m.item.title,
      text: `打开 ${m.item.title}（关键词 + 空格 + 搜索词可直接搜索）`
    }
  }
  const count = m.item.actions?.length || 0
  return {
    title: m.item.title,
    text: `工作区 · ${count} 个动作`
  }
}

// ─── 执行 ───────────────────────────────────────────────────────────
async function executeItem(item: LaunchItem, query: string): Promise<void> {
  const a = getApi()
  if (!a?.shell) throw new Error('shell API 不可用')

  if (item.type === 'search') {
    let url = item.url || ''
    if (!url) throw new Error('搜索引擎未配置 URL')
    if (url.includes('{query}')) {
      url = url.replace(/\{query\}/g, encodeURIComponent(query || ''))
    }
    await a.shell.openExternal(url)
    return
  }

  // workspace：顺序执行所有动作，单个失败不阻断其余
  const errors: string[] = []
  for (const action of item.actions || []) {
    const value = (action.value || '').trim()
    if (!value) continue
    try {
      if (action.kind === 'url') {
        await a.shell.openExternal(value)
      } else if (action.kind === 'folder') {
        await a.shell.openFolder(value)
      } else if (action.kind === 'file') {
        await a.shell.openPath(value)
      } else if (action.kind === 'command') {
        await a.shell.runCommand({
          command: value,
          args: Array.isArray(action.args) ? action.args : [],
          shell: false,
          executionProfile: 'workspace',
          timeoutMs: 15000
        })
      }
    } catch (e) {
      errors.push(`${action.kind}: ${value}`)
    }
  }
  if (errors.length) {
    throw new Error(`${errors.length} 个动作执行失败`)
  }
}

async function bumpUsage(id: string): Promise<void> {
  const item = items.find((i) => i.id === id)
  if (!item) return
  item.usageCount = (item.usageCount || 0) + 1
  item.lastUsed = Date.now()
  await persistItems()
}

// ─── MainPush 注册 ──────────────────────────────────────────────────
async function registerMainPush(): Promise<void> {
  const a = getApi()
  if (handlersRegistered || !a?.features?.onMainPush || !a?.features?.onMainPushSelect) return

  await a.features.onMainPush(async (action: any) => {
    if (action.code !== LAUNCH_FEATURE_CODE) return []
    await ensureLoaded()
    return matchItems(action.payload || '').map((m) => {
      const d = describeItem(m)
      return {
        title: d.title,
        text: d.text,
        icon: iconDataUrl(m.item.icon, m.item.type === 'search' ? 'search' : 'layers'),
        __id: m.item.id,
        __query: m.query
      }
    })
  })

  await a.features.onMainPushSelect(async (action: any) => {
    const option = action.option || {}
    const id = option.__id as string
    const query = (option.__query as string) || ''
    await ensureLoaded()
    const item = items.find((i) => i.id === id)
    if (!item) {
      notify('未找到对应条目', 'error')
      return false
    }
    try {
      await executeItem(item, query)
      await bumpUsage(id)
    } catch (e: any) {
      notify(`启动失败：${e?.message || e}`, 'error')
    }
    return false
  })

  handlersRegistered = true
}

async function init(context?: any): Promise<void> {
  if (context?.api) api = context.api
  await loadItems()
  await registerMainPush()
}

// ─── 生命周期 ───────────────────────────────────────────────────────
export async function onLoad(context?: any) {
  await init(context)
}

export async function onBackground(context?: any) {
  await init(context)
}

export function onUnload() {
  handlersRegistered = false
}

export function onEnable() {}
export function onDisable() {}
export function onForeground() {}

export async function run(context?: any) {
  // UI 由前端处理；后端确保已初始化
  await init(context)
}

// ─── 供 UI 调用的后端方法 ───────────────────────────────────────────
// 前端：await window.mulby.host.call('quick-launch', 'getItems')
export const rpc = {
  async getItems() {
    await ensureLoaded()
    return items
  },

  async saveItems(payload: { items: LaunchItem[] }) {
    const next = Array.isArray(payload?.items) ? payload.items : []
    items = next
    await persistItems()
    return { success: true, count: items.length }
  },

  async runItem(payload: { id?: string; item?: LaunchItem; query?: string }) {
    await ensureLoaded()
    // 优先使用传入的完整条目（支持测试尚未保存的条目），否则按 id 查找已保存条目
    const item = payload?.item || items.find((i) => i.id === payload?.id)
    if (!item) return { success: false, error: '未找到条目' }
    try {
      await executeItem(item, payload?.query || '')
      // 仅对已保存条目累计使用次数
      if (!payload?.item && item.id) await bumpUsage(item.id)
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) }
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, onBackground, onForeground, run, rpc }
export default plugin
