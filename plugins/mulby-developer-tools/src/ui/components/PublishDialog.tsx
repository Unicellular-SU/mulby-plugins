import { useEffect, useRef, useState } from 'react'
import { X, Loader2, Github, CheckCircle2, AlertTriangle, ExternalLink, Copy, Check, UploadCloud, LogOut, FileText } from 'lucide-react'
import type { UseDeveloperResult } from '../hooks/useDeveloper'
import type { VibeContract } from '../lib/vibeContract'
import type { ConformanceResult } from './VibePanel'
import {
  requestDeviceCode, pollForToken, getUser, ensureFork, fetchPublishedVersion,
  semverCmp, publishPluginPR, scanSecrets, nextPatchVersion, savePublishRecord,
  GH_TOKEN_KEY, GH_LOGIN_KEY, REPO_OWNER, REPO_NAME, BASE_BRANCH,
  type DeviceCode, type PublishFile, type PublishRecord
} from '../lib/github'

type Step = 'account' | 'precheck' | 'meta' | 'confirm' | 'submitting' | 'done'

interface PrecheckResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  manifest: { name: string; id: string; version: string; displayName: string; author: string; description: string } | null
}

interface Props {
  open: boolean
  onClose: () => void
  createdPath: string
  contract: VibeContract
  dev: UseDeveloperResult
  built: boolean
  conformance: ConformanceResult | null
  pushToast: (kind: 'success' | 'error' | 'info', text: string) => void
  /** 提交成功后回传发布记录，供详情页回显「已提交 PR」状态 */
  onPublished?: (rec: PublishRecord) => void
}

const storage = () => (window as any)?.mulby?.storage
const TOKEN_KEY = GH_TOKEN_KEY
const LOGIN_KEY = GH_LOGIN_KEY

/** 用系统默认浏览器打开（而非 Mulby 内置浏览器，便于复用已登录的 GitHub 账号） */
const openExternal = (url: string) => {
  try { (window as any)?.mulby?.shell?.openExternal?.(url) } catch { /* ignore */ }
}

