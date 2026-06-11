import { useEffect, useRef, useState } from 'react'
import {
  FolderOpen, Hammer, Package, RefreshCw, Trash2, FileText,
  AlertTriangle, Loader2, ShieldAlert, Wrench, Sparkles, Play, Boxes, UploadCloud,
  Store, ArrowUpCircle, Copy, MoreHorizontal
} from 'lucide-react'
import type { PluginProjectPluginStatus, PluginProjectStatus } from '../types'
import type { MaintenanceStatus } from '../lib/maintenance'
import { relationText } from '../lib/maintenance'
import { PluginBadges, HealthDot } from './StatusBadge'
import { PublishStatusCard } from './PublishStatus'

export type DetailAction = 'open' | 'launch' | 'build' | 'pack' | 'reload' | 'readme' | 'remove' | 'vibe' | 'publish'

type ToastFn = (kind: 'success' | 'error' | 'info', text: string) => void

const fsApi = () => (window as any)?.mulby?.filesystem

/** 触发指令（manifest.features[].cmds[]）的一行可读描述 */
function cmdLabel(c: any): string {
  if (typeof c === 'string') return `关键词「${c}」`
  if (!c || typeof c !== 'object') return ''
  switch (c.type) {
    case 'keyword': return `关键词「${c.value || ''}」`
    case 'regex': return `正则 ${c.match || ''}${c.label ? `（${c.label}）` : ''}`
    case 'over': return `任意文本${c.label ? `（${c.label}）` : ''}`
    case 'files': return `文件拖入${Array.isArray(c.exts) && c.exts.length ? ` ${c.exts.join('/')}` : ''}`
    case 'img': return '图片拖入'
    case 'window': return `活跃窗口 ${c.app || c.title || c.bundleId || ''}`
    default: return String(c.type || '')
  }
}

