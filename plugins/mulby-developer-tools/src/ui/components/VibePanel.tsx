import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  Sparkles, Wand2, FolderSearch, Loader2, Check, ChevronRight, X,
  Hammer, ShieldCheck, FolderOpen, AlertTriangle,
  RefreshCw, Image as ImageIcon, Rocket, FileText, Lightbulb,
  Pencil, Boxes, FileEdit, FileSearch, Terminal, Bug, Wrench, ListChecks,
  ChevronUp, ChevronDown, History, RotateCcw, GitCommit, Tag, UploadCloud, Copy, MoreHorizontal
} from 'lucide-react'
import type { LogLevel } from '../types'
import type { UseDeveloperResult } from '../hooks/useDeveloper'
import { ContractEditor } from './ContractEditor'
import { PublishDialog } from './PublishDialog'
import { PublishStatusBadge } from './PublishStatus'
import { loadPublishRecord, savePublishRecord, getStoredToken, getStoredLogin, fetchPublishLive, discoverPluginPR, rerunPR, type PublishRecord, type PublishLive } from '../lib/github'
import {
  type VibeContract, defaultContract, normalizeContract, manifestToContract,
  manifestJson, primaryTrigger, primaryFeatureCode, contractSummary, triggerLabel, validateContract
} from '../lib/vibeContract'
import { useSession, SessionSwitcher, ChatPanel } from '../vibe'
import type { VibeSession, VibeSessionState, VibeAction, BrainstormOption, ClarifyQuestion, ClarifyApproach, ClarifyQA, ClarifyState, VibeMessage, VibePlanTodo, VibePlanPhase } from '../vibe'

export interface VibeEditTarget {
  path: string
  id?: string
  displayName?: string
  /** 携带的修复指令（如 PR 审查意见回流）：会话就绪后自动交给 AI 执行 */
  instruction?: string
  token: number
}

export interface KnownPlugin {
  path: string
  id: string
  displayName: string
}

/** 一条版本历史记录（来自后端 vcs_log） */
export interface VcsCommit {
  hash: string
  short: string
  message: string
  dateISO: string
  tags: string[]
}

/** 本次 Vibe 会话相对开始时的单个文件改动（来自后端 vibe_changes） */
export interface VibeChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  before: string | null
  after: string | null
  truncated?: boolean
}

/** 生成后 AI 自审（requesting-code-review）发现的单条问题 */
interface ReviewIssue {
  level: 'critical' | 'important' | 'minor'
  file?: string
  message: string
  hint?: string
}

/** 契约一致性校验的单条问题（来自后端 check_conformance） */
export interface ConformanceIssue {
  level: 'error' | 'warn' | 'info'
  code: string
  message: string
  hint?: string
}
export interface ConformanceResult {
  ok: boolean
  ran: boolean
  issues: ConformanceIssue[]
  summary?: string
}

/** 用示例输入真实跑一次某功能的结果（运行验证 smoke） */
export interface SmokeResult {
  code: string
  label: string
  input: string
  status: 'pass' | 'fail' | 'skipped'
  hasUI?: boolean
  error?: string
  note?: string
}

interface Props {
  dev: UseDeveloperResult
  addLog: (level: LogLevel, text: string) => void
  pushToast: (kind: 'success' | 'error' | 'info', text: string) => void
  onPickDir: () => Promise<string | null>
  onAfterCreate: () => void
  onSyncWorkbench?: () => Promise<void> | void
  knownPlugins?: KnownPlugin[]
  editTarget?: VibeEditTarget | null
  onConsumeEditTarget?: () => void
  /** 上报当前长任务（构建/生成等）给共享日志栏做实时耗时脉冲；传 null 表示空闲 */
  setActivity?: (label: string | null) => void
  /** 本面板是否为当前激活页签（仅激活时上报活动，避免隐藏页签清掉对方状态） */
  active?: boolean
}

type Stage = 0 | 1 | 2 | 3
type VibeMode = 'create' | 'edit'

// 面板阶段 → 会话持久化状态。delivered（代码已生成在磁盘）优先级最高：
// 迭代（runFollowup）期间 stage 处于瞬态、generating 也为 false，旧版仅按 stage 映射
// 会把已交付项目持久化成 'contract'——重启水合后丢失 createdPath/generated，
// chatReady=false，下一条修改请求被意图路由误判成「新建」。已交付即 'ready'，治本。
const stageToSessionState = (s: Stage, gen: boolean, delivered: boolean): VibeSessionState => {
  if (delivered) return 'ready'
  if (gen) return 'generating'
  if (s === 0) return 'initial'
  if (s === 1) return 'contract'
  if (s >= 3) return 'ready'
  return 'contract'
}

const STAGES = [
  { id: 0, title: '描述', sub: 'Describe', icon: Lightbulb },
  { id: 1, title: '契约', sub: 'Contract', icon: FileEdit },
  { id: 2, title: '生成', sub: 'Build', icon: Wand2 },
  { id: 3, title: '交付', sub: 'Ship & Debug', icon: Rocket }
] as const

type EventPhase = 'plan' | 'scaffold' | 'manifest' | 'minimal' | 'full' | 'build' | 'load' | 'icon' | 'expand' | 'repair' | 'debug' | 'pack'
type EventKind = 'read' | 'write' | 'build' | 'load' | 'error' | 'note' | 'ai'

interface TimelineEvent {
  id: string
  ts: number
  phase: EventPhase
  kind: EventKind
  text: string
  detail?: string
}

const PHASE_LABEL: Record<EventPhase, string> = {
  plan: '规划', scaffold: '脚手架', manifest: '契约', minimal: '最小可跑', full: '完整实现',
  build: '构建', load: '载入', icon: '图标', expand: '扩展', repair: '修复', debug: '调试', pack: '打包'
}

const EXAMPLES = [
  '把剪贴板里的图片上传并返回 Markdown 链接',
  'JSON 格式化、压缩与转义工具',
  '番茄钟计时器，到点桌面通知',
  '生成指定内容的二维码并可复制图片',
  '批量重命名选中的文件'
]
const EDIT_EXAMPLES = [
  '界面改成暗色风格',
  '加一个一键复制结果的按钮',
  '支持拖拽文件进来处理',
  '修复点击没反应的问题',
  '多语言：增加英文界面'
]

const VIBE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出插件目录内的文件（相对路径数组），用于了解结构。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对子目录，默认 "."' } }, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取插件目录内的文本文件内容。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '相对路径' } }, required: ['path'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '写入或覆盖插件目录内的文件（提供完整内容，自动创建父目录）。新文件或整体重写用它。',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '对已存在文件做查找替换式增量编辑（改少量代码时优先用它，比 write_file 省 token、更稳）。oldText 必须与文件内容逐字一致（含缩进/换行）；多处匹配需 replaceAll:true。',
      parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string', description: '要被替换的原文片段（需唯一）' }, newText: { type: 'string', description: '替换后的新内容' }, replaceAll: { type: 'boolean' } }, required: ['path', 'oldText', 'newText'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: '在插件目录内按内容搜索（文本或正则），可选 glob 过滤文件，返回命中的文件与行。用于快速定位代码。',
      parameters: { type: 'object', properties: { query: { type: 'string' }, glob: { type: 'string', description: '如 "src/**/*.ts"' }, isRegex: { type: 'boolean' }, ignoreCase: { type: 'boolean' }, maxResults: { type: 'number' } }, required: ['query'], additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_check',
      description: '在插件目录运行 `npm run build` + `tsc --noEmit` 类型检查自检，返回是否通过与日志尾部。注意：esbuild/vite 只转译不查类型，必须通过这里的 tsc 类型检查才算真正可用。写完关键改动后调用它，根据构建/类型报错自行修复，直到通过。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_conformance',
      description: '静态校验 manifest.json 与真实文件/源码是否一致（UI 形态、功能码处理分支、工具注册、preload 路径等）。完成实现、停止之前必须调用一次，并据返回的 error 级问题自行修复，直到 ok:true。这是「插件能正确装载运行」的硬门禁，不要跳过。',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  }
] as const

/** 只读工具子集：用于「问答」意图，绝不包含写入/构建工具 */
const VIBE_READ_TOOLS = VIBE_TOOLS.filter((t) => ['list_dir', 'read_file', 'grep'].includes(t.function.name))

export type VibeIntent = 'ask' | 'create' | 'modify' | 'run' | 'package' | 'rollback' | 'icon'
// LLM 路由可选动作：在意图之外多「resume（继续未完成任务）」与「replan（带意见重新规划计划）」
export type RouteAction = VibeIntent | 'resume' | 'replan'

/**
 * 规则优先的意图识别（零延迟、零成本）。模糊时降级为 'ask'（只读问答），杜绝擅自改代码。
 * ctx.hasPlugin：当前会话是否已有可操作的插件目录（createdPath）。
 */
export function classifyIntent(text: string, ctx: { hasPlugin: boolean }): { intent: VibeIntent; confidence: number } {
  const t = (text || '').trim()
  if (!t) return { intent: 'ask', confidence: 0 }
  const reRollback = /撤销|回滚|还原|退回(上一?版)?|恢复到/
  const rePackage = /打包|发布|导出|inplugin|出包/i
  const reRun = /运行|试一?下|试用|跑一?下|跑跑|打开插件|验证一?下|测一?下/
  const reModify = /改|修复|修一?下|加(个|一个|上)?|增加|去掉|删掉|移除|换成|替换|支持|优化|重构|调整|美化|变成|做成|新增|实现|让它|不能|没反应|报错|bug|崩溃|不对|失效|多语言/i
  const reAsk = /[?？]\s*$|^(为什么|为啥|怎么|如何|是不是|有没有|能不能|可不可以|什么是|啥是|解释|说明|介绍|看一?下|查一?下|现在|目前|当前|状态|结构|哪些|多少|是否|讲讲|说说)/
  // 「问句强信号」：以 ？结尾，或以纯疑问词开头——即便含「支持/优化/没反应」等改动关键词也优先当只读问答，
  // 落实「默认不动代码」（修复「为什么没反应？」「它支持 PDF 吗？」被误判为 modify 而擅自改代码）。
  const reStrongAsk = /[?？]\s*$|^\s*(为什么|为啥|为何|是不是|是否|有没有|能不能|可不可以|什么是|啥是|有什么|怎么回事|怎么办|干嘛|干啥|解释|介绍|讲讲|说说)/
  // 图标意图：含「图标/icon/logo」名词 + 重做/更换/美化等诉求，且不是在问问题。需已有插件项目。
  const reIcon = /图标|icon|logo|标志|图案/i
  const reIconWant = /重新|重做|重画|重绘|再(来|画|做|生成|搞)|换|更换|换个|换成|生成|设计|做个|画个|画一|做一|美化|优化|调整|改成?|变(成|得)?|搞个|来个|换掉|重置|不好看|难看|太丑|丑|不满意|不喜欢/
  const reIconAsk = /[?？]\s*$|怎么|如何|为什么|为啥|是不是|能不能|可不可以|什么|啥|哪里|在哪/

  if (reRollback.test(t)) return { intent: 'rollback', confidence: 0.9 }
  if (rePackage.test(t)) return { intent: 'package', confidence: 0.85 }
  // 图标须在 run/modify 之前判定：避免「美化/优化图标」被 reModify 误判为代码修改、走重型代码 agent
  if (ctx.hasPlugin && reIcon.test(t) && reIconWant.test(t) && !reIconAsk.test(t)) {
    return { intent: 'icon', confidence: 0.85 }
  }
  if (reRun.test(t)) return { intent: 'run', confidence: 0.8 }
  // 问句强信号优先于 modify/create：明显是在提问就只读问答，绝不擅自改代码或新建项目
  if (reStrongAsk.test(t)) return { intent: 'ask', confidence: 0.72 }

  if (!ctx.hasPlugin) {
    if (reAsk.test(t) && !reModify.test(t)) return { intent: 'ask', confidence: 0.7 }
    return { intent: 'create', confidence: 0.6 }
  }
  if (reAsk.test(t) && !reModify.test(t)) return { intent: 'ask', confidence: 0.75 }
  if (reModify.test(t)) return { intent: 'modify', confidence: 0.7 }
  // 模糊 → 只读问答兜底（决策：默认不动代码）
  return { intent: 'ask', confidence: 0.3 }
}

function extractJsonObject(raw: string): string | null {
  const text = (raw || '').trim()
  if (text.startsWith('{') && text.endsWith('}')) return text
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const body = fenced[1].trim()
    if (body.startsWith('{') && body.endsWith('}')) return body
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return null
}

function extractSvg(raw: string): string | null {
  const m = (raw || '').match(/<svg[\s\S]*?<\/svg>/i)
  return m ? m[0] : null
}

function parseArgs(args: unknown): Record<string, unknown> {
  if (!args) return {}
  if (typeof args === 'string') { try { return JSON.parse(args) } catch { return {} } }
  if (typeof args === 'object') return args as Record<string, unknown>
  return {}
}

/** 运行时自省 window.mulby，列出当前宿主真实可用的命名空间与方法名（最准确、永远与宿主一致） */
function collectMulbyApiSurface(maxPerNs = 50): string {
  try {
    const m = (window as any)?.mulby
    if (!m || typeof m !== 'object') return ''
    const lines: string[] = []
    for (const ns of Object.keys(m).sort()) {
      const val = m[ns]
      if (val && typeof val === 'object') {
        const methods = Object.keys(val).filter((k) => typeof val[k] === 'function')
        lines.push(methods.length ? `mulby.${ns}: ${methods.slice(0, maxPerNs).join(', ')}` : `mulby.${ns}`)
      } else if (typeof val === 'function') {
        lines.push(`mulby.${ns}()`)
      }
    }
    return lines.join('\n')
  } catch {
    return ''
  }
}

const ai = () => (window as any)?.mulby?.ai
const fsApi = () => (window as any)?.mulby?.filesystem
const clip = () => (window as any)?.mulby?.clipboard
const settingsApi = () => (window as any)?.mulby?.settings
const pluginApi = () => (window as any)?.mulby?.plugin
const sharpApi = () => (window as any)?.mulby?.sharp
const logApi = () => (window as any)?.mulby?.log

