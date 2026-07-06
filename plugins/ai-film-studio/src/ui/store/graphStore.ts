import { create } from 'zustand'
import type { Node, Edge, OnNodesChange, OnEdgesChange, OnConnect, Connection } from '@xyflow/react'
import { applyNodeChanges, applyEdgeChanges, addEdge } from '@xyflow/react'
import { nanoid } from 'nanoid'
import { getNodeDef, type PortType } from '../nodes/nodeDefs'
import { listTextModels, listImageModels } from '../services/models'
import { runText, abortText } from '../services/textEngine'
import { generateImage, editImage, abortImage } from '../services/imageEngine'
import { saveAsset, loadAsset, loadAssetUrl, toDataUrl, fromDataUrl, isEphemeralUrl } from '../services/assets'
import { resolveAssetUrl, type AssetRecord } from '../services/assetRegistry'
import type { ElementRef } from './assetStore'
import { buildPrompt, buildImagePrompts, buildAssetImageJob, buildCharViewSets, validateNodeJson, buildRepairPrompt, shotCameraMotion, buildAudioPrompt, checkAxisContinuity, scaleSpec } from '../services/prompts'
import { videoStyleTag } from '../services/stylePacks'
import { useAssetStore } from './assetStore'
import { extractJson, stripCodeFences } from '../services/jsonParse'
import { topoOrder, resolveOutput, gatherInputs, computeInputHash } from '../services/executor'
import { runVideo, abortVideo } from '../services/providers'
import { downloadVideoToDisk } from '../services/download'
import { usePromptStore, getPrompt } from './promptStore'
import { ensureFfmpeg, ffmpegAvailable, probeDuration, composeFilm, abortFfmpeg, extractLastFrame, parseResolution, clampTransitionDur, type SubtitleMode, type AudioTrack, type FilmTransition } from '../services/ffmpeg'
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

// M30：扇出逐项状态（图像/视频每帧/每段独立可见、可单独重试）。运行态，不持久化。
export type GenItemStatus = 'pending' | 'running' | 'done' | 'failed'
export interface GenItem {
  idx: number // 扇出下标
  key?: string // 业务标识：镜头号/变体·视角/角色名——瓦片标注 + 失败定位
  status: GenItemStatus
  error?: string
  ref?: PortValue // done：成功产物（经 useMediaUrl 解析缩略，与 outputs 成功项对应）
  mediaType?: 'image' | 'video'
}

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
  locked?: boolean // P1-6：锁定节点 runAll/runFrom 不重跑，只读旧 outputs（满意的镜头不被覆盖）
  cache?: { inputHash: string; at: number } // P1-6：上次成功运行的输入指纹，命中即跳过（不重复烧）
  gen?: { total: number; items?: GenItem[] } // 扇出实时进度 + 逐项状态（M30，不持久化）；items[i] 与扇出第 i 项对齐
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
  aspectRatio?: string
  style?: string
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
  stylePackId?: string // M21：结构化风格包 id（注入色盘/光影/锚定/负向词）；自由 style 可叠加其后
  concurrency?: number // 单节点扇出（关键帧/角色图/视频…）的并发上限，默认 3；过大易触发供应商限流
  dialogueLang?: string // 对白语言：剧本/分镜台词 + 原生音频/配音都按此语言（默认中文），杜绝默认说英文
  filmScale?: string // 成片体量：微短片/短片/单集/长片——一处设定，协调大纲节拍数+剧本场数+分镜镜头数（默认短片）
}

export function defaultGlobals(): ProjectGlobals {
  return { aspectRatio: '16:9', style: '', concurrency: 3, dialogueLang: '中文', filmScale: '短片' }
}

// 向后兼容：旧工程可能无 globals 或字段不全，统一补全为完整结构
function normGlobals(g?: Partial<ProjectGlobals>): ProjectGlobals {
  return { ...defaultGlobals(), ...(g || {}) }
}

/** 扇出并发上限：取全局设定（1~8），缺省 3 */
function fanoutConcurrency(): number {
  const c = Number(useGraphStore.getState().globals.concurrency ?? 3)
  return Math.max(1, Math.min(8, Number.isFinite(c) && c > 0 ? Math.floor(c) : 3))
}

/**
 * 有界并发 map：对 items 用至多 limit 个并发执行 fn，结果按 index 保序回填（失败项为 undefined，
 * 不打断其余——部分成功）。shouldStop 返回 true 时不再启动新任务（用于取消）。
 */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  opts?: {
    onSettled?: (index: number, result: R) => void
    onError?: (index: number, err: unknown) => void
    shouldStop?: () => boolean
    retries?: number // 失败后重试次数（默认 0）；用于扛供应商限流/瞬时错误，杜绝静默丢帧/丢片
    retryDelayMs?: number // 重试基础退避（线性递增），默认 1500ms
  }
): Promise<(R | undefined)[]> {
  const results = new Array<R | undefined>(items.length)
  const retries = Math.max(0, opts?.retries ?? 0)
  const retryDelay = opts?.retryDelayMs ?? 1500
  let next = 0
  const worker = async () => {
    for (;;) {
      if (opts?.shouldStop?.()) return
      const i = next++
      if (i >= items.length) return
      let lastErr: unknown
      let ok = false
      for (let attempt = 0; attempt <= retries; attempt++) {
        if (opts?.shouldStop?.()) return
        try {
          const r = await fn(items[i], i)
          results[i] = r
          opts?.onSettled?.(i, r)
          ok = true
          break
        } catch (e) {
          lastErr = e
          if (attempt < retries) await new Promise((res) => setTimeout(res, retryDelay * (attempt + 1))) // 线性退避
        }
      }
      if (!ok) opts?.onError?.(i, lastErr)
    }
  }
  const w = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: w }, () => worker()))
  return results
}

/**
 * 边等 promise 边监测停止：promise 先就绪则取其值；运行被停止（stopped()）则解析为 null。
 * 用于链式生成（关键帧/片段接龙）里「等上一项产物」的等待——避免上一项因停止而未解链时，
 * 后续项的 await 永久挂起，拖死整跑。promise 与停止任一先到都会清掉轮询定时器。
 */
function awaitOrStop<T>(p: Promise<T>, stopped: () => boolean): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false
    const t = setInterval(() => {
      if (done) return
      if (stopped()) {
        done = true
        clearInterval(t)
        resolve(null)
      }
    }, 200)
    p.then(
      (v) => {
        if (done) return
        done = true
        clearInterval(t)
        resolve(v)
      },
      () => {
        if (done) return
        done = true
        clearInterval(t)
        resolve(null)
      }
    )
  })
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
  const g = normGlobals(p.globals)
  return {
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    nodeCount: nodes.length,
    coverAssetId: pickCoverAssetId(nodes),
    aspectRatio: g.aspectRatio,
    style: g.style,
  }
}
async function sgetIndex(): Promise<ProjectCard[]> {
  const v = await sget<ProjectCard[]>(KEY_INDEX)
  return Array.isArray(v) ? v : []
}
const ssetIndex = (index: ProjectCard[]) => sset(KEY_INDEX, index)
const sgetProject = (id: string) => sget<ProjectData>(projectKey(id))
/** 写工程重型键：返回是否成功（供 saveProject 据此判断成败，不再静默吞失败） */
async function ssetProject(p: ProjectData): Promise<boolean> {
  try {
    const ok = await window.mulby?.storage?.set(projectKey(p.id), p, PLUGIN_ID)
    return ok !== false
  } catch {
    return false
  }
}
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

// ===== 索引并发安全（主线 A）=====
// 根因：projects:index 是多处未串行化的「读-改-写」，且任何一次瞬时读失败被折叠成 []，
// 紧接着的写就清空整张索引、孤立所有 project:<id>。下面用「渲染器内 FIFO 互斥锁 + 索引读
// fail-fast + shrink-guard + 从存活工程重建自愈 + CAS 二次防御」根治之。
// 正确性建立在单渲染器现实上（manifest pluginSetting.single=true）；CAS 仅是对罕见外部写者
// （主程序 Plugin Storage Explorer）的廉价二次防御，不 gate 正确性。

/** 索引值损坏（存在但非数组）：触发从存活工程重建，绝不当成空数组 */
class IndexCorruptError extends Error {}
/** 索引写入在多次 CAS 重试后仍失败：绝不用陈旧/空数据覆盖内存 projects */
class IndexWriteError extends Error {}

const MAX_CAS_RETRIES = 5
// 缓存的版本/快照「永不跨读信任」：仅用于 shrink-guard 基线与首次 CAS 的 expectedVersion 种子。
// mutateIndex 总是在锁内经 readIndexMeta 重读后再应用 mutator——禁止加「跳过锁内重读的快路径」。
let indexVersion: number | null = null
let lastGoodIndex: ProjectCard[] | null = null
let indexChain: Promise<unknown> = Promise.resolve()
let hasCasCache: boolean | null = null

function hasCas(): boolean {
  if (hasCasCache === null) {
    const s = window.mulby?.storage
    hasCasCache = typeof s?.setWithVersion === 'function' && typeof s?.getMeta === 'function'
  }
  return hasCasCache
}

/** FIFO 异步互斥锁：无论前一个成功/失败都执行下一个；链用吞错 then 保活，一次失败不毒化队列 */
function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexChain.then(fn, fn)
  indexChain = run.then(
    () => {},
    () => {}
  )
  return run as Promise<T>
}

/**
 * 读索引 + 版本（fail-fast）：传输错误**抛异常**（调用方自愈/重试）；不存在→{[],null}（全新安装）；
 * 存在但非数组→抛 IndexCorruptError（去重建，**绝不**当成 []）。这与容错的 sgetIndex 不同——
 * 把「瞬时错误→[]→破坏性覆盖」这一根因在源头掐断。
 */
async function readIndexMeta(): Promise<{ index: ProjectCard[]; version: number | null }> {
  const s = window.mulby?.storage
  if (s?.getMeta) {
    const meta = await s.getMeta(KEY_INDEX)
    if (!meta || meta.found === false) return { index: [], version: null }
    if (!Array.isArray(meta.value)) throw new IndexCorruptError('projects:index value is not an array')
    return { index: meta.value as ProjectCard[], version: typeof meta.version === 'number' ? meta.version : null }
  }
  // 旧宿主无 V2：退回普通 get，但仍 fail-fast（不 try/catch 吞错；非数组也抛）
  const v = await s?.get(KEY_INDEX, PLUGIN_ID)
  if (v == null) return { index: [], version: null }
  if (!Array.isArray(v)) throw new IndexCorruptError('projects:index value is not an array')
  return { index: v as ProjectCard[], version: null }
}

/** 提交索引：有 CAS 用 setWithVersion（冲突返回 ok:false）；无则锁内无条件 set（mutex 已串行化） */
async function commitIndex(
  index: ProjectCard[],
  expectedVersion: number | null
): Promise<{ ok: boolean; version: number | null; conflict: boolean }> {
  const s = window.mulby?.storage
  if (hasCas() && s?.setWithVersion) {
    // expectedVersion：number→CAS；null→仅当 key 不存在；这正是我们要的（不存在则创建，存在则按版本）
    const res = await s.setWithVersion(KEY_INDEX, index, { expectedVersion })
    if (res?.ok) return { ok: true, version: res.version ?? null, conflict: false }
    return { ok: false, version: null, conflict: !!res?.conflict }
  }
  await s?.set(KEY_INDEX, index, PLUGIN_ID) // 传输错误→抛，由 mutateIndex 重试
  return { ok: true, version: null, conflict: false }
}

// 纯卡片变换（让 CAS 重试天然正确：在新鲜数据上重放即可）
function upsertCard(index: ProjectCard[], card: ProjectCard): ProjectCard[] {
  const i = index.findIndex((p) => p.id === card.id)
  if (i >= 0) {
    const next = index.slice()
    next[i] = card
    return next
  }
  return [...index, card]
}
function removeCardById(index: ProjectCard[], id: string): ProjectCard[] {
  return index.filter((p) => p.id !== id)
}
function renameCard(index: ProjectCard[], id: string, name: string, ts: number): ProjectCard[] {
  return index.map((p) => (p.id === id ? { ...p, name, updatedAt: ts } : p))
}
/** 按 id 取并集（shrink-guard 用）：同 id 偏好 updatedAt 更新者 */
function mergeCards(a: ProjectCard[], b: ProjectCard[]): ProjectCard[] {
  const byId = new Map<string, ProjectCard>()
  for (const c of a) byId.set(c.id, c)
  for (const c of b) {
    const ex = byId.get(c.id)
    if (!ex || (c.updatedAt ?? 0) >= (ex.updatedAt ?? 0)) byId.set(c.id, c)
  }
  return [...byId.values()]
}

/**
 * 从存活的 project:<id> 重建索引（自愈历史竞态留下的空/损坏索引）。
 * 已核验 'projects:index'.startsWith('project:') === false，索引键不会被扫入。
 * 旧宿主缺 list/getMany → 退回已知最优（不劣于现状）。
 */
async function rebuildIndexFromProjects(): Promise<ProjectCard[]> {
  const s = window.mulby?.storage
  if (!s?.list || !s?.getMany) return lastGoodIndex ? lastGoodIndex.slice() : []
  const PREFIX = 'project:'
  const keys: string[] = []
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const res = await s.list({ prefix: PREFIX, limit: 500, startsAfter: cursor })
    for (const it of res.items) if (it.key.startsWith(PREFIX)) keys.push(it.key)
    if (!res.nextCursor) break
    cursor = res.nextCursor
  }
  const cards: ProjectCard[] = []
  for (let i = 0; i < keys.length; i += 200) {
    const items = await s.getMany(keys.slice(i, i + 200))
    for (const it of items) {
      if (it.found && it.value && typeof it.value === 'object') {
        const p = it.value as ProjectData
        if (p && p.id) cards.push(toCard(p))
      }
    }
  }
  cards.sort((a, b) => b.updatedAt - a.updatedAt)
  return cards
}

