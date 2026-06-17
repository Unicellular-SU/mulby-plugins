import { create } from 'zustand'
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection } from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { nanoid } from 'nanoid'
import { getNodeDef, type PortType } from '../nodes/nodeDefs'
import { listTextModels, listImageModels } from '../services/models'
import { runText, abortText } from '../services/textEngine'
import { generateImage, editImage, abortImage } from '../services/imageEngine'
import { saveAsset, loadAsset, toDataUrl, fromDataUrl } from '../services/assets'
import { resolveAssetUrl, type AssetRecord } from '../services/assetRegistry'
import type { ElementRef } from './assetStore'
import { buildPrompt, buildImagePrompts, buildAssetImageJob, validateNodeJson, buildRepairPrompt } from '../services/prompts'
import { extractJson, stripCodeFences } from '../services/jsonParse'
import { topoOrder, resolveOutput, gatherInputs } from '../services/executor'
import { runVideo, abortVideo } from '../services/providers'
import { downloadVideoToDisk } from '../services/download'
import { usePromptStore } from './promptStore'
import { ensureFfmpeg, composeFilm, abortFfmpeg, parseResolution, type SubtitleMode } from '../services/ffmpeg'
import { buildSrt } from '../services/subtitles'
import { synthSpeech } from '../services/tts'
import { writeBase64, writeText, exportPath, toFileUrl } from '../services/fsutil'
import { TEMPLATES, instantiateTemplate } from '../templates'
import { useProviderStore } from './providerStore'

const PLUGIN_ID = 'ai-film-studio'
const KEY_PROJECTS = 'projects' // 旧版单键（全量 ProjectData[]）；仅用于一次性迁移读取
const KEY_INDEX = 'projects:index' // 新版：轻量索引（ProjectCard[]）
const KEY_CURRENT = 'currentProjectId'
const KEY_SNAPSHOTS = 'snapshots' // 工程命名快照（全部工程共用一个数组，按 projectId 过滤）
const projectKey = (id: string) => `project:${id}` // 新版：每工程重型图单键

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

/** 工程主页卡片：在 ProjectMeta 基础上附带节点数与封面素材引用（用于网格展示） */
export interface ProjectCard extends ProjectMeta {
  nodeCount: number
  coverAssetId?: string
}

/** 工程命名快照：某时刻整图的命名副本，可恢复 */
export interface ProjectSnapshot {
  id: string
  projectId: string
  name: string
  createdAt: number
  nodeCount: number
  nodes: FilmNode[]
  edges: Edge[]
  globals: ProjectGlobals
  promptOverrides: Record<string, string>
}