/** 复制文本到剪贴板（优先宿主 clipboard，回退浏览器 API） */
async function copyText(text: string): Promise<boolean> {
  try {
    const c = (window as any)?.mulby?.clipboard
    if (c?.writeText) { await c.writeText(text); return true }
  } catch { /* 落到浏览器 API */ }
  try {
    if (navigator?.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* ignore */ }
  return false
}

/** 取首个「关键词」触发词（用于一键复制去主输入框试用）；没有则返回 null */
function primaryKeyword(manifest: PluginManifest | null): string | null {
  const feats = Array.isArray(manifest?.features) ? manifest!.features! : []
  for (const f of feats) {
    const cmds = Array.isArray(f?.cmds) ? f.cmds : []
    for (const c of cmds) {
      if (typeof c === 'string' && c.trim()) return c.trim()
      if (c && typeof c === 'object' && c.type === 'keyword' && c.value) return String(c.value)
    }
  }
  return null
}

type ReadyTone = 'rose' | 'amber' | 'sky' | 'emerald'
const READY_DOT: Record<ReadyTone, string> = {
  rose: 'bg-rose-500', amber: 'bg-amber-500', sky: 'bg-sky-500', emerald: 'bg-emerald-500'
}
const READY_TEXT: Record<ReadyTone, string> = {
  rose: 'text-rose-600 dark:text-rose-400',
  amber: 'text-amber-600 dark:text-amber-400',
  sky: 'text-sky-600 dark:text-sky-400',
  emerald: 'text-emerald-600 dark:text-emerald-400'
}
/** 把插件的运行/构建态汇成一句「就绪度」概览（替代分散的多枚徽标解读） */
function readiness(p: PluginProjectPluginStatus): { tone: ReadyTone; text: string } {
  if (!p.manifestValid) return { tone: 'rose', text: 'manifest 无效' }
  if (p.idConflictWith) return { tone: 'rose', text: 'ID 冲突' }
  if (!p.built) return { tone: 'amber', text: '待构建' }
  if (!p.loaded) return { tone: 'sky', text: '已构建 · 未载入' }
  return { tone: 'emerald', text: '可运行' }
}

interface PluginManifest {
  version?: string
  description?: string
  author?: string
  type?: string
  platform?: string | string[]
  features?: Array<{ code?: string; explain?: string; mode?: string; cmds?: any[] }>
  permissions?: Record<string, unknown>
}

interface Props {
  project: PluginProjectStatus
  busyAction: DetailAction | null
  onAction: (action: DetailAction, plugin?: PluginProjectPluginStatus) => void
  pushToast?: ToastFn
  /** 发布成功后 +1，驱动状态卡重新拉取 */
  publishReloadToken?: number
  /** 维护状态（key = 插件目录路径） */
  maint?: Record<string, MaintenanceStatus>
  /** 审查意见回流：跳转 Vibe 改造并把意见交给 AI 修复 */
  onAiFix?: (plugin: PluginProjectPluginStatus, instruction: string) => void
}

export function ProjectDetail({ project, busyAction, onAction, pushToast, publishReloadToken, maint, onAiFix }: Props) {
  const isCollection = project.type === 'collection'
  const projectName = project.label || (isCollection ? (project.path.split('/').pop() || project.path) : project.plugins[0]?.displayName) || project.path

  // 集合模式：当前选中的子插件
  const [selectedPath, setSelectedPath] = useState<string | null>(project.plugins[0]?.path ?? null)
  useEffect(() => {
    setSelectedPath((cur) => (cur && project.plugins.some((p) => p.path === cur) ? cur : project.plugins[0]?.path ?? null))
  }, [project.projectId, project.plugins])

  const activePlugin = project.plugins.find((p) => p.path === selectedPath) || project.plugins[0] || null

  // 项目级头部条：集合/空项目共用（单插件模式不渲染，由 Hero 头卡承载）
  const projectHeader = (subtitle: React.ReactNode) => (
    <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 truncate">{projectName}</h2>
          {subtitle}
          {!project.exists && <span className="badge badge-red"><AlertTriangle size={11} /> 目录不存在</span>}
        </div>
        <div className="mt-1 text-[12px] text-slate-400 dark:text-slate-500 mono truncate">{project.path}</div>
      </div>
      <button className="btn-danger shrink-0" disabled={!!busyAction} onClick={() => onAction('remove')}>
        {busyAction === 'remove' ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} 从列表移除
      </button>
    </div>
  )

  // 空项目（目录下无可识别插件）：精简头部 + 提示，仍可移除
  if (project.plugins.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {projectHeader(null)}
        <div className="flex-1 flex items-center justify-center text-sm text-slate-400 dark:text-slate-500 italic px-6 text-center">
          该目录下未发现可识别的插件（缺少 manifest.json）。
        </div>
      </div>
    )
  }

  // 集合模式：项目头部 + 左侧子插件列表 + 右侧选中插件详情
  if (isCollection) {
    return (
      <div className="flex flex-col h-full">
        {projectHeader(<span className="badge badge-slate">集合 · {project.plugins.length} 个插件</span>)}
        <div className="flex-1 min-h-0 flex">
          <aside className="w-60 shrink-0 border-r border-slate-200 dark:border-slate-800 overflow-auto bg-white/30 dark:bg-slate-900/20">
            <div className="px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
              <Boxes size={13} /> 集合内插件（{project.plugins.length}）
            </div>
            <div className="p-2 space-y-1">
              {project.plugins.map((p) => (
                <PluginSubItem key={p.id + p.path} p={p} active={p.path === activePlugin?.path} onSelect={() => setSelectedPath(p.path)} />
              ))}
            </div>
          </aside>
          <main className="flex-1 min-w-0 overflow-auto p-5">
            {activePlugin && (
              <PluginDetailPanel
                p={activePlugin} busy={busyAction} onAction={onAction} pushToast={pushToast}
                publishReloadToken={publishReloadToken} maint={maint?.[activePlugin.path]} onAiFix={onAiFix}
                topLevel={false} exists={project.exists}
              />
            )}
          </main>
        </div>
      </div>
    )
  }

  // 单插件模式：直接以 Hero 头卡承载，不再额外渲染重复的项目头部
  return (
    <div className="h-full overflow-auto p-5">
      {activePlugin && (
        <PluginDetailPanel
          p={activePlugin} busy={busyAction} onAction={onAction} pushToast={pushToast}
          publishReloadToken={publishReloadToken} maint={maint?.[activePlugin.path]} onAiFix={onAiFix}
          topLevel={true} exists={project.exists} onRemove={() => onAction('remove')}
        />
      )}
    </div>
  )
}

