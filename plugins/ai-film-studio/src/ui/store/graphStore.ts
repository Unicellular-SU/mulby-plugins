import { create } from 'zustand'
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection } from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { nanoid } from 'nanoid'
import { getNodeDef, type PortType } from '../nodes/nodeDefs'
import { listTextModels, listImageModels } from '../services/models'
import { runText, abortText } from '../services/textEngine'
import { generateImage, editImage, abortImage } from '../services/imageEngine'
import { saveAsset, loadAsset, toDataUrl, fromDataUrl } from '../services/assets'
import { buildPrompt, buildImagePrompts, validateNodeJson, buildRepairPrompt } from '../services/prompts'
import { extractJson, stripCodeFences } from '../services/jsonParse'
import { topoOrder, resolveOutput, gatherInputs } from '../services/executor'
import { runVideo, abortVideo } from '../services/providers'
import { downloadVideoToDisk } from '../services/download'
import { ensureFfmpeg, composeFilm, abortFfmpeg, parseResolution, type SubtitleMode } from '../services/ffmpeg'
import { buildSrt } from '../services/subtitles'
import { synthSpeech } from '../services/tts'
import { writeBase64, writeText, exportPath, toFileUrl } from '../services/fsutil'
import { getKey } from '../services/keys'
import { TEMPLATES, instantiateTemplate } from '../templates'
import { useProviderStore } from './providerStore'

const PLUGIN_ID = 'ai-film-studio'
const KEY_PROJECTS = 'projects'
const KEY_CURRENT = 'currentProjectId'

// ============ 数据模型 ============
export type NodeRunStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

// 端口运行产物（运行后写回节点）
export interface PortValue {
  type: PortType
  text?: string
  json?: unknown
  // 媒体产物（M2/M3）：资产库引用 + 会话内 data URL（不持久化）
  assetId?: string
  url?: string
  mime?: string
  // 视频落盘本地路径（M4，持久化）
  localPath?: string
  // 片段时长（秒）：视频节点产出时写入，compose 用于字幕时间轴对齐（M5）
  durationSec?: number
  // 扇出：一个端口承载多份产物（N 张图 / N 个视频）；flat 字段镜像 items[0] 兼容单值渲染（M7）
  items?: PortValue[]
  // 产物元信息（如角色名/镜头号），用于跨镜一致性匹配与展示
  meta?: Record<string, unknown>
}

export interface FilmNodeData {
  kind: string
  title: string
  params: Record<string, unknown>
  status: NodeRunStatus
  stream?: string // 运行中的原始流式文本
  previewUrl?: string // 图像生成中的预览（不持久化）
  outputs?: Record<string, PortValue> // 运行产物（按 port.id）
  error?: string
  // React Flow 要求 data 满足 Record<string, unknown>
  [key: string]: unknown
}

export type FilmNode = Node<FilmNodeData>

export interface ProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

// 项目级全局设定：注入所有生成节点，画幅决定图像/视频尺寸（M7，对齐设计 §8.1）
export interface ProjectGlobals {
  aspectRatio: '16:9' | '9:16' | '1:1' | string
  style: string
}

export function defaultGlobals(): ProjectGlobals {
  return { aspectRatio: '16:9', style: '' }
}

// 向后兼容：旧工程可能无 globals 或字段不全，统一补全为完整结构
function normGlobals(g?: Partial<ProjectGlobals>): ProjectGlobals {
  return { ...defaultGlobals(), ...(g || {}) }
}

export interface ProjectData extends ProjectMeta {
  nodes: FilmNode[]
  edges: Edge[]
  viewport?: { x: number; y: number; zoom: number }
  globals?: ProjectGlobals
}

// ============ 存储辅助（store 在 React 之外，直接访问 window.mulby） ============
async function sget<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}
async function sset(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, PLUGIN_ID)
  } catch {
    // 忽略存储失败（如在浏览器里调试）
  }
}

function now() {
  return Date.now()
}

function makeDefaultProject(name = '未命名工程'): ProjectData {
  const id = `proj_${nanoid(8)}`
  const ts = now()
  // 起步图：一个故事输入节点，方便用户立刻上手
  const storyNode: FilmNode = {
    id: `n_${nanoid(6)}`,
    type: 'film',
    position: { x: 240, y: 200 },
    data: { kind: 'story', title: '故事输入', params: {}, status: 'idle' },
  }
  return { id, name, createdAt: ts, updatedAt: ts, nodes: [storyNode], edges: [], globals: defaultGlobals() }
}

// 连线类型校验：源端口类型与目标端口类型相同，或任一为 any
export function isValidConnection(connection: Connection | Edge, nodes: FilmNode[]): boolean {
  if (!connection.source || !connection.target) return false
  if (connection.source === connection.target) return false
  const sourceNode = nodes.find((n) => n.id === connection.source)
  const targetNode = nodes.find((n) => n.id === connection.target)
  if (!sourceNode || !targetNode) return false
  const sDef = getNodeDef(sourceNode.data.kind)
  const tDef = getNodeDef(targetNode.data.kind)
  if (!sDef || !tDef) return false
  const sPort = sDef.outputs.find((p) => p.id === connection.sourceHandle)
  const tPort = tDef.inputs.find((p) => p.id === connection.targetHandle)
  if (!sPort || !tPort) return false
  return sPort.type === tPort.type || sPort.type === 'any' || tPort.type === 'any'
}

