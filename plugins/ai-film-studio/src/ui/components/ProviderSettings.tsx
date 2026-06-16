import { useEffect, useState } from 'react'
import { X, Plus, Trash2, Check, KeyRound, Plug, Loader2 } from 'lucide-react'
import { useProviderStore } from '../store/providerStore'
import type { VideoProviderConfig, VideoProviderKind } from '../services/providers'
import { testVideoProvider } from '../services/providers/test'
import { getKey } from '../services/keys'

interface Props {
  open: boolean
  onClose: () => void
}

type Draft = Partial<VideoProviderConfig> & { kind: VideoProviderKind }

const EMPTY: Draft = { kind: 'fal', label: '', model: 'fal-ai/kling-video/v1/standard/image-to-video' }

export default function ProviderSettings({ open, onClose }: Props) {
  const providers = useProviderStore((s) => s.providers)
  const selectedId = useProviderStore((s) => s.selectedId)
  const keyPresence = useProviderStore((s) => s.keyPresence)
  const load = useProviderStore((s) => s.load)
  const addProvider = useProviderStore((s) => s.addProvider)
  const updateProvider = useProviderStore((s) => s.updateProvider)
  const removeProvider = useProviderStore((s) => s.removeProvider)
  const selectProvider = useProviderStore((s) => s.selectProvider)
  const setProviderKey = useProviderStore((s) => s.setProviderKey)

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [tests, setTests] = useState<Record<string, { state: 'testing' | 'ok' | 'fail'; msg: string }>>({})

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const onTest = async (p: VideoProviderConfig) => {
    setTests((t) => ({ ...t, [p.id]: { state: 'testing', msg: '测试中…' } }))
    // 正在编辑该项且填了新 Key，用新 Key 测；否则用已存 Key
    const key = editingId === p.id && keyInput.trim() ? keyInput.trim() : await getKey(p.id)
    const r = await testVideoProvider(p, key)
    setTests((t) => ({ ...t, [p.id]: { state: r.ok ? 'ok' : 'fail', msg: r.message } }))
  }

  if (!open) return null

  const resetForm = () => {
    setDraft(EMPTY)
    setEditingId(null)
    setKeyInput('')
  }

  const onEdit = (p: VideoProviderConfig) => {
    setDraft({ ...p })
    setEditingId(p.id)
    setKeyInput('')
  }

  const onSave = async () => {
    if (!draft.label?.trim()) {
      window.mulby?.notification?.show('请填写供应商名称', 'warning')
      return
    }
    let id = editingId
    if (editingId) {
      await updateProvider(editingId, draft)
    } else {
      id = await addProvider(draft)
    }
    if (id && keyInput.trim()) await setProviderKey(id, keyInput.trim())
    resetForm()
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))

  return (
    <div className="afs-modal" onClick={onClose}>
      <div className="afs-modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="afs-modal__head">
          <span className="afs-modal__title">视频供应商</span>
          <button className="afs-modal__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="afs-modal__body">
          <div className="afs-modal__hint">
            Mulby 不提供视频模型，需自管供应商。Key 经系统密钥库加密存储，仅本机可解。
          </div>

          {providers.length > 0 && (
            <div className="afs-provlist">
              {providers.map((p) => (
                <div key={p.id} className={`afs-prov ${p.id === selectedId ? 'afs-prov--active' : ''}`}>
                  <button
                    className="afs-prov__radio"
                    title="设为默认"
                    onClick={() => selectProvider(p.id)}
                  >
                    {p.id === selectedId ? <Check size={13} /> : <span className="afs-prov__dot" />}
                  </button>
                  <div className="afs-prov__main" onClick={() => onEdit(p)}>
                    <div className="afs-prov__label">{p.label}</div>
                    <div className="afs-prov__sub">
                      {p.kind} · {p.kind === 'fal' ? p.model || '未设模型' : p.submitUrl || '未设端点'}
                      {keyPresence[p.id] ? <span className="afs-prov__key">· Key✓</span> : <span className="afs-prov__nokey">· 无Key</span>}
                    </div>
                    {tests[p.id] && (
                      <div
                        className={`afs-prov__testmsg ${
                          tests[p.id].state === 'ok'
                            ? 'afs-prov__testmsg--ok'
                            : tests[p.id].state === 'fail'
                              ? 'afs-prov__testmsg--fail'
                              : ''
                        }`}
                      >
                        {tests[p.id].msg}
                      </div>
                    )}
                  </div>
                  <button
                    className="afs-prov__testbtn"
                    title="测试连接（轻量校验端点/Key）"
                    disabled={tests[p.id]?.state === 'testing'}
                    onClick={() => onTest(p)}
                  >
                    {tests[p.id]?.state === 'testing' ? <Loader2 size={14} className="afs-spin" /> : <Plug size={14} />}
                  </button>
                  <button className="afs-prov__del" title="删除" onClick={() => removeProvider(p.id)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="afs-form">
            <div className="afs-form__title">{editingId ? '编辑供应商' : '添加供应商'}</div>

            <label className="afs-form__row">
              <span>类型</span>
              <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as VideoProviderKind })}>
                <option value="fal">fal.ai（聚合：Kling/Veo/Sora/Seedance…）</option>
                <option value="custom-http">custom-http（自定义端点）</option>
              </select>
            </label>

            <label className="afs-form__row">
              <span>名称</span>
              <input value={draft.label || ''} placeholder="如 fal 视频" onChange={(e) => set({ label: e.target.value })} />
            </label>

            {draft.kind === 'fal' && (
              <>
                <label className="afs-form__row">
                  <span>模型</span>
                  <input
                    value={draft.model || ''}
                    placeholder="fal-ai/kling-video/v1/standard/image-to-video"
                    onChange={(e) => set({ model: e.target.value })}
                  />
                </label>
                <div className="afs-form__note">I2V 用 image-to-video 模型；T2V 用 text-to-video 模型。</div>
              </>
            )}

            {draft.kind === 'custom-http' && (
              <>
                <label className="afs-form__row">
                  <span>提交 URL</span>
                  <input value={draft.submitUrl || ''} placeholder="https://api.xxx/v1/video" onChange={(e) => set({ submitUrl: e.target.value })} />
                </label>
                <label className="afs-form__row">
                  <span>轮询 URL</span>
                  <input value={draft.pollUrl || ''} placeholder="https://api.xxx/v1/video/{taskId}" onChange={(e) => set({ pollUrl: e.target.value })} />
                </label>
                <div className="afs-form__grid">
                  <input value={draft.taskIdPath || ''} placeholder="taskId 路径 (id)" onChange={(e) => set({ taskIdPath: e.target.value })} />
                  <input value={draft.statusPath || ''} placeholder="status 路径 (status)" onChange={(e) => set({ statusPath: e.target.value })} />
                  <input value={draft.videoUrlPath || ''} placeholder="视频地址路径 (video.url)" onChange={(e) => set({ videoUrlPath: e.target.value })} />
                </div>
                <div className="afs-form__note">留空则按常见命名自动尝试；URL 中 {'{taskId}'} 会被替换。</div>
              </>
            )}

            <label className="afs-form__row">
              <span>
                <KeyRound size={12} /> API Key
              </span>
              <input
                type="password"
                value={keyInput}
                placeholder={editingId && keyPresence[editingId] ? '已配置（留空不修改）' : '粘贴 API Key'}
                onChange={(e) => setKeyInput(e.target.value)}
              />
            </label>

            <div className="afs-form__actions">
              {editingId && (
                <button className="afs-btn" onClick={resetForm}>
                  取消编辑
                </button>
              )}
              <button className="afs-btn afs-btn--save" onClick={onSave}>
                <Plus size={14} /> {editingId ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
