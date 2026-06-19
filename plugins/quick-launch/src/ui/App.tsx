import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Search, Layers, Play, Pencil, Trash2, FolderOpen, FileText,
  Link2, Terminal, Download, Upload, X, AlertTriangle, Rocket, RotateCcw, Sparkles
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'
import { ICONS, ICON_MAP } from '../shared/icons'

const PLUGIN_ID = 'quick-launch'

// 内置 SVG 图标渲染（lucide）
function Icon({
  name,
  size = 18,
  fallback = 'rocket'
}: {
  name?: string
  size?: number
  fallback?: string
}) {
  const body = (name && ICON_MAP[name]) || ICON_MAP[fallback] || ''
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  )
}

type ItemType = 'search' | 'workspace'
type ActionKind = 'url' | 'folder' | 'file' | 'command'

interface WorkspaceAction {
  kind: ActionKind
  value: string
  args?: string[]
  cwd?: string
  shell?: boolean
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
  url?: string
  actions?: WorkspaceAction[]
}

type Filter = 'all' | 'search' | 'workspace'

const newId = () =>
  `it-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`

function emptyItem(type: ItemType): LaunchItem {
  return type === 'search'
    ? { id: newId(), type, title: '', keywords: [], icon: 'globe', url: '', group: '搜索引擎' }
    : { id: newId(), type, title: '', keywords: [], icon: 'layers', actions: [{ kind: 'url', value: '' }], group: '工作区' }
}

const ACTION_META: Record<ActionKind, { label: string; icon: typeof Link2; placeholder: string }> = {
  url: { label: '网址', icon: Link2, placeholder: 'https://example.com' },
  folder: { label: '文件夹', icon: FolderOpen, placeholder: 'D:\\projects\\app' },
  file: { label: '文件', icon: FileText, placeholder: 'D:\\docs\\note.md' },
  command: { label: '命令', icon: Terminal, placeholder: 'code（参数另填）' }
}

const ACTION_KINDS: ActionKind[] = ['url', 'folder', 'file', 'command']

// 从 AI 返回文本中稳健地解析出 JSON 对象（容忍 markdown 围栏 / 前后赘述）
function parseLooseJson(text: string): any {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) t = t.slice(s, e + 1)
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

function messageText(msg: any): string {
  const c = msg?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map((p: any) => (p?.type === 'text' ? p.text : '')).join('')
  return ''
}

// 校验并归一化 AI 给出的动作
function coerceActions(raw: any): WorkspaceAction[] {
  if (!Array.isArray(raw)) return []
  const out: WorkspaceAction[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const kind: ActionKind = ACTION_KINDS.includes(a.kind) ? a.kind : 'url'
    const value = typeof a.value === 'string' ? a.value : ''
    const action: WorkspaceAction = { kind, value }
    if (Array.isArray(a.args)) action.args = a.args.map((x: unknown) => String(x)).filter(Boolean)
    if (typeof a.cwd === 'string' && a.cwd) action.cwd = a.cwd
    out.push(action)
  }
  return out
}

const AI_SYSTEM_PROMPT = `你是 Mulby「启动器」插件的工作区配置助手。用户用自然语言描述他想一键打开或执行的一组东西，你要拆解成「工作区动作」列表。
每个动作有 kind 与 value：
- url：网址，value 为完整的 https 链接。用户只说网站名时，给出常见官方网址（例：钉钉网页版→https://im.dingtalk.com，企业微信→https://work.weixin.qq.com，QQ邮箱→https://mail.qq.com，飞书→https://www.feishu.cn）。
- folder：本地文件夹路径；file：本地文件路径；command：可执行命令/程序名，value 为命令本身，args 为参数数组。
规则：
- 能用网址实现的优先用 url。
- folder/file/command 只在用户给出了明确路径或命令时使用；用户提到本地路径但没写全时，把已知部分放进 value，由用户补全，不要凭空编造盘符路径。
- 只输出一个 JSON 对象，形如：{"title": "简短工作区名(可选)", "actions": [{"kind": "url", "value": "https://..."}]}。不要输出任何多余文字或 markdown。`

