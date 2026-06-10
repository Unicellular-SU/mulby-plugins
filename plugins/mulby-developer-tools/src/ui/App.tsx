import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, FolderInput, FolderPlus, RefreshCw, Wrench, Sparkles,
  AlertCircle, Loader2, PanelsTopLeft, X, ChevronDown, ChevronUp
} from 'lucide-react'
import { useDeveloper, DEVELOPER_PLUGIN_ID } from './hooks/useDeveloper'
import type { LogEntry, LogLevel, PluginProjectPluginStatus, PluginProjectStatus } from './types'
import { ProjectList } from './components/ProjectList'
import { ProjectDetail, type DetailAction } from './components/ProjectDetail'
import { LogPanel } from './components/LogPanel'
import { EmptyState } from './components/EmptyState'
import { ToastHost, type ToastData } from './components/Toast'
import { CreateDialog, type CreatePayload } from './components/CreateDialog'
import { VibePanel, type VibeEditTarget, type KnownPlugin } from './components/VibePanel'
import type { ConformanceResult } from './components/VibePanel'
import { PublishDialog } from './components/PublishDialog'
import { defaultContract, type VibeContract } from './lib/vibeContract'
import { loadMaintenanceCache, refreshMaintenance, type MaintenanceStatus, type MaintenanceTarget } from './lib/maintenance'
import { SessionProvider } from './vibe'

interface PublishTarget {
  path: string; pluginId: string; displayName?: string
  built: boolean; contract: VibeContract; conformance: ConformanceResult | null
}

type Tab = 'workbench' | 'vibe'