export function VibePanel({
  dev, addLog, pushToast, onPickDir, onAfterCreate, onSyncWorkbench,
  knownPlugins = [], editTarget, onConsumeEditTarget, setActivity, active = true
}: Props) {
  const [stage, setStage] = useState<Stage>(0)
  // 已抵达的最远阶段：用于左侧步骤条可点击跳转（只能跳到已抵达的步骤），且跳转纯导航不重跑动作
  const [maxStage, setMaxStage] = useState<Stage>(0)
  const [vibeMode, setVibeMode] = useState<VibeMode>('create')
  const [sentence, setSentence] = useState('')
  const [targetDir, setTargetDir] = useState('')
  const [editPath, setEditPath] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 生成深度：full=一次性完整实现（默认）；minimal=先最小可跑再扩展（适合复杂/不确定需求）
  const [genDepth, setGenDepth] = useState<'full' | 'minimal'>('full')

  const [modelOptions, setModelOptions] = useState<Array<{ id: string; label: string }>>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [modelLoading, setModelLoading] = useState(false)

  const [planning, setPlanning] = useState(false)
  const [contract, setContract] = useState<VibeContract | null>(null)

  const [generating, setGenerating] = useState(false)
  const [createdPath, setCreatedPath] = useState('')
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [toolCalls, setToolCalls] = useState(0)
  const [narration, setNarration] = useState('')
  const [generated, setGenerated] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [expanding, setExpanding] = useState(false)

  const [building, setBuilding] = useState(false)
  const [built, setBuilt] = useState(false)
  const [buildLog, setBuildLog] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined)
  const [repairing, setRepairing] = useState(false)
  // 修复熔断（systematic-debugging）：连续 AI 修复轮次。构建成功/新一轮生成/回滚时清零；
  // 达到 3 次仍失败 → 不再继续打补丁，引导用户回滚或调整方案。
  const repairRoundsRef = useRef(0)
  // P1：生成完成后的 AI 自审（requesting-code-review）进行中
  const [reviewing, setReviewing] = useState(false)

  const [iconBusy, setIconBusy] = useState(false)
  const [iconDone, setIconDone] = useState(false)
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null)
  // 图标生成实时进度（治"重做图标看似卡死"）：流式累计绘制字符 + 阶段，配合定时器让耗时秒数持续跳动
  const [iconProgress, setIconProgress] = useState<string | null>(null)
  const iconStartRef = useRef(0)
  const iconCharsRef = useRef(0)
  const iconPhaseRef = useRef<'thinking' | 'drawing' | 'image'>('thinking')
  const [packing, setPacking] = useState(false)
  const [packed, setPacked] = useState(false)

  const [devtoolsOn, setDevtoolsOn] = useState<boolean | null>(null)
  const [devtoolsBusy, setDevtoolsBusy] = useState(false)
  const [opened, setOpened] = useState(false)

  // P0 改动安全网：本次会话的文件改动 + 回滚 + 核心验收确认
  const [changes, setChanges] = useState<VibeChange[]>([])
  const [rollingBack, setRollingBack] = useState(false)
  const [coreVerified, setCoreVerified] = useState(false)

  // 契约一致性（构建后自动静态校验）+ 一致性问题的 AI 修复
  const [conformance, setConformance] = useState<ConformanceResult | null>(null)
  const [confRepairing, setConfRepairing] = useState(false)
  // 运行验证 smoke（用示例输入真实跑一次；有副作用，手动触发）
  const [smoke, setSmoke] = useState<SmokeResult[]>([])
  const [smoking, setSmoking] = useState(false)

  // 右侧对话式继续修改：是否正在迭代（busy 指示）。历史不再单独存字符串，
  // 改由「对话历史上下文工程」统一注入（见 convoRef / buildHistoryMessages）。
  const [iterating, setIterating] = useState(false)

  // 头脑风暴（S3）：开局让 AI 发散候选方向供小白选择（仅模糊念头才走这里）
  const [brainstorm, setBrainstorm] = useState<{ loading: boolean; options: BrainstormOption[]; seed: string } | null>(null)

  // 澄清式风暴（S3'）：明确需求不再发散点子，而是围绕原始需求先确认 1-2 个关键细节、再给同主题实现做法
  const [clarify, setClarify] = useState<ClarifyState | null>(null)

  // Plan 模式（契约确认后→生成前）：AI 制定开发计划(todo list)，再逐步执行、实时勾选
  const [plan, setPlan] = useState<VibePlanTodo[]>([])
  const [planPhase, setPlanPhase] = useState<VibePlanPhase>('idle')
  // 本次计划是否已脚手架就绪：用于「继续执行」时跳过重复脚手架/基线重置（即便首步就被中止、尚无步骤完成）
  const planPreparedRef = useRef(false)
  // 计划执行互斥：防止「停止后立刻继续」时，上一轮尚未结算的执行循环与新一轮并发跑、互相覆盖状态
  const planExecutingRef = useRef(false)
  // 正在用 LLM 判断这条对话该触发什么动作（C 方案：意图路由）
  const [routing, setRouting] = useState(false)

  // F1/F2：把当前长任务上报给共享日志栏（实时耗时脉冲）。从既有 busy 状态派生单一标签，
  // 仅在本页签激活时上报，避免隐藏页签把工作台的活动状态清掉。
  const activityLabel = useMemo(() => {
    if (routing) return 'AI 理解意图'
    if (planning) return 'AI 规划契约'
    if (brainstorm?.loading) return 'AI 头脑风暴'
    if (clarify?.loading) return 'AI 澄清需求'
    if (reviewing) return 'AI 自审改动'
    if (generating) return 'AI 生成代码'
    if (expanding) return 'AI 完善代码'
    if (repairing) return 'AI 修复构建'
    if (confRepairing) return 'AI 修复一致性'
    if (iterating) return 'AI 按反馈修改'
    if (building) return '构建并载入'
    if (packing) return '打包插件'
    if (iconBusy) return '生成图标'
    return null
  }, [routing, planning, brainstorm?.loading, clarify?.loading, generating, expanding, reviewing, repairing, confRepairing, iterating, building, packing, iconBusy])
  useEffect(() => {
    if (active) setActivity?.(activityLabel)
  }, [active, activityLabel, setActivity])

  // 插件详情抽屉分区 Tab：契约 / 进度 / 交付。随阶段自动切到最相关分区（用户仍可手动切换）。
  const [drawerTab, setDrawerTab] = useState<'contract' | 'progress' | 'deliver'>('contract')
  useEffect(() => {
    setDrawerTab(stage >= 3 ? 'deliver' : stage === 2 ? 'progress' : 'contract')
  }, [stage])

  // 发布到插件仓库（GitHub PR）对话框
  const [publishOpen, setPublishOpen] = useState(false)
  // 已提交 PR 的发布记录 + 实时状态（合并 / CI），用于交付页回显
  const [publishRecord, setPublishRecord] = useState<PublishRecord | null>(null)
  const [publishLive, setPublishLive] = useState<PublishLive | null>(null)
  const [publishStatusLoading, setPublishStatusLoading] = useState(false)

  // 拉一次 PR/CI 实时状态（未登录则只保留记录、不查询；失败静默，UI 仍可打开 PR）
  const refreshPublishStatus = useCallback(async (rec: PublishRecord | null) => {
    if (!rec) return
    setPublishStatusLoading(true)
    try {
      const token = await getStoredToken()
      if (!token) { setPublishLive(null); return }
      setPublishLive(await fetchPublishLive(token, rec.prNumber))
    } catch {
      setPublishLive(null)
    } finally {
      setPublishStatusLoading(false)
    }
  }, [])

  // 切换插件目录时载入发布记录：本地缓存先秒显，再用网络发现以 GitHub 真实 PR 为准
  // （storage 被清空 / 换机器后仍能回显，不再只靠本地）
  useEffect(() => {
    let alive = true
    setPublishLive(null)
    if (!createdPath) { setPublishRecord(null); return }
    void (async () => {
      const local = await loadPublishRecord(createdPath)
      if (!alive) return
      setPublishRecord(local)
      if (local) void refreshPublishStatus(local)
      try {
        const token = await getStoredToken()
        const login = await getStoredLogin()
        const name = contract?.name || createdPath.split('/').filter(Boolean).pop() || ''
        if (!token || !login || !name) return
        const found = await discoverPluginPR(token, login, name)
        if (!alive || !found) return
        setPublishRecord(found)
        void savePublishRecord(createdPath, found)
        void refreshPublishStatus(found)
      } catch { /* 网络/限流失败：保留本地缓存 */ }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdPath, refreshPublishStatus])

  // 发布成功回调：更新记录并立即查询一次状态
  const handlePublished = useCallback((rec: PublishRecord) => {
    setPublishRecord(rec)
    void refreshPublishStatus(rec)
  }, [refreshPublishStatus])

  // 对话内提示卡（S4）：危险操作二次确认 / 构建失败一键修复等
  const [pendingPrompt, setPendingPrompt] = useState<{ kind: 'confirm' | 'action'; title: string; desc: string; actionLabel: string; danger?: boolean; files?: VibeChange[]; onAction: () => void } | null>(null)

  // 重新触发 CI：关闭再重开 PR（二次确认，复用 pendingPrompt 提示卡）
  const [rerunningCi, setRerunningCi] = useState(false)
  const handleRerunCi = useCallback(() => {
    const rec = publishRecord
    if (!rec) return
    setPendingPrompt({
      kind: 'confirm',
      title: '重新跑 CI？',
      desc: `将关闭并重新打开 PR #${rec.prNumber}，让 GitHub 用最新 workflow 重新跑一次检查。`,
      actionLabel: '重新跑 CI',
      onAction: () => {
        setPendingPrompt(null)
        void (async () => {
          setRerunningCi(true)
          try {
            const token = await getStoredToken()
            if (!token) { pushToast('error', '请先在「发布」对话框登录 GitHub'); return }
            await rerunPR(token, rec.prNumber)
            pushToast('success', `已重新触发 PR #${rec.prNumber} 的 CI`)
            setTimeout(() => { void refreshPublishStatus(rec) }, 3000)
          } catch (e) {
            pushToast('error', e instanceof Error ? e.message : '重新触发失败')
          } finally {
            setRerunningCi(false)
          }
        })()
      }
    })
  }, [publishRecord, refreshPublishStatus, pushToast])

  // 版本管理（Git）：历史列表 + 可用性 + 回滚中标记；pendingCommit 记录下次构建成功后要提交的说明
  const [versions, setVersions] = useState<VcsCommit[]>([])
  const [vcsAvailable, setVcsAvailable] = useState(true)
  const [restoringHash, setRestoringHash] = useState<string | null>(null)
  const pendingCommitMsgRef = useRef<string>('')

  const abortedRef = useRef(false)
  const reqIdRef = useRef<string | null>(null)
  // 发起新 AI 调用前重置中断态，避免上一轮的「已中止」标记误伤本轮
  const resetAbort = () => { abortedRef.current = false; reqIdRef.current = null }
  // 流式回调里捕获本次请求 id，供「停止」时精确 abort（也适用于无工具的纯文本/JSON 调用）
  const captureReqId = (chunk: any) => { if (chunk?.__requestId) reqIdRef.current = chunk.__requestId }
  // 图标专用流式回调：捕获 reqId + 实时累计绘制进度（reasoning=构思，text=正在写 SVG）
  const onIconChunk = (chunk: any) => {
    if (chunk?.__requestId) { reqIdRef.current = chunk.__requestId; return }
    if (abortedRef.current) return
    const ct = chunk?.chunkType
    if (ct === 'reasoning') {
      if (iconPhaseRef.current !== 'drawing') iconPhaseRef.current = 'thinking'
    } else if (ct === 'text' || typeof chunk?.content === 'string') {
      const piece = ct === 'text' && typeof chunk?.text === 'string' ? chunk.text : (typeof chunk?.content === 'string' ? chunk.content : '')
      if (piece) { iconCharsRef.current += piece.length; iconPhaseRef.current = 'drawing' }
    }
  }
  const deliverStartedRef = useRef(false)
  const eventSeq = useRef(0)

  useEffect(() => { setMaxStage((m) => (stage > m ? stage : m)) }, [stage])

  // -------- Session 集成 --------
  const { activeId, activeSession, loaded: sessionLoaded, sessions, createSession, updateSession, flushSessionNow, appendMessage, deselect, clearMessages, findByPath, switchSession } = useSession()
  // 当前面板本地状态所「承载」的会话 id。仅当 activeId 切换到一个尚未承载的会话时才重新水合，
  // 且 syncToSession 只在 liveSessionIdRef === activeId 时回写，杜绝把旧状态写进新会话造成数据污染。
  const liveSessionIdRef = useRef<string | null>(null)

  // 切换/载入会话时把会话状态水合进面板（首次挂载或下拉切换都会触发）
  useEffect(() => {
    if (!sessionLoaded) return
    if (!activeId || activeId === liveSessionIdRef.current) return
    const s = sessions.find((x) => x.id === activeId)
    if (!s) return
    liveSessionIdRef.current = activeId
    resetState()
    setVibeMode(s.vibeMode || 'create')
    setSentence(s.sentence || '')
    setGenDepth(s.genDepth || 'full')
    if (s.selectedModel) setSelectedModel(s.selectedModel)
    setContract(s.contract)
    // 恢复开发计划（Plan 模式）。瞬态阶段（planning/executing）在重载后无对应在跑任务，
    // 降级为 review 让用户可「继续执行」；执行中的步骤回退为 pending 以便重跑。
    const materialized = s.state === 'ready' || s.state === 'generating'
    if (s.plan && s.plan.length) {
      setPlan(s.plan.map((t) => (t.status === 'in_progress' ? { ...t, status: 'pending' } : t)))
      const ph = s.planPhase
      setPlanPhase(ph === 'planning' || ph === 'executing' ? 'review' : (ph || 'idle'))
      // 项目是否已在磁盘脚手架/绑定（generating/ready 即已物化）→ 续跑时跳过重复脚手架与基线重置
      planPreparedRef.current = materialized
    }
    if (s.pluginPath) {
      if (s.vibeMode === 'edit') { setEditPath(s.pluginPath); setCreatedPath(s.pluginPath) }
      else { setTargetDir(s.pluginPath.split('/').slice(0, -1).join('/') || ''); if (materialized) setCreatedPath(s.pluginPath) }
    }
    if (s.state === 'ready') {
      setStage(3); setMaxStage(3); setGenerated(true); setBuilt(true); setLoaded(true)
      setLoadedId(s.contract?.pluginId || s.contract?.name || undefined)
      // 已就绪的会话只是「恢复展示」，不要触发交付页的自动重新构建（修复每次切到本 tab 都重建）
      deliverStartedRef.current = true
    } else if (s.state === 'generating') {
      setStage(2); setMaxStage(2)
    } else if (s.state === 'contract') {
      setStage(1); setMaxStage(1)
    } else {
      setStage(0); setMaxStage(0)
    }
    // 存量自愈：旧版本会把「已交付项目的迭代中」持久化成 'contract'（stageToSessionState 修复前的坏数据），
    // 重启后 createdPath/generated 丢失 → chatReady=false → 下一条迭代请求被误判成「新建」。
    // 特征校验：契约已存在 + pluginPath 下真实存在 manifest.json 且 id/name 与契约一致 → 升级回交付态。
    if (s.state === 'contract' && s.contract && s.pluginPath) {
      const sid = activeId
      const sc = s.contract
      const pPath = s.pluginPath
      void (async () => {
        try {
          const raw = await fsApi()?.readFile?.(`${pPath}/manifest.json`, 'utf-8')
          const text = typeof raw === 'string'
            ? raw
            : (raw ? new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : '')
          if (!text) return
          const m = JSON.parse(text)
          const candidates = [sc.pluginId, sc.name].filter(Boolean)
          if (!candidates.includes(m?.id) && !candidates.includes(m?.name)) return
          if (liveSessionIdRef.current !== sid) return // 用户已切走，放弃升级
          setCreatedPath(pPath)
          setGenerated(true); setBuilt(true); setLoaded(true)
          setLoadedId(m?.id || m?.name || undefined)
          setStage(3); setMaxStage(3)
          deliverStartedRef.current = true // 只恢复展示，不触发自动重建
          addLog('info', `▶ [Vibe] 检测到该项目已生成在磁盘（${m?.name || pPath}），已恢复到交付状态`)
        } catch { /* 探测失败保持原状（真实的契约阶段会话不受影响） */ }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoaded, activeId, sessions])

  // 关键状态变化时同步到 session
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buildSessionPatch = useCallback((): Partial<VibeSession> => ({
    state: stageToSessionState(stage, generating, generated),
    contract,
    sentence,
    vibeMode,
    genDepth,
    selectedModel,
    plan,
    planPhase,
    pluginPath: createdPath || (vibeMode === 'edit' ? editPath : '') || ''
  }), [stage, generating, generated, contract, sentence, vibeMode, genDepth, selectedModel, plan, planPhase, createdPath, editPath])
  const syncToSession = useCallback(() => {
    if (!activeId) return
    // 面板状态尚未水合到当前活跃会话时不回写，避免把旧会话状态覆盖到新会话
    if (liveSessionIdRef.current !== activeId) return
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => { updateSession(activeId, buildSessionPatch()) }, 800)
  }, [activeId, buildSessionPatch, updateSession])

  useEffect(() => { syncToSession() }, [syncToSession])

  // 插件关闭 / 窗口隐藏时立即把面板状态写进会话并落盘：
  // 否则两层 debounce（本层 800ms + 存储层 500ms）内的最终状态会随渲染进程销毁丢失——
  // 曾导致「修改完成」后快速关闭插件时，会话停留在迭代期间写入的过期状态。
  const flushNowRef = useRef<() => void>(() => {})
  flushNowRef.current = () => {
    if (!activeId || liveSessionIdRef.current !== activeId) return
    if (syncTimerRef.current) { clearTimeout(syncTimerRef.current); syncTimerRef.current = null }
    flushSessionNow(activeId, buildSessionPatch())
  }
  useEffect(() => {
    const flush = () => flushNowRef.current()
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  // 携带指令的自动回流（审查意见等）：等会话水合就绪后自动交给 AI
  const [pendingInstruction, setPendingInstruction] = useState<{ text: string; path: string; token: number } | null>(null)

  // 工作台「AI 改造」带入目标：优先恢复已有 session
  useEffect(() => {
    if (!editTarget) return
    const existing = findByPath(editTarget.path)
    if (existing) {
      // 切到已有会话，由通用水合 effect 负责恢复其 stage/contract/createdPath 等状态
      switchSession(existing.id)
      addLog('info', `▶ [Vibe] 恢复已有会话：${editTarget.displayName || editTarget.id || editTarget.path}`)
    } else {
      resetState()
      setVibeMode('edit')
      setEditPath(editTarget.path)
      const name = editTarget.displayName || editTarget.id || editTarget.path.split('/').pop() || 'plugin'
      const sess = createSession({ pluginPath: editTarget.path, pluginName: name, vibeMode: 'edit', state: 'initial' })
      liveSessionIdRef.current = sess.id
      addLog('info', `▶ [Vibe] 进入改造模式：${editTarget.displayName || editTarget.id || editTarget.path}`)
    }
    // 携带修复指令（审查意见回流）：等会话水合就绪后由下方 effect 自动交给 AI；20s 未就绪则放弃
    if (editTarget.instruction?.trim()) {
      const token = Date.now()
      setPendingInstruction({ text: editTarget.instruction.trim(), path: editTarget.path, token })
      setTimeout(() => {
        setPendingInstruction((cur) => {
          if (cur?.token !== token) return cur
          pushToast('info', '会话尚未就绪，未能自动发送修复指令，请回到发布状态卡重试')
          return null
        })
      }, 20000)
    }
    onConsumeEditTarget?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTarget?.token])

  // 加载模型
  useEffect(() => {
    const a = ai()
    if (!a?.allModels) return
    let mounted = true
    setModelLoading(true)
    void (async () => {
      const normalize = (models: any[]) => (Array.isArray(models) ? models : [])
        .filter((m) => typeof m?.id === 'string' && m.id.trim())
        .map((m) => ({ id: m.id as string, label: (m.label as string) || (m.id as string) }))
      try {
        let options = normalize(await a.allModels())
        if (options.length === 0) {
          options = normalize(await a.allModels({ endpointType: ['openai', 'openai-response', 'anthropic', 'gemini'] }))
        }
        if (!mounted) return
        setModelOptions(options)
        setSelectedModel((cur) => cur || (options[0]?.id ?? ''))
      } catch (e) {
        if (mounted) addLog('error', `✘ [Vibe] 拉取模型失败：${e instanceof Error ? e.message : '未知'}`)
      } finally {
        if (mounted) setModelLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [addLog])

  // ---------------- 时间线 ----------------
  // 本回合（一次对话）累积的事件，用于把操作明细内联到对应的 assistant 消息
  const turnEventsRef = useRef<TimelineEvent[]>([])
  const pushEvent = (phase: EventPhase, kind: EventKind, text: string, detail?: string) => {
    eventSeq.current += 1
    const ev: TimelineEvent = { id: `e-${Date.now()}-${eventSeq.current}`, ts: Date.now(), phase, kind, text, detail }
    setEvents((prev) => [...prev.slice(-199), ev])
    turnEventsRef.current = [...turnEventsRef.current.slice(-39), ev]
  }
  // 汇总本回合事件为消息内联的操作卡明细
  const collectTurnActions = (): VibeAction[] =>
    turnEventsRef.current.map((e) => ({ kind: e.kind, text: e.text, detail: e.detail }))

  // ---------------- 对话历史上下文工程 ----------------
  // 关键修复：此前每次 AI 调用都只发 [system, user]，没有任何历史，
  // 导致「先问答出方案 → 再让它按方案改」时 AI 完全看不到之前的方案。
  // 这里用一个始终反映当前会话消息的 ref，按预算把最近对话注入到 AI 的 messages，
  // 让「按上面的方案 / 刚才说的」这类指代能被正确理解。
  const convoRef = useRef<VibeMessage[]>([])
  useEffect(() => { convoRef.current = activeSession?.messages || [] }, [activeSession?.messages, activeId])

  const HISTORY_MAX_MSGS = 24      // 最多带入的历史消息条数
  const HISTORY_MAX_CHARS = 9000   // 历史总字符预算（控制 token）
  const HISTORY_PER_MSG_CAP = 4000 // 单条历史消息最大字符（超出截断）
  type ChatMsg = { role: 'user' | 'assistant'; content: string }

  /**
   * 构造注入给 AI 的对话历史（按时间顺序，最近优先保留，受条数/字符预算约束）。
   * @param excludeContent 需要排除的「本轮刚追加的用户输入」原文，避免与最终 user 消息重复。
   */
  const buildHistoryMessages = (excludeContent?: string): ChatMsg[] => {
    const all = convoRef.current || []
    // 规避把「刚 appendMessage 的本轮用户输入」重复带入（handleChatSend 先写消息再调执行器）
    const src: VibeMessage[] = []
    let skippedDup = false
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]
      if (!skippedDup && excludeContent != null && m.role === 'user' && m.content === excludeContent) { skippedDup = true; continue }
      src.unshift(m)
    }
    const mapped: ChatMsg[] = src
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !!m.content && !!m.content.trim())
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.length > HISTORY_PER_MSG_CAP ? `${m.content.slice(0, HISTORY_PER_MSG_CAP)}\n…（内容较长，已截断）` : m.content
      }))
    // 从最近往前按预算保留，保持时间先后顺序
    const kept: ChatMsg[] = []
    let total = 0
    for (let i = mapped.length - 1; i >= 0 && kept.length < HISTORY_MAX_MSGS; i--) {
      const len = mapped[i].content.length
      if (kept.length > 0 && total + len > HISTORY_MAX_CHARS) break
      kept.unshift(mapped[i])
      total += len
    }
    return kept
  }

  // ---------------- 上下文锚点（P1-2：防遗忘） ----------------
  // 滑窗会淘汰最老的消息，导致多轮后 AI 忘掉「最初需求 / 已确认的方案」。
  // 这里把会话的关键锚点（最初需求 + 当前契约 + 早期对话的滚动摘要）始终注入 system，
  // system 不受历史字符预算淘汰，等价于业界 compaction 后的 rehydration / critical-context。
  const buildSessionAnchor = (): string => {
    const all = convoRef.current || []
    const firstUser = all.find((m) => m.role === 'user' && !!m.content.trim())
    const origReq = (firstUser?.content || sentence || '').trim().slice(0, 800)
    const lines: string[] = []
    if (origReq) lines.push(`最初需求：${origReq}`)
    if (contract) lines.push(`当前插件设定（契约）：${contractSummary(contract)}（displayName=${contract.displayName}）`)
    const summary = (activeSession?.contextSummary || '').trim()
    if (summary) lines.push(`前情提要（更早对话的压缩摘要，已确认的方案/决策务必延续）：\n${summary.slice(0, 2000)}`)
    if (!lines.length) return ''
    return [
      '———— 本次会话背景（务必全程遵循、不要遗忘；用户说「按上面的方案 / 刚才说的」即指此处与下方历史）————',
      ...lines,
      '————'
    ].join('\n')
  }
  const withAnchorContext = (sys: string): string => {
    const anchor = buildSessionAnchor()
    return anchor ? `${sys}\n\n${anchor}` : sys
  }

  // ---------------- 滚动摘要（P1-3：长对话压缩） ----------------
  // 当对话变长，把「超出最近窗口」的早期消息用便宜的一次 AI 调用压成结构化摘要，
  // 持久化到 session.contextSummary，并由 buildSessionAnchor 注入。失败则优雅降级。
  const summarizingRef = useRef(false)
  const SUMMARY_KEEP_RECENT = 16 // 最近这么多条仍由历史窗口承载，更早的才进摘要
  const maybeSummarizeHistory = async () => {
    const sid = activeId
    if (!sid || summarizingRef.current) return
    if (planning || generating || expanding || repairing || iterating || iconBusy || confRepairing) return
    const all = convoRef.current || []
    if (all.length <= SUMMARY_KEEP_RECENT + 6) return // 不够长不值得压缩
    const older = all.slice(0, all.length - SUMMARY_KEEP_RECENT).filter((m) => !!m.content && !!m.content.trim())
    if (older.length < 4) return
    const a = ai()
    if (!a?.call) return
    summarizingRef.current = true
    try {
      const text = older.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${m.content.slice(0, 1500)}`).join('\n')
      const prev = (activeSession?.contextSummary || '').trim()
      const obj = await aiJson(
        '你是对话压缩器。把给定的早期对话压成结构化中文摘要，只输出 JSON：{ "summary": "..." }。摘要必须覆盖：目标/需求、关键决策与共识、已完成进展、涉及的文件或模块、未完成的下一步；务必逐字保留用户明确认可的方案要点。',
        `${prev ? `已有前情提要（在此基础上合并更新，不要丢失旧要点）：\n${prev}\n\n` : ''}需要压缩的更早对话：\n${text}`
      )
      const summary = obj && typeof obj.summary === 'string' ? obj.summary.trim() : ''
      if (summary && liveSessionIdRef.current === sid) updateSession(sid, { contextSummary: summary })
    } catch { /* 压缩失败忽略：锚点（最初需求+契约）与历史窗口仍可用 */ } finally {
      summarizingRef.current = false
    }
  }

  // 对话消息记录：会话尚未创建时（新项目的首条需求 / 头脑风暴 / 方向选择都发生在 activeId 为 null 时）
  // 先缓冲到 pendingMsgsRef，待 createSession 时通过 drainPendingMsgs 一并落入会话，
  // 确保「每一步发送与回复」都进入对话历史，而不是等到构建成功才出现第一条。
  const pendingMsgsRef = useRef<VibeMessage[]>([])
  const recordMessage = (msg: VibeMessage) => {
    if (activeId) appendMessage(activeId, msg)
    else pendingMsgsRef.current.push(msg)
  }
  const drainPendingMsgs = (): VibeMessage[] => {
    const arr = pendingMsgsRef.current
    pendingMsgsRef.current = []
    return arr
  }
  const mkMsg = (role: 'user' | 'assistant', content: string, extra?: Partial<VibeMessage>): VibeMessage =>
    ({ id: `${role === 'user' ? 'm' : 'a'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, content, timestamp: Date.now(), ...extra })

  const currentPhaseRef = useRef<EventPhase>('minimal')
  const onAgentChunk = (chunk: any) => {
    if (chunk?.__requestId) { reqIdRef.current = chunk.__requestId; return }
    if (abortedRef.current) return
    const ct = chunk?.chunkType
    if (ct === 'tool-call' && chunk.tool_call) {
      const name = chunk.tool_call.name
      const args = parseArgs(chunk.tool_call.args)
      const p = typeof args.path === 'string' ? args.path : ''
      setToolCalls((n) => n + 1)
      if (name === 'write_file' && p) pushEvent(currentPhaseRef.current, 'write', `写入 ${p}`)
      else if (name === 'edit_file' && p) pushEvent(currentPhaseRef.current, 'write', `编辑 ${p}`)
      else if (name === 'read_file' && p) pushEvent(currentPhaseRef.current, 'read', `读取 ${p}`)
      else if (name === 'list_dir') pushEvent(currentPhaseRef.current, 'read', `浏览目录${typeof args.path === 'string' && args.path && args.path !== '.' ? ` ${args.path}` : '结构'}`)
      else if (name === 'grep') pushEvent(currentPhaseRef.current, 'read', `搜索代码${typeof args.query === 'string' ? `：${String(args.query).slice(0, 40)}` : ''}`)
      else if (name === 'build_check') pushEvent(currentPhaseRef.current, 'build', '自检构建 npm run build…')
      else if (name === 'check_conformance') pushEvent(currentPhaseRef.current, 'note', '校验契约一致性…')
      else pushEvent(currentPhaseRef.current, 'note', `调用工具 ${name}`)
    } else if (ct === 'tool-result' && chunk.tool_result) {
      const name = chunk.tool_result.name
      const result = chunk.tool_result.result as { path?: string; bytes?: number; success?: boolean; replaced?: number; matches?: unknown[]; found?: boolean; namespace?: string; namespaces?: unknown[] } | undefined
      if (name === 'write_file' && result?.path) {
        pushEvent(currentPhaseRef.current, 'write', `已写入 ${result.path}`, typeof result.bytes === 'number' ? `${result.bytes} 字节` : undefined)
      } else if (name === 'edit_file' && result?.path) {
        pushEvent(currentPhaseRef.current, 'write', `已编辑 ${result.path}`, typeof result.replaced === 'number' ? `${result.replaced} 处` : undefined)
      } else if (name === 'build_check') {
        pushEvent(currentPhaseRef.current, result?.success ? 'build' : 'error', result?.success ? '自检构建通过' : '自检构建失败')
      } else if (name === 'grep' && Array.isArray(result?.matches)) {
        pushEvent(currentPhaseRef.current, 'read', `搜索完成`, `命中 ${result.matches.length} 处`)
      } else if (name === 'check_conformance') {
        const r = chunk.tool_result.result as { ok?: boolean; issues?: Array<{ level?: string }> } | undefined
        const errs = Array.isArray(r?.issues) ? r!.issues!.filter((i) => i?.level === 'error').length : 0
        pushEvent(currentPhaseRef.current, r?.ok ? 'note' : 'error', r?.ok ? '契约一致性校验通过' : `契约校验：${errs} 处需修复`)
      }
    } else if (ct === 'text' || typeof chunk?.content === 'string') {
      const piece = ct === 'text' && typeof chunk?.text === 'string'
        ? chunk.text
        : (typeof chunk?.content === 'string' ? chunk.content : '')
      if (piece) setNarration((prev) => (prev + piece).slice(-4000))
    }
  }

  // ---------------- 阶段 0 → 1：生成契约 ----------------
  const planPrompt = (text: string) => [
    '你是 Mulby 插件规划器。根据用户一句话需求，输出一个 JSON 契约（只输出 JSON，不要解释、不要 Markdown）。',
    '字段（对齐 Mulby 官方 manifest schema）：',
    '- name: kebab-case 英文插件名（小写字母/数字/中划线）',
    '- displayName: 简短中文名',
    '- description: 一句话描述',
    '- type: 插件分类，取值之一：utility|productivity|developer|system|media|network|ai|entertainment|other',
    '- author: 作者（可选，默认留空）',
    '- platform: 平台限制数组，取值 darwin/win32/linux 的子集；全平台兼容则给空数组 []（不要臆造平台限制，除非需求明确依赖某系统能力）',
    '- template: "react"（需要可视化界面）或 "basic"（纯命令/无界面，例如对输入文本即时计算并返回结果）',
    '- features: 数组，每项 { "code": 英文下划线功能码, "explain": 中文说明, "mode": "ui"|"silent"|"detached", "triggers": [...] }。通常 1 个功能。可选字段：mainPush(bool 命中时向搜索框推送动态结果)、mainHide(bool 触发后隐藏主窗口)、preCapture("region"|"fullscreen" 启动前自动截图作为输入)、route(string 仅 react 多路由插件的 UI 路由)。多个功能时 code 必须各不相同。',
    '- permissions: 仅在确实需要时把对应项设为 true（不需要的不要写）。可用布尔权限：clipboard(剪贴板) notification(系统通知) filesystem(文件读写) ai(调用AI) runCommand(执行命令) webview(内嵌网页) microphone(麦克风) camera(摄像头) screen(屏幕录制) geolocation(定位) accessibility(辅助功能) inputMonitor(输入监听) contacts(通讯录) calendar(日历)。',
    '- commandExecution: 需要执行系统命令时优先用它（而非旧版 runCommand）。结构：{ "direct": { "enabled": true, "defaultProfile": "sandbox"|"workspace"|"trusted", "maxProfile": 同枚举 }, "ai": { 同结构 } }。direct=插件代码直接执行命令，ai=插件承载 AI 生成命令；不需要执行命令则整个省略。',
    '- window: 仅 react/独立窗口插件需要，{ "width","height","minWidth","minHeight","type":"default|borderless|fullscreen","transparent":bool,"alwaysOnTop":bool,"resizable":bool }。给一个贴合内容的默认尺寸（如工具类 480x600，仪表盘类更大）。',
    '- behavior: { "single":bool 单例(默认true), "defaultDetached":bool 默认独立窗口, "background":bool 允许后台常驻, "persistent":bool 重启恢复后台 }。后台常驻类（定时任务/监听）才设 background:true。',
    '- tools: 可选 AI 工具数组 [{ "name", "description" }]，一般为空数组',
    '- needIcon: boolean',
    '',
    '【触发方式 triggers——最关键】请根据需求语义为每个功能选择最贴切的触发类型，不要一律用 keyword。每个 trigger 是对象，按 type 取字段：',
    '- keyword（关键词唤起）：{ "type":"keyword", "value":"词" }。适合“打开某工具/面板”。可给 1~3 个别名词。',
    '- regex（按输入格式匹配）：{ "type":"regex", "match":"正则字符串", "label":"指令名", "minLength":1, "maxLength":50, "sample":"能匹配的示例输入" }。',
    '    适合“对某种固定格式的输入直接处理”：金额数字→大写、URL、IP、手机号、时间戳、颜色值、纯 JSON 等。',
    '    match 是不带两侧斜杠的 JS 正则；在 JSON 字符串里反斜杠要写成 \\\\（如 "^-?[0-9]+(\\\\.[0-9]{1,2})?$"）。务必同时给 sample，用于一键试用。',
    '- over（任意文本）：{ "type":"over", "label":"指令名", "minLength":1, "maxLength":2000 }。适合“对任意选中/输入文本做处理”（翻译、字数统计、编码转换…）。',
    '- files（拖入文件）：{ "type":"files", "label":"指令名", "exts":["png","pdf"], "fileType":"file" }。适合处理拖入的文件/文件夹。',
    '- img（拖入图片）：{ "type":"img", "label":"指令名" }。适合处理拖入的图片。',
    '- window（活跃窗口）：{ "type":"window", "app":"/Chrome/", "label":"指令名" }。少用。',
    '选择原则：',
    '· 输入是“有固定格式的数据”（金额/URL/IP/手机号/时间/颜色…）→ 用 regex 并给 sample；可再附 1 个 keyword 兜底方便用户用关键词搜到。',
    '· 处理“任意文本”→ 用 over。· 处理“拖入文件/图片”→ files/img。· 只是“打开一个界面/工具”→ keyword。',
    '示例：需求“把数字金额转人民币大写”应输出 triggers: [ {"type":"regex","match":"^-?[0-9]+(\\\\.[0-9]{1,2})?$","label":"金额转大写","minLength":1,"maxLength":40,"sample":"1234.56"}, {"type":"keyword","value":"大写金额"} ]。',
    '能力与权限：只为确实会用到的能力开启对应 permissions（用到剪贴板才开 clipboard、用到通知才开 notification…），并确保所选 template/features/triggers 都能由 Mulby 常见桌面能力（剪贴板/通知/文件/AI/图像/窗口/网络等）落地，不要臆造平台做不到的功能。',
    '',
    `用户需求：${text}`
  ].join('\n')

  const editSummaryPrompt = (c: VibeContract, text: string) => [
    '你是 Mulby 插件改造分析器。根据「现有插件契约」与「修改需求」，用一句话说明将要做的改动。只输出 JSON：{ "summary": "..." }。',
    `现有契约：${contractSummary(c)}（displayName=${c.displayName}）`,
    `修改需求：${text}`
  ].join('\n')

  const aiJson = async (system: string, user: string): Promise<any | null> => {
    const a = ai()
    if (!a?.call) return null
    const res = await a.call({
      ...(selectedModel ? { model: selectedModel } : {}),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      skills: { mode: 'off' }, mcp: { mode: 'off' }, toolingPolicy: { enableInternalTools: false }
    }, captureReqId)
    const content = typeof res?.content === 'string'
      ? res.content
      : Array.isArray(res?.content) ? res.content.map((x: any) => x?.text ?? '').join('\n') : ''
    const json = extractJsonObject(content)
    if (!json) return null
    try { return JSON.parse(json) } catch { return null }
  }

  const planCreate = async (overrideText?: string) => {
    const desc = (overrideText ?? sentence).trim()
    if (!desc) { pushToast('error', '请先用一句话描述你想要的插件'); return }
    if (!targetDir.trim()) { pushToast('error', '请选择插件生成的目标目录'); return }
    if (overrideText) setSentence(desc)
    let sid = activeId
    if (!sid) {
      const name = desc.slice(0, 20) || 'new-plugin'
      const sess = createSession({ pluginPath: targetDir, pluginName: name, vibeMode: 'create', state: 'initial', sentence: desc, genDepth, selectedModel, messages: drainPendingMsgs() })
      liveSessionIdRef.current = sess.id
      sid = sess.id
    } else {
      for (const m of drainPendingMsgs()) appendMessage(sid, m)
    }
    setPlanning(true)
    resetAbort()
    try {
      addLog('info', '▶ [Vibe] AI 正在规划契约…')
      let parsed: any = null
      try { parsed = await aiJson('你是严格的 JSON 生成器，只输出可解析的 JSON 对象。', planPrompt(desc)) } catch { /* fallback */ }
      if (abortedRef.current) { addLog('info', '⏹ [Vibe] 已停止规划'); return }
      const c = normalizeContract(parsed, desc)
      // AI 规划极少返回 author（提示词标注"可选"）：重新规划/改造规划时继承既有契约的作者，
      // 避免用户在编辑器里填过的 author 被新契约顶掉（发布预检要求 author 必填）。
      if (!c.author && contract?.author) c.author = contract.author
      setContract(c)
      setStage(1)
      if (sid) appendMessage(sid, mkMsg('assistant', `插件设定（契约）已就绪：${c.displayName}——${contractSummary(c)}。在对话里点「确认并生成」我就开始写代码；想改设定可点顶部「详情」展开编辑。`))
      addLog('success', `✔ [Vibe] 契约已生成：${contractSummary(c)}`)
    } catch (e) {
      const c = defaultContract(desc)
      setContract(c)
      setStage(1)
      if (sid) appendMessage(sid, mkMsg('assistant', '规划没成功，我先用了一份默认设定，你可以点顶部「详情」展开编辑后再点「确认并生成」。'))
      addLog('warn', `⚠ [Vibe] 规划失败，已用默认契约：${e instanceof Error ? e.message : ''}`)
    } finally {
      setPlanning(false)
    }
  }

  const planEdit = async (overrideText?: string) => {
    const desc = (overrideText ?? sentence).trim()
    if (!editPath.trim()) { pushToast('error', '请选择要改造的插件'); return }
    if (!desc) { pushToast('error', '请描述你想对这个插件做什么修改'); return }
    if (overrideText) setSentence(desc)
    setPlanning(true)
    resetAbort()
    try {
      const dirName = editPath.split('/').filter(Boolean).pop() || 'plugin'
      let c: VibeContract | null = null
      try {
        const raw = await fsApi()?.readFile?.(`${editPath}/manifest.json`, 'utf-8')
        const content = typeof raw === 'string'
          ? raw
          : (raw ? new TextDecoder().decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : '')
        if (content) c = manifestToContract(content, dirName)
      } catch {
        addLog('warn', '⚠ [Vibe] 未能读取 manifest.json，按目录名兜底')
      }
      if (!c) {
        c = { ...defaultContract(dirName), isEdit: true, pluginId: dirName, needIcon: false }
      }
      c.targetPath = editPath
      c.editSummary = desc
      // 轻量预测改动说明
      try {
        addLog('info', '▶ [Vibe] AI 正在分析改动…')
        const obj = await aiJson('你是严格的 JSON 生成器，只输出可解析的 JSON 对象。', editSummaryPrompt(c, desc))
        if (obj && typeof obj.summary === 'string' && obj.summary.trim()) c.editSummary = obj.summary.trim()
      } catch { /* keep sentence */ }
      if (abortedRef.current) { addLog('info', '⏹ [Vibe] 已停止分析'); return }
      let sid = activeId
      if (!sid) {
        const sess = createSession({ pluginPath: editPath, pluginName: c.displayName || dirName, vibeMode: 'edit', state: 'contract', contract: c, sentence: desc, genDepth, selectedModel, messages: drainPendingMsgs() })
        liveSessionIdRef.current = sess.id
        sid = sess.id
      } else {
        for (const m of drainPendingMsgs()) appendMessage(sid, m)
      }
      setContract(c)
      setStage(1)
      if (sid) appendMessage(sid, mkMsg('assistant', `已读取「${c.displayName}」的现状。改动设定：${c.editSummary || desc}。在对话里点「确认并生成」我就开始改。`))
      addLog('success', `✔ [Vibe] 改造契约已读入：${c.displayName}（${c.pluginId}）`)
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '分析失败')
    } finally {
      setPlanning(false)
    }
  }

  // 进入契约生成即自动展开顶部「详情」抽屉：让用户看到「正在生成插件设定…」并随后审阅契约
  const doPlan = (text?: string) => { setDrawerOpen(true); return vibeMode === 'edit' ? planEdit(text) : planCreate(text) }

  // ---------------- AI agent ----------------
  const createSystemPrompt = (c: VibeContract, root: string, phase: 'minimal' | 'full' | 'expand') => [
    '你是资深 Mulby 插件工程师，正在为一个已脚手架、且 manifest.json 已写好的插件目录实现代码。',
    `插件根目录：${root}`,
    '重要：manifest.json 已由工具按用户确认的「契约」写好，请勿修改 manifest.json。',
    '工作方式（必须用工具自主完成，无需向用户提问）：先 list_dir 看结构、read_file 读 package.json 与现有 src/*（可用 grep 快速定位代码）；新文件用 write_file 写完整内容，小改动用 edit_file 增量替换；调用任何 window.mulby.* 能力前先用 mulby_read_file 查阅对应的 API 文档确认签名与用法（参见技能指导）；关键改动写完后用 build_check 自检构建并据报错自行修复，直到通过；停止前必须调用 check_conformance 校验 manifest 与代码是否一致，按其 error 级问题修复直到 ok:true；最后用一两句话总结并停止。',
    'Mulby 约定：后端 src/main.ts 导出 onLoad/onUnload/onEnable/onDisable/run；前端用全局 window.mulby.*（clipboard/notification/filesystem/http/ai/sharp 等），不要臆造不存在的 API；React 模板用现成 react/react-dom，入口 src/ui/main.tsx 挂载 App，UI 在 src/ui/App.tsx；保持 TypeScript 可编译；不要创建 node_modules/dist，不要改构建脚本与依赖清单。',
    '输入获取：silent/无界面功能在 run(context) 中通过 context.input（字符串）拿到用户输入文本——当功能由 regex/over 触发时，context.input 就是被匹配到的那段文本；用 context.featureCode 区分功能。处理结果可写回剪贴板（window.mulby.clipboard）或用系统通知（window.mulby.notification）反馈；有界面功能则在 UI 里读取/展示。',
    `契约：${contractSummary(c)}`,
    `功能与触发：${c.features.map((f) => `${f.code}(${f.mode}) ← ${f.triggers.map(triggerLabel).join('、') || '无触发'}`).join('；')}`,
    '请确保实现与上述触发方式一致：例如 regex 触发的功能要能正确解析并处理 context.input 中匹配到的文本。',
    '你可能会看到与用户的历史对话（头脑风暴/问答/此前讨论）作为背景，用于理解用户真实意图；但本插件的权威规格以上面的契约为准。',
    phase === 'minimal'
      ? '本轮目标【最小可运行路径】：只实现一条能被触发、能跑起来的最小 happy path（首个功能即可），保证可构建、可打开，先不要追求完整功能或花哨 UI。同时写一个简洁 README.md。'
      : phase === 'full'
      ? '本轮目标【完整实现】：一次性实现契约中的全部功能，包含健壮的输入校验与错误处理、良好的 UI/UX 与边界情况处理，保证可构建、可打开。同时写一个清晰的 README.md。追求"开箱即用"，而非半成品。'
      : '本轮目标【完善与扩展】：在已有版本上补全完整功能、健壮的错误处理与更好的 UI/UX，保持可编译。'
  ].join('\n')

  const editSystemPrompt = (c: VibeContract, root: string, phase: 'minimal' | 'full' | 'expand') => [
    '你是资深 Mulby 插件工程师，正在**修改一个已存在且可正常构建**的插件。务必最小化改动，不要破坏现有功能。',
    `插件根目录：${root}`,
    'manifest.json 已按用户确认的契约写好，请勿修改它——尤其严禁改动插件形态：不要给静默/无界面插件新增 ui、window 或把功能 mode 改成 detached/ui（即不要把无界面插件改造成有界面插件），除非用户在本次需求里明确要求"加界面/做个窗口"。若用户确实要加界面，必须同时创建 src/ui 入口与 UI 代码，使产物与 manifest 一致，不能只在 manifest 写 ui 却没有界面文件。',
    '工作方式：先 list_dir 看结构、grep/read_file 通读相关文件（manifest.json、src/main.ts、涉及的 src/ui/*）；尽量用 edit_file 做最小增量改动（仅大改才整文件 write_file）；用到 window.mulby.* 前先用 mulby_read_file 查阅 API 文档确认签名与用法；改完用 build_check 自检并据报错修复；停止前调用 check_conformance 确认 manifest 与代码仍然一致（按 error 修复）。完成后用一两句话说明改动并停止。',
    '约束：保持 id/name 不变；保持构建脚本与依赖清单不变；前端只用已存在的 window.mulby.* 能力（用 mulby_read_file 查阅技能 API 文档核实，不要臆造）；保持 TypeScript 可编译；不要动 node_modules/dist。',
    '你可能会看到与用户的历史对话（问答/此前确认的方案/已做过的修改）作为背景；当用户说「按上面的方案 / 刚才说的」时，请依据对话历史执行；以契约与对话上下文共同理解需求。',
    `契约：${contractSummary(c)}`,
    phase === 'minimal'
      ? `本轮目标【最小改动】：仅实现需求「${c.editSummary || sentence}」所需的最小改动。`
      : phase === 'full'
      ? `本轮目标【完整实现需求】：完整实现需求「${c.editSummary || sentence}」所需的全部改动，含必要的健壮性与边界处理，保持可编译。`
      : '本轮目标【完善】：在上一步基础上进一步完善体验与健壮性，保持可编译。'
  ].join('\n')

  const userPrompt = (c: VibeContract, phase: 'minimal' | 'full' | 'expand') => {
    if (c.isEdit) {
      return phase === 'minimal'
        ? `请按下面的需求修改此插件：\n${sentence}\n先读懂现状，做最小改动，完成后说明改动并停止。`
        : phase === 'full'
        ? `请按下面的需求完整修改此插件：\n${sentence}\n先读懂现状，一次性完整实现该需求（含必要健壮性），保持可编译，完成后说明改动并停止。`
        : `请在现有版本上进一步完善与扩展：${sentence}\n保持可编译，完成后停止。`
    }
    return phase === 'minimal'
      ? `请实现这个插件：${sentence}\n定位：${c.description}\n现在开始：先浏览脚手架，实现最小可运行路径，完成后停止。`
      : phase === 'full'
      ? `请实现这个插件：${sentence}\n定位：${c.description}\n请一次性实现完整、开箱即用的版本（含必要错误处理与良好体验），保持可编译，完成后停止。`
      : `请在现有版本上完善与扩展：${sentence}\n补全功能与体验，保持可编译，完成后停止。`
  }

  // 系统化修复（先诊断根因，后最小修复）；attempt≥2 时明确告知"上次修复未奏效"，禁止重复同样修法
  const repairUserPrompt = (log: string, attempt = 1) => [
    attempt >= 2
      ? `注意：这是第 ${attempt} 轮修复——此前的修复没有奏效。不要重复同样的修法：先重新诊断（解释上次的修复为什么没起作用），找到真正的根因再动手。`
      : '',
    '上一次构建失败了。请按以下纪律修复（先诊断，后动手）：',
    '1. 完整阅读下方报错日志，定位报错的文件与行号，read_file 读相关文件；',
    '2. 用一句话向自己明确根因（"X 因为 Y 所以报错"），不确定就继续读代码取证，禁止凭猜测开改；',
    '3. 只做针对根因的最小修复（小改动用 edit_file，大改才 write_file 整文件），一次只验证一个假设，不要一次改多处碰运气、不要顺手重构；',
    '4. 修完必须 build_check 自检：通过才算修复完成；仍失败则带着新报错回到第 1 步重新诊断。',
    '常见原因参考：TypeScript 类型错误、引用了不存在的 window.mulby API、或新增了未安装的依赖。',
    'esbuild 打包注意：原生依赖（如 sharp、better-sqlite3）或使用 createRequire 的包（如 svgo）无法被打包；优先改用 window.mulby 提供的能力（例如图像处理用 window.mulby.sharp）而不是新增 npm 依赖；打包后不存在 node_modules，不要依赖它。',
    '构建错误日志（截断）：',
    '```',
    (log || '').slice(-4000),
    '```'
  ].filter(Boolean).join('\n')

  // 运行时自省的 Mulby API 清单（挂载时取一次；window.mulby 是当前宿主真实对象，最准确）
  const apiSurfaceRef = useRef<string>('')
  useEffect(() => { apiSurfaceRef.current = collectMulbyApiSurface() }, [])

  // 接入宿主维护的 develop-mulby-plugin 技能：把「插件开发知识」交还给单一真相源（技能），
  // 工具仍由本 harness 的 VIBE_TOOLS 提供（enableInternalTools:false + mcp:off，技能不会引入额外工具）。
  // 宿主 ai.skills.list-enabled 现已对插件开放（只读发现），挂载时探测一次；探测不到/旧宿主则优雅回退 skills:off。
  const devSkillIdRef = useRef<string>('')
  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const skills = ai()?.skills
        const list: any[] = (await (skills?.listEnabled?.() ?? skills?.list?.())) || []
        const hit = (Array.isArray(list) ? list : []).find((s) => {
          const id = String(s?.id || '').toLowerCase()
          const name = String(s?.name || '').toLowerCase()
          return id.includes('develop-mulby-plugin') || name.includes('develop-mulby-plugin') || name.includes('mulby plugin')
        })
        if (mounted && hit?.id) devSkillIdRef.current = String(hit.id)
      } catch { /* 优雅降级 */ }
    })()
    return () => { mounted = false }
  }, [])

  /** 生成阶段的技能选择：探测到宿主技能则手动挂载，否则关闭 */
  const skillSelection = (): { mode: 'off' } | { mode: 'manual'; skillIds: string[] } =>
    devSkillIdRef.current ? { mode: 'manual', skillIds: [devSkillIdRef.current] } : { mode: 'off' }

  // 把「当前宿主真实可用的 Mulby API 清单」追加到 system prompt，杜绝臆造不存在的 API
  const withApiSurface = (sys: string): string => {
    const surface = apiSurfaceRef.current
    if (!surface) return sys
    return sys + '\n\n' + [
      '———— 当前 Mulby 宿主真实可用的 API（运行时自省，权威）：仅可使用下列命名空间下的能力，不要臆造其它 API。需要具体签名/用法时用 mulby_read_file 查阅技能提供的 API 文档 ————',
      surface.slice(0, 6000),
      '————'
    ].join('\n')
  }

  // 用代码知识图谱（CodeGraph）为 system prompt 注入「与需求相关的现有代码上下文」，
  // 让 AI 不必反复 read_file/list_dir 探索，从而减少工具调用与 token。库不可用则原样返回。
  const injectCgContext = async (root: string, query: string, phase: EventPhase, baseSystem: string): Promise<string> => {
    if (!root || !query.trim()) return baseSystem
    try {
      const res = await dev.hostCall<{ available?: boolean; markdown?: string; nodeCount?: number; fileCount?: number; reason?: string }>(
        'cg_context', { root, query }
      )
      if (res?.available && res.markdown && res.markdown.trim()) {
        pushEvent(phase, 'note', '已注入代码知识图谱上下文', `${res.nodeCount ?? 0} 符号 / ${res.fileCount ?? 0} 文件`)
        addLog('success', `✔ [Vibe] CodeGraph 注入相关代码上下文（${res.nodeCount ?? 0} 符号 / ${res.fileCount ?? 0} 文件），减少重复浏览`)
        return baseSystem + '\n\n' + [
          '———— 代码知识图谱上下文（CodeGraph 预建索引，可信赖：请直接据此理解现有代码，避免再用 read_file 重复浏览相同内容）————',
          res.markdown.trim(),
          '———— 预建上下文结束；如确需更多细节，仍可用 read_file/list_dir 兜底 ————'
        ].join('\n')
      }
      if (res && res.available === false && res.reason) {
        pushEvent(phase, 'note', 'CodeGraph 不可用，回退常规浏览', res.reason.slice(0, 80))
      }
    } catch {
      /* 优雅降级：忽略，走常规 read_file 流程 */
    }
    return baseSystem
  }

  const runAgent = async (system: string, user: string, root: string, phase: EventPhase, history: ChatMsg[] = [], opts?: { tools?: ReadonlyArray<(typeof VIBE_TOOLS)[number]>; maxToolSteps?: number }) => {
    const a = ai()
    if (!a?.call) throw new Error('当前环境未启用 AI API，无法生成代码')
    if (!root) throw new Error('插件根目录为空，无法开始')
    currentPhaseRef.current = phase
    await dev.hostCall('vibe_begin', { root })
    abortedRef.current = false
    reqIdRef.current = null
    const req = a.call(
      {
        ...(selectedModel ? { model: selectedModel } : {}),
        messages: [{ role: 'system', content: withAnchorContext(system) }, ...history, { role: 'user', content: user }],
        tools: opts?.tools ?? VIBE_TOOLS,
        maxToolSteps: opts?.maxToolSteps ?? 200,
        capabilities: ['fs.read'],
        // 跨轮上下文由本插件自管（锚点 + 滚动摘要 + 历史窗口），关掉宿主按消息条数的截断（默认仅留 8 条，会砍掉我们精心拼的历史）
        params: { contextWindow: 0 },
        mcp: { mode: 'off' }, skills: skillSelection(), toolingPolicy: { enableInternalTools: false }
      },
      onAgentChunk
    )
    return await req
  }

  // ---------------- 阶段 1 → 2：脚手架 + 写契约 manifest（"直接生成"与"按计划生成"共用） ----------------
  // 脚手架(create)/绑定目标(edit) + 写 manifest.json + 建/绑定会话；返回插件根目录与会话 id，失败返回 null。
  // resume=true：项目已就绪（计划续跑/失败重试），不重复脚手架、不重置快照基线、不覆盖 manifest，
  //   避免 ①`mulby create` 遇到已存在目录直接报错导致「继续执行」失败 ②清掉已完成步骤的快照/manifest 改动。
  const prepareProject = async (resume = false): Promise<{ root: string; sid: string | null } | null> => {
    if (!contract) return null
    // B1：生成前校验契约，拦截会写出畸形 manifest 的情况（空展示名/描述、空或重复功能码、触发全空等）。
    // 续跑(resume)复用已有项目、不重写 manifest，故跳过校验。
    if (!resume) {
      const problems = validateContract(contract)
      if (problems.length) {
        pushToast('error', `契约有 ${problems.length} 处需修正：${problems[0]}${problems.length > 1 ? ' 等' : ''}（点顶部「详情」修改）`)
        addLog('warn', `⚠ [Vibe] 契约校验未通过：${problems.join('；')}`)
        return null
      }
    }
    let root = ''
    let sid = activeId
    if (contract.isEdit) {
      root = contract.targetPath || editPath
      if (!root) { pushToast('error', '缺少目标插件目录'); return null }
      setCreatedPath(root)
      if (!resume) pushEvent('scaffold', 'note', `改造目标：${root}`)
    } else if (resume && createdPath) {
      // 续跑：脚手架已存在，直接复用，不再 createPlugin（否则目录已存在会失败）
      root = createdPath
      if (activeId) updateSession(activeId, { state: 'generating' })
      sid = activeId
      pushEvent('scaffold', 'note', '复用已有脚手架（继续执行计划）')
    } else {
      pushEvent('scaffold', 'note', `脚手架 ${contract.name}（${contract.template}）`)
      addLog('info', `▶ [Vibe] 脚手架：${contract.name} → ${targetDir}`)
      const created = await dev.createPlugin(targetDir, contract.name, contract.template)
      if (created.log) addLog(created.success ? 'success' : 'error', created.log)
      if (!created.success) {
        // 目录已存在（重新生成等场景）→ 视为复用已有脚手架而非失败；其它失败才中止
        const dirExists = /已存在|exists/i.test(`${created.error || ''} ${created.log || ''}`)
        if (!dirExists) { pushEvent('scaffold', 'error', created.error || '脚手架失败'); pushToast('error', created.error || '脚手架失败'); return null }
        root = createdPath || `${targetDir}/${contract.name}`
        pushEvent('scaffold', 'note', '复用已有脚手架')
      } else {
        root = created.path || `${targetDir}/${contract.name}`
      }
      setCreatedPath(root)
      // 真实插件目录已知，修正会话的 pluginPath（planCreate 阶段只能先记父目录占位）
      if (!activeId) {
        const sess = createSession({ pluginPath: root, pluginName: contract.displayName || contract.name, vibeMode: 'create', state: 'generating', contract, sentence, genDepth, selectedModel, messages: drainPendingMsgs() })
        liveSessionIdRef.current = sess.id
        sid = sess.id
      } else {
        updateSession(activeId, { pluginPath: root, pluginName: contract.displayName || contract.name, contract, state: 'generating' })
      }
      onAfterCreate()
    }
    // 锁定会话根目录。fresh:true（首次）清历史快照并打基线；fresh:false（续跑）保留历史、仅加一个还原点
    await dev.hostCall('vibe_begin', { root, fresh: !resume })
    // 由契约确定性写出 manifest.json（叠加既有，保留 window/pluginSetting 默认）。
    // 续跑时跳过：避免覆盖前面步骤里 AI 已对 manifest 的合理改动
    if (!resume) {
      // 读 base 必须区分「文件不存在（exists:false，正常按契约新写）」与「读取调用失败（IPC 异常等）」：
      // 后者若静默当作无 manifest，会把磁盘既有 manifest 中契约没有的字段（author/$schema 等）整体抹掉
      // ——weather-card 的 author 正是这样丢的。读取失败时中止本次写入，让用户重试。
      let baseManifest: any = undefined
      let baseRaw = ''
      try {
        const r = await dev.hostCall<{ exists?: boolean; content?: string }>('read_file', { path: 'manifest.json' })
        baseRaw = r?.content || ''
      } catch (e) {
        pushToast('error', `读取既有 manifest.json 失败，已中止以免覆盖丢字段：${e instanceof Error ? e.message : ''}`)
        addLog('error', '✗ [Vibe] read_file manifest.json 失败，中止写契约（避免抹掉 author 等既有字段）')
        return null
      }
      if (baseRaw) {
        try { baseManifest = JSON.parse(baseRaw) } catch { /* manifest 损坏 → 按契约重写自愈 */ }
      }
      const mfText = manifestJson(contract, baseManifest)
      await dev.hostCall('write_file', { path: 'manifest.json', content: mfText })
      pushEvent('manifest', 'write', '写入 manifest.json（来自契约）', `${contract.features.length} 个功能`)
    }
    return { root, sid }
  }

  // ---------------- P1：生成后 AI 自审（requesting-code-review） ----------------
  // 生成完成后、交付构建前，以独立评审视角对照契约审查本次改动（只读工具，杜绝顺手改码）。
  // 与 check_conformance 互补：conformance 查 manifest↔代码结构一致，自审查实现逻辑质量。
  // critical 问题自动修一轮（带写工具）后再交付；审查失败/超时/中止一律放行，不阻塞交付。
  const reviewSystemPrompt = (c: VibeContract, root: string): string => [
    '你是严苛、独立的 Mulby 插件代码评审员。另一位工程师刚按契约实现/修改了这个插件，请你以挑刺的眼光审查改动质量。',
    `插件根目录：${root}`,
    '你只有只读工具（list_dir/read_file/grep）。先看改动文件清单，read_file 重点审查核心实现，必要时 grep 交叉验证；不要试图修改任何文件。',
    `契约（权威规格）：${contractSummary(c)}`,
    `功能与触发：${c.features.map((f) => `${f.code}(${f.mode}) ← ${f.triggers.map(triggerLabel).join('、') || '无触发'}`).join('；')}`,
    c.isEdit ? `本次改造需求：${c.editSummary || sentence}` : `插件需求：${sentence}`,
    '审查清单：',
    '1. 契约符合：每个功能/触发方式是否真的实现？regex/over 触发是否正确处理 context.input？',
    '2. 正确性：明显逻辑错误、空值/异常未防护、走不到的分支；',
    '3. API 真实性：是否臆造了不存在的 window.mulby API、或引入了打包不了的 npm 依赖；',
    '4. 边界：空输入/非法输入的行为是否友好；',
    '5. 不审风格：命名、格式、注释等一概不提。',
    '分级标准：critical=功能不符契约/无法运行/会崩溃；important=明显缺陷或关键边界缺失；minor=小改进。',
    '审查完只输出 JSON（不要 Markdown 代码块）：{ "verdict": "pass" | "fix", "issues": [ { "level": "critical|important|minor", "file": "相对路径", "message": "一句话问题", "hint": "一句话修法" } ] }。没有问题输出 { "verdict": "pass", "issues": [] }；有 critical 必须 verdict="fix"。'
  ].join('\n')

  const reviewFixPrompt = (issues: ReviewIssue[]): string => [
    '独立代码评审发现以下必须修复（critical）的问题。请逐条修复，保持最小改动，不要顺手重构：',
    ...issues.map((i, idx) => `${idx + 1}. ${i.file ? `[${i.file}] ` : ''}${i.message}${i.hint ? `（建议：${i.hint}）` : ''}`),
    '修完必须 build_check 自检通过，然后用一句话说明修复内容并停止。'
  ].join('\n')

  const parseReviewResult = (content: string): { verdict: 'pass' | 'fix'; issues: ReviewIssue[] } => {
    const fallback = { verdict: 'pass' as const, issues: [] }
    const json = extractJsonObject(content)
    if (!json) return fallback
    try {
      const parsed = JSON.parse(json)
      const issues: ReviewIssue[] = (Array.isArray(parsed?.issues) ? parsed.issues : [])
        .filter((x: any) => x && typeof x.message === 'string' && x.message.trim())
        .slice(0, 12)
        .map((x: any) => ({
          level: x.level === 'critical' ? 'critical' : x.level === 'important' ? 'important' : 'minor',
          file: typeof x.file === 'string' && x.file.trim() ? x.file.trim() : undefined,
          message: String(x.message).trim().slice(0, 200),
          hint: typeof x.hint === 'string' && x.hint.trim() ? x.hint.trim().slice(0, 200) : undefined
        }))
      return { verdict: parsed?.verdict === 'fix' || issues.some((i) => i.level === 'critical') ? 'fix' : 'pass', issues }
    } catch { return fallback }
  }

  const runSelfReview = async (root: string, sid: string | null): Promise<void> => {
    if (!contract) return
    setReviewing(true)
    try {
      pushEvent('full', 'ai', 'AI 自审本次改动…')
      addLog('info', '▶ [Vibe] AI 自审本次改动…')
      // 改动清单来自影子库 diff：给评审一个聚焦范围（拿不到就让它自己浏览）
      let changedList = ''
      try {
        const r = await dev.hostCall<{ changes?: VibeChange[] }>('vibe_changes', { root })
        changedList = (r?.changes || []).slice(0, 30).map((c) => `${c.status} ${c.path}`).join('\n')
      } catch { /* 清单只是辅助 */ }
      const user = changedList
        ? `本次改动的文件：\n${changedList}\n\n请审查这些改动（read_file 重点文件），输出 JSON 结论。`
        : '请浏览插件目录，审查最近实现的代码是否符合契约，输出 JSON 结论。'
      const final = await runAgent(withApiSurface(reviewSystemPrompt(contract, root)), user, root, 'full', [], { tools: VIBE_READ_TOOLS, maxToolSteps: 40 })
      if (abortedRef.current) return
      const { issues } = parseReviewResult(typeof final?.content === 'string' ? final.content : '')
      const criticals = issues.filter((i) => i.level === 'critical')
      const others = issues.filter((i) => i.level !== 'critical')
      if (!issues.length) {
        pushEvent('full', 'note', 'AI 自审通过')
        addLog('success', '✔ [Vibe] AI 自审通过：未发现问题')
        return
      }
      pushEvent('full', criticals.length ? 'error' : 'note', `AI 自审发现 ${issues.length} 处问题`, criticals.length ? `${criticals.length} 处需修复` : '均为建议')
      addLog(criticals.length ? 'warn' : 'info', `⚠ [Vibe] AI 自审：critical ${criticals.length} 处 / 建议 ${others.length} 处`)
      // 非 critical：对话里告知即可，不自动改（避免无止境完善）
      if (sid && others.length) {
        const lines = others.slice(0, 5).map((i) => `• ${i.message}${i.hint ? `（建议：${i.hint}）` : ''}`).join('\n')
        appendMessage(sid, mkMsg('assistant', `代码自审发现 ${others.length} 处可改进（不影响交付）：\n${lines}${others.length > 5 ? '\n…' : ''}\n\n需要我处理的话直接说。`))
      }
      if (!criticals.length) return
      // critical：自动修一轮（带写工具），随后的构建 + 一致性校验做兜底验证；不二次审查，避免循环
      if (sid) appendMessage(sid, mkMsg('assistant', `代码自审发现 ${criticals.length} 处必须修复的问题，我先修掉再交付：\n${criticals.map((i) => `• ${i.message}`).join('\n')}`))
      pushEvent('full', 'ai', `AI 修复自审问题…（${criticals.length} 处）`)
      addLog('info', `▶ [Vibe] 修复自审 critical 问题（${criticals.length} 处）…`)
      turnEventsRef.current = [] // 让修复总结只内联修复期间的动作
      let sys = contract.isEdit ? editSystemPrompt(contract, root, 'minimal') : createSystemPrompt(contract, root, 'minimal')
      sys = withApiSurface(sys)
      const fixFinal = await runAgent(sys, reviewFixPrompt(criticals), root, 'full', buildHistoryMessages())
      if (abortedRef.current) return
      const fixSummary = typeof fixFinal?.content === 'string' ? fixFinal.content : ''
      if (sid && fixSummary) appendMessage(sid, mkMsg('assistant', fixSummary, { actions: collectTurnActions() }))
      pushEvent('full', 'note', '自审问题修复完成')
      addLog('success', '✔ [Vibe] 自审 critical 问题修复完成')
    } catch (e) {
      addLog('warn', `⚠ [Vibe] AI 自审未完成（已跳过，不影响交付）：${e instanceof Error ? e.message : ''}`)
    } finally {
      setReviewing(false)
    }
  }

  // 直接生成（不分步）：脚手架 → 一次性完整实现 → 交付。作为"计划模式"失败时的兜底路径。
  // opts.retry：上次生成中途失败（AI 服务 503 等）后的重试——复用已有脚手架与快照基线（prepareProject(resume)），
  //   不重写 manifest、不重复记「确认设定」消息，从当前磁盘进度继续。
  const doGenerate = async (opts?: { retry?: boolean }) => {
    if (!contract) return
    const retry = !!opts?.retry
    repairRoundsRef.current = 0 // 新一轮生成：修复轮次清零
    setBrainstorm(null)
    setClarify(null)
    recordMessage(retry
      ? mkMsg('user', '重试生成', { intent: 'create' })
      : mkMsg('user', contract.isEdit ? '确认设定，开始改造' : '确认设定，开始生成', { intent: 'create' }))
    setGenerating(true)
    setEvents([])
    setToolCalls(0)
    setNarration('')
    turnEventsRef.current = [] // 收集本轮生成的操作明细，供对话内联
    setExpanded(false)
    setStage(2)
    setDrawerOpen(true) // 展开详情抽屉，让生成过程(思考 + 工具调用时间线)可见
    resetAbort()
    try {
      const prep = await prepareProject(retry)
      if (!prep) return
      const { root, sid } = prep
      // 首轮生成：根据用户所选生成深度——full=一次性完整实现（默认）；minimal=先最小可跑
      const firstPhase: 'minimal' | 'full' = genDepth === 'minimal' ? 'minimal' : 'full'
      const phaseName = firstPhase === 'minimal' ? '最小可运行版本' : '完整版本'
      pushEvent(firstPhase, 'ai', contract.isEdit
        ? (firstPhase === 'minimal' ? 'AI 读现状并做最小改动…' : 'AI 读现状并完整实现需求…')
        : (firstPhase === 'minimal' ? 'AI 实现最小可运行路径…' : 'AI 实现完整版本…'))
      addLog('info', `▶ [Vibe] AI 生成${phaseName}…`)
      let sys = contract.isEdit ? editSystemPrompt(contract, root, firstPhase) : createSystemPrompt(contract, root, firstPhase)
      // 改造模式：已有代码，先用知识图谱注入相关上下文，省去 AI 反复 read_file
      if (contract.isEdit) sys = await injectCgContext(root, contract.editSummary || sentence, firstPhase, sys)
      sys = withApiSurface(sys)
      const final = await runAgent(sys, userPrompt(contract, firstPhase), root, firstPhase, buildHistoryMessages())
      if (abortedRef.current) { pushEvent(firstPhase, 'note', '已中止'); return }
      const summary = typeof final?.content === 'string' ? final.content : ''
      if (summary) setNarration(summary)
      // 把生成总结作为一条 AI 回复落入对话历史（不再等到构建成功才有第一条回复）
      if (sid && summary) appendMessage(sid, mkMsg('assistant', summary, { actions: collectTurnActions() }))
      setGenerated(true)
      pushEvent(firstPhase, 'note', `${phaseName}完成`)
      addLog('success', `✔ [Vibe] ${phaseName}完成`)
      // P1：交付前 AI 自审（critical 自动修复；失败/中止不阻塞交付）
      await runSelfReview(root, sid)
      pendingCommitMsgRef.current = contract.isEdit
        ? `改造：${(contract.editSummary || sentence).slice(0, 120)}`
        : `${firstPhase === 'minimal' ? '生成最小版本' : '生成'}：${sentence.slice(0, 120)}`
      deliverStartedRef.current = false
      setStage(3)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '生成失败'
      const isAbort = abortedRef.current || msg.toLowerCase().includes('abort')
      if (!isAbort) {
        pushEvent('minimal', 'error', msg); pushToast('error', msg); addLog('error', `✘ [Vibe] 生成失败：${msg}`)
        // AI 服务抖动（503/超时等）导致中断 → 对话里给出错误说明 + 重试卡，已完成的进度保留在磁盘，重试从当前进度继续
        const sid = liveSessionIdRef.current || activeId
        if (sid) appendMessage(sid, mkMsg('assistant', `生成中断了：${msg}\n\n已完成的改动都保留着。点下方「重试生成」从当前进度继续（多为 AI 服务临时不可用，稍等片刻再试即可）。`, { actions: collectTurnActions() }))
        setPendingPrompt({
          kind: 'action',
          title: '生成失败',
          desc: `${msg.slice(0, 160)}${msg.length > 160 ? '…' : ''}`,
          actionLabel: '重试生成',
          onAction: () => { setPendingPrompt(null); void doGenerate({ retry: true }) }
        })
      }
    } finally {
      setGenerating(false)
      void dev.hostCall('vibe_end').catch(() => {})
    }
  }

  // ---------------- Plan 模式：契约确认后→生成前，先制定开发计划(todo list)，再逐步执行、实时勾选 ----------------
  const planListPrompt = (c: VibeContract) => [
    '你是资深 Mulby 插件架构师。把"实现这个插件"拆解成一份清晰、可执行的开发计划（todo list）。',
    // 平台背景：让计划基于"Mulby 是什么 / 插件长什么样 / 有哪些真实能力"来排，而不是泛泛而谈
    '关于 Mulby（制定计划前必须了解）：Mulby 是桌面启动器 / 插件平台，用户通过关键词、正则匹配选中文本、拖入文件或图片、窗口等方式唤起插件。一个插件由三部分组成：① manifest.json（清单：id/name 与功能 features、触发方式——已由工具按契约写好，计划里不要再包含它）；② src/main.ts（后端：导出 onLoad/onUnload/onEnable/onDisable/run；无界面/静默功能在 run(context) 里用 context.input 拿到输入文本、用 context.featureCode 区分功能）；③ src/ui/（前端，仅"有界面"功能需要：React 入口 src/ui/main.tsx 挂载 src/ui/App.tsx）。前端通过全局 window.mulby.*（剪贴板/通知/文件/AI/图像处理等）调用宿主能力，不要臆造不存在的 API。',
    '只输出 JSON：{ "todos": [ { "title": "简短步骤名(≤20字)", "detail": "这一步具体做什么(一句话)", "verify": "这一步怎么算完成(一句可验证的验收标准)" } ] }，不要解释、不要 Markdown 代码块。',
    '要求：3–6 步，按依赖与实现顺序排列；每步是一个独立、可验证的开发动作（如"实现核心处理逻辑""搭建主界面 UI""接入剪贴板/通知能力""完善错误处理与边界""自检构建并修复问题"）；计划要落到下方列出的功能/触发方式与 Mulby 真实能力（见上文 Mulby 平台说明）上，不要排出平台做不到的步骤。',
    '不要把"创建脚手架/写 manifest.json"列进去（已自动完成）；最后一步通常是"自检构建并修复问题"。',
    '步骤拆解原则：① 顺序≈ 后端核心(src/main.ts 的 run/onLoad 主逻辑) → 前端界面(仅 template=react 才有 src/ui) → 能力接入(剪贴板/通知/文件/AI…) → 边界与错误处理 → 自检构建；② 纯命令/无界面插件(basic) 不要排"搭建 UI"这类步骤；③ 每步只描述"做什么(可验证的产出)"，不写具体代码或文件全路径；④ detail 一句话点明该步落到哪个功能/触发/能力上。',
    'verify 写法：必须是执行者自己能客观核对的标准，落到具体行为上（如"run() 对输入 1234.56 返回人民币大写金额且构建通过""界面能展示解析结果并处理空输入"），不要写"代码质量良好"这类无法核对的话。',
    '示例(仅供参考结构，按真实需求与上面契约调整步数和内容)：',
    '- 有界面(react)：实现核心处理逻辑 → 搭建主界面与交互 → 接入所需 Mulby 能力 → 完善边界与错误提示 → 自检构建并修复；',
    '- 无界面(basic，如"金额转大写")：在 run() 解析输入金额 → 实现转换核心算法 → 校验非法输入并返回友好结果 → 自检构建并修复。',
    c.isEdit ? `这是对现有插件的改造，需求：${c.editSummary || sentence}` : `插件需求：${sentence}`,
    `契约：${contractSummary(c)}`,
    `功能与触发：${c.features.map((f) => `${f.code}(${f.mode}) ← ${f.triggers.map(triggerLabel).join('、') || '无触发'}`).join('；')}`
  ].join('\n')

  const normalizePlan = (parsed: any): VibePlanTodo[] => {
    const arr = Array.isArray(parsed?.todos) ? parsed.todos : Array.isArray(parsed) ? parsed : []
    const todos: VibePlanTodo[] = []
    for (const it of arr) {
      const title = String(it?.title ?? it?.name ?? '').trim()
      if (!title) continue
      const detail = String(it?.detail ?? it?.description ?? '').trim()
      const verify = String(it?.verify ?? it?.acceptance ?? '').trim()
      todos.push({
        id: `t${todos.length + 1}`,
        title: title.slice(0, 40),
        detail: detail ? detail.slice(0, 200) : undefined,
        verify: verify ? verify.slice(0, 200) : undefined,
        status: 'pending'
      })
      if (todos.length >= 8) break
    }
    return todos
  }

  // 计划自审（writing-plans 的 Self-Review）：计划生成后先以挑刺视角自查一遍，缺口自动补齐再交给用户审阅。
  // 五查：覆盖（契约功能都有对应步骤）/ 可行（平台做得到）/ 空洞（步骤可验证）/ 顺序（依赖合理）/ verify（标准可核对）。
  const planReviewPrompt = (c: VibeContract, todos: VibePlanTodo[]) => [
    '你是严苛的计划评审员。下面是一份 Mulby 插件开发计划（todo list），请用挑刺的眼光自查，发现问题就修正。',
    '逐项检查：',
    '1. 覆盖：契约的每个功能与触发方式都能对应到某一步吗？漏了就补一步。',
    '2. 可行：有没有 Mulby 平台做不到、或与契约矛盾的步骤？有就改掉。',
    '3. 空洞：有没有"优化代码质量"这类无具体产出、无法验证的步骤？改写为可验证动作或删除。',
    '4. 顺序：步骤是否按依赖排列（核心逻辑 → 界面(仅 react) → 能力接入 → 边界处理 → 自检构建）？',
    '5. verify：每步的 verify 是否客观可核对？含糊的改具体。',
    '只输出 JSON：计划没有问题输出 { "ok": true }；有问题输出 { "ok": false, "issues": ["一句话说明的问题"], "todos": [修正后的完整计划，字段 title/detail/verify 同输入] }。todos 必须是修正后的全量列表（3-8 步），不要只输出改动项。',
    `契约：${contractSummary(c)}`,
    `功能与触发：${c.features.map((f) => `${f.code}(${f.mode}) ← ${f.triggers.map(triggerLabel).join('、') || '无触发'}`).join('；')}`,
    c.isEdit ? `改造需求：${c.editSummary || sentence}` : `插件需求：${sentence}`,
    '当前计划：',
    JSON.stringify({ todos: todos.map((t) => ({ title: t.title, detail: t.detail || '', verify: t.verify || '' })) })
  ].join('\n')

  /** 自审一份计划：返回修正结果（null = 通过或自审不可用，沿用原计划） */
  const reviewPlan = async (c: VibeContract, todos: VibePlanTodo[]): Promise<{ todos: VibePlanTodo[]; issues: string[] } | null> => {
    try {
      const parsed = await aiJson('你是严格的 JSON 生成器，只输出可解析的 JSON 对象。', planReviewPrompt(c, todos))
      if (!parsed || parsed.ok === true) return null
      const fixed = normalizePlan(parsed)
      if (!fixed.length) return null
      const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
      return { todos: fixed, issues }
    } catch { return null }
  }

  // 契约确认后 → 制定开发计划（不立即生成）。成功则进入 review 等用户「开始执行」；失败回退直接生成。
  // opts.feedback：用户在「计划审阅」阶段用对话提出的调整意见 → 带着上一版计划与意见重新规划（而不是直接执行）。
  const generatePlan = async (opts?: { feedback?: string }) => {
    if (!contract || aiActive) return
    const feedback = opts?.feedback?.trim()
    const prevPlan = feedback ? plan : [] // 重新规划：保留上一版计划作为上下文（也用于失败回滚）
    setBrainstorm(null)
    setClarify(null)
    // 重新规划由用户的真实对话消息触发（已记录），不再补「确认设定」这条合成消息
    if (!feedback) recordMessage(mkMsg('user', '确认设定，先制定开发计划', { intent: 'create' }))
    planPreparedRef.current = false
    setPlan([])
    setPlanPhase('planning')
    setPlanning(true)
    resetAbort()
    try {
      addLog('info', feedback ? '▶ [Vibe] AI 正在按你的意见重新制定开发计划…' : '▶ [Vibe] AI 正在制定开发计划…')
      // planListPrompt 自带 Mulby 平台说明与能力提示，已足够；不再注入完整 API 清单（会撑大这次 JSON 抽取、易让模型跑偏）。
      // 改造模式仍注入 CodeGraph 现有结构，让计划基于真实代码而非盲拆。完整 API 清单在执行阶段(executePlan)注入。
      let planUser = planListPrompt(contract)
      if (feedback) {
        planUser += '\n\n———— 重新规划（用户对上一版计划提出了调整意见）————\n上一版开发计划：\n'
          + (prevPlan.length ? prevPlan.map((t, i) => `${i + 1}. ${t.title}${t.detail ? `（${t.detail}）` : ''}`).join('\n') : '（无）')
          + `\n用户的调整意见：${feedback}\n请在合理保留原计划的基础上，按用户意见调整后重新输出完整的开发计划（仍是 JSON；步骤数可增减）。`
      }
      if (contract.isEdit) {
        const editRoot = contract.targetPath || editPath
        if (editRoot) planUser = await injectCgContext(editRoot, contract.editSummary || sentence, 'full', planUser)
      }
      if (abortedRef.current) { if (feedback) { setPlan(prevPlan); setPlanPhase('review') } else setPlanPhase('idle'); addLog('info', '⏹ [Vibe] 已停止制定计划'); return }
      let parsed: any = null
      try { parsed = await aiJson('你是严格的 JSON 生成器，只输出可解析的 JSON 对象。', planUser) } catch { /* fallback below */ }
      if (abortedRef.current) { if (feedback) { setPlan(prevPlan); setPlanPhase('review') } else setPlanPhase('idle'); addLog('info', '⏹ [Vibe] 已停止制定计划'); return }
      const todos = normalizePlan(parsed)
      if (!todos.length) {
        if (feedback) {
          // 重新规划失败：保留上一版计划，回到 review，让用户再说一次或直接执行（不擅自全量生成）
          addLog('warn', '⚠ [Vibe] 重新规划未解析出步骤，沿用上一版计划')
          setPlan(prevPlan)
          setPlanPhase('review')
          recordMessage(mkMsg('assistant', '抱歉，这次没能按你的意见重排出计划，先沿用上一版。你可以再说一次想怎么调整，或点「开始执行」。'))
          setPlanning(false)
          return
        }
        addLog('warn', '⚠ [Vibe] 计划未解析出步骤，转为直接完整实现')
        setPlanPhase('idle')
        recordMessage(mkMsg('assistant', '没能拆出分步计划，我直接开始完整实现。'))
        setPlanning(false)
        await doGenerate()
        return
      }
      // 计划自审（Self-Review）：覆盖/可行/空洞/顺序/verify 五查，发现缺口自动修正后再交用户审阅；自审失败不阻塞（沿用原计划）
      let finalTodos = todos
      let reviewNote = ''
      addLog('info', '▶ [Vibe] 计划自审中…')
      const reviewed = await reviewPlan(contract, todos)
      if (abortedRef.current) { if (feedback) { setPlan(prevPlan); setPlanPhase('review') } else setPlanPhase('idle'); addLog('info', '⏹ [Vibe] 已停止制定计划'); return }
      if (reviewed) {
        finalTodos = reviewed.todos
        reviewNote = reviewed.issues.length
          ? `\n\n计划自审修正了 ${reviewed.issues.length} 处：${reviewed.issues.slice(0, 3).join('；')}${reviewed.issues.length > 3 ? ' 等' : ''}`
          : ''
        addLog('warn', `⚠ [Vibe] 计划自审修正${reviewed.issues.length ? ` ${reviewed.issues.length} 处：${reviewed.issues.join('；')}` : '了计划'}`)
      } else {
        addLog('success', '✔ [Vibe] 计划自审通过')
      }
      setPlan(finalTodos)
      setPlanPhase('review')
      recordMessage(mkMsg('assistant', `${feedback ? '已按你的意见重新规划为' : '我把开发拆成了'} ${finalTodos.length} 步：\n${finalTodos.map((t, i) => `${i + 1}. ${t.title}`).join('\n')}${reviewNote}\n\n点「开始执行」我就按计划一步步实现，每完成一步都会勾选；要继续调整就直接告诉我。`))
      addLog('success', `✔ [Vibe] 开发计划已就绪：${finalTodos.length} 步`)
    } catch (e) {
      if (feedback) {
        // 重新规划出错：保留上一版计划，回到 review（不擅自全量生成，避免丢掉用户正在审阅的计划）
        setPlan(prevPlan)
        setPlanPhase('review')
        recordMessage(mkMsg('assistant', '重新规划时出错，先沿用上一版计划。你可以再说一次想怎么调整，或点「开始执行」。'))
        setPlanning(false)
        return
      }
      setPlanPhase('idle')
      recordMessage(mkMsg('assistant', '制定计划时出错，我直接开始完整实现。'))
      setPlanning(false)
      await doGenerate()
      return
    } finally {
      setPlanning(false)
    }
  }

  // 单步执行的 system/user prompt：复用整体规约（full），但强制"本轮只做当前这一步"。
  // 完成门禁（verification-before-completion）：停止前必须 build_check 通过 + 对照本步验收标准自查，无新鲜验证证据不得声称完成。
  const planStepSystem = (c: VibeContract, root: string, todos: VibePlanTodo[], idx: number): string => {
    const base = c.isEdit ? editSystemPrompt(c, root, 'full') : createSystemPrompt(c, root, 'full')
    const cur = todos[idx]
    return base + '\n\n' + [
      '———— 分步执行模式（本轮只做一步）————',
      '整个插件已制定下面的开发计划。请忽略上文"一次性完整实现"的说法：本轮只完成「当前步骤」，不要提前实现后续步骤；同时不要破坏前面已完成步骤的成果（先 read_file 看现有代码再改）。',
      '开发计划：',
      todos.map((t, i) => `${i + 1}. ${i < idx ? '✅ 已完成' : i === idx ? '▶ 进行中' : '⬜ 待办'} ${t.title}${t.detail ? `（${t.detail}）` : ''}`).join('\n'),
      `当前步骤（第 ${idx + 1}/${todos.length} 步）：${cur.title}${cur.detail ? ` — ${cur.detail}` : ''}`,
      cur.verify ? `本步验收标准：${cur.verify}` : '',
      '完成门禁（全部满足才允许停止）：① 本步改动已写入文件；② 调用 build_check 且通过——失败就按报错修复后重新自检，直到通过；③ 对照验收标准逐条自查达成。没有本轮新鲜的 build_check 通过结果，不得声称本步完成。',
      '满足门禁后，用一句话说明本步改动并停止（不要继续做后面的步骤）。'
    ].filter(Boolean).join('\n')
  }

  const planStepUser = (todo: VibePlanTodo, idx: number, total: number): string =>
    `请完成开发计划的第 ${idx + 1}/${total} 步：${todo.title}${todo.detail ? `\n（${todo.detail}）` : ''}${todo.verify ? `\n本步验收标准：${todo.verify}` : ''}\n先读懂当前代码现状，只实现这一步所需的改动；停止前必须 build_check 通过（失败就修到通过）并对照验收标准自查，然后用一句话说明本步改动并停止。`

  // 按计划逐步执行：脚手架 → 逐个 todo（实时勾选）→ 全部完成后交付构建。已完成的 todo 跳过（支持中断/失败后续跑）。
  const executePlan = async () => {
    // planExecutingRef：即便「停止」已把 generating 复位（aiActive=false），上一轮循环可能仍在收尾——此时拒绝新一轮，杜绝并发
    if (!contract || aiActive || planExecutingRef.current) return
    if (!plan.length) { await generatePlan(); return }
    // 续跑判定：项目已脚手架（本次会话已准备过，或重载后存在已完成/失败步骤）→ prepareProject 跳过重复脚手架与基线重置
    const resume = planPreparedRef.current || plan.some((t) => t.status === 'done' || t.status === 'failed')
    planExecutingRef.current = true
    repairRoundsRef.current = 0 // 新一轮执行：修复轮次清零
    setBrainstorm(null)
    setClarify(null)
    recordMessage(mkMsg('user', resume ? '继续执行计划' : '开始执行计划', { intent: 'create' }))
    setPlanPhase('executing')
    setGenerating(true)
    setEvents([])
    setToolCalls(0)
    setNarration('')
    turnEventsRef.current = []
    setExpanded(false)
    setStage(2)
    setDrawerOpen(true) // 展开详情抽屉，让逐步执行过程(思考 + 工具调用时间线)可见
    resetAbort()
    try {
      const prep = await prepareProject(resume)
      if (!prep) { setPlanPhase('review'); return }
      planPreparedRef.current = true
      const { root, sid } = prep
      const todos = plan
      for (let i = 0; i < todos.length; i++) {
        if (todos[i].status === 'done') continue
        if (abortedRef.current) break
        setPlan((prev) => prev.map((t, j) => (j === i ? { ...t, status: 'in_progress' } : t)))
        setNarration('')
        turnEventsRef.current = []
        pushEvent('full', 'ai', `第 ${i + 1}/${todos.length} 步：${todos[i].title}`, todos[i].detail)
        addLog('info', `▶ [Vibe] 计划第 ${i + 1}/${todos.length} 步：${todos[i].title}`)
        let sys = planStepSystem(contract, root, todos, i)
        if (contract.isEdit) sys = await injectCgContext(root, `${todos[i].title} ${todos[i].detail || ''}`, 'full', sys)
        sys = withApiSurface(sys)
        let stepSummary = ''
        try {
          const final = await runAgent(sys, planStepUser(todos[i], i, todos.length), root, 'full', buildHistoryMessages())
          stepSummary = typeof final?.content === 'string' ? final.content : ''
        } catch (e) {
          if (abortedRef.current) break
          const msg = e instanceof Error ? e.message : '步骤失败'
          setPlan((prev) => prev.map((t, j) => (j === i ? { ...t, status: 'failed' } : t)))
          pushEvent('full', 'error', `第 ${i + 1} 步失败：${msg}`)
          addLog('error', `✘ [Vibe] 计划第 ${i + 1} 步失败：${msg}`)
          if (sid) appendMessage(sid, mkMsg('assistant', `第 ${i + 1} 步「${todos[i].title}」执行失败：${msg}。点「继续执行」可重试这一步，或在对话里告诉我怎么调整。`))
          setPlanPhase('review')
          return
        }
        if (abortedRef.current) break
        setPlan((prev) => prev.map((t, j) => (j === i ? { ...t, status: 'done' } : t)))
        pushEvent('full', 'note', `第 ${i + 1} 步完成`)
        // P1：步级快照——每完成一步就提交一个影子版本，支持按步回滚（失败不阻塞执行）
        try {
          const cr = await dev.hostCall<{ ok?: boolean; nochange?: boolean; hash?: string }>('vcs_commit', { root, message: `计划第 ${i + 1}/${todos.length} 步：${todos[i].title}` })
          if (cr?.ok && !cr.nochange) pushEvent('full', 'note', '已记录步级版本', cr.hash || undefined)
        } catch { /* 快照只是辅助 */ }
        if (sid) appendMessage(sid, mkMsg('assistant', `✅ 第 ${i + 1}/${todos.length} 步完成：${todos[i].title}${stepSummary ? `\n\n${stepSummary}` : ''}`, { actions: collectTurnActions() }))
      }
      if (abortedRef.current) {
        setPlan((prev) => prev.map((t) => (t.status === 'in_progress' ? { ...t, status: 'pending' } : t)))
        setPlanPhase('review')
        pushEvent('full', 'note', '已停止执行计划')
        addLog('warn', '⏹ [Vibe] 已停止执行计划（点「继续执行」可接着跑）')
        return
      }
      // 全部完成 → 交付构建（沿用 stage 3 的自动构建载入）
      setPlanPhase('done')
      setGenerated(true)
      setNarration('')
      addLog('success', `✔ [Vibe] 开发计划全部完成（${todos.length} 步）`)
      // P1：交付前 AI 自审（critical 自动修复；失败/中止不阻塞交付）
      await runSelfReview(root, sid)
      pendingCommitMsgRef.current = contract.isEdit
        ? `改造：${(contract.editSummary || sentence).slice(0, 120)}`
        : `生成：${sentence.slice(0, 120)}`
      deliverStartedRef.current = false
      setStage(3)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '执行失败'
      const isAbort = abortedRef.current || msg.toLowerCase().includes('abort')
      if (!isAbort) {
        pushEvent('full', 'error', msg); pushToast('error', msg); addLog('error', `✘ [Vibe] 执行计划失败：${msg}`); setPlanPhase('review')
        const sid = liveSessionIdRef.current || activeId
        if (sid) appendMessage(sid, mkMsg('assistant', `执行计划时出错：${msg}\n\n已完成的步骤不受影响，点「继续执行」可从中断处接着跑。`))
      }
    } finally {
      setGenerating(false)
      planExecutingRef.current = false
      void dev.hostCall('vibe_end').catch(() => {})
    }
  }

  // 统一「停止 AI 生成」：标记中断 + 精确 abort 在途请求 + 复位所有 AI 忙碌态 + 释放宿主会话锁。
  // 覆盖所有 AI 流程（规划/头脑风暴/生成/迭代/问答/修复/一致性修复/图标），右侧对话与左侧面板共用。
  const stopAgent = () => {
    const running = planning || generating || expanding || repairing || reviewing || iterating || iconBusy || confRepairing || routing || !!brainstorm?.loading || !!clarify?.loading
    if (!running) return
    abortedRef.current = true
    if (reqIdRef.current) { try { ai()?.abort?.(reqIdRef.current) } catch { /* 宿主未实现 abort 时忽略 */ } }
    setGenerating(false); setExpanding(false); setRepairing(false); setReviewing(false)
    setIterating(false); setPlanning(false); setConfRepairing(false); setIconBusy(false); setRouting(false)
    setBrainstorm((b) => (b && b.loading ? null : b))
    setClarify((c) => (c && c.loading ? null : c))
    setNarration('')
    void dev.hostCall('vibe_end').catch(() => {})
    pushEvent(currentPhaseRef.current, 'note', '用户已停止生成')
    addLog('warn', '⏹ [Vibe] 已停止本次 AI 生成')
    pushToast('info', '已停止生成')
  }

  // ---------------- 阶段 3：构建 · 载入 · 图标 · 调试 ----------------
  // 读取已生成的 icon.png 为 dataURL，供交付页展示
  const loadIconPreview = async () => {
    if (!createdPath) { setIconDataUrl(null); return }
    const fs = fsApi()
    try {
      if (fs?.exists && !(await fs.exists(`${createdPath}/icon.png`))) { setIconDataUrl(null); return }
      const b64 = await fs?.readFile?.(`${createdPath}/icon.png`, 'base64')
      if (typeof b64 === 'string' && b64) {
        setIconDataUrl(`data:image/png;base64,${b64.replace(/^data:image\/\w+;base64,/, '')}`)
      }
    } catch { /* 读取失败则不展示，忽略 */ }
  }

  // 依据插件的主题/功能/触发方式（以及用户可选的风格补充）构造图标设计提示词
  const buildIconPrompt = (c: VibeContract, styleHint?: string): string => {
    const feats = c.features
      .map((f) => `- ${(f.explain || f.code || '').trim()}`)
      .filter((l) => l !== '- ')
      .slice(0, 6)
      .join('\n')
    const trig = primaryTrigger(c)
    const hint = (styleHint || '').trim()
    return [
      '为一款 Mulby 桌面效率插件设计一枚应用图标（icon）。请先理解它的主题与功能，再让图形「一眼能联想到它做什么」。',
      `插件名称：${c.displayName}`,
      `一句话用途：${c.description}`,
      c.type ? `所属分类：${c.type}` : '',
      feats ? `主要功能：\n${feats}` : '',
      trig ? `典型使用方式：${trig}` : '',
      hint ? `用户的原话（据此理解期望的风格/主题/配色，但忽略其中「重新生成 / 换一个 / 重做」等指令性词语）：${hint}` : '',
      '设计要求：512x512 的 viewBox；居中单一主图形（可含简洁辅助元素）；扁平、现代、极简且有质感；配色鲜明且和谐，贴合功能氛围（可用渐变）；圆角方形背景；不要任何文字、字母或数字；在 32px 小尺寸下依然清晰可辨。'
    ].filter(Boolean).join('\n')
  }

  // 让 AI 产出一段可解析的 SVG（失败再严格重试一次），拿不到返回 null
  const requestIconSvg = async (a: any, c: VibeContract, styleHint?: string): Promise<string | null> => {
    if (!a?.call) return null
    const base = buildIconPrompt(c, styleHint)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await a.call({
          ...(selectedModel ? { model: selectedModel } : {}),
          messages: [
            { role: 'system', content: '你是资深图标设计师，只输出一段完整 SVG 源码（必须以 <svg 开头、以 </svg> 结尾），不要解释、不要 Markdown 代码块、不要任何额外文字。' },
            { role: 'user', content: attempt === 0 ? base : `${base}\n\n上次没有给出可用的 SVG。请严格只返回 SVG 源码本身。` }
          ],
          skills: { mode: 'off' }, mcp: { mode: 'off' }, toolingPolicy: { enableInternalTools: false }
        }, onIconChunk)
        if (abortedRef.current) return null
        const content = typeof res?.content === 'string' ? res.content : Array.isArray(res?.content) ? res.content.map((x: any) => x?.text ?? '').join('\n') : ''
        const svg = extractSvg(content)
        if (svg) return svg
      } catch { if (abortedRef.current) return null /* 否则重试 */ }
    }
    return null
  }

  // 回退：用图像生成模型出一张栅格图，写入 icon.png
  const generateIconViaImageModel = async (a: any, fs: any, c: VibeContract, styleHint?: string): Promise<boolean> => {
    if (!(a?.images?.generate && a?.allModels && fs?.writeFile)) return false
    try {
      const models = await a.allModels({ endpointType: 'image-generation' })
      if (!Array.isArray(models) || !models.length) return false
      const hint = (styleHint || '').trim()
      const prompt = `App icon for "${c.displayName}". Purpose: ${c.description}.${hint ? ` Style preference: ${hint}.` : ''} Flat modern minimal vector, single centered glyph that clearly reflects the function, vibrant harmonious gradient, rounded square background, no text, crisp at small sizes.`
      const r = await a.images.generate({ model: models[0].id, prompt, size: '1024x1024', count: 1 })
      const b64: string | undefined = r?.images?.[0]
      if (!b64) return false
      await fs.writeFile(`${createdPath}/icon.png`, b64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
      pushEvent('icon', 'write', '已生成 icon.png（图像模型）')
      return true
    } catch { return false }
  }

  /**
   * 生成/重新生成插件图标。
   * - force=false（自动路径）：尊重 needIcon，已生成过 AI 图标（存在 assets/icon.svg）则跳过，避免每次构建都重画。
   *   注意：不能用 icon.png 判断——脚手架模板自带默认 icon.png，否则会永远跳过、AI 图标从不生成。
   * - force=true（交付页按钮 / 对话「重做图标」）：忽略已存在的图标，按主题+功能（+风格补充）重画并覆盖。
   * - announce=true：把开始/结果回流到右侧对话，让用户在对话里看到这一步。
   */
  const generateIcon = async (opts: { force?: boolean; styleHint?: string; announce?: boolean } = {}) => {
    const { force = false, styleHint, announce = false } = opts
    if (!createdPath) { if (announce) pushToast('info', '还没有插件项目，无法生成图标'); return }
    if (!contract) { if (announce) pushToast('info', '插件设定还没就绪，无法生成图标'); return }
    const fs = fsApi()
    if (!force) {
      if (!contract.needIcon) return
      // 自动路径：以「是否已生成过 AI 图标」为准（assets/icon.svg 是 AI 生成时写下的来源标记），
      // 而非 icon.png —— 脚手架模板自带默认 icon.png，若按它判断会导致永远跳过、AI 图标从不生成。
      try {
        if (fs?.exists && await fs.exists(`${createdPath}/assets/icon.svg`)) {
          setIconDone(true); void loadIconPreview()
          pushEvent('icon', 'note', '已有 AI 生成的图标（assets/icon.svg），跳过重复生成')
          return
        }
      } catch { /* 探测失败则照常尝试生成 */ }
    }
    const a = ai()
    let produced = false
    if (announce) turnEventsRef.current = []
    // 分步计时：定位「图标生成卡在哪一步」（SVG 生成 / SVG→PNG 渲染 / 图像模型回退 / 插件重载）
    const t0 = Date.now()
    const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`
    let svgMs = 0, renderMs = 0, imgMs = 0, reloadMs = 0
    // 实时进度（A 方案）：定时刷新"已 Xs"，即便模型长时间思考也不像卡死；不改提示词/模型，保证图标质量
    const renderProgress = () => {
      const el = Math.round((Date.now() - iconStartRef.current) / 1000)
      const chars = iconCharsRef.current
      setIconProgress(
        iconPhaseRef.current === 'image' ? `正在用图像模型绘制图标… ${el}s`
          : iconPhaseRef.current === 'drawing' ? `正在绘制图标… ${el}s（已生成 ${chars} 字）`
            : `AI 正在构思图标… ${el}s`
      )
    }
    let progressTimer: ReturnType<typeof setInterval> | undefined
    try {
      setIconBusy(true)
      resetAbort()
      iconStartRef.current = Date.now(); iconCharsRef.current = 0; iconPhaseRef.current = 'thinking'
      renderProgress()
      progressTimer = setInterval(renderProgress, 500)
      pushEvent('icon', 'ai', force ? '按主题与功能重新设计图标…' : '生成图标 SVG…', (styleHint || '').slice(0, 40) || undefined)
      const tSvg = Date.now()
      const svg = await requestIconSvg(a, contract, styleHint)
      svgMs = Date.now() - tSvg
      addLog('info', `⏱ [Vibe] 图标 SVG 生成 ${secs(svgMs)}${svg ? '' : '（未拿到可用 SVG）'}`)
      if (abortedRef.current) { pushEvent('icon', 'note', '已停止图标生成'); return }
      const sharp = sharpApi()
      // 有可用 SVG 就先写下 assets/icon.svg —— 它既是图标来源，也是「已生成过 AI 图标」的判定标记。
      // 不依赖 sharp：即使后续渲染失败/走图像模型回退，标记也已写入，自动路径下次能正确跳过、不再重复生成。
      if (svg) {
        try { await fs?.mkdir?.(`${createdPath}/assets`); await fs?.writeFile?.(`${createdPath}/assets/icon.svg`, svg) } catch { /* 可选：写源失败不影响 png 产出 */ }
      }
      if (svg && typeof sharp === 'function') {
        try {
          const bytes = new TextEncoder().encode(svg)
          const tRender = Date.now()
          await sharp(bytes).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(`${createdPath}/icon.png`)
          renderMs = Date.now() - tRender
          produced = true
          pushEvent('icon', 'write', '已渲染 icon.png（SVG → 512 PNG）', secs(renderMs))
        } catch {
          pushEvent('icon', 'note', 'SVG 渲染失败，改用图像模型…')
        }
      }
      if (!produced && !abortedRef.current) {
        iconPhaseRef.current = 'image'; renderProgress()
        const tImg = Date.now()
        produced = await generateIconViaImageModel(a, fs, contract, styleHint)
        imgMs = Date.now() - tImg
        addLog('info', `⏱ [Vibe] 图像模型回退 ${secs(imgMs)}${produced ? '' : '（未产出）'}`)
      }
      if (abortedRef.current) { pushEvent('icon', 'note', '已停止图标生成'); return }

      if (produced) {
        setIconDone(true)
        void loadIconPreview()
        const tReload = Date.now()
        try { await dev.ensureLoaded(createdPath) } catch { /* 重载失败不影响图标已写入 */ }
        reloadMs = Date.now() - tReload
        await onSyncWorkbench?.()
        const totalMs = Date.now() - t0
        const breakdown = `SVG ${secs(svgMs)}${renderMs ? ` · 渲染 ${secs(renderMs)}` : ''}${imgMs ? ` · 图像回退 ${secs(imgMs)}` : ''}${reloadMs ? ` · 重载 ${secs(reloadMs)}` : ''}`
        addLog('success', `✔ [Vibe] 图标完成，总耗时 ${secs(totalMs)}（${breakdown}）`)
        pushEvent('icon', 'note', `图标耗时 ${secs(totalMs)}`, breakdown)
        if (announce && activeId) {
          appendMessage(activeId, mkMsg('assistant', `图标已重新生成 ✓（耗时 ${secs(totalMs)}：${breakdown}），并已应用到插件。不满意可以再说一句，比如「换成蓝色科技风」「再简洁一点」。`, { actions: collectTurnActions() }))
        }
        if (announce) pushToast('success', `图标已更新（${secs(totalMs)}）`)
      } else {
        pushEvent('icon', 'note', '未能生成图标（当前环境无 SVG/图像能力）')
        if (announce && activeId) {
          appendMessage(activeId, mkMsg('assistant', '这次没能生成图标 😕。可能是当前环境暂时不支持图标生成能力，或模型没返回有效图形。你可以稍后再说一次「重做图标」，或手动放一张 512×512 的 `icon.png` 到插件目录。'))
        }
        if (announce) pushToast('error', '图标没能生成，可稍后重试')
      }
    } catch (e) {
      pushEvent('icon', 'error', `图标生成失败：${e instanceof Error ? e.message : ''}`)
      if (announce && activeId) appendMessage(activeId, mkMsg('assistant', `图标生成失败了：${e instanceof Error ? e.message : '未知错误'}。要不要再试一次？`))
    } finally {
      if (progressTimer) clearInterval(progressTimer)
      setIconProgress(null)
      setIconBusy(false)
    }
  }

  // 自动路径（构建后）：尊重 needIcon、已存在则跳过
  const tryGenerateIcon = () => generateIcon({})

  // 构建后静态校验契约一致性（只读，自动跑）。返回结果同时存入状态供交付页展示。
  const runConformance = async (): Promise<ConformanceResult | null> => {
    if (!createdPath) return null
    try {
      const r = await dev.hostCall<ConformanceResult>('check_conformance', { root: createdPath })
      const result: ConformanceResult = {
        ok: !!r?.ok, ran: r?.ran !== false,
        issues: Array.isArray(r?.issues) ? r!.issues : [], summary: r?.summary
      }
      setConformance(result)
      const errs = result.issues.filter((i) => i.level === 'error')
      if (errs.length) {
        pushEvent('build', 'error', `契约校验未通过：${errs.length} 处需修复`, errs[0]?.message)
        addLog('warn', `⚠ [Vibe] 契约一致性：${errs.length} 处需修复 — ${errs.map((e) => e.message).join('；').slice(0, 200)}`)
      } else {
        pushEvent('build', 'note', '契约一致性校验通过', result.summary)
      }
      return result
    } catch { return null }
  }

  const runBuildAndLoad = async (opts?: { skipIcon?: boolean }) => {
    if (!createdPath) return
    setBuilding(true)
    setBuildLog('')
    setSmoke([])          // 代码已变，旧的运行验证结果失效
    setConformance(null)  // 重新校验
    setPendingPrompt(null) // 清除上一次的构建失败提示
    turnEventsRef.current = [] // 收集本次构建的操作明细供对话内联
    try {
      pushEvent('build', 'build', '构建 npm run build…')
      addLog('info', `▶ [Vibe] 构建：${createdPath}`)
      const r = await dev.buildPlugin(createdPath)
      setBuildLog(r.log || '')
      if (r.log) addLog(r.success ? 'success' : 'error', r.log)
      if (!r.success) {
        setBuilt(false)
        pushEvent('build', 'error', r.error || '构建失败')
        pushToast('error', r.error || '构建失败')
        const tail = (r.log || r.error || '').slice(-280)
        // 修复熔断：连续修了 3 轮还不过，继续打补丁多半无效（systematic-debugging：3 次失败 = 方案问题）
        // → 不再主推「让 AI 修复」，引导回滚到可用版本或调整需求。交付页的修复按钮仍在，专家用户可继续。
        if (repairRoundsRef.current >= 3) {
          if (activeId) appendMessage(activeId, mkMsg('assistant', `已经连续修复 ${repairRoundsRef.current} 次仍未通过构建 😟。继续打补丁多半没用，问题可能出在实现方案本身。建议：\n• 回滚到上一个可用版本（推荐——所有改动都还能在版本历史里找回）\n• 或换个说法描述需求/指出问题所在，我重新实现\n\n最新报错：\n${tail}`))
          setPendingPrompt({
            kind: 'action',
            title: '连续修复未通过',
            desc: `已尝试 ${repairRoundsRef.current} 轮修复仍失败，建议回滚到上个可用版本，或在对话里调整需求后重来。`,
            actionLabel: '回滚到 AI 改动前',
            onAction: () => { setPendingPrompt(null); repairRoundsRef.current = 0; void undoToBeforeAI() }
          })
          return
        }
        // 小白引导：用人话说明 + 一键让 AI 修复
        if (activeId) appendMessage(activeId, { id: `a-${Date.now()}`, role: 'assistant', content: `构建没通过 😕。报错大致是：\n${tail}\n\n要我自动定位并修复吗？`, timestamp: Date.now() })
        setPendingPrompt({ kind: 'action', title: '构建未通过', desc: '我可以读取报错自动修复，直到构建通过。', actionLabel: '让 AI 修复', onAction: () => { setPendingPrompt(null); void runRepair() } })
        return
      }
      setBuilt(true)
      repairRoundsRef.current = 0 // 构建通过 → 修复轮次清零
      pushEvent('build', 'build', '构建成功')
      const res = await dev.ensureLoaded(createdPath)
      setLoaded(res.success)
      setLoadedId(res.id)
      pushEvent('load', 'load', res.success ? `已载入 Mulby：${res.id || ''}` : `自动载入失败：${res.error || ''}`)
      // 构建结果回流右侧对话，让用户在对话流里就能看到反馈
      if (activeId) {
        const trig = contract ? primaryTrigger(contract) : ''
        const msg = res.success
          ? `构建成功 ✓，已载入 Mulby${res.id ? `（${res.id}）` : ''}。${trig ? `在主输入框输入「${trig}」即可打开，或点上方「打开/试用」。` : '可点上方「打开/试用」。'}`
          : `构建成功 ✓，但自动载入没成功：${res.error || '未知原因'}。可点上方「打开」重试，或继续告诉我要怎么调整。`
        appendMessage(activeId, { id: `a-${Date.now()}`, role: 'assistant', content: msg, timestamp: Date.now(), actions: collectTurnActions() })
      }
      await onSyncWorkbench?.()
      void runConformance()
      void autoCommit()
      void detectDevtools()
      // 应用契约修改 / 手动「重新构建」等场景不重生成图标，避免无谓改动/覆盖；图标只由「重做图标」按钮或对话指令触发
      if (!opts?.skipIcon) void tryGenerateIcon()
    } catch (e) {
      pushEvent('build', 'error', e instanceof Error ? e.message : '构建失败')
      pushToast('error', e instanceof Error ? e.message : '构建失败')
    } finally {
      setBuilding(false)
    }
  }

  // 生成后允许修改契约：按契约重写 manifest.json（合并磁盘既有以保留 AI 的补充），再重建+重载（重跑一致性校验）。
  // 解决「契约生成后只读 → 预检要求补 author/调整字段时无从修改」的死锁。
  const applyContractEdits = async () => {
    if (!contract || !createdPath || building) return
    const problems = validateContract(contract)
    if (problems.length) {
      pushToast('error', `契约有 ${problems.length} 处需修正：${problems[0]}${problems.length > 1 ? ' 等' : ''}`)
      addLog('warn', `⚠ [Vibe] 契约校验未通过：${problems.join('；')}`)
      return
    }
    try {
      // 复用会话写文件通道：vibe_begin(fresh:false) 仅锁定根目录并保留历史快照，便于改动入版本/可回滚
      await dev.hostCall('vibe_begin', { root: createdPath, fresh: false })
      // 生成后的项目磁盘必然已有 manifest：读不到（IPC 异常）就中止，决不能按"无 manifest"
      // 让契约全新写出——那会抹掉 base 中契约没有的字段（author/$schema 等）。
      const r = await dev.hostCall<{ exists?: boolean; content?: string }>('read_file', { path: 'manifest.json' })
      let baseManifest: any = undefined
      if (r?.content) {
        try { baseManifest = JSON.parse(r.content) } catch { /* manifest 损坏 → 按契约重写自愈 */ }
      }
      const mfText = manifestJson(contract, baseManifest)
      await dev.hostCall('write_file', { path: 'manifest.json', content: mfText })
      pushEvent('manifest', 'write', '已按契约更新 manifest.json')
      addLog('success', '✔ [Vibe] 已按契约更新 manifest.json，开始重建')
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '写入 manifest 失败')
      return
    } finally {
      void dev.hostCall('vibe_end').catch(() => {})
    }
    pendingCommitMsgRef.current = '应用契约修改并重建'
    await runBuildAndLoad({ skipIcon: true })
  }

  useEffect(() => {
    if (stage === 3 && createdPath && !deliverStartedRef.current && !building) {
      deliverStartedRef.current = true
      void runBuildAndLoad()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, createdPath])

  // 读取本次会话改动（用于交付页 diff 展示与回滚）。返回最新列表，便于撤销前即时取用（setChanges 异步，闭包内读不到新值）。
  const loadChanges = async (): Promise<VibeChange[]> => {
    if (!createdPath) { setChanges([]); return [] }
    try {
      const r = await dev.hostCall<{ changes?: VibeChange[] }>('vibe_changes', { root: createdPath })
      const list = Array.isArray(r?.changes) ? r!.changes : []
      setChanges(list)
      return list
    } catch { /* 忽略：改动卡片只是辅助 */ return [] }
  }

  // 进入交付页或生成/扩展/修复后刷新改动列表与版本历史 + 图标预览
  useEffect(() => {
    if (stage === 3 && createdPath) { void loadChanges(); void loadVersions(); void loadIconPreview() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, createdPath, generated, expanded, built])

  // 读取版本历史
  const loadVersions = async () => {
    if (!createdPath) { setVersions([]); return }
    try {
      const r = await dev.hostCall<{ available?: boolean; commits?: VcsCommit[] }>('vcs_log', { root: createdPath, limit: 50 })
      setVcsAvailable(r?.available !== false)
      setVersions(Array.isArray(r?.commits) ? r!.commits : [])
    } catch { /* 忽略：版本面板只是辅助 */ }
  }

  // 构建成功后自动提交一个版本（消息由各阶段事先写入 pendingCommitMsgRef）
  const autoCommit = async () => {
    const msg = pendingCommitMsgRef.current
    if (!msg || !createdPath) return
    pendingCommitMsgRef.current = ''
    try {
      const r = await dev.hostCall<{ ok?: boolean; available?: boolean; hash?: string; version?: string; nochange?: boolean }>(
        'vcs_commit', { root: createdPath, message: msg }
      )
      if (r?.available === false) { setVcsAvailable(false); return }
      if (r?.ok && !r.nochange) {
        pushEvent('build', 'note', '已记录版本', `${r.hash || ''}${r.version ? ' · v' + r.version : ''}`)
        addLog('success', `✔ [Vibe] 版本已提交：${msg}（${r.hash || ''}）`)
      }
      await loadVersions()
    } catch { /* 忽略 */ }
  }

  // 读取某版本的改动 patch（供历史面板展开查看）
  const loadVersionDiff = async (hash: string): Promise<string> => {
    if (!createdPath) return ''
    try {
      const r = await dev.hostCall<{ available?: boolean; patch?: string }>('vcs_diff', { root: createdPath, hash })
      if (r?.available === false) return '（git 不可用）'
      return r?.patch || '（该版本无可显示的改动）'
    } catch { return '读取失败' }
  }

  // 回滚到某个历史版本：还原文件 → 重新构建载入 → 记录一条「回滚」版本
  const doRestoreVersion = async (hash: string) => {
    // 与 undoToBeforeAI 一致：AI 生成/构建进行中禁止回滚，避免与在途写入/构建撕扯
    if (!createdPath || restoringHash || aiActive || busy) return
    setRestoringHash(hash)
    try {
      const r = await dev.hostCall<{ ok?: boolean; available?: boolean; reason?: string }>('vcs_restore', { root: createdPath, hash })
      if (r?.available === false) { pushToast('error', 'git 不可用，无法回滚'); return }
      if (!r?.ok) { pushToast('error', r?.reason || '回滚失败'); return }
      pushEvent('repair', 'note', `已回滚到版本 ${hash.slice(0, 7)}`)
      addLog('info', `↩ [Vibe] 回滚到版本 ${hash.slice(0, 7)}，正在重新构建载入`)
      pushToast('success', `已回滚到 ${hash.slice(0, 7)}，正在重新构建`)
      pendingCommitMsgRef.current = `回滚到版本 ${hash.slice(0, 7)}`
      // 恢复历史版本：只重建载入，不重生图标（图标随被恢复的文件一起还原）
      await runBuildAndLoad({ skipIcon: true })
      await loadChanges()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '回滚失败')
    } finally {
      setRestoringHash(null)
    }
  }

  // 一键撤销到「本次 AI 改动之前」：取最近一个影子快照还原点（"AI 改动前"/"新会话基线"）并回滚重建。
  // 影子库回滚前会自动快照当前态，故本操作可逆——丢弃的改动仍能在版本列表里找回。
  const undoToBeforeAI = async () => {
    if (!createdPath || aiActive || busy || restoringHash) return
    try {
      const log = await dev.hostCall<{ available?: boolean; commits?: VcsCommit[] }>('vcs_log', { root: createdPath, limit: 50 })
      if (log?.available === false) { pushToast('error', 'git 不可用，无法撤销'); return }
      const target = (log?.commits || []).find((c) => /AI 改动前|新会话基线/.test(c.message || ''))
      if (!target) { pushToast('info', '暂无「AI 改动前」还原点可撤销'); return }
      setRestoringHash(target.hash)
      const r = await dev.hostCall<{ ok?: boolean; available?: boolean; reason?: string; removed?: number }>('vcs_restore', { root: createdPath, hash: target.hash })
      if (!r?.ok) { pushToast('error', r?.reason || '撤销失败'); return }
      const removedTip = r.removed ? `，清理 ${r.removed} 个新增文件` : ''
      pushEvent('repair', 'note', `已撤销到「${target.message}」(${target.short})`)
      addLog('info', `↩ [Vibe] 撤销到 ${target.short}「${target.message}」，正在重新构建载入`)
      recordMessage(mkMsg('assistant', `已撤销到「${target.message}」(${target.short})${removedTip}。本次 AI 改动已丢弃；如需找回，可在交付页版本列表恢复「自动保存：回滚前的当前状态」。`))
      pushToast('success', '已撤销到 AI 改动前，正在重新构建')
      pendingCommitMsgRef.current = '撤销到 AI 改动前'
      // 撤销恢复状态：只重建载入，不重生图标（否则撤销后又冒出一个新图标）
      await runBuildAndLoad({ skipIcon: true })
      await loadVersions()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '撤销失败')
    } finally {
      setRestoringHash(null)
    }
  }

  // 「撤销 AI 改动」入口：先即时拉取本次改动文件，弹出列出待撤销文件的二次确认卡，确认后才真正撤销，防误操作。
  const requestUndoToBeforeAI = async () => {
    if (!createdPath || aiActive || busy || restoringHash) return
    const list = await loadChanges()
    setPendingPrompt({
      kind: 'confirm',
      title: '撤销本次 AI 改动？',
      desc: list.length
        ? `将丢弃以下 ${list.length} 个文件的本次改动，回到 AI 改动前的状态。此操作可逆——丢弃的改动仍可在交付页「版本」列表恢复。`
        : '将回到本次 AI 改动之前的状态。此操作可逆——可在交付页「版本」列表恢复。',
      files: list,
      actionLabel: '确认撤销',
      danger: true,
      onAction: () => { setPendingPrompt(null); void undoToBeforeAI() }
    })
  }

  // 一键回滚本次会话的全部改动，并重新构建载入使运行态与磁盘一致
  const doRollback = async () => {
    if (!createdPath || rollingBack) return
    setRollingBack(true)
    try {
      const r = await dev.hostCall<{ ok?: boolean; restored?: number; removed?: number; errors?: string[] }>('vibe_rollback', { root: createdPath })
      const restored = r?.restored || 0
      const removed = r?.removed || 0
      pushEvent('repair', 'note', '已回滚本次改动', `还原 ${restored} · 删除 ${removed}`)
      addLog('info', `↩ [Vibe] 回滚改动：还原 ${restored} 个文件、删除 ${removed} 个新增文件`)
      pushToast(r?.ok ? 'success' : 'error', r?.ok ? `已回滚（还原 ${restored}，删除 ${removed}）` : `回滚部分失败：${(r?.errors || []).join('；').slice(0, 120)}`)
      await loadChanges()
      // 回滚恢复状态：只重建载入，不重生图标
      await runBuildAndLoad({ skipIcon: true })
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '回滚失败')
    } finally {
      setRollingBack(false)
    }
  }

  // 右侧对话式继续修改：用户输入新反馈（如运行时 bug），AI 在现有代码上做最小迭代
  const followupSystemPrompt = (c: VibeContract, root: string) => [
    '你是资深 Mulby 插件工程师，正在根据用户的后续反馈，对一个**已存在且可正常构建**的插件做迭代修改。务必最小化改动，不要破坏现有功能。',
    `插件根目录：${root}`,
    '【重要·上下文】上面的 messages 里包含你与用户的完整历史对话（含此前的问答、你给出的方案、以及已经做过的修改）。当用户说「按上面的方案改 / 按你说的做 / 刚才提到的」等指代时，必须回到对话历史里找到对应内容并据此执行，不要忽略或另起炉灶。',
    '工作方式：先 grep/list_dir/read_file 定位并通读相关文件（manifest.json、src/main.ts、涉及的 src/ui/*）；优先用 edit_file 做最小增量改动；用到 window.mulby.* 前先用 mulby_read_file 查阅 API 文档确认；改完用 build_check 自检并据报错修复；停止前调用 check_conformance 确认 manifest 与代码一致（按 error 修复）。完成后用一两句说明改动并停止。',
    '约束：保持 id/name 不变；保持构建脚本与依赖清单不变；前端只用已存在的 window.mulby.* 能力（用 mulby_read_file 查阅技能文档核实，不要臆造）；保持 TypeScript 可编译；不要动 node_modules/dist；manifest.json 一般无需改动。',
    'esbuild 打包注意：不要新增无法被打包的原生依赖；图像处理用 window.mulby.sharp 等宿主能力。',
    `契约：${contractSummary(c)}`,
    `功能与触发：${c.features.map((f) => `${f.code}(${f.mode}) ← ${f.triggers.map(triggerLabel).join('、') || '无触发'}`).join('；')}`
  ].join('\n')

  const followupUserPrompt = (instruction: string) => [
    `用户的新反馈 / 修改需求：\n${instruction}`,
    '请结合上面的历史对话理解意图（尤其是此前确认的方案/讨论），先读懂当前代码与问题所在，做必要修改；完成后用一两句说明改动并停止。'
  ].join('\n')

  const runFollowup = async (instruction: string) => {
    const text = instruction.trim()
    if (!contract || !createdPath || !text || iterating) return
    repairRoundsRef.current = 0 // 用户提出新改动 = 新上下文：修复轮次清零
    setIterating(true)
    setExpanding(true) // 复用：让阶段2的「停止」按钮可用
    setStage(2)
    turnEventsRef.current = []
    setNarration('') // 清空上一轮，供右侧对话流式展示本轮回复
    try {
      pushEvent('repair', 'ai', '按你的反馈继续修改…', text.slice(0, 60))
      addLog('info', `▶ [Vibe] 继续修改：${text}`)
      let sys = followupSystemPrompt(contract, createdPath)
      sys = await injectCgContext(createdPath, text, 'repair', sys)
      sys = withApiSurface(sys)
      // 注入历史对话上下文：排除本轮刚追加的用户输入，避免与最终 user 消息重复
      const final = await runAgent(sys, followupUserPrompt(text), createdPath, 'repair', buildHistoryMessages(text))
      if (abortedRef.current) { pushEvent('repair', 'note', '已中止'); return }
      const summary = typeof final?.content === 'string' ? final.content : ''
      if (summary) setNarration(summary)
      // 持久化 AI 回复到会话对话历史（含本回合操作明细；用户消息由 handleChatSend 写入）
      if (activeId) appendMessage(activeId, { id: `a-${Date.now()}`, role: 'assistant', content: summary || '已按你的反馈完成修改。', timestamp: Date.now(), actions: collectTurnActions() })
      pendingCommitMsgRef.current = `迭代：${text.slice(0, 120)}`
      deliverStartedRef.current = false
      setStage(3)
      addLog('success', '✔ [Vibe] 已按反馈修改，准备重新构建载入')
    } catch (e) {
      if (!abortedRef.current) {
        const msg = e instanceof Error ? e.message : '修改失败'
        pushEvent('repair', 'error', msg); pushToast('error', msg)
        addLog('error', `✘ [Vibe] 修改失败：${msg}`)
        // 迭代指令（含运行时错误回流/审查意见回流自动构造的长指令）不让用户重新输入——重试卡原样重跑
        if (activeId) appendMessage(activeId, mkMsg('assistant', `这次修改中断了：${msg}\n\n点下方「重试修改」我会按原指令重新来过（多为 AI 服务临时不可用）。`, { actions: collectTurnActions() }))
        setPendingPrompt({
          kind: 'action',
          title: '修改失败',
          desc: `${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''}（指令：${text.slice(0, 60)}${text.length > 60 ? '…' : ''}）`,
          actionLabel: '重试修改',
          onAction: () => { setPendingPrompt(null); void runFollowup(text) }
        })
      }
    } finally {
      setIterating(false)
      setExpanding(false)
      void dev.hostCall('vibe_end').catch(() => {})
    }
  }

  // ---------------- 只读问答（S1）：回答关于插件的问题，绝不改代码/构建 ----------------
  const askSystemPrompt = (c: VibeContract | null, root: string) => [
    '你是 Mulby 插件开发助手，正在回答用户关于一个插件项目的问题。',
    root ? `插件根目录：${root}` : '当前还没有具体的插件项目。',
    '你可以使用 list_dir / read_file / grep 这三个只读工具查看代码来回答问题。',
    '上面的 messages 包含你与用户的历史对话，请把它当作上下文：用户可能在追问、或让你「出个方案 / 给个思路」，请连贯作答；若你给出的是「修改方案」，请尽量结构化、可执行，方便用户随后说「按这个方案改」时直接落地。',
    '【铁律】这是「只读问答」：严禁修改、写入、删除任何文件，严禁构建或运行插件。只查看并回答（可以给出详细方案/步骤，但不要实际改动）。',
    '请用简洁中文回答。若你判断用户其实是想让你改代码，请提示他用「帮我改…」「修复…」这类说法来触发修改，而不要直接动手。',
    c ? `当前插件契约：${contractSummary(c)}` : ''
  ].filter(Boolean).join('\n')

  const runAsk = async (question: string) => {
    const a = ai()
    if (!a?.call) { pushToast('error', '当前环境未启用 AI API，无法回答'); return }
    const root = createdPath || (vibeMode === 'edit' ? editPath : '')
    setIterating(true) // 复用底部「停止」与 busy 指示
    turnEventsRef.current = []
    try {
      pushEvent('debug', 'ai', '只读问答…', question.slice(0, 60))
      addLog('info', `💬 [Vibe] 回答提问：${question.slice(0, 50)}`)
      if (root) { try { await dev.hostCall('vibe_begin', { root }) } catch { /* 无 root 也可纯文本回答 */ } }
      abortedRef.current = false
      reqIdRef.current = null
      setNarration('')
      currentPhaseRef.current = 'debug'
      const sys = withAnchorContext(withApiSurface(askSystemPrompt(contract, root)))
      const final = await a.call(
        {
          ...(selectedModel ? { model: selectedModel } : {}),
          messages: [{ role: 'system', content: sys }, ...buildHistoryMessages(question), { role: 'user', content: question }],
          tools: VIBE_READ_TOOLS,
          maxToolSteps: 60,
          capabilities: ['fs.read'],
          // 跨轮上下文自管，关掉宿主默认的 8 条消息截断（否则问答看不到完整方案）
          params: { contextWindow: 0 },
          mcp: { mode: 'off' }, skills: skillSelection(), toolingPolicy: { enableInternalTools: false }
        },
        onAgentChunk
      )
      if (abortedRef.current) { pushEvent('debug', 'note', '已中止'); return }
      const answer = typeof final?.content === 'string'
        ? final.content
        : (Array.isArray(final?.content) ? final.content.map((x: any) => x?.text ?? '').join('\n') : '')
      const text = (answer || '').trim() || '（未能给出回答，请换种问法再试）'
      if (activeId) appendMessage(activeId, { id: `a-${Date.now()}`, role: 'assistant', content: text, timestamp: Date.now(), actions: collectTurnActions() })
      pushEvent('debug', 'note', '已回答')
    } catch (e) {
      if (!abortedRef.current) pushToast('error', e instanceof Error ? e.message : '回答失败')
    } finally {
      setIterating(false)
      if (root) void dev.hostCall('vibe_end').catch(() => {})
    }
  }

  const runRepair = async () => {
    if (!contract || !createdPath) return
    repairRoundsRef.current += 1
    const attempt = repairRoundsRef.current
    setRepairing(true)
    try {
      pushEvent('repair', 'ai', attempt > 1 ? `AI 读取报错并修复…（第 ${attempt} 轮）` : 'AI 读取报错并修复…')
      addLog('info', `▶ [Vibe] AI 修复构建错误…${attempt > 1 ? `（第 ${attempt} 轮）` : ''}`)
      let sys = contract.isEdit ? editSystemPrompt(contract, createdPath, 'minimal') : createSystemPrompt(contract, createdPath, 'minimal')
      // 修复阶段：注入知识图谱上下文，帮助 AI 更快定位报错相关代码
      sys = await injectCgContext(createdPath, contract.editSummary || sentence, 'repair', sys)
      sys = withApiSurface(sys)
      await runAgent(sys, repairUserPrompt(buildLog, attempt), createdPath, 'repair', buildHistoryMessages())
      if (abortedRef.current) return
      pendingCommitMsgRef.current = '修复构建错误'
      await runBuildAndLoad()
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '修复失败')
    } finally {
      setRepairing(false)
      void dev.hostCall('vibe_end').catch(() => {})
    }
  }

  // 让 AI 修复「契约一致性校验」报出的 error 级问题（优先改代码去满足 manifest），完成后重新构建载入
  const conformancePrompt = (issues: ConformanceIssue[]) => [
    '刚生成/修改的插件未通过「契约一致性校验」。请逐条修复下列问题，使 manifest.json 与真实文件/代码保持一致：',
    ...issues.filter((i) => i.level === 'error').map((i, idx) => `${idx + 1}. [${i.code}] ${i.message}${i.hint ? `（建议：${i.hint}）` : ''}`),
    '原则：manifest 是用户确认的契约，能不改就不改——优先让代码去满足 manifest（补齐缺失的 ui 入口与界面源码、未实现的功能分支、未注册的工具等）。',
    '修复后用 build_check 自检，再用 check_conformance 确认 ok:true，然后用一句话说明并停止。'
  ].join('\n')

  const repairConformance = async () => {
    const errs = (conformance?.issues || []).filter((i) => i.level === 'error')
    if (!contract || !createdPath || confRepairing || !errs.length) return
    setConfRepairing(true)
    try {
      pushEvent('repair', 'ai', 'AI 修复契约一致性问题…', `${errs.length} 处`)
      addLog('info', `▶ [Vibe] AI 修复契约一致性问题（${errs.length} 处）`)
      let sys = contract.isEdit ? editSystemPrompt(contract, createdPath, 'minimal') : createSystemPrompt(contract, createdPath, 'minimal')
      sys = withApiSurface(sys)
      await runAgent(sys, conformancePrompt(conformance!.issues), createdPath, 'repair', buildHistoryMessages())
      if (abortedRef.current) return
      pendingCommitMsgRef.current = '修复契约一致性'
      await runBuildAndLoad()
    } catch (e) {
      if (!abortedRef.current) pushToast('error', e instanceof Error ? e.message : '修复失败')
    } finally {
      setConfRepairing(false)
      void dev.hostCall('vibe_end').catch(() => {})
    }
  }

  // ---------------- 运行时错误回流（编译 → 装载 → 运行 三层自修复的最后一层） ----------------
  // 宿主 console-capture 会把插件渲染进程的全部 console 输出（含未捕获异常）捕获进日志服务，
  // 后端 host 进程的 stderr 同理。这里在「打开插件 / 运行验证」之后按 pluginId 拉取新增的 error
  // 日志，在对话里提示并提供一键 AI 修复——用户不再需要自己开 DevTools 看报错再口头转述。
  const runtimeCheckBaselineRef = useRef(0) // 只关心这个时刻之后新产生的错误
  const markRuntimeBaseline = () => { runtimeCheckBaselineRef.current = Date.now() }
  // 运行期忙碌跟踪（ref 形式供 setTimeout 回调读取最新值，避免闭包陈旧）
  const engagedRef = useRef(false)

  const fetchRuntimeErrors = async (): Promise<Array<{ timestamp: number; message: string }>> => {
    const log = logApi()
    const pid = loadedId || contract?.pluginId || contract?.name
    if (!log?.getLogs || !pid) return []
    try {
      const list = await log.getLogs({ pluginId: pid, level: 'error', limit: 50 })
      const since = runtimeCheckBaselineRef.current
      return (Array.isArray(list) ? list : [])
        .filter((e: any) => typeof e?.timestamp === 'number' && e.timestamp >= since && typeof e?.message === 'string' && e.message.trim())
        .map((e: any) => ({ timestamp: e.timestamp, message: String(e.message).slice(0, 400) }))
    } catch { return [] }
  }

  /** 错误消息去重（循环报错会刷出大量同文案日志），保留出现顺序 */
  const uniqMessages = (errs: Array<{ message: string }>, max: number): string[] => {
    const out: string[] = []
    for (const e of errs) {
      if (!out.includes(e.message)) out.push(e.message)
      if (out.length >= max) break
    }
    return out
  }

  const runtimeRepairInstruction = (errs: Array<{ message: string }>): string => [
    '插件能构建载入，但运行时控制台出现报错。请阅读相关源码，定位并修复下列运行时错误（注意空值防护、window.mulby API 误用、未捕获异常等），最小化改动、不要顺手重构：',
    ...uniqMessages(errs, 10).map((m) => `- ${m}`)
  ].join('\n')

  /**
   * 运行动作（打开插件 / 运行验证）后延迟检查运行时错误：给插件初始化与渲染留出时间。
   * 发现新错误 → 事件/日志记录 + 对话提示卡（一键让 AI 修复）。检查前提示过的错误不再重复弹。
   */
  const scheduleRuntimeErrorCheck = (delayMs = 3500) => {
    const sid = activeId
    setTimeout(() => {
      void (async () => {
        // 会话已切换 / 项目已不在 → 放弃；AI 或构建忙 → 跳过本次（不打断在途任务）
        if (!sid || liveSessionIdRef.current !== sid || !createdPath) return
        if (engagedRef.current) return
        const errs = await fetchRuntimeErrors()
        if (!errs.length) return
        markRuntimeBaseline() // 同一批错误只提示一次
        const heads = uniqMessages(errs, 5)
        const summary = heads.map((m) => `• ${m.length > 160 ? `${m.slice(0, 160)}…` : m}`).join('\n')
        pushEvent('debug', 'error', `检测到 ${errs.length} 条运行时报错`, heads[0]?.slice(0, 80))
        addLog('warn', `⚠ [Vibe] 运行时报错 ${errs.length} 条：${heads[0]?.slice(0, 120) || ''}`)
        appendMessage(sid, mkMsg('assistant', `插件跑起来了，但控制台有 ${errs.length} 条报错 😕：\n${summary}\n\n要我读取日志定位并自动修复吗？`))
        setPendingPrompt({
          kind: 'action',
          title: '检测到运行时报错',
          desc: `共 ${errs.length} 条 error 日志。我会结合源码定位修复，完成后自动重新构建载入。`,
          actionLabel: '让 AI 修复',
          onAction: () => {
            setPendingPrompt(null)
            recordMessage(mkMsg('user', '修复运行时报错', { intent: 'modify' }))
            void runFollowup(runtimeRepairInstruction(errs))
          }
        })
      })()
    }, delayMs)
  }

  // 为某功能挑选一个可用于「运行验证」的示例输入
  const pickSmokeInput = (f: VibeContract['features'][number]): { input: string; skip?: string } => {
    const ts = f.triggers || []
    const sampled = ts.find((t) => (t.type === 'regex' || t.type === 'over') && t.sample?.trim())
    if (sampled?.sample) return { input: sampled.sample.trim() }
    if (f.mode === 'ui' || f.mode === 'detached') return { input: '' } // 打开窗口即视为通过
    const kw = ts.find((t) => t.type === 'keyword' && t.value?.trim())
    if (kw) return { input: '' }
    if (ts.some((t) => t.type === 'regex' || t.type === 'over')) {
      return { input: '', skip: '该功能需特定格式输入，契约未提供 sample，跳过自动验证' }
    }
    return { input: '' }
  }

  // 运行验证（smoke）：用示例输入真实调用 plugin.run 跑一遍每个功能，验证「真的能执行」而不只是「能编译」。
  // 有副作用（可能写剪贴板/弹通知/开窗口），所以由用户手动触发。
  const runFeatureSmoke = async () => {
    if (!contract || smoking) return
    const p = pluginApi()
    const pid = loadedId || contract.pluginId || contract.name
    if (!p?.run || !pid) { pushToast('info', '当前环境无法自动运行验证，请用触发词手动打开'); return }
    setSmoking(true)
    markRuntimeBaseline() // 只关心本轮验证产生的运行时错误
    try {
      const results: SmokeResult[] = []
      for (const f of contract.features) {
        const label = f.explain || f.code
        const { input, skip } = pickSmokeInput(f)
        if (skip) { results.push({ code: f.code, label, input, status: 'skipped', note: skip }); continue }
        pushEvent('debug', 'load', `运行验证 ${f.code}${input ? `（输入：${input.slice(0, 24)}）` : ''}…`)
        try {
          const r = await p.run(pid, f.code, input)
          results.push({ code: f.code, label, input, status: r?.success ? 'pass' : 'fail', hasUI: r?.hasUI, error: r?.error })
          pushEvent('debug', r?.success ? 'note' : 'error', r?.success ? `运行通过 ${f.code}` : `运行失败 ${f.code}`, r?.error)
        } catch (e) {
          results.push({ code: f.code, label, input, status: 'fail', error: e instanceof Error ? e.message : '运行异常' })
          pushEvent('debug', 'error', `运行异常 ${f.code}`, e instanceof Error ? e.message : undefined)
        }
      }
      setSmoke(results)
      const passed = results.filter((r) => r.status === 'pass').length
      const failed = results.filter((r) => r.status === 'fail').length
      setCoreVerified(passed > 0 && failed === 0)
      if (failed) { pushToast('error', `运行验证：${passed} 通过 / ${failed} 失败`); addLog('warn', `⚠ [Vibe] 运行验证：${failed} 个功能执行失败`) }
      else { pushToast('success', `运行验证：${passed} 个功能均已执行`); addLog('success', `✔ [Vibe] 运行验证：${passed} 个功能均已执行`) }
      // run 返回 success 不代表运行干净：UI 渲染/异步逻辑的报错只会出现在控制台日志里，稍后回查
      scheduleRuntimeErrorCheck(1500)
    } finally {
      setSmoking(false)
    }
  }

  const doPack = async () => {
    if (!createdPath) return
    setPacking(true)
    try {
      // 发布前：自增版本号并记录版本（git 不可用则静默跳过）
      try {
        const v = await dev.hostCall<{ ok?: boolean; available?: boolean; version?: string }>(
          'vcs_commit', { root: createdPath, bump: 'patch', tag: true, message: '打包发布' }
        )
        if (v?.available === false) setVcsAvailable(false)
        else if (v?.ok && v.version) {
          // 关键：契约状态同步磁盘新版本。否则之后「应用契约修改并重建」会用旧 version 把磁盘版本打回去
          const bumped = v.version
          setContract((c) => (c ? { ...c, version: bumped } : c))
          addLog('info', `▶ [Vibe] 版本升级为 v${bumped}`)
          pushEvent('pack', 'note', `版本升级 v${bumped}`)
          await loadVersions()
        }
      } catch { /* git 不可用则跳过升版 */ }
      pushEvent('pack', 'note', '打包 .inplugin…')
      const r = await dev.packPlugin(createdPath)
      if (r.log) addLog(r.success ? 'success' : 'error', r.log)
      if (r.success) { setPacked(true); pushEvent('pack', 'note', `已打包${r.outFile ? `：${r.outFile}` : ''}`); pushToast('success', '已打包') }
      else { pushEvent('pack', 'error', r.error || '打包失败'); pushToast('error', r.error || '打包失败') }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '打包失败')
    } finally {
      setPacking(false)
    }
  }

  // 调试回路
  const detectDevtools = async () => {
    const s = settingsApi()
    if (!s?.get) { setDevtoolsOn(null); return }
    try {
      const cfg = await s.get()
      const dev2 = (cfg?.developer || cfg?.settings?.developer) as any
      setDevtoolsOn(!!(dev2?.enabled && dev2?.showDevTools))
    } catch { setDevtoolsOn(null) }
  }

  const enableDevtools = async () => {
    const s = settingsApi()
    if (!s?.get || !s?.update) { pushToast('info', '请在 Mulby 设置→开发者中开启「自动打开 DevTools」'); return }
    setDevtoolsBusy(true)
    try {
      const cfg = await s.get()
      const cur = (cfg?.developer || {}) as any
      await s.update({ developer: { ...cur, enabled: true, showDevTools: true } })
      await detectDevtools()
      pushEvent('debug', 'note', '已开启 DevTools 自动打开')
      pushToast('success', 'DevTools 已开启，重新打开插件即可看到控制台')
    } catch (e) {
      pushToast('info', `无法自动开启，请在 Mulby 设置→开发者手动开启：${e instanceof Error ? e.message : ''}`)
    } finally {
      setDevtoolsBusy(false)
    }
  }

  const openPlugin = async () => {
    const p = pluginApi()
    const pid = loadedId || contract?.pluginId || contract?.name
    const code = contract ? primaryFeatureCode(contract) : 'main'
    if (!p?.run || !pid) { pushToast('info', '请在 Mulby 主输入框用触发词打开'); return }
    try {
      pushEvent('debug', 'note', `打开插件 ${pid} · ${code}`)
      markRuntimeBaseline() // 只关心本次打开之后产生的运行时错误
      const r = await p.run(pid, code, '')
      if (r?.success) {
        setOpened(true)
        pushToast('success', '已打开插件窗口')
        scheduleRuntimeErrorCheck() // 稍后回查运行时报错，有则提示一键 AI 修复
      } else {
        pushToast('error', r?.error || '打开失败，可用触发词手动打开')
      }
    } catch (e) {
      pushToast('error', e instanceof Error ? e.message : '打开失败')
    }
  }

  const tryIt = async () => {
    const kw = contract ? primaryTrigger(contract) : ''
    try { await clip()?.writeText?.(kw) } catch { /* ignore */ }
    pushToast('info', `触发词「${kw}」已复制，可在 Mulby 主输入框粘贴打开`)
  }

  function resetState() {
    setStage(0); setMaxStage(0); setContract(null); setEvents([]); setToolCalls(0); setNarration(''); setDrawerOpen(false)
    setGenerated(false); setExpanded(false); setExpanding(false)
    setCreatedPath(''); setBuilt(false); setBuildLog(''); setLoaded(false); setLoadedId(undefined)
    setIconDone(false); setIconDataUrl(null); setPacked(false); setDevtoolsOn(null); setOpened(false)
    setGenerating(false); setBuilding(false); setRepairing(false); setReviewing(false); repairRoundsRef.current = 0
    setChanges([]); setRollingBack(false); setCoreVerified(false)
    setConformance(null); setConfRepairing(false); setSmoke([]); setSmoking(false)
    setIterating(false)
    setVersions([]); setRestoringHash(null); setVcsAvailable(true)
    setBrainstorm(null)
    setClarify(null)
    setPlan([]); setPlanPhase('idle'); planPreparedRef.current = false
    setPendingPrompt(null)
    pendingCommitMsgRef.current = ''
    deliverStartedRef.current = false
  }
  const resetAll = () => { resetState(); setVibeMode('create'); setEditPath(''); setSentence('') }
  // 新建项目：清空面板 + 脱离当前会话（下次规划会创建全新会话，不污染当前项目）
  const startNewProject = () => { resetAll(); liveSessionIdRef.current = null; deselect() }

  // 同一项目下新建一段对话线程：继承当前项目（路径/契约/状态/模型），仅清空对话历史。
  // 因 pluginPath 不变，水合不会改变 stage/createdPath，不会触发重新构建，体验为「对话清空、项目照旧」。
  const newConversation = () => {
    if (generating || building || planning || iterating || repairing || confRepairing) { pushToast('info', '请等当前任务完成，再新建会话'); return }
    const base = activeSession
    if (!base) { startNewProject(); return }
    liveSessionIdRef.current = null // 让水合 effect 接管新会话状态恢复
    createSession({
      pluginPath: base.pluginPath,
      pluginName: base.pluginName,
      vibeMode: base.vibeMode,
      state: base.state,
      contract: base.contract ? JSON.parse(JSON.stringify(base.contract)) : null,
      sentence: base.sentence,
      genDepth: base.genDepth,
      selectedModel: base.selectedModel
    }, { allowDuplicatePath: true })
    pushToast('info', '已在当前项目下新建一段对话')
  }

  const busy = planning || generating || expanding || building || repairing || reviewing || iconBusy || confRepairing || smoking
  // 正在进行、可被「停止」中断的 AI 生成类任务（不含纯本地的 building / smoking）
  const aiActive = planning || generating || expanding || repairing || reviewing || iterating || iconBusy || confRepairing || !!brainstorm?.loading || !!clarify?.loading
  // 供运行时错误检查的 setTimeout 回调读取「当下」是否忙碌（闭包里的 busy/aiActive 是调度时的旧值）
  useEffect(() => { engagedRef.current = aiActive || busy || routing }, [aiActive, busy, routing])
  // P1-3：对话变长且 AI 空闲时，后台把更早消息压成滚动摘要（fire-and-forget，失败不影响主流程）
  useEffect(() => {
    if (aiActive) return
    void maybeSummarizeHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.messages?.length, aiActive])
  const chatReady = !!createdPath && generated
  // 设定卡：契约已生成、等待用户确认开始生成代码（对话内联确认入口）
  // 契约确认卡仅在「尚未进入计划流程」时出现；一旦开始制定/执行计划，改由计划卡接管
  const contractPending = (stage === 1 && contract && !generating && !generated && planPhase === 'idle')
    ? { name: contract.displayName || contract.name, summary: contractSummary(contract) }
    : null
  // 插件状态（S4）：对话栏顶部常驻的"它在运行/一键试用"状态条
  const pluginStatus = (createdPath && (generated || built))
    ? { name: contract?.displayName || contract?.name || createdPath.split('/').pop() || '插件', loaded, trigger: contract ? primaryTrigger(contract) : '', icon: iconDataUrl }
    : null

  // 把输入作为「需求」推进（未就绪时）：有目标→规划；否则填入描述并提示
  const seedAsRequirement = (t: string) => {
    const hasTarget = vibeMode === 'edit' ? !!editPath.trim() : !!targetDir.trim()
    if (hasTarget) { void doPlan(t) }
    else { setSentence(t); pushToast('info', vibeMode === 'edit' ? '请先在左侧选择要改造的插件' : '请先选择插件生成的目标目录') }
  }

  // 携带指令的自动回流（审查意见等）：会话水合完成且空闲时，把指令作为用户消息发给迭代通道
  useEffect(() => {
    const p = pendingInstruction
    if (!p) return
    if (busy || aiActive || routing) return
    // 已交付的会话：直接走 runFollowup（与运行时错误回流同通道）
    if (chatReady && createdPath === p.path && contract) {
      setPendingInstruction(null)
      recordMessage(mkMsg('user', p.text, { intent: 'modify' }))
      void runFollowup(p.text)
      return
    }
    // 该插件从未进过 Vibe（新建 edit 会话、尚无契约）：作为需求种子走「理解现状→规划→修改」流程
    if (!chatReady && !createdPath && vibeMode === 'edit' && editPath === p.path) {
      setPendingInstruction(null)
      recordMessage(mkMsg('user', p.text, { intent: 'modify' }))
      seedAsRequirement(p.text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInstruction, busy, aiActive, routing, chatReady, createdPath, contract, vibeMode, editPath])

  // ---------------- 头脑风暴（S3，仅模糊念头） ----------------
  const STRICT_JSON_SYS = '你是严格的 JSON 生成器，只输出一个可解析的 JSON 对象，不要任何解释、前后缀或 Markdown 代码块。'

  const brainstormPrompt = (seed: string) => [
    '你是 Mulby 插件创意助手。用户目前只有一个初步念头，请帮他把这个念头具体化成 3-4 个可落地的 Mulby 桌面插件方向。',
    '铁律：所有方向都必须围绕用户念头里的主题/领域展开，是它的具体化、延伸或不同切入点——绝不能丢开原主题另起炉灶；用户已提到的关键约束必须保留。',
    '只输出 JSON：{ "options": [ { "title": "简短中文方向名", "pitch": "一句话说明能做什么/卖点", "trigger": "触发方式（如：关键词唤起 / 处理选中文本 / 拖入图片 / 正则匹配金额）" } ] }。',
    '要求：方向之间的差异体现在切入点/交互/深度上，而非更换主题；具体、对新手友好、可被一个小插件实现。',
    '每个方向都要能用 Mulby 常见桌面能力（剪贴板 / 通知 / 文件读写 / 调用 AI / 图像处理 / 窗口 / 网络请求等）实现，不要臆造平台做不到的功能。',
    `用户的初步念头：${seed}`
  ].join('\n')

  const normalizeBrainstorm = (obj: any): BrainstormOption[] => {
    const arr = Array.isArray(obj?.options) ? obj.options : []
    return arr.slice(0, 4).map((o: any) => ({
      title: String(o?.title || '').slice(0, 40),
      pitch: String(o?.pitch || '').slice(0, 120),
      trigger: o?.trigger ? String(o.trigger).slice(0, 40) : undefined
    })).filter((o: BrainstormOption) => o.title)
  }

  const runBrainstorm = async (seed: string) => {
    const a = ai()
    if (!a?.call) { seedAsRequirement(seed); return } // 无 AI 时直接进规划
    setClarify(null)
    recordMessage(mkMsg('assistant', '我帮你想了几个方向，挑一个开始，或继续用自己的话描述：'))
    setBrainstorm({ loading: true, options: [], seed })
    resetAbort()
    try {
      const obj = await aiJson(STRICT_JSON_SYS, brainstormPrompt(seed))
      if (abortedRef.current) { setBrainstorm(null); addLog('info', '⏹ [Vibe] 已停止发散'); return }
      const options = normalizeBrainstorm(obj)
      if (!options.length) { addLog('warn', '⚠ [Vibe] 头脑风暴未解析出方向，转为直接规划'); setBrainstorm(null); seedAsRequirement(seed); return }
      setBrainstorm({ loading: false, options, seed })
    } catch {
      if (abortedRef.current) { setBrainstorm(null); return }
      setBrainstorm(null); seedAsRequirement(seed)
    }
  }

  // 采用一段「种子描述」推进到契约生成（有目标→规划；无目标→提示先选目录/插件）
  const planFromSeed = (seed: string) => {
    setBrainstorm(null)
    setSentence(seed)
    const hasTarget = vibeMode === 'edit' ? !!editPath.trim() : !!targetDir.trim()
    if (hasTarget) { void doPlan(seed) }
    else { setStage(0); pushToast('info', vibeMode === 'edit' ? '请先在左侧选择要改造的插件，再描述一次' : '请先选择目标目录，再在对话里描述一次') }
  }

  const pickIdea = (opt: BrainstormOption) => {
    const seed = opt.pitch ? `${opt.title}。${opt.pitch}` : opt.title
    recordMessage(mkMsg('user', `选择方向：${opt.title}`, { intent: 'create' }))
    planFromSeed(seed)
  }

  // 跳过头脑风暴：直接用用户原始描述生成契约
  const useBrainstormSeed = () => {
    if (!brainstorm) return
    recordMessage(mkMsg('user', '直接用我刚才的描述生成', { intent: 'create' }))
    planFromSeed(brainstorm.seed)
  }

  // ---------------- 澄清式风暴（S3'，明确需求） ----------------
  // superpowers 式流程：不替用户另想点子，而是围绕他的原始需求「一次只问一个」关键澄清问题（至多 2 轮），
  // 再给出 2-3 个同主题实现做法（差异在做法而非主题）供挑选；每一步都可跳过直奔契约规划。
  const MAX_CLARIFY_ROUNDS = 2

  const clarifyQuestionPrompt = (seed: string, qa: ClarifyQA[]) => [
    '你是 Mulby 插件需求澄清助手。用户已给出一个明确的插件需求，你的任务不是替他另想点子，而是围绕这个需求，找出「对产品行为影响最大的一个」尚未明确的关键问题来问他。',
    '只输出 JSON：{ "done": false, "question": "一句话问题（≤40字）", "options": ["候选答案1", "候选答案2"] }；若需求已足够清晰、没有值得问的关键问题，输出 { "done": true }。',
    '要求：',
    '- 问题必须紧扣用户需求本身（如：处理的维度/规则、确认交互的形式、触发方式、范围边界），绝不偏离主题，绝不推销别的功能',
    '- options 给 2-4 个具体、可直接选用的候选答案，不要「其他/都可以」这类空选项（用户可自行输入）',
    '- 不问纯技术选型（用什么库/框架），只问影响使用体验与产品行为的决策',
    '- 不重复已澄清的内容',
    `用户需求：${seed}`,
    qa.length ? `已澄清：${qa.map((x) => `${x.q}→${x.a}`).join('；')}` : ''
  ].filter(Boolean).join('\n')

  const clarifyApproachPrompt = (seed: string, qa: ClarifyQA[]) => [
    '你是 Mulby 插件方案设计助手。基于用户需求与已澄清细节，给出 2-3 个实现这个需求的候选做法，供用户挑选。',
    '铁律：每个做法都必须是用户原始需求的直接实现，主题不可替换、不可漂移；用户提到的流程约束（如「先出方案、确认后再执行」）必须在每个做法中原样保留。',
    '做法之间的差异只允许体现在：交互方式 / 自动化程度 / 处理深度 / 能力侧重，而不是更换主题。',
    '只输出 JSON：{ "approaches": [ { "title": "≤12字做法名", "pitch": "一两句话说明做法与体验", "recommended": true, "reason": "推荐理由（仅推荐项填）" } ] }，恰好一项 recommended=true。',
    '每个做法都要能用 Mulby 常见桌面能力（剪贴板/通知/文件读写/调用 AI/图像处理/窗口/网络请求等）实现，不要臆造平台做不到的功能。',
    `用户需求：${seed}`,
    qa.length ? `已澄清：${qa.map((x) => `${x.q}→${x.a}`).join('；')}` : ''
  ].filter(Boolean).join('\n')

  const normalizeClarifyQuestion = (obj: any): ClarifyQuestion | null => {
    if (!obj || obj.done === true) return null
    const question = String(obj.question || '').trim().slice(0, 80)
    const options = (Array.isArray(obj.options) ? obj.options : [])
      .map((o: any) => String(o ?? '').trim().slice(0, 60)).filter(Boolean).slice(0, 4)
    if (!question || options.length < 2) return null
    return { question, options }
  }

  const normalizeApproaches = (obj: any): ClarifyApproach[] => {
    const arr = Array.isArray(obj?.approaches) ? obj.approaches : []
    const list = arr.slice(0, 3).map((o: any) => ({
      title: String(o?.title || '').trim().slice(0, 24),
      pitch: String(o?.pitch || '').trim().slice(0, 120),
      recommended: o?.recommended === true,
      reason: o?.reason ? String(o.reason).trim().slice(0, 80) : undefined
    })).filter((o: ClarifyApproach) => o.title)
    let seen = false // 至多保留一个推荐项
    for (const o of list) { if (o.recommended) { if (seen) o.recommended = false; seen = true } }
    return list
  }

  // 把「原始需求 + 已确认细节 + 选定做法 + 补充说明」合成最终种子，交给契约规划
  const composeClarifiedSeed = (seed: string, qa: ClarifyQA[], approach: ClarifyApproach | null, extra?: string): string => {
    const parts = [seed]
    if (qa.length) parts.push(`已确认细节：${qa.map((x) => `${x.q}→${x.a}`).join('；')}`)
    if (approach) parts.push(`实现方式：${approach.title}（${approach.pitch}）`)
    if (extra) parts.push(`补充说明：${extra}`)
    return parts.join('\n')
  }

  const runClarify = async (seed: string) => {
    const a = ai()
    if (!a?.call) { seedAsRequirement(seed); return } // 无 AI 时直接进规划
    setBrainstorm(null)
    recordMessage(mkMsg('assistant', '需求收到。开工前我先跟你确认一两个关键细节，让方案更贴合你的想法（随时可跳过）：'))
    setClarify({ loading: true, seed, round: 0, maxRounds: MAX_CLARIFY_ROUNDS, question: null, qa: [], approaches: null })
    resetAbort()
    await nextClarifyStep(seed, [])
  }

  // 取下一个澄清问题；问满轮数或 AI 认为已够清晰（含解析失败兜底）→ 进入做法选择
  const nextClarifyStep = async (seed: string, qa: ClarifyQA[]) => {
    if (qa.length >= MAX_CLARIFY_ROUNDS) { await runApproaches(seed, qa); return }
    try {
      const obj = await aiJson(STRICT_JSON_SYS, clarifyQuestionPrompt(seed, qa))
      if (abortedRef.current) { setClarify(null); addLog('info', '⏹ [Vibe] 已停止澄清'); return }
      const q = normalizeClarifyQuestion(obj)
      if (!q) { await runApproaches(seed, qa); return }
      setClarify({ loading: false, seed, round: qa.length + 1, maxRounds: MAX_CLARIFY_ROUNDS, question: q, qa, approaches: null })
    } catch {
      if (abortedRef.current) { setClarify(null); return }
      await runApproaches(seed, qa)
    }
  }

  // 用户回答当前澄清问题（点选项或在输入框直接作答）
  const answerClarify = (answer: string) => {
    if (!clarify?.question) return
    const qa = [...clarify.qa, { q: clarify.question.question, a: answer }]
    recordMessage(mkMsg('user', answer, { intent: 'create' }))
    setClarify({ ...clarify, loading: true, question: null, qa })
    resetAbort()
    void nextClarifyStep(clarify.seed, qa)
  }

  const runApproaches = async (seed: string, qa: ClarifyQA[]) => {
    setClarify({ loading: true, seed, round: qa.length, maxRounds: MAX_CLARIFY_ROUNDS, question: null, qa, approaches: null })
    try {
      const obj = await aiJson(STRICT_JSON_SYS, clarifyApproachPrompt(seed, qa))
      if (abortedRef.current) { setClarify(null); return }
      const approaches = normalizeApproaches(obj)
      if (!approaches.length) {
        addLog('warn', '⚠ [Vibe] 未解析出候选做法，转为直接规划')
        setClarify(null); planFromSeed(composeClarifiedSeed(seed, qa, null)); return
      }
      recordMessage(mkMsg('assistant', `${qa.length ? '细节确认完毕' : '你的需求已经很清楚'}，我设计了几种实现做法（差异在做法、不在主题），选一个开始：`))
      setClarify({ loading: false, seed, round: qa.length, maxRounds: MAX_CLARIFY_ROUNDS, question: null, qa, approaches })
    } catch {
      if (abortedRef.current) { setClarify(null); return }
      setClarify(null); planFromSeed(composeClarifiedSeed(seed, qa, null))
    }
  }

  const pickApproach = (ap: ClarifyApproach) => {
    if (!clarify) return
    recordMessage(mkMsg('user', `选择做法：${ap.title}`, { intent: 'create' }))
    const { seed, qa } = clarify
    setClarify(null)
    planFromSeed(composeClarifiedSeed(seed, qa, ap))
  }

  // 跳过澄清（问题/做法任一阶段可点）：带着已确认的细节直接进契约规划
  const skipClarify = () => {
    if (!clarify) return
    recordMessage(mkMsg('user', '跳过，直接按我的描述生成', { intent: 'create' }))
    const { seed, qa } = clarify
    setClarify(null)
    planFromSeed(composeClarifiedSeed(seed, qa, null))
  }

  // 断点续传：接上当前会话中「未完成的任务」而不是新建项目/重新规划。
  // 计划待执行(review)→继续执行；契约已就绪但还没制定计划(idle+contract)→制定计划。返回是否已处理。
  const resumeInFlight = (): boolean => {
    // 计划待执行（含「重新生成」后 generated 仍为 true 的 review 态）→ 继续执行
    if (planPhase === 'review') { void executePlan(); return true }
    // 契约已就绪但还没制定计划（尚未交付）→ 制定计划
    if (!generated && planPhase === 'idle' && !!contract) { void generatePlan(); return true }
    return false
  }

  // ---------------- 意图路由（C 方案）：让 LLM 看「消息 + 历史 + 当前状态」决定该触发哪个动作 ----------------
  // 取代写死的正则分流；正则（classifyIntent / reContinue）降级为 AI 不可用/失败/超时时的兜底安全网。
  const buildRouterState = (): string => {
    const parts: string[] = []
    if (createdPath) parts.push(`已有插件「${contract?.displayName || contract?.name || '项目'}」（${generated ? '已生成、可运行' : '生成中'}）`)
    else parts.push('当前还没有插件项目')
    if (planPhase === 'planning') parts.push('正在制定开发计划')
    else if (planPhase === 'executing') parts.push('正在按计划执行')
    else if (planPhase === 'review') parts.push('有一份开发计划待用户确认后执行（resume = 用户认可、开始/继续执行该计划；replan = 用户对计划有修改意见、需带着意见重新规划，绝不直接执行）')
    else if (!generated && !!contract) parts.push('插件设定(契约)已就绪、尚未制定计划（resume = 开始制定计划）')
    parts.push(vibeMode === 'edit' ? '处于「改造现有插件」模式' : '处于「新建插件」模式')
    return parts.join('；')
  }

  const ROUTE_ACTIONS = new Set<RouteAction>(['ask', 'create', 'modify', 'resume', 'replan', 'run', 'package', 'rollback', 'icon'])

  const routerSystemPrompt = (): string => [
    '你是 Mulby「对话式插件开发助手」的意图路由器。读懂用户最新消息（结合上面的历史对话与下面的当前状态），判断接下来应触发哪一个动作。',
    '只输出 JSON：{"action":"ask|create|modify|resume|replan|run|package|rollback|icon","clarity":"clear|vague"}（clarity 仅在 action=create 时必填，其余动作省略），不要解释、不要 Markdown。',
    '',
    '动作含义与选择规则：',
    '- ask：提问 / 咨询 / 要思路或方案 / 查看现状 / 排查「为什么…」。这是默认动作——只要意图不明、或更像在提问/讨论，一律选 ask（只读，绝不改代码）。带疑问语气（「…吗？」「为什么」「能不能」「怎么」）即使提到功能词也选 ask。',
    '- modify：明确要求改动「现有插件」的功能/样式/代码（祈使句，如「帮我加…」「把…改成…」「修复…」「优化某处」）。',
    '- create：明确想从零做一个「全新插件」，且当前没有正在进行的插件任务。选 create 时必须同时判定 clarity：用户已说清要做什么（有具体功能对象/使用方式/流程要求，哪怕细节不全）→ "clear"；只有模糊念头、求点子、只给了大致领域（如「帮我想个好玩的插件」「做点效率工具」）→ "vague"。',
    '- resume：认可现状、想开始/继续执行「当前的开发计划或未完成任务」（如「继续」「接着做」「开始执行」「就这样」「可以了」）。仅当下面【状态】标明有进行中/待执行的计划或待制定计划时才可选；若用户是在对计划提意见，请改选 replan 而非 resume。',
    '- replan：当下面【状态】标明"有一份开发计划待用户确认"时，用户对这份计划提出修改意见 / 表示不满意 / 想增删改步骤 / 调整顺序（如「第3步不对」「先做界面再写逻辑」「再加一步测试」「这计划太复杂了」「把xxx也加上」）→ 带着用户的意见重新制定计划，绝不直接开始执行。仅在该状态下可选。',
    '- run：想运行 / 打开 / 试用当前插件。',
    '- package：想打包 / 导出 / 发布插件。',
    '- rollback：想撤销 / 回滚 / 还原改动。',
    '- icon：想重做 / 更换 / 美化插件图标。',
    '',
    '红线：宁可选 ask，也不要在不确定时选 modify/create——默认不动代码。',
    `【当前状态】${buildRouterState()}`
  ].join('\n')

  // 调一次轻量 LLM 做路由（无工具、无技能、关历史截断），输出动作 +（create 时）需求成熟度；失败/无效返回 null（交给规则兜底）。
  type RouteClarity = 'clear' | 'vague'
  type RouteResult = { action: RouteAction; clarity: RouteClarity | null }

  const routeIntent = async (text: string): Promise<RouteResult | null> => {
    const a = ai()
    if (!a?.call) return null
    try {
      const res = await a.call({
        ...(selectedModel ? { model: selectedModel } : {}),
        messages: [{ role: 'system', content: routerSystemPrompt() }, ...buildHistoryMessages(text).slice(-6), { role: 'user', content: text }],
        params: { contextWindow: 0 },
        skills: { mode: 'off' }, mcp: { mode: 'off' }, toolingPolicy: { enableInternalTools: false }
      }, captureReqId)
      const content = typeof res?.content === 'string'
        ? res.content
        : Array.isArray(res?.content) ? res.content.map((x: any) => x?.text ?? '').join('\n') : ''
      const json = extractJsonObject(content)
      if (!json) return null
      const parsed = JSON.parse(json)
      const action = String(parsed?.action || '').trim() as RouteAction
      if (!ROUTE_ACTIONS.has(action)) return null
      const c = String(parsed?.clarity || '').trim()
      return { action, clarity: c === 'clear' || c === 'vague' ? c : null }
    } catch { return null }
  }

  // 路由带超时：给较慢的推理模型充足时间（100s）再回退到正则兜底；期间可随时点「停止」取消（见 stopAgent）。
  const routeIntentWithTimeout = async (text: string): Promise<RouteResult | null> =>
    Promise.race([
      routeIntent(text),
      new Promise<RouteResult | null>((resolve) => setTimeout(() => resolve(null), 100000))
    ])

  // 规则兜底：路由器没给出 clarity 时，判断需求是「明确」还是「模糊求点子」。
  // 明确求点子的措辞 / 过短的描述 → vague；其余默认 clear（澄清式风暴锚定原话，误判代价远小于无差别发散）。
  const fallbackClarity = (text: string): RouteClarity =>
    (/帮我想|想不出|没想法|没头绪|随便(来|做|搞)?|什么(好玩|有意思|有趣)|给点(灵感|想法|建议)|不知道(做|搞)什么|有(什么|啥)(好玩|可以做)/.test(text) || text.trim().length < 10)
      ? 'vague' : 'clear'

  // 规则兜底（AI 不可用/失败/超时）：保留原有正则作为安全网（含断点续传的「继续」识别）
  const fallbackAction = (text: string): RouteAction => {
    const reContinue = /^\s*(继续|接着|接上|往下|下一步|go ?on|continue|keep ?going|resume)/i
    // 计划审阅态：仅「纯认可/开始执行」短语 → 执行；带具体意见（任何额外内容）→ 重新规划（不执行），治"提意见却直接开跑"
    if (planPhase === 'review') {
      const reProceed = /^\s*(继续(执行)?|接着(做|跑|来)?|往下|下一步|开始(执行|吧|生成|做)?|执行(吧|计划)?|跑(起来|一下|吧)?|就这样|可以了?|没问题|没毛病|确认(执行)?|同意|认可|go ?on|continue|start|run( it)?|ok|okay|好的?(开始|执行)?)\s*[。.!！~、]*\s*$/i
      return reProceed.test(text) ? 'resume' : 'replan'
    }
    const canResume = (!generated && planPhase === 'idle' && !!contract)
    if (canResume && reContinue.test(text)) return 'resume'
    return classifyIntent(text, { hasPlugin: !!createdPath }).intent
  }

  // 把「动作」分发到既有工作流（LLM 路由与规则兜底都汇聚到这里）。默认不动代码，破坏性操作二次确认。
  const dispatchAction = (action: RouteAction, t: string, clarity?: RouteClarity | null) => {
    switch (action) {
      case 'resume':
        if (!resumeInFlight()) void runAsk(t) // 无可续任务 → 退化为只读问答
        return
      case 'replan':
        // 计划审阅态：带着用户意见重新规划（不执行）；不在审阅态则退化（有契约待规划→制定计划，否则只读问答）
        if (planPhase === 'review') { void generatePlan({ feedback: t }); return }
        if (resumeInFlight()) return
        void runAsk(t); return
      case 'ask':
        void runAsk(t); return
      case 'run':
        if (chatReady) void openPlugin(); else void runAsk(t); return
      case 'package':
        if (chatReady) void doPack(); else void runAsk(t); return
      case 'rollback':
        if (chatReady && changes.length) {
          setPendingPrompt({ kind: 'confirm', title: '撤销本次会话的全部改动？', desc: '将还原改动并重新构建载入，操作不可逆。', actionLabel: '确认撤销', danger: true, onAction: () => { setPendingPrompt(null); void doRollback() } })
        } else void runAsk(t)
        return
      case 'icon':
        // 重新生成图标：依据插件主题/功能（+用户原话里的风格补充），强制覆盖现有图标
        if (createdPath && contract) void generateIcon({ force: true, styleHint: t, announce: true })
        else void runAsk(t)
        return
      case 'modify':
        // 计划审阅态：用户的「修改」意图针对的是这份待执行计划 → 重新规划，绝不直接开跑（治"提意见却直接执行"）
        if (planPhase === 'review') { void generatePlan({ feedback: t }); return }
        if (chatReady) { void runFollowup(t); return }
        // 任务进行中（契约/计划阶段、尚未交付）→ 接上当前阶段，避免重新规划丢失进度
        if (resumeInFlight()) return
        seedAsRequirement(t); return
      case 'create':
      default:
        // 计划审阅态：同样当作对计划的调整 → 重新规划，绝不直接开跑
        if (planPhase === 'review') { void generatePlan({ feedback: t }); return }
        if (chatReady) { void runFollowup(t); return }
        // 已有进行中的任务 → 接上，绝不新建项目（修复「忘记当前在做什么、又开了个新项目」）
        if (resumeInFlight()) return
        if (vibeMode === 'create') {
          if (!targetDir.trim()) { pushToast('info', '请先在左侧选择插件生成的目标目录，再描述一次即可'); return }
          // 模糊念头才发散点子；明确需求走澄清式风暴（先确认细节、再选同主题做法），不再无差别脑暴跑题
          if ((clarity ?? fallbackClarity(t)) === 'vague') { void runBrainstorm(t); return }
          void runClarify(t); return
        }
        seedAsRequirement(t)
        return
    }
  }

  // 全局对话入口：先即时显示用户消息，再由 LLM 路由（失败/超时回退规则）决定动作。默认不动代码。
  const handleChatSend = async (text: string) => {
    const t = text.trim()
    if (!t || busy || aiActive || routing) return
    // 澄清式风暴进行中：输入直接视为对当前问题的回答 / 对做法的补充说明，不走意图路由
    if (clarify && !clarify.loading) {
      if (clarify.question) { answerClarify(t); return }
      if (clarify.approaches) {
        recordMessage(mkMsg('user', t, { intent: 'create' }))
        const { seed, qa } = clarify
        setClarify(null)
        planFromSeed(composeClarifiedSeed(seed, qa, null, t))
        return
      }
    }
    // 立即落消息：意图标签先用规则给个即时值（真正动作由 LLM 决定，避免等待路由才显示用户气泡）
    const provisional = fallbackAction(t)
    recordMessage(mkMsg('user', t, { intent: provisional === 'resume' ? 'create' : provisional === 'replan' ? 'modify' : provisional }))
    let action: RouteAction = provisional
    let clarity: RouteClarity | null = null
    if (ai()?.call) {
      resetAbort()
      setRouting(true)
      try {
        const routed = await routeIntentWithTimeout(t)
        if (abortedRef.current) return // 用户在「理解中」点了停止 → 取消本次分发
        if (routed) { action = routed.action; clarity = routed.clarity }
      } finally { setRouting(false) }
    }
    dispatchAction(action, t, clarity)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部细条：项目切换 + 只读阶段进度 + 模型 + 详情抽屉 + 重新开始 */}
      <header className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/30">
        <Sparkles size={15} className="text-emerald-500 shrink-0" />
        <div className="min-w-0 max-w-[220px] shrink"><SessionSwitcher onNewSession={startNewProject} onNewConversation={newConversation} /></div>
        {/* 只读阶段进度（紧凑横向 stepper；窄屏隐藏）*/}
        <ol className="hidden lg:flex items-center gap-0.5 text-[11px] ml-1 shrink-0">
          {STAGES.map((s, i) => {
            const active = s.id === stage
            const done = s.id < stage
            return (
              <li key={s.id} className="flex items-center gap-0.5">
                {i > 0 && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" />}
                <span
                  title={done ? '已完成' : active ? '当前阶段' : '未开始'}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors ${active ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : done ? 'text-slate-500 dark:text-slate-400' : s.id > maxStage ? 'text-slate-300 dark:text-slate-600' : 'text-slate-400'}`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium ${done ? 'bg-emerald-500 text-white anim-check' : active ? 'bg-emerald-500/20' : 'bg-slate-200 dark:bg-slate-700'}`}>
                    {done ? <Check size={10} /> : s.id + 1}
                  </span>
                  {s.title}
                </span>
              </li>
            )
          })}
        </ol>
        <span className="flex-1" />
        <select
          className="input-base text-xs h-7 py-0 max-w-[150px] hidden md:block shrink-0"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={modelLoading || modelOptions.length === 0}
          title={selectedModel || '宿主默认模型'}
        >
          {modelLoading && <option value="">加载模型中…</option>}
          {!modelLoading && modelOptions.length === 0 && <option value="">宿主默认模型</option>}
          {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {contract && (
          <button
            className={`btn-ghost h-7 px-2 text-[11px] shrink-0 ${drawerOpen ? 'bg-slate-100 dark:bg-slate-800/70 text-emerald-600 dark:text-emerald-400' : ''}`}
            onClick={() => setDrawerOpen((v) => !v)}
            title="插件详情：契约设定 / 验收清单 / 版本历史 / 一致性"
          >
            <ListChecks size={14} /> 详情
          </button>
        )}
        {stage > 0 && (
          <button className="btn-ghost h-7 px-2 text-[11px] shrink-0" onClick={resetAll} disabled={busy} title="清空并重新开始">
            <RefreshCw size={13} /> 重新开始
          </button>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* 项目设置：描述阶段作为左侧栏，让对话主区始终保持全高、不被上下挤压 */}
        {stage === 0 && !contract && (
          <aside className="w-64 shrink-0 overflow-auto border-r border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/30 px-4 py-4 anim-in">
            <DescribeStage
              vibeMode={vibeMode} setVibeMode={setVibeMode}
              targetDir={targetDir} setTargetDir={setTargetDir}
              editPath={editPath} setEditPath={setEditPath}
              knownPlugins={knownPlugins}
              genDepth={genDepth} setGenDepth={setGenDepth}
              onPickDir={onPickDir} disabled={busy}
            />
          </aside>
        )}
        {/* 对话主线（全高，主交互）*/}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <ChatPanel
              onSend={handleChatSend}
              disabled={busy && !iterating}
              busy={iterating || generating || iconBusy || planning}
              busyHint={planning ? (vibeMode === 'edit' ? '正在分析改造点…' : '正在生成插件设定（契约）…') : ''}
              routing={routing}
              aiActive={aiActive}
              onStop={stopAgent}
              streamingText={(iterating || generating) ? narration : ''}
              brainstorm={brainstorm}
              onPickIdea={pickIdea}
              onMoreIdeas={() => { if (brainstorm) void runBrainstorm(brainstorm.seed) }}
              onUseSeed={useBrainstormSeed}
              onDismissBrainstorm={() => setBrainstorm(null)}
              clarify={clarify}
              onAnswerClarify={answerClarify}
              onPickApproach={pickApproach}
              onSkipClarify={skipClarify}
              onDismissClarify={() => setClarify(null)}
              examples={vibeMode === 'edit' ? EDIT_EXAMPLES : EXAMPLES}
              contractPending={contractPending}
              onConfirmGenerate={() => generatePlan()}
              plan={plan}
              planPhase={planPhase}
              onStartPlan={executePlan}
              onReplan={() => generatePlan()}
              pendingPrompt={pendingPrompt}
              onPromptDismiss={() => setPendingPrompt(null)}
              status={pluginStatus}
              statusBusy={building || packing}
              iconBusy={iconBusy}
              iconProgress={iconProgress}
              packed={packed}
              onOpenPlugin={openPlugin}
              onTryIt={tryIt}
              onPack={doPack}
              onRegenIcon={() => void generateIcon({ force: true, announce: true })}
              onUndoToBefore={() => void requestUndoToBeforeAI()}
              undoing={!!restoringHash}
              onClearMessages={() => { if (activeId) clearMessages(activeId) }}
            />
          </div>
        </main>

        {/* 进阶详情抽屉（方案A：默认关，点顶部「详情」展开；进阶/质检功能在此按需出现）*/}
        {drawerOpen && (
          <aside className="w-[26rem] max-w-[48%] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/40 flex flex-col anim-drawer">
            {/* 抽屉头：插件身份（一处）+ 关闭 */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                {contract ? (
                  <>
                    <span className="w-7 h-7 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 flex items-center justify-center shrink-0">
                      {iconDataUrl ? <img src={iconDataUrl} alt="图标" className="w-full h-full object-contain" /> : <Rocket size={14} className="text-emerald-500" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate leading-tight">{contract.displayName || '插件详情'}</span>
                        {(() => {
                          const st = deriveDrawerStatus({ generating, building, built, loaded, buildFailed: !building && !built && !!buildLog, createdPath })
                          return (
                            <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium ${st.chipCls}`}>
                              <span className={`w-1 h-1 rounded-full ${st.dotCls}`} />{st.text}
                            </span>
                          )
                        })()}
                      </span>
                      {primaryTrigger(contract) && <TriggerCopy trigger={primaryTrigger(contract)} />}
                    </span>
                  </>
                ) : (
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5"><ListChecks size={15} className="text-emerald-500" /> 插件详情</span>
                )}
              </div>
              <button className="btn-ghost h-7 w-7 p-0 justify-center shrink-0" onClick={() => setDrawerOpen(false)} title="关闭"><X size={15} /></button>
            </div>

            {!contract ? (
              <div className="flex-1 overflow-auto px-4 py-4">
                {planning ? (
                  <div className="flex items-center gap-2 text-[12px] text-slate-500 dark:text-slate-400"><Loader2 size={14} className="animate-spin text-emerald-500" /> 正在生成插件设定（契约）…</div>
                ) : (
                  <div className="text-[12px] text-slate-400 dark:text-slate-500 leading-relaxed">还没有插件项目。在对话里描述需求、生成插件后，这里会显示契约设定、验收清单、版本历史等详情。</div>
                )}
              </div>
            ) : (
              <>
                {/* 分区 Tab：契约 / 进度 / 交付（随阶段自动选中，可手动切换）*/}
                <div className="shrink-0 flex items-center gap-1 px-3 pt-2 border-b border-slate-200 dark:border-slate-800">
                  <DrawerTab active={drawerTab === 'contract'} onClick={() => setDrawerTab('contract')} label="契约" />
                  {stage >= 2 && <DrawerTab active={drawerTab === 'progress'} onClick={() => setDrawerTab('progress')} label="进度" />}
                  {stage === 3 && <DrawerTab active={drawerTab === 'deliver'} onClick={() => setDrawerTab('deliver')} label="交付" />}
                </div>
                <div className="flex-1 overflow-auto px-4 py-4">
                  {drawerTab === 'contract' && (
                    <ContractStage contract={contract} setContract={setContract} editable={!generating}
                      created={!!createdPath} applying={building} onApply={applyContractEdits} />
                  )}
                  {drawerTab === 'progress' && stage >= 2 && (
                    <GenerateStage contract={contract} events={events} toolCalls={toolCalls} narration={narration} createdPath={createdPath} busy={generating || expanding} />
                  )}
                  {drawerTab === 'deliver' && stage === 3 && (
                    <DeliverStage
                      contract={contract} createdPath={createdPath}
                      building={building} built={built} buildLog={buildLog}
                      loaded={loaded} loadedId={loadedId}
                      repairing={repairing} expanding={expanding}
                      iconBusy={iconBusy} iconDone={iconDone} iconDataUrl={iconDataUrl}
                      devtoolsOn={devtoolsOn} devtoolsBusy={devtoolsBusy} opened={opened}
                      changes={changes} rollingBack={rollingBack} onRollback={doRollback}
                      coreVerified={coreVerified} onToggleCoreVerified={() => setCoreVerified((v) => !v)}
                      conformance={conformance} confRepairing={confRepairing} onRepairConformance={repairConformance}
                      smoke={smoke} smoking={smoking} onRunSmoke={runFeatureSmoke}
                      versions={versions} vcsAvailable={vcsAvailable} restoringHash={restoringHash}
                      onRefreshVersions={loadVersions} onVersionDiff={loadVersionDiff} onRestoreVersion={doRestoreVersion}
                      onRebuild={() => void runBuildAndLoad({ skipIcon: true })} onRepair={runRepair}
                      onRegenIcon={() => void generateIcon({ force: true, announce: true })}
                      onOpenDir={() => dev.openPluginDir(createdPath)}
                      onEnableDevtools={enableDevtools}
                      onPublish={() => setPublishOpen(true)}
                      publishRecord={publishRecord} publishLive={publishLive}
                      publishStatusLoading={publishStatusLoading}
                      onRefreshPublishStatus={() => refreshPublishStatus(publishRecord)}
                      onRerunCi={handleRerunCi} rerunningCi={rerunningCi}
                      onAiFixReview={(instruction) => {
                        recordMessage(mkMsg('user', instruction, { intent: 'modify' }))
                        void runFollowup(instruction)
                      }}
                      aiFixBusy={busy || aiActive || iterating}
                    />
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </div>

      {contract && (
        <PublishDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          createdPath={createdPath}
          contract={contract}
          dev={dev}
          built={built}
          conformance={conformance}
          pushToast={pushToast}
          onPublished={handlePublished}
          onVersionBumped={(v) => setContract((c) => (c ? { ...c, version: v } : c))}
        />
      )}
    </div>
  )
}

// ============ 子组件 ============

/** best-effort 复制到剪贴板（触发词等） */
function copyText(text: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text)
    }
  } catch {
    /* best-effort copy */
  }
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m${String(s % 60).padStart(2, '0')}s`
}

/** 抽屉头的阶段状态徽标：随构建/载入进展三态着色 */
function deriveDrawerStatus(o: {
  generating: boolean; building: boolean; built: boolean; loaded: boolean; buildFailed: boolean; createdPath: string
}): { text: string; chipCls: string; dotCls: string } {
  if (o.building || o.generating) return { text: '进行中', chipCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dotCls: 'bg-amber-500 animate-pulse' }
  if (o.buildFailed) return { text: '构建失败', chipCls: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', dotCls: 'bg-rose-500' }
  if (o.loaded) return { text: '已就绪', chipCls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', dotCls: 'bg-emerald-500' }
  if (o.built) return { text: '已构建', chipCls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', dotCls: 'bg-amber-500' }
  if (o.createdPath) return { text: '已生成', chipCls: 'bg-slate-400/15 text-slate-500 dark:text-slate-400', dotCls: 'bg-slate-400' }
  return { text: '契约待确认', chipCls: 'bg-slate-400/15 text-slate-500 dark:text-slate-400', dotCls: 'bg-slate-400' }
}

/** 生成流水线阶段（进度页进度条） */
const GEN_PIPELINE: Array<{ phase: EventPhase; label: string }> = [
  { phase: 'plan', label: '规划' },
  { phase: 'scaffold', label: '脚手架' },
  { phase: 'manifest', label: '契约' },
  { phase: 'minimal', label: '最小' },
  { phase: 'full', label: '完整' }
]

/** 时间线左轨色条：按事件类型着色 */
const KIND_BORDER: Record<EventKind, string> = {
  read: 'border-sky-400/60', write: 'border-emerald-400/60', build: 'border-amber-400/60',
  load: 'border-indigo-400/60', error: 'border-rose-400/70', note: 'border-slate-300/50 dark:border-slate-600/50', ai: 'border-emerald-400/60'
}

/** 触发词一键复制（带复制成功反馈） */
function TriggerCopy({ trigger }: { trigger: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { copyText(trigger); setCopied(true); setTimeout(() => setCopied(false), 1200) }}
      className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors max-w-full leading-tight"
      title="复制触发词到剪贴板"
    >
      <span className="truncate">触发：{trigger}</span>
      {copied ? <Check size={10} className="shrink-0 text-emerald-500" /> : <Copy size={10} className="shrink-0 opacity-60" />}
    </button>
  )
}

/** 溢出操作菜单（交付页次要操作收纳） */
function MoreMenu({ items }: { items: Array<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!items.length) return null
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost !px-2" onClick={() => setOpen((v) => !v)} title="更多操作"><MoreHorizontal size={16} /></button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[10rem] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
          {items.map((it, i) => (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick() }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40 ${it.danger ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
              <span className="shrink-0">{it.icon}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 插件详情抽屉的分区 Tab 按钮 */
function DrawerTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

function ModeBtn({ active, disabled, onClick, icon, label }: { active: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all disabled:opacity-50 ${active ? 'bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}>
      {icon}{label}
    </button>
  )
}

function DescribeStage({
  vibeMode, setVibeMode, targetDir, setTargetDir,
  editPath, setEditPath, knownPlugins, genDepth, setGenDepth, onPickDir, disabled
}: {
  vibeMode: VibeMode; setVibeMode: (m: VibeMode) => void
  targetDir: string; setTargetDir: (s: string) => void
  editPath: string; setEditPath: (s: string) => void
  knownPlugins: KnownPlugin[]
  genDepth: 'full' | 'minimal'; setGenDepth: (m: 'full' | 'minimal') => void
  onPickDir: () => Promise<string | null>
  disabled?: boolean
}) {
  const isEdit = vibeMode === 'edit'
  return (
    <div className="w-full space-y-5">
      <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/70">
        <ModeBtn active={!isEdit} disabled={disabled} onClick={() => setVibeMode('create')} icon={<Lightbulb size={14} />} label="新建插件" />
        <ModeBtn active={isEdit} disabled={disabled} onClick={() => setVibeMode('edit')} icon={<Pencil size={14} />} label="改造已有插件" />
      </div>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 border border-emerald-500/20 flex items-center justify-center">
          {isEdit ? <Pencil size={20} className="text-emerald-500" /> : <Lightbulb size={20} className="text-emerald-500" />}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{isEdit ? '选一个插件，在对话里说要改什么' : '设好目标，在对话里描述你的插件'}</h2>
        </div>
      </div>

      {isEdit && (
        <Field label="目标插件" hint="从已载入插件中选择，或直接选目录">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Boxes size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <select className="input-base pl-8 w-full" value={knownPlugins.some((k) => k.path === editPath) ? editPath : ''} onChange={(e) => setEditPath(e.target.value)} disabled={disabled || knownPlugins.length === 0}>
                <option value="">{knownPlugins.length === 0 ? '（暂无已知插件，请选目录）' : '— 选择已载入插件 —'}</option>
                {knownPlugins.map((k) => <option key={k.path} value={k.path}>{k.displayName}（{k.id}）</option>)}
              </select>
            </div>
            <button className="btn-secondary shrink-0" disabled={disabled} onClick={async () => { const d = await onPickDir(); if (d) setEditPath(d) }}>
              <FolderSearch size={15} /> 选目录
            </button>
          </div>
          {editPath && <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500 mono truncate">{editPath}</p>}
        </Field>
      )}

      {!isEdit && (
        <Field label="目标目录" hint="将在此目录下创建插件子目录">
          <div className="flex gap-2">
            <input className="input-base mono flex-1" placeholder="/Users/you/plugins" value={targetDir} onChange={(e) => setTargetDir(e.target.value)} disabled={disabled} />
            <button className="btn-secondary shrink-0" disabled={disabled} onClick={async () => { const d = await onPickDir(); if (d) setTargetDir(d) }}>
              <FolderSearch size={15} /> 选择
            </button>
          </div>
        </Field>
      )}

      <Field label="生成方式" hint={genDepth === 'full' ? '一次性生成完整版本（推荐）' : '先生成最小骨架，之后说「继续完善」逐步补全'}>
        <div className="inline-flex p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/70">
          <ModeBtn active={genDepth === 'full'} disabled={disabled} onClick={() => setGenDepth('full')} icon={<Rocket size={14} />} label="完整实现" />
          <ModeBtn active={genDepth === 'minimal'} disabled={disabled} onClick={() => setGenDepth('minimal')} icon={<Lightbulb size={14} />} label="最小可跑" />
        </div>
      </Field>

    </div>
  )
}

function ContractStage({ contract, setContract, editable, created, applying, onApply }: { contract: VibeContract; setContract: (c: VibeContract) => void; editable: boolean; created?: boolean; applying?: boolean; onApply?: () => void }) {
  return (
    <div className="w-full space-y-4">
      <p className="text-[12px] text-slate-500 dark:text-slate-400 leading-relaxed">
        {contract.isEdit
          ? '确认改造契约——manifest.json 将按这份契约确定性重写，AI 只负责实现代码。'
          : created
            ? '改完点下方「应用修改并重建」，按契约重写 manifest.json。'
            : 'manifest.json 将由这份契约确定性生成；AI 只负责实现代码。'}
      </p>

      {contract.isEdit && contract.editSummary && (
        <div className="rounded-lg bg-amber-500/5 border border-amber-500/30 p-3 text-[12px] text-amber-700 dark:text-amber-300">
          <span className="font-medium">本次改动：</span>{contract.editSummary}
        </div>
      )}

      <ContractEditor contract={contract} onChange={setContract} editable={editable} lockName={created} />

      {created && editable && onApply && (
        <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-1 bg-gradient-to-t from-white via-white/95 to-transparent dark:from-slate-900 dark:via-slate-900/95">
          <button className="btn-primary w-full justify-center" disabled={applying} onClick={onApply}>
            {applying ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 应用修改并重建
          </button>
          <p className="mt-1.5 text-[10px] text-center text-slate-400 dark:text-slate-500">按契约重写 manifest.json 并重新构建载入（插件 id 不可改）</p>
        </div>
      )}
    </div>
  )
}

const KIND_ICON: Record<EventKind, React.ReactNode> = {
  read: <FileSearch size={13} className="text-sky-500" />,
  write: <FileEdit size={13} className="text-emerald-500" />,
  build: <Hammer size={13} className="text-amber-500" />,
  load: <Rocket size={13} className="text-indigo-500" />,
  error: <AlertTriangle size={13} className="text-rose-500" />,
  note: <Check size={13} className="text-slate-400" />,
  ai: <Sparkles size={13} className="text-emerald-500" />
}

function Timeline({ events, compact }: { events: TimelineEvent[]; compact?: boolean }) {
  const list = compact ? events.slice(-8) : events
  return (
    <ul className={`space-y-1 ${compact ? 'max-h-40' : 'max-h-[420px]'} overflow-auto`}>
      {list.map((e) => (
        <li key={e.id} className={`flex items-start gap-2 text-[12px] pl-2 py-0.5 border-l-2 ${KIND_BORDER[e.kind]}`}>
          <span className="mt-0.5 shrink-0">{KIND_ICON[e.kind]}</span>
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">{PHASE_LABEL[e.phase]}</span>
          <span className={`min-w-0 ${e.kind === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
            <span className="break-words">{e.text}</span>
            {e.detail && <span className="text-slate-400 dark:text-slate-500"> · {e.detail}</span>}
          </span>
        </li>
      ))}
      {list.length === 0 && <li className="text-[12px] text-slate-400 dark:text-slate-500 pl-2">等待开始…</li>}
    </ul>
  )
}