/**
 * 索引变更的唯一收口：锁内重读 → 应用纯 mutator → shrink-guard（非删除路径若结果比已知最优更短，
 * 则从存活工程重建并取并集）→ commit（CAS/无条件）→ 冲突用新鲜数据重放。
 * 重试耗尽**抛异常**，绝不用陈旧/空数组覆盖内存 projects（调用方仅在 resolve 时 set projects）。
 */
async function mutateIndex(
  mutate: (cur: ProjectCard[]) => ProjectCard[],
  opts: { allowShrink?: boolean } = {}
): Promise<ProjectCard[]> {
  return withIndexLock(async () => {
    let lastErr: unknown = null
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      let cur: ProjectCard[]
      let ver: number | null
      try {
        const meta = await readIndexMeta()
        cur = meta.index
        ver = meta.version
      } catch (e) {
        if (e instanceof IndexCorruptError) {
          cur = await rebuildIndexFromProjects()
          ver = null
          try {
            const m2 = await readIndexMeta()
            ver = m2.version
          } catch {
            /* 仍损坏：用 ver=null（CAS create-only 或无条件） */
          }
        } else {
          lastErr = e // 瞬时传输错误：重试
          continue
        }
      }
      let next = mutate(cur)
      if (!opts.allowShrink) {
        const baseline = Math.max(cur.length, lastGoodIndex?.length ?? 0)
        if (next.length < baseline) {
          const rebuilt = await rebuildIndexFromProjects()
          next = mergeCards(mutate(rebuilt), rebuilt) // 在完整集上重放 mutator + 并集
        }
      }
      try {
        const res = await commitIndex(next, ver)
        if (res.ok) {
          indexVersion = res.version
          lastGoodIndex = next
          return next
        }
        lastErr = new Error('projects:index CAS conflict') // 冲突：循环用新鲜数据重放
      } catch (e) {
        lastErr = e
      }
    }
    throw new IndexWriteError(`mutateIndex failed after ${MAX_CAS_RETRIES} retries: ${String(lastErr)}`)
  })
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
  viewport?: { x: number; y: number; zoom: number } // P2-13：画布视口（持久化，大图不再每次 fitView 迷路）
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
  retryFailedItems: (id: string) => Promise<void> // M30：只重生成失败的扇出项，成功项不重烧
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
  /** 从媒体文件库把一条媒体插入画布（生成绑定的参考图/音频输入节点）；position 用于拖拽落点 */
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
  duplicateSelected: () => void
  updateNodeParam: (id: string, key: string, value: unknown) => void
  updateNodeTitle: (id: string, title: string) => void
  toggleNodeLock: (id: string) => void
  setViewport: (vp: { x: number; y: number; zoom: number }) => void
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
let safeSaveRetryArmed = false

/**
 * 安全保存：包住会抛错的 saveProject（saveProject 失败时已自行重置 dirty）。
 * 失败 → 提示用户 + 排一次性自重试（不静默吞失败，这正是「保存悄悄失败」根因的对症处理）。
 */
async function safeSave(): Promise<void> {
  try {
    await useGraphStore.getState().saveProject()
    safeSaveRetryArmed = false
  } catch (e) {
    window.mulby?.notification?.show(`工程保存失败，将自动重试（${String((e as Error)?.message ?? e)}）`, 'warning')
    if (!safeSaveRetryArmed) {
      safeSaveRetryArmed = true
      scheduleSave() // 一次性自重试（防抖窗口后再试）
    }
  }
}

/**
 * 防抖自动保存：内部总走 safeSave（忽略历史回调参数）——一处改动即修好全部 18 个
 * `scheduleSave(() => get().saveProject())` 调用点（其中部分位于 grep 不可见的 NUL 文件中）。
 */
function scheduleSave(_legacyCb?: () => void) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void safeSave()
  }, 800)
}

/** 立即落盘并等待在途保存 settle：视图切换/隐藏/卸载边界用，确保不丢未保存编辑 */
export async function flushSave(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (useGraphStore.getState().dirty) await safeSave()
  // 等队列中在途的 mutateIndex/save 全部 settle（真静默）
  await withIndexLock(() => Promise.resolve())
}