function PluginSubItem({ p, active, onSelect }: { p: PluginProjectPluginStatus; active: boolean; onSelect: () => void }) {
  const hasError = !p.manifestValid || !!p.idConflictWith
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all ${
        active ? 'bg-emerald-500/10 border-emerald-500/30' : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{p.displayName || p.id}</span>
        {hasError ? <AlertTriangle size={13} className="text-rose-500 shrink-0" /> : <HealthDot p={p} />}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500 mono">{p.id}</div>
    </button>
  )
}

/** 插件图标缩略图：读取 icon.png（base64），失败/缺失时回退首字母渐变方块 */
function IconThumb({ path, name }: { path: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    const fs = fsApi()
    if (!fs?.readFile) return
    void (async () => {
      try {
        if (fs.exists && !(await fs.exists(`${path}/icon.png`))) return
        const b64 = await fs.readFile(`${path}/icon.png`, 'base64')
        if (alive && typeof b64 === 'string' && b64) {
          setUrl(`data:image/png;base64,${b64.replace(/^data:image\/\w+;base64,/, '')}`)
        }
      } catch { /* 读取失败用占位 */ }
    })()
    return () => { alive = false }
  }, [path])
  const letter = ((name || '?').trim().charAt(0) || '?').toUpperCase()
  return (
    <div className="w-14 h-14 rounded-2xl overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-emerald-500/15 to-teal-600/15 flex items-center justify-center">
      {url
        ? <img src={url} alt={name} className="w-full h-full object-cover" />
        : <span className="text-2xl font-bold text-emerald-600/70 dark:text-emerald-400/70">{letter}</span>}
    </div>
  )
}

interface MoreItem { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }

/** 次要操作的「⋯ 更多」溢出菜单（点击外部自动关闭） */
function MoreMenu({ items, disabled }: { items: MoreItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost !px-2.5" disabled={disabled} onClick={() => setOpen((v) => !v)} title="更多操作">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[150px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 anim-pop">
          {items.map((it, i) => (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick() }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-100 dark:hover:bg-slate-700/60 ${it.danger ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 开发动作组里的单个紧凑按钮（构建 / 刷新载入 / 打包） */
function DevBtn({ onClick, icon, label, spin, disabled }: { onClick: () => void; icon: React.ReactNode; label: string; spin?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {spin ? <Loader2 size={14} className="animate-spin" /> : icon} {label}
    </button>
  )
}

/**
 * 维护状态行：一眼看到「本地 vs 商店」的版本关系。
 * ahead（有未发布改动）→ 蓝色 + 「发布更新」快捷入口；behind/需维护 → 警示；synced → 安静的绿色。
 */
function MaintenanceRow({ st, busy, onPublish }: { st: MaintenanceStatus; busy: boolean; onPublish: () => void }) {
  if (st.relation === 'unknown') return null
  const text = relationText(st)
  const tone = st.needsAttention && st.relation === 'behind' ? 'rose'
    : st.relation === 'ahead' ? 'sky'
    : st.relation === 'synced' ? 'emerald'
    : 'slate'
  const cls: Record<string, string> = {
    rose: 'border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400',
    sky: 'border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300',
    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
    slate: 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
  }
  return (
    <div className={`rounded-xl border px-3 py-2 flex items-center gap-2 text-[12px] ${cls[tone]}`}>
      <Store size={13} className="shrink-0" />
      <span className="flex-1 min-w-0">{text}</span>
      {st.relation === 'ahead' && (
        <button className="btn-secondary shrink-0 h-6 px-2 text-[11px]" disabled={busy} onClick={onPublish} title="把本地改动发布为商店更新（提交 PR）">
          <ArrowUpCircle size={12} /> 发布更新
        </button>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-[12px]">
      <span className="w-16 shrink-0 text-slate-400 dark:text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300 break-words">{value}</span>
    </div>
  )
}

function PluginDetailPanel({ p, busy, onAction, pushToast, publishReloadToken, maint, onAiFix, topLevel, exists, onRemove }: {
  p: PluginProjectPluginStatus; busy: DetailAction | null; onAction: (a: DetailAction, plugin?: PluginProjectPluginStatus) => void
  pushToast?: ToastFn; publishReloadToken?: number; maint?: MaintenanceStatus
  onAiFix?: (plugin: PluginProjectPluginStatus, instruction: string) => void
  topLevel: boolean; exists?: boolean; onRemove?: () => void
}) {
  const hasIssue = !p.manifestValid || !!p.idConflictWith || !p.built
  const [manifest, setManifest] = useState<PluginManifest | null>(null)
  const [mfLoading, setMfLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setManifest(null)
    const fs = fsApi()
    if (!fs?.readFile) return
    setMfLoading(true)
    void (async () => {
      try {
        const raw = await fs.readFile(`${p.path}/manifest.json`, 'utf-8')
        const text = typeof raw === 'string'
          ? raw
          : new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
        if (alive) setManifest(JSON.parse(text))
      } catch {
        if (alive) setManifest(null)
      } finally {
        if (alive) setMfLoading(false)
      }
    })()
    return () => { alive = false }
  }, [p.path])

  const platform = manifest?.platform
  const platformLabel = Array.isArray(platform) ? platform.join('、') : (platform || '全平台')
  const perms = manifest?.permissions && typeof manifest.permissions === 'object'
    ? Object.entries(manifest.permissions).filter(([, v]) => v && v !== false).map(([k]) => k)
    : []

  const keyword = primaryKeyword(manifest)
  const ready = readiness(p)

  const moreItems: MoreItem[] = [
    { icon: <FolderOpen size={14} />, label: '打开目录', onClick: () => onAction('open', p), disabled: exists === false },
    { icon: <FileText size={14} />, label: 'README', onClick: () => onAction('readme', p) },
    ...(topLevel && onRemove ? [{ icon: <Trash2 size={14} />, label: '从列表移除', onClick: onRemove, danger: true }] : [])
  ]

  return (
    <div className="max-w-3xl space-y-4">
      {/* Hero 头卡：图标 + 名称/id/版本 + 就绪度/触发词 + 主操作 */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/30 p-4">
        <div className="flex items-start gap-4">
          <IconThumb path={p.path} name={p.displayName || p.id} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 truncate">{p.displayName || p.id}</h3>
              {manifest?.version && <span className="badge badge-slate mono">v{manifest.version}</span>}
              {topLevel && exists === false && <span className="badge badge-red"><AlertTriangle size={11} /> 目录不存在</span>}
            </div>
            <div className="mt-0.5 text-[12px] text-slate-400 dark:text-slate-500 mono truncate">{p.id}</div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${READY_TEXT[ready.tone]}`}>
                <span className={`w-2 h-2 rounded-full ${READY_DOT[ready.tone]}`} /> {ready.text}
              </span>
              {keyword && (
                <button
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-400/60 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  onClick={async () => {
                    const ok = await copyText(keyword)
                    pushToast?.(ok ? 'success' : 'error', ok ? `已复制触发词「${keyword}」，去 Mulby 主输入框试用` : '复制失败')
                  }}
                  title="复制触发词，去 Mulby 主输入框试用"
                >
                  <Copy size={11} /> {keyword}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button className="btn-primary" disabled={!!busy} onClick={() => onAction('vibe', p)} title="用自然语言让 AI 改造这个插件"><Sparkles size={15} /> AI 改造</button>
            <button className="btn-secondary" disabled={!!busy || !p.loaded} title={p.loaded ? '打开/运行此插件' : '请先构建并刷新载入'} onClick={() => onAction('launch', p)}>
              {busy === 'launch' ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} 打开插件
            </button>
            <MoreMenu items={moreItems} disabled={!!busy} />
          </div>
        </div>

        {/* 健康徽标 + 开发动作组（构建 / 刷新载入 / 打包） */}
        <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/60 flex items-center justify-between gap-3 flex-wrap">
          <PluginBadges p={p} />
          <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            <DevBtn onClick={() => onAction('build', p)} icon={<Hammer size={14} />} label="构建" spin={busy === 'build'} disabled={!!busy} />
            <span className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
            <DevBtn onClick={() => onAction('reload', p)} icon={<RefreshCw size={14} />} label="刷新载入" spin={busy === 'reload'} disabled={!!busy} />
            <span className="w-px self-stretch bg-slate-200 dark:bg-slate-700" />
            <DevBtn onClick={() => onAction('pack', p)} icon={<Package size={14} />} label="打包" spin={busy === 'pack'} disabled={!!busy} />
          </div>
        </div>
      </div>

      {/* 发布与维护：发布入口 + 本地/商店版本关系 + PR·CI 状态（就近聚合） */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><UploadCloud size={13} /> 发布与维护</div>
          <button className="btn-secondary h-7 px-2.5 text-[12px]" disabled={!!busy} onClick={() => onAction('publish', p)} title="提交 PR 发布到插件仓库">
            {busy === 'publish' ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />} 发布
          </button>
        </div>
        {maint && <MaintenanceRow st={maint} busy={!!busy} onPublish={() => onAction('publish', p)} />}
        <PublishStatusCard
          pluginPath={p.path} pluginName={p.id} pushToast={pushToast} reloadToken={publishReloadToken}
          onAiFix={onAiFix ? (instruction) => onAiFix(p, instruction) : undefined}
        />
      </div>

      {/* 基础信息（来自 manifest.json；ID/名称/版本已在头卡展示，此处补全其余档案信息） */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
        <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
          基础信息（来自 manifest.json）{mfLoading && <Loader2 size={12} className="animate-spin text-slate-400" />}
        </div>
        {manifest?.description && <InfoRow label="描述" value={manifest.description} />}
        {manifest?.type && <InfoRow label="分类" value={manifest.type} />}
        {manifest?.author && <InfoRow label="作者" value={manifest.author} />}
        <InfoRow label="平台" value={platformLabel} />
        <InfoRow label="目录" value={<span className="mono">{p.path}</span>} />
        <InfoRow label="入口" value={p.mainEntryFound ? '已找到 dist/main.js' : '未找到构建产物'} />
        <InfoRow label="状态" value={`${p.built ? '已构建' : '未构建'} · ${p.loaded ? '已载入' : '未载入'} · ${p.enabled ? '已启用' : '未启用'}${p.isDev ? ' · 开发版' : ''}`} />
        {!manifest && !mfLoading && <div className="text-[11px] text-slate-400 dark:text-slate-500">（未能读取 manifest.json，仅显示运行态信息）</div>}
      </div>

      {/* 功能与触发（来自 manifest.features） */}
      {Array.isArray(manifest?.features) && manifest.features.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
          <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">功能与触发（{manifest.features.length}）</div>
          {manifest.features.map((f, i) => (
            <div key={(f.code || '') + i} className="rounded-lg bg-slate-50 dark:bg-slate-800/40 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] font-medium mono text-slate-700 dark:text-slate-200">{f.code || `feature-${i + 1}`}</span>
                {f.mode && <span className="badge badge-slate">{f.mode === 'ui' ? '界面' : f.mode === 'detached' ? '独立窗口' : f.mode === 'silent' ? '静默' : f.mode}</span>}
              </div>
              {f.explain && <div className="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{f.explain}</div>}
              {Array.isArray(f.cmds) && f.cmds.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {f.cmds.map((c, j) => <span key={j} className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">{cmdLabel(c)}</span>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 权限（来自 manifest.permissions） */}
      {perms.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
          <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400">权限（{perms.length}）</div>
          <div className="flex flex-wrap gap-1.5">
            {perms.map((k) => <span key={k} className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300 mono">{k}</span>)}
          </div>
        </div>
      )}

      {/* 问题与修复 */}
      {hasIssue && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <div className="text-[12px] font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><AlertTriangle size={13} /> 待处理</div>
          {p.manifestErrors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-[12px] text-rose-600 dark:text-rose-400">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span>{err}</span>
            </div>
          ))}
          {p.idConflictWith && (
            <div className="flex items-start gap-2 text-[12px] text-rose-600 dark:text-rose-400">
              <ShieldAlert size={13} className="mt-0.5 shrink-0" />
              <span>ID 与已安装插件冲突：<span className="mono">{p.idConflictWith}</span>（开发版将覆盖已安装版）</span>
            </div>
          )}
          {!p.built && p.manifestValid && (
            <div className="flex items-center gap-2 text-[12px] text-amber-600 dark:text-amber-400">
              <Wrench size={13} className="shrink-0" />
              <span>未发现构建产物（dist/main.js）。建议先执行「构建」。</span>
              <button className="btn-ghost !px-2 !py-0.5 text-[11px] text-emerald-600 dark:text-emerald-400" disabled={!!busy} onClick={() => onAction('build', p)}>
                <Hammer size={11} /> 立即构建
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