function GenerateStage({ contract, events, toolCalls, narration, createdPath, busy }: { contract: VibeContract | null; events: TimelineEvent[]; toolCalls: number; narration: string; createdPath: string; busy: boolean }) {
  const [now, setNow] = useState(Date.now())
  const [narrOpen, setNarrOpen] = useState(false)
  useEffect(() => {
    if (!busy) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [busy])

  const seen = new Set(events.map((e) => e.phase))
  const lastPhase = events.length ? events[events.length - 1].phase : null
  const current = events.length ? events[events.length - 1] : null
  const writeCount = events.filter((e) => e.kind === 'write').length
  const firstTs = events.length ? events[0].ts : null
  const lastTs = events.length ? events[events.length - 1].ts : null
  const elapsedMs = firstTs != null ? (busy ? now : (lastTs ?? now)) - firstTs : 0

  return (
    <div className="w-full space-y-4">
      {contract && (
        <p className="text-[12px] leading-relaxed">
          <span className="font-medium text-slate-600 dark:text-slate-300">{busy ? 'AI 正在生成…' : '生成完成'}</span>
          <span className="text-slate-400 dark:text-slate-500"> · {contractSummary(contract)}</span>
        </p>
      )}

      {/* 阶段进度条：规划→脚手架→契约→最小→完整 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 space-y-2.5">
        <div className="flex items-center">
          {GEN_PIPELINE.map((st, i) => {
            const isCurrent = busy && st.phase === lastPhase
            const done = seen.has(st.phase) && !isCurrent
            return (
              <div key={st.phase} className={`flex items-center ${i < GEN_PIPELINE.length - 1 ? 'flex-1' : ''}`}>
                <span className={`flex items-center gap-1 text-[10px] font-medium whitespace-nowrap ${isCurrent ? 'text-emerald-600 dark:text-emerald-400' : done ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'}`}>
                  <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${isCurrent ? 'bg-emerald-500 text-white' : done ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-200 dark:bg-slate-700'}`}>
                    {isCurrent ? <Loader2 size={9} className="animate-spin" /> : done ? <Check size={9} /> : <span className="w-1 h-1 rounded-full bg-current opacity-50" />}
                  </span>
                  {st.label}
                </span>
                {i < GEN_PIPELINE.length - 1 && <span className={`flex-1 h-px mx-1 ${done ? 'bg-emerald-500/30' : 'bg-slate-200 dark:bg-slate-700'}`} />}
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
          <span className="flex items-center gap-1"><Terminal size={11} /> {events.length} 事件</span>
          <span>· {toolCalls} 次工具调用</span>
          {writeCount > 0 && <span>· 写入 {writeCount} 文件</span>}
          {elapsedMs > 0 && <span className="ml-auto mono">{fmtDuration(elapsedMs)}</span>}
        </div>
      </div>

      {/* 当前活动：最新一条事件置顶高亮 */}
      {busy && current && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
          <Loader2 size={13} className="animate-spin text-emerald-500 shrink-0" />
          <span className="shrink-0">{KIND_ICON[current.kind]}</span>
          <span className="min-w-0 truncate text-slate-600 dark:text-slate-300">{current.text}{current.detail ? ` · ${current.detail}` : ''}</span>
        </div>
      )}

      {/* 时间线 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
        <div className="flex items-center justify-between text-[12px] text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-1.5"><Terminal size={13} /> 活动时间线</span>
          {createdPath && <span className="mono truncate max-w-[55%] text-[11px]">{createdPath}</span>}
        </div>
        <Timeline events={events} />
        {narration && (
          <div className="border-t border-slate-200/70 dark:border-slate-800/70 pt-2">
            <p className={`text-[11px] text-slate-400 dark:text-slate-500 whitespace-pre-wrap ${narrOpen ? '' : 'line-clamp-5'}`}>{narration}</p>
            <button onClick={() => setNarrOpen((v) => !v)} className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-400 hover:underline">
              {narrOpen ? '收起' : '展开全部'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function DeliverStage({
  contract, createdPath, building, built, buildLog, loaded, loadedId,
  repairing, expanding, iconBusy, iconDone, iconDataUrl,
  devtoolsOn, devtoolsBusy, opened,
  changes, rollingBack, onRollback, coreVerified, onToggleCoreVerified,
  conformance, confRepairing, onRepairConformance, smoke, smoking, onRunSmoke,
  versions, vcsAvailable, restoringHash, onRefreshVersions, onVersionDiff, onRestoreVersion,
  onRebuild, onRepair, onRegenIcon, onOpenDir, onEnableDevtools, onPublish,
  publishRecord, publishLive, publishStatusLoading, onRefreshPublishStatus, onRerunCi, rerunningCi,
  onAiFixReview, aiFixBusy
}: {
  contract: VibeContract; createdPath: string
  building: boolean; built: boolean; buildLog: string
  loaded: boolean; loadedId?: string
  repairing: boolean; expanding: boolean
  iconBusy: boolean; iconDone: boolean; iconDataUrl: string | null
  devtoolsOn: boolean | null; devtoolsBusy: boolean; opened: boolean
  changes: VibeChange[]; rollingBack: boolean; onRollback: () => void
  coreVerified: boolean; onToggleCoreVerified: () => void
  conformance: ConformanceResult | null; confRepairing: boolean; onRepairConformance: () => void
  smoke: SmokeResult[]; smoking: boolean; onRunSmoke: () => void
  versions: VcsCommit[]; vcsAvailable: boolean; restoringHash: string | null
  onRefreshVersions: () => void; onVersionDiff: (hash: string) => Promise<string>; onRestoreVersion: (hash: string) => void
  onRebuild: () => void; onRepair: () => void
  onRegenIcon: () => void
  onOpenDir: () => void; onEnableDevtools: () => void
  onPublish: () => void
  publishRecord: PublishRecord | null; publishLive: PublishLive | null
  publishStatusLoading: boolean; onRefreshPublishStatus: () => void
  onRerunCi: () => void; rerunningCi: boolean
  onAiFixReview: (instruction: string) => void; aiFixBusy: boolean
}) {
  const buildFailed = !building && !built && !!buildLog
  const isEdit = !!contract.isEdit
  const trigger = primaryTrigger(contract)
  const confErrors = (conformance?.issues || []).filter((i) => i.level === 'error')
  const rebuildIsPrimary = !buildFailed && !loaded

  // 状态横幅：把原本散落的「成功 / 失败 / 已构建未载入」三段提示合并为一条三态横幅
  const banner = (() => {
    if (building) return { tone: 'busy' as const, icon: <Loader2 size={16} className="animate-spin text-emerald-500" />, title: '构建并载入中…', desc: '' as React.ReactNode }
    if (buildFailed) return { tone: 'error' as const, icon: <AlertTriangle size={16} className="text-rose-500" />, title: '构建未通过', desc: '点下方「AI 修复并重试」可让 AI 读取报错并自动修复。' as React.ReactNode }
    if (loaded && confErrors.length) return { tone: 'warn' as const, icon: <ShieldCheck size={16} className="text-amber-500" />, title: '已载入，但契约校验未通过', desc: `契约与代码有 ${confErrors.length} 处不一致，见下方「契约一致性」。` as React.ReactNode }
    if (loaded) return { tone: 'ok' as const, icon: <Check size={16} className="text-emerald-500" />, title: isEdit ? '改造已生效 🎉' : '插件已就绪 🎉', desc: (<>在 Mulby 主输入框输入 <span className="mono badge badge-green">{trigger}</span> 即可打开{isEdit ? '改造后的' : '你的'}插件。</>) as React.ReactNode }
    if (built) return { tone: 'warn' as const, icon: <ShieldCheck size={16} className="text-amber-500" />, title: '已构建但未自动载入', desc: '可点下方「重新构建」或在工作台手动刷新。' as React.ReactNode }
    return { tone: 'default' as const, icon: <Rocket size={16} className="text-emerald-500" />, title: '构建与交付', desc: '' as React.ReactNode }
  })()
  const bannerCls = banner.tone === 'error' ? 'border-rose-500/30 bg-rose-500/5'
    : banner.tone === 'warn' ? 'border-amber-500/30 bg-amber-500/5'
    : banner.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5'
    : 'border-slate-200 dark:border-slate-700'

  // 次要操作收进「⋯更多」：重新构建（非主操作时）/ 图标 / 打开目录
  const moreItems = [
    ...(!rebuildIsPrimary ? [{ icon: <Hammer size={14} />, label: '重新构建', onClick: onRebuild, disabled: building }] : []),
    { icon: iconBusy ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />, label: iconDataUrl ? '重做图标' : '生成图标', onClick: onRegenIcon, disabled: iconBusy },
    { icon: <FolderOpen size={14} />, label: '打开目录', onClick: onOpenDir }
  ]

  return (
    <div className="w-full space-y-4">
      {/* 状态横幅（替代图标大头，三态合一；带图标预览） */}
      <div className={`rounded-xl border p-3 flex items-start gap-2.5 ${bannerCls}`}>
        <span className="relative w-9 h-9 rounded-lg bg-white/60 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 flex items-center justify-center overflow-hidden shrink-0">
          {iconDataUrl ? <img src={iconDataUrl} alt="插件图标" className="w-full h-full object-contain" /> : banner.icon}
          {iconBusy && <span className="absolute inset-0 bg-slate-900/40 flex items-center justify-center"><Loader2 size={14} className="text-white animate-spin" /></span>}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {iconDataUrl && <span className="shrink-0">{banner.icon}</span>}
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{banner.title}</span>
          </div>
          {banner.desc && <div className="text-[12px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{banner.desc}</div>}
          {createdPath && <div className="text-[10px] text-slate-400 dark:text-slate-500 mono truncate mt-0.5">{createdPath}</div>}
        </div>
      </div>

      {/* 失败时的构建日志就近显示在横幅下 */}
      {buildFailed && buildLog && (
        <pre className="text-[11px] mono text-rose-600/90 dark:text-rose-300/80 bg-black/5 dark:bg-black/30 rounded-lg p-2.5 max-h-40 overflow-auto whitespace-pre-wrap">{buildLog.slice(-2000)}</pre>
      )}

      {/* 操作区：按状态只突出 1~2 个主操作，其余收进「⋯更多」 */}
      {!building && (
        <div className="flex items-center gap-2">
          {buildFailed && (
            <button className="btn-primary flex-1 justify-center" onClick={onRepair} disabled={repairing}>{repairing ? <Loader2 size={15} className="animate-spin" /> : <Wrench size={15} />} {repairing ? 'AI 修复中…' : 'AI 修复并重试'}</button>
          )}
          {loaded && !buildFailed && (
            <button className="btn-primary flex-1 justify-center" onClick={onPublish} title="提交 PR 发布到插件仓库"><UploadCloud size={15} /> 发布</button>
          )}
          {loaded && !buildFailed && (
            <button className="btn-secondary" onClick={onRunSmoke} disabled={smoking} title="用契约里的示例输入真实调用每个功能一次，验证「能执行」而不只是「能编译」">{smoking ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} 运行验证</button>
          )}
          {rebuildIsPrimary && (
            <button className="btn-primary flex-1 justify-center" onClick={onRebuild} disabled={building}><Hammer size={15} /> 重新构建</button>
          )}
          <MoreMenu items={moreItems} />
        </div>
      )}

      {/* 发布状态回显：提交过 PR 后显示 PR 号 / 版本 / 合并·CI·审查状态，可刷新、重跑、查看意见并让 AI 按意见修改 */}
      {publishRecord && (
        <PublishStatusBadge record={publishRecord} live={publishLive} loading={publishStatusLoading}
          onRefresh={onRefreshPublishStatus} onRerunCi={onRerunCi} rerunning={rerunningCi}
          onAiFix={onAiFixReview} aiFixBusy={aiFixBusy} />
      )}

      {/* 验收清单：构建/载入是「能编译能装载」，契约一致 + 运行验证才是「真的能跑」 */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
        <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><ListChecks size={14} /> 验收清单</div>
        <StatusRow ok={built} busy={building} label="构建通过（npm run build）" />
        <StatusRow ok={loaded} busy={building} label={`载入 Mulby${loadedId ? `（${loadedId}）` : ''}`} />
        <StatusRow
          ok={!!conformance?.ok} busy={building || confRepairing}
          label={`契约一致性${conformance ? (conformance.ok ? `（${conformance.summary || '通过'}）` : `（${confErrors.length} 处需修复）`) : ''}`}
        />
        {contract.needIcon && <StatusRow ok={iconDone} busy={iconBusy} label="图标 icon.png（SVG → 512）" optional />}
        <StatusRow ok={opened} label={`触发验证：用「${trigger}」打开并确认 UI`} manual />
        <StatusRow
          ok={coreVerified} busy={smoking}
          label={`运行验证：${smoke.length ? smokeSummary(smoke) : '用示例输入真实跑一遍主流程'}`}
          manual onClick={onToggleCoreVerified}
        />
        {loaded && smoke.length > 0 && <SmokeList smoke={smoke} />}
      </div>

      {/* 契约一致性问题（折叠卡，error 默认展开）：error 级会阻断「就绪」，可一键让 AI 修复 */}
      {conformance && conformance.issues.length > 0 && (
        <ConformanceCard conformance={conformance} confRepairing={confRepairing} onRepair={onRepairConformance} disabled={building || expanding || repairing || rollingBack} />
      )}

      {/* 本次改动（安全网）：diff 预览 + 一键回滚 */}
      <ChangesCard changes={changes} rollingBack={rollingBack} onRollback={onRollback} defaultOpen={isEdit} disabled={building || expanding || repairing} />

      {/* 版本历史：每次生成/迭代/打包自动记录，可查看 diff 与一键回滚 */}
      <VersionHistoryCard versions={versions} vcsAvailable={vcsAvailable} restoringHash={restoringHash} disabled={building || expanding || repairing} onRefresh={onRefreshVersions} onDiff={onVersionDiff} onRestore={onRestoreVersion} />

      {/* 实时调试回路 */}
      {(built || loaded) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-2.5">
          <div className="text-[12px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5"><Bug size={14} /> 实时调试</div>
          {devtoolsOn === true ? (
            <p className="text-[12px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5"><Check size={13} /> DevTools 已开启，打开插件窗口会自动弹出控制台（含后端日志回灌）。</p>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-slate-500 dark:text-slate-400">{devtoolsOn === false ? '当前未开启「打开插件窗口自动开 DevTools」。' : '无法读取 DevTools 设置，可手动在 Mulby 设置→开发者开启。'}</p>
              <button className="btn-secondary shrink-0" onClick={onEnableDevtools} disabled={devtoolsBusy}>{devtoolsBusy ? <Loader2 size={14} className="animate-spin" /> : <Bug size={14} />} 开启 DevTools</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusRow({ ok, busy, label, optional, manual, onClick }: { ok: boolean; busy?: boolean; label: string; optional?: boolean; manual?: boolean; onClick?: () => void }) {
  const clickable = typeof onClick === 'function'
  const content = (
    <>
      <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-500 text-white' : busy ? 'bg-amber-500/20 text-amber-500' : 'bg-slate-200 dark:bg-slate-700 text-slate-400'}`}>
        {ok ? <Check size={12} /> : busy ? <Loader2 size={12} className="animate-spin" /> : optional ? <ImageIcon size={11} /> : manual ? <ListChecks size={11} /> : <FileText size={11} />}
      </span>
      <span className="text-slate-600 dark:text-slate-300">{label}</span>
      {optional && !ok && !busy && <span className="text-[11px] text-slate-400 dark:text-slate-500">（best-effort）</span>}
      {manual && !ok && <span className="text-[11px] text-slate-400 dark:text-slate-500">{clickable ? '（点击确认）' : '（手动确认）'}</span>}
    </>
  )
  if (clickable) {
    return (
      <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 text-[13px] text-left hover:opacity-80 transition-opacity">
        {content}
      </button>
    )
  }
  return <div className="flex items-center gap-2.5 text-[13px]">{content}</div>
}

function smokeSummary(smoke: SmokeResult[]): string {
  const pass = smoke.filter((s) => s.status === 'pass').length
  const fail = smoke.filter((s) => s.status === 'fail').length
  const skip = smoke.filter((s) => s.status === 'skipped').length
  return [pass ? `${pass} 通过` : '', fail ? `${fail} 失败` : '', skip ? `${skip} 跳过` : ''].filter(Boolean).join(' / ') || '无可验证功能'
}

const CONF_META: Record<ConformanceIssue['level'], { label: string; cls: string; icon: React.ReactNode }> = {
  error: { label: '需修复', cls: 'text-rose-600 dark:text-rose-400', icon: <AlertTriangle size={12} className="text-rose-500" /> },
  warn: { label: '提示', cls: 'text-amber-600 dark:text-amber-400', icon: <AlertTriangle size={12} className="text-amber-500" /> },
  info: { label: '说明', cls: 'text-slate-500 dark:text-slate-400', icon: <Check size={12} className="text-slate-400" /> }
}

/** 契约一致性问题卡片：列出 error/warn/info，error 可一键让 AI 修复 */
function ConformanceCard({ conformance, confRepairing, onRepair, disabled }: {
  conformance: ConformanceResult; confRepairing: boolean; onRepair: () => void; disabled?: boolean
}) {
  const errors = conformance.issues.filter((i) => i.level === 'error')
  const others = conformance.issues.filter((i) => i.level !== 'error')
  const hasError = errors.length > 0
  const [open, setOpen] = useState(hasError)
  return (
    <div className={`rounded-xl border overflow-hidden ${hasError ? 'border-rose-500/30' : 'border-amber-500/25'}`}>
      <button className={`w-full px-4 py-2.5 flex items-center gap-2 ${hasError ? 'hover:bg-rose-500/5' : 'hover:bg-amber-500/5'}`} onClick={() => setOpen((v) => !v)}>
        <ShieldCheck size={15} className={hasError ? 'text-rose-500' : 'text-amber-500'} />
        <span className={`text-[13px] ${hasError ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-300'}`}>
          {hasError ? `契约一致性 · ${errors.length} 处需修复` : '契约一致性提示'}
        </span>
        {open ? <ChevronUp size={14} className="ml-auto text-slate-400" /> : <ChevronDown size={14} className="ml-auto text-slate-400" />}
      </button>
      {open && (
        <div className={`px-4 pb-4 pt-1 space-y-3 border-t ${hasError ? 'border-rose-500/15' : 'border-amber-500/15'}`}>
          <ul className="space-y-1.5">
            {[...errors, ...others].map((i, idx) => {
              const meta = CONF_META[i.level]
              return (
                <li key={idx} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-0.5 shrink-0">{meta.icon}</span>
                  <span className="min-w-0">
                    <span className={meta.cls}>{meta.label}</span>
                    <span className="text-slate-600 dark:text-slate-300"> · {i.message}</span>
                    {i.hint && <span className="block text-[11px] text-slate-400 dark:text-slate-500">建议：{i.hint}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          {hasError && (
            <button className="btn-primary" onClick={onRepair} disabled={disabled || confRepairing}>
              {confRepairing ? <Loader2 size={15} className="animate-spin" /> : <Wrench size={15} />} {confRepairing ? 'AI 修复中…' : 'AI 修复一致性问题'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const SMOKE_META: Record<SmokeResult['status'], { label: string; cls: string; icon: React.ReactNode }> = {
  pass: { label: '通过', cls: 'text-emerald-600 dark:text-emerald-400', icon: <Check size={12} className="text-emerald-500" /> },
  fail: { label: '失败', cls: 'text-rose-600 dark:text-rose-400', icon: <AlertTriangle size={12} className="text-rose-500" /> },
  skipped: { label: '跳过', cls: 'text-slate-500 dark:text-slate-400', icon: <ChevronRight size={12} className="text-slate-400" /> }
}

/** 运行验证结果列表：逐功能显示「用示例输入真实跑一次」的结果 */
function SmokeList({ smoke }: { smoke: SmokeResult[] }) {
  return (
    <ul className="space-y-1 pt-1 border-t border-emerald-500/20">
      {smoke.map((s) => {
        const meta = SMOKE_META[s.status]
        return (
          <li key={s.code} className="flex items-start gap-2 text-[12px]">
            <span className="mt-0.5 shrink-0">{meta.icon}</span>
            <span className="min-w-0">
              <span className={meta.cls}>{meta.label}</span>
              <span className="text-slate-600 dark:text-slate-300"> · {s.label}</span>
              <span className="text-slate-400 dark:text-slate-500 mono"> {s.code}</span>
              {s.status === 'fail' && s.error && <span className="block text-[11px] text-rose-500/90">{s.error}</span>}
              {s.status === 'skipped' && s.note && <span className="block text-[11px] text-slate-400 dark:text-slate-500">{s.note}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

const CHANGE_META: Record<VibeChange['status'], { label: string; cls: string }> = {
  added: { label: '新增', cls: 'text-emerald-600 dark:text-emerald-400' },
  modified: { label: '修改', cls: 'text-amber-600 dark:text-amber-400' },
  deleted: { label: '删除', cls: 'text-rose-600 dark:text-rose-400' }
}

/** 极简行级 diff：逐行比较 before/after，标注新增(+)/删除(-) */
function DiffView({ before, after }: { before: string | null; after: string | null }) {
  const a = (before ?? '').split('\n')
  const b = (after ?? '').split('\n')
  const max = Math.max(a.length, b.length)
  const rows: Array<{ sign: ' ' | '+' | '-'; text: string }> = []
  for (let i = 0; i < max && rows.length < 400; i++) {
    const la = a[i]
    const lb = b[i]
    if (la === lb) { if (la !== undefined) rows.push({ sign: ' ', text: la }) }
    else {
      if (la !== undefined) rows.push({ sign: '-', text: la })
      if (lb !== undefined) rows.push({ sign: '+', text: lb })
    }
  }
  return (
    <pre className="text-[11px] mono bg-black/5 dark:bg-black/30 rounded-lg p-2.5 max-h-72 overflow-auto leading-relaxed">
      {rows.map((r, i) => (
        <div key={i} className={
          r.sign === '+' ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
            : r.sign === '-' ? 'text-rose-600 dark:text-rose-400 bg-rose-500/5'
            : 'text-slate-500 dark:text-slate-400'
        }>{r.sign} {r.text}</div>
      ))}
    </pre>
  )
}

function relTime(iso: string): string {
  const t = Date.parse(iso)
  if (!isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

function VersionHistoryCard({ versions, vcsAvailable, restoringHash, disabled, onRefresh, onDiff, onRestore }: {
  versions: VcsCommit[]; vcsAvailable: boolean; restoringHash: string | null; disabled?: boolean
  onRefresh: () => void; onDiff: (hash: string) => Promise<string>; onRestore: (hash: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [expandedHash, setExpandedHash] = useState<string | null>(null)
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [confirmHash, setConfirmHash] = useState<string | null>(null)

  const toggleDiff = async (hash: string) => {
    if (expandedHash === hash) { setExpandedHash(null); return }
    setExpandedHash(hash); setDiffText(''); setDiffLoading(true)
    try { setDiffText(await onDiff(hash)) } finally { setDiffLoading(false) }
  }

  if (!vcsAvailable) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-[12px] text-slate-400 dark:text-slate-500 flex items-center gap-2">
        <History size={14} /> 版本历史不可用：系统未安装 git（安装后每次生成/迭代会自动记录版本，可回滚）。
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => { setOpen((v) => !v); if (!open) onRefresh() }}>
        <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <History size={14} className="text-indigo-500" /> 版本历史（{versions.length}）
        </span>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2">
          {versions.length === 0 ? (
            <div className="text-[12px] text-slate-400 dark:text-slate-500 py-2">暂无版本记录。生成/迭代/打包成功后会自动记录。</div>
          ) : versions.map((v, i) => (
            <div key={v.hash} className="rounded-lg border border-slate-200/70 dark:border-slate-800/70">
              <div className="flex items-center gap-2 px-3 py-2">
                <GitCommit size={13} className="shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-slate-700 dark:text-slate-200">{v.message}</span>
                  <span className="block text-[10px] text-slate-400 dark:text-slate-500 mono">
                    {v.short} · {relTime(v.dateISO)}{i === 0 ? ' · 当前' : ''}
                    {v.tags.map((t) => <span key={t} className="ml-1 inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400"><Tag size={9} />{t}</span>)}
                  </span>
                </span>
                <button className="btn-ghost !px-2 !py-1 text-[11px]" disabled={!!restoringHash} onClick={() => toggleDiff(v.hash)}>
                  {expandedHash === v.hash ? '收起' : '改动'}
                </button>
                {i !== 0 && (
                  confirmHash === v.hash ? (
                    <span className="flex items-center gap-1">
                      <button className="btn-danger !px-2 !py-1 text-[11px]" disabled={!!restoringHash || disabled} onClick={() => { setConfirmHash(null); onRestore(v.hash) }}>
                        {restoringHash === v.hash ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} 确认
                      </button>
                      <button className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => setConfirmHash(null)}>取消</button>
                    </span>
                  ) : (
                    <button className="btn-ghost !px-2 !py-1 text-[11px] text-indigo-600 dark:text-indigo-400" disabled={!!restoringHash || disabled} onClick={() => setConfirmHash(v.hash)}>
                      <RotateCcw size={12} /> 回滚
                    </button>
                  )
                )}
              </div>
              {expandedHash === v.hash && (
                <div className="px-3 pb-3 border-t border-slate-200/70 dark:border-slate-800/70">
                  {diffLoading ? (
                    <div className="py-3 text-[12px] text-slate-400 flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> 读取改动…</div>
                  ) : (
                    <pre className="text-[11px] mono bg-black/5 dark:bg-black/30 rounded-lg p-2.5 max-h-72 overflow-auto whitespace-pre-wrap mt-2">{diffText}</pre>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ChangesCard({ changes, rollingBack, onRollback, defaultOpen, disabled }: {
  changes: VibeChange[]; rollingBack: boolean; onRollback: () => void; defaultOpen?: boolean; disabled?: boolean
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const cur = changes.find((c) => c.path === selected) || changes[0] || null
  if (!changes.length) return null
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => setOpen((v) => !v)}>
        <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
          <FileEdit size={14} className="text-emerald-500" /> 本次改动（{changes.length} 个文件）
        </span>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {changes.map((c) => {
              const meta = CHANGE_META[c.status]
              const active = (cur?.path === c.path)
              return (
                <button key={c.path} onClick={() => setSelected(c.path)}
                  className={`text-[11px] mono px-2 py-1 rounded-md border transition-colors ${active ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'}`}>
                  <span className={meta.cls}>{meta.label}</span> {c.path}
                </button>
              )
            })}
          </div>
          {cur && (
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-400 dark:text-slate-500 mono flex items-center gap-2">
                <span className={CHANGE_META[cur.status].cls}>{CHANGE_META[cur.status].label}</span>
                <span className="truncate">{cur.path}</span>
                {cur.truncated && <span className="text-amber-500">（内容较大，已截断预览）</span>}
              </div>
              <DiffView before={cur.before} after={cur.after} />
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            {!confirming ? (
              <button className="btn-ghost text-rose-600 dark:text-rose-400" onClick={() => setConfirming(true)} disabled={disabled || rollingBack}>
                <RefreshCw size={14} /> 回滚本次全部改动
              </button>
            ) : (
              <>
                <span className="text-[12px] text-rose-600 dark:text-rose-400">确认回滚？新增文件将被删除、修改文件还原原状</span>
                <button className="btn-danger" onClick={() => { setConfirming(false); onRollback() }} disabled={disabled || rollingBack}>
                  {rollingBack ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} 确认回滚
                </button>
                <button className="btn-ghost" onClick={() => setConfirming(false)} disabled={rollingBack}>取消</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
