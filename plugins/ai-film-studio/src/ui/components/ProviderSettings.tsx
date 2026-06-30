import { useEffect, useState } from 'react'
import { Plus, Trash2, Check, KeyRound, Plug, Loader2, AlertTriangle } from 'lucide-react'
import { useProviderStore } from '../store/providerStore'
import type { MediaProviderConfig, VideoProviderKind, MediaCapability } from '../services/providers'
import { PROVIDER_PRESETS } from '../services/providers/presets'
import { testVideoProvider } from '../services/providers/test'
import { getKey } from '../services/keys'
import Select from './ui/Select'
import Checkbox from './ui/Checkbox'
import { Field, Input, Textarea } from './ui/Field'
import Button from './ui/Button'
import IconButton from './ui/IconButton'
import TagsInput from './ui/TagsInput'

type Draft = Partial<MediaProviderConfig> & { kind: VideoProviderKind }

const EMPTY: Draft = { kind: 'fal', label: '', capabilities: ['video'], mode: 'async-poll', model: 'fal-ai/kling-video/v1/standard/image-to-video' }

const CAPS: { value: MediaCapability; label: string }[] = [
  { value: 'video', label: '视频' },
  { value: 'music', label: '配乐' },
  { value: 'tts', label: '语音' },
  { value: 'nativeAudio', label: '原生音频' },
  { value: 'lipsync', label: '口型同步' },
]
const CAP_LABEL: Record<MediaCapability, string> = {
  video: '视频',
  music: '配乐',
  tts: '语音',
  nativeAudio: '原生音频',
  lipsync: '口型同步',
}

// 模式由能力推导：仅语音 → 同步二进制；其余（视频/音乐）→ 异步轮询
function deriveMode(caps: MediaCapability[]): MediaProviderConfig['mode'] {
  return caps.length === 1 && caps[0] === 'tts' ? 'sync-binary' : 'async-poll'
}