// ============ Store ============
interface GraphState {
  loaded: boolean
  projects: ProjectMeta[]
  currentId: string | null
  projectName: string
  globals: ProjectGlobals
  nodes: FilmNode[]
  edges: Edge[]
  selectedNodeId: string | null
  dirty: boolean
  saving: boolean

  // 运行 / 模型
  models: AiModel[]
  imageModels: AiModel[]
  selectedModel: string | null
  selectedImageModel: string | null
  modelsLoaded: boolean
  isRunning: boolean
  runningNodeId: string | null

  init: () => Promise<void>
  loadModels: () => Promise<void>
  setSelectedModel: (id: string | null) => void
  setSelectedImageModel: (id: string | null) => void
  runNode: (id: string) => Promise<void>
  runAll: () => Promise<void>
  cancelRun: () => void
  setNodeImage: (id: string, dataUrl: string) => Promise<void>
  setNodeAudio: (id: string, dataUrl: string) => Promise<void>
  loadTemplate: (templateId: string) => Promise<void>
  downloadVideo: (id: string) => Promise<void>

  // React Flow 回调
  onNodesChange: OnNodesChange<FilmNode>
  onEdgesChange: OnEdgesChange
  onConnect: OnConnect

  // 节点编辑
  addNode: (kind: string, position: { x: number; y: number }) => void
  removeNode: (id: string) => void
  deleteSelected: () => void
  updateNodeParam: (id: string, key: string, value: unknown) => void
  updateNodeTitle: (id: string, title: string) => void
  setSelected: (id: string | null) => void

  // 工程管理
  newProject: () => Promise<void>
  saveProject: () => Promise<void>
  switchProject: (id: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  renameProject: (name: string) => void
  setGlobals: (patch: Partial<ProjectGlobals>) => void
  importProject: (data: Partial<ProjectData>) => Promise<void>
  exportProject: () => ProjectData
}

// 防抖自动保存
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(save: () => void) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, 800)
}

// 局部更新某节点 data（运行期使用，不触发结构性自动保存）
function patchNode(id: string, patch: Partial<FilmNodeData>) {
  const s = useGraphStore.getState()
  useGraphStore.setState({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
  })
}