export default function App() {
  const dev = useDeveloper()
  const [tab, setTab] = useState<Tab>('workbench')
  const [projects, setProjects] = useState<PluginProjectStatus[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<DetailAction | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [toasts, setToasts] = useState<ToastData[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [logCollapsed, setLogCollapsed] = useState(true)
  const [vibeEditTarget, setVibeEditTarget] = useState<VibeEditTarget | null>(null)
  // 工作台直接发布：打开 PublishDialog 的目标 + 发布成功后驱动状态卡刷新的 token
  const [publishTarget, setPublishTarget] = useState<PublishTarget | null>(null)
  const [publishReloadToken, setPublishReloadToken] = useState(0)
  // 维护状态（key=插件目录路径）：后台聚合「本地 vs 商店版本 / PR / CI / 审查」，驱动列表徽标与详情维护行
  const [maintMap, setMaintMap] = useState<Record<string, MaintenanceStatus>>({})
  const maintNotifiedRef = useRef(false)

  // 改造模式可选目标：已知插件（排除本工具自身，避免自改自）
  const knownPlugins = useMemo<KnownPlugin[]>(() => {
    const acc: KnownPlugin[] = []
    for (const proj of projects) {
      for (const pl of proj.plugins) {
        if (pl.id === DEVELOPER_PLUGIN_ID) continue
        acc.push({ path: pl.path, id: pl.id, displayName: pl.displayName || pl.id })
      }
    }
    return acc
  }, [projects])

  // 主题同步
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initial = (params.get('theme') as 'light' | 'dark') || 'dark'
    document.documentElement.classList.toggle('dark', initial === 'dark')
    ;(window as any).mulby?.onThemeChange?.((t: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', t === 'dark')
    })
  }, [])

  const pushToast = useCallback((kind: ToastData['kind'], text: string) => {
    setToasts((prev) => [...prev, { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, kind, text }])
  }, [])
  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])

  const addLog = useCallback((level: LogLevel, text: string) => {
    setLogs((prev) => [...prev.slice(-199), { id: `l-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, ts: Date.now(), level, text }])
  }, [])

  // F1：当前长任务（构建/打包/生成等）+ 每秒跳动的耗时，喂给底部日志栏做「实时脉冲」，消除长操作的"假死"感。
  const [activity, setActivity] = useState<{ label: string; startedAt: number } | null>(null)
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!activity) return
    const t = setInterval(() => forceTick((n) => (n + 1) % 1_000_000), 1000)
    return () => clearInterval(t)
  }, [activity])
  // 同标签不重置计时；传 null 清空（已为 null 则保持同一引用，避免无谓渲染）
  const reportActivity = useCallback((label: string | null) => {
    setActivity((cur) => {
      if (!label) return cur === null ? cur : null
      if (cur && cur.label === label) return cur
      return { label, startedAt: Date.now() }
    })
  }, [])
  const errorCount = useMemo(() => logs.filter((l) => l.level === 'error').length, [logs])
  // F2：新增 error 日志且面板折叠时自动展开，让失败立即可见
  const seenLogCountRef = useRef(0)
  useEffect(() => {
    const fresh = logs.slice(seenLogCountRef.current)
    seenLogCountRef.current = logs.length
    if (logCollapsed && fresh.some((l) => l.level === 'error')) setLogCollapsed(false)
  }, [logs, logCollapsed])
  // 切换页签时清空活动，避免上一上下文的状态滞留到另一页签
  useEffect(() => { reportActivity(null) }, [tab, reportActivity])

  // 依赖恒定的 listPluginProjects（useDeveloper 内 useCallback 稳定），
  // 而非整个 dev 对象——否则 dev 在 loading 切换时变化会让 refresh 重新创建，
  // 触发下方 useEffect 反复执行，造成无限拉取与卡顿（刷新图标一直 loading）。
  const listPluginProjects = dev.listPluginProjects
  const refreshInflight = useRef(false)
  const refresh = useCallback(async (silent = false, preferType?: 'single' | 'collection') => {
    // 防并发：进行中再次触发直接忽略，避免重复请求打满主进程
    if (refreshInflight.current) return
    refreshInflight.current = true
    if (!silent) setListLoading(true)
    setListError(null)
    try {
      // 超时兜底：8s 未返回即解除 loading 并提示，避免刷新图标永久 spin
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('加载超时，请重试')), 8000)
      )
      const list = await Promise.race([listPluginProjects(), timeout])
      setProjects(list)
      setSelectedId((cur) => {
        if (cur && list.some((p) => p.projectId === cur)) return cur
        // 当前选中项已不存在（如被删除）：优先选同类型项目，避免详情跳到另一类型；无同类型则清空
        if (preferType) {
          const sameType = list.find((p) => (p.type === 'collection') === (preferType === 'collection'))
          return sameType ? sameType.projectId : null
        }
        return list[0]?.projectId ?? null
      })
    } catch (e) {
      setListError(e instanceof Error ? e.message : '加载项目列表失败')
    } finally {
      setListLoading(false)
      refreshInflight.current = false
    }
  }, [listPluginProjects])

  // 仅在挂载时拉取一次（refresh 现已稳定）。
  useEffect(() => { void refresh() }, [refresh])

  const selected = projects.find((p) => p.projectId === selectedId) || null

  // ---------------- 维护闭环：状态聚合与提醒 ----------------
  const maintTargets = useMemo<MaintenanceTarget[]>(() => {
    const acc: MaintenanceTarget[] = []
    for (const proj of projects) for (const pl of proj.plugins) acc.push({ path: pl.path, id: pl.id })
    return acc
  }, [projects])

  // 挂载先回显 storage 缓存（不等网络），让徽标/维护行秒显
  useEffect(() => {
    void loadMaintenanceCache().then((m) => setMaintMap((cur) => ({ ...m, ...cur })))
  }, [])

  // 项目列表就绪后后台聚合（TTL 10min + 共享索引/PR 列表防限流）；发布成功后强制刷新绕过缓存
  const lastPublishTokenRef = useRef(0)
  useEffect(() => {
    if (maintTargets.length === 0) return
    const force = publishReloadToken !== lastPublishTokenRef.current
    lastPublishTokenRef.current = publishReloadToken
    void refreshMaintenance(
      maintTargets,
      (st) => setMaintMap((cur) => ({ ...cur, [st.pluginPath]: st })),
      { force }
    )
  }, [maintTargets, publishReloadToken])

  // 汇总提醒：发现需维护的插件时弹一次（本次打开期间不重复）
  useEffect(() => {
    if (maintNotifiedRef.current) return
    const attention = Object.values(maintMap).filter((m) => m.needsAttention)
    if (attention.length === 0) return
    maintNotifiedRef.current = true
    const names = attention.slice(0, 3).map((m) => m.pluginId).join('、')
    pushToast('info', `${attention.length} 个插件需要维护：${names}${attention.length > 3 ? ' 等' : ''}（详见列表红点与详情页）`)
  }, [maintMap, pushToast])

  // 审查意见回流：从工作台跳到 Vibe 改造，并把意见作为修复指令自动交给 AI
  const handleMaintAiFix = useCallback((plugin: PluginProjectPluginStatus, instruction: string) => {
    setVibeEditTarget({ path: plugin.path, id: plugin.id, displayName: plugin.displayName, token: Date.now(), instruction })
    setTab('vibe')
    addLog('info', `▶ 审查意见回流：转 Vibe 改造 ${plugin.displayName || plugin.id}`)
  }, [addLog])

  const addByDir = useCallback(async (source: 'imported' | 'added') => {
    try {
      const dir = await dev.selectDirectory()
      if (!dir) return
      addLog('info', `添加项目：${dir}`)
      const res = await dev.addPluginProject(dir, source)
      if (res.success) {
        pushToast('success', '项目已加入开发列表')
        addLog('success', `✔ 已添加并触发加载：${dir}`)
        await refresh(true)
      } else {
        pushToast('error', res.error || '添加失败')
        addLog('error', `✘ 添加失败：${res.error || dir}`)
      }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '添加失败')
    }
  }, [dev, addLog, pushToast, refresh])

  const handleAction = useCallback(async (action: DetailAction, plugin?: PluginProjectPluginStatus) => {
    if (!selected) return
    const path = plugin?.path || selected.path
    setBusyAction(action)
    try {
      switch (action) {
        case 'build': {
          reportActivity('构建并载入')
          addLog('info', `▶ 构建：${path}`)
          const r = await dev.buildPlugin(path)
          if (r.log) addLog(r.success ? 'success' : 'error', r.log)
          if (r.success) {
            pushToast('success', '构建成功')
            // 构建后稳定自动载入，避免「已构建但未加载」需手动刷新
            const loaded = await dev.ensureLoaded(path)
            addLog(
              loaded.success ? 'success' : 'warn',
              loaded.success
                ? `✔ 已自动刷新载入：${loaded.id || path}`
                : `⚠ 构建成功但自动载入失败：${loaded.error || '请手动点击刷新'}`
            )
          } else {
            pushToast('error', r.error || '构建失败')
          }
          await refresh(true)
          break
        }
        case 'pack': {
          reportActivity('打包插件')
          addLog('info', `▶ 打包：${path}`)
          const r = await dev.packPlugin(path)
          if (r.log) addLog(r.success ? 'success' : 'error', r.log)
          r.success ? pushToast('success', `打包完成${r.outFile ? `：${r.outFile}` : ''}`) : pushToast('error', r.error || '打包失败')
          break
        }
        case 'reload': {
          const targetPlugin = plugin || selected.plugins[0]
          if (!targetPlugin) { pushToast('error', '该项目下无可重载插件'); break }
          const canReloadById = !!targetPlugin.loaded && !!targetPlugin.id
          reportActivity('刷新载入')
          addLog('info', `▶ 刷新载入：${canReloadById ? targetPlugin.id : targetPlugin.path}`)
          const r = canReloadById
            ? await dev.reloadPlugin(targetPlugin.id)
            : await dev.reloadPluginByPath(targetPlugin.path)
          r.success ? pushToast('success', '已刷新载入') : pushToast('error', r.error || '刷新失败')
          await refresh(true)
          break
        }
        case 'open': {
          await dev.openPluginDir(path)
          break
        }
        case 'launch': {
          const target = plugin || selected.plugins[0]
          if (!target?.id) { pushToast('error', '该项目下无可启动的插件'); break }
          if (!target.loaded) { pushToast('error', '插件尚未载入，请先构建并刷新载入'); break }
          const p = (window as any)?.mulby?.plugin
          if (!p?.run) { pushToast('info', '当前环境不支持启动插件，请在 Mulby 主输入框用触发词打开'); break }
          // 取插件首个功能码（silent/无界面插件同样可用，run 会执行其逻辑）
          let code = 'main'
          try {
            const cmds = await p.listCommands?.(target.id)
            const first = Array.isArray(cmds) ? cmds.find((c: any) => c?.featureCode || c?.code) : null
            code = first?.featureCode || first?.code || 'main'
          } catch { /* 用默认 main */ }
          addLog('info', `▶ 打开插件：${target.id} · ${code}`)
          const r = await p.run(target.id, code, '')
          if (r?.success) pushToast('success', r.hasUI ? '已打开插件窗口' : '插件已执行（无界面）')
          else pushToast('error', r?.error || '打开失败，可在 Mulby 主输入框用触发词打开')
          break
        }
        case 'vibe': {
          const target = plugin || selected.plugins[0]
          const tPath = target?.path || path
          setVibeEditTarget({ path: tPath, id: target?.id, displayName: target?.displayName, token: Date.now() })
          setTab('vibe')
          addLog('info', `▶ 转到 Vibe 改造：${target?.displayName || target?.id || tPath}`)
          break
        }
        case 'publish': {
          const target = plugin || selected.plugins[0]
          if (!target) { pushToast('error', '该项目下无可发布插件'); break }
          reportActivity('发布预检')
          // 与 Vibe 发布同一门禁：先跑一次契约一致性校验
          let conformance: ConformanceResult | null = null
          try {
            const r = await dev.hostCall<ConformanceResult>('check_conformance', { root: target.path })
            conformance = { ok: !!r?.ok, ran: r?.ran !== false, issues: Array.isArray(r?.issues) ? r.issues : [], summary: r?.summary }
          } catch { conformance = null }
          setPublishTarget({
            path: target.path, pluginId: target.id, displayName: target.displayName,
            built: !!target.built,
            contract: { ...defaultContract(target.displayName || target.id), name: target.id, displayName: target.displayName || target.id },
            conformance
          })
          break
        }
        case 'readme': {
          await dev.openPluginDir(path)
          pushToast('info', '已在目录中打开，请查看 README.md')
          break
        }
        case 'remove': {
          const removedId = selected.projectId
          const removedType = selected.type === 'collection' ? 'collection' : 'single'
          // 删除前在当前列表里确定性挑一个同类型兄弟项目；没有则清空（绝不跳到另一类型）
          const sibling = projects.find((p) => p.projectId !== removedId && (p.type === 'collection') === (removedType === 'collection'))
          const r = await dev.removePluginProject({ id: removedId })
          if (r.success) {
            setSelectedId(sibling ? sibling.projectId : null)
            pushToast('success', '已从开发列表移除（磁盘文件保留）')
            addLog('info', `已移除项目：${selected.path}`)
            await refresh(true, removedType)
          } else {
            pushToast('error', r.error || '移除失败')
          }
          break
        }
      }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '操作失败')
    } finally {
      setBusyAction(null)
      reportActivity(null)
    }
  }, [selected, dev, addLog, pushToast, refresh, reportActivity])

  const handleCreate = useCallback(async (payload: CreatePayload) => {
    setCreating(true)
    reportActivity('创建脚手架')
    try {
      addLog('info', `▶ 创建插件：${payload.name}（${payload.template}）→ ${payload.targetDir}`)
      const r = await dev.createPlugin(payload.targetDir, payload.name, payload.template)
      if (r.log) addLog(r.success ? 'success' : 'error', r.log)
      if (r.success) {
        pushToast('success', `已创建插件 ${payload.name}`)
        setCreateOpen(false)
        await refresh(true)
      } else {
        pushToast('error', r.error || '创建失败')
      }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
      reportActivity(null)
    }
  }, [dev, addLog, pushToast, refresh, reportActivity])

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 dark:bg-[#0b0d12] text-slate-800 dark:text-slate-200 overflow-hidden">
      {/* 顶部栏 */}
      <header className="flex items-center gap-3 px-4 h-14 border-b border-slate-200 dark:border-slate-800 glass-panel shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-[0_0_14px_rgba(16,185,129,0.35)]">
            <Wrench size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight text-slate-800 dark:text-slate-100">Mulby 开发者工具</h1>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">插件开发工作台</p>
          </div>
        </div>

        <div className="ml-3 flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/70">
          <TabBtn active={tab === 'workbench'} onClick={() => setTab('workbench')} icon={<PanelsTopLeft size={14} />} label="工作台" />
          <TabBtn active={tab === 'vibe'} onClick={() => setTab('vibe')} icon={<Sparkles size={14} />} label="Vibe Coding" />
        </div>

        <div className="flex-1" />

        {!dev.apiReady && (
          <span className="badge badge-amber" title="宿主 developer API 尚未就绪，当前为演示数据">演示模式（Mock）</span>
        )}
        {tab === 'workbench' && (
          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> 创建</button>
            <button className="btn-secondary" onClick={() => addByDir('imported')}><FolderInput size={15} /> 导入</button>
            <button className="btn-secondary" onClick={() => addByDir('added')}><FolderPlus size={15} /> 添加目录</button>
            <button className="btn-ghost" onClick={() => refresh()} disabled={listLoading} title="刷新全部">
              <RefreshCw size={15} className={listLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </header>

      {/* 全局错误条 */}
      {(listError || dev.error) && (
        <div className="flex items-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900/40 text-sm text-rose-700 dark:text-rose-300">
          <AlertCircle size={15} className="shrink-0" />
          <span className="flex-1 truncate">{listError || dev.error}</span>
          <button onClick={() => { setListError(null); dev.clearError() }} className="shrink-0 hover:text-rose-900 dark:hover:text-rose-100"><X size={14} /></button>
        </div>
      )}

      {/* 主体 */}
      <div className="flex-1 min-h-0 relative">
        <div className={tab === 'vibe' ? 'absolute inset-0' : 'absolute inset-0 hidden'}>
          <SessionProvider>
            <VibePanel
              dev={dev}
              addLog={addLog}
              pushToast={pushToast}
              onPickDir={dev.selectDirectory}
              onAfterCreate={() => refresh(true)}
              onSyncWorkbench={() => refresh(true)}
              knownPlugins={knownPlugins}
              editTarget={vibeEditTarget}
              onConsumeEditTarget={() => setVibeEditTarget(null)}
              setActivity={reportActivity}
              active={tab === 'vibe'}
            />
          </SessionProvider>
        </div>
        <div className={tab === 'workbench' ? 'absolute inset-0' : 'absolute inset-0 hidden'}>
          <div className="flex h-full">
            {/* 左：项目列表 */}
            <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 overflow-hidden bg-white/40 dark:bg-slate-900/30">
              <ProjectList
                projects={projects}
                selectedId={selectedId}
                loading={listLoading}
                onSelect={setSelectedId}
                maint={maintMap}
              />
            </aside>

            {/* 右：详情 */}
            <main className="flex-1 min-w-0 flex flex-col">
              {listLoading && projects.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                  <Loader2 size={22} className="animate-spin mr-2" /> 加载开发项目…
                </div>
              ) : projects.length === 0 ? (
                <EmptyState
                  onCreate={() => setCreateOpen(true)}
                  onImport={() => addByDir('imported')}
                  onAddDir={() => addByDir('added')}
                />
              ) : selected ? (
                <>
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <ProjectDetail project={selected} busyAction={busyAction} onAction={handleAction} pushToast={pushToast} publishReloadToken={publishReloadToken} maint={maintMap} onAiFix={handleMaintAiFix} />
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">从左侧选择一个项目</div>
              )}
            </main>
          </div>
        </div>
      </div>
      {/* 统一日志面板：工作台/Vibe 共用，支持折叠 */}
      <div className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-900/40">
        <button
          className="w-full h-9 px-3 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100/70 dark:hover:bg-slate-800/50"
          onClick={() => setLogCollapsed((v) => !v)}
        >
          {activity ? (
            <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
              <Loader2 size={12} className="animate-spin" />
              {activity.label} · {Math.max(0, Math.round((Date.now() - activity.startedAt) / 1000))}s
            </span>
          ) : errorCount > 0 ? (
            <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <AlertCircle size={12} /> 诊断日志 · {errorCount} 个错误
            </span>
          ) : (
            <span>诊断日志（{logs.length}）</span>
          )}
          {logCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {!logCollapsed && (
          <div className="h-52">
            <LogPanel logs={logs} onClear={() => setLogs([])} />
          </div>
        )}
      </div>

      <CreateDialog
        open={createOpen}
        busy={creating}
        onClose={() => setCreateOpen(false)}
        onPickDir={dev.selectDirectory}
        onSubmit={handleCreate}
      />
      {/* 工作台直接发布：复用 Vibe 的发布对话框（账号→预检→元信息→文件→提交 PR） */}
      <PublishDialog
        open={!!publishTarget}
        onClose={() => setPublishTarget(null)}
        createdPath={publishTarget?.path || ''}
        contract={publishTarget?.contract || defaultContract('')}
        dev={dev}
        built={publishTarget?.built ?? false}
        conformance={publishTarget?.conformance ?? null}
        pushToast={pushToast}
        onPublished={() => setPublishReloadToken((n) => n + 1)}
        onVersionBumped={(v) => {
          setPublishTarget((t) => (t ? { ...t, contract: { ...t.contract, version: v } } : t))
          void refresh(true)
        }}
      />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
        active
          ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm'
          : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {icon}{label}
    </button>
  )
}