/** 取一个工程的封面素材：首个含图像产物（assetId）的节点输出 */
function pickCoverAssetId(nodes: FilmNode[]): string | undefined {
  for (const n of nodes) {
    const outs = n.data.outputs
    if (!outs) continue
    for (const v of Object.values(outs)) {
      if (v?.type === 'image') {
        if (v.assetId) return v.assetId
        const it = v.items?.find((x) => x.assetId)
        if (it?.assetId) return it.assetId
      }
    }
  }
  return undefined
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
  /** 工程级提示词覆盖（id → 模板文本）；优先级高于全局覆盖，详见 promptStore */
  promptOverrides?: Record<string, string>
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
async function srem(key: string): Promise<void> {
  try {
    await window.mulby?.storage?.remove(key, PLUGIN_ID)
  } catch {
    // 忽略
  }
}

// ===== 工程拆分存储：projects:index（轻量索引，主页/切换器读它）+ project:<id>（重型图，懒加载）=====
/** 由完整工程数据生成主页卡片（节点数 + 封面） */
function toCard(p: ProjectData): ProjectCard {
  const nodes = p.nodes || []
  return { id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, nodeCount: nodes.length, coverAssetId: pickCoverAssetId(nodes) }
}
async function sgetIndex(): Promise<ProjectCard[]> {
  const v = await sget<ProjectCard[]>(KEY_INDEX)
  return Array.isArray(v) ? v : []
}
const ssetIndex = (index: ProjectCard[]) => sset(KEY_INDEX, index)
const sgetProject = (id: string) => sget<ProjectData>(projectKey(id))
const ssetProject = (p: ProjectData) => sset(projectKey(p.id), p)
const sremProject = (id: string) => srem(projectKey(id))

/**
 * 一次性迁移：旧版单键 projects(ProjectData[]) → projects:index(ProjectCard[]) + project:<id>。
 * 幂等：projects:index 已存在则跳过；迁移成功后删除旧的全量键，避免重型数据冗余。
 */
async function migrateIfNeeded(): Promise<void> {
  const existing = await sget<ProjectCard[]>(KEY_INDEX)
  if (Array.isArray(existing)) return // 已迁移
  const old = await sget<ProjectData[]>(KEY_PROJECTS)
  if (!Array.isArray(old) || old.length === 0) return // 无旧数据
  for (const p of old) await ssetProject(p)
  await ssetIndex(old.map(toCard))
  await srem(KEY_PROJECTS)
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
  return { id, name, createdAt: ts, updatedAt: ts, nodes: [storyNode], edges: [], globals: defaultGlobals(), promptOverrides: {} }
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
  projects: ProjectCard[]
  currentId: string | null
  projectName: string
  globals: ProjectGlobals
  promptOverrides: Record<string, string>
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
  runFrom: (id: string) => Promise<void>
  runAll: () => Promise<void>
  cancelRun: () => void
  /** 对话修改某图像产物（img2img）；index 指向该端口产物的第 index 张（单值时为 0） */
  editNodeImageItem: (nodeId: string, port: string, index: number, prompt: string) => Promise<void>
  /** 重新生成某图像产物的第 index 张（用当前上游/参考图），不影响其余张 */
  regenNodeImageItem: (nodeId: string, port: string, index: number) => Promise<void>
  /** 二次编辑文本/JSON 产物；返回错误信息（null 表示成功） */
  updateNodeOutputText: (nodeId: string, port: string, text: string) => string | null
  setNodeImage: (id: string, dataUrl: string, port?: string) => Promise<void>
  setNodeAudio: (id: string, dataUrl: string) => Promise<void>
  loadTemplate: (templateId: string) => Promise<void>
  downloadVideo: (id: string) => Promise<void>
  /** 从素材库把一条素材插入画布（生成绑定的参考图/音频输入节点）；position 用于拖拽落点 */
  insertAssetNode: (rec: AssetRecord, position?: { x: number; y: number }) => Promise<void>
  /** 从 Elements 库把角色/场景插入画布（生成绑定参考图的人物/场景节点）；position 用于拖拽落点 */
  insertElementNode: (el: ElementRef, position?: { x: number; y: number }) => Promise<void>
  /** 把文本追加到当前选中节点的首个 textarea 参数；返回是否插入成功 */
  appendTextToSelected: (text: string) => boolean
  // 工程命名快照
  createSnapshot: (name: string) => Promise<void>
  listSnapshots: () => Promise<ProjectSnapshot[]>
  restoreSnapshot: (id: string) => Promise<void>
  deleteSnapshot: (id: string) => Promise<void>
  renameSnapshot: (id: string, name: string) => Promise<void>

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
  duplicateProject: (id: string) => Promise<string | null>
  renameProject: (name: string) => void
  renameProjectById: (id: string, name: string) => Promise<void>
  /** 工程主页用：返回所有工程的卡片元信息（节点数 + 封面），按更新时间倒序 */
  loadProjectCards: () => Promise<ProjectCard[]>
  /** 按 id 取整份工程数据用于导出（当前工程取内存最新，其余取存储快照） */
  exportProjectById: (id: string) => Promise<ProjectData | null>
  setGlobals: (patch: Partial<ProjectGlobals>) => void
  setPromptOverride: (id: string, value: string) => void
  resetPromptOverride: (id: string) => void
  resetAllPromptOverrides: () => void
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

// 新节点落点：按现有节点数错位排布，避免完全重叠
function spawnPos(nodes: FilmNode[]): { x: number; y: number } {
  const c = nodes.length
  return { x: 200 + (c % 8) * 36, y: 140 + (c % 8) * 36 }
}

// 局部更新某节点 data（运行期使用，不触发结构性自动保存）
function patchNode(id: string, patch: Partial<FilmNodeData>) {
  const s = useGraphStore.getState()
  useGraphStore.setState({
    nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
  })
}

// 执行单个节点（不切换全局 isRunning，由 runNode/runAll 包裹）
// opts.force：强制重新生成（人物/场景资产节点用——「运行此节点」会重画，全图重跑则复用缓存以保一致性）
async function execNode(id: string, opts?: { force?: boolean }): Promise<void> {
  const get = useGraphStore.getState
  const node = get().nodes.find((n) => n.id === id)
  if (!node) return
  const def = getNodeDef(node.data.kind)
  if (!def) return

  // 人物 / 场景资产节点：身份(JSON) + 参考图（上传 或 文字生成），可直连关键帧保持一致性
  if (node.data.kind === 'character' || node.data.kind === 'scene') {
    const p = node.data.params || {}
    const jsonOut = resolveOutput(node, 'out')
    const existingImg = node.data.outputs?.image
    const baseOut: Record<string, PortValue> = {}
    if (jsonOut) baseOut.out = jsonOut
    // 已有参考图（上传 或 已生成）且非强制重画 → 复用：全图重跑不重画（保跨镜一致），上传的图也不会被覆盖
    if (!opts?.force && existingImg?.assetId) {
      baseOut.image = existingImg
      patchNode(id, { status: 'done', error: undefined, outputs: baseOut })
      return
    }
    // 文字生成参考图（无可用文字内容则只产出 JSON 身份，保留已有图）
    const job = buildAssetImageJob(node.data, get().globals)
    if (!job) {
      if (existingImg) baseOut.image = existingImg
      patchNode(id, { status: jsonOut ? 'done' : 'idle', error: undefined, outputs: baseOut })
      return
    }
    const model = (p.imageModelOverride as string) || get().selectedImageModel
    if (!model) {
      patchNode(id, { status: 'error', error: '未配置图像模型（请在顶栏或节点选择）' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', error: undefined, previewUrl: undefined, stream: '生成中…' })
    try {
      const r = await generateImage({
        model,
        prompt: job.prompt,
        size: job.size,
        onPreview: (b64) => patchNode(id, { previewUrl: toDataUrl(b64, 'image/png') }),
      })
      const assetId = await saveAsset(r.base64, r.mime)
      const img: PortValue = {
        type: 'image',
        assetId,
        url: toDataUrl(r.base64, r.mime),
        mime: r.mime,
        meta: { ...job.meta, kind: node.data.kind },
      }
      patchNode(id, { status: 'done', previewUrl: undefined, stream: undefined, outputs: { ...baseOut, image: img } })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), previewUrl: undefined, stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 合并/收集：把多路同类产物收集为一个多项输出（纯数据节点，无 AI 调用）
  if (node.data.kind === 'merge') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const all: PortValue[] = []
    for (const arr of Object.values(inputs)) for (const v of arr) all.push(...expandItems(v))
    if (all.length === 0) {
      patchNode(id, { status: 'idle', outputs: {}, error: undefined })
      return
    }
    const head = all[0]
    patchNode(id, {
      status: 'done',
      error: undefined,
      outputs: {
        out: { type: head.type, items: all, url: head.url, mime: head.mime, assetId: head.assetId, durationSec: head.durationSec },
      },
    })
    return
  }

  // 图生图/重绘 + 高清重绘：对连入的每张原图调用 editImage（多张逐张扇出）
  if (node.data.kind === 'image-edit' || node.data.kind === 'upscale') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const model = (node.data.params?.imageModelOverride as string) || get().selectedImageModel
    if (!model) {
      patchNode(id, { status: 'error', error: '未配置图像模型（请在顶栏或节点选择）' })
      return
    }
    if (!window.mulby?.ai?.images?.edit) {
      patchNode(id, { status: 'error', error: '当前宿主不支持图像编辑（ai.images.edit）' })
      return
    }
    const mains = await refsFromValues(inputs['image'])
    if (mains.length === 0) {
      patchNode(id, { status: 'error', error: '请连接要处理的原图' })
      return
    }
    const isUpscale = node.data.kind === 'upscale'
    const extraInstr = String(node.data.params?.instruction || '').trim()
    const prompt = isUpscale
      ? `upscale and enhance this image: increase resolution, sharpen and add fine details, reduce artifacts, keep the original composition, content and style unchanged${extraInstr ? `. ${extraInstr}` : ''}`
      : (inputs['prompt']?.[0]?.text || extraInstr).trim()
    if (!prompt) {
      patchNode(id, { status: 'error', error: '请填写编辑指令（或连接「指令」文本口）' })
      return
    }
    const extras = isUpscale ? [] : (await refsFromValues(inputs['ref'])).map((x) => ({ base64: x.base64, mime: x.mime }))
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', error: undefined, previewUrl: undefined, stream: mains.length > 1 ? `处理中 1/${mains.length}…` : '处理中…' })
    try {
      const items: PortValue[] = []
      for (let i = 0; i < mains.length; i++) {
        if (!get().isRunning) break
        patchNode(id, { stream: mains.length > 1 ? `处理中 ${i + 1}/${mains.length}…` : '处理中…' })
        const m = mains[i]
        const r = await editImage({ model, prompt, refBase64: m.base64, refMime: m.mime, extraRefs: extras })
        const assetId = await saveAsset(r.base64, r.mime)
        const meta: Record<string, unknown> = {}
        if (m.name) meta.name = m.name
        if (m.kind) meta.kind = m.kind
        items.push({ type: 'image', assetId, url: toDataUrl(r.base64, r.mime), mime: r.mime, ...(Object.keys(meta).length ? { meta } : {}) })
        patchNode(id, {
          outputs: { out: { type: 'image', items: [...items], assetId: items[0].assetId, url: items[0].url, mime: items[0].mime } },
        })
      }
      if (items.length === 0) throw new Error('未生成任何图像')
      const head = items[0]
      patchNode(id, {
        status: 'done',
        stream: undefined,
        outputs: { out: { type: 'image', items, assetId: head.assetId, url: head.url, mime: head.mime } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

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
      const outId = def.outputs[0]?.id || 'out'
      const items: PortValue[] = []
      for (let i = 0; i < jobs.length; i++) {
        if (!get().isRunning) break
        const job = jobs[i]
        patchNode(id, { stream: jobs.length > 1 ? `生成中 ${i + 1}/${jobs.length}…` : '生成中…', previewUrl: undefined })
        const matched = canEdit ? selectRefs(refs, job.refNames, job.refName) : []
        let base64: string
        let mime: string
        if (matched.length) {
          const [primary, ...rest] = matched
          const r = await editImage({
            model,
            prompt: job.prompt,
            refBase64: primary.base64,
            refMime: primary.mime,
            extraRefs: rest.map((x) => ({ base64: x.base64, mime: x.mime })),
          })
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
        // 增量展示：每生成一张立即写回，属性面板画廊与节点缩略实时增长
        patchNode(id, {
          previewUrl: undefined,
          outputs: { [outId]: { type: 'image', items: [...items], assetId: items[0].assetId, url: items[0].url, mime: items[0].mime } },
        })
      }
      if (items.length === 0) throw new Error('未生成任何图像')
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
    const provider = overrideId ? ps.providers.find((p) => p.id === overrideId) || null : ps.getActiveFor('video')
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
    const tailUrls: string[] = []
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
      // 可选尾帧（首尾帧约束）：与首帧按序配对，单张则对所有片段复用
      const tailVals = (inputs['tail'] || []).flatMap(expandItems).filter((v) => v.type === 'image')
      for (const tv of tailVals) {
        const du = await portImageDataUrl(tv)
        if (du) tailUrls.push(du)
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
            lastImageUrl: tailUrls[i] || tailUrls[0] || undefined,
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

  // 配音 TTS / 配乐 BGM 节点
  if (def.category === 'audio') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const p = node.data.params || {}

    // 配乐 BGM：复用异步供应商框架（custom-http 音乐端点 / fal 音乐模型）生成音乐 → 落盘音频
    if (node.data.kind === 'bgm') {
      const ps = useProviderStore.getState()
      const overrideId = (p.providerOverride as string) || ''
      const provider = overrideId ? ps.providers.find((x) => x.id === overrideId) || null : ps.getActiveFor('music')
      if (!provider) {
        patchNode(id, { status: 'error', error: '未配置配乐供应商（顶栏「模型供应商」添加 music 能力的供应商）' })
        return
      }
      const desc = (inputs['in']?.[0]?.text || String(p.prompt ?? '')).trim()
      if (!desc) {
        patchNode(id, { status: 'error', error: '缺少配乐描述（连接上游文本或在参数中填写）' })
        return
      }
      const apiKey = await ps.resolveKey(provider.id)
      if (!apiKey && provider.kind === 'fal') {
        patchNode(id, { status: 'error', error: '该供应商未配置 API Key' })
        return
      }
      useGraphStore.setState({ runningNodeId: id })
      patchNode(id, { status: 'running', stream: '生成配乐…', error: undefined })
      try {
        const durationSec = Number(p.duration ?? 15) || 15
        const { url } = await runVideo({
          cfg: provider,
          apiKey,
          req: { prompt: desc, duration: durationSec },
          onProgress: (pr) => patchNode(id, { stream: `配乐：${pr.status}…` }),
        })
        let localPath: string | undefined
        try {
          localPath = await downloadVideoToDisk(url, `bgm_${Date.now()}`)
        } catch {
          // 下载失败仍可在线播放
        }
        patchNode(id, {
          status: 'done',
          stream: undefined,
          outputs: { out: { type: 'audio', url, localPath, mime: 'audio/mpeg', durationSec } },
        })
      } catch (e) {
        patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
      } finally {
        useGraphStore.setState({ runningNodeId: null })
      }
      return
    }

    const text = (inputs['in']?.[0]?.text || String(p.text ?? '')).trim()
    if (!text) {
      patchNode(id, { status: 'error', error: '缺少配音文本（连接上游文本或在参数中填写）' })
      return
    }
    // 语音供应商（统一在「模型供应商」面板配置，能力=tts，模式=sync-binary）
    const tps = useProviderStore.getState()
    const ttsOverride = (p.providerOverride as string) || ''
    const ttsProvider = ttsOverride ? tps.providers.find((x) => x.id === ttsOverride) || null : tps.getActiveFor('tts')
    if (!ttsProvider) {
      patchNode(id, { status: 'error', error: '未配置语音(TTS)供应商（顶栏「模型供应商」添加 OpenAI 兼容语音）' })
      return
    }
    const apiKey = await tps.resolveKey(ttsProvider.id)
    if (!apiKey) {
      patchNode(id, { status: 'error', error: '该语音供应商未配置 API Key' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', stream: '合成配音…', error: undefined })
    try {
      const { path, base64, mime } = await synthSpeech(text, {
        baseURL: String(ttsProvider.baseURL || 'https://api.openai.com/v1'),
        apiKey,
        model: String(p.model || ttsProvider.model || 'tts-1'),
        voice: String(p.voice || ttsProvider.voices?.[0] || 'alloy'),
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
  kind?: string // 'character' | 'scene'：用于关键帧参考图选择（角色按名匹配、场景全收）
}

// 展开端口产物：有 items（扇出）则返回全部子项，否则返回自身
function expandItems(v: PortValue): PortValue[] {
  return v.items && v.items.length ? v.items : [v]
}

// 从一组端口产物里取出图片（含扇出的多张），带 name/kind 用于一致性匹配（img2img）
async function refsFromValues(vals: PortValue[] | undefined): Promise<RefImage[]> {
  const out: RefImage[] = []
  for (const v of vals || []) {
    for (const it of expandItems(v)) {
      if (it && it.type === 'image') {
        const dataUrl = await portImageDataUrl(it)
        if (dataUrl) {
          const { base64, mime } = fromDataUrl(dataUrl)
          if (base64)
            out.push({
              base64,
              mime,
              name: typeof it.meta?.name === 'string' ? it.meta.name : undefined,
              kind: typeof it.meta?.kind === 'string' ? it.meta.kind : undefined,
            })
        }
      }
    }
  }
  return out
}

// 从上游所有 image 端口收集参考图（含扇出的多张）
async function resolveRefImages(inputs: Record<string, PortValue[]>): Promise<RefImage[]> {
  const out: RefImage[] = []
  for (const arr of Object.values(inputs)) out.push(...(await refsFromValues(arr)))
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

// 多参考图匹配（该镜全部出场角色 → 多张角色图，做多图一致性）：按名逐一匹配并去重
function pickRefs(refs: RefImage[], names?: string[], fallbackName?: string): RefImage[] {
  if (refs.length === 0) return []
  const wanted = (names && names.length ? names : fallbackName ? [fallbackName] : []).filter(Boolean)
  if (!wanted.length) {
    const r = pickRef(refs, fallbackName)
    return r ? [r] : []
  }
  const picked: RefImage[] = []
  for (const n of wanted) {
    const r = pickRef(refs, n)
    if (r && !picked.includes(r)) picked.push(r)
  }
  return picked.length ? picked : refs[0] ? [refs[0]] : []
}

// 关键帧参考图选择：角色图按出场角色名匹配（避免扇出时把所有角色都塞进来），场景图全收作附加参考。
// 角色排在前（primary 主参考用于强一致性），场景在后。
function selectRefs(refs: RefImage[], names?: string[], fallbackName?: string): RefImage[] {
  const scenes = refs.filter((r) => r.kind === 'scene')
  const chars = pickRefs(
    refs.filter((r) => r.kind !== 'scene'),
    names,
    fallbackName
  )
  const out: RefImage[] = []
  for (const r of [...chars, ...scenes]) if (!out.includes(r)) out.push(r)
  return out
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

// 按拓扑序执行一批节点（runAll / runFrom 共用）。数据驱动级联阻断：上游无可用产出才跳过。
async function runOrder(order: FilmNode[]): Promise<{ errored: string[]; skipped: string[] }> {
  const errored: string[] = []
  const skipped: string[] = []
  for (const n of order) {
    if (!useGraphStore.getState().isRunning) break
    const def = getNodeDef(n.data.kind)
    if (!def) continue
    const eligible =
      def.category === 'input' ||
      def.category === 'text' ||
      def.category === 'image' ||
      def.category === 'video' ||
      def.category === 'audio' ||
      (def.category === 'output' && (n.data.kind === 'preview' || n.data.kind === 'compose' || n.data.kind === 'merge'))
    // export 节点会弹保存对话框，仅单独运行时触发，不纳入批量
    if (!eligible) continue
    const st = useGraphStore.getState()
    const hasIncoming = st.edges.some((e) => e.target === n.id)
    if (hasIncoming) {
      const ins = gatherInputs(n, st.nodes, st.edges)
      const hasData = Object.values(ins).some((arr) => arr && arr.length > 0)
      if (!hasData) {
        skipped.push(n.data.title || def.label)
        patchNode(n.id, { status: 'error', error: '已跳过：上游未产出可用输入' })
        continue
      }
    }
    await execNode(n.id)
    const cur = useGraphStore.getState().nodes.find((x) => x.id === n.id)
    if (cur?.data.status === 'error') errored.push(cur.data.title || def.label)
  }
  return { errored, skipped }
}

function notifyRunResult(errored: string[], skipped: string[]) {
  if (errored.length === 0 && skipped.length === 0) return
  const parts: string[] = []
  if (errored.length) parts.push(`${errored.length} 个出错`)
  if (skipped.length) parts.push(`${skipped.length} 个因上游失败跳过`)
  const names = errored.slice(0, 3).join('、')
  window.mulby?.notification?.show(
    `运行完成：${parts.join('，')}${names ? `（出错：${names}${errored.length > 3 ? ' 等' : ''}）` : ''}`,
    'warning'
  )
}

// 把当前工程的提示词覆盖同步给 promptStore（供 prompts.ts 执行时按「工程 > 全局 > 默认」解析）
function syncProjectPromptLayer(overrides?: Record<string, string>) {
  usePromptStore.getState().setProjectLayer(overrides || {})
}

export const useGraphStore = create<GraphState>((set, get) => ({
  loaded: false,
  projects: [],
  currentId: null,
  projectName: '未命名工程',
  globals: defaultGlobals(),
  promptOverrides: {},
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
    await migrateIfNeeded() // 旧版单键 → 拆分存储（幂等）
    let index = await sgetIndex()
    if (index.length === 0) {
      const def = makeDefaultProject()
      await ssetProject(def)
      index = [toCard(def)]
      await ssetIndex(index)
      await sset(KEY_CURRENT, def.id)
    }
    let currentId = await sget<string>(KEY_CURRENT)
    let current = currentId ? await sgetProject(currentId) : null
    if (!current) {
      currentId = index[0].id
      current = await sgetProject(currentId)
      await sset(KEY_CURRENT, currentId)
    }
    // 索引存在但对应工程数据缺失（极端：被外部清空）→ 兜底重建默认工程
    if (!current) {
      const def = makeDefaultProject()
      await ssetProject(def)
      index = [toCard(def)]
      await ssetIndex(index)
      currentId = def.id
      await sset(KEY_CURRENT, currentId)
      current = def
    }
    set({
      loaded: true,
      projects: index,
      currentId,
      projectName: current.name,
      globals: normGlobals(current.globals),
      promptOverrides: current.promptOverrides || {},
      nodes: current.nodes || [],
      edges: current.edges || [],
      selectedNodeId: null,
      dirty: false,
    })
    syncProjectPromptLayer(current.promptOverrides)
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

  setNodeImage: async (id, dataUrl, port = 'out') => {
    const { base64, mime } = fromDataUrl(dataUrl)
    const assetId = await saveAsset(base64, mime)
    const node = get().nodes.find((n) => n.id === id)
    // 人物/场景上传的参考图带上角色/场景名 + kind，供关键帧按名匹配 / 场景全收（一致性）
    const name = node?.data.params?.name ? String(node.data.params.name) : ''
    const kind = node?.data.kind === 'character' || node?.data.kind === 'scene' ? node.data.kind : undefined
    const meta = name || kind ? { ...(name ? { name } : {}), ...(kind ? { kind } : {}) } : undefined
    const img: PortValue = { type: 'image', assetId, url: toDataUrl(base64, mime), mime, ...(meta ? { meta } : {}) }
    const prev = node?.data.outputs || {}
    patchNode(id, { status: 'done', error: undefined, outputs: { ...prev, [port]: img } })
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

  editNodeImageItem: async (nodeId, port, index, prompt) => {
    if (get().isRunning || !prompt.trim()) return
    const node = get().nodes.find((n) => n.id === nodeId)
    const val = node?.data.outputs?.[port]
    if (!node || !val) return
    const hasItems = !!(val.items && val.items.length)
    const target = (hasItems ? (val.items as PortValue[]) : [val])[index]
    if (!target) return
    // 取目标图的纯 base64（优先资产库，其次 data URL）
    let base64 = ''
    let mime = target.mime || 'image/png'
    if (target.assetId) {
      const a = await loadAsset(target.assetId)
      if (a) {
        base64 = a.base64
        mime = a.mime
      }
    }
    if (!base64 && target.url) {
      const d = fromDataUrl(target.url)
      base64 = d.base64
      mime = d.mime || mime
    }
    if (!base64) {
      window.mulby?.notification?.show('无法读取原图', 'error')
      return
    }
    const model = (node.data.params?.imageModelOverride as string) || get().selectedImageModel
    if (!model) {
      window.mulby?.notification?.show('未配置图像模型（在顶栏选择）', 'error')
      return
    }
    set({ isRunning: true })
    useGraphStore.setState({ runningNodeId: nodeId })
    patchNode(nodeId, { status: 'running', stream: '按描述修改图像…', error: undefined })
    try {
      const r = await editImage({ model, prompt, refBase64: base64, refMime: mime })
      const newAssetId = await saveAsset(r.base64, r.mime)
      const newItem: PortValue = { ...target, assetId: newAssetId, url: toDataUrl(r.base64, r.mime), mime: r.mime }
      const cur = get().nodes.find((n) => n.id === nodeId)
      const cval = cur?.data.outputs?.[port]
      if (cur && cval) {
        let nextVal: PortValue
        if (hasItems && cval.items) {
          const newItems = cval.items.map((it, i) => (i === index ? newItem : it))
          const head = newItems[0]
          nextVal = { ...cval, items: newItems, assetId: head.assetId, url: head.url, mime: head.mime }
        } else {
          nextVal = newItem
        }
        patchNode(nodeId, { status: 'done', stream: undefined, outputs: { ...cur.data.outputs, [port]: nextVal } })
      }
      window.mulby?.notification?.show('图像已按描述修改')
    } catch (e) {
      patchNode(nodeId, { status: 'done', stream: undefined })
      window.mulby?.notification?.show(e instanceof Error ? e.message : '修改失败', 'error')
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
    }
  },

  regenNodeImageItem: async (nodeId, port, index) => {
    if (get().isRunning) return
    const node = get().nodes.find((n) => n.id === nodeId)
    const def = node ? getNodeDef(node.data.kind) : null
    if (!node || !def || def.category !== 'image') return
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const jobs = buildImagePrompts(node.data, inputs, get().globals)
    const job = jobs[index]
    if (!job) {
      window.mulby?.notification?.show('该位置无对应上游输入，无法重新生成', 'warning')
      return
    }
    const model = (node.data.params?.imageModelOverride as string) || get().selectedImageModel
    if (!model) {
      window.mulby?.notification?.show('未配置图像模型（在顶栏选择）', 'error')
      return
    }
    const refs = await resolveRefImages(inputs)
    const canEdit = refs.length > 0 && !!window.mulby?.ai?.images?.edit
    set({ isRunning: true })
    useGraphStore.setState({ runningNodeId: nodeId })
    patchNode(nodeId, { status: 'running', stream: `重新生成第 ${index + 1} 张…`, error: undefined })
    try {
      const matched = canEdit ? selectRefs(refs, job.refNames, job.refName) : []
      let base64: string
      let mime: string
      if (matched.length) {
        const [primary, ...rest] = matched
        const r = await editImage({
          model,
          prompt: job.prompt,
          refBase64: primary.base64,
          refMime: primary.mime,
          extraRefs: rest.map((x) => ({ base64: x.base64, mime: x.mime })),
        })
        base64 = r.base64
        mime = r.mime
      } else {
        const r = await generateImage({ model, prompt: job.prompt, size: job.size })
        base64 = r.base64
        mime = r.mime
      }
      const assetId = await saveAsset(base64, mime)
      const newItem: PortValue = { type: 'image', assetId, url: toDataUrl(base64, mime), mime, meta: job.meta }
      const cur = get().nodes.find((n) => n.id === nodeId)
      const cval = cur?.data.outputs?.[port]
      if (cur && cval) {
        let nextVal: PortValue
        if (cval.items && cval.items.length) {
          const newItems = cval.items.map((it, i) => (i === index ? newItem : it))
          const head = newItems[0]
          nextVal = { ...cval, items: newItems, assetId: head.assetId, url: head.url, mime: head.mime }
        } else {
          nextVal = newItem
        }
        patchNode(nodeId, { status: 'done', stream: undefined, outputs: { ...cur.data.outputs, [port]: nextVal } })
      }
      window.mulby?.notification?.show('已重新生成该张')
    } catch (e) {
      patchNode(nodeId, { status: 'done', stream: undefined })
      window.mulby?.notification?.show(e instanceof Error ? e.message : '重新生成失败', 'error')
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
    }
  },

  updateNodeOutputText: (nodeId, port, text) => {
    const node = get().nodes.find((n) => n.id === nodeId)
    const val = node?.data.outputs?.[port]
    if (!node || !val) return '无可编辑的产物'
    let nextVal: PortValue
    if (val.type === 'json') {
      const json = extractJson(text)
      if (json == null) return 'JSON 解析失败，请检查格式（需为合法 JSON）'
      nextVal = { ...val, json, text }
    } else {
      nextVal = { ...val, text }
    }
    patchNode(nodeId, { outputs: { ...node.data.outputs, [port]: nextVal }, error: undefined })
    void get().saveProject()
    return null
  },

  loadTemplate: async (templateId) => {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    if (get().dirty) await get().saveProject() // 切换前先保存当前工程，避免未保存编辑丢失
    const { nodes, edges } = instantiateTemplate(tpl)
    const proj = makeDefaultProject(tpl.name)
    proj.nodes = nodes
    proj.edges = edges
    await ssetProject(proj)
    const index = await sgetIndex()
    index.push(toCard(proj))
    await ssetIndex(index)
    await sset(KEY_CURRENT, proj.id)
    set({
      projects: index,
      currentId: proj.id,
      projectName: proj.name,
      globals: normGlobals(proj.globals),
      promptOverrides: proj.promptOverrides || {},
      nodes,
      edges,
      selectedNodeId: null,
      dirty: false,
    })
    syncProjectPromptLayer(proj.promptOverrides)
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

  insertAssetNode: async (rec, position) => {
    if (rec.type === 'video') {
      window.mulby?.notification?.show('视频素材暂不支持插入画布（可在素材库预览/导出）', 'warning')
      return
    }
    const kind = rec.type === 'audio' ? 'audio-input' : 'image-input'
    const def = getNodeDef(kind)
    if (!def) return
    const url = await resolveAssetUrl(rec)
    const out: PortValue =
      rec.type === 'audio'
        ? { type: 'audio', assetId: rec.assetId, url, localPath: rec.localPath, mime: rec.mime }
        : { type: 'image', assetId: rec.assetId, url, mime: rec.mime }
    const node: FilmNode = {
      id: `n_${nanoid(6)}`,
      type: 'film',
      position: position ?? spawnPos(get().nodes),
      data: { kind, title: rec.name || def.label, params: {}, status: 'done', outputs: { out } },
    }
    set({ nodes: [...get().nodes, node], selectedNodeId: node.id, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  insertElementNode: async (el, position) => {
    const kind = el.kind // 'character' | 'scene'
    const def = getNodeDef(kind)
    if (!def) return
    const params: Record<string, unknown> =
      kind === 'character'
        ? { name: el.name, appearance: el.description || '', refPrompt: el.prompt || '' }
        : { name: el.name, description: el.description || '', refPrompt: el.prompt || '' }
    const data: FilmNodeData = { kind, title: el.name || def.label, params, status: 'idle' }
    const firstRef = el.refAssetIds?.[0]
    if (firstRef) {
      const a = await loadAsset(firstRef)
      if (a) {
        // 绑定参考图（带 name/kind meta，供关键帧按名匹配 / 场景全收，跨镜一致）
        data.outputs = { image: { type: 'image', assetId: firstRef, url: toDataUrl(a.base64, a.mime), mime: a.mime, meta: { name: el.name, kind } } }
        data.status = 'done'
      }
    }
    const node: FilmNode = { id: `n_${nanoid(6)}`, type: 'film', position: position ?? spawnPos(get().nodes), data }
    set({ nodes: [...get().nodes, node], selectedNodeId: node.id, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  appendTextToSelected: (text) => {
    const id = get().selectedNodeId
    if (!id) return false
    const node = get().nodes.find((n) => n.id === id)
    const def = node ? getNodeDef(node.data.kind) : null
    if (!node || !def) return false
    const target = def.params.find((p) => p.control === 'textarea')?.key
    if (!target) return false
    const cur = String(node.data.params[target] ?? '')
    get().updateNodeParam(id, target, cur ? `${cur}\n${text}` : text)
    return true
  },

  createSnapshot: async (name) => {
    const { currentId, nodes, edges, globals, promptOverrides } = get()
    if (!currentId) return
    const all = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    all.push({
      id: `snap_${nanoid(8)}`,
      projectId: currentId,
      name: name.trim() || new Date().toLocaleString(),
      createdAt: now(),
      nodeCount: nodes.length,
      nodes: serializeNodes(nodes),
      edges,
      globals,
      promptOverrides,
    })
    await sset(KEY_SNAPSHOTS, all)
  },
  listSnapshots: async () => {
    const all = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    return all.filter((s) => s.projectId === get().currentId).sort((a, b) => b.createdAt - a.createdAt)
  },
  restoreSnapshot: async (id) => {
    const all = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    const snap = all.find((s) => s.id === id)
    if (!snap) return
    set({
      nodes: snap.nodes || [],
      edges: snap.edges || [],
      globals: normGlobals(snap.globals),
      promptOverrides: snap.promptOverrides || {},
      selectedNodeId: null,
      dirty: true,
    })
    syncProjectPromptLayer(snap.promptOverrides)
    await hydrateAssets()
    await get().saveProject()
  },
  deleteSnapshot: async (id) => {
    const all = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    await sset(
      KEY_SNAPSHOTS,
      all.filter((s) => s.id !== id)
    )
  },
  renameSnapshot: async (id, name) => {
    const all = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    const i = all.findIndex((s) => s.id === id)
    if (i < 0) return
    all[i] = { ...all[i], name: name.trim() || all[i].name }
    await sset(KEY_SNAPSHOTS, all)
  },

  runNode: async (id) => {
    if (get().isRunning) return
    const node = get().nodes.find((n) => n.id === id)
    if (!node) return
    const def = getNodeDef(node.data.kind)
    if (!def) return
    set({ isRunning: true })
    try {
      await execNode(id, { force: true })
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
    }
  },

  runAll: async () => {
    if (get().isRunning) return
    const order = topoOrder(get().nodes, get().edges)
    set({ isRunning: true })
    try {
      const r = await runOrder(order)
      notifyRunResult(r.errored, r.skipped)
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
    }
  },

  runFrom: async (id) => {
    if (get().isRunning) return
    // 收集 id 及其所有下游后代，仅执行这部分；上游不重跑，其已有产物经 gatherInputs 注入
    const edges = get().edges
    const targets = new Set<string>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const e of edges) {
        if (targets.has(e.source) && !targets.has(e.target)) {
          targets.add(e.target)
          grew = true
        }
      }
    }
    const order = topoOrder(get().nodes, get().edges).filter((n) => targets.has(n.id))
    set({ isRunning: true })
    try {
      const r = await runOrder(order)
      notifyRunResult(r.errored, r.skipped)
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void get().saveProject()
    }
  },

  cancelRun: () => {
    // 中止所有引擎：文本 / 图像 / 视频 / ffmpeg 合成
    abortText()
    abortImage()
    abortVideo()
    abortFfmpeg()
    // 复位所有正在执行/排队的节点（扇出/批量时可能不止一个），并停止 runAll/runFrom 循环
    for (const n of get().nodes) {
      if (n.data.status === 'running' || n.data.status === 'queued') {
        patchNode(n.id, { status: 'idle', previewUrl: undefined, stream: undefined })
      }
    }
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
    await ssetProject(def)
    const index = await sgetIndex()
    index.push(toCard(def))
    await ssetIndex(index)
    await sset(KEY_CURRENT, def.id)
    set({
      projects: index,
      currentId: def.id,
      projectName: def.name,
      globals: normGlobals(def.globals),
      promptOverrides: def.promptOverrides || {},
      nodes: def.nodes,
      edges: def.edges,
      selectedNodeId: null,
      dirty: false,
    })
    syncProjectPromptLayer(def.promptOverrides)
  },

  saveProject: async () => {
    const { currentId, projectName, nodes, edges, globals, promptOverrides } = get()
    if (!currentId) return
    set({ saving: true })
    const existing = await sgetProject(currentId)
    const ts = now()
    const data: ProjectData = {
      id: currentId,
      name: projectName,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
      nodes: serializeNodes(nodes),
      edges,
      globals,
      promptOverrides,
    }
    await ssetProject(data) // 只写当前工程单键，根除旧版「整数组读改写」的并发覆盖
    // 同步更新轻量索引项（节点数/封面/名称/时间）
    const index = await sgetIndex()
    const card = toCard(data)
    const idx = index.findIndex((p) => p.id === currentId)
    if (idx >= 0) index[idx] = card
    else index.push(card)
    await ssetIndex(index)
    set({ projects: index, dirty: false, saving: false })
  },

  switchProject: async (id) => {
    if (id === get().currentId) return
    if (get().dirty) await get().saveProject()
    const target = await sgetProject(id)
    if (!target) return
    await sset(KEY_CURRENT, id)
    set({
      currentId: id,
      projectName: target.name,
      globals: normGlobals(target.globals),
      promptOverrides: target.promptOverrides || {},
      nodes: target.nodes || [],
      edges: target.edges || [],
      selectedNodeId: null,
      dirty: false,
    })
    syncProjectPromptLayer(target.promptOverrides)
    void hydrateAssets()
  },

  deleteProject: async (id) => {
    let index = (await sgetIndex()).filter((p) => p.id !== id)
    await sremProject(id) // 删除该工程的重型图键
    // 清掉该工程的命名快照，避免快照长期 pin 住孤儿素材
    const snaps = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    if (snaps.some((s) => s.projectId === id)) await sset(KEY_SNAPSHOTS, snaps.filter((s) => s.projectId !== id))
    const wasCurrent = get().currentId === id
    let currentId = get().currentId
    let current: ProjectData | null = null
    if (index.length === 0) {
      // 删光了：建一个默认工程兜底
      const def = makeDefaultProject()
      await ssetProject(def)
      index = [toCard(def)]
      current = def
      currentId = def.id
      await sset(KEY_CURRENT, currentId)
    }
    await ssetIndex(index)
    if (wasCurrent && !current) {
      currentId = index[0].id
      await sset(KEY_CURRENT, currentId)
      current = await sgetProject(currentId)
    }
    if (wasCurrent) {
      set({
        projects: index,
        currentId,
        projectName: current?.name ?? '未命名工程',
        globals: normGlobals(current?.globals),
        promptOverrides: current?.promptOverrides || {},
        nodes: current?.nodes || [],
        edges: current?.edges || [],
        selectedNodeId: null,
        dirty: false,
      })
      syncProjectPromptLayer(current?.promptOverrides)
      void hydrateAssets()
    } else {
      set({ projects: index })
    }
  },

  renameProject: (name) => {
    set({ projectName: name, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  renameProjectById: async (id, name) => {
    if (id === get().currentId) {
      get().renameProject(name)
      return
    }
    const data = await sgetProject(id)
    if (!data) return
    const ts = now()
    await ssetProject({ ...data, name, updatedAt: ts })
    const index = await sgetIndex()
    const idx = index.findIndex((p) => p.id === id)
    if (idx >= 0) index[idx] = { ...index[idx], name, updatedAt: ts }
    await ssetIndex(index)
    set({ projects: index })
  },

  duplicateProject: async (id) => {
    if (id === get().currentId && get().dirty) await get().saveProject()
    const src = await sgetProject(id)
    if (!src) return null
    const ts = now()
    // 复制共享同一批 assetId（附件按 id 共享，无需复制二进制）；新 id/名称/时间
    const copy: ProjectData = { ...src, id: `proj_${nanoid(8)}`, name: `${src.name} 副本`, createdAt: ts, updatedAt: ts }
    await ssetProject(copy)
    const index = await sgetIndex()
    index.push(toCard(copy))
    await ssetIndex(index)
    set({ projects: index })
    return copy.id
  },

  loadProjectCards: async () => {
    // 只读轻量索引，主页秒开（不再加载所有工程的重型图）
    const index = await sgetIndex()
    const curId = get().currentId
    const curNodes = get().nodes
    const curName = get().projectName
    return index
      .map((c) =>
        // 当前工程的卡片用内存最新（节点数/封面/名称可能尚未落盘）覆盖
        c.id === curId
          ? { ...c, name: curName, nodeCount: curNodes.length, coverAssetId: pickCoverAssetId(curNodes) ?? c.coverAssetId }
          : c
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
  },

  exportProjectById: async (id) => {
    if (id === get().currentId) return get().exportProject()
    return await sgetProject(id)
  },

  setGlobals: (patch) => {
    set({ globals: { ...get().globals, ...patch }, dirty: true })
    scheduleSave(() => get().saveProject())
  },

  setPromptOverride: (id, value) => {
    const next = { ...get().promptOverrides, [id]: value }
    set({ promptOverrides: next, dirty: true })
    syncProjectPromptLayer(next)
    scheduleSave(() => get().saveProject())
  },
  resetPromptOverride: (id) => {
    const next = { ...get().promptOverrides }
    delete next[id]
    set({ promptOverrides: next, dirty: true })
    syncProjectPromptLayer(next)
    scheduleSave(() => get().saveProject())
  },
  resetAllPromptOverrides: () => {
    set({ promptOverrides: {}, dirty: true })
    syncProjectPromptLayer({})
    scheduleSave(() => get().saveProject())
  },

  importProject: async (data) => {
    const imported = (data.promptOverrides as Record<string, string>) || {}
    set({
      nodes: (data.nodes as FilmNode[]) || [],
      edges: (data.edges as Edge[]) || [],
      projectName: data.name || get().projectName,
      globals: normGlobals(data.globals as Partial<ProjectGlobals>),
      promptOverrides: imported,
      selectedNodeId: null,
      dirty: true,
    })
    syncProjectPromptLayer(imported)
    // 导入文件内嵌的图片（url）重新落资产库，确保刷新后不丢失
    await reimportAssets()
    await get().saveProject()
  },

  exportProject: () => {
    const { currentId, projectName, nodes, edges, globals, promptOverrides } = get()
    const ts = now()
    // 导出内嵌图片 url，保证跨设备可移植
    return { id: currentId || `proj_${nanoid(8)}`, name: projectName, createdAt: ts, updatedAt: ts, nodes, edges, globals, promptOverrides }
  },
}))
