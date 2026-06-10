import { useEffect, useRef, useState } from 'react'
import { FolderGit2, Folder, Layers, AlertTriangle } from 'lucide-react'
import type { PluginProjectSource, PluginProjectStatus } from '../types'
import type { MaintenanceStatus } from '../lib/maintenance'
import { HealthDot } from './StatusBadge'

const SOURCE_ORDER: PluginProjectSource[] = ['created', 'imported', 'added', 'migrated']
const SOURCE_LABEL: Record<PluginProjectSource, string> = {
  created: '最近创建',
  imported: '最近导入',
  added: '已添加目录',
  migrated: '开发目录（来自宿主设置）'
}

interface Props {
  projects: PluginProjectStatus[]
  selectedId: string | null
  loading: boolean
  onSelect: (id: string) => void
  /** 维护状态（key = 插件目录路径），由 App 后台聚合；缺失时不显示徽标 */
  maint?: Record<string, MaintenanceStatus>
}

type ListTab = 'single' | 'collection'

export function ProjectList({ projects, selectedId, loading, onSelect, maint }: Props) {
  const [tab, setTab] = useState<ListTab>('single')

  // 仅在首次加载时确定默认 tab（按选中项类型，或哪个非空）；之后完全由用户手动切换，
  // 不再随 selectedId/projects 变化自动跳转——避免删除单插件后被强制切到「集合」。
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current || projects.length === 0) return
    initializedRef.current = true
    const sel = projects.find((p) => p.projectId === selectedId)
    const hasSingle = projects.some((p) => p.type !== 'collection')
    setTab(sel ? (sel.type === 'collection' ? 'collection' : 'single') : (hasSingle ? 'single' : 'collection'))
  }, [projects, selectedId])

  if (loading && projects.length === 0) {
    return (
      <div className="p-3 space-y-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-14 w-full" />
        ))}
      </div>
    )
  }

  const singles = projects.filter((p) => p.type !== 'collection')
  const collections = projects.filter((p) => p.type === 'collection')
  const current = tab === 'collection' ? collections : singles

  const grouped = SOURCE_ORDER
    .map((src) => ({ src, items: current.filter((p) => p.source === src) }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="flex flex-col h-full">
      {/* 单插件 / 集合 分页 */}
      <div className="sticky top-0 z-10 p-2 bg-white/70 dark:bg-slate-900/50 backdrop-blur border-b border-slate-200/70 dark:border-slate-800/70">
        <div className="flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/70">
          <ListTabBtn active={tab === 'single'} onClick={() => setTab('single')} icon={<Folder size={13} />} label="单插件" count={singles.length} />
          <ListTabBtn active={tab === 'collection'} onClick={() => setTab('collection')} icon={<Layers size={13} />} label="集合" count={collections.length} />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2.5 space-y-4">
        {grouped.length === 0 ? (
          <div className="px-2 py-10 text-center text-[12px] text-slate-400 dark:text-slate-500">
            {tab === 'single' ? '暂无单插件项目' : '暂无集合目录'}
          </div>
        ) : (
          grouped.map(({ src, items }) => (
            <div key={src}>
              <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {SOURCE_LABEL[src]}
              </div>
              <div className="space-y-1">
                {items.map((proj) => (
                  <ProjectRow
                    key={proj.projectId}
                    proj={proj}
                    active={proj.projectId === selectedId}
                    onSelect={onSelect}
                    maint={maint}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ListTabBtn({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
        active ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {icon}{label}
      <span className={`text-[10px] px-1.5 rounded-full ${active ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200/70 dark:bg-slate-700/70 text-slate-500 dark:text-slate-400'}`}>{count}</span>
    </button>
  )
}

function ProjectRow({
  proj, active, onSelect, maint
}: { proj: PluginProjectStatus; active: boolean; onSelect: (id: string) => void; maint?: Record<string, MaintenanceStatus> }) {
  // 集合目录用"目录名"作为标题（而非第一个子插件名，避免误导）；单插件才回退到插件 displayName
  const dirName = proj.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || proj.path
  const name = proj.label
    || (proj.type === 'collection' ? dirName : proj.plugins[0]?.displayName)
    || dirName
  const hasError = !proj.exists || proj.plugins.some((p) => !p.manifestValid || p.idConflictWith)
  const TypeIcon = proj.type === 'collection' ? Layers : (proj.source === 'migrated' ? FolderGit2 : Folder)

  // 维护徽标：项目内任一插件需维护 → 红点；否则任一可发更新 → 蓝点
  const maints = maint ? proj.plugins.map((p) => maint[p.path]).filter(Boolean) : []
  const attention = maints.find((m) => m.needsAttention)
  const updatable = !attention && maints.find((m) => m.canPublishUpdate)

  return (
    <button
      onClick={() => onSelect(proj.projectId)}
      className={`w-full text-left px-2.5 py-2 rounded-lg border transition-all group ${
        active
          ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.08)]'
          : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <TypeIcon size={15} className={`shrink-0 ${active ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`} />
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-slate-700 dark:text-slate-200">{name}</span>
        {attention && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]" title={`需维护：${attention.attentionReason}`} />
        )}
        {updatable && (
          <span className="shrink-0 w-2 h-2 rounded-full bg-sky-500 shadow-[0_0_6px_rgba(14,165,233,0.6)]" title={`可发布更新：本地 v${updatable.localVersion} > 商店 v${updatable.storeVersion}`} />
        )}
        {proj.type === 'collection' && (
          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200/70 dark:bg-slate-700/70 text-slate-500 dark:text-slate-400">{proj.plugins.length}</span>
        )}
        {hasError
          ? <AlertTriangle size={13} className="text-rose-500 shrink-0" />
          : proj.plugins[0] && <HealthDot p={proj.plugins[0]} />}
      </div>
      <div className="mt-1 pl-[23px]">
        <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500 mono">{proj.path}</span>
      </div>
    </button>
  )
}
