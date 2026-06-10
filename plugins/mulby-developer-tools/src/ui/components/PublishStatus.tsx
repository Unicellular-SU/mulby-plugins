import { useCallback, useEffect, useState } from 'react'
import {
  RotateCcw, RefreshCw, Loader2, CheckCircle2, XCircle, Clock, GitMerge, ExternalLink,
  type LucideIcon
} from 'lucide-react'
import {
  loadPublishRecord, savePublishRecord, getStoredToken, getStoredLogin,
  fetchPublishLive, discoverPluginPR, rerunPR,
  type PublishRecord, type PublishLive
} from '../lib/github'

type Toast = (kind: 'success' | 'error' | 'info', text: string) => void

const openExt = (url: string) => { try { (window as any)?.mulby?.shell?.openExternal?.(url) } catch { /* ignore */ } }

/** 把综合状态映射为徽标文案 + 配色 + SVG 图标（不用 emoji） */
function publishStatusMeta(live: PublishLive | null, loading: boolean): { label: string; cls: string; Icon: LucideIcon; spin?: boolean } {
  if (loading && !live) return { label: '查询中', cls: 'bg-slate-400/15 text-slate-500', Icon: Loader2, spin: true }
  if (!live) return { label: '待审核', cls: 'bg-slate-400/15 text-slate-500', Icon: Clock }
  switch (live.state) {
    case 'merged': return { label: '已合并', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', Icon: GitMerge }
    case 'closed': return { label: '已关闭', cls: 'bg-slate-400/15 text-slate-500', Icon: XCircle }
    case 'ci_failed': return { label: 'CI 未通过', cls: 'bg-rose-500/15 text-rose-500', Icon: XCircle }
    case 'ci_running': return { label: 'CI 检查中', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', Icon: Loader2, spin: true }
    case 'ci_passed': return { label: '待合并', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', Icon: CheckCircle2 }
    default: return { label: '待审核', cls: 'bg-slate-400/15 text-slate-500', Icon: Clock }
  }
}

/** 徽标下方的辅助说明文案 */
function publishStatusText(live: PublishLive | null, loading: boolean): string {
  if (loading && !live) return '正在查询 PR 与 CI 状态…'
  if (!live) return '登录 GitHub 后可查看合并 / CI 状态，或点开 PR 查看'
  if (live.state === 'merged') return '已合并，CI 将自动构建并发布 Release'
  if (live.state === 'closed') return 'PR 已关闭（未合并）'
  const c = live.checks
  if (c.total > 0) return `CI 检查 ${c.passed}/${c.total} 通过${c.failed ? `，${c.failed} 失败` : ''}`
  return '等待维护者审核'
}

/**
 * 发布状态徽标（presentational）：竖向三行布局——状态行 / 详情行 / 操作行，
 * 避免窄抽屉里水平挤压导致信息看不全；图标全部用 lucide SVG（无 emoji）。
 * confirmRerun 为 true 时「重新跑 CI」按钮显示二次确认态。
 */
export function PublishStatusBadge({ record, live, loading, onRefresh, onRerunCi, rerunning, confirmRerun }: {
  record: PublishRecord; live: PublishLive | null; loading: boolean; onRefresh: () => void
  onRerunCi: () => void; rerunning: boolean; confirmRerun?: boolean
}) {
  const meta = publishStatusMeta(live, loading)
  const Icon = meta.Icon
  // PR 仍开着（未合并/未关闭）才给重跑 CI；状态未知时也允许（点了会提示登录）
  const canRerun = !live || (live.state !== 'merged' && live.state !== 'closed')
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2 text-[12px]">
      {/* 状态行：状态徽章 + PR 链接 */}
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${meta.cls}`}>
          <Icon size={13} className={meta.spin ? 'animate-spin' : ''} /> {meta.label}
        </span>
        <button className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline shrink-0" onClick={() => openExt(record.prUrl)} title="在浏览器打开 PR">
          PR #{record.prNumber} <ExternalLink size={12} />
        </button>
      </div>
      {/* 详情行：版本 / 类型 / 状态说明（可换行，不截断） */}
      <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
        v{record.version} · {record.isUpdate ? '更新' : '新增'} · {publishStatusText(live, loading)}
      </div>
      {/* 操作行：等宽平铺 */}
      <div className="flex items-center gap-2">
        {canRerun && (
          <button
            className={`btn-ghost h-7 px-2 text-[11px] flex-1 justify-center ${confirmRerun ? 'text-amber-600 dark:text-amber-400' : ''}`}
            onClick={onRerunCi} disabled={rerunning}
            title="关闭再重开 PR 以重新触发 CI（用上最新 workflow）"
          >
            <RotateCcw size={13} className={rerunning ? 'animate-spin' : ''} /> {rerunning ? '重跑中…' : confirmRerun ? '确认重跑?' : '重新跑 CI'}
          </button>
        )}
        <button className="btn-ghost h-7 px-2 text-[11px] flex-1 justify-center" onClick={onRefresh} disabled={loading} title="刷新 PR / CI 状态">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新
        </button>
      </div>
    </div>
  )
}

/**
 * 自包含的发布状态卡：给定插件目录即可回显「已提交 PR」+ 合并/CI 状态，
 * 支持刷新与「重新跑 CI」（内联二次确认）。本地记录优先秒显，再用网络发现以 GitHub 为准。
 * reloadToken 变化时强制重新加载（发布成功后由外部 +1 触发）。
 */
export function PublishStatusCard({ pluginPath, pluginName, pushToast, reloadToken }: {
  pluginPath: string; pluginName?: string; pushToast?: Toast; reloadToken?: number
}) {
  const [record, setRecord] = useState<PublishRecord | null>(null)
  const [live, setLive] = useState<PublishLive | null>(null)
  const [loading, setLoading] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [confirmRerun, setConfirmRerun] = useState(false)

  const refresh = useCallback(async (rec: PublishRecord | null) => {
    if (!rec) return
    setLoading(true)
    try {
      const token = await getStoredToken()
      if (!token) { setLive(null); return }
      setLive(await fetchPublishLive(token, rec.prNumber))
    } catch {
      setLive(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    setLive(null); setConfirmRerun(false)
    if (!pluginPath) { setRecord(null); return }
    void (async () => {
      const local = await loadPublishRecord(pluginPath)
      if (!alive) return
      setRecord(local)
      if (local) void refresh(local)
      try {
        const token = await getStoredToken()
        const login = await getStoredLogin()
        const name = pluginName || pluginPath.split('/').filter(Boolean).pop() || ''
        if (!token || !login || !name) return
        const found = await discoverPluginPR(token, login, name)
        if (!alive || !found) return
        setRecord(found)
        void savePublishRecord(pluginPath, found)
        void refresh(found)
      } catch { /* 网络/限流失败：保留本地缓存 */ }
    })()
    return () => { alive = false }
  }, [pluginPath, pluginName, reloadToken, refresh])

  const doRerun = useCallback(async (rec: PublishRecord) => {
    setRerunning(true)
    try {
      const token = await getStoredToken()
      if (!token) { pushToast?.('error', '请先在「发布」对话框登录 GitHub'); return }
      await rerunPR(token, rec.prNumber)
      pushToast?.('success', `已重新触发 PR #${rec.prNumber} 的 CI`)
      setTimeout(() => { void refresh(rec) }, 3000)
    } catch (e) {
      pushToast?.('error', e instanceof Error ? e.message : '重新触发失败')
    } finally {
      setRerunning(false); setConfirmRerun(false)
    }
  }, [pushToast, refresh])

  if (!record) return null
  return (
    <PublishStatusBadge
      record={record} live={live} loading={loading}
      onRefresh={() => refresh(record)}
      rerunning={rerunning} confirmRerun={confirmRerun}
      onRerunCi={() => {
        if (confirmRerun) void doRerun(record)
        else { setConfirmRerun(true); setTimeout(() => setConfirmRerun(false), 4000) }
      }}
    />
  )
}
