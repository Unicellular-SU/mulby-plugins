import { useEffect, useState, type ReactNode, type ChangeEvent } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
import type { ProviderConfig } from '../services/providers/types'
import { presetOpenAiTts, presetCustomVideo, PROVIDER_TEMPLATES } from '../services/providers/presets'
import { testProvider } from '../services/providers/engine'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px]">
      <span className="opacity-60">{label}</span>
      {children}
    </label>
  )
}

export function ProviderSettings() {
  const providers = useProviders((s) => s.providers)
  const activeVideoId = useProviders((s) => s.activeVideoId)
  const activeAudioId = useProviders((s) => s.activeAudioId)
  const upsert = useProviders((s) => s.upsert)
  const remove = useProviders((s) => s.remove)
  const setActive = useProviders((s) => s.setActive)
  const getKey = useProviders((s) => s.getKey)
  const setKey = useProviders((s) => s.setKey)
  const close = () => useUi.getState().setShowProviderSettings(false)

  const [sel, setSel] = useState<string | null>(providers[0]?.id ?? null)
  const [draft, setDraft] = useState<ProviderConfig | null>(null)
  const [keyVal, setKeyVal] = useState('')
  const [headersStr, setHeadersStr] = useState('')
  const [testing, setTesting] = useState(false)

  const doExport = () => {
    const json = useProviders.getState().exportJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ai-canvas-providers.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const doImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    const ok = useProviders.getState().importJson(text)
    toast(ok ? 'Provider 已导入（密钥需重新填写）' : '导入失败：JSON 无效', ok ? 'success' : 'error')
    e.target.value = ''
  }
  const doTest = async (d: ProviderConfig) => {
    setTesting(true)
    try {
      const r = await testProvider(d, keyVal)
      toast(r.ok ? `连通正常（HTTP ${r.status}）` : `连通失败：${r.error || 'HTTP ' + r.status}`, r.ok ? 'success' : 'error')
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    const p = providers.find((x) => x.id === sel) || null
    setDraft(p ? { ...p } : null)
    if (p) getKey(p.id).then(setKeyVal)
    else setKeyVal('')
    setHeadersStr(p?.headers ? JSON.stringify(p.headers) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, providers.length])

  const addPreset = (mk: () => ProviderConfig) => {
    const p = mk()
    upsert(p)
    setSel(p.id)
  }
  const upd = (patch: Partial<ProviderConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const save = () => {
    if (!draft) return
    upsert(draft)
    void setKey(draft.id, keyVal)
    useUi.getState().setSaving(false)
    toast('Provider 已保存', 'success')
  }

  const isActive = draft ? (draft.kind === 'video' ? activeVideoId : activeAudioId) === draft.id : false

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="ace-dialog ace-anim-scale w-[780px] max-h-[82vh] flex overflow-hidden text-neutral-800 dark:text-neutral-200">
        <div className="w-56 border-r p-2 flex flex-col gap-1 overflow-auto ace-scroll" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="text-xs font-semibold px-1 py-1">Provider 设置</div>
          {providers.length === 0 && <div className="text-[11px] opacity-50 px-1 py-2">尚无 Provider，下方新建。</div>}
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => setSel(p.id)}
              className={`text-left px-2 py-1.5 rounded-md text-xs ${sel === p.id ? 'bg-indigo-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
            >
              <div className="truncate">{p.label}</div>
              <div className="text-[10px] opacity-60">{p.kind === 'video' ? '视频' : '音频'} · {p.type}</div>
            </button>
          ))}
          <div className="flex gap-1 mt-1">
            <button onClick={() => addPreset(presetCustomVideo)} className="flex-1 text-[11px] py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center gap-0.5">
              <Plus size={11} />视频
            </button>
            <button onClick={() => addPreset(presetOpenAiTts)} className="flex-1 text-[11px] py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center gap-0.5">
              <Plus size={11} />TTS
            </button>
          </div>
          <select
            className="ace-input text-[11px] mt-1"
            value=""
            onChange={(e) => {
              const t = PROVIDER_TEMPLATES.find((x) => x.id === e.target.value)
              if (t) {
                const p = t.make()
                upsert(p)
                setSel(p.id)
              }
            }}
          >
            <option value="">＋ 从模板新建…</option>
            {PROVIDER_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="flex gap-1 mt-1">
            <button onClick={doExport} className="flex-1 text-[11px] py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20">
              导出
            </button>
            <label className="flex-1 text-[11px] py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 text-center cursor-pointer">
              导入
              <input type="file" accept="application/json,.json" className="hidden" onChange={doImport} />
            </label>
          </div>
        </div>

        <div className="flex-1 p-3 overflow-auto ace-scroll flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{draft ? draft.label : '选择或新建 Provider'}</span>
            <button onClick={close} className="opacity-70 hover:opacity-100"><X size={16} /></button>
          </div>
          {!draft && (
            <div className="text-xs opacity-50 leading-relaxed">
              左侧新建一个 Provider 开始配置。
              <br />· 视频：通用“异步 submit + poll”，按 JSON 路径映射任务 id / 状态 / 结果 URL（兼容 fal、Replicate 风格）。
              <br />· 音频：OpenAI 兼容 <code>/audio/speech</code> 配音。
            </div>
          )}
          {draft && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Row label="名称"><input className="ace-input" value={draft.label} onChange={(e) => upd({ label: e.target.value })} /></Row>
                <Row label="Base URL"><input className="ace-input" value={draft.baseURL} onChange={(e) => upd({ baseURL: e.target.value })} /></Row>
              </div>
              <Row label="API Key（系统加密保存）">
                <input className="ace-input" type="password" value={keyVal} onChange={(e) => setKeyVal(e.target.value)} placeholder="sk-..." />
              </Row>

              {draft.type === 'openai-tts' && (
                <div className="grid grid-cols-3 gap-2">
                  <Row label="模型"><input className="ace-input" value={draft.ttsModel || ''} onChange={(e) => upd({ ttsModel: e.target.value })} /></Row>
                  <Row label="音色"><input className="ace-input" value={draft.ttsVoice || ''} onChange={(e) => upd({ ttsVoice: e.target.value })} /></Row>
                  <Row label="格式"><input className="ace-input" value={draft.ttsFormat || ''} onChange={(e) => upd({ ttsFormat: e.target.value })} /></Row>
                </div>
              )}

              {draft.type === 'custom-video' && draft.bodyTemplate != null && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Row label={draft.models && draft.models.length ? '默认模型（节点可单独选）' : '模型 model'}>
                      {draft.models && draft.models.length ? (
                        <select className="ace-input" value={draft.model || draft.models[0]} onChange={(e) => upd({ model: e.target.value })}>
                          {draft.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="ace-input" value={draft.model || ''} onChange={(e) => upd({ model: e.target.value })} />
                      )}
                    </Row>
                    <Row label="提交 URL submitUrl"><input className="ace-input" value={draft.submitUrl || ''} onChange={(e) => upd({ submitUrl: e.target.value })} /></Row>
                    <Row label="轮询 URL pollUrl（含 {taskId}）"><input className="ace-input" value={draft.pollUrl || ''} onChange={(e) => upd({ pollUrl: e.target.value })} /></Row>
                    <Row label="任务 id 路径 taskIdPath"><input className="ace-input" value={draft.taskIdPath || ''} onChange={(e) => upd({ taskIdPath: e.target.value })} /></Row>
                    <Row label="状态字段 statusField"><input className="ace-input" value={draft.statusField || ''} onChange={(e) => upd({ statusField: e.target.value })} /></Row>
                    <Row label="结果 URL 路径 videoUrlPath"><input className="ace-input" value={draft.videoUrlPath || ''} onChange={(e) => upd({ videoUrlPath: e.target.value })} /></Row>
                  </div>
                  <Row label="模型清单 models（每行一个；多模型时节点可下拉选择，留空=单一模型）">
                    <textarea
                      className="ace-input resize-none ace-noscroll text-[11px]"
                      rows={2}
                      value={(draft.models || []).join('\n')}
                      onChange={(e) => upd({ models: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                      placeholder={'veo3.1-fast\nsora-2\nkling-v3'}
                    />
                  </Row>
                  <Row label="请求体模板 bodyTemplate（{prompt} {imageUrl} {model}；{?imageUrl}…{/imageUrl} 表示有图才出现）">
                    <textarea className="ace-input resize-none font-mono text-[10px]" rows={4} value={draft.bodyTemplate || ''} onChange={(e) => upd({ bodyTemplate: e.target.value })} />
                  </Row>
                  <div className="grid grid-cols-3 gap-2">
                    <Row label="图床上传 URL（图生视频需公网图）"><input className="ace-input" value={draft.uploadUrl || ''} onChange={(e) => upd({ uploadUrl: e.target.value })} /></Row>
                    <Row label="返回 URL 路径"><input className="ace-input" value={draft.uploadUrlPath || ''} onChange={(e) => upd({ uploadUrlPath: e.target.value })} /></Row>
                    <Row label="轮询间隔 ms"><input className="ace-input" type="number" value={draft.pollIntervalMs || 3000} onChange={(e) => upd({ pollIntervalMs: Number(e.target.value) || 3000 })} /></Row>
                  </div>
                  <Row label="额外请求头 headers（JSON，可选）">
                    <input
                      className="ace-input"
                      value={headersStr}
                      onChange={(e) => {
                        setHeadersStr(e.target.value)
                        try {
                          upd({ headers: e.target.value.trim() ? JSON.parse(e.target.value) : undefined })
                        } catch {
                          /* 待输入完整 JSON */
                        }
                      }}
                      placeholder='{"X-DashScope-Async":"enable"}'
                    />
                  </Row>
                </>
              )}

              {draft.type === 'custom-video' && draft.bodyTemplate == null && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Row label="提交路径 submitPath"><input className="ace-input" value={draft.submitPath || ''} onChange={(e) => upd({ submitPath: e.target.value })} /></Row>
                    <Row label="提示词字段 promptField"><input className="ace-input" value={draft.promptField || ''} onChange={(e) => upd({ promptField: e.target.value })} /></Row>
                    <Row label="任务 id 路径 idPath"><input className="ace-input" value={draft.idPath || ''} onChange={(e) => upd({ idPath: e.target.value })} /></Row>
                    <Row label="状态轮询 statusPath（含 {id}）"><input className="ace-input" value={draft.statusPath || ''} onChange={(e) => upd({ statusPath: e.target.value })} /></Row>
                    <Row label="状态字段 statusField"><input className="ace-input" value={draft.statusField || ''} onChange={(e) => upd({ statusField: e.target.value })} /></Row>
                    <Row label="结果 URL 路径 resultPath"><input className="ace-input" value={draft.resultPath || ''} onChange={(e) => upd({ resultPath: e.target.value })} /></Row>
                    <Row label="成功状态 doneValues(csv)"><input className="ace-input" value={draft.doneValues || ''} onChange={(e) => upd({ doneValues: e.target.value })} /></Row>
                    <Row label="失败状态 failValues(csv)"><input className="ace-input" value={draft.failValues || ''} onChange={(e) => upd({ failValues: e.target.value })} /></Row>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Row label="图片模式">
                      <select className="ace-input" value={draft.imageMode || 'none'} onChange={(e) => upd({ imageMode: e.target.value as ProviderConfig['imageMode'] })}>
                        <option value="none">不传图</option>
                        <option value="dataurl">DataURL</option>
                        <option value="url">公网 URL(上传)</option>
                      </select>
                    </Row>
                    <Row label="图片字段 imageField"><input className="ace-input" value={draft.imageField || ''} onChange={(e) => upd({ imageField: e.target.value })} /></Row>
                    <Row label="轮询间隔 ms"><input className="ace-input" type="number" value={draft.pollIntervalMs || 2000} onChange={(e) => upd({ pollIntervalMs: Number(e.target.value) || 2000 })} /></Row>
                  </div>
                  {draft.imageMode === 'url' && (
                    <div className="grid grid-cols-3 gap-2">
                      <Row label="图床上传 URL"><input className="ace-input" value={draft.uploadUrl || ''} onChange={(e) => upd({ uploadUrl: e.target.value })} /></Row>
                      <Row label="上传字段"><input className="ace-input" value={draft.uploadField || ''} onChange={(e) => upd({ uploadField: e.target.value })} /></Row>
                      <Row label="返回 URL 路径"><input className="ace-input" value={draft.uploadUrlPath || ''} onChange={(e) => upd({ uploadUrlPath: e.target.value })} /></Row>
                    </div>
                  )}
                  <Row label="额外请求体（JSON，可选）">
                    <textarea className="ace-input resize-none" rows={2} value={draft.extraBody || ''} onChange={(e) => upd({ extraBody: e.target.value })} placeholder='{"model":"...","duration":5}' />
                  </Row>
                </>
              )}

              <label className="flex items-center gap-2 text-[11px] mt-1">
                <input type="checkbox" checked={isActive} onChange={(e) => setActive(draft.kind, e.target.checked ? draft.id : null)} />
                设为当前{draft.kind === 'video' ? '视频' : '音频'}默认 Provider
              </label>

              <div className="flex gap-2 mt-2 items-center">
                <button onClick={save} className="px-4 py-1.5 rounded-md bg-indigo-500 text-white text-sm hover:bg-indigo-600">保存</button>
                <button
                  onClick={() => {
                    remove(draft.id)
                    setSel(null)
                  }}
                  className="px-3 py-1.5 rounded-md text-red-500 hover:bg-red-500/10 text-sm flex items-center gap-1"
                >
                  <Trash2 size={13} />删除
                </button>
                <button onClick={() => void doTest(draft)} disabled={testing} className="px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-sm disabled:opacity-50">
                  {testing ? '测试中…' : '测试连通'}
                </button>
                <div className="flex-1" />
                <button onClick={close} className="px-4 py-1.5 rounded-md bg-black/5 dark:bg-white/10 text-sm">关闭</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