export default function ProviderSettings() {
  const providers = useProviderStore((s) => s.providers)
  const defaults = useProviderStore((s) => s.defaults)
  const keyPresence = useProviderStore((s) => s.keyPresence)
  const load = useProviderStore((s) => s.load)
  const addProvider = useProviderStore((s) => s.addProvider)
  const updateProvider = useProviderStore((s) => s.updateProvider)
  const removeProvider = useProviderStore((s) => s.removeProvider)
  const setDefault = useProviderStore((s) => s.setDefault)
  const setProviderKey = useProviderStore((s) => s.setProviderKey)

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [tests, setTests] = useState<Record<string, { state: 'testing' | 'ok' | 'fail'; msg: string }>>({})

  useEffect(() => {
    load()
  }, [load])

  const onTest = async (p: MediaProviderConfig) => {
    setTests((t) => ({ ...t, [p.id]: { state: 'testing', msg: '测试中…' } }))
    const key = editingId === p.id && keyInput.trim() ? keyInput.trim() : await getKey(p.id)
    const r = await testVideoProvider(p, key)
    setTests((t) => ({ ...t, [p.id]: { state: r.ok ? 'ok' : 'fail', msg: r.message } }))
  }

  const resetForm = () => {
    setDraft(EMPTY)
    setEditingId(null)
    setKeyInput('')
  }
  const onEdit = (p: MediaProviderConfig) => {
    setDraft({ ...p })
    setEditingId(p.id)
    setKeyInput('')
  }
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  const draftCaps = draft.capabilities?.length ? draft.capabilities : ['video']
  const draftMode = deriveMode(draftCaps as MediaCapability[])
  const toggleCap = (cap: MediaCapability) => {
    const has = draftCaps.includes(cap)
    const next = has ? draftCaps.filter((c) => c !== cap) : [...draftCaps, cap]
    set({ capabilities: (next.length ? next : ['video']) as MediaCapability[] })
  }
  const applyPreset = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((x) => x.id === presetId)
    if (preset) setDraft({ ...EMPTY, ...preset.config } as Draft)
  }

  const onSave = async () => {
    if (!draft.label?.trim()) {
      window.mulby?.notification?.show('请填写供应商名称', 'warning')
      return
    }
    const payload = { ...draft, capabilities: draftCaps as MediaCapability[], mode: draftMode }
    let id = editingId
    if (editingId) await updateProvider(editingId, payload)
    else id = await addProvider(payload)
    if (id && keyInput.trim()) await setProviderKey(id, keyInput.trim())
    resetForm()
  }

  // 该供应商是否是其全部能力的默认
  const isDefaultForAll = (p: MediaProviderConfig) =>
    (p.capabilities || ['video']).every((c) => defaults[c] === p.id)
  const makeDefault = (p: MediaProviderConfig) => {
    for (const c of p.capabilities || ['video']) setDefault(c, p.id)
  }

  return (
    <div className="afs-settings-pane">
      <div className="afs-modal__body">
          <p className="afs-pvs-hint">
            Mulby 不内置视频 / 配乐 / 语音模型，需自管供应商。一个供应商可声明多种能力；节点按能力选用，可在节点上覆盖。Key 经系统密钥库加密存储，仅本机可解。
          </p>

          {providers.length > 0 && (
            <div className="afs-pvs-list">
              {providers.map((p) => {
                const caps = p.capabilities || ['video']
                const isDef = isDefaultForAll(p)
                const t = tests[p.id]
                return (
                  <div key={p.id} className={`afs-pvs-card${isDef ? ' is-active' : ''}`}>
                    <button
                      className="afs-pvs-radio"
                      role="radio"
                      aria-checked={isDef}
                      aria-label="设为这些能力的默认"
                      title="设为这些能力的默认"
                      onClick={() => makeDefault(p)}
                    >
                      {isDef ? <Check size={13} /> : <span className="afs-pvs-radio__dot" />}
                    </button>
                    <div
                      className="afs-pvs-card__main"
                      role="button"
                      tabIndex={0}
                      onClick={() => onEdit(p)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onEdit(p)
                        }
                      }}
                    >
                      <div className="afs-pvs-card__label">
                        {p.label}
                        {caps.map((c) => (
                          <span key={c} className="afs-pvs-badge">
                            {CAP_LABEL[c]}
                            {defaults[c] === p.id ? '·默认' : ''}
                          </span>
                        ))}
                      </div>
                      <div className="afs-pvs-card__sub">
                        {p.kind} · {p.mode === 'sync-binary' ? p.baseURL || '未设地址' : p.kind === 'fal' ? p.model || '未设模型' : p.submitUrl || '未设端点'}{' '}
                        {keyPresence[p.id] ? (
                          <span className="afs-pvs-badge afs-pvs-badge--key">
                            <Check size={10} />有 Key
                          </span>
                        ) : (
                          <span className="afs-pvs-badge afs-pvs-badge--nokey">
                            <AlertTriangle size={10} />无 Key
                          </span>
                        )}
                      </div>
                      {t && (
                        <div
                          className={`afs-pvs-testmsg ${t.state === 'ok' ? 'afs-pvs-testmsg--ok' : t.state === 'fail' ? 'afs-pvs-testmsg--fail' : ''}`}
                        >
                          {t.msg}
                        </div>
                      )}
                    </div>
                    {p.mode !== 'sync-binary' && (
                      <IconButton
                        aria-label="测试连接（轻量校验端点/Key）"
                        title="测试连接（轻量校验端点/Key）"
                        disabled={t?.state === 'testing'}
                        aria-busy={t?.state === 'testing' || undefined}
                        onClick={() => onTest(p)}
                        icon={t?.state === 'testing' ? <Loader2 size={14} className="afs-spin" /> : <Plug size={14} />}
                      />
                    )}
                    <IconButton variant="danger" aria-label="删除" title="删除" onClick={() => removeProvider(p.id)} icon={<Trash2 size={14} />} />
                  </div>
                )
              })}
            </div>
          )}

          <div className="afs-pvs-form">
            <div className="afs-pvs-form__title">{editingId ? '编辑供应商' : '添加供应商'}</div>

            {!editingId && (
              <Field label="预设" className="afs-field--inline">
                <Select
                  block
                  value=""
                  onChange={(v) => v && applyPreset(v)}
                  options={PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label, title: p.hint }))}
                  placeholder="从预设快速填充…"
                  ariaLabel="从预设快速填充"
                />
              </Field>
            )}

            <fieldset className="afs-pvs-fieldset">
              <legend className="afs-pvs-fieldset__legend">能力</legend>
              <div className="afs-pvs-caps">
                {CAPS.map((c) => (
                  <Checkbox
                    key={c.value}
                    checked={draftCaps.includes(c.value)}
                    onChange={() => toggleCap(c.value)}
                    label={c.label}
                  />
                ))}
                <span className="afs-pvs-mode">模式：{draftMode === 'sync-binary' ? '同步（语音）' : '异步轮询（视频/音乐）'}</span>
              </div>
            </fieldset>

            <Field label="类型" className="afs-field--inline">
              <Select
                block
                value={draft.kind}
                onChange={(v) => set({ kind: v as VideoProviderKind })}
                options={[
                  { value: 'fal', label: 'fal.ai（聚合）' },
                  { value: 'custom-http', label: 'custom-http（自定义端点）' },
                ]}
                ariaLabel="供应商类型"
              />
            </Field>

            <Field label="名称" className="afs-field--inline" htmlFor="afs-pvs-label">
              <Input id="afs-pvs-label" value={draft.label || ''} placeholder="如 fal 视频 / OpenAI 语音" onChange={(e) => set({ label: e.target.value })} />
            </Field>

            <div className="afs-pvs-shapecard">
              {draftMode === 'sync-binary' ? (
                <>
                  <Field label="接口地址" className="afs-field--inline" htmlFor="afs-pvs-baseurl">
                    <Input id="afs-pvs-baseurl" value={draft.baseURL || ''} placeholder="https://api.openai.com/v1" onChange={(e) => set({ baseURL: e.target.value })} />
                  </Field>
                  <Field label="模型" className="afs-field--inline" htmlFor="afs-pvs-model">
                    <Input id="afs-pvs-model" value={draft.model || ''} placeholder="tts-1" onChange={(e) => set({ model: e.target.value })} />
                  </Field>
                  <Field label="音色" className="afs-field--inline">
                    <TagsInput
                      value={draft.voices || []}
                      onChange={(voices) => set({ voices })}
                      placeholder="alloy, echo, nova…（回车或逗号添加，节点里可选）"
                      ariaLabel="音色"
                    />
                  </Field>
                  <p className="afs-pvs-note">同步语音：POST {'{接口地址}'}/audio/speech，直接返回音频（走后端，规避 CORS）。</p>
                </>
              ) : draft.kind === 'fal' ? (
                <>
                  <Field label="模型" className="afs-field--inline" htmlFor="afs-pvs-model">
                    <Input id="afs-pvs-model" value={draft.model || ''} placeholder="fal-ai/kling-video/v1/standard/image-to-video" onChange={(e) => set({ model: e.target.value })} />
                  </Field>
                  <p className="afs-pvs-note">视频：I2V 用 image-to-video、T2V 用 text-to-video 模型；配乐填 fal 音乐模型路径。</p>
                </>
              ) : (
                <>
                  <Field label="模型" className="afs-field--inline" htmlFor="afs-pvs-model">
                    <Input id="afs-pvs-model" value={draft.model || ''} placeholder="模型 ID（用于请求体模板的 {model}）" onChange={(e) => set({ model: e.target.value })} />
                  </Field>
                  <Field label="提交 URL" className="afs-field--inline" htmlFor="afs-pvs-submiturl">
                    <Input id="afs-pvs-submiturl" value={draft.submitUrl || ''} placeholder="https://api.xxx/v1/video" onChange={(e) => set({ submitUrl: e.target.value })} />
                  </Field>
                  <Field label="轮询 URL" className="afs-field--inline" htmlFor="afs-pvs-pollurl">
                    <Input id="afs-pvs-pollurl" value={draft.pollUrl || ''} placeholder="https://api.xxx/v1/video/{taskId}" onChange={(e) => set({ pollUrl: e.target.value })} />
                  </Field>
                  <div className="afs-pvs-grid">
                    <Input value={draft.taskIdPath || ''} placeholder="taskId 路径 (id)" onChange={(e) => set({ taskIdPath: e.target.value })} />
                    <Input value={draft.statusPath || ''} placeholder="status 路径 (status)" onChange={(e) => set({ statusPath: e.target.value })} />
                    <Input value={draft.videoUrlPath || ''} placeholder="结果地址路径 (video.url / audio.url)" onChange={(e) => set({ videoUrlPath: e.target.value })} />
                  </div>
                  <Field label="请求体模板（可选）" htmlFor="afs-pvs-body">
                    <Textarea
                      id="afs-pvs-body"
                      className="afs-pvs-mono"
                      rows={3}
                      value={draft.bodyTemplate || ''}
                      placeholder={'留空用通用 {prompt,image_url} body；占位符 {prompt}{imageUrl}{model}，条件块 {?imageUrl}…{/imageUrl}'}
                      onChange={(e) => set({ bodyTemplate: e.target.value })}
                    />
                  </Field>
                  <Field label="图片上传地址" className="afs-field--inline" htmlFor="afs-pvs-uploadurl">
                    <Input
                      id="afs-pvs-uploadurl"
                      value={draft.uploadUrl || ''}
                      placeholder="可选；仅收公开图片URL的供应商填，如 https://toapis.com/v1/uploads/images"
                      onChange={(e) => set({ uploadUrl: e.target.value })}
                    />
                  </Field>
                  <p className="afs-pvs-note">留空按常见命名自动尝试；URL 中 {'{taskId}'} 会被替换。填「图片上传地址」后，图生视频会先把本地关键帧上传换公开 URL。预设已为火山方舟/通义万相/toapis 填好。</p>
                </>
              )}
            </div>

            <Field
              className="afs-field--inline"
              htmlFor="afs-pvs-key"
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <KeyRound size={12} /> API Key
                </span>
              }
            >
              <Input
                id="afs-pvs-key"
                type="password"
                value={keyInput}
                placeholder={editingId && keyPresence[editingId] ? '已配置（留空不修改）' : '粘贴 API Key'}
                onChange={(e) => setKeyInput(e.target.value)}
              />
            </Field>

            <div className="afs-pvs-actions">
              {editingId && (
                <Button variant="secondary" onClick={resetForm}>
                  取消编辑
                </Button>
              )}
              <Button variant="primary" leadingIcon={Plus} onClick={onSave}>
                {editingId ? '保存' : '添加'}
              </Button>
            </div>
          </div>
        </div>
      </div>
  )
}