// 执行单个节点（不切换全局 isRunning，由 runNode/runAll 包裹）
async function execNode(id: string): Promise<void> {
  const get = useGraphStore.getState
  const node = get().nodes.find((n) => n.id === id)
  if (!node) return
  const def = getNodeDef(node.data.kind)
  if (!def) return

  // 输入节点：按参数即时派生输出
  if (def.category === 'input') {
    const outId = def.outputs[0]?.id
    const out = outId ? resolveOutput(node, outId) : null
    patchNode(id, { status: 'done', outputs: out && outId ? { [outId]: out } : {}, error: undefined })
    return
  }

  // 预览节点：展示上游输入
  if (def.category === 'output' && node.data.kind === 'preview') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const v = inputs['in']?.[0]
    patchNode(id, { status: v ? 'done' : 'idle', outputs: v ? { in: v } : {}, error: undefined })
    return
  }

  // 文本 AI 节点：流式调用 + JSON 校验 + 有限次「带错误反馈」修复重试
  if (def.category === 'text') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const { system, user } = buildPrompt(node.data, inputs, get().globals)
    if (!user.trim()) {
      patchNode(id, { status: 'error', error: '缺少输入内容（请连接上游或填写内容）' })
      return
    }
    const outDef = def.outputs[0]
    const wantJson = outDef?.type === 'json'
    const maxAttempts = wantJson ? 2 : 1 // JSON 节点：失败后回灌错误重试一次
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', stream: '', error: undefined })
    try {
      const model = (node.data.params?.modelOverride as string) || get().selectedModel
      let content = ''
      let parsed: unknown = null
      let lastErr = ''
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const usr = attempt === 1 ? user : buildRepairPrompt(user, lastErr, content)
        if (attempt > 1) patchNode(id, { stream: '解析未通过，自动修正重试…' })
        let acc = ''
        const r = await runText({
          model,
          system,
          user: usr,
          jsonMode: wantJson, // 宿主结构化输出：从源头约束为合法 JSON（旧宿主忽略，回退 prompt+校验）
          onText: (t) => {
            acc += t
            patchNode(id, { stream: acc })
          },
        })
        content = r.content
        if (!wantJson) break
        parsed = extractJson(content)
        lastErr = validateNodeJson(node.data.kind, parsed)
        if (!lastErr) break
      }
      if (wantJson) {
        if (lastErr) {
          patchNode(id, { status: 'error', error: `未能解析 JSON 输出（${lastErr}）`, stream: content })
        } else {
          patchNode(id, {
            status: 'done',
            outputs: { [outDef.id]: { type: 'json', json: parsed, text: content } },
            stream: content,
          })
        }
      } else {
        const outId = outDef?.id || 'out'
        patchNode(id, {
          status: 'done',
          outputs: { [outId]: { type: 'text', text: stripCodeFences(content) || content } },
          stream: content,
        })
      }
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e) })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 图像 AI 节点：按输入数组扇出生成 N 张（N 角色/N 镜头/N 场景）→ 存资产库
  if (def.category === 'image') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const jobs = buildImagePrompts(node.data, inputs, get().globals)
    if (jobs.length === 0) {
      patchNode(id, { status: 'error', error: '缺少输入内容（请连接上游分镜/角色/场景）' })
      return
    }
    const model = (node.data.params?.imageModelOverride as string) || get().selectedImageModel
    if (!model) {
      patchNode(id, { status: 'error', error: '未配置图像模型（请在顶栏或节点选择）' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', error: undefined, previewUrl: undefined, stream: undefined })
    try {
      // 上游参考图（含扇出的多张），用于 img2img + 按角色名匹配保持一致性
      const refs = await resolveRefImages(inputs)
      const canEdit = refs.length > 0 && !!window.mulby?.ai?.images?.edit
      const items: PortValue[] = []
      for (let i = 0; i < jobs.length; i++) {
        if (!get().isRunning) break
        const job = jobs[i]
        patchNode(id, { stream: jobs.length > 1 ? `生成中 ${i + 1}/${jobs.length}…` : '生成中…', previewUrl: undefined })
        const ref = canEdit ? pickRef(refs, job.refName) : null
        let base64: string
        let mime: string
        if (ref) {
          const r = await editImage({ model, prompt: job.prompt, refBase64: ref.base64, refMime: ref.mime })
          base64 = r.base64
          mime = r.mime
        } else {
          const r = await generateImage({
            model,
            prompt: job.prompt,
            size: job.size,
            onPreview: (b64) => patchNode(id, { previewUrl: toDataUrl(b64, 'image/png') }),
          })
          base64 = r.base64
          mime = r.mime
        }
        const assetId = await saveAsset(base64, mime)
        items.push({ type: 'image', assetId, url: toDataUrl(base64, mime), mime, meta: job.meta })
      }
      if (items.length === 0) throw new Error('未生成任何图像')
      const outId = def.outputs[0]?.id || 'out'
      const head = items[0]
      patchNode(id, {
        status: 'done',
        previewUrl: undefined,
        stream: undefined,
        // flat 字段镜像 items[0] 以兼容单值渲染；items 承载全部
        outputs: { [outId]: { type: 'image', items, assetId: head.assetId, url: head.url, mime: head.mime } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), previewUrl: undefined, stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 视频 AI 节点：自管供应商 submit→poll→fetch
  if (def.category === 'video') {
    const ps = useProviderStore.getState()
    const overrideId = (node.data.params?.providerOverride as string) || ''
    const provider = overrideId ? ps.providers.find((p) => p.id === overrideId) || null : ps.getActive()
    if (!provider) {
      patchNode(id, {
        status: 'error',
        error: overrideId ? '该节点指定的视频供应商已不存在' : '未配置视频供应商（点顶栏「视频供应商」添加）',
      })
      return
    }
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const promptText =
      (inputs['prompt']?.[0]?.text || inputs['in']?.[0]?.text || '').trim() ||
      String(node.data.params?.motion ?? '').trim()
    // i2v：按上游关键帧（含扇出的多张）逐帧扇出生成 N 个视频；t2v：单个文本任务
    const frameUrls: (string | undefined)[] = []
    if (node.data.kind === 'i2v') {
      const frameVals = (inputs['frame'] || []).flatMap(expandItems).filter((v) => v.type === 'image')
      for (const fv of frameVals) {
        const du = await portImageDataUrl(fv)
        if (du) frameUrls.push(du)
      }
      if (frameUrls.length === 0) {
        patchNode(id, { status: 'error', error: '图生视频缺少首帧（请连接关键帧/图像）' })
        return
      }
    } else {
      if (!promptText) {
        patchNode(id, { status: 'error', error: '缺少输入（提示词）' })
        return
      }
      frameUrls.push(undefined)
    }
    const apiKey = await useProviderStore.getState().resolveKey(provider.id)
    if (!apiKey && provider.kind === 'fal') {
      patchNode(id, { status: 'error', error: '该供应商未配置 API Key' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', error: undefined, stream: '提交任务…' })
    try {
      const durationSec = Number(node.data.params?.duration ?? 5) || 5
      const total = frameUrls.length
      const items: PortValue[] = []
      for (let i = 0; i < total; i++) {
        if (!get().isRunning) break
        const { url } = await runVideo({
          cfg: provider,
          apiKey,
          req: {
            prompt: promptText || '',
            imageUrl: frameUrls[i] || undefined,
            duration: Number(node.data.params?.duration ?? 5) || undefined,
          },
          onProgress: (p) => {
            const base =
              p.status === 'queued'
                ? '排队中'
                : p.status === 'running'
                  ? `生成中${p.progress ? ` ${Math.round(p.progress * 100)}%` : ''}`
                  : p.status === 'submitting'
                    ? '提交任务'
                    : p.status
            patchNode(id, { stream: total > 1 ? `片段 ${i + 1}/${total} · ${base}…` : `${base}…` })
          },
        })
        // 远程 URL 可能有有效期：尽力下载落盘（失败不影响在线播放）
        let localPath: string | undefined
        try {
          localPath = await downloadVideoToDisk(url, `${(node.data.title || 'clip').replace(/\s+/g, '_')}_${i + 1}_${Date.now()}`)
        } catch {
          // 忽略
        }
        items.push({ type: 'video', url, mime: 'video/mp4', durationSec, localPath })
      }
      if (items.length === 0) throw new Error('未生成任何视频')
      const outId = def.outputs[0]?.id || 'out'
      const head = items[0]
      patchNode(id, {
        status: 'done',
        stream: undefined,
        outputs: { [outId]: { type: 'video', items, url: head.url, mime: 'video/mp4', durationSec, localPath: head.localPath } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 配音 TTS 节点（M5）：文本 → 后端 OpenAI 兼容 /audio/speech → 落盘音频
  if (def.category === 'audio') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const p = node.data.params || {}
    const text = (inputs['in']?.[0]?.text || String(p.text ?? '')).trim()
    if (!text) {
      patchNode(id, { status: 'error', error: '缺少配音文本（连接上游文本或在参数中填写）' })
      return
    }
    const apiKey = await getKey(`tts:${id}`)
    if (!apiKey) {
      patchNode(id, { status: 'error', error: '未配置 TTS API Key（在属性面板填写后保存）' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', stream: '合成配音…', error: undefined })
    try {
      const { path, base64, mime } = await synthSpeech(text, {
        baseURL: String(p.baseURL || 'https://api.openai.com/v1'),
        apiKey,
        model: String(p.model || 'tts-1'),
        voice: String(p.voice || 'alloy'),
        speed: Number(p.speed ?? 1) || 1,
        format: 'mp3',
      })
      const outId = def.outputs[0]?.id || 'out'
      const url = base64 ? `data:${mime};base64,${base64}` : toFileUrl(path)
      patchNode(id, {
        status: 'done',
        stream: undefined,
        outputs: { [outId]: { type: 'audio', url, localPath: path, mime } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 影片合成节点（M5）：多片段 → ffmpeg 归一+拼接，可选配音/字幕
  if (def.category === 'output' && node.data.kind === 'compose') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    // 展开扇出：一个图生视频节点可能产出 N 个片段（items），全部纳入并按顺序拼接
    const clipVals = (inputs['clips'] || []).flatMap(expandItems).filter((v) => v.type === 'video')
    if (clipVals.length === 0) {
      patchNode(id, { status: 'error', error: '缺少视频片段（连接「视频片段」端口，可连多个）' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', stream: '准备片段…', error: undefined })
    try {
      // 1) 每个片段解析为本地文件
      const clipPaths: string[] = []
      for (let i = 0; i < clipVals.length; i++) {
        if (!get().isRunning) break
        patchNode(id, { stream: `准备片段 ${i + 1}/${clipVals.length}…` })
        const lp = await resolveLocalVideo(clipVals[i], `clip_${i}`)
        if (lp) clipPaths.push(lp)
      }
      if (clipPaths.length === 0) throw new Error('无法获取任何片段的本地文件')
      // 2) 配音（可选）
      const audioVal = inputs['audio']?.[0]
      const audioPath = audioVal ? await resolveLocalAudio(audioVal) : undefined
      // 3) 字幕（可选）：从分镜 JSON 按片段时长生成 SRT
      const subModeRaw = String(node.data.params?.subtitleMode ?? '关闭')
      // 显式映射 nodeDefs 的字幕选项标签 → ffmpeg 模式；未知值降级为 off
      const subtitleMode: SubtitleMode =
        subModeRaw === '烧录字幕' ? 'burn' : subModeRaw === '软字幕' ? 'soft' : 'off'
      let srtPath: string | undefined
      const subsVal = inputs['subs']?.[0]
      if (subtitleMode !== 'off' && subsVal?.json) {
        const durations = clipVals.map((v) => ({ duration: v.durationSec ?? 5 }))
        const srt = buildSrt(durations, subsVal.json)
        if (srt) srtPath = await writeText('subtitles', `sub_${Date.now()}.srt`, srt)
      }
      // 4) 确保 ffmpeg 可用（首次按需下载）
      patchNode(id, { stream: '检查 ffmpeg…' })
      const ready = await ensureFfmpeg((info) => patchNode(id, { stream: info.text }))
      if (!ready) throw new Error('ffmpeg 不可用（自动下载失败，请检查网络）')
      // 5) 合成
      const [w, h] = parseResolution(String(node.data.params?.resolution || '1280x720'))
      const fps = Number(node.data.params?.fps ?? 24) || 24
      const totalSec = clipVals.reduce((a, v) => a + (v.durationSec ?? 5), 0)
      const outPath = await exportPath(`film_${Date.now()}.mp4`)
      if (!get().isRunning) throw new Error('已取消')
      await composeFilm({
        clips: clipPaths,
        outPath,
        width: w,
        height: h,
        fps,
        audioPath,
        srtPath,
        subtitleMode,
        totalSec,
        onProgress: (info) => patchNode(id, { stream: info.text }),
      })
      const outId = def.outputs[0]?.id || 'out'
      patchNode(id, {
        status: 'done',
        stream: undefined,
        outputs: { [outId]: { type: 'video', url: toFileUrl(outPath), localPath: outPath, mime: 'video/mp4' } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 导出节点（M5）：把上游视频另存到用户选择的位置
  if (def.category === 'output' && node.data.kind === 'export') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const v = inputs['in']?.[0]
    if (!v) {
      patchNode(id, { status: 'error', error: '缺少输入视频（连接成片/片段）' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', stream: '准备导出…', error: undefined })
    try {
      const local = await resolveLocalVideo(v, 'export')
      if (!local) throw new Error('无法获取视频文件')
      const save = await window.mulby?.dialog?.showSaveDialog?.({
        title: '导出成片',
        defaultPath: `film_${Date.now()}.mp4`,
        filters: [{ name: '视频', extensions: ['mp4'] }],
      })
      if (!save) {
        // 用户取消保存：未产出文件，复位为未运行
        patchNode(id, { status: 'idle', stream: undefined })
        return
      }
      const b64 = await window.mulby!.filesystem.readFile(local, 'base64')
      await window.mulby!.filesystem.writeFile(save, typeof b64 === 'string' ? b64 : '', 'base64')
      patchNode(id, {
        status: 'done',
        stream: undefined,
        outputs: { in: { type: 'video', url: toFileUrl(save), localPath: save, mime: 'video/mp4' } },
      })
      window.mulby?.notification?.show('已导出成片', 'success')
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }
}

// 解析端口图像为 data URL（供视频首帧使用）
async function portImageDataUrl(v?: PortValue): Promise<string> {
  if (!v) return ''
  if (v.url) return v.url
  if (v.assetId) {
    const a = await loadAsset(v.assetId)
    if (a) return toDataUrl(a.base64, a.mime)
  }
  return ''
}

interface RefImage {
  base64: string
  mime: string
  name?: string
}

// 展开端口产物：有 items（扇出）则返回全部子项，否则返回自身
function expandItems(v: PortValue): PortValue[] {
  return v.items && v.items.length ? v.items : [v]
}

// 从上游所有 image 端口收集参考图（含扇出的多张），带角色名用于一致性匹配（img2img）
async function resolveRefImages(inputs: Record<string, PortValue[]>): Promise<RefImage[]> {
  const out: RefImage[] = []
  for (const arr of Object.values(inputs)) {
    for (const v of arr) {
      for (const it of expandItems(v)) {
        if (it && it.type === 'image') {
          const dataUrl = await portImageDataUrl(it)
          if (dataUrl) {
            const { base64, mime } = fromDataUrl(dataUrl)
            if (base64) out.push({ base64, mime, name: typeof it.meta?.name === 'string' ? it.meta.name : undefined })
          }
        }
      }
    }
  }
  return out
}

// 按名称匹配参考图（关键帧用出场角色名匹配角色图）：精确优先，其次 ≥2 字子串，最后回退第一张
function pickRef(refs: RefImage[], name?: string): RefImage | null {
  if (refs.length === 0) return null
  if (name) {
    const exact = refs.find((r) => r.name === name)
    if (exact) return exact
    if (name.length >= 2) {
      const partial = refs.find((r) => r.name && r.name.length >= 2 && (r.name.includes(name) || name.includes(r.name)))
      if (partial) return partial
    }
  }
  return refs[0]
}

// 把视频端口产物解析为本机文件路径（compose/export 用）：本地优先，远程下载，data 落盘
async function resolveLocalVideo(v: PortValue, name: string): Promise<string> {
  if (v.localPath) return v.localPath
  if (v.url && v.url.startsWith('data:')) {
    const { base64 } = fromDataUrl(v.url)
    return await writeBase64('videos', `${name}_${Date.now()}`, 'mp4', base64)
  }
  if (v.url) {
    try {
      return await downloadVideoToDisk(v.url, `${name}_${Date.now()}`)
    } catch {
      return ''
    }
  }
  if (v.assetId) {
    const a = await loadAsset(v.assetId)
    if (a) return await writeBase64('videos', `${name}_${Date.now()}`, 'mp4', a.base64)
  }
  return ''
}

// 把音频端口产物解析为本机文件路径（compose 配音用）
async function resolveLocalAudio(v: PortValue): Promise<string | undefined> {
  if (v.localPath) return v.localPath
  if (v.url && v.url.startsWith('data:')) {
    const { base64 } = fromDataUrl(v.url)
    return await writeBase64('audio', `audio_${Date.now()}`, 'mp3', base64)
  }
  if (v.url && /^https?:\/\//i.test(v.url)) {
    try {
      return await downloadVideoToDisk(v.url, `audio_${Date.now()}`)
    } catch {
      return undefined
    }
  }
  if (v.assetId) {
    const a = await loadAsset(v.assetId)
    if (a) return await writeBase64('audio', `audio_${Date.now()}`, 'mp3', a.base64)
  }
  return undefined
}

const MEDIA_TYPES: PortValue['type'][] = ['image', 'video', 'audio']

// 递归剥离大体积 data URL（含扇出 items）；保留远程/本地文件链接与 assetId
function stripValue(v: PortValue): PortValue {
  let out: PortValue = v.items?.length ? { ...v, items: v.items.map(stripValue) } : v
  if (MEDIA_TYPES.includes(out.type) && out.url && out.url.startsWith('data:')) {
    const { url: _url, ...rest } = out
    out = rest
  }
  return out
}

// 序列化节点用于持久化：剥离大体积的 url/previewUrl/stream，仅保留 assetId 引用
function serializeNodes(nodes: FilmNode[]): FilmNode[] {
  return nodes.map((n) => {
    const d = n.data
    if (!d.outputs && !d.stream && !d.previewUrl) return n
    const outputs = d.outputs
      ? Object.fromEntries(Object.entries(d.outputs).map(([k, v]) => [k, stripValue(v)]))
      : d.outputs
    return { ...n, data: { ...d, outputs, stream: undefined, previewUrl: undefined } }
  })
}

// 递归补水：按 assetId 取回 base64 回填 url（含扇出 items）
async function hydrateValue(v: PortValue): Promise<PortValue> {
  let out: PortValue = v.items?.length ? { ...v, items: await Promise.all(v.items.map(hydrateValue)) } : v
  if (MEDIA_TYPES.includes(out.type) && out.assetId && !out.url) {
    const a = await loadAsset(out.assetId)
    if (a) out = { ...out, url: toDataUrl(a.base64, a.mime), mime: a.mime }
  }
  return out
}

// 加载工程后补水：回填 url 用于显示
async function hydrateAssets() {
  const get = useGraphStore.getState
  for (const n of get().nodes) {
    const outs = n.data.outputs
    if (!outs) continue
    let changed = false
    const next: Record<string, PortValue> = {}
    for (const [k, v] of Object.entries(outs)) {
      const nv = await hydrateValue(v)
      next[k] = nv
      if (nv !== v) changed = true
    }
    if (changed) patchNode(n.id, { outputs: next })
  }
}

// 递归回灌：把内嵌的 data URL 重新写入资产库，回填 assetId（含扇出 items）
async function reimportValue(v: PortValue): Promise<PortValue> {
  let out: PortValue = v.items?.length ? { ...v, items: await Promise.all(v.items.map(reimportValue)) } : v
  if ((out.type === 'image' || out.type === 'video') && out.url && out.url.startsWith('data:')) {
    const { base64, mime } = fromDataUrl(out.url)
    if (base64) {
      const assetId = await saveAsset(base64, mime)
      out = { ...out, assetId, mime }
    }
  }
  return out
}

// 导入工程时把内嵌的图片 url 重新写入资产库，回填 assetId
async function reimportAssets() {
  const get = useGraphStore.getState
  for (const n of get().nodes) {
    const outs = n.data.outputs
    if (!outs) continue
    let changed = false
    const next: Record<string, PortValue> = {}
    for (const [k, v] of Object.entries(outs)) {
      const nv = await reimportValue(v)
      next[k] = nv
      if (nv !== v) changed = true
    }
    if (changed) patchNode(n.id, { outputs: next })
  }
}

export const useGraphStore = create<GraphState>((set, get) => ({
  loaded: false,
  projects: [],
  currentId: null,
  projectName: '未命名工程',
  globals: defaultGlobals(),
  nodes: [],
  edges: [],
  selectedNodeId: null,
  dirty: false,
  saving: false,
  models: [],
  imageModels: [],
  selectedModel: null,
  selectedImageModel: null,
  modelsLoaded: false,
  isRunning: false,
  runningNodeId: null,

  // ============ 初始化：从存储加载工程 ============
  init: async () => {
    if (get().loaded) return
    let stored = (await sget<ProjectData[]>(KEY_PROJECTS)) || []
    if (!Array.isArray(stored) || stored.length === 0) {
      const def = makeDefaultProject()
      stored = [def]
      await sset(KEY_PROJECTS, stored)
      await sset(KEY_CURRENT, def.id)
    }
    let currentId = await sget<string>(KEY_CURRENT)
    let current = stored.find((p) => p.id === currentId)
    if (!current) {
      current = stored[0]
      currentId = current.id
      await sset(KEY_CURRENT, currentId)
    }
    set({
      loaded: true,
      projects: stored.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
      currentId,
      projectName: current.name,
      globals: normGlobals(current.globals),
      nodes: current.nodes || [],
      edges: current.edges || [],
      selectedNodeId: null,
      dirty: false,
    })
    void hydrateAssets()
  },

  // ============ 模型 / 运行 ============
  loadModels: async () => {
    const [models, imageModels] = await Promise.all([listTextModels(), listImageModels()])
    const storedText = await sget<string>('selectedModel')
    const prevText = storedText || get().selectedModel
    const selectedModel = prevText && models.some((m) => m.id === prevText) ? prevText : models[0]?.id ?? null
    const storedImg = await sget<string>('selectedImageModel')
    const prevImg = storedImg || get().selectedImageModel
    const selectedImageModel =
      prevImg && imageModels.some((m) => m.id === prevImg) ? prevImg : imageModels[0]?.id ?? null
    set({ models, imageModels, modelsLoaded: true, selectedModel, selectedImageModel })
  },

  setSelectedModel: (id) => {
    set({ selectedModel: id })
    void sset('selectedModel', id)
  },

  setSelectedImageModel: (id) => {
    set({ selectedImageModel: id })
    void sset('selectedImageModel', id)
  },

  setNodeImage: async (id, dataUrl) => {
    const { base64, mime } = fromDataUrl(dataUrl)
    const assetId = await saveAsset(base64, mime)
    patchNode(id, {
      status: 'done',
      error: undefined,
      outputs: { out: { type: 'image', assetId, url: toDataUrl(base64, mime), mime } },
    })
    void get().saveProject()
  },

  setNodeAudio: async (id, dataUrl) => {
    const { base64, mime } = fromDataUrl(dataUrl)
    const assetId = await saveAsset(base64, mime || 'audio/mpeg')
    patchNode(id, {
      status: 'done',
      error: undefined,
      outputs: { out: { type: 'audio', assetId, url: toDataUrl(base64, mime || 'audio/mpeg'), mime: mime || 'audio/mpeg' } },
    })
    void get().saveProject()
  },

  loadTemplate: async (templateId) => {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    if (get().dirty) await get().saveProject() // 切换前先保存当前工程，避免未保存编辑丢失
    const { nodes, edges } = instantiateTemplate(tpl)
    const proj = makeDefaultProject(tpl.name)
    proj.nodes = nodes
    proj.edges = edges
    const all = (await sget<ProjectData[]>(KEY_PROJECTS)) || []
    all.push(proj)
    await sset(KEY_PROJECTS, all)
    await sset(KEY_CURRENT, proj.id)
    set({
      projects: all.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
      currentId: proj.id,
      projectName: proj.name,
      globals: normGlobals(proj.globals),
      nodes,
      edges,
      selectedNodeId: null,
      dirty: false,
    })
    void get().saveProject()
    window.mulby?.notification?.show(`已从模板新建工程：${tpl.name}`, 'success')
  },

  downloadVideo: async (id) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const outs = node.data.outputs || {}
    const entry = Object.entries(outs).find(([, v]) => v?.type === 'video' && !!v.url)
    if (!entry) {
      window.mulby?.notification?.show('该节点没有可下载的视频', 'warning')
      return
    }
    const [port, v] = entry
    patchNode(id, { stream: '下载到本地…' })
    try {
      const localPath = await downloadVideoToDisk(
        v.url as string,
        `${(node.data.title || 'clip').replace(/\s+/g, '_')}_${Date.now()}`
      )
      const cur = get().nodes.find((n) => n.id === id)
      const cv = cur?.data.outputs?.[port]
      if (cur && cv) patchNode(id, { stream: undefined, outputs: { ...cur.data.outputs, [port]: { ...cv, localPath } } })
      window.mulby?.notification?.show('视频已保存到本地', 'success')
      void get().saveProject()
    } catch (e) {
      patchNode(id, { stream: undefined })
      window.mulby?.notification?.show(e instanceof Error ? e.message : '下载失败', 'error')
    }
  },

  runNode: async (id) => {
    if (get().isRunning) return
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const def = getNodeDef(node.data.kind)
    if (!def) return
    set({ isRunning: true })
    try {
      await execNode(id)
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
    }
  },

  runAll: async () => {
    if (get().isRunning) return
    const order = topoOrder(get().nodes, get().edges)
    set({ isRunning: true })
    const errored: string[] = []
    const skipped: string[] = []
    const failed = new Set<string>() // 出错或被跳过的节点，用于阻断下游
    try {
      for (const n of order) {
        if (!get().isRunning) break
        const def = getNodeDef(n.data.kind)
        if (!def) continue
        const eligible =
          def.category === 'input' ||
          def.category === 'text' ||
          def.category === 'image' ||
          def.category === 'video' ||
          def.category === 'audio' ||
          (def.category === 'output' && (n.data.kind === 'preview' || n.data.kind === 'compose'))
        // 注：export 节点会弹保存对话框，仅在单独运行时触发，不纳入「运行全部」
        if (!eligible) continue
        // 级联阻断：若该节点的全部上游都已失败/跳过，则不再盲跑（避免下游连环报错）
        const ups = get().edges.filter((e) => e.target === n.id).map((e) => e.source)
        if (ups.length > 0 && ups.every((s) => failed.has(s))) {
          failed.add(n.id)
          skipped.push(n.data.title || def.label)
          patchNode(n.id, { status: 'error', error: '已跳过：上游节点未成功产出', stream: undefined })
          continue
        }
        await execNode(n.id)
        const cur = get().nodes.find((x) => x.id === n.id)
        if (cur?.data.status === 'error') {
          failed.add(n.id)
          errored.push(cur.data.title || def.label)
        }
      }
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
      if (errored.length > 0 || skipped.length > 0) {
        const parts: string[] = []
        if (errored.length) parts.push(`${errored.length} 个出错`)
        if (skipped.length) parts.push(`${skipped.length} 个因上游失败跳过`)
        const names = errored.slice(0, 3).join('、')
        window.mulby?.notification?.show(
          `运行完成：${parts.join('，')}${names ? `（出错：${names}${errored.length > 3 ? ' 等' : ''}）` : ''}`,
          'warning'
        )
      }
    }
  },

  cancelRun: () => {
    abortText()
    abortImage()
    abortVideo()
    abortFfmpeg()
    const rid = get().runningNodeId
    if (rid) patchNode(rid, { status: 'idle', previewUrl: undefined, stream: undefined })
    set({ isRunning: false, runningNodeId: null })
  },

  // ============ React Flow 回调 ============
  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) })
    // 仅在结构性变更（增删/拖动结束）时落盘，避免拖拽过程频繁写入
    const structural = changes.some(
      (c) => c.type === 'add' || c.type === 'remove' || (c.type === 'position' && c.dragging === false)
    )
    if (structural) {
      set({ dirty: true })
      scheduleSave(() => get().saveProject())
    }
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) })
    if (changes.some((c) => c.type === 'add' || c.type === 'remove')) {
      set({ dirty: true })
      scheduleSave(() => get().saveProject())
    }
  },

  onConnect: (connection) => {
    if (!isValidConnection(connection, get().nodes)) return
    set({ edges: addEdge({ ...connection, type: 'default', animated: false }, get().edges), dirty: true })
    scheduleSave(() => get().saveProject())
  },

  // ============ 节点编辑 ============
  addNode: (kind, position) => {
    const def = getNodeDef(kind)
    if (!def) return
    const params: Record<string, unknown> = {}
    for (const p of def.params) {
      if (p.default !== undefined) params[p.key] = p.default
    }
    const node: FilmNode = {
      id: `n_${nanoid(6)}`,
      type: 'film',
      position,
      data: { kind, title: def.label, params, status: 'idle' },
    }
    set({ nodes: [...get().nodes, node], selectedNodeId: node.id, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  removeNode: (id) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: get().selectedNodeId === id ? null : get().selectedNodeId,
      dirty: true,
    })
    scheduleSave(() => get().saveProject())
  },

  deleteSelected: () => {
    const ids = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id))
    const sel = get().selectedNodeId
    if (sel) ids.add(sel)
    if (ids.size === 0) return
    set({
      nodes: get().nodes.filter((n) => !ids.has(n.id)),
      edges: get().edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
      selectedNodeId: null,
      dirty: true,
    })
    scheduleSave(() => get().saveProject())
  },

  updateNodeParam: (id, key, value) => {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, params: { ...n.data.params, [key]: value } } } : n
      ),
      dirty: true,
    })
    scheduleSave(() => get().saveProject())
  },

  updateNodeTitle: (id, title) => {
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n)),
      dirty: true,
    })
    scheduleSave(() => get().saveProject())
  },

  setSelected: (id) => set({ selectedNodeId: id }),

  // ============ 工程管理 ============
  newProject: async () => {
    if (get().dirty) await get().saveProject() // 切换前先保存当前工程，避免未保存编辑丢失
    const def = makeDefaultProject(`工程 ${get().projects.length + 1}`)
    const all = (await sget<ProjectData[]>(KEY_PROJECTS)) || []
    all.push(def)
    await sset(KEY_PROJECTS, all)
    await sset(KEY_CURRENT, def.id)
    set({
      projects: all.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
      currentId: def.id,
      projectName: def.name,
      globals: normGlobals(def.globals),
      nodes: def.nodes,
      edges: def.edges,
      selectedNodeId: null,
      dirty: false,
    })
  },

  saveProject: async () => {
    const { currentId, projectName, nodes, edges, globals } = get()
    if (!currentId) return
    set({ saving: true })
    const all = (await sget<ProjectData[]>(KEY_PROJECTS)) || []
    const idx = all.findIndex((p) => p.id === currentId)
    const ts = now()
    const data: ProjectData = {
      id: currentId,
      name: projectName,
      createdAt: idx >= 0 ? all[idx].createdAt : ts,
      updatedAt: ts,
      nodes: serializeNodes(nodes),
      edges,
      globals,
    }
    if (idx >= 0) all[idx] = data
    else all.push(data)
    await sset(KEY_PROJECTS, all)
    set({
      projects: all.map(({ id, name, createdAt, updatedAt }) => ({ id, name, createdAt, updatedAt })),
      dirty: false,
      saving: false,
    })
  },

  switchProject: async (id) => {
    if (id === get().currentId) return
    if (get().dirty) await get().saveProject()
    const all = (await sget<ProjectData[]>(KEY_PROJECTS)) || []
    const target = all.find((p) => p.id === id)
    if (!target) return
    await sset(KEY_CURRENT, id)
    set({
      currentId: id,
      projectName: target.name,
      globals: normGlobals(target.globals),
      nodes: target.nodes || [],
      edges: target.edges || [],
      selectedNodeId: null,
      dirty: false,
    })
    void hydrateAssets()
  },

  deleteProject: async (id) => {
    let all = (await sget<ProjectData[]>(KEY_PROJECTS)) || []
    all = all.filter((p) => p.id !== id)
    if (all.length === 0) all = [makeDefaultProject()]
    await sset(KEY_PROJECTS, all)
    const wasCurrent = get().currentId === id
    let currentId = get().currentId
    if (wasCurrent) {
      currentId = all[0].id
      await sset(KEY_CURRENT, currentId)
    }
    const current = all.find((p) => p.id === currentId) || all[0]
    set({
      projects: all.map(({ id: pid, name, createdAt, updatedAt }) => ({ id: pid, name, createdAt, updatedAt })),
      currentId: current.id,
      projectName: current.name,
      globals: wasCurrent ? normGlobals(current.globals) : get().globals,
      nodes: wasCurrent ? current.nodes || [] : get().nodes,
      edges: wasCurrent ? current.edges || [] : get().edges,
      selectedNodeId: wasCurrent ? null : get().selectedNodeId,
      dirty: false,
    })
    if (wasCurrent) void hydrateAssets()
  },

  renameProject: (name) => {
    set({ projectName: name, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  setGlobals: (patch) => {
    set({ globals: { ...get().globals, ...patch }, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  importProject: async (data) => {
    set({
      nodes: (data.nodes as FilmNode[]) || [],
      edges: (data.edges as Edge[]) || [],
      projectName: data.name || get().projectName,
      globals: normGlobals(data.globals as Partial<ProjectGlobals>),
      selectedNodeId: null,
      dirty: true,
    })
    // 导入文件内嵌的图片（url）重新落资产库，确保刷新后不丢失
    await reimportAssets()
    await get().saveProject()
  },

  exportProject: () => {
    const { currentId, projectName, nodes, edges, globals } = get()
    const ts = now()
    // 导出内嵌图片 url，保证跨设备可移植
    return { id: currentId || `proj_${nanoid(8)}`, name: projectName, createdAt: ts, updatedAt: ts, nodes, edges, globals }
  },
}))
