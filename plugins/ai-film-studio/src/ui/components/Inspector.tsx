import { useRef, useState, useEffect } from 'react'
import { Trash2, Play, Loader2, Upload, Download, FolderOpen, KeyRound } from 'lucide-react'
import { getNodeDef, CATEGORY_META, type ParamDef } from '../nodes/nodeDefs'
import { useGraphStore, type PortValue } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { basename } from '../services/download'
import { setKey, hasKey, removeKey } from '../services/keys'

/** TTS API Key 输入：密钥走 storage.encrypted，不进工程参数 */
function TtsKeyField({ nodeId }: { nodeId: string }) {
  const [val, setVal] = useState('')
  const [saved, setSaved] = useState(false)
  const ref = `tts:${nodeId}`
  useEffect(() => {
    let on = true
    hasKey(ref).then((h) => on && setSaved(h))
    return () => {
      on = false
    }
  }, [ref])
  const save = async () => {
    if (!val.trim()) return
    await setKey(ref, val.trim())
    setSaved(true)
    setVal('')
    window.mulby?.notification?.show('TTS Key 已加密保存')
  }
  const clear = async () => {
    await removeKey(ref)
    setSaved(false)
  }
  return (
    <div className="afs-field">
      <label className="afs-field__label">
        <KeyRound size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        API Key（加密存储）
      </label>
      <input
        className="afs-field__input"
        type="password"
        value={val}
        placeholder={saved ? '已配置（留空保持不变）' : 'sk-...'}
        onChange={(e) => setVal(e.target.value)}
      />
      <div className="afs-result__actions">
        <button className="afs-btn afs-btn--mini" onClick={save} disabled={!val.trim()}>
          保存 Key
        </button>
        {saved && (
          <button className="afs-btn afs-btn--mini" onClick={clear}>
            清除
          </button>
        )}
      </div>
    </div>
  )
}

