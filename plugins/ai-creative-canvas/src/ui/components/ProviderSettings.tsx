import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Mic2,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Video,
  Wrench,
  X,
  XCircle
} from 'lucide-react'
import { useEscClose } from '../hooks'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
import { confirmDialog } from '../store/dialogStore'
import type { ProviderConfig, VideoProviderCapabilities } from '../services/providers/types'
import { presetOpenAiTts, presetCustomVideo, PROVIDER_TEMPLATES } from '../services/providers/presets'
import { testProvider, type ProviderTestResult } from '../services/providers/engine'
import {
  buildProviderRequestPreview,
  resolveVideoCapabilities,
  validateProviderConfig,
  type ProviderConfigIssue
} from '../services/providers/config'

type SettingsSection = 'basic' | 'advanced' | 'diagnostics'

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] min-w-0">
      <span className="flex items-center gap-1 opacity-65">
        {label}
        {hint && <span className="opacity-55" title={hint}>ⓘ</span>}
      </span>
      {children}
    </label>
  )
}

function csvStrings(value: string): string[] {
  return [...new Set(value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean))]
}

function csvNumbers(value: string): number[] {
  return [...new Set(value.split(/[，,\s]+/).map(Number).filter((item) => Number.isFinite(item) && item > 0))].sort((a, b) => a - b)
}