/** 用户显式保存（Cmd/Ctrl+S）：走 safeSave，失败提示+重试而非静默 */
export async function requestSave(): Promise<void> {
  await safeSave()
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
async function execNode(id: string, opts?: { force?: boolean; retryFailed?: boolean }): Promise<void> {
  const get = useGraphStore.getState
  const node = get().nodes.find((n) => n.id === id)
  if (!node) return
  const def = getNodeDef(node.data.kind)
  if (!def) return

  // 人物 / 场景 / 物品资产节点：身份(JSON) + 参考图（上传 / 文字生成 / 连「参考图」口用素材图生成），可直连关键帧保持一致性
  if (node.data.kind === 'character' || node.data.kind === 'scene' || node.data.kind === 'prop') {
    const p = node.data.params || {}
    const jsonOut = resolveOutput(node, 'out')
    const existingImg = node.data.outputs?.image
    const baseOut: Record<string, PortValue> = {}
    // 存「身份-only」json（剥掉打包的图）：节点预览靠 outputs.image 显示当前最新图，避免存进旧图导致预览过时；
    // 下游始终经 resolveOutput 重新派生（输入类节点即时派生），会拿到当前图打包，互不影响。
    if (jsonOut) baseOut.out = { ...jsonOut, items: undefined }
    // 「参考图」入口：连入的素材图，用作 img2img 锚定（有编辑能力时）或直接作为该资产参考图
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const refImgs = await refsFromValues(inputs['ref'])
    const canEdit =
      typeof window.mulby?.ai?.images?.edit === 'function' && typeof window.mulby?.ai?.attachments?.upload === 'function'
    // 已有参考图（上传 或 已生成）且非强制重画 → 复用：全图重跑不重画（保跨镜一致），上传的图也不会被覆盖
    if (!opts?.force && existingImg?.assetId) {
      baseOut.image = existingImg
      patchNode(id, { status: 'done', error: undefined, outputs: baseOut })
      return
    }
    // 文字生成参考图（无可用文字内容时：有连入素材图就直接当参考图，否则只产出 JSON 身份）
    const job = buildAssetImageJob(node.data, get().globals)
    if (!job) {
      if (!existingImg && refImgs.length) {
        // 只连了素材图、没写描述：直接把素材图作为该资产的参考图（无需「生成」）
        const r0 = refImgs[0]
        const assetId = await saveAsset(r0.base64, r0.mime)
        baseOut.image = { type: 'image', assetId, mime: r0.mime, meta: { ...(p.name ? { name: String(p.name) } : {}), kind: node.data.kind } }
        patchNode(id, { status: 'done', error: undefined, outputs: baseOut })
        return
      }
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
      // 连了素材图且有编辑能力 → 按素材图 img2img 生成该资产；否则纯文生图
      const refImg = refImgs[0]
      const r =
        refImg && canEdit
          ? await editImage({ model, prompt: job.prompt, refBase64: refImg.base64, refMime: refImg.mime })
          : await generateImage({
              model,
              prompt: job.prompt,
              size: job.size,
              onPreview: (b64) => patchNode(id, { previewUrl: toDataUrl(b64, 'image/png') }),
            })
      const assetId = await saveAsset(r.base64, r.mime)
      const img: PortValue = {
        type: 'image',
        assetId,
        // 去生成时持久 data: url：显示走 useMediaUrl(assetId)→blob(saveAsset 已灌缓存，即时)；
        // 下游 portImageDataUrl 按 assetId 取字节。免整段 base64 常驻会话内存。
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

  // 逐项展开 ForEach（P2-12）：把 json 数组 / 合集物化成 items[]，逐项喂下游（显式扇出，不引入循环边）
  if (node.data.kind === 'foreach') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const arrayKey = String(node.data.params?.arrayKey ?? '').trim()
    const src = inputs['in']?.[0]
    const items: PortValue[] = []
    if (src?.items?.length) items.push(...src.items)
    else if (src?.json && arrayKey) {
      const arr = (src.json as Record<string, unknown>)[arrayKey]
      if (Array.isArray(arr))
        for (const el of arr) {
          const key = el && typeof el === 'object' ? (el as Record<string, unknown>).id : undefined
          items.push({ type: 'json', json: el as unknown, meta: key != null ? { key: String(key) } : undefined })
        }
    } else if (src) items.push(src)
    if (items.length === 0) {
      patchNode(id, { status: 'error', error: '无可展开的项（连接含 items 的合集或带数组字段的 json）' })
      return
    }
    const outId = def.outputs[0]?.id || 'item'
    const head = items[0]
    patchNode(id, {
      status: 'done',
      error: undefined,
      stream: undefined,
      outputs: { [outId]: { ...head, type: head.type, items } },
    })
    return
  }

  // 合并/收集：把多路同类产物收集为一个多项输出（纯数据节点，无 AI 调用）。P2-12：concat / zip / by-key
  if (node.data.kind === 'merge') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const mode = String(node.data.params?.mode ?? 'concat')
    // 各上游分别展开为一路（保持路内顺序），用于 zip/by-key 跨路对齐
    const lanes: PortValue[][] = []
    for (const arr of Object.values(inputs)) for (const v of arr) lanes.push(expandItems(v))
    const flat: PortValue[] = lanes.flat()
    if (flat.length === 0) {
      patchNode(id, { status: 'idle', outputs: {}, error: undefined })
      return
    }
    let all: PortValue[]
    if (mode === 'zip' && lanes.length > 1) {
      // 按下标配对：items[i] = 嵌套组（仅认 lanes 的 compose/timeline 取用，其余取 flat=items[0]）
      const n = Math.max(...lanes.map((l) => l.length))
      all = []
      for (let i = 0; i < n; i++) {
        const group = lanes.map((l) => l[i]).filter(Boolean) as PortValue[]
        const g0 = group[0]
        all.push({ ...g0, type: 'any', items: group, meta: { ...(g0?.meta || {}), lanes: group.length } })
      }
    } else if (mode === 'by-key' && lanes.length > 1) {
      // 按 charId/name/key 对齐：第一路为主，其余路按键并入该项的嵌套组
      const keyOf = (v: PortValue) =>
        String(v.meta?.charId ?? v.meta?.name ?? v.meta?.key ?? v.meta?.shot ?? '') +
        (v.meta?.variantId ? '@' + String(v.meta.variantId) : '') // M-compat：同角色不同形态分桶，避免变体被合并对齐
      const index = new Map<string, PortValue[]>()
      for (let li = 1; li < lanes.length; li++)
        for (const v of lanes[li]) {
          const k = keyOf(v)
          if (!k) continue
          ;(index.get(k) || index.set(k, []).get(k)!).push(v)
        }
      all = lanes[0].map((v) => {
        const k = keyOf(v)
        const group = [v, ...(k ? index.get(k) || [] : [])]
        return group.length > 1 ? { ...v, type: 'any', items: group, meta: { ...(v.meta || {}), lanes: group.length } } : v
      })
    } else {
      all = flat // concat（现状）
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

  // 时间线 / EDL（P2-11）：把片段排成可编辑 EDL（json）+ items[] 透传（直连 compose.clips 即按此顺序拼接）。纯数据节点
  if (node.data.kind === 'timeline') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const clipVals = (inputs['clips'] || []).flatMap(expandItems).filter((v) => v.type === 'video')
    if (clipVals.length === 0) {
      patchNode(id, { status: 'error', error: '缺少视频片段（连接图生视频等到「视频片段」口）' })
      return
    }
    let acc = 0
    const clips = clipVals.map((v, i) => {
      const dur = Number(v.durationSec ?? 5) || 5
      const startSec = acc
      acc += dur
      const sid = v.meta?.shot
      return {
        clipId: `c${i + 1}`,
        shotId: sid != null ? String(sid) : undefined,
        assetRef: { assetId: v.assetId, localPath: v.localPath, url: v.url },
        inSec: 0,
        outSec: dur,
        startSec,
        lane: 0,
      }
    })
    const edl = { fps: 24, clips }
    const outId = def.outputs[0]?.id || 'out'
    patchNode(id, {
      status: 'done',
      error: undefined,
      stream: undefined,
      // 双写：EDL 放 json 供检视/未来编辑；items[] 透传保证直连 compose 仍能拼
      outputs: { [outId]: { type: 'any', json: edl, items: clipVals, meta: { kind: 'edl', clipCount: clips.length } } },
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
        // M-compat：透传一致性键，避免图生图/高清重绘后丢失角色/形态/场景身份导致下游取图断链
        const meta: Record<string, unknown> = {}
        if (m.name) meta.name = m.name
        if (m.kind) meta.kind = m.kind
        if (m.charId) meta.charId = m.charId
        if (m.variantId) meta.variantId = m.variantId
        if (m.view) meta.view = m.view
        if (m.locationKey) meta.locationKey = m.locationKey
        if (m.isMasterPlate) meta.isMasterPlate = m.isMasterPlate
        items.push({ type: 'image', assetId, mime: r.mime, ...(Object.keys(meta).length ? { meta } : {}) })
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
    // P2-12 联动：上游 ForEach 把数组物化成 items[]（>1）时，json 文本节点逐项扇出后合并——
    // 长剧本按场拆解，每场独立一次调用，根治"丢后半段"。普通单输入（无 items）零回归。
    const primaryItems = inputs['in']?.[0]?.items
    const fanKey = TEXT_ARRAY_KEY[node.data.kind]
    if (def.outputs[0]?.type === 'json' && fanKey && Array.isArray(primaryItems) && primaryItems.length > 1) {
      const model = (node.data.params?.modelOverride as string) || get().selectedModel
      useGraphStore.setState({ runningNodeId: id })
      patchNode(id, { status: 'running', stream: '', error: undefined })
      try {
        // 并发逐项生成（每场独立调用），结果按 index 保序后合并
        const total = primaryItems.length
        let done = 0
        const acc = new Array<unknown[] | undefined>(total)
        const outId0 = def.outputs[0].id
        const perArrays = await mapPool(
          primaryItems,
          fanoutConcurrency(),
          async (itemVal): Promise<unknown[]> => {
            const perInputs: Record<string, PortValue[]> = { ...inputs, in: [itemVal] }
            const built = buildPrompt(node.data, perInputs, get().globals)
            if (!built.user.trim()) return []
            let ctx: { sceneIds?: string[] } | undefined
            if (node.data.kind === 'storyboard') {
              const sid = (itemVal.json as Record<string, unknown> | undefined)?.id
              if (sid != null) ctx = { sceneIds: [String(sid)] }
            }
            let parsedK: unknown = null
            let errK = ''
            let contentK = ''
            for (let attempt = 1; attempt <= 2; attempt++) {
              const usr = attempt === 1 ? built.user : buildRepairPrompt(built.user, errK, contentK)
              const r = await runText({ model, system: built.system, user: usr, jsonMode: true })
              contentK = r.content
              parsedK = extractJson(contentK)
              errK = validateNodeJson(node.data.kind, parsedK, ctx)
              if (!errK) break
            }
            const arr = parsedK && typeof parsedK === 'object' ? (parsedK as Record<string, unknown>)[fanKey] : undefined
            return Array.isArray(arr) ? arr : []
          },
          {
            shouldStop: () => !get().isRunning,
            onSettled: (k, arr) => {
              done++
              // 实时增量回写：每场生成完即并入部分产物，节点上「分镜·N 镜」实时增长
              acc[k] = arr
              const partial = acc.flatMap((a) => a || [])
              patchNode(id, {
                stream: `逐项生成 ${done}/${total}…`,
                outputs: { [outId0]: { type: 'json', json: { [fanKey]: partial }, text: '' } },
              })
            },
          }
        )
        let merged: unknown[] = perArrays.flatMap((a) => a || [])
        if (merged.length === 0) throw new Error('逐项扇出未得到任何结果')
        if (node.data.kind === 'storyboard')
          merged = capStoryboardShots(merged, (Number(node.data.params?.maxShots ?? 0) || 0) || scaleSpec(get().globals.filmScale).maxShots)
        const lastText = JSON.stringify({ [fanKey]: merged })
        patchNode(id, {
          status: 'done',
          stream: undefined,
          outputs: { [outId0]: { type: 'json', json: { [fanKey]: merged }, text: lastText } },
        })
        if (node.data.kind === 'storyboard') {
          const w = checkAxisContinuity(merged as Array<Record<string, unknown>>)
          if (w.length)
            window.mulby?.notification?.show(
              `分镜连续性提示：${w.slice(0, 2).join('；')}${w.length > 2 ? ` 等 ${w.length} 项` : ''}`,
              'warning'
            )
        }
      } catch (e) {
        patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
      } finally {
        useGraphStore.setState({ runningNodeId: null })
      }
      return
    }
    const { system, user } = buildPrompt(node.data, inputs, get().globals)
    // §4.3：storyboard 覆盖校验——收集上游 scene id，校验分镜是否覆盖全部场景（未覆盖触发修复重试）
    let validateCtx: { sceneIds?: string[] } | undefined
    if (node.data.kind === 'storyboard') {
      const sj = inputs['in']?.[0]?.json as Record<string, unknown> | undefined
      const sc = Array.isArray(sj?.scenes) ? (sj!.scenes as Array<Record<string, unknown>>) : []
      const ids = sc.map((s) => String(s.id ?? '')).filter(Boolean)
      if (ids.length) validateCtx = { sceneIds: ids }
    }
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
        lastErr = validateNodeJson(node.data.kind, parsed, validateCtx)
        if (!lastErr) break
      }
      if (wantJson) {
        if (lastErr) {
          patchNode(id, { status: 'error', error: `未能解析 JSON 输出（${lastErr}）`, stream: content })
        } else {
          // M-quick：单次成镜路径同样应用镜头总数上限
          if (node.data.kind === 'storyboard') {
            const pj = parsed as Record<string, unknown> | null
            if (pj && Array.isArray(pj.shots))
              pj.shots = capStoryboardShots(pj.shots as unknown[], (Number(node.data.params?.maxShots ?? 0) || 0) || scaleSpec(get().globals.filmScale).maxShots)
          }
          patchNode(id, {
            status: 'done',
            outputs: { [outDef.id]: { type: 'json', json: parsed, text: content } },
            stream: content,
          })
          // P2-6：分镜跳轴软告警（不阻断生成）
          if (node.data.kind === 'storyboard') {
            const shots = (parsed as Record<string, unknown> | null)?.shots
            if (Array.isArray(shots)) {
              const w = checkAxisContinuity(shots as Array<Record<string, unknown>>)
              if (w.length)
                window.mulby?.notification?.show(
                  `分镜连续性提示：${w.slice(0, 2).join('；')}${w.length > 2 ? ` 等 ${w.length} 项` : ''}`,
                  'warning'
                )
            }
          }
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

  // 角色设定图：每 (角色×变体) 出一张 16:9 设定板（左面部特写 + 右正/侧/背，白底；一次出图省钱）。
  // M22b：先并发出底模/无变体板（捕获底模板），再并发派生各变体板（锁脸到底模）。
  // 输出「角色」(json 身份 + 设定板打包进 items)，一根线直连关键帧——下游按名/charId 取该设定板做一致性。
  if (def.category === 'image' && node.data.kind === 'char-image') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const sets = buildCharViewSets(node.data, inputs, get().globals)
    if (sets.length === 0) {
      patchNode(id, { status: 'error', error: '缺少角色（连接「角色设定」/「人物」到角色口）' })
      return
    }
    const model = (node.data.params?.imageModelOverride as string) || get().selectedImageModel
    if (!model) {
      patchNode(id, { status: 'error', error: '未配置图像模型（请在顶栏或节点选择）' })
      return
    }
    // 修复 M22b-4：editImage 还需 attachments.upload，否则会抛错——缺上传能力时一律走文生图（变体提示词已含身份，仍保一致）
    const canEdit =
      typeof window.mulby?.ai?.images?.edit === 'function' && typeof window.mulby?.ai?.attachments?.upload === 'function'
    // 「角色」口里打包的人物素材图（上游人物节点上传/生成的图），用作 img2img 锚定到该人物
    const extRefs = await refsFromValues(inputs['role'])
    // 身份透传：连同设定板一起打包输出，使 keyframe 一根线即可拿到身份+图
    const idents = (inputs['role'] || []).flatMap((v) => {
      const j = v.json && typeof v.json === 'object' ? (v.json as Record<string, unknown>) : null
      return j && Array.isArray(j.characters) ? (j.characters as unknown[]) : []
    })
    const outId = def.outputs[0]?.id || 'out'
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', error: undefined, previewUrl: undefined, stream: undefined })
    const total = sets.length
    if (total > 1) patchNode(id, { gen: { total } })
    const results = new Array<PortValue | undefined>(total)
    let done = 0
    let failed = 0
    const bundle = (items: PortValue[]): PortValue => ({
      type: 'json',
      json: { characters: idents },
      items,
      assetId: items[0]?.assetId,
      url: items[0]?.url,
      mime: items[0]?.mime,
    })
    const writeBack = () => {
      const partial = results.filter(Boolean) as PortValue[]
      patchNode(id, {
        previewUrl: undefined,
        stream: total > 1 ? `生成中 ${done}/${total}…` : '生成中…',
        outputs: partial.length ? { [outId]: bundle(partial) } : undefined,
      })
    }
    type CharSet = (typeof sets)[number]
    const idxOf = new Map<CharSet, number>(sets.map((s, i) => [s, i]))
    const baseBoards = new Map<string, { b64: string; mime: string }>() // M22b：组键 → 底模板，供变体派生锁脸
    const grpKey = (s: CharSet) => s.baseGroup || '' // 修复 ORD-1：唯一组键配对底模/变体，杜绝同名/无名串脸
    // view:'board' 标记单张设定板（promoteCharViews 据此写回库角色的 views.board）
    const metaOf = (set: CharSet) => ({ name: set.name, kind: 'character', charId: set.charId, variantId: set.variantId, view: 'board' })
    const genSet = async (set: CharSet, anchor?: { b64: string; mime: string }): Promise<void> => {
      const si = idxOf.get(set) ?? 0
      const extRef = canEdit ? pickRef(extRefs, set.refName) : null
      try {
        let b64: string
        let mime: string
        if (anchor && canEdit) {
          // 变体：以底模板为参考派生（锁脸换龄/换装），并附带外部素材参考
          const extra = extRef ? [{ base64: extRef.base64, mime: extRef.mime }] : []
          const r = await editImage({ model, prompt: set.prompt, refBase64: anchor.b64, refMime: anchor.mime, extraRefs: extra })
          b64 = r.base64
          mime = r.mime
        } else if (extRef) {
          // 上游人物素材图 → img2img 锚定到该人物
          const r = await editImage({ model, prompt: set.prompt, refBase64: extRef.base64, refMime: extRef.mime })
          b64 = r.base64
          mime = r.mime
        } else {
          const r = await generateImage({ model, prompt: set.prompt, size: set.size })
          b64 = r.base64
          mime = r.mime
        }
        results[si] = { type: 'image', assetId: await saveAsset(b64, mime), mime, meta: metaOf(set) }
        if (set.isBase && grpKey(set)) baseBoards.set(grpKey(set), { b64, mime }) // 捕获底模板（空组键不入）
        done++
        writeBack()
      } catch {
        failed++
      }
    }
    try {
      // M22b 两段式（inter-set 屏障）：先并发出底模/无变体板（捕获底模板），再并发派生各变体板（锁脸到底模）
      const conc = fanoutConcurrency()
      const stop = { shouldStop: () => !get().isRunning }
      await mapPool(
        sets.filter((s) => !s.derives),
        conc,
        (set) => genSet(set),
        stop
      )
      await mapPool(
        sets.filter((s) => s.derives),
        conc,
        (set) => genSet(set, grpKey(set) ? baseBoards.get(grpKey(set)) : undefined),
        stop
      )
      const items = results.filter(Boolean) as PortValue[]
      if (items.length === 0) throw new Error('未生成任何角色设定图')
      if (failed > 0) window.mulby?.notification?.show(`${failed} 张角色设定图生成失败，已保留其余 ${items.length} 张`, 'warning')
      patchNode(id, {
        status: 'done',
        previewUrl: undefined,
        stream: undefined,
        gen: undefined,
        outputs: { [outId]: bundle(items) },
      })
      // M27：把生成的设定板写回「已存在」的库角色（按 charId/name 匹配，幂等、不自动新建）
      void useAssetStore
        .getState()
        .promoteCharViews(items.map((it) => ({ assetId: it.assetId, meta: it.meta })))
        .then((n) => {
          if (n > 0) window.mulby?.notification?.show(`已将 ${n} 张角色设定图写回资产中心对应角色`, 'info')
        })
        .catch(() => {})
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), previewUrl: undefined, stream: undefined, gen: undefined })
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
      // 不再静默：连了参考图但当前供应商无图像编辑能力 → 只能文生图、用不上参考图，明确提示用户换供应商
      if (refs.length > 0 && !window.mulby?.ai?.images?.edit)
        window.mulby?.notification?.show(
          '当前图像供应商不支持「图像编辑」，连入的参考图无法生效（只按文字生成）。请在「模型供应商」配置支持图像编辑(img2img)的供应商。',
          'warning'
        )
      const outId = def.outputs[0]?.id || 'out'
      // 并发扇出生成（关键帧/角色图/场景图）：有界并发池，保序，部分成功；单张时不并发
      const total = jobs.length
      // M30：逐项状态——预占 total 格，每项 pending→running→done/failed，失败项画布上红框可见+可重试
      const itemKey = (j: { meta?: Record<string, unknown>; refName?: string }, i: number): string => {
        const m = (j.meta || {}) as Record<string, unknown>
        if (m.shot) return String(m.shot)
        if (m.variantId && m.view) return `${m.variantId}·${m.view}`
        if (m.name && m.view) return `${m.name}·${m.view}`
        return j.refName || (m.name ? String(m.name) : `#${i + 1}`)
      }
      // M30 重试失败项：用上次 gen.items 作种子，已 done 的不重烧，仅补 failed/pending；任务结构变了(条数不符)则全量重跑
      const prevItems = opts?.retryFailed && Array.isArray(node.data.gen?.items) ? node.data.gen!.items! : null
      const usePrev = !!prevItems && prevItems.length === jobs.length
      const genItems: GenItem[] = jobs.map((j, i) => {
        const prev = usePrev ? prevItems![i] : undefined
        return prev?.status === 'done' && prev.ref
          ? { idx: i, key: itemKey(j, i), status: 'done' as GenItemStatus, ref: prev.ref, mediaType: 'image' as const }
          : { idx: i, key: itemKey(j, i), status: 'pending' as GenItemStatus }
      })
      const patchGen = () => patchNode(id, { gen: { total, items: genItems.slice() } })
      if (total > 1) patchGen()
      const results = new Array<PortValue | undefined>(total)
      for (const it of genItems) if (it.status === 'done' && it.ref) results[it.idx] = it.ref // 种子：已成功项就位
      let done = 0
      let failed = 0
      // fix 1 关键帧链式生成：承接镜头（meta.chainFromPrev）由「上一镜关键帧」img2img 派生，
      // 让同一连贯段的相邻画格构图/光线/站位一致——i2v 顺接补间时就不会在两张不相干的图之间诡异扭曲。
      // 每帧把自己的 {base64,mime} 通过 chainReady[i] 解给下一帧；缺图像编辑能力则退回各自独立生成。
      const chainReady: Array<(v: { base64: string; mime: string } | null) => void> = []
      const chainImg: Array<Promise<{ base64: string; mime: string } | null>> = jobs.map(
        (_, i) => new Promise((res) => (chainReady[i] = res))
      )
      const settleChain = (i: number, v: { base64: string; mime: string } | null) => chainReady[i]?.(v)
      const writeBack = () => {
        const partial = results.filter(Boolean) as PortValue[]
        patchNode(id, {
          previewUrl: undefined,
          stream: total > 1 ? `生成中 ${done}/${total}…` : '生成中…',
          outputs: partial.length
            ? { [outId]: { type: 'image', items: partial, assetId: partial[0].assetId, url: partial[0].url, mime: partial[0].mime } }
            : undefined,
        })
      }
      await mapPool(
        jobs,
        fanoutConcurrency(),
        async (job, i): Promise<PortValue> => {
          if (results[i]) {
            settleChain(i, null) // M30 重试：已成功项直接返回，不重烧；解开链避免阻塞后续承接镜头
            return results[i] as PortValue
          }
          if (total > 1) {
            genItems[i] = { ...genItems[i], status: 'running' }
            patchGen()
          }
          const matched = canEdit
            ? selectRefs(
                refs,
                job.refNames,
                job.refName,
                job.refCharIds,
                job.meta?.sceneName as string | undefined,
                job.meta?.locationKey as string | undefined,
                job.refPropNames,
                job.refVariantIds,
                job.refPropVariantIds,
                job.sceneVariantId
              )
            : []
          // fix 1：承接镜头取「上一镜关键帧」作 img2img 主参考（承载构图/光线/站位），角色/场景参考图退为附加参考
          const chainBase =
            canEdit && job.meta?.chainFromPrev === true && i > 0 ? await awaitOrStop(chainImg[i - 1], () => !get().isRunning) : null
          let base64: string
          let mime: string
          // 抛错不在此解链：交给 mapPool 重试；只有最终失败(onError)才解 null。重试成功仍能把真图传给后续承接镜头。
          if (chainBase) {
            const r = await editImage({
              model,
              prompt: job.prompt,
              refBase64: chainBase.base64,
              refMime: chainBase.mime,
              extraRefs: matched.map((x) => ({ base64: x.base64, mime: x.mime })),
            })
            base64 = r.base64
            mime = r.mime
          } else if (matched.length) {
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
              // 并发时多张预览会互相覆盖，单张才显示流式预览
              onPreview: total === 1 ? (b64) => patchNode(id, { previewUrl: toDataUrl(b64, 'image/png') }) : undefined,
            })
            base64 = r.base64
            mime = r.mime
          }
          settleChain(i, { base64, mime }) // 本帧就绪 → 解开下一承接镜头的 img2img 派生
          const assetId = await saveAsset(base64, mime)
          return { type: 'image', assetId, mime, meta: job.meta }
        },
        {
          retries: 2, // 失败重试 2 次（扛限流），减少静默丢帧
          shouldStop: () => !get().isRunning,
          onSettled: (i, item) => {
            results[i] = item
            genItems[i] = { ...genItems[i], status: 'done', ref: item, mediaType: 'image' }
            done++
            writeBack()
            if (total > 1) patchGen()
          },
          onError: (i, err) => {
            settleChain(i, null) // 最终失败解链：后续承接镜头退回独立生成，不会永久等待
            genItems[i] = { ...genItems[i], status: 'failed', error: err instanceof Error ? err.message : String(err) }
            failed++
            if (total > 1) patchGen()
          },
        }
      )
      const items = results.filter(Boolean) as PortValue[]
      if (items.length === 0) throw new Error('未生成任何图像')
      if (failed > 0)
        window.mulby?.notification?.show(
          `${total} 张里 ${failed} 张生成失败（已自动重试仍失败），已出 ${items.length} 张。节点上红框标出失败项，点「重试失败项」可单独补齐（成功的不重烧）。`,
          'warning'
        )
      const head = items[0]
      patchNode(id, {
        status: 'done',
        previewUrl: undefined,
        stream: undefined,
        // M30：有失败则保留 gen.items，失败瓦片在画布上持续可见可重试；全成功才清空
        gen: failed > 0 ? { total, items: genItems } : undefined,
        // flat 字段镜像 items[0] 以兼容单值渲染；items 承载全部
        outputs: { [outId]: { type: 'image', items, assetId: head.assetId, url: head.url, mime: head.mime } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), previewUrl: undefined, stream: undefined, gen: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 视频 AI 节点：自管供应商 submit→poll→fetch
  if (def.category === 'video') {
    // P2-8：口型同步——video+audio→video，用 lipsync 能力供应商，复用 runVideo 三段式
    if (node.data.kind === 'lipsync') {
      const ps = useProviderStore.getState()
      const overrideId = (node.data.params?.providerOverride as string) || ''
      const provider = overrideId ? ps.providers.find((x) => x.id === overrideId) || null : ps.getActiveFor('lipsync')
      if (!provider) {
        patchNode(id, { status: 'error', error: '未配置口型同步(lipsync)供应商（顶栏「模型供应商」添加 lipsync 能力）' })
        return
      }
      const inputs = gatherInputs(node, get().nodes, get().edges)
      const videoVal = (inputs['video'] || []).flatMap(expandItems).find((v) => v.type === 'video')
      const audioVal = (inputs['audio'] || []).flatMap(expandItems).find((v) => v.type === 'audio')
      const videoUrl = videoVal?.url || (videoVal?.localPath ? toFileUrl(videoVal.localPath) : undefined)
      const audioUrl = audioVal?.url || (audioVal?.localPath ? toFileUrl(audioVal.localPath) : undefined)
      if (!videoUrl) {
        patchNode(id, { status: 'error', error: '缺少输入视频（连接图生视频/文生视频）' })
        return
      }
      if (!audioUrl) {
        patchNode(id, { status: 'error', error: '缺少对白音频（连接配音 TTS）' })
        return
      }
      const apiKey = await ps.resolveKey(provider.id)
      if (!apiKey && provider.kind === 'fal') {
        patchNode(id, { status: 'error', error: '该供应商未配置 API Key' })
        return
      }
      useGraphStore.setState({ runningNodeId: id })
      patchNode(id, { status: 'running', stream: '口型同步…', error: undefined })
      try {
        const { url } = await runVideo({
          cfg: provider,
          apiKey,
          req: { prompt: '', videoUrl, drivingAudioUrl: audioUrl },
          onProgress: (pr) => patchNode(id, { stream: `口型同步：${pr.status}…` }),
        })
        let localPath: string | undefined
        try {
          localPath = await downloadVideoToDisk(url, `lipsync_${Date.now()}`)
        } catch {
          // 忽略
        }
        const outId = def.outputs[0]?.id || 'out'
        patchNode(id, {
          status: 'done',
          stream: undefined,
          outputs: { [outId]: { type: 'video', url, localPath, mime: 'video/mp4', meta: videoVal?.meta } },
        })
      } catch (e) {
        patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
      } finally {
        useGraphStore.setState({ runningNodeId: null })
      }
      return
    }
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
    // P2-5：可选「分镜」json 输入端口——逐帧取景别/运镜/动作（与 frame 扇出同序），补充/兜底 keyframe meta
    const shotJson = inputs['shot']?.[0]?.json as Record<string, unknown> | undefined
    const shotList: Array<Record<string, unknown>> = Array.isArray(shotJson?.shots)
      ? (shotJson!.shots as Array<Record<string, unknown>>)
      : shotJson
        ? [shotJson]
        : []
    // i2v：按上游关键帧（含扇出的多张）逐帧扇出生成 N 个视频；t2v：单个文本任务
    const frameUrls: (string | undefined)[] = []
    const tailUrls: string[] = []
    // P0-1：与 frameUrls 对齐的逐帧元信息（shot/prompt/camera/mood/motion/duration），供循环内逐帧消费
    const frameMetas: Array<Record<string, unknown>> = []
    if (node.data.kind === 'i2v') {
      const frameVals = (inputs['frame'] || []).flatMap(expandItems).filter((v) => v.type === 'image')
      for (const fv of frameVals) {
        const du = await portImageDataUrl(fv)
        if (du) {
          frameUrls.push(du)
          frameMetas.push((fv.meta as Record<string, unknown> | undefined) || {})
        }
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
    // 多模态参考输入（Seedance-2 等支持）：参考视频→构图/运镜参考，参考音频→背景音乐/节奏参考。
    // 全片段共享一份；供应商不支持则按模板/适配器忽略。
    const refVideoVal = (inputs['refVideo'] || []).flatMap(expandItems).find((v) => v.type === 'video')
    const refVideoUrl = refVideoVal?.url || (refVideoVal?.localPath ? toFileUrl(refVideoVal.localPath) : undefined)
    const refAudioVal = (inputs['refAudio'] || []).flatMap(expandItems).find((v) => v.type === 'audio')
    const refAudioUrl = refAudioVal?.url || (refAudioVal?.localPath ? toFileUrl(refAudioVal.localPath) : undefined)
    const apiKey = await useProviderStore.getState().resolveKey(provider.id)
    if (!apiKey && provider.kind === 'fal') {
      patchNode(id, { status: 'error', error: '该供应商未配置 API Key' })
      return
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', error: undefined, stream: '提交任务…' })
    try {
      const total = frameUrls.length
      const outId = def.outputs[0]?.id || 'out'
      // 仅在 ffmpeg 已就绪时于 i2v 阶段做实测（best-effort）；最终时长由 compose 统一再测兜底
      const canProbe = await ffmpegAvailable()
      // M18-B：音频模式（节点级三态）。native=把对白/SFX/ambient 喂入视频请求并标 hasAudio；external=无声生成留待外置合成
      const audioModeLabel = String(node.data.params?.audioMode ?? '无声')
      const audioMode: 'native' | 'external' | 'silent' =
        audioModeLabel === '模型自带声' ? 'native' : audioModeLabel === '外置合成' ? 'external' : 'silent'
      // fix #5 镜头顺接：开启后，连贯镜头用「下一镜首帧」作本镜尾帧（首尾帧补间），消除割裂；硬切处不接
      const continuityOn = String(node.data.params?.continuity ?? '关闭') === '连贯镜头尾接首'
      // seed 锁定：>0 时整段所有片段共用同一 seed → 跨片段风格/运动更一致（供应商不支持则忽略）
      const videoSeed = Number(node.data.params?.seed ?? 0) > 0 ? Number(node.data.params?.seed) : undefined
      // 并发扇出：N 个片段最多 fanoutConcurrency 个同时 submit→poll（异步视频并行收益最大），保序、部分成功
      // M30：逐项状态——预占 total 格，失败片段画布上红框可见可重试
      // M30 重试失败项：上次 gen.items 作种子，已 done 的片段不重生成
      const prevItems = opts?.retryFailed && Array.isArray(node.data.gen?.items) ? node.data.gen!.items! : null
      const usePrev = !!prevItems && prevItems.length === total
      const genItems: GenItem[] = Array.from({ length: total }, (_, i) => {
        const prev = usePrev ? prevItems![i] : undefined
        const key = frameMetas[i]?.shot ? String(frameMetas[i].shot) : `片段 ${i + 1}`
        return prev?.status === 'done' && prev.ref
          ? { idx: i, key, status: 'done' as GenItemStatus, ref: prev.ref, mediaType: 'video' as const }
          : { idx: i, key, status: 'pending' as GenItemStatus }
      })
      const patchGen = () => patchNode(id, { gen: { total, items: genItems.slice() } })
      if (total > 1) patchGen()
      const results = new Array<PortValue | undefined>(total)
      for (const it of genItems) if (it.status === 'done' && it.ref) results[it.idx] = it.ref // 种子：已成功片段就位
      let done = 0
      let failed = 0
      // fix 4 真·尾帧接龙：承接片段（meta.chainFromPrev，与关键帧链式同源）用「上一片段真实最后一帧」作首帧，
      // 保证无缝衔接——即便供应商不支持首尾帧约束也接得上。需 ffmpeg 就绪 + 顺接开启；best-effort，抽帧失败回退用本镜关键帧。
      const lfReady: Array<(v: string | null) => void> = []
      const lfChain: Array<Promise<string | null>> = Array.from({ length: total }, (_, i) => new Promise((res) => (lfReady[i] = res)))
      const settleLF = (i: number, v: string | null) => lfReady[i]?.(v)
      const lfChainsFromPrev = (i: number) => continuityOn && canProbe && i > 0 && frameMetas[i]?.chainFromPrev === true
      const lfNeededAfter = (i: number) => continuityOn && canProbe && i + 1 < total && frameMetas[i + 1]?.chainFromPrev === true
      await mapPool(
        Array.from({ length: total }, (_, i) => i),
        fanoutConcurrency(),
        async (i): Promise<PortValue> => {
          if (results[i]) {
            settleLF(i, null) // M30 重试：已成功片段直接返回；解链避免阻塞后续承接片段
            return results[i] as PortValue
          }
          if (total > 1) {
            genItems[i] = { ...genItems[i], status: 'running' }
            patchGen()
          }
          const fm = frameMetas[i] || {}
          const sshot = shotList[i] || shotList[0] || {}
          const cameraMotion = shotCameraMotion({ camera: fm.camera ?? sshot.camera, shotSize: fm.shotSize ?? sshot.shotSize })
          const vstyle = videoStyleTag(get().globals.stylePackId, get().globals.style) // M21：视频风格标签（i2v 由关键帧继承，t2v 直接受益）
          // fix 2 图生视频=运动优先：首帧已含画面，提示词聚焦「主体动作 + 摄影机运动(分开写) + 落点」，
          // 并强锚定首帧（保持构图/角色/光线/场景不变），避免重描整段场景导致模型漂移、偏离关键帧。
          // 文生视频无首帧，仍需完整场景描述。
          let framePrompt: string
          if (node.data.kind === 'i2v') {
            const action = [fm.motion, node.data.params?.motion].filter(Boolean).map(String).join(', ').trim()
            const subjectAction = action || String(fm.prompt || sshot.prompt || sshot.description || '')
            framePrompt = [
              subjectAction && `subject motion: ${subjectAction}`,
              cameraMotion && `camera ${cameraMotion}`,
              'animate the first frame only — keep its composition, characters, lighting, color and setting unchanged',
              'smooth, natural motion that settles at the end; no scene change, no hard cut, no morphing',
              vstyle,
            ]
              .filter(Boolean)
              .join(', ')
          } else {
            const shotPrompt =
              [fm.prompt, fm.motion].filter(Boolean).map(String).join(', ') || String(sshot.prompt || sshot.description || '')
            framePrompt = [[shotPrompt, cameraMotion].filter(Boolean).join(', ') || promptText, vstyle].filter(Boolean).join(', ')
          }
          // M-quick：钳制到视频模型支持区间 [4,15]s，防 LLM/手填异常时长被原样发出导致供应商报错
          const frameDuration = Math.min(Math.max(Number(fm.duration ?? sshot.duration ?? node.data.params?.duration ?? 5) || 5, 4), 15)
          // fix #5：本镜是否顺接到下一镜首帧——下一镜显式 continuousFromPrev 为准，缺省回退「同场景」启发式
          let contLast: string | undefined
          if (continuityOn && frameUrls[i + 1]) {
            const nm = frameMetas[i + 1] || {}
            const chain =
              nm.continuousFromPrev === true
                ? true
                : nm.continuousFromPrev === false
                  ? false
                  : !!fm.sceneId && String(fm.sceneId) === String(nm.sceneId ?? '')
            if (chain) contLast = frameUrls[i + 1]
          }
          let audioPrompt = ''
          let dialogue: { speaker: string; line: string; emotion?: string }[] | undefined
          if (audioMode === 'native') {
            const dialsRaw = (
              Array.isArray(fm.dialogues) ? fm.dialogues : Array.isArray(sshot.dialogues) ? sshot.dialogues : []
            ) as Array<Record<string, unknown>>
            dialogue = dialsRaw
              .map((d) => ({ speaker: String(d.character ?? d.speaker ?? ''), line: String(d.line ?? ''), emotion: d.emotion ? String(d.emotion) : undefined }))
              .filter((d) => d.line)
            const sfxRaw = fm.sfx ?? sshot.sfx
            const sfx = Array.isArray(sfxRaw) ? sfxRaw.map(String).join(', ') : String(sfxRaw ?? '')
            const ambient = String(fm.ambient ?? sshot.ambient ?? '')
            audioPrompt = buildAudioPrompt(dialogue, sfx, ambient, get().globals.dialogueLang || '中文') // 显式对白语言，防默认英文
          }
          // fix 4：承接片段取「上一片段真实尾帧」作首帧（抽帧失败/未就绪则回退本镜关键帧；停止则放弃接龙不挂起）
          const chainFirst = lfChainsFromPrev(i) ? await awaitOrStop(lfChain[i - 1], () => !get().isRunning) : null
          const { url } = await runVideo({
            cfg: provider,
            apiKey,
            req: {
              prompt: framePrompt || '',
              imageUrl: chainFirst || frameUrls[i] || undefined,
              lastImageUrl: tailUrls[i] || tailUrls[0] || contLast, // 显式尾帧优先，否则顺接到下一镜首帧
              seed: videoSeed, // seed 锁定：整段共用，跨片段更一致
              duration: frameDuration || undefined,
              audioMode,
              audioPrompt: audioMode === 'native' && audioPrompt ? audioPrompt : undefined,
              dialogue: audioMode === 'native' && dialogue && dialogue.length ? dialogue : undefined,
              videoUrl: refVideoUrl,
              drivingAudioUrl: refAudioUrl,
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
              patchNode(id, { stream: total > 1 ? `片段 ${i + 1}/${total} · ${base}…（已完成 ${done}/${total}）` : `${base}…` })
            },
          })
          let localPath: string | undefined
          try {
            localPath = await downloadVideoToDisk(url, `${(node.data.title || 'clip').replace(/\s+/g, '_')}_${i + 1}_${Date.now()}`)
          } catch {
            // 忽略
          }
          // fix 4：下一片段要承接本片段 → 从已下载的本片段抽取真实尾帧供其作首帧（best-effort，不阻塞产出）
          if (lfNeededAfter(i)) settleLF(i, (localPath ? await extractLastFrame(localPath, String(i)) : undefined) || null)
          else settleLF(i, null)
          let measured: number | undefined
          if (localPath && canProbe) measured = await probeDuration(localPath).catch(() => undefined)
          return {
            type: 'video',
            url,
            mime: 'video/mp4',
            durationSec: measured && measured > 0 ? measured : frameDuration,
            localPath,
            meta: { shot: fm.shot, hasAudio: audioMode === 'native', audioSource: audioMode },
          }
        },
        {
          retries: 2, // 失败重试 2 次（扛供应商限流/瞬时错误），减少静默丢片
          shouldStop: () => !get().isRunning,
          onSettled: (i, item) => {
            results[i] = item
            genItems[i] = { ...genItems[i], status: 'done', ref: item, mediaType: 'video' }
            done++
            const partial = results.filter(Boolean) as PortValue[]
            patchNode(id, {
              stream: `已完成 ${done}/${total}…`,
              gen: total > 1 ? { total, items: genItems.slice() } : undefined,
              outputs: partial.length
                ? { [outId]: { type: 'video', items: partial, url: partial[0].url, mime: 'video/mp4', durationSec: partial[0].durationSec, localPath: partial[0].localPath } }
                : undefined,
            })
          },
          onError: (i, err) => {
            settleLF(i, null) // 最终失败解链：后续承接片段回退用本镜关键帧，不会永久等待
            genItems[i] = { ...genItems[i], status: 'failed', error: err instanceof Error ? err.message : String(err) }
            failed++
            if (total > 1) patchGen()
          },
        }
      )
      const items = results.filter(Boolean) as PortValue[]
      if (items.length === 0) throw new Error('未生成任何视频')
      if (failed > 0)
        window.mulby?.notification?.show(
          `${total} 段里 ${failed} 段生成失败（已自动重试仍失败），已出 ${items.length} 段。节点上红框标出失败项，点「重试失败项」可单独补齐（成功的不重烧）。`,
          'warning'
        )
      const head = items[0]
      patchNode(id, {
        status: 'done',
        stream: undefined,
        // M30：有失败则保留 gen.items，失败片段画布上持续可见可重试；全成功才清空
        gen: failed > 0 ? { total, items: genItems } : undefined,
        outputs: { [outId]: { type: 'video', items, url: head.url, mime: 'video/mp4', durationSec: head.durationSec, localPath: head.localPath } },
      })
    } catch (e) {
      patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined, gen: undefined })
    } finally {
      useGraphStore.setState({ runningNodeId: null })
    }
    return
  }

  // 配音 TTS / 配乐 BGM / 音效 SFX 节点
  if (def.category === 'audio') {
    const inputs = gatherInputs(node, get().nodes, get().edges)
    const p = node.data.params || {}

    // 音效 SFX（P2-9）：按分镜 shots[].sfx/ambient 逐镜扇出生成音效，meta:{shot,kind:'sfx'} 供 compose 分轨混音
    if (node.data.kind === 'sfx') {
      const ps = useProviderStore.getState()
      const overrideId = (p.providerOverride as string) || ''
      const provider = overrideId ? ps.providers.find((x) => x.id === overrideId) || null : ps.getActiveFor('music')
      if (!provider) {
        patchNode(id, { status: 'error', error: '未配置音效供应商（顶栏「模型供应商」添加 music 能力的供应商）' })
        return
      }
      const sj = inputs['shots']?.[0]?.json as Record<string, unknown> | undefined
      const shots = Array.isArray(sj?.shots) ? (sj!.shots as Array<Record<string, unknown>>) : []
      const jobs = shots
        .map((s) => {
          const sfxArr = Array.isArray(s.sfx) ? (s.sfx as unknown[]).map(String) : s.sfx ? [String(s.sfx)] : []
          const ambient = s.ambient ? String(s.ambient) : ''
          const desc = [sfxArr.join(', '), ambient].filter(Boolean).join('; ')
          return { shot: s.id ? String(s.id) : undefined, desc }
        })
        .filter((j) => j.desc.trim())
      if (jobs.length === 0) {
        patchNode(id, { status: 'error', error: '分镜中无 sfx/ambient（需升级分镜节点或在分镜里填写）' })
        return
      }
      const apiKey = await ps.resolveKey(provider.id)
      if (!apiKey && provider.kind === 'fal') {
        patchNode(id, { status: 'error', error: '该供应商未配置 API Key' })
        return
      }
      useGraphStore.setState({ runningNodeId: id })
      patchNode(id, { status: 'running', stream: '生成音效…', error: undefined })
      try {
        const durationSec = Number(p.duration ?? 3) || 3
        const total = jobs.length
        const results = new Array<PortValue | undefined>(total)
        let done = 0
        await mapPool(
          jobs,
          fanoutConcurrency(),
          async (job): Promise<PortValue> => {
            const { url } = await runVideo({
              cfg: provider,
              apiKey,
              req: { prompt: job.desc, duration: durationSec },
              onProgress: (pr) => patchNode(id, { stream: `音效 ${done}/${total} · ${pr.status}…` }),
            })
            let localPath: string | undefined
            try {
              localPath = await downloadVideoToDisk(url, `sfx_${Date.now()}_${Math.round(durationSec)}`)
            } catch {
              // 下载失败仍可在线播放
            }
            return { type: 'audio', url, localPath, mime: 'audio/mpeg', durationSec, meta: { shot: job.shot, kind: 'sfx' } }
          },
          {
            shouldStop: () => !get().isRunning,
            onSettled: (i, item) => {
              results[i] = item
              done++
              patchNode(id, { stream: `音效 ${done}/${total}…` })
            },
          }
        )
        const items = results.filter(Boolean) as PortValue[]
        if (items.length === 0) throw new Error('未生成任何音效')
        const head = items[0]
        patchNode(id, {
          status: 'done',
          stream: undefined,
          outputs: { out: { type: 'audio', items, url: head.url, localPath: head.localPath, mime: head.mime, durationSec } },
        })
      } catch (e) {
        patchNode(id, { status: 'error', error: e instanceof Error ? e.message : String(e), stream: undefined })
      } finally {
        useGraphStore.setState({ runningNodeId: null })
      }
      return
    }

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

    // 语音供应商（统一在「模型供应商」面板配置，能力=tts，模式=sync-binary）
    const tps = useProviderStore.getState()
    const ttsOverride = (p.providerOverride as string) || ''
    const ttsProvider = ttsOverride ? tps.providers.find((x) => x.id === ttsOverride) || null : tps.getActiveFor('tts')
    if (!ttsProvider) {
      patchNode(id, { status: 'error', error: '未配置语音(TTS)供应商（顶栏「模型供应商」添加 OpenAI 兼容语音）' })
      return
    }
    // M18-C：对白来源（逐角色配音）——script-gen 的 scenes[].dialogues / storyboard 的 shots[].dialogues
    const dialJson = inputs['dialogues']?.[0]?.json as Record<string, unknown> | undefined
    const dialScenes: Array<Record<string, unknown>> = Array.isArray(dialJson?.scenes)
      ? (dialJson!.scenes as Array<Record<string, unknown>>)
      : Array.isArray(dialJson?.shots)
        ? (dialJson!.shots as Array<Record<string, unknown>>)
        : []
    const text = (inputs['in']?.[0]?.text || String(p.text ?? '')).trim()
    if (!dialScenes.length && !text) {
      patchNode(id, { status: 'error', error: '缺少配音文本/对白（连接上游文本或分场对白，或在参数中填写）' })
      return
    }
    const apiKey = await tps.resolveKey(ttsProvider.id)
    if (!apiKey) {
      patchNode(id, { status: 'error', error: '该语音供应商未配置 API Key' })
      return
    }
    const outId = def.outputs[0]?.id || 'out'
    const narrator = String(p.voice || ttsProvider.voices?.[0] || 'alloy')
    const ttsBase = {
      baseURL: String(ttsProvider.baseURL || 'https://api.openai.com/v1'),
      apiKey,
      model: String(p.model || ttsProvider.model || 'tts-1'),
      speed: Number(p.speed ?? 1) || 1,
      format: 'mp3',
    }
    useGraphStore.setState({ runningNodeId: id })
    patchNode(id, { status: 'running', stream: '合成配音…', error: undefined })
    try {
      // M18-C：逐角色对白 TTS——有 dialogues 输入时按行扇出，按 character 查 voiceMap，缺省回退 narrator
      if (dialScenes.length) {
        const voiceMap = new Map<string, string>()
        for (const v of inputs['chars'] || []) {
          const arr = (v.json as Record<string, unknown> | undefined)?.characters
          if (Array.isArray(arr))
            for (const c of arr as Array<Record<string, unknown>>)
              if (c?.name && c?.voiceId) voiceMap.set(String(c.name), String(c.voiceId))
        }
        // 扁平化所有对白行，再并发逐行合成（保序）
        const dlgJobs: { line: string; character: string; voice: string; sceneIndex: number; lineIndex: number }[] = []
        dialScenes.forEach((sc, si) => {
          const dials = sc.dialogues
          if (!Array.isArray(dials)) return
          ;(dials as Array<Record<string, unknown>>).forEach((d, li) => {
            const line = String(d.line ?? '').trim()
            if (!line) return
            const character = String(d.character ?? '')
            dlgJobs.push({ line, character, voice: voiceMap.get(character) || narrator, sceneIndex: si, lineIndex: li })
          })
        })
        if (dlgJobs.length) {
          const results = new Array<PortValue | undefined>(dlgJobs.length)
          let done = 0
          let failed = 0
          await mapPool(
            dlgJobs,
            fanoutConcurrency(),
            async (j): Promise<PortValue> => {
              const r = await synthSpeech(j.line, { ...ttsBase, voice: j.voice })
              const u = r.base64 ? `data:${r.mime};base64,${r.base64}` : toFileUrl(r.path)
              return {
                type: 'audio',
                url: u,
                localPath: r.path,
                mime: r.mime,
                meta: { character: j.character, sceneIndex: j.sceneIndex, lineIndex: j.lineIndex, voiceId: j.voice, kind: 'dialogue' },
              }
            },
            {
              shouldStop: () => !get().isRunning,
              onSettled: () => {
                done++
                patchNode(id, { stream: `配音 ${done}/${dlgJobs.length}…` })
              },
              onError: () => {
                failed++
              },
            }
          )
          const items = results.filter(Boolean) as PortValue[]
          if (items.length) {
            if (failed > 0) window.mulby?.notification?.show(`${failed} 句配音失败，已保留其余 ${items.length} 句`, 'warning')
            const head = items[0]
            patchNode(id, {
              status: 'done',
              stream: undefined,
              outputs: { [outId]: { type: 'audio', items, url: head.url, localPath: head.localPath, mime: head.mime } },
            })
            return
          }
        }
        if (!text) {
          patchNode(id, { status: 'error', error: '分场对白为空，无可合成内容' })
          return
        }
        // dialogues 无可用行但有 text → 回退单段旁白
      }
      // 单段文本配音（旁白）
      const { path, base64, mime } = await synthSpeech(text, { ...ttsBase, voice: narrator })
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
      // 1) 每个片段解析为本地文件（记录与 clipPaths 对齐的回退时长 + 分镜 id）
      const clipPaths: string[] = []
      const clipSrcDur: number[] = []
      const clipShotId: (string | undefined)[] = []
      for (let i = 0; i < clipVals.length; i++) {
        if (!get().isRunning) break
        patchNode(id, { stream: `准备片段 ${i + 1}/${clipVals.length}…` })
        const lp = await resolveLocalVideo(clipVals[i], `clip_${i}`)
        if (lp) {
          clipPaths.push(lp)
          clipSrcDur.push(Number(clipVals[i].durationSec ?? 5) || 5)
          const sid = clipVals[i].meta?.shot
          clipShotId.push(sid != null ? String(sid) : undefined)
        }
      }
      if (clipPaths.length === 0) throw new Error('无法获取任何片段的本地文件')
      // 2) 音轨（可选，多轨）；M18-D：展开扇出后按 meta 分类——对白(dialogue) vs 配乐/音效(music/sfx)，
      //    供 ffmpeg 分层混音 + 对白侧链 ducking。P0-2：未连音轨是合法的（无声片），仅提示不中断。
      const audioVals = (inputs['audio'] || []).flatMap(expandItems).filter((v) => v.type === 'audio')
      const audioTracks: AudioTrack[] = []
      for (const av of audioVals) {
        if (!get().isRunning) break
        const ap = await resolveLocalAudio(av).catch(() => undefined)
        if (!ap) continue
        const k = av.meta?.kind
        const role: AudioTrack['role'] =
          av.meta?.character || k === 'dialogue' ? 'dialogue' : k === 'sfx' ? 'sfx' : 'music'
        audioTracks.push({ path: ap, role })
      }
      if (audioTracks.length === 0) {
        patchNode(id, { stream: '注意：未连接音轨，成片将无声（可连 TTS/配乐到「配音/音乐」口）' })
      }
      // 3) 确保 ffmpeg 可用（首次按需下载）——提前到字幕之前，以便用实测时长对齐字幕
      patchNode(id, { stream: '检查 ffmpeg…' })
      const ready = await ensureFfmpeg((info) => patchNode(id, { stream: info.text }))
      if (!ready) throw new Error('ffmpeg 不可用（自动下载失败，请检查网络）')
      // 4) P0-3：实测每个片段真实时长（ffmpeg 已就绪），覆盖请求值，保证字幕与画面对齐
      const clipDurations: number[] = []
      for (let i = 0; i < clipPaths.length; i++) {
        if (!get().isRunning) break
        const measured = await probeDuration(clipPaths[i]).catch(() => undefined)
        clipDurations[i] = measured && measured > 0 ? measured : clipSrcDur[i]
      }
      // 5) 字幕（可选）：从分镜 JSON 按实测片段时长生成 SRT
      const subModeRaw = String(node.data.params?.subtitleMode ?? '关闭')
      // 显式映射 nodeDefs 的字幕选项标签 → ffmpeg 模式；未知值降级为 off
      const subtitleMode: SubtitleMode =
        subModeRaw === '烧录字幕' ? 'burn' : subModeRaw === '软字幕' ? 'soft' : 'off'
      // P2-10：转场（默认硬切）。xfade 会让总时长缩短 (N-1)*d，字幕时长须相应扣减以保持对齐
      const transRaw = String(node.data.params?.transition ?? '无转场')
      const transition: FilmTransition = transRaw === '交叉淡化' ? 'xfade' : transRaw === '淡入淡出' ? 'fade' : 'none'
      const xfadeD = transition === 'xfade' ? clampTransitionDur(undefined, clipDurations) : 0
      let srtPath: string | undefined
      const subsVal = inputs['subs']?.[0]
      if (subtitleMode !== 'off' && subsVal?.json) {
        // P1-2：带 shotId 让 buildSrt 按分镜 id 键匹配字幕；P2-10：xfade 时非首镜时长各扣 d，使字幕跟随交叠后画面
        const durations = clipDurations.map((d, i) => ({
          duration: Math.max(0.5, d - (xfadeD && i > 0 ? xfadeD : 0)),
          shotId: clipShotId[i],
        }))
        const srt = buildSrt(durations, subsVal.json)
        if (srt) srtPath = await writeText('subtitles', `sub_${Date.now()}.srt`, srt)
      }
      // 6) 合成
      const [w, h] = parseResolution(String(node.data.params?.resolution || '1280x720'))
      const fps = Number(node.data.params?.fps ?? 24) || 24
      const totalSec = clipDurations.reduce((a, d) => a + d, 0)
      const outPath = await exportPath(`film_${Date.now()}.mp4`)
      if (!get().isRunning) throw new Error('已取消')
      await composeFilm({
        clips: clipPaths,
        outPath,
        width: w,
        height: h,
        fps,
        audioTracks,
        ducking: true,
        srtPath,
        subtitleMode,
        totalSec,
        transition,
        clipDurations,
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
// 端口图像产物 → data: URL（供 fromDataUrl 抽出纯 base64 下发模型）。
// 注意：v.url 现为会话级 blob:/http URL（非 data: URL）——绝不能当 base64 直接返回，
// 否则下游 fromDataUrl 把整串 URL 当 base64、atob 报「not correctly encoded」（高清重绘/图生图崩）。
async function portImageDataUrl(v?: PortValue): Promise<string> {
  if (!v) return ''
  // 1) 内联 data: URL（旧工程/上传）直接用
  if (v.url && v.url.startsWith('data:')) return v.url
  // 2) 优先持久字节：assetId → data URL（最可靠，人物/场景素材走这里）
  if (v.assetId) {
    const a = await loadAsset(v.assetId)
    if (a) return toDataUrl(a.base64, a.mime)
  }
  // 3) 仅剩 blob:/http(s) 会话 URL：取回字节再转 data URL
  if (v.url) {
    try {
      const blob = await (await fetch(v.url)).blob()
      return await blobToDataUrl(blob)
    } catch {
      return ''
    }
  }
  return ''
}

/** Blob → data: URL（FileReader 出标准 data:<mime>;base64,<...>，供 fromDataUrl 解析） */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('blob 读取失败'))
    r.readAsDataURL(blob)
  })
}

interface RefImage {
  base64: string
  mime: string
  name?: string
  kind?: string // 'character' | 'scene'：用于关键帧参考图选择（角色按名匹配、场景按场过滤）
  locationKey?: string // P2-3：场景图的地点绑定键（同地点 master plate）
  isMasterPlate?: boolean // P2-3：该场景图是否为主场景板
  charId?: string // P1-5：角色稳定主键（优于 name 匹配）
  variantId?: string // M22a：形态键（时期/年龄）。与 charId 配合精确取「该期」参考图
  view?: string // P1-5：'front' | 'side' | 'back'（供按角度条件取图）
}

// 展开端口产物：有 items（扇出）则返回全部子项，否则返回自身
function expandItems(v: PortValue): PortValue[] {
  return v.items && v.items.length ? v.items : [v]
}

// M-quick：分镜总数上限——超过 maxShots（>0 才生效）则截断前 N 并显著告警，杜绝长剧本一次扇出几百镜
function capStoryboardShots(arr: unknown[], maxShots: number): unknown[] {
  if (!(maxShots > 0) || arr.length <= maxShots) return arr
  window.mulby?.notification?.show(
    `分镜数 ${arr.length} 超过上限 ${maxShots}，已截断保留前 ${maxShots} 个（丢弃 ${arr.length - maxShots} 个；节点参数「镜头总数上限」可调，0=不限）`,
    'warning'
  )
  return arr.slice(0, maxShots)
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
              locationKey: typeof it.meta?.locationKey === 'string' ? it.meta.locationKey : undefined,
              isMasterPlate: it.meta?.isMasterPlate === true,
              charId: typeof it.meta?.charId === 'string' ? it.meta.charId : undefined,
              variantId: typeof it.meta?.variantId === 'string' ? it.meta.variantId : undefined,
              view: typeof it.meta?.view === 'string' ? it.meta.view : undefined,
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

// 本轮运行里"角色名未匹配到参考图"的告警（runAll/runFrom 开头清空，notifyRunResult 汇总）
const refWarnings: string[] = []

// 匹配参考图（§5.2）：charId 精确（稳定主键）> name 精确 > 唯一命中的子串 > 唯一角色兜底；
// 否则告警 + 返回 null（不再静默回退第一张，避免错脸；多义命中也告警不猜）。
function pickRef(refs: RefImage[], name?: string, charId?: string, variantId?: string): RefImage | null {
  if (refs.length === 0) return null
  // 0) M22a：charId + variantId 精确（取「该时期」的图，最高优先）
  if (charId && variantId) {
    const exact = refs.find((r) => r.charId === charId && r.variantId === variantId)
    if (exact) return exact
  }
  // 1) charId 精确（变体未命中时回退该角色任一图=base 兜底；旧工程无 variantId 直接走这里，行为不变）
  if (charId) {
    const byId = refs.find((r) => r.charId === charId)
    if (byId) return byId
  }
  // 1.5) M-scene/prop：name + variantId 精确（物品状态/无 charId 的命名资产按变体取该状态图）
  if (name && variantId) {
    const nv = refs.find((r) => r.name === name && r.variantId === variantId)
    if (nv) return nv
  }
  // 2) name 精确
  if (name) {
    const exact = refs.find((r) => r.name === name)
    if (exact) return exact
    // 3) 收紧子串：仅当全局唯一命中才接受（避免「张三」误中「张三丰」）
    if (name.length >= 2) {
      const hits = refs.filter(
        (r) => r.name && r.name.length >= 2 && (r.name.includes(name) || name.includes(r.name))
      )
      if (hits.length === 1) return hits[0]
      if (hits.length > 1) {
        refWarnings.push(`角色「${name}」匹配到多张参考图（${hits.map((h) => h.name).join('/')}），未自动选择`)
        return null
      }
    }
  }
  // 4) 唯一角色合法兜底（soleName）；否则未匹配 → 告警 + null
  const chars = refs.filter((r) => r.kind !== 'scene')
  if (chars.length === 1) return chars[0]
  if (name || charId) refWarnings.push(`角色「${name ?? charId}」未匹配到参考图，已跳过（避免错脸）`)
  return null
}

// 多参考图匹配（该镜全部出场角色 → 多张角色图）：names 与 charIds 同序逐项匹配（charId 优先）并去重
function pickRefs(refs: RefImage[], names?: string[], fallbackName?: string, charIds?: string[], variantIds?: string[]): RefImage[] {
  const charRefs = refs.filter((r) => r.kind !== 'scene')
  if (charRefs.length === 0) return []
  const N = Math.max(names?.length ?? 0, charIds?.length ?? 0, variantIds?.length ?? 0)
  const picked: RefImage[] = []
  for (let i = 0; i < N; i++) {
    const r = pickRef(charRefs, names?.[i], charIds?.[i], variantIds?.[i] || undefined)
    if (r && !picked.includes(r)) picked.push(r)
  }
  if (!N && fallbackName) {
    const r = pickRef(charRefs, fallbackName)
    if (r) picked.push(r)
  }
  // 无任何指定且无 fallback：唯一角色兜底（保留 soleName 行为）
  if (!N && !fallbackName && charRefs.length === 1) return [charRefs[0]]
  // P0-4：不再 `[refs[0]]` 兜底——全部未匹配时返回空，该镜走纯生成而非用错脸 img2img
  return picked
}

// 关键帧参考图选择：角色图按出场角色名匹配；场景图 P2-3 改为按本场过滤（只取本地点 master plate），
// 根治"场景图全收→跨场污染"。无 sceneName/locationKey（旧工程）时回退全收，保证不破坏现有产出。
// 角色排在前（primary 主参考用于强一致性），场景在后。
function selectRefs(
  refs: RefImage[],
  names?: string[],
  fallbackName?: string,
  charIds?: string[],
  sceneName?: string,
  locationKey?: string,
  propNames?: string[],
  variantIds?: string[],
  propVariantIds?: string[],
  sceneVariantId?: string
): RefImage[] {
  // 角色：非 scene/prop 的图按角色名匹配（M22a：同序 variantIds 精确取该时期图）
  const chars = pickRefs(
    refs.filter((r) => r.kind !== 'scene' && r.kind !== 'prop'),
    names,
    fallbackName,
    charIds,
    variantIds
  )
  // 物品：kind==='prop' 的图按物品名匹配（无名指定且唯一物品时兜底，由 pickRefs 处理）
  const props = pickRefs(
    refs.filter((r) => r.kind === 'prop'),
    propNames,
    undefined,
    undefined,
    propVariantIds
  )
  const sceneRefs = refs.filter((r) => r.kind === 'scene')
  // M-scene/prop：场景时段/天气变体——归一化匹配（变体键/标签 对 sceneVariantId，大小写/子串）
  const svNorm = String(sceneVariantId ?? '').toLowerCase().trim()
  const sceneVariantHit = (r: RefImage) => {
    const vid = String(r.variantId ?? '').toLowerCase().trim()
    return !!svNorm && !!vid && (vid === svNorm || vid.includes(svNorm) || svNorm.includes(vid))
  }
  let scenes: RefImage[]
  if (locationKey || sceneName) {
    const match = sceneRefs.filter(
      (r) =>
        (locationKey && r.locationKey === locationKey) ||
        (sceneName && (r.name === sceneName || (r.name?.includes(sceneName) ?? false) || (sceneName.includes(r.name ?? ' '))))
    )
    if (match.length) {
      // 命中本场：优先该时段变体，其次 master plate，否则取首个；只取一张避免污染
      scenes = [match.find(sceneVariantHit) || match.find((r) => r.isMasterPlate) || match[0]]
    } else {
      // 指定了场但无对应场景图：宁缺毋滥（不拿别场的图），返回空
      scenes = []
    }
  } else {
    scenes = sceneRefs // 旧工程：无场名参数 → 维持全收回退
  }
  const out: RefImage[] = []
  for (const r of [...chars, ...props, ...scenes]) if (r && !out.includes(r)) out.push(r)
  // 散参考图（用户手动连入「参考图」口的素材图：无名、非场景/物品/角色）→ 一律作为视觉参考喂入，
  // 不再因「匹配不到命名角色」而被静默丢弃（修复：拖 N 张素材进关键帧却不按参考图生成）。
  const generics = refs.filter((r) => !r.name && r.kind !== 'scene' && r.kind !== 'prop')
  for (const r of generics) if (!out.includes(r)) out.push(r)
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

// 递归剥离大体积/临时 URL（data: 与 blob: 含扇出 items）；保留远程/本地文件链接与 assetId。
// 关键：必须同时剥离 blob:——否则 hydrate 出的 blob: 会被写进工程 JSON，二次打开时
// `assetId && !url` 守卫看到死 blob: 而跳过 hydration → 永久坏图。
function stripValue(v: PortValue): PortValue {
  let out: PortValue = v.items?.length ? { ...v, items: v.items.map(stripValue) } : v
  if (MEDIA_TYPES.includes(out.type) && isEphemeralUrl(out.url)) {
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
    return { ...n, data: { ...d, outputs, stream: undefined, previewUrl: undefined, gen: undefined } }
  })
}

// 递归补水：按 assetId 回填 blob: url（含扇出 items）。用 blob: 替代 data:——消除主线程 base64 解码
async function hydrateValue(v: PortValue): Promise<PortValue> {
  let out: PortValue = v.items?.length ? { ...v, items: await Promise.all(v.items.map(hydrateValue)) } : v
  if (MEDIA_TYPES.includes(out.type) && out.assetId && !out.url) {
    const url = await loadAssetUrl(out.assetId)
    if (url) out = { ...out, url }
  }
  return out
}

// hydration epoch：整组替换 nodes（切/删/恢复工程）时自增，让在途 hydrate 的延迟 writeback 失效
let hydrateEpoch = 0
function bumpHydrateEpoch() {
  hydrateEpoch++
}
const HYDRATE_CONCURRENCY = 6

function collectAssetIds(v: PortValue, acc: string[]): void {
  if (v.assetId) acc.push(v.assetId)
  if (v.items) for (const it of v.items) collectAssetIds(it, acc)
}
/** 两组 outputs 的 assetId 序列是否一致——用于 writeback 前逐节点复核，防跨工程/跨重生串改 */
function sameAssetShape(a: Record<string, PortValue>, b: Record<string, PortValue>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if (!(k in b)) return false
    const ida: string[] = []
    const idb: string[] = []
    collectAssetIds(a[k], ida)
    collectAssetIds(b[k], idb)
    if (ida.length !== idb.length) return false
    for (let i = 0; i < ida.length; i++) if (ida[i] !== idb[i]) return false
  }
  return true
}

// 加载工程后补水：有界并发取 blob: url，最后**单次** setState 写回（消除逐节点 patchNode 重渲染风暴）。
// epoch + 逐节点 assetId 形状复核：期间若整组替换了 nodes 或当前工程已变，则丢弃本批 writeback，
// 关闭 duplicateProject 复制源节点 id 造成的跨工程串改窗口。
async function hydrateAssets(opts?: { onlyNodeIds?: Set<string> }) {
  const get = useGraphStore.getState
  const startEpoch = hydrateEpoch
  const startProject = get().currentId
  const targets = get().nodes.filter(
    (n) => n.data.outputs && (!opts?.onlyNodeIds || opts.onlyNodeIds.has(n.id))
  )
  const patches = new Map<string, Record<string, PortValue>>()
  await mapPool(targets, HYDRATE_CONCURRENCY, async (n) => {
    const outs = n.data.outputs
    if (!outs) return
    let changed = false
    const next: Record<string, PortValue> = {}
    for (const [k, v] of Object.entries(outs)) {
      const nv = await hydrateValue(v)
      next[k] = nv
      if (nv !== v) changed = true
    }
    if (changed) patches.set(n.id, next)
  })
  if (patches.size === 0) return
  // bail：期间发生整组替换或切了工程 → 丢弃，避免把 A 工程的 url 写进 B
  if (hydrateEpoch !== startEpoch || get().currentId !== startProject) return
  useGraphStore.setState((s) => ({
    nodes: s.nodes.map((n) => {
      const next = patches.get(n.id)
      if (!next) return n
      // 逐节点复核：当前 outputs 的 assetId 形状须与 hydrate 时一致，否则跳过该节点
      if (!n.data.outputs || !sameAssetShape(n.data.outputs, next)) return n
      return { ...n, data: { ...n.data, outputs: next } }
    }),
  }))
}

/** 估算当前视口内的节点 id（用窗口尺寸 + ReactFlow viewport 变换，宽裕 margin 防临界闪烁） */
function visibleNodeIds(): Set<string> | null {
  const { nodes, viewport } = useGraphStore.getState()
  if (!viewport || !viewport.zoom || typeof window === 'undefined') return null
  const { x, y, zoom } = viewport
  const w = window.innerWidth || 1280
  const h = window.innerHeight || 800
  const margin = 600
  const minX = -x / zoom - margin
  const maxX = (w - x) / zoom + margin
  const minY = -y / zoom - margin
  const maxY = (h - y) / zoom + margin
  const ids = new Set<string>()
  for (const n of nodes) {
    const px = n.position?.x ?? 0
    const py = n.position?.y ?? 0
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) ids.add(n.id)
  }
  return ids
}

/** 可视优先补水：先 hydrate 视口内节点（缩短首屏可见缩略图时间），其余排到空闲回调 */
function hydrateVisibleFirst() {
  const visible = visibleNodeIds()
  if (!visible || visible.size === 0) {
    void hydrateAssets().catch(() => {}) // 无视口信息：全量 hydrate
    return
  }
  void hydrateAssets({ onlyNodeIds: visible })
    .catch(() => {})
    .finally(() => {
      const idle = (cb: () => void) =>
        typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(() => cb()) : setTimeout(cb, 0)
      idle(() => void hydrateAssets().catch(() => {})) // 其余（离屏）节点空闲补水；已 hydrate 的会被跳过
    })
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

// P2-12 联动：文本 json 节点逐项扇出时，各 kind 要合并的数组字段（outline 多数组，不参与扇出）
const TEXT_ARRAY_KEY: Record<string, string> = {
  storyboard: 'shots',
  'script-gen': 'scenes',
  'char-sheet': 'characters',
}

// P1-6：各 kind 的提示词模板 id（变更需让缓存失效）。prompt-fx 按 mode 另算。
const KIND_PROMPT_IDS: Record<string, string[]> = {
  'script-gen': ['text.script'],
  storyboard: ['text.storyboard'],
  'char-sheet': ['text.charsheet'],
  'char-image': ['image.charImage'],
  'scene-image': ['image.sceneImage'],
  keyframe: ['image.keyframe'],
  character: ['image.assetCharacter'],
  scene: ['image.assetScene'],
}
const FX_MODE_PROMPT_ID: Record<string, string> = {
  中译英: 'text.fx.zh2en',
  英译中: 'text.fx.en2zh',
  风格化: 'text.fx.stylize',
  扩写: 'text.fx.expand',
}

// inputHash 的 salt：全局画风/画幅 + 该节点用到的提示词模板（覆盖变更应使缓存失效）
function nodeCacheSalt(node: FilmNode): string {
  const g = useGraphStore.getState().globals
  const ids = [...(KIND_PROMPT_IDS[node.data.kind] || [])]
  if (node.data.kind === 'prompt-fx') {
    ids.push(FX_MODE_PROMPT_ID[String(node.data.params?.mode ?? '扩写')] || 'text.fx.expand')
  }
  if (node.data.kind === 'outline') {
    ids.push(String(node.data.params?.structure ?? '') === 'Story-Circle' ? 'text.outline.storycircle' : 'text.outline.savecat')
  }
  const prompts = ids.map((id) => getPrompt(id)).join('')
  return `${g.stylePackId || ''}${g.style || ''}${g.aspectRatio || ''}${prompts}`
}

// 依赖驱动的并发执行（runAll / runFrom 共用）：节点的全部上游（限本批内）完成后即可启动，
// 互不依赖的节点并发跑（如 分镜 ∥ 角色设定、角色图 ∥ 场景图）。并发上限取「并发设置」。
// 数据驱动级联阻断：上游无可用产出才跳过。P1-6 锁定/输入指纹缓存语义不变。
function isBatchEligible(n: FilmNode): boolean {
  const def = getNodeDef(n.data.kind)
  if (!def) return false
  return (
    def.category === 'input' ||
    def.category === 'text' ||
    def.category === 'image' ||
    def.category === 'video' ||
    def.category === 'audio' ||
    // export 节点会弹保存对话框，仅单独运行时触发，不纳入批量
    (def.category === 'output' &&
      (n.data.kind === 'preview' || n.data.kind === 'compose' || n.data.kind === 'merge' || n.data.kind === 'timeline' || n.data.kind === 'foreach'))
  )
}

async function runOrder(order: FilmNode[]): Promise<{ errored: string[]; skipped: string[] }> {
  const errored: string[] = []
  const skipped: string[] = []
  const runSet = order.filter(isBatchEligible) // 保留拓扑序，就绪时同序优先，保证确定性
  const runIds = new Set(runSet.map((n) => n.id))
  // 依赖：本批内指向该节点的上游边
  const st0 = useGraphStore.getState()
  const depsOf = new Map<string, Set<string>>()
  for (const n of runSet) {
    const deps = new Set<string>()
    for (const e of st0.edges) if (e.target === n.id && runIds.has(e.source)) deps.add(e.source)
    depsOf.set(n.id, deps)
  }
  // 单节点处理（锁定/跳过/缓存/执行）——与原顺序版逐节点逻辑一致；从 live 状态读（上游已完成→产物可用）
  const processNode = async (n: FilmNode): Promise<void> => {
    const def = getNodeDef(n.data.kind)
    if (!def) return
    const cur0 = useGraphStore.getState().nodes.find((x) => x.id === n.id) || n
    if (cur0.data.locked === true) {
      const hasOutputs = !!cur0.data.outputs && Object.keys(cur0.data.outputs).length > 0
      if (!hasOutputs) patchNode(n.id, { status: 'error', error: '已锁定但无产物，请先解锁并运行' })
      return
    }
    const st = useGraphStore.getState()
    const hasIncoming = st.edges.some((e) => e.target === n.id)
    if (hasIncoming) {
      const ins = gatherInputs(n, st.nodes, st.edges)
      const hasData = Object.values(ins).some((arr) => arr && arr.length > 0)
      if (!hasData) {
        skipped.push(n.data.title || def.label)
        patchNode(n.id, { status: 'error', error: '已跳过：上游未产出可用输入' })
        return
      }
    }
    const live = useGraphStore.getState()
    const liveNode = live.nodes.find((x) => x.id === n.id) || n
    const inputHash = computeInputHash(liveNode, live.nodes, live.edges, nodeCacheSalt(liveNode))
    const hasOutputs = !!liveNode.data.outputs && Object.keys(liveNode.data.outputs).length > 0
    if (liveNode.data.cache?.inputHash === inputHash && hasOutputs) return // 命中缓存：保留 outputs 与 status
    await execNode(n.id)
    const c = useGraphStore.getState().nodes.find((x) => x.id === n.id)
    if (c?.data.status === 'error') errored.push(c.data.title || def.label)
    else patchNode(n.id, { cache: { inputHash, at: Date.now() } })
  }
  // 调度：deps 全 done 即就绪，并发上限 cap（取并发设置；设为 1 即退化为全顺序）
  const cap = Math.max(1, fanoutConcurrency())
  const doneIds = new Set<string>()
  const remaining = new Set(runSet.map((n) => n.id))
  let running = 0
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (useGraphStore.getState().isRunning) {
        for (const n of runSet) {
          if (running >= cap) break
          if (!remaining.has(n.id)) continue
          let ready = true
          for (const d of depsOf.get(n.id)!) if (!doneIds.has(d)) { ready = false; break }
          if (!ready) continue
          remaining.delete(n.id)
          running++
          processNode(n)
            .catch(() => {})
            .finally(() => {
              doneIds.add(n.id) // 无论成功/失败/跳过都算「完成」，解锁下游（下游会因无数据自行跳过）
              running--
              pump()
            })
        }
      } else {
        remaining.clear() // 已取消：不再调度新节点（在飞节点内部 shouldStop 自行收尾）
      }
      if (remaining.size === 0 && running === 0) resolve()
    }
    pump()
  })
  return { errored, skipped }
}

function notifyRunResult(errored: string[], skipped: string[]) {
  // P0-4：参考图未匹配告警（去重后汇总），即使无 errored/skipped 也提示，避免静默错脸被忽略
  if (refWarnings.length) {
    const uniq = Array.from(new Set(refWarnings))
    window.mulby?.notification?.show(
      `参考图提示：${uniq.slice(0, 2).join('；')}${uniq.length > 2 ? ` 等 ${uniq.length} 项` : ''}`,
      'warning'
    )
  }
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
    // 读索引（fail-fast）：空/缺/损坏 → 从存活工程自愈重建（修复历史竞态留下的空索引/重复）。
    // 正常路径（索引存在且非空）跳过 list+getMany 扫描，仅 seed 基线、不写——避免每次启动 O(N) 开销。
    let index: ProjectCard[] = []
    let version: number | null = null
    try {
      const meta = await readIndexMeta()
      index = meta.index
      version = meta.version
      if (index.length === 0) {
        const rebuilt = await rebuildIndexFromProjects()
        if (rebuilt.length > 0) {
          index = rebuilt
          version = (await commitIndex(index, version)).version
        }
      }
    } catch {
      index = await rebuildIndexFromProjects() // 索引损坏：从存活工程重建
      version = index.length > 0 ? (await commitIndex(index, null)).version : null
    }
    if (index.length === 0) {
      // 真的空（全新安装/无任何工程）→ 建默认工程
      const def = makeDefaultProject()
      await ssetProject(def)
      index = [toCard(def)]
      version = (await commitIndex(index, version)).version
      await sset(KEY_CURRENT, def.id)
    }
    // 顺序不变量：在 loaded:true 之前 seed 锁基线，保证首次 save 见到非空基线
    lastGoodIndex = index
    indexVersion = version
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
      index = mergeCards(index, [toCard(def)])
      indexVersion = (await commitIndex(index, indexVersion)).version
      lastGoodIndex = index
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
    hydrateVisibleFirst()
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
    // 人物/场景/物品上传的参考图带上名字 + kind，供关键帧按名匹配 / 场景按地点（一致性）
    const name = node?.data.params?.name ? String(node.data.params.name) : ''
    const kind =
      node?.data.kind === 'character' || node?.data.kind === 'scene' || node?.data.kind === 'prop' ? node.data.kind : undefined
    const meta = name || kind ? { ...(name ? { name } : {}), ...(kind ? { kind } : {}) } : undefined
    const img: PortValue = { type: 'image', assetId, mime, ...(meta ? { meta } : {}) }
    const prev = node?.data.outputs || {}
    patchNode(id, { status: 'done', error: undefined, outputs: { ...prev, [port]: img } })
    void safeSave()
  },

  setNodeAudio: async (id, dataUrl) => {
    const { base64, mime } = fromDataUrl(dataUrl)
    const assetId = await saveAsset(base64, mime || 'audio/mpeg')
    patchNode(id, {
      status: 'done',
      error: undefined,
      outputs: { out: { type: 'audio', assetId, mime: mime || 'audio/mpeg' } },
    })
    void safeSave()
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
      // 去生成时 data: url；显式清掉 ...target 带来的旧 url，避免显示编辑前的旧图（useMediaUrl 按新 assetId 解析）
      const newItem: PortValue = { ...target, assetId: newAssetId, url: undefined, mime: r.mime }
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
      void safeSave()
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
      const matched = canEdit
        ? selectRefs(
            refs,
            job.refNames,
            job.refName,
            job.refCharIds,
            job.meta?.sceneName as string | undefined,
            job.meta?.locationKey as string | undefined,
            job.refPropNames,
            job.refVariantIds,
            job.refPropVariantIds,
            job.sceneVariantId
          )
        : []
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
      const newItem: PortValue = { type: 'image', assetId, mime, meta: job.meta }
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
      void safeSave()
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
    void safeSave()
    return null
  },

  loadTemplate: async (templateId) => {
    const tpl = TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    if (get().dirty) await safeSave() // 切换前先保存（失败不阻断切换，由 safeSave 提示+重试）
    const { nodes, edges } = instantiateTemplate(tpl)
    const proj = makeDefaultProject(tpl.name)
    proj.nodes = nodes
    proj.edges = edges
    await ssetProject(proj)
    const index = await mutateIndex((cur) => upsertCard(cur, toCard(proj)))
    await sset(KEY_CURRENT, proj.id)
    set({
      projects: index,
      currentId: proj.id,
      projectName: proj.name,
      globals: normGlobals(proj.globals),
      promptOverrides: proj.promptOverrides || {},
      nodes,
      edges,
      viewport: proj.viewport,
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
      void safeSave()
    } catch (e) {
      patchNode(id, { stream: undefined })
      window.mulby?.notification?.show(e instanceof Error ? e.message : '下载失败', 'error')
    }
  },

  insertAssetNode: async (rec, position) => {
    if (rec.type === 'video') {
      window.mulby?.notification?.show('视频媒体文件暂不支持插入画布（可在媒体文件页预览/导出）', 'warning')
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
        ? {
            name: el.name,
            appearance: el.description || '',
            ...(el.identity ? { identity: el.identity } : {}), // M27：身份回填
            refPrompt: el.prompt || '',
            ...(el.appearanceVariants?.length ? { variantsJson: JSON.stringify(el.appearanceVariants) } : {}), // M27：时期变体回填
          }
        : { name: el.name, description: el.description || '', refPrompt: el.prompt || '' }
    const data: FilmNodeData = { kind, title: el.name || def.label, params, status: 'idle' }
    // P1-5：绑定全部视图/参考图（不再只取第一张），charId/voiceId/view 经 meta 下沉供 keyframe/tts 解析。
    // charId 缺省回退到 el.id（复用同一主键命名空间）；views 缺省回退 refAssetIds。
    const charId = el.charId ?? el.id
    const viewPairs: Array<[string | undefined, string | undefined]> = el.views
      ? [['front', el.views.front], ['side', el.views.side], ['back', el.views.back]]
      : []
    const bound = viewPairs.filter(([, a]) => a) as Array<[string, string]>
    const refList: Array<[string | undefined, string]> = bound.length
      ? bound
      : (el.refAssetIds || []).map((a) => [undefined, a])
    const items: PortValue[] = []
    for (const [view, assetId] of refList) {
      if (!assetId) continue
      const a = await loadAsset(assetId)
      if (!a) continue
      items.push({
        type: 'image',
        assetId,
        url: toDataUrl(a.base64, a.mime),
        mime: a.mime,
        meta: { name: el.name, charId, kind, ...(el.voiceId ? { voiceId: el.voiceId } : {}), ...(view ? { view } : {}) },
      })
    }
    // M27：库角色各时期变体的已生成视图也下沉为图像项（带 variantId），供 keyframe 按 (charId,variantId) 取该期图
    for (const v of el.appearanceVariants || []) {
      const vv: Array<[string, string | undefined]> = v.views
        ? [['front', v.views.front], ['side', v.views.side], ['back', v.views.back]]
        : []
      for (const [view, assetId] of vv) {
        if (!assetId) continue
        const a = await loadAsset(assetId)
        if (!a) continue
        items.push({
          type: 'image',
          assetId,
          url: toDataUrl(a.base64, a.mime),
          mime: a.mime,
          meta: { name: el.name, charId, kind, variantId: v.id, view },
        })
      }
    }
    if (items.length) {
      const head = items[0]
      data.outputs = {
        image: { type: 'image', items, assetId: head.assetId, url: head.url, mime: head.mime, meta: head.meta },
      }
      data.status = 'done'
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
    bumpHydrateEpoch() // 同工程内整组替换：让在途 hydrate 的延迟 writeback 失效
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
      void safeSave()
    }
  },

  retryFailedItems: async (id) => {
    if (get().isRunning) return
    const node = get().nodes.find((n) => n.id === id)
    const items = node?.data.gen?.items
    if (!items || !items.some((it) => it.status === 'failed')) return // 无失败项则不动
    set({ isRunning: true })
    try {
      await execNode(id, { retryFailed: true }) // 仅补失败项，已成功命中种子不重烧
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void safeSave()
    }
  },

  runAll: async () => {
    if (get().isRunning) return
    refWarnings.length = 0
    const order = topoOrder(get().nodes, get().edges)
    set({ isRunning: true })
    try {
      const r = await runOrder(order)
      notifyRunResult(r.errored, r.skipped)
    } finally {
      set({ isRunning: false, runningNodeId: null })
      void safeSave()
    }
  },

  runFrom: async (id) => {
    if (get().isRunning) return
    refWarnings.length = 0
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
      void safeSave()
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

  // P2-13：复制选中节点（含内部连线）——新 id + 偏移，剥离产物/状态/缓存/锁定（粘贴出的副本为 idle）
  duplicateSelected: () => {
    const ids = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id))
    const sel = get().selectedNodeId
    if (sel) ids.add(sel)
    if (ids.size === 0) return
    const idMap = new Map<string, string>()
    for (const oid of ids) idMap.set(oid, `n_${nanoid(6)}`)
    const newNodes: FilmNode[] = get()
      .nodes.filter((n) => ids.has(n.id))
      .map((n) => ({
        ...n,
        id: idMap.get(n.id) as string,
        position: { x: n.position.x + 32, y: n.position.y + 32 },
        selected: true,
        data: {
          ...n.data,
          outputs: undefined,
          status: 'idle',
          stream: undefined,
          previewUrl: undefined,
          error: undefined,
          cache: undefined,
          locked: undefined,
        },
      }))
    const newEdges: Edge[] = get()
      .edges.filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e, id: `e_${nanoid(6)}`, source: idMap.get(e.source) as string, target: idMap.get(e.target) as string }))
    set({
      nodes: [...get().nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...newNodes],
      edges: [...get().edges, ...newEdges],
      selectedNodeId: newNodes.length === 1 ? newNodes[0].id : null,
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

  toggleNodeLock: (id) => {
    set({
      nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, locked: !n.data.locked } } : n)),
      dirty: true,
    })
    scheduleSave(() => get().saveProject())
  },

  setViewport: (vp) => {
    // P2-13：视口变更防抖落盘（不置 dirty 触发整图保存提示，仅随项目持久化）
    set({ viewport: vp })
    scheduleSave(() => get().saveProject())
  },

  setSelected: (id) => set({ selectedNodeId: id }),

  // ============ 工程管理 ============
  newProject: async () => {
    if (get().dirty) await safeSave() // 切换前先保存（失败不阻断新建）
    const def = makeDefaultProject(`工程 ${get().projects.length + 1}`)
    await ssetProject(def)
    const index = await mutateIndex((cur) => upsertCard(cur, toCard(def)))
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
    try {
      const existing = await sgetProject(currentId) // 容错：单个工程键不可读不阻断保存
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
        viewport: get().viewport, // P2-13：视口落盘
      }
      // 先写当前工程重型键（失败抛错，不动索引）
      if (!(await ssetProject(data))) throw new IndexWriteError('write project data failed')
      // 索引项更新经唯一收口 mutateIndex（锁内重读 + shrink-guard + CAS），根除并发覆盖
      const index = await mutateIndex((cur) => upsertCard(cur, toCard(data)))
      set({ projects: index, dirty: false, saving: false })
    } catch (e) {
      set({ dirty: true, saving: false }) // 失败：保持 dirty 以待重试，绝不清 dirty/覆盖列表
      throw e
    }
  },

  switchProject: async (id) => {
    if (id === get().currentId) return
    if (get().dirty) await safeSave() // 切换前先保存（失败不阻断切换）
    const target = await sgetProject(id)
    if (!target) return
    await sset(KEY_CURRENT, id)
    bumpHydrateEpoch() // 切工程：让上一工程在途 hydrate 的 writeback 失效（防串改）
    set({
      currentId: id,
      projectName: target.name,
      globals: normGlobals(target.globals),
      promptOverrides: target.promptOverrides || {},
      nodes: target.nodes || [],
      edges: target.edges || [],
      viewport: target.viewport,
      selectedNodeId: null,
      dirty: false,
    })
    syncProjectPromptLayer(target.promptOverrides)
    hydrateVisibleFirst()
  },

  deleteProject: async (id) => {
    await sremProject(id) // 先删重型图键，再改索引——关闭「索引已删但数据还在 → 复活」窗口
    // 清掉该工程的命名快照，避免快照长期 pin 住孤儿素材
    const snaps = (await sget<ProjectSnapshot[]>(KEY_SNAPSHOTS)) || []
    if (snaps.some((s) => s.projectId === id)) await sset(KEY_SNAPSHOTS, snaps.filter((s) => s.projectId !== id))
    // 删除是显式收缩 → allowShrink，跳过 shrink-guard
    let index = await mutateIndex((cur) => removeCardById(cur, id), { allowShrink: true })
    const wasCurrent = get().currentId === id
    let currentId = get().currentId
    let current: ProjectData | null = null
    if (index.length === 0) {
      // 删光了：建一个默认工程兜底
      const def = makeDefaultProject()
      await ssetProject(def)
      index = await mutateIndex((cur) => upsertCard(cur, toCard(def)))
      current = def
      currentId = def.id
      await sset(KEY_CURRENT, currentId)
    }
    if (wasCurrent && !current) {
      currentId = index[0].id
      await sset(KEY_CURRENT, currentId)
      current = await sgetProject(currentId)
    }
    if (wasCurrent) {
      bumpHydrateEpoch() // 删当前工程后切到另一工程：让在途 hydrate 失效
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
      hydrateVisibleFirst()
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
    const index = await mutateIndex((cur) => renameCard(cur, id, name, ts))
    set({ projects: index })
  },

  duplicateProject: async (id) => {
    if (id === get().currentId && get().dirty) await safeSave()
    const src = await sgetProject(id)
    if (!src) return null
    const ts = now()
    // 复制共享同一批 assetId（附件按 id 共享，无需复制二进制）；新 id/名称/时间
    const copy: ProjectData = { ...src, id: `proj_${nanoid(8)}`, name: `${src.name} 副本`, createdAt: ts, updatedAt: ts }
    await ssetProject(copy)
    const index = await mutateIndex((cur) => upsertCard(cur, toCard(copy)))
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
          ? {
              ...c,
              name: curName,
              nodeCount: curNodes.length,
              coverAssetId: pickCoverAssetId(curNodes) ?? c.coverAssetId,
              aspectRatio: get().globals.aspectRatio,
              style: get().globals.style,
            }
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
    bumpHydrateEpoch() // 原地替换当前工程内容：让在途 hydrate 失效
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
