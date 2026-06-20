import { useRef } from 'react'
import { Trash2, Play, Loader2, Upload, FastForward, BookmarkPlus } from 'lucide-react'
import { getNodeDef, CATEGORY_META, type ParamDef } from '../nodes/nodeDefs'
import { useGraphStore } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { useAssetStore } from '../store/assetStore'
import { usePromptStore, resolveSnippet, SNIPPET_GROUPS } from '../store/promptStore'
import { gatherInputs } from '../services/executor'
import { OutputView, InputSummary } from './inspectorViews'
import { OptimizableField } from './OptimizableField'
import { getFieldOptimizer } from '../services/fieldOptimize'

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
  const updateNodeOutputText = useGraphStore((s) => s.updateNodeOutputText)
  const setNodeImage = useGraphStore((s) => s.setNodeImage)
  const setNodeAudio = useGraphStore((s) => s.setNodeAudio)
  const saveElement = useAssetStore((s) => s.saveElement)
  const snippets = usePromptStore((s) => s.snippets)
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
  const isProp = node.data.kind === 'prop'
  const isAsset = isCharacter || isScene || isProp
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
  // 该节点需要的媒体供应商能力（视频 / 配乐 / 语音）；用于属性面板的供应商选择器
  const providerCap: 'video' | 'music' | 'tts' | null =
    def.category === 'video' ? 'video' : node.data.kind === 'bgm' ? 'music' : node.data.kind === 'tts' ? 'tts' : null
  const providerCapLabel = providerCap === 'video' ? '视频' : providerCap === 'music' ? '配乐' : '语音'
  const capProviders = providerCap ? providers.filter((p) => (p.capabilities || ['video']).includes(providerCap)) : []
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

  const onSaveToLibrary = async () => {
    if (!isAsset) return
    const p = node.data.params || {}
    const name = String(p.name || '').trim()
    if (!name) {
      window.mulby?.notification?.show('请先填写名称', 'warning')
      return
    }
    const kind = isCharacter ? 'character' : isScene ? 'scene' : 'prop'
    const description = String((isCharacter ? p.appearance : p.description) || '')
    const prompt = String(p.refPrompt || '')
    const imgAssetId = node.data.outputs?.image?.assetId
    await saveElement({ kind, name, description, prompt, refAssetIds: imgAssetId ? [imgAssetId] : [] })
    window.mulby?.notification?.show(`已保存到库：${name}`, 'success')
  }

  // 可插入片段的目标参数：节点第一个 textarea 参数（如 故事/指令/描述/运镜…）
  const snippetTarget = def.params.find((p) => p.control === 'textarea')?.key
  const snippetTargetLabel = def.params.find((p) => p.key === snippetTarget)?.label || ''
  const insertSnippet = (snippetId: string) => {
    if (!snippetTarget) return
    const s = snippets.find((x) => x.id === snippetId)
    if (!s) return
    const resolved = resolveSnippet(s)
    const cur = String(node.data.params[snippetTarget] ?? '')
    updateNodeParam(node.id, snippetTarget, cur ? `${cur}\n${resolved}` : resolved)
  }

  const renderControl = (p: ParamDef) => {
    const value = node.data.params[p.key]
    const common = {
      className: 'afs-field__input',
      value: (value ?? '') as string | number,
    }
    const optGuide = getFieldOptimizer(node.data.kind, p.key)
    switch (p.control) {
      case 'textarea':
        if (optGuide)
          return (
            <OptimizableField
              nodeId={node.id}
              paramKey={p.key}
              value={(value ?? '') as string}
              control="textarea"
              placeholder={p.placeholder}
              guide={optGuide}
            />
          )
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
        if (optGuide)
          return (
            <OptimizableField
              nodeId={node.id}
              paramKey={p.key}
              value={(value ?? '') as string}
              control="text"
              placeholder={p.placeholder}
              guide={optGuide}
            />
          )
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
            title={isScene ? '选择本地图片作为场景参考图' : isCharacter ? '选择本地图片作为角色参考图（覆盖文字生成的图）' : isProp ? '选择本地图片作为物品参考图（覆盖文字生成的图）' : '选择本地图片作为参考图'}
          >
            <Upload size={14} /> {isScene ? '上传场景图' : isCharacter ? '上传角色图' : isProp ? '上传物品图' : '上传参考图'}
          </button>
        </>
      )}

      {isAsset && (
        <button
          className="afs-inspector__run afs-inspector__run--alt"
          onClick={onSaveToLibrary}
          title="把该角色/场景（含参考图）保存到全局库，跨工程复用"
        >
          <BookmarkPlus size={14} /> 保存到库
        </button>
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

        {snippetTarget && snippets.length > 0 && (
          <div className="afs-field">
            <label className="afs-field__label">插入片段 → {snippetTargetLabel}</label>
            <select
              className="afs-field__input"
              value=""
              onChange={(e) => {
                if (e.target.value) insertSnippet(e.target.value)
                e.target.value = ''
              }}
            >
              <option value="">选择片段插入…</option>
              {SNIPPET_GROUPS.map((g) => {
                const items = snippets.filter((s) => s.group === g.id)
                return items.length ? (
                  <optgroup key={g.id} label={g.label}>
                    {items.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null
              })}
            </select>
          </div>
        )}

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

        {providerCap && (
          <div className="afs-field">
            <label className="afs-field__label">{providerCapLabel}供应商（覆盖默认）</label>
            <select
              className="afs-field__input"
              value={(node.data.params.providerOverride as string) || ''}
              onChange={(e) => updateNodeParam(node.id, 'providerOverride', e.target.value)}
            >
              <option value="">跟随默认</option>
              {capProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {capProviders.length === 0 && (
              <div className="afs-inspector__note">尚无{providerCapLabel}供应商，先在顶栏「模型供应商」添加</div>
            )}
          </div>
        )}

        {def.params.length === 0 &&
          def.category !== 'text' &&
          def.category !== 'image' &&
          !providerCap && <div className="afs-inspector__note">该节点暂无可配置参数</div>}

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
                  nodeId={node.id}
                  port={k}
                  title={node.data.title || def.label}
                  nodePrompt={typeof node.data.params?.prompt === 'string' ? node.data.params.prompt : undefined}
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