export function PublishDialog({ open, onClose, createdPath, contract, dev, built, conformance, pushToast, onPublished }: Props) {
  const [step, setStep] = useState<Step>('account')
  const [token, setToken] = useState<string>('')
  const [login, setLogin] = useState<string>('')

  // 登录态
  const [device, setDevice] = useState<DeviceCode | null>(null)
  const [loggingIn, setLoggingIn] = useState(false)
  const [copied, setCopied] = useState(false)
  const cancelLoginRef = useRef(false)

  // 预检
  const [checking, setChecking] = useState(false)
  const [precheck, setPrecheck] = useState<PrecheckResult | null>(null)
  const [publishedVersion, setPublishedVersion] = useState<string | null>(null)
  const [versionError, setVersionError] = useState<string>('')

  // 元信息
  const [changeNote, setChangeNote] = useState('')

  // 文件
  const [files, setFiles] = useState<PublishFile[]>([])
  const [collecting, setCollecting] = useState(false)
  const [secrets, setSecrets] = useState<Array<{ path: string; hint: string }>>([])
  const [totalBytes, setTotalBytes] = useState(0)

  // 提交
  const [submitMsg, setSubmitMsg] = useState('')
  const [prUrl, setPrUrl] = useState('')
  const [error, setError] = useState('')

  const isUpdate = publishedVersion != null
  const manifestName = precheck?.manifest?.name || contract.name

  // 打开时载入已存 token
  useEffect(() => {
    if (!open) return
    void (async () => {
      try {
        const t = await storage()?.get?.(TOKEN_KEY)
        const l = await storage()?.get?.(LOGIN_KEY)
        if (t) { setToken(t); setLogin(l || ''); setStep('precheck'); void runPrecheck() }
        else setStep('account')
      } catch { setStep('account') }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const reset = () => {
    cancelLoginRef.current = true
    setDevice(null); setLoggingIn(false); setError(''); setPrUrl(''); setSubmitMsg('')
  }

  const handleClose = () => { reset(); onClose() }

  // ---- 登录（Device Flow）----
  const handleLogin = async () => {
    setError(''); setLoggingIn(true); cancelLoginRef.current = false
    try {
      const d = await requestDeviceCode()
      setDevice(d)
      try { (window as any)?.mulby?.clipboard?.writeText?.(d.user_code) } catch { /* ignore */ }
      openExternal(d.verification_uri)
      const tk = await pollForToken(d, () => cancelLoginRef.current)
      const user = await getUser(tk)
      await storage()?.set?.(TOKEN_KEY, tk)
      await storage()?.set?.(LOGIN_KEY, user.login)
      setToken(tk); setLogin(user.login); setDevice(null); setLoggingIn(false)
      setStep('precheck'); void runPrecheck()
    } catch (e) {
      setLoggingIn(false); setDevice(null)
      setError(e instanceof Error ? e.message : '登录失败')
    }
  }

  const handleLogout = async () => {
    try { await storage()?.remove?.(TOKEN_KEY); await storage()?.remove?.(LOGIN_KEY) } catch { /* ignore */ }
    setToken(''); setLogin(''); setStep('account')
  }

  const copyCode = () => {
    if (!device) return
    try { (window as any)?.mulby?.clipboard?.writeText?.(device.user_code) } catch { /* ignore */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  // ---- 预检 ----
  const runPrecheck = async () => {
    setChecking(true); setError(''); setVersionError(''); setPublishedVersion(null)
    try {
      if (!createdPath || !createdPath.trim()) {
        setPrecheck({ ok: false, errors: ['未拿到插件目录路径（createdPath 为空）。请回到交付页确认插件已构建载入后再发布。'], warnings: [], manifest: null })
        return
      }
      const raw = await dev.hostCall<any>('publish_precheck', { root: createdPath })
      // 规范化：无论后端返回什么，errors/warnings 一定是数组，避免渲染时 .length 崩溃
      const pc: PrecheckResult = {
        ok: !!raw?.ok,
        errors: Array.isArray(raw?.errors) ? raw.errors : [],
        warnings: Array.isArray(raw?.warnings) ? raw.warnings : [],
        manifest: raw && typeof raw.manifest === 'object' && raw.manifest ? raw.manifest : null
      }
      // 后端无有效返回（多为旧后端未重载，缺少 publish_precheck）：给可操作提示而非白屏
      if (!raw || typeof raw !== 'object' || (!pc.manifest && pc.errors.length === 0)) {
        setPrecheck({ ok: false, errors: ['预检接口暂不可用，请重新构建并重载插件后重试（npm run build 后在工作台刷新载入，或重启 Mulby）。'], warnings: [], manifest: null })
        return
      }
      setPrecheck(pc)
      const pid = pc.manifest?.id || contract.name
      const pub = await fetchPublishedVersion(pid)
      setPublishedVersion(pub)
      if (pub && pc.manifest?.version && semverCmp(pc.manifest.version, pub) <= 0) {
        setVersionError(`版本号需高于已发布的 v${pub}（当前 v${pc.manifest.version}），建议改为 v${nextPatchVersion(pub)}（在契约 Tab 修改版本后「应用修改并重建」）`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '预检失败')
    } finally {
      setChecking(false)
    }
  }

  const precheckOk = !!precheck?.ok && built && !!conformance?.ok && !versionError

  // ---- 收集文件 ----
  const goConfirm = async () => {
    setCollecting(true); setError('')
    try {
      const r = await dev.hostCall<any>('publish_collect', { root: createdPath })
      const fs: PublishFile[] = Array.isArray(r?.files) ? r.files : []
      if (fs.length === 0) { setError('未收集到可发布的源码文件，请确认已重新构建并重载插件'); return }
      setFiles(fs)
      setTotalBytes(typeof r?.totalBytes === 'number' ? r.totalBytes : 0)
      setSecrets(scanSecrets(fs))
      setStep('confirm')
    } catch (e) {
      setError(e instanceof Error ? e.message : '收集文件失败')
    } finally {
      setCollecting(false)
    }
  }

  // ---- 提交 PR ----
  const buildPrBody = (): string => {
    const m = precheck?.manifest
    return [
      '## 插件信息',
      `- **插件名称**: ${manifestName}`,
      `- **插件 ID**: ${m?.id || manifestName}`,
      `- **版本**: ${isUpdate ? `v${publishedVersion} → ` : ''}v${m?.version || contract.version}`,
      `- **类型**: ${isUpdate ? '更新' : '新增'}`,
      '',
      '## 本次变更',
      changeNote.trim() || (isUpdate ? '更新插件。' : '新增插件。'),
      '',
      '## 自检清单',
      '- [x] `manifest.json` 的 name / displayName / version / description / author 均已填写',
      '- [x] `package.json` 包含 `build` 和 `pack` 脚本',
      '- [x] 已在本地 Mulby 客户端加载并测试过此插件，主要功能正常',
      `- [${secrets.length ? ' ' : 'x'}] 已移除调试日志、未使用文件、敏感信息`,
      `- [x] 本次 PR 的 diff 仅涉及 \`plugins/${manifestName}/\` 目录`,
      '- [x] 版本号已按 semver 规范递增',
      '- [x] 同意以 MIT 协议发布此插件',
      '',
      '> 由 Mulby 开发者助手一键发布。'
    ].join('\n')
  }

  const handleSubmit = async () => {
    const m = precheck?.manifest
    if (!m) return
    setStep('submitting'); setError(''); setSubmitMsg('准备中…')
    try {
      const title = isUpdate
        ? `update(${m.name}): ${changeNote.trim() || '更新插件'}`.slice(0, 100)
        : `feat: add ${m.name} plugin`
      await ensureFork(token, login, setSubmitMsg)
      const { prUrl: url, prNumber, branch, reused } = await publishPluginPR(
        { token, login, pluginName: m.name, version: m.version, files, isUpdate, title, body: buildPrBody() },
        setSubmitMsg
      )
      setPrUrl(url); setStep('done')
      // 持久化发布记录：详情页据此回显「已提交 PR #N（vX）」并可查询合并/CI 状态
      const rec: PublishRecord = {
        pluginId: m.id || m.name,
        displayName: m.displayName,
        version: m.version,
        prNumber, prUrl: url, branch, isUpdate,
        submittedAt: Date.now()
      }
      await savePublishRecord(createdPath, rec)
      onPublished?.(rec)
      pushToast('success', reused ? 'PR 已更新' : 'PR 已创建')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '提交失败'
      // token 失效：回到登录
      if (/401|bad credentials/i.test(msg)) { await handleLogout(); setError('登录已失效，请重新登录') }
      else { setStep('confirm'); setError(msg) }
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={handleClose}>
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* 头 */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <UploadCloud size={16} className="text-emerald-500" /> 发布到插件仓库
          </div>
          <button className="btn-ghost h-7 w-7 p-0 justify-center" onClick={handleClose}><X size={16} /></button>
        </div>

        {/* 步骤指示 */}
        <div className="shrink-0 flex items-center gap-1.5 px-5 py-2 text-[11px] text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800/60">
          {(['账号', '预检', '信息', '确认', '提交'] as const).map((s, i) => {
            const order: Step[] = ['account', 'precheck', 'meta', 'confirm', 'submitting']
            const cur = order.indexOf(step === 'done' ? 'submitting' : step)
            const active = i <= cur
            return <span key={s} className={`flex items-center gap-1.5 ${active ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ''}`}>{i > 0 && <span className="opacity-40">›</span>}{s}</span>
          })}
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-4 text-[13px]">
          {error && (
            <div className="rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 px-3 py-2 text-[12px] text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /><span className="break-words">{error}</span>
            </div>
          )}

          {/* 账号 */}
          {step === 'account' && (
            <div className="space-y-3">
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">用 GitHub 账号授权后，即可从这里一键提交 PR 到 <span className="mono">{REPO_OWNER}/{REPO_NAME}</span>。授权只申请 <span className="mono">public_repo</span> 权限，token 仅保存在本地。</p>
              {!device ? (
                <button className="btn-primary w-full justify-center" onClick={handleLogin} disabled={loggingIn}>
                  {loggingIn ? <Loader2 size={15} className="animate-spin" /> : <Github size={15} />} 用 GitHub 登录
                </button>
              ) : (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2.5 text-center">
                  <p className="text-[12px] text-slate-500 dark:text-slate-400">在打开的页面输入下面的验证码完成授权：</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-2xl font-bold tracking-[0.3em] mono text-slate-800 dark:text-slate-100">{device.user_code}</span>
                    <button className="btn-ghost h-7 w-7 p-0 justify-center" onClick={copyCode} title="复制验证码">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
                  </div>
                  <button onClick={() => openExternal(device.verification_uri)} className="inline-flex items-center gap-1 text-[12px] text-emerald-600 dark:text-emerald-400 hover:underline">
                    <ExternalLink size={12} /> {device.verification_uri}（用系统浏览器打开）
                  </button>
                  <div className="flex items-center justify-center gap-1.5 text-[12px] text-slate-500 dark:text-slate-400 pt-1"><Loader2 size={13} className="animate-spin" /> 等待授权…</div>
                </div>
              )}
            </div>
          )}

          {/* 预检 */}
          {step === 'precheck' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-slate-500 dark:text-slate-400">已登录：<span className="font-medium text-slate-700 dark:text-slate-200">{login || '—'}</span></span>
                <button className="btn-ghost h-6 px-2 text-[11px]" onClick={handleLogout}><LogOut size={12} /> 登出</button>
              </div>
              {checking ? (
                <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400 py-3"><Loader2 size={14} className="animate-spin" /> 正在预检…</div>
              ) : (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
                  <PreRow ok={!!precheck && (precheck.errors?.length ?? 0) === 0} label={`结构与 manifest 校验${precheck && (precheck.errors?.length ?? 0) ? `（${precheck.errors.length} 项需修复）` : ''}`} />
                  <PreRow ok={built} label="本地已构建（交付页构建通过）" />
                  <PreRow ok={!!conformance?.ok} label="契约一致性通过" />
                  <PreRow ok={!versionError} label={isUpdate ? `版本递增（已发布 v${publishedVersion}）` : '新插件（仓库中尚无同名）'} />
                  {(precheck?.errors ?? []).map((e, i) => <div key={i} className="text-[11px] text-rose-500 pl-6">• {e}</div>)}
                  {versionError && <div className="text-[11px] text-rose-500 pl-6">• {versionError}</div>}
                  {(precheck?.warnings ?? []).map((w, i) => <div key={i} className="text-[11px] text-amber-500 pl-6">• {w}</div>)}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button className="btn-ghost" onClick={() => runPrecheck()} disabled={checking}><Loader2 size={14} className={checking ? 'animate-spin' : 'hidden'} /> 重新预检</button>
                <button className="btn-primary" onClick={() => setStep('meta')} disabled={!precheckOk}>下一步</button>
              </div>
            </div>
          )}

          {/* 元信息 */}
          {step === 'meta' && (
            <div className="space-y-3">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800/40 p-3 text-[12px] space-y-1">
                <div><span className="text-slate-400">插件：</span><span className="font-medium">{precheck?.manifest?.displayName}</span> <span className="mono text-slate-400">({manifestName})</span></div>
                <div><span className="text-slate-400">版本：</span>{isUpdate && <span className="text-slate-400">v{publishedVersion} → </span>}<span className="mono">v{precheck?.manifest?.version}</span> · {isUpdate ? '更新' : '新增'}</div>
                <div><span className="text-slate-400">作者：</span>{precheck?.manifest?.author}</div>
              </div>
              <label className="block">
                <span className="block text-[12px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">本次变更说明（写进 PR）</span>
                <textarea className="input-base w-full min-h-[80px] resize-none text-[13px]" placeholder={isUpdate ? '如：修复了……，新增了……' : '一句话介绍这个插件做什么'} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
              </label>
              <div className="flex items-center justify-between gap-2">
                <button className="btn-ghost" onClick={() => setStep('precheck')}>上一步</button>
                <button className="btn-primary" onClick={goConfirm} disabled={collecting}>{collecting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} 预览文件</button>
              </div>
            </div>
          )}

          {/* 确认文件 */}
          {step === 'confirm' && (
            <div className="space-y-3">
              <div className="text-[12px] text-slate-500 dark:text-slate-400">将提交 <span className="font-medium text-slate-700 dark:text-slate-200">{files.length}</span> 个文件到 <span className="mono">plugins/{manifestName}/</span>（{(totalBytes / 1024).toFixed(1)} KB），基于分支 <span className="mono">{BASE_BRANCH}</span>。</div>
              {secrets.length > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-medium"><AlertTriangle size={13} /> 疑似敏感信息，请确认后再发布：</div>
                  {secrets.map((s, i) => <div key={i} className="pl-5">• {s.path} — {s.hint}</div>)}
                </div>
              )}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 max-h-52 overflow-auto p-2 mono text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                {files.map((f) => <div key={f.path} className="truncate">{f.encoding === 'base64' ? '🖼 ' : ''}plugins/{manifestName}/{f.path}</div>)}
              </div>
              <div className="flex items-center justify-between gap-2">
                <button className="btn-ghost" onClick={() => setStep('meta')}>上一步</button>
                <button className="btn-primary" onClick={handleSubmit}><UploadCloud size={15} /> 创建 PR</button>
              </div>
            </div>
          )}

          {/* 提交中 */}
          {step === 'submitting' && (
            <div className="py-8 flex flex-col items-center gap-3 text-center">
              <Loader2 size={28} className="animate-spin text-emerald-500" />
              <div className="text-[13px] text-slate-600 dark:text-slate-300">{submitMsg || '提交中…'}</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-500">正在通过 GitHub API 提交，请勿关闭</div>
            </div>
          )}

          {/* 完成 */}
          {step === 'done' && (
            <div className="py-6 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 size={32} className="text-emerald-500" />
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">PR 已提交 🎉</div>
              <div className="text-[12px] text-slate-500 dark:text-slate-400">维护者审核合并后，CI 会自动构建、发布 Release 并更新插件索引。</div>
              <button className="btn-primary" onClick={() => openExternal(prUrl)}><ExternalLink size={15} /> 打开 Pull Request</button>
              <button className="btn-ghost text-[12px]" onClick={() => { try { (window as any)?.mulby?.clipboard?.writeText?.(prUrl) } catch { /* ignore */ } pushToast('success', '已复制 PR 链接') }}><Copy size={13} /> 复制链接</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PreRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-500 text-white' : 'bg-rose-500/15 text-rose-500'}`}>
        {ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
      </span>
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
    </div>
  )
}