export default function App() {
  const { notification } = useMulby(PLUGIN_ID)
  const [items, setItems] = useState<LaunchItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<LaunchItem | null>(null)
  const [mainPushOff, setMainPushOff] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 调用后端 rpc：host.call 路由到插件后端的 rpc 方法，返回 { success, data }
  const callBackend = useCallback(async <T,>(method: string, payload?: unknown): Promise<T> => {
    const args = payload === undefined ? [] : [payload]
    const res = (await window.mulby!.host!.call(PLUGIN_ID, method, ...args)) as {
      success: boolean
      data: unknown
      error?: string
    }
    if (res && res.success === false) {
      throw new Error(res.error || '后端调用失败')
    }
    return res?.data as T
  }, [])

  // 主题
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initial = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initial === 'dark')
    window.mulby?.onThemeChange?.((t: 'light' | 'dark') =>
      document.documentElement.classList.toggle('dark', t === 'dark')
    )
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await callBackend<LaunchItem[]>('getItems')
      setItems(Array.isArray(result) ? result : [])
    } catch (e: any) {
      notification.show(`加载失败：${e?.message || e}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [callBackend, notification])

  // 检测全局 MainPush 开关
  const checkMainPush = useCallback(async () => {
    try {
      const res = await window.mulby?.settings?.get?.()
      const search = (res?.settings as any)?.search
      if (!search) return
      const disabled =
        search.enableMainPush === false ||
        (Array.isArray(search.disabledMainPushPlugins) &&
          search.disabledMainPushPlugins.includes(PLUGIN_ID))
      setMainPushOff(disabled)
    } catch {
      /* settings 读取失败时不打扰用户 */
    }
  }, [])

  useEffect(() => {
    load()
    checkMainPush()
  }, [load, checkMainPush])

  const persist = useCallback(
    async (next: LaunchItem[]) => {
      setItems(next)
      try {
        await callBackend('saveItems', { items: next })
      } catch (e: any) {
        notification.show(`保存失败：${e?.message || e}`, 'error')
      }
    },
    [callBackend, notification]
  )

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.type === filter)),
    [items, filter]
  )

  const counts = useMemo(
    () => ({
      all: items.length,
      search: items.filter((i) => i.type === 'search').length,
      workspace: items.filter((i) => i.type === 'workspace').length
    }),
    [items]
  )

  const handleSave = async (item: LaunchItem) => {
    if (!item.title.trim()) {
      notification.show('请填写名称', 'warning')
      return
    }
    if (item.type === 'search' && !item.url?.trim()) {
      notification.show('请填写搜索 URL', 'warning')
      return
    }
    const exists = items.some((i) => i.id === item.id)
    const next = exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item]
    await persist(next)
    setEditing(null)
    notification.show('已保存', 'success')
  }

  const handleDelete = async (id: string) => {
    await persist(items.filter((i) => i.id !== id))
    notification.show('已删除', 'success')
  }

  const handleTest = async (item: LaunchItem, query = '') => {
    try {
      const res = await callBackend<{ success: boolean; error?: string }>('runItem', {
        id: item.id,
        item,
        query
      })
      if (res?.success) notification.show('已触发', 'success')
      else notification.show(`失败：${res?.error || '未知错误'}`, 'error')
    } catch (e: any) {
      notification.show(`失败：${e?.message || e}`, 'error')
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'quick-launch-items.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!Array.isArray(parsed)) throw new Error('格式应为数组')
        const merged = [...items]
        for (const raw of parsed) {
          if (!raw || typeof raw !== 'object') continue
          const item = { ...raw, id: newId() } as LaunchItem
          merged.push(item)
        }
        await persist(merged)
        notification.show(`已导入 ${parsed.length} 项`, 'success')
      } catch (err: any) {
        notification.show(`导入失败：${err?.message || err}`, 'error')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const openSuperPanelSettings = () => {
    window.mulby?.systemPage?.open?.({ page: 'settings', settingsSection: 'superPanel' })
  }

  const handleRestoreDefaults = async () => {
    try {
      const res = await callBackend<{ added: number }>('restoreDefaults')
      await load()
      notification.show(res?.added ? `已恢复 ${res.added} 个默认搜索引擎` : '默认条目均已存在', 'success')
    } catch (e: any) {
      notification.show(`恢复失败：${e?.message || e}`, 'error')
    }
  }

  return (
    <div className="ql-root">
      <header className="ql-header">
        <div className="ql-brand">
          <Rocket size={18} />
          <span>启动器</span>
        </div>
        <div className="ql-actions">
          <button className="btn-ghost" onClick={handleExport} title="导出 JSON">
            <Download size={14} /> 导出
          </button>
          <button className="btn-ghost" onClick={() => fileInputRef.current?.click()} title="导入 JSON">
            <Upload size={14} /> 导入
          </button>
          <button className="btn-ghost" onClick={handleRestoreDefaults} title="恢复内置默认搜索引擎（仅补回缺失项）">
            <RotateCcw size={14} /> 恢复默认
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={handleImportFile}
          />
          <button className="btn-primary" onClick={() => setEditing(emptyItem('search'))}>
            <Plus size={14} /> 新增
          </button>
        </div>
      </header>

      {mainPushOff && (
        <div className="ql-banner">
          <AlertTriangle size={15} />
          <span>
            搜索框推送（MainPush）当前被关闭，输入关键词将<strong>不会</strong>出现启动器结果。
          </span>
          <button className="btn-link" onClick={openSuperPanelSettings}>
            去设置开启
          </button>
        </div>
      )}

      <nav className="ql-tabs">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          全部 <em>{counts.all}</em>
        </button>
        <button className={filter === 'search' ? 'active' : ''} onClick={() => setFilter('search')}>
          <Search size={13} /> 搜索引擎 <em>{counts.search}</em>
        </button>
        <button className={filter === 'workspace' ? 'active' : ''} onClick={() => setFilter('workspace')}>
          <Layers size={13} /> 工作区 <em>{counts.workspace}</em>
        </button>
      </nav>

      <main className="ql-list">
        {loading ? (
          <div className="ql-empty">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="ql-empty">
            <p>还没有条目</p>
            <div className="ql-empty-actions">
              <button className="btn-secondary" onClick={() => setEditing(emptyItem('search'))}>
                <Search size={14} /> 新建搜索引擎
              </button>
              <button className="btn-secondary" onClick={() => setEditing(emptyItem('workspace'))}>
                <Layers size={14} /> 新建工作区
              </button>
            </div>
          </div>
        ) : (
          filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onEdit={() => setEditing(item)}
              onDelete={() => handleDelete(item.id)}
              onTest={(q) => handleTest(item, q)}
            />
          ))
        )}
      </main>

      <footer className="ql-foot">
        <span>
          在 Mulby 搜索框输入<strong>关键词 + 空格 + 搜索词</strong>即可转发搜索；输入工作区名即可一键启动。
        </span>
      </footer>

      {editing && (
        <Editor
          initial={editing}
          allItems={items}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
          onTest={handleTest}
        />
      )}
    </div>
  )
}

// ─── 条目卡片 ───────────────────────────────────────────────────────
function ItemCard({
  item,
  onEdit,
  onDelete,
  onTest
}: {
  item: LaunchItem
  onEdit: () => void
  onDelete: () => void
  onTest: (query?: string) => void
}) {
  const [q, setQ] = useState('')
  return (
    <div className="ql-card">
      <div className="ql-card-icon">
        <Icon name={item.icon} fallback={item.type === 'search' ? 'search' : 'layers'} size={20} />
      </div>
      <div className="ql-card-body">
        <div className="ql-card-title">
          {item.title}
          <span className={`ql-type ${item.type}`}>
            {item.type === 'search' ? '搜索' : '工作区'}
          </span>
          {item.group && <span className="ql-group">{item.group}</span>}
        </div>
        <div className="ql-card-sub">
          {item.keywords.length > 0 && (
            <span className="ql-kw">{item.keywords.join(' · ')}</span>
          )}
          <span className="ql-detail">
            {item.type === 'search' ? item.url : `${item.actions?.length || 0} 个动作`}
          </span>
        </div>
      </div>
      <div className="ql-card-ops">
        {item.type === 'search' ? (
          <div className="ql-test-inline">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="测试搜索词"
              onKeyDown={(e) => e.key === 'Enter' && onTest(q)}
            />
            <button className="btn-icon" title="测试运行" onClick={() => onTest(q)}>
              <Play size={14} />
            </button>
          </div>
        ) : (
          <button className="btn-icon" title="测试运行" onClick={() => onTest('')}>
            <Play size={14} />
          </button>
        )}
        <button className="btn-icon" title="编辑" onClick={onEdit}>
          <Pencil size={14} />
        </button>
        <button className="btn-icon danger" title="删除" onClick={onDelete}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

// ─── 编辑器 ─────────────────────────────────────────────────────────
function Editor({
  initial,
  allItems,
  onCancel,
  onSave,
  onTest
}: {
  initial: LaunchItem
  allItems: LaunchItem[]
  onCancel: () => void
  onSave: (item: LaunchItem) => void
  onTest: (item: LaunchItem, query?: string) => void
}) {
  const [item, setItem] = useState<LaunchItem>({ ...initial })
  const [kwText, setKwText] = useState((initial.keywords || []).join(' '))
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // 白话描述 → AI 拆解为工作区动作，填入表单（不自动执行，需用户确认后保存）
  const generateActions = async () => {
    const desc = aiText.trim()
    if (!desc || aiLoading) return
    const ai = window.mulby?.ai
    if (!ai?.call) {
      window.mulby?.notification?.show?.('当前环境不支持 AI 调用', 'error')
      return
    }
    setAiLoading(true)
    try {
      // 不指定 model，使用 Mulby 系统默认模型。
      // 用 any：本地 d.ts 的 AiModelParameters 尚未包含 responseFormat（结构化输出），运行时支持。
      const option: any = {
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: desc }
        ],
        params: { responseFormat: 'json_object', temperature: 0.2 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' }
      }
      const msg = await ai.call(option)
      const parsed = parseLooseJson(messageText(msg))
      const aiActions = coerceActions(parsed?.actions)
      if (aiActions.length === 0) {
        throw new Error('AI 未能解析出可用动作，换个说法再试试')
      }
      setItem((prev) => {
        const existing = (prev.actions || []).filter((x) => (x.value || '').trim())
        const nextTitle =
          prev.title?.trim() || (typeof parsed?.title === 'string' ? parsed.title : '')
        return { ...prev, title: nextTitle, actions: [...existing, ...aiActions] }
      })
      setAiText('')
      window.mulby?.notification?.show?.(`已生成 ${aiActions.length} 个动作，请检查后保存`, 'success')
    } catch (e: any) {
      window.mulby?.notification?.show?.(`生成失败：${e?.message || e}`, 'error')
    } finally {
      setAiLoading(false)
    }
  }

  // 触发词冲突：与其它条目的关键词重复时提示（不阻断保存）
  const conflicts = useMemo(() => {
    const mine = new Set(
      kwText.split(/[\s,，]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    )
    const out: string[] = []
    for (const kw of mine) {
      const owner = allItems.find(
        (it) => it.id !== item.id && (it.keywords || []).some((k) => k.toLowerCase() === kw)
      )
      if (owner) out.push(`${kw} → ${owner.title}`)
    }
    return out
  }, [kwText, allItems, item.id])

  const setType = (type: ItemType) => {
    if (type === item.type) return
    setItem((prev) => ({
      ...emptyItem(type),
      id: prev.id,
      title: prev.title,
      keywords: prev.keywords,
      icon: type === 'search' ? 'globe' : 'layers',
      group: type === 'search' ? '搜索引擎' : '工作区'
    }))
  }

  const commit = () => {
    const keywords = kwText
      .split(/[\s,，]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    onSave({ ...item, keywords })
  }

  const updateAction = (idx: number, patch: Partial<WorkspaceAction>) => {
    setItem((prev) => ({
      ...prev,
      actions: (prev.actions || []).map((a, i) => (i === idx ? { ...a, ...patch } : a))
    }))
  }
  const addAction = () =>
    setItem((prev) => ({ ...prev, actions: [...(prev.actions || []), { kind: 'url', value: '' }] }))
  const removeAction = (idx: number) =>
    setItem((prev) => ({ ...prev, actions: (prev.actions || []).filter((_, i) => i !== idx) }))

  const pickPath = async (
    idx: number,
    mode: 'file' | 'directory',
    field: 'value' | 'cwd'
  ) => {
    try {
      const paths = await window.mulby?.dialog?.showOpenDialog?.({
        properties: [mode === 'directory' ? 'openDirectory' : 'openFile']
      })
      if (Array.isArray(paths) && paths[0]) {
        updateAction(idx, field === 'cwd' ? { cwd: paths[0] } : { value: paths[0] })
      }
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="ql-modal-mask" onMouseDown={onCancel}>
      <div className="ql-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ql-modal-head">
          <h3>{initial.title ? '编辑条目' : '新增条目'}</h3>
          <button className="btn-icon" onClick={onCancel}>
            <X size={16} />
          </button>
        </div>

        <div className="ql-modal-body">
          <div className="ql-seg">
            <button className={item.type === 'search' ? 'active' : ''} onClick={() => setType('search')}>
              <Search size={14} /> 搜索引擎
            </button>
            <button className={item.type === 'workspace' ? 'active' : ''} onClick={() => setType('workspace')}>
              <Layers size={14} /> 工作区
            </button>
          </div>

          <div className="ql-row">
            <label>名称</label>
            <input
              className="ql-grow"
              value={item.title}
              onChange={(e) => setItem({ ...item, title: e.target.value })}
              placeholder={item.type === 'search' ? '例如 GitHub' : '例如 上班模式'}
            />
          </div>

          <div className="ql-icon-field">
            <label>图标</label>
            <div className="ql-icon-grid">
              {ICONS.map((ic) => (
                <button
                  key={ic.name}
                  type="button"
                  title={ic.label}
                  className={`ql-icon-opt${item.icon === ic.name ? ' active' : ''}`}
                  onClick={() => setItem({ ...item, icon: ic.name })}
                >
                  <Icon name={ic.name} size={18} />
                </button>
              ))}
            </div>
          </div>

          <div className="ql-row">
            <label>触发词</label>
            <input
              className="ql-grow"
              value={kwText}
              onChange={(e) => setKwText(e.target.value)}
              placeholder="空格分隔，例如：gh github"
            />
          </div>

          {conflicts.length > 0 && (
            <p className="ql-warn">
              <AlertTriangle size={13} /> 触发词已被占用：{conflicts.join('；')}（仍可保存，匹配时会同时出现）
            </p>
          )}

          {item.type === 'search' ? (
            <div className="ql-row">
              <label>URL</label>
              <input
                className="ql-grow"
                value={item.url || ''}
                onChange={(e) => setItem({ ...item, url: e.target.value })}
                placeholder="https://github.com/search?q={query}"
              />
            </div>
          ) : (
            <div className="ql-actions-edit">
              <div className="ql-ai-box">
                <div className="ql-ai-head">
                  <Sparkles size={14} /> AI 生成动作
                  <span className="ql-ai-sub">用大白话描述，自动拆成动作</span>
                </div>
                <textarea
                  className="ql-ai-input"
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  placeholder="例如：上班时打开公司邮箱和钉钉网页版，再打开我的项目文件夹 D:\work\acme"
                  rows={2}
                  disabled={aiLoading}
                />
                <button
                  className="btn-secondary ql-ai-btn"
                  onClick={generateActions}
                  disabled={aiLoading || !aiText.trim()}
                >
                  <Sparkles size={13} /> {aiLoading ? '生成中…' : '生成动作'}
                </button>
              </div>

              <div className="ql-actions-head">
                <span>动作（按顺序执行）</span>
                <button className="btn-ghost" onClick={addAction}>
                  <Plus size={13} /> 添加动作
                </button>
              </div>
              {(item.actions || []).map((action, idx) => {
                const Icon = ACTION_META[action.kind].icon
                return (
                  <div className="ql-action-block" key={idx}>
                    <div className="ql-action-row">
                      <select
                        value={action.kind}
                        onChange={(e) => updateAction(idx, { kind: e.target.value as ActionKind })}
                      >
                        {(Object.keys(ACTION_META) as ActionKind[]).map((k) => (
                          <option key={k} value={k}>
                            {ACTION_META[k].label}
                          </option>
                        ))}
                      </select>
                      <span className="ql-action-icon">
                        <Icon size={14} />
                      </span>
                      <input
                        value={action.value}
                        placeholder={ACTION_META[action.kind].placeholder}
                        onChange={(e) => updateAction(idx, { value: e.target.value })}
                      />
                      {(action.kind === 'folder' || action.kind === 'file') && (
                        <button
                          className="btn-ghost"
                          onClick={() => pickPath(idx, action.kind === 'folder' ? 'directory' : 'file', 'value')}
                        >
                          浏览
                        </button>
                      )}
                      <button className="btn-icon danger" onClick={() => removeAction(idx)}>
                        <Trash2 size={13} />
                      </button>
                    </div>

                    {action.kind === 'command' && (
                      <div className="ql-cmd-extra">
                        <div className="ql-action-row">
                          <span className="ql-sub-label">参数</span>
                          <input
                            value={(action.args || []).join(' ')}
                            placeholder="空格分隔，例如：status --short"
                            onChange={(e) =>
                              updateAction(idx, {
                                args: e.target.value.split(/\s+/).filter(Boolean)
                              })
                            }
                          />
                        </div>
                        <div className="ql-action-row">
                          <span className="ql-sub-label">目录</span>
                          <input
                            value={action.cwd || ''}
                            placeholder="工作目录（可选）"
                            onChange={(e) => updateAction(idx, { cwd: e.target.value })}
                          />
                          <button className="btn-ghost" onClick={() => pickPath(idx, 'directory', 'cwd')}>
                            浏览
                          </button>
                        </div>
                        <label className="ql-shell-toggle">
                          <input
                            type="checkbox"
                            checked={!!action.shell}
                            onChange={(e) => updateAction(idx, { shell: e.target.checked })}
                          />
                          通过 shell 执行（需要管道/内置命令时勾选；可能触发命令确认）
                        </label>
                      </div>
                    )}
                  </div>
                )
              })}
              {(item.actions || []).length === 0 && (
                <p className="ql-hint">点击「添加动作」加入网址、文件夹、文件或命令。</p>
              )}
            </div>
          )}

          {item.type === 'search' ? (
            <p className="ql-hint">
              URL 中的 <code>{'{query}'}</code> 会被替换为搜索词；不含占位符则直接打开该网址。
            </p>
          ) : (
            <p className="ql-hint">
              动作的网址 / 路径 / 命令参数中也可用 <code>{'{query}'}</code>，会替换为「工作区触发词后输入的内容」。
            </p>
          )}
        </div>

        <div className="ql-modal-foot">
          <button className="btn-secondary" onClick={() => onTest({ ...item }, '')}>
            <Play size={14} /> 测试
          </button>
          <div className="ql-foot-right">
            <button className="btn-ghost" onClick={onCancel}>
              取消
            </button>
            <button className="btn-primary" onClick={commit}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