function resultText(v: PortValue): string {
  if (v.type === 'json' && v.json !== undefined) {
    try {
      return JSON.stringify(v.json, null, 2)
    } catch {
      return String(v.text ?? '')
    }
  }
  return String(v.text ?? '')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

export default function Inspector() {
  const fileRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId) || null)
  const updateNodeParam = useGraphStore((s) => s.updateNodeParam)
  const updateNodeTitle = useGraphStore((s) => s.updateNodeTitle)
  const removeNode = useGraphStore((s) => s.removeNode)
  const runNode = useGraphStore((s) => s.runNode)
  const setNodeImage = useGraphStore((s) => s.setNodeImage)
  const setNodeAudio = useGraphStore((s) => s.setNodeAudio)
  const downloadVideo = useGraphStore((s) => s.downloadVideo)
  const isRunning = useGraphStore((s) => s.isRunning)
  const runningNodeId = useGraphStore((s) => s.runningNodeId)
  const models = useGraphStore((s) => s.models)
  const imageModels = useGraphStore((s) => s.imageModels)
  const providers = useProviderStore((s) => s.providers)

  if (!node || !selectedNodeId) {
    return (
      <div className="afs-inspector">
        <div className="afs-inspector__empty">
          <p>未选中节点</p>
          <p className="afs-inspector__empty-hint">点击画布上的节点以编辑参数</p>
        </div>
      </div>
    )
  }

  const def = getNodeDef(node.data.kind)
  if (!def) {
    return (
      <div className="afs-inspector">
        <div className="afs-inspector__empty">未知节点类型：{node.data.kind}</div>
      </div>
    )
  }
  const meta = CATEGORY_META[def.category]
  const isImageInput = node.data.kind === 'image-input'
  const isAudioInput = node.data.kind === 'audio-input'
  const runnable =
    def.category === 'text' ||
    def.category === 'image' ||
    def.category === 'video' ||
    def.category === 'audio' ||
    (def.category === 'input' && !isImageInput && !isAudioInput) ||
    (def.category === 'output' &&
      (node.data.kind === 'preview' || node.data.kind === 'compose' || node.data.kind === 'export'))
  const running = runningNodeId === node.id
  const outputValues = node.data.outputs ? Object.values(node.data.outputs) : []

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      await setNodeImage(node.id, dataUrl)
    } catch {
      window.mulby?.notification?.show('图片读取失败', 'error')
    }
  }

  const onPickAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      await setNodeAudio(node.id, dataUrl)
    } catch {
      window.mulby?.notification?.show('音频读取失败', 'error')
    }
  }

  const renderControl = (p: ParamDef) => {
    const value = node.data.params[p.key]
    const common = {
      className: 'afs-field__input',
      value: (value ?? '') as string | number,
    }
    switch (p.control) {
      case 'textarea':
        return (
          <textarea
            {...common}
            rows={4}
            placeholder={p.placeholder}
            onChange={(e) => updateNodeParam(node.id, p.key, e.target.value)}
          />
        )
      case 'number':
        return (
          <input
            {...common}
            type="number"
            placeholder={p.placeholder}
            onChange={(e) => updateNodeParam(node.id, p.key, e.target.value === '' ? '' : Number(e.target.value))}
          />
        )
      case 'select':
        return (
          <select
            className="afs-field__input"
            value={(value ?? p.default ?? '') as string}
            onChange={(e) => updateNodeParam(node.id, p.key, e.target.value)}
          >
            {(p.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )
      default:
        return (
          <input
            {...common}
            type="text"
            placeholder={p.placeholder}
            onChange={(e) => updateNodeParam(node.id, p.key, e.target.value)}
          />
        )
    }
  }

  return (
    <div className="afs-inspector">
      <div className="afs-inspector__head" style={{ borderColor: meta.color }}>
        <span className="afs-inspector__badge" style={{ background: meta.color }}>
          {meta.label}
        </span>
        <span className="afs-inspector__kind">{def.label}</span>
      </div>

      {isImageInput && (
        <>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
          <button className="afs-inspector__run" onClick={() => fileRef.current?.click()} title="选择本地图片作为参考图">
            <Upload size={14} /> 上传参考图
          </button>
        </>
      )}

      {isAudioInput && (
        <>
          <input ref={audioRef} type="file" accept="audio/*" hidden onChange={onPickAudio} />
          <button className="afs-inspector__run" onClick={() => audioRef.current?.click()} title="选择本地音频作为成片音轨">
            <Upload size={14} /> 上传音频
          </button>
        </>
      )}

      {runnable && (
        <button
          className="afs-inspector__run"
          disabled={isRunning}
          onClick={() => runNode(node.id)}
          title="运行此节点（含上游派生输入）"
        >
          {running ? <Loader2 size={14} className="afs-spin" /> : <Play size={14} />}
          {running ? '生成中…' : '运行此节点'}
        </button>
      )}

      <div className="afs-inspector__scroll">
        <div className="afs-field">
          <label className="afs-field__label">节点标题</label>
          <input
            className="afs-field__input"
            type="text"
            value={node.data.title}
            onChange={(e) => updateNodeTitle(node.id, e.target.value)}
          />
        </div>

        {def.params.map((p) => (
          <div key={p.key} className="afs-field">
            <label className="afs-field__label">{p.label}</label>
            {renderControl(p)}
          </div>
        ))}

        {def.category === 'text' && (
          <div className="afs-field">
            <label className="afs-field__label">文本模型（覆盖顶栏）</label>
            <select
              className="afs-field__input"
              value={(node.data.params.modelOverride as string) || ''}
              onChange={(e) => updateNodeParam(node.id, 'modelOverride', e.target.value)}
            >
              <option value="">跟随顶栏（默认）</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </div>
        )}

        {def.category === 'image' && (
          <div className="afs-field">
            <label className="afs-field__label">图像模型（覆盖顶栏）</label>
            <select
              className="afs-field__input"
              value={(node.data.params.imageModelOverride as string) || ''}
              onChange={(e) => updateNodeParam(node.id, 'imageModelOverride', e.target.value)}
            >
              <option value="">跟随顶栏（默认）</option>
              {imageModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.id}
                </option>
              ))}
            </select>
          </div>
        )}

        {def.category === 'video' && (
          <div className="afs-field">
            <label className="afs-field__label">视频供应商（覆盖默认）</label>
            <select
              className="afs-field__input"
              value={(node.data.params.providerOverride as string) || ''}
              onChange={(e) => updateNodeParam(node.id, 'providerOverride', e.target.value)}
            >
              <option value="">跟随默认</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {providers.length === 0 && (
              <div className="afs-inspector__note">尚未添加供应商，先在顶栏「视频供应商」配置</div>
            )}
          </div>
        )}

        {def.category === 'audio' && <TtsKeyField nodeId={node.id} />}

        {def.params.length === 0 &&
          def.category !== 'text' &&
          def.category !== 'image' &&
          def.category !== 'video' && <div className="afs-inspector__note">该节点暂无可配置参数</div>}

        <div className="afs-inspector__ports">
          {def.inputs.length > 0 && (
            <div className="afs-portcol">
              <div className="afs-portcol__title">输入</div>
              {def.inputs.map((p) => (
                <div key={p.id} className="afs-portcol__item">
                  {p.label} <span className="afs-portcol__type">{p.type}</span>
                </div>
              ))}
            </div>
          )}
          {def.outputs.length > 0 && (
            <div className="afs-portcol">
              <div className="afs-portcol__title">输出</div>
              {def.outputs.map((p) => (
                <div key={p.id} className="afs-portcol__item">
                  {p.label} <span className="afs-portcol__type">{p.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {node.data.error && <div className="afs-result afs-result--error">{node.data.error}</div>}

        {running && node.data.previewUrl && (
          <div className="afs-result">
            <div className="afs-result__title">生成预览…</div>
            <img className="afs-result__img" src={node.data.previewUrl} alt="preview" />
          </div>
        )}

        {running && !node.data.previewUrl && node.data.stream && (
          <div className="afs-result">
            <div className="afs-result__title">生成中…</div>
            <pre className="afs-result__pre">{node.data.stream}</pre>
          </div>
        )}

        {!running && outputValues.length > 0 && (
          <div className="afs-result">
            <div className="afs-result__title">运行结果</div>
            {outputValues.map((v, i) =>
              v.type === 'video' && v.url ? (
                <div key={i}>
                  <video className="afs-result__img" src={v.url} controls preload="metadata" />
                  <div className="afs-result__actions">
                    {v.localPath ? (
                      <>
                        <span className="afs-result__path" title={v.localPath}>
                          已存本地：{basename(v.localPath)}
                        </span>
                        <button
                          className="afs-btn afs-btn--mini"
                          onClick={() => window.mulby?.shell?.showItemInFolder?.(v.localPath as string)}
                          title="在文件管理器中显示"
                        >
                          <FolderOpen size={13} /> 打开文件夹
                        </button>
                      </>
                    ) : (
                      <button className="afs-btn afs-btn--mini" onClick={() => downloadVideo(node.id)} title="下载视频到本机">
                        <Download size={13} /> 下载到本地
                      </button>
                    )}
                  </div>
                </div>
              ) : v.type === 'audio' && v.url ? (
                <audio key={i} className="afs-result__audio" src={v.url} controls preload="metadata" />
              ) : v.type === 'image' && v.url ? (
                <img key={i} className="afs-result__img" src={v.url} alt="result" />
              ) : (
                <pre key={i} className="afs-result__pre">
                  {resultText(v)}
                </pre>
              )
            )}
          </div>
        )}
      </div>

      <button className="afs-inspector__delete" onClick={() => removeNode(node.id)}>
        <Trash2 size={14} /> 删除节点
      </button>
    </div>
  )
}
