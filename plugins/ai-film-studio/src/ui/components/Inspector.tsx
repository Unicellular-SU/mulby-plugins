import { useRef, useState, useEffect } from 'react'
import { Trash2, Play, Loader2, Upload, KeyRound, FastForward } from 'lucide-react'
import { getNodeDef, CATEGORY_META, type ParamDef } from '../nodes/nodeDefs'
import { useGraphStore } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { gatherInputs } from '../services/executor'
import { OutputView, InputSummary } from './inspectorViews'
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
  const allNodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNodeParam = useGraphStore((s) => s.updateNodeParam)
  const updateNodeTitle = useGraphStore((s) => s.updateNodeTitle)
  const removeNode = useGraphStore((s) => s.removeNode)
  const runNode = useGraphStore((s) => s.runNode)
  const runFrom = useGraphStore((s) => s.runFrom)
  const editNodeImageItem = useGraphStore((s) => s.editNodeImageItem)
  const regenNodeImageItem = useGraphStore((s) => s.regenNodeImageItem)
  const updateNodeOutputText = useGraphStore((s) => s.updateNodeOutputText)
  const setNodeImage = useGraphStore((s) => s.setNodeImage)
  const setNodeAudio = useGraphStore((s) => s.setNodeAudio)
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
  const isCharacter = node.data.kind === 'character'
  const isScene = node.data.kind === 'scene'
  const isAsset = isCharacter || isScene
  // 人物/场景：既可「运行此节点」按文字生成参考图，也可随时「上传图片」用本地图（二者并存）
  const runnable =
    def.category === 'text' ||
    def.category === 'image' ||
    def.category === 'video' ||
    def.category === 'audio' ||
    (def.category === 'input' && !isImageInput && !isAudioInput) ||
    (def.category === 'output' &&
      (node.data.kind === 'preview' || node.data.kind === 'compose' || node.data.kind === 'export' || node.data.kind === 'merge'))
  const running = runningNodeId === node.id
  const hasDownstream = edges.some((e) => e.source === node.id)
  const inputs = gatherInputs(node, allNodes, edges)
  const outputEntries = node.data.outputs ? Object.entries(node.data.outputs) : []
  const portLabel = (ports: { id: string; label: string }[], pid: string) => ports.find((p) => p.id === pid)?.label || pid

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      // 人物/场景上传写入 'image' 口（保留 JSON 身份），参考图节点写默认 'out' 口
      await setNodeImage(node.id, dataUrl, isAsset ? 'image' : 'out')
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

      {(isImageInput || isAsset) && (
        <>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPickFile} />
          <button
            className="afs-inspector__run afs-inspector__run--alt"
            onClick={() => fileRef.current?.click()}
            title={isScene ? '选择本地图片作为场景参考图' : isCharacter ? '选择本地图片作为角色参考图（覆盖文字生成的图）' : '选择本地图片作为参考图'}
          >
            <Upload size={14} /> {isScene ? '上传场景图' : isCharacter ? '上传角色图' : '上传参考图'}
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
        <div className="afs-inspector__runrow">
          <button
            className="afs-inspector__run"
            disabled={isRunning}
            onClick={() => runNode(node.id)}
            title="仅运行此节点（用上游已有产物作输入）"
          >
            {running ? <Loader2 size={14} className="afs-spin" /> : <Play size={14} />}
            {running ? '生成中…' : '运行此节点'}
          </button>
          {hasDownstream && (
            <button
              className="afs-inspector__run afs-inspector__run--alt"
              disabled={isRunning}
              onClick={() => runFrom(node.id)}
              title="从此节点开始，依次执行其所有下游节点"
            >
              <FastForward size={14} /> 从此处继续
            </button>
          )}
        </div>
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

        {/* 输入区：每个输入端口的连接状态与上游产物摘要 */}
        {def.inputs.length > 0 && (
          <div className="afs-section">
            <div className="afs-section__title">输入</div>
            {def.inputs.map((p) => {
              const v = inputs[p.id]?.[0]
              return (
                <div key={p.id} className="afs-io">
                  <span className="afs-io__label">
                    {p.label}
                    <span className="afs-portcol__type">{p.type}</span>
                  </span>
                  <span className="afs-io__val">
                    {v ? <InputSummary value={v} /> : <span className="afs-inspector__note">未连接</span>}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {node.data.error && <div className="afs-result afs-result--error">{node.data.error}</div>}

        {node.data.error && node.data.stream && (
          <div className="afs-result">
            <div className="afs-result__title">模型原始输出（供排查）</div>
            <pre className="afs-result__pre">{node.data.stream}</pre>
          </div>
        )}

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

        {/* 输出区：每个输出端口的富渲染（剧本/分镜/角色卡片 · 媒体画廊 · 文本）。
            生成中也展示，以便扇出时「输出一张展示一张」实时增长 */}
        {outputEntries.length > 0 && (
          <div className="afs-section">
            <div className="afs-section__title">输出{running ? '（生成中…）' : ''}</div>
            {outputEntries.map(([k, v]) => (
              <div key={k} className="afs-outport">
                {def.outputs.length > 1 ? <div className="afs-outport__label">{portLabel(def.outputs, k)}</div> : null}
                <OutputView
                  value={v}
                  onEditImage={(i, prompt) => editNodeImageItem(node.id, k, i, prompt)}
                  onRegenImage={(i) => regenNodeImageItem(node.id, k, i)}
                  onEditText={(text) => updateNodeOutputText(node.id, k, text)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="afs-inspector__delete" onClick={() => removeNode(node.id)}>
        <Trash2 size={14} /> 删除节点
      </button>
    </div>
  )
}
