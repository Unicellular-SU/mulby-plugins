import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, Search, Layers, Play, Pencil, Trash2, FolderOpen, FileText,
  Link2, Terminal, Download, Upload, X, AlertTriangle, Rocket
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
  onCancel,
  onSave,
  onTest
}: {
  initial: LaunchItem
  onCancel: () => void
  onSave: (item: LaunchItem) => void
  onTest: (item: LaunchItem, query?: string) => void
}) {
  const [item, setItem] = useState<LaunchItem>({ ...initial })
  const [kwText, setKwText] = useState((initial.keywords || []).join(' '))

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

  const pickPath = async (idx: number, kind: ActionKind) => {
    try {
      const paths = await window.mulby?.dialog?.showOpenDialog?.({
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile']
      })
      if (Array.isArray(paths) && paths[0]) updateAction(idx, { value: paths[0] })
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
              <div className="ql-actions-head">
                <span>动作（按顺序执行）</span>
                <button className="btn-ghost" onClick={addAction}>
                  <Plus size={13} /> 添加动作
                </button>
              </div>
              {(item.actions || []).map((action, idx) => {
                const Icon = ACTION_META[action.kind].icon
                return (
                  <div className="ql-action-row" key={idx}>
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
                      <button className="btn-ghost" onClick={() => pickPath(idx, action.kind)}>
                        浏览
                      </button>
                    )}
                    <button className="btn-icon danger" onClick={() => removeAction(idx)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              })}
              {(item.actions || []).length === 0 && (
                <p className="ql-hint">点击「添加动作」加入网址、文件夹、文件或命令。</p>
              )}
            </div>
          )}

          {item.type === 'search' && (
            <p className="ql-hint">
              URL 中的 <code>{'{query}'}</code> 会被替换为搜索词；不含占位符则直接打开该网址。
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