function IssueList({ issues }: { issues: ProviderConfigIssue[] }) {
  if (!issues.length) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] p-3 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
        <div><div className="font-medium">配置检查通过</div><div className="mt-0.5 opacity-70">必填字段、URL 和请求模板均有效。</div></div>
      </div>
    )
  }
  return (
    <div className="space-y-1.5">
      {issues.map((issue, index) => {
        const error = issue.level === 'error'
        const Icon = error ? XCircle : AlertTriangle
        return (
          <div key={`${issue.field}-${index}`} className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${error ? 'border-red-500/20 bg-red-500/[0.07] text-red-700 dark:text-red-300' : 'border-amber-500/20 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300'}`}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <div><span className="font-medium">{error ? '需要修复' : '建议检查'}</span><span className="opacity-75"> · {issue.message}</span></div>
          </div>
        )
      })}
    </div>
  )
}

function TestResult({ result }: { result: ProviderTestResult }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {result.level === 'success'
          ? <CheckCircle2 size={16} className="text-emerald-500" />
          : result.level === 'warning'
            ? <AlertTriangle size={16} className="text-amber-500" />
            : <XCircle size={16} className="text-red-500" />}
        {result.summary}
      </div>
      <div className="mt-2 space-y-1.5">
        {result.checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2 text-[11px]">
            {check.status === 'passed'
              ? <CheckCircle2 size={13} className="mt-0.5 text-emerald-500 shrink-0" />
              : check.status === 'warning'
                ? <AlertTriangle size={13} className="mt-0.5 text-amber-500 shrink-0" />
                : <XCircle size={13} className="mt-0.5 text-red-500 shrink-0" />}
            <div><span className="font-medium">{check.label}</span><span className="opacity-60"> · {check.message}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProviderSettings() {
  const providers = useProviders((state) => state.providers)
  const activeVideoId = useProviders((state) => state.activeVideoId)
  const activeAudioId = useProviders((state) => state.activeAudioId)
  const upsert = useProviders((state) => state.upsert)
  const remove = useProviders((state) => state.remove)
  const setActive = useProviders((state) => state.setActive)
  const getKey = useProviders((state) => state.getKey)
  const setKey = useProviders((state) => state.setKey)
  const close = () => useUi.getState().setShowProviderSettings(false)
  useEscClose(close)

  const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null)
  const [draft, setDraft] = useState<ProviderConfig | null>(null)
  const [keyValue, setKeyValue] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [headersText, setHeadersText] = useState('')
  const [section, setSection] = useState<SettingsSection>('basic')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)

  useEffect(() => {
    let alive = true
    const provider = providers.find((item) => item.id === selectedId) || null
    setDraft(provider ? { ...provider, capabilities: provider.capabilities ? { ...provider.capabilities } : undefined } : null)
    setHeadersText(provider?.headers ? JSON.stringify(provider.headers, null, 2) : '')
    setTestResult(null)
    if (provider) {
      void getKey(provider.id).then((value) => { if (alive) setKeyValue(value) })
    } else {
      setKeyValue('')
    }
    return () => { alive = false }
  }, [selectedId, providers, getKey])

  useEffect(() => {
    if (providers.length && (!selectedId || !providers.some((provider) => provider.id === selectedId))) {
      setSelectedId(providers[0].id)
    }
  }, [providers, selectedId])

  const issues = useMemo(() => draft ? validateProviderConfig(draft, headersText) : [], [draft, headersText])
  const hasErrors = issues.some((issue) => issue.level === 'error')
  const capabilities = draft?.type === 'custom-video' ? resolveVideoCapabilities(draft) : null
  const effectiveDraft = useMemo(() => {
    if (!draft) return null
    if (!headersText.trim()) return { ...draft, headers: undefined }
    try {
      const headers = JSON.parse(headersText)
      if (!headers || typeof headers !== 'object' || Array.isArray(headers) || !Object.values(headers).every((value) => typeof value === 'string')) return null
      return { ...draft, headers: headers as Record<string, string> }
    } catch {
      return null
    }
  }, [draft, headersText])
  const preview = useMemo(() => {
    if (!draft) return null
    if (!effectiveDraft) return { value: null, error: '额外请求头不是合法的 JSON 对象' }
    try {
      return { value: buildProviderRequestPreview(effectiveDraft, !!keyValue), error: '' }
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft, effectiveDraft, keyValue])

  const updateDraft = (patch: Partial<ProviderConfig>) => {
    setDraft((current) => current ? { ...current, ...patch } : current)
    setTestResult(null)
  }
  const updateCapabilities = (patch: Partial<VideoProviderCapabilities>) => {
    if (!draft || !capabilities) return
    updateDraft({ capabilities: { ...capabilities, ...patch } })
  }

  const addPreset = (factory: () => ProviderConfig) => {
    const provider = factory()
    upsert(provider)
    setSelectedId(provider.id)
    setSection('basic')
  }

  const save = async () => {
    if (!draft) return
    const currentIssues = validateProviderConfig(draft, headersText)
    const firstError = currentIssues.find((issue) => issue.level === 'error')
    if (firstError) {
      setSection('diagnostics')
      toast(`无法保存：${firstError.message}`, 'error')
      return
    }
    if (!effectiveDraft) return
    const normalized = effectiveDraft
    upsert(normalized)
    setDraft(normalized)
    const keySaved = await setKey(draft.id, keyValue)
    if (keySaved) toast('Provider 配置与密钥已保存', 'success')
    else toast('配置已保存，但密钥保存失败：系统安全存储不可用', 'error')
  }

  const runTest = async () => {
    if (!draft) return
    if (hasErrors || !effectiveDraft) {
      setTestResult({
        ok: false,
        level: 'error',
        summary: '请先修复配置错误',
        checks: [{ id: 'config', label: '配置完整性', status: 'failed', message: issues.find((issue) => issue.level === 'error')?.message || '配置无效' }]
      })
      return
    }
    setTesting(true)
    try {
      const result = await testProvider(effectiveDraft, keyValue)
      setTestResult(result)
      toast(result.summary, result.level === 'success' ? 'success' : result.level === 'warning' ? 'warning' : 'error')
    } finally {
      setTesting(false)
    }
  }

  const copyPreview = async () => {
    if (!preview?.value) return
    const text = JSON.stringify(preview.value, null, 2)
    try {
      const write = window.mulby?.clipboard?.writeText
        ? window.mulby.clipboard.writeText(text)
        : navigator.clipboard.writeText(text)
      await write
      toast('已复制脱敏请求预览', 'success')
    } catch {
      toast('复制失败', 'error')
    }
  }

  const exportProviders = () => {
    const blob = new Blob([useProviders.getState().exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'ai-canvas-providers.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const importProviders = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const ok = useProviders.getState().importJson(await file.text())
    toast(ok ? 'Provider 已导入（密钥需重新填写）' : '导入失败：文件结构或 JSON 无效', ok ? 'success' : 'error')
    event.target.value = ''
  }

  const isActive = draft ? (draft.kind === 'video' ? activeVideoId : activeAudioId) === draft.id : false
  const tab = (value: SettingsSection, label: string, icon: ReactNode) => (
    <button
      type="button"
      onClick={() => setSection(value)}
      className={`h-8 px-3 inline-flex items-center gap-1.5 rounded-md text-xs ${section === value ? 'bg-indigo-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
    >
      {icon}{label}
      {value === 'diagnostics' && issues.length > 0 && <span className={`ml-0.5 rounded-full px-1 text-[9px] ${hasErrors ? 'bg-red-500 text-white' : 'bg-amber-400 text-neutral-900'}`}>{issues.length}</span>}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[80] bg-black/55 flex items-center justify-center p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <div className="ace-dialog ace-anim-scale flex overflow-hidden text-neutral-800 dark:text-neutral-200" style={{ width: 'min(1080px, 96vw)', height: 'min(860px, 92vh)' }}>
        <aside className="w-64 shrink-0 border-r p-2.5 flex flex-col gap-1 min-h-0" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="px-1 py-1.5">
            <div className="text-sm font-semibold">Provider 设置</div>
            <div className="text-[10px] opacity-50 mt-0.5">视频生成与文件型 TTS 服务</div>
          </div>
          <div className="flex-1 overflow-auto ace-scroll space-y-1">
            {!providers.length && <div className="text-[11px] opacity-50 px-1 py-3">尚无 Provider，请从下方模板新建。</div>}
            {providers.map((provider) => {
              const active = provider.id === (provider.kind === 'video' ? activeVideoId : activeAudioId)
              const Icon = provider.kind === 'video' ? Video : Mic2
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setSelectedId(provider.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs ${selectedId === provider.id ? 'bg-indigo-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
                >
                  <div className="flex items-center gap-1.5 min-w-0"><Icon size={13} className="shrink-0" /><span className="truncate font-medium">{provider.label}</span>{active && <span className="ml-auto text-[9px] rounded bg-white/20 px-1">默认</span>}</div>
                  <div className="text-[10px] opacity-60 mt-0.5 truncate">{provider.kind === 'video' ? '视频' : '音频'} · {provider.model || provider.ttsModel || provider.type}</div>
                </button>
              )
            })}
          </div>

          <div className="border-t pt-2 space-y-1.5" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => addPreset(presetCustomVideo)} className="text-[11px] py-1.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center gap-1"><Plus size={11} />自定义视频</button>
              <button type="button" onClick={() => addPreset(presetOpenAiTts)} className="text-[11px] py-1.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center gap-1"><Plus size={11} />TTS</button>
            </div>
            <select
              className="ace-input text-[11px] w-full"
              value=""
              onChange={(event) => {
                const template = PROVIDER_TEMPLATES.find((item) => item.id === event.target.value)
                if (template) addPreset(template.make)
              }}
            >
              <option value="">＋ 从服务模板新建…</option>
              {PROVIDER_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={exportProviders} className="text-[11px] py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10">导出配置</button>
              <label className="text-[11px] py-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-center cursor-pointer">导入配置<input type="file" accept="application/json,.json" className="hidden" onChange={importProviders} /></label>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col">
          <header className="px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{draft?.label || '选择或新建 Provider'}</div>
                {draft && <div className="text-[10px] opacity-50 mt-0.5">{draft.type === 'openai-tts' ? 'OpenAI 兼容语音合成' : draft.bodyTemplate != null ? '声明式视频请求模板' : '字段映射视频接口'}</div>}
              </div>
              <button type="button" onClick={close} className="opacity-60 hover:opacity-100"><X size={18} /></button>
            </div>
            {draft && (
              <div className="flex items-center gap-1 mt-3">
                {tab('basic', '基础配置', <Settings2 size={13} />)}
                {tab('advanced', '高级配置', <Wrench size={13} />)}
                {tab('diagnostics', '检查与预览', <Activity size={13} />)}
              </div>
            )}
          </header>

          {!draft ? (
            <div className="flex-1 grid place-items-center p-8 text-center">
              <div className="max-w-md">
                <ShieldCheck size={30} className="mx-auto text-indigo-500" />
                <div className="mt-3 text-sm font-medium">从左侧选择模板开始</div>
                <p className="mt-1 text-xs opacity-55 leading-relaxed">常用服务优先使用内置模板；只有接口格式不在模板中时，才需要进入高级配置填写任务字段和 JSON 请求体。</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto ace-scroll p-4">
                {section === 'basic' && (
                  <div className="max-w-3xl space-y-5">
                    <section>
                      <div className="text-xs font-semibold mb-2">连接信息</div>
                      <div className="grid grid-cols-2 gap-3">
                        <Row label="名称"><input className="ace-input" value={draft.label} onChange={(event) => updateDraft({ label: event.target.value })} /></Row>
                        <Row label={draft.type === 'custom-video' && draft.bodyTemplate != null ? '提交地址' : 'Base URL'}>
                          <input className="ace-input" value={draft.type === 'custom-video' && draft.bodyTemplate != null ? draft.submitUrl || '' : draft.baseURL} onChange={(event) => updateDraft(draft.type === 'custom-video' && draft.bodyTemplate != null ? { submitUrl: event.target.value } : { baseURL: event.target.value })} placeholder="https://api.example.com/v1" />
                        </Row>
                      </div>
                      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2 items-end">
                        <Row label="API Key（通过系统安全存储加密）">
                          <div className="relative"><input className="ace-input w-full pr-9" type={showKey ? 'text' : 'password'} value={keyValue} onChange={(event) => { setKeyValue(event.target.value); setTestResult(null) }} placeholder="sk-…" /><button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center opacity-55 hover:opacity-100">{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div>
                        </Row>
                        <span className="mb-1 text-[10px] opacity-45 whitespace-nowrap">导出配置时不会包含密钥</span>
                      </div>
                    </section>

                    {draft.type === 'openai-tts' ? (
                      <section>
                        <div className="text-xs font-semibold mb-2">语音模型</div>
                        <div className="grid grid-cols-3 gap-3">
                          <Row label="模型"><input className="ace-input" value={draft.ttsModel || ''} onChange={(event) => updateDraft({ ttsModel: event.target.value })} /></Row>
                          <Row label="默认音色"><input className="ace-input" value={draft.ttsVoice || ''} onChange={(event) => updateDraft({ ttsVoice: event.target.value })} /></Row>
                          <Row label="输出格式"><input className="ace-input" value={draft.ttsFormat || ''} onChange={(event) => updateDraft({ ttsFormat: event.target.value })} /></Row>
                        </div>
                      </section>
                    ) : capabilities && (
                      <>
                        <section>
                          <div className="text-xs font-semibold mb-2">模型</div>
                          <div className="grid grid-cols-2 gap-3">
                            <Row label="默认模型"><input className="ace-input" value={draft.model || ''} onChange={(event) => updateDraft({ model: event.target.value })} placeholder="model-id" /></Row>
                            <Row label="可选模型（每行一个）"><textarea className="ace-input resize-none ace-noscroll" rows={3} value={(draft.models || []).join('\n')} onChange={(event) => updateDraft({ models: csvStrings(event.target.value) })} /></Row>
                          </div>
                        </section>

                        <section>
                          <div className="text-xs font-semibold mb-2">生成能力</div>
                          <div className="grid grid-cols-2 gap-2">
                            {([
                              ['textToVideo', '文生视频', '允许没有参考图的生成'],
                              ['imageToVideo', '图生视频', '允许使用首帧或参考图'],
                              ['lastFrame', '尾帧控制', '允许第二张图片作为尾帧'],
                              ['nativeAudio', '原生音频', '视频模型可同时生成声音']
                            ] as const).map(([key, label, description]) => (
                              <label key={key} className="flex items-start gap-2 rounded-lg border p-2.5 cursor-pointer" style={{ borderColor: 'var(--ace-border)' }}>
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={!!capabilities[key]}
                                  disabled={key === 'lastFrame' && !capabilities.imageToVideo}
                                  onChange={(event) => updateCapabilities(key === 'imageToVideo' && !event.target.checked
                                    ? { imageToVideo: false, lastFrame: false }
                                    : { [key]: event.target.checked })}
                                />
                                <span><span className="block text-xs font-medium">{label}</span><span className="block text-[10px] opacity-50 mt-0.5">{description}</span></span>
                              </label>
                            ))}
                          </div>
                          <div className="grid grid-cols-3 gap-3 mt-3">
                            <Row label="支持比例" hint="逗号分隔；留空时显示通用比例"><input className="ace-input" value={(capabilities.aspects || []).join(', ')} onChange={(event) => updateCapabilities({ aspects: csvStrings(event.target.value) })} placeholder="16:9, 9:16, 1:1" /></Row>
                            <Row label="支持时长（秒）" hint="逗号分隔；节点滑块会自动吸附"><input className="ace-input" value={(capabilities.durations || []).join(', ')} onChange={(event) => updateCapabilities({ durations: csvNumbers(event.target.value) })} placeholder="5, 10" /></Row>
                            <Row label="支持分辨率" hint="填写后视频节点才显示分辨率选项"><input className="ace-input" value={(capabilities.resolutions || []).join(', ')} onChange={(event) => updateCapabilities({ resolutions: csvStrings(event.target.value) })} placeholder="720p, 1080p" /></Row>
                          </div>
                        </section>
                      </>
                    )}

                    <section className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3 text-[11px] leading-relaxed">
                      <div className="font-medium mb-1">安全测试说明</div>
                      <p className="opacity-60">默认测试不会提交真实生成任务，因此不会产生生成费用。TTS 会使用标准 models 接口验证鉴权；自定义视频服务如需验证 API Key，请在高级配置填写无计费的健康检查地址。</p>
                    </section>
                  </div>
                )}

                {section === 'advanced' && (
                  <div className="max-w-4xl space-y-4">
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.07] p-3 text-[11px] text-amber-700 dark:text-amber-300">高级配置会直接影响实际 HTTP 请求。使用内置模板时通常不需要修改；保存前请在“检查与预览”确认渲染结果。</div>
                    <Row label="无计费健康检查 URL（可选）" hint="GET 请求；用于验证网络和 API Key，不应触发生成任务"><input className="ace-input" value={draft.healthCheckUrl || ''} onChange={(event) => updateDraft({ healthCheckUrl: event.target.value || undefined })} placeholder="https://api.example.com/v1/models" /></Row>

                    {draft.type === 'openai-tts' && (
                      <div className="text-xs opacity-55">TTS 的请求结构由插件固定为 OpenAI 兼容格式；如需自定义请求体，应新增视频/音频 Provider 类型，而不是修改此处。</div>
                    )}

                    {draft.type === 'custom-video' && draft.bodyTemplate != null && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <Row label="提交 URL"><input className="ace-input" value={draft.submitUrl || ''} onChange={(event) => updateDraft({ submitUrl: event.target.value })} /></Row>
                          <Row label="轮询 URL（含 {taskId}）"><input className="ace-input" value={draft.pollUrl || ''} onChange={(event) => updateDraft({ pollUrl: event.target.value })} /></Row>
                          <Row label="任务 ID 路径"><input className="ace-input" value={draft.taskIdPath || ''} onChange={(event) => updateDraft({ taskIdPath: event.target.value })} /></Row>
                          <Row label="状态字段"><input className="ace-input" value={draft.statusField || ''} onChange={(event) => updateDraft({ statusField: event.target.value })} /></Row>
                          <Row label="结果 URL 路径"><input className="ace-input" value={draft.videoUrlPath || ''} onChange={(event) => updateDraft({ videoUrlPath: event.target.value })} /></Row>
                          <Row label="轮询间隔 ms"><input className="ace-input" type="number" value={draft.pollIntervalMs || 3000} onChange={(event) => updateDraft({ pollIntervalMs: Number(event.target.value) || 3000 })} /></Row>
                        </div>
                        <Row label="请求体模板" hint="支持 {prompt}、{model}、{imageUrl}、{lastImageUrl}、{duration}、{aspect} 和条件块 {?x}…{/x}"><textarea className="ace-input resize-y font-mono text-[10px] leading-relaxed" rows={8} value={draft.bodyTemplate || ''} onChange={(event) => updateDraft({ bodyTemplate: event.target.value })} /></Row>
                        <div className="grid grid-cols-3 gap-3">
                          <Row label="图床上传 URL"><input className="ace-input" value={draft.uploadUrl || ''} onChange={(event) => updateDraft({ uploadUrl: event.target.value })} /></Row>
                          <Row label="上传字段"><input className="ace-input" value={draft.uploadField || ''} onChange={(event) => updateDraft({ uploadField: event.target.value })} /></Row>
                          <Row label="返回 URL 路径"><input className="ace-input" value={draft.uploadUrlPath || ''} onChange={(event) => updateDraft({ uploadUrlPath: event.target.value })} /></Row>
                        </div>
                      </>
                    )}

                    {draft.type === 'custom-video' && draft.bodyTemplate == null && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <Row label="Base URL"><input className="ace-input" value={draft.baseURL} onChange={(event) => updateDraft({ baseURL: event.target.value })} /></Row>
                          <Row label="提交路径"><input className="ace-input" value={draft.submitPath || ''} onChange={(event) => updateDraft({ submitPath: event.target.value })} /></Row>
                          <Row label="提示词字段"><input className="ace-input" value={draft.promptField || ''} onChange={(event) => updateDraft({ promptField: event.target.value })} /></Row>
                          <Row label="任务 ID 路径"><input className="ace-input" value={draft.idPath || ''} onChange={(event) => updateDraft({ idPath: event.target.value })} /></Row>
                          <Row label="轮询路径（含 {id}）"><input className="ace-input" value={draft.statusPath || ''} onChange={(event) => updateDraft({ statusPath: event.target.value })} /></Row>
                          <Row label="状态字段"><input className="ace-input" value={draft.statusField || ''} onChange={(event) => updateDraft({ statusField: event.target.value })} /></Row>
                          <Row label="结果 URL 路径"><input className="ace-input" value={draft.resultPath || ''} onChange={(event) => updateDraft({ resultPath: event.target.value })} /></Row>
                          <Row label="轮询间隔 ms"><input className="ace-input" type="number" value={draft.pollIntervalMs || 2000} onChange={(event) => updateDraft({ pollIntervalMs: Number(event.target.value) || 2000 })} /></Row>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <Row label="图片模式"><select className="ace-input" value={draft.imageMode || 'none'} onChange={(event) => updateDraft({ imageMode: event.target.value as ProviderConfig['imageMode'] })}><option value="none">不传图</option><option value="dataurl">DataURL</option><option value="url">公网 URL（先上传）</option></select></Row>
                          <Row label="图片字段"><input className="ace-input" value={draft.imageField || ''} onChange={(event) => updateDraft({ imageField: event.target.value })} /></Row>
                          <Row label="超时 ms"><input className="ace-input" type="number" value={draft.timeoutMs || 600000} onChange={(event) => updateDraft({ timeoutMs: Number(event.target.value) || 600000 })} /></Row>
                        </div>
                        {draft.imageMode === 'url' && <div className="grid grid-cols-3 gap-3"><Row label="图床上传 URL"><input className="ace-input" value={draft.uploadUrl || ''} onChange={(event) => updateDraft({ uploadUrl: event.target.value })} /></Row><Row label="上传字段"><input className="ace-input" value={draft.uploadField || ''} onChange={(event) => updateDraft({ uploadField: event.target.value })} /></Row><Row label="返回 URL 路径"><input className="ace-input" value={draft.uploadUrlPath || ''} onChange={(event) => updateDraft({ uploadUrlPath: event.target.value })} /></Row></div>}
                        <Row label="额外请求体（JSON）"><textarea className="ace-input resize-y font-mono text-[10px]" rows={5} value={draft.extraBody || ''} onChange={(event) => updateDraft({ extraBody: event.target.value })} /></Row>
                      </>
                    )}

                    {draft.type === 'custom-video' && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <Row label="成功状态（逗号分隔）"><input className="ace-input" value={draft.doneValues || ''} onChange={(event) => updateDraft({ doneValues: event.target.value })} /></Row>
                          <Row label="失败状态（逗号分隔）"><input className="ace-input" value={draft.failValues || ''} onChange={(event) => updateDraft({ failValues: event.target.value })} /></Row>
                        </div>
                      </>
                    )}
                    <Row label="额外请求头（JSON，不要在此填写 API Key）"><textarea className="ace-input resize-y font-mono text-[10px]" rows={4} value={headersText} onChange={(event) => { setHeadersText(event.target.value); setTestResult(null) }} placeholder={'{\n  "X-Async": "enable"\n}'} /></Row>
                  </div>
                )}

                {section === 'diagnostics' && (
                  <div className="max-w-4xl space-y-4">
                    <section><div className="text-xs font-semibold mb-2">配置检查</div><IssueList issues={issues} /></section>
                    <section>
                      <div className="flex items-center justify-between mb-2"><div className="text-xs font-semibold">脱敏请求预览</div><button type="button" onClick={() => void copyPreview()} disabled={!preview?.value} className="inline-flex items-center gap-1 text-[11px] text-indigo-500 disabled:opacity-30"><Copy size={12} />复制</button></div>
                      <pre className="rounded-lg border bg-neutral-950 text-neutral-200 p-3 text-[10px] leading-relaxed overflow-auto max-h-72 ace-scroll" style={{ borderColor: 'var(--ace-border)' }}>{preview?.value ? JSON.stringify(preview.value, null, 2) : preview?.error || '暂无预览'}</pre>
                    </section>
                    <section>
                      <div className="flex items-center justify-between mb-2"><div><div className="text-xs font-semibold">无计费连接测试</div><div className="text-[10px] opacity-50 mt-0.5">不会提交真实生成任务</div></div><button type="button" onClick={() => void runTest()} disabled={testing} className="px-3 py-1.5 rounded-md bg-indigo-500 text-white text-xs disabled:opacity-50">{testing ? '测试中…' : '开始测试'}</button></div>
                      {testResult ? <TestResult result={testResult} /> : <div className="rounded-lg border border-dashed p-4 text-center text-xs opacity-45">尚未执行连接测试</div>}
                    </section>
                  </div>
                )}
              </div>

              <footer className="border-t px-4 py-3 flex items-center gap-2 shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
                <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={isActive} onChange={(event) => setActive(draft.kind, event.target.checked ? draft.id : null)} />设为当前{draft.kind === 'video' ? '视频' : '音频'}默认 Provider</label>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirmDialog({ title: '删除 Provider', message: `将删除「${draft.label || '该 Provider'}」及其已保存的 API Key，不可恢复。确定？`, confirmLabel: '删除', cancelLabel: '取消', danger: true })
                    if (!ok) return
                    remove(draft.id)
                    setSelectedId(null)
                  }}
                  className="px-3 py-1.5 rounded-md text-red-500 hover:bg-red-500/10 text-xs flex items-center gap-1"
                ><Trash2 size={13} />删除</button>
                <button type="button" onClick={close} className="px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 text-xs">关闭</button>
                <button type="button" onClick={() => void save()} className="px-4 py-1.5 rounded-md bg-indigo-500 text-white text-xs hover:bg-indigo-600">保存</button>
              </footer>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
