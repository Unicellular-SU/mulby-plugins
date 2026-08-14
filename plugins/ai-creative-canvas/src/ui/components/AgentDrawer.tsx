import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Bot, Check, ChevronRight, Circle, Clock3, History, Loader2, Pause,
  Play, Plus, RefreshCw, ShieldCheck, Sparkles, Square, Trash2, WandSparkles, X
} from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { useWorkflowUi } from '../store/workflowStore'
import { toast } from '../store/toastStore'
import { confirmDialog } from '../store/dialogStore'
import type { WorkflowRecipeId, WorkflowRun, WorkflowStep } from '../types'
import {
  listEnabledWorkflowSkills, planWorkflow, previewWorkflowSkills,
  type WorkflowPlanningInput
} from '../services/workflowPlanner'
import { getWorkflowRecipe, WORKFLOW_RECIPES } from '../services/workflowRecipes'
import { buildWorkflowGenerationPlan, type GenerationPlan } from '../services/generationPlan'
import {
  approveWorkflowCheckpoint, cancelWorkflow, pauseWorkflow, resumeWorkflow,
  retryWorkflowStep, workflowIsStale
} from '../services/workflowRunner'
import { Z } from '../zlayers'
import { Select } from './Select'
import { continuityLockWarnings } from '../services/workflowContinuity'

const STATUS_LABEL: Record<WorkflowRun['status'], string> = {
  planned: '待确认', running: '执行中', paused: '已暂停', completed: '已完成',
  error: '有错误', canceled: '已取消', stale: '源内容已变化'
}

function runTime(value: number): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  } catch {
    return ''
  }
}

function RunStatusIcon({ run }: { run: WorkflowRun }) {
  if (run.status === 'running') return <Loader2 size={13} className="animate-spin text-indigo-500" />
  if (run.status === 'completed') return <Check size={13} className="text-emerald-500" />
  if (run.status === 'error' || run.status === 'stale') return <AlertTriangle size={13} className="text-red-500" />
  if (run.status === 'canceled') return <Square size={12} className="opacity-45" />
  return <Clock3 size={13} className="text-amber-500" />
}

function AgentHistory({
  runs,
  onOpen,
  onDelete,
  onCreate,
  onClearFinished
}: {
  runs: WorkflowRun[]
  onOpen: (run: WorkflowRun) => void
  onDelete: (run: WorkflowRun) => void
  onCreate: () => void
  onClearFinished: () => void
}) {
  const pending = runs.filter((run) => run.status !== 'completed' && run.status !== 'canceled').length
  const finished = runs.filter((run) => run.status === 'completed' || run.status === 'canceled' || run.status === 'stale').length
  return <div className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div><div className="text-sm font-semibold">Agent 历史记录</div><div className="mt-0.5 text-[10px] opacity-50">共 {runs.length} 条 · {pending} 条待处理。删除记录不会删除已生成的画布卡片。</div></div>
      {finished > 0 && <button type="button" onClick={onClearFinished} className="shrink-0 text-[10px] text-red-500 hover:underline">清理已结束（{finished}）</button>}
    </div>
    {!runs.length ? <div className="rounded-xl border py-10 text-center" style={{ borderColor: 'var(--ace-border)' }}><History size={24} className="mx-auto opacity-25" /><div className="mt-2 text-xs opacity-50">当前工程还没有 Agent 记录</div><button type="button" onClick={onCreate} className="mt-4 h-8 px-3 rounded-md bg-indigo-500 text-white text-[11px] inline-flex items-center gap-1"><Plus size={12} />新建计划</button></div> : <div className="space-y-2">
      {runs.map((run) => {
        const recipe = getWorkflowRecipe(run.recipe)
        return <div key={run.id} className="group flex items-stretch rounded-xl border overflow-hidden hover:border-indigo-400/60" style={{ borderColor: 'var(--ace-border)' }}>
          <button type="button" onClick={() => onOpen(run)} className="min-w-0 flex-1 p-3 text-left hover:bg-black/[0.025] dark:hover:bg-white/[0.035]">
            <div className="flex items-center gap-2"><RunStatusIcon run={run} /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{run.brief.title || recipe.label}</span><span className="text-[10px] opacity-40">{runTime(run.updatedAt)}</span><ChevronRight size={12} className="opacity-30" /></div>
            <div className="ml-5 mt-1 text-[10px] opacity-50 line-clamp-2">{run.brief.summary || run.goal}</div>
            <div className="ml-5 mt-2 flex flex-wrap gap-1 text-[9px]"><span className="rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5">{recipe.shortLabel}</span><span className={`rounded px-1.5 py-0.5 ${run.status === 'error' || run.status === 'stale' ? 'bg-red-500/10 text-red-500' : run.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-black/5 dark:bg-white/10'}`}>{STATUS_LABEL[run.status]}</span><span className="rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5">{run.brief.aspect}</span><span className="rounded bg-black/5 dark:bg-white/10 px-1.5 py-0.5">{run.brief.totalDuration}s · {run.brief.shots.length} 镜</span></div>
          </button>
          <button type="button" onClick={() => onDelete(run)} title="删除此 Agent 记录" className="w-10 shrink-0 grid place-items-center border-l text-red-500 opacity-55 hover:opacity-100 hover:bg-red-500/10" style={{ borderColor: 'var(--ace-border)' }}><Trash2 size={13} /></button>
        </div>
      })}
    </div>}
  </div>
}

function StepIcon({ step }: { step: WorkflowStep }) {
  if (step.status === 'completed') return <Check size={13} className="text-emerald-500" />
  if (step.status === 'running') return <Loader2 size={13} className="animate-spin text-indigo-500" />
  if (step.status === 'checkpoint') return <ShieldCheck size={13} className="text-amber-500" />
  if (step.status === 'error') return <AlertTriangle size={13} className="text-red-500" />
  return <Circle size={11} className="opacity-35" />
}

function PlanSummary({ plan }: { plan: GenerationPlan | null }) {
  if (!plan) return <div className="text-[11px] opacity-45">正在计算生成规模与能力约束…</div>
  const notices = plan.issues.filter((issue) => issue.level === 'error' || issue.level === 'warning')
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="flex items-center justify-between text-xs"><span className="font-semibold">生成计划</span><span className="opacity-60">约 {plan.taskCount} 个任务</span></div>
      <div className="mt-1.5 text-[11px] opacity-60">
        费用：{plan.estimatedCost != null && plan.currency ? `${plan.currency} ${plan.estimatedCost.toFixed(4)}` : plan.costStatus === 'partial' ? '部分可估算' : '未知'}
      </div>
      {notices.length > 0 && <div className="mt-2 space-y-1">{notices.map((issue, index) => <div key={index} className={`text-[10px] ${issue.level === 'error' ? 'text-red-500' : 'text-amber-600 dark:text-amber-300'}`}>• {issue.message}</div>)}</div>}
      {plan.costStatus !== 'known' && <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-300">未声明单价的模型不会伪造费用，请以服务商账单为准。</div>}
    </div>
  )
}

export function AgentDrawer() {
  const show = useUi((state) => state.showAgent)
  const project = useGraph((state) => state.project)
  const selectedRunId = useWorkflowUi((state) => state.selectedRunId)
  const showHistory = useWorkflowUi((state) => state.showHistory)
  const planning = useWorkflowUi((state) => state.planning)
  const selectedRun = selectedRunId ? project.workflowRuns?.[selectedRunId] || null : null
  const runs = useMemo(() => Object.values(project.workflowRuns || {}).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt), [project.workflowRuns])
  const sourceCards = useMemo(() => project.boards.flatMap((board) => Object.values(board.cards).filter((card) => card.kind === 'text').map((card) => ({ card, board }))), [project.boards])
  const selectedText = useGraph((state) => state.selectedIds.map((id) => state.getCard(id)).find((card) => card?.kind === 'text')?.id || '')
  const [recipeId, setRecipeId] = useState<WorkflowRecipeId>('script-to-short-film')
  const [sourceCardId, setSourceCardId] = useState('')
  const [goal, setGoal] = useState(getWorkflowRecipe('script-to-short-film').defaultGoal)
  const [audience, setAudience] = useState('')
  const [aspect, setAspect] = useState('16:9')
  const [duration, setDuration] = useState(getWorkflowRecipe('script-to-short-film').defaultDuration)
  const [ending, setEnding] = useState(getWorkflowRecipe('script-to-short-film').defaultEnding)
  const [skills, setSkills] = useState<AiSkillRecord[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([])
  const [skillPreview, setSkillPreview] = useState<AiSkillPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [generationPlan, setGenerationPlan] = useState<GenerationPlan | null>(null)
  const recipe = getWorkflowRecipe(recipeId)

  useEffect(() => {
    if (!show) return
    if (!sourceCardId) setSourceCardId(selectedText || sourceCards[0]?.card.id || '')
    void listEnabledWorkflowSkills().then(setSkills)
  }, [show, selectedText, sourceCardId, sourceCards])

  useEffect(() => {
    let alive = true
    setGenerationPlan(null)
    if (selectedRun) void buildWorkflowGenerationPlan(selectedRun).then((plan) => { if (alive) setGenerationPlan(plan) })
    return () => { alive = false }
  }, [selectedRun])

  if (!show) return null
  const close = () => useUi.getState().setShowAgent(false)
  const createInput = (): WorkflowPlanningInput | null => {
    const entry = sourceCards.find(({ card }) => card.id === sourceCardId)
    if (!entry) return null
    return {
      recipe: recipeId, sourceCard: entry.card, sourceBoardId: entry.board.id, project, goal,
      audience: audience || undefined, aspect, totalDuration: duration, ending: ending || undefined,
      selectedSkillIds
    }
  }
  const startPlanning = async () => {
    const input = createInput()
    if (!input) return toast(`请先选择${recipe.sourceLabel}`, 'error')
    useWorkflowUi.getState().setPlanning(true)
    try {
      const run = await planWorkflow(input)
      useGraph.getState().upsertWorkflowRun(run)
      useWorkflowUi.getState().setSelectedRunId(run.id)
      useWorkflowUi.getState().setShowHistory(false)
      toast('创作计划已生成，请确认后开始', 'success')
    } catch (error: any) {
      toast(error?.message || String(error), 'error')
    } finally {
      useWorkflowUi.getState().setPlanning(false)
    }
  }
  const previewSkills = async () => {
    const input = createInput()
    if (!input || !selectedSkillIds.length) return
    setPreviewing(true)
    setSkillPreview(await previewWorkflowSkills(input))
    setPreviewing(false)
  }
  const selectRecipe = (nextId: WorkflowRecipeId) => {
    const next = getWorkflowRecipe(nextId)
    setRecipeId(nextId)
    setGoal(next.defaultGoal)
    setDuration(next.defaultDuration)
    setEnding(next.defaultEnding)
    setSkillPreview(null)
  }
  const newPlan = () => {
    if (selectedRun) selectRecipe(selectedRun.recipe)
    useWorkflowUi.getState().setSelectedRunId(null)
    useWorkflowUi.getState().setShowHistory(false)
    setGenerationPlan(null)
  }
  const openHistory = () => {
    useWorkflowUi.getState().setSelectedRunId(null)
    useWorkflowUi.getState().setShowHistory(true)
    setGenerationPlan(null)
  }
  const openRun = (run: WorkflowRun) => {
    useWorkflowUi.getState().setSelectedRunId(run.id)
    useWorkflowUi.getState().setShowHistory(false)
  }
  const deleteRun = async (run: WorkflowRun) => {
    const active = run.status === 'running'
    const ok = await confirmDialog({
      title: active ? '取消并删除 Agent 记录' : '删除 Agent 记录',
      message: active ? '该工作流仍在执行。删除前会先取消正在运行的任务；已经生成的画布卡片会保留。继续？' : '只删除这条计划、步骤状态和日志；已经生成的画布卡片会保留。继续？',
      confirmLabel: active ? '取消并删除' : '删除记录',
      cancelLabel: '保留',
      danger: true
    })
    if (!ok) return
    if (active) await cancelWorkflow(run.id)
    useGraph.getState().removeWorkflowRun(run.id)
    if (useWorkflowUi.getState().selectedRunId === run.id) useWorkflowUi.getState().setSelectedRunId(null)
    useWorkflowUi.getState().setShowHistory(true)
    toast('Agent 记录已删除，画布产物已保留', 'success')
  }
  const clearFinished = async () => {
    const targets = runs.filter((run) => run.status === 'completed' || run.status === 'canceled' || run.status === 'stale')
    if (!targets.length) return
    const ok = await confirmDialog({ title: '清理已结束的 Agent 记录', message: `将删除 ${targets.length} 条已完成、已取消或已失效的记录；画布卡片和媒体产物会保留。`, confirmLabel: `删除 ${targets.length} 条记录`, cancelLabel: '取消', danger: true })
    if (!ok) return
    for (const run of targets) useGraph.getState().removeWorkflowRun(run.id)
    if (targets.some((run) => run.id === useWorkflowUi.getState().selectedRunId)) useWorkflowUi.getState().setSelectedRunId(null)
    toast(`已清理 ${targets.length} 条 Agent 记录`, 'success')
  }

  return (
    <aside data-interactive className={`fixed right-0 top-11 bottom-0 ${Z.panel} w-[460px] max-w-[92vw] ace-glass border-l flex flex-col ace-anim-scale`} style={{ borderColor: 'var(--ace-border)' }}>
      <header className="h-12 px-4 border-b flex items-center gap-2 shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
        <Bot size={17} className="text-indigo-500" />
        <div className="font-semibold text-sm">创作 Agent</div>
        <span className="text-[10px] opacity-45">受控配方 · 可暂停恢复</span>
        <div className="flex-1" />
        <button type="button" onClick={openHistory} className={`h-7 px-2 rounded-md text-[11px] inline-flex items-center gap-1 ${showHistory && !selectedRun ? 'bg-indigo-500/10 text-indigo-500' : 'opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10'}`}><History size={12} />历史{runs.length > 0 ? ` ${runs.length}` : ''}</button>
        {(selectedRun || showHistory) && <button type="button" onClick={newPlan} className="h-7 px-2 rounded-md text-[11px] text-indigo-500 hover:bg-indigo-500/10 inline-flex items-center gap-1"><Plus size={12} />新计划</button>}
        <button type="button" onClick={close} className="w-7 h-7 grid place-items-center opacity-60 hover:opacity-100"><X size={16} /></button>
      </header>
      <div className="flex-1 overflow-auto ace-scroll p-4">
        {showHistory && !selectedRun ? <AgentHistory runs={runs} onOpen={openRun} onDelete={(run) => void deleteRun(run)} onCreate={newPlan} onClearFinished={() => void clearFinished()} /> : !selectedRun ? (
          <div className="space-y-4">
            <div>
              <div className="text-[11px] opacity-55 mb-1.5">Canvas Recipe</div>
              <div className="grid grid-cols-2 gap-2">
                {WORKFLOW_RECIPES.map((item) => <button key={item.id} type="button" aria-pressed={recipeId === item.id} onClick={() => selectRecipe(item.id)} className={`rounded-lg border p-2.5 text-left transition-colors ${recipeId === item.id ? 'border-indigo-500 bg-indigo-500/[0.08]' : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'}`} style={recipeId === item.id ? undefined : { borderColor: 'var(--ace-border)' }}><span className="block text-xs font-semibold">{item.label}</span><span className="mt-1 block text-[10px] leading-relaxed opacity-50 line-clamp-2">{item.description}</span></button>)}
              </div>
            </div>
            <div className="rounded-xl bg-indigo-500/[0.08] p-3 text-xs leading-relaxed"><div className="font-semibold flex items-center gap-1.5"><WandSparkles size={14} />{recipe.label}</div><div className="mt-1 opacity-65">{recipe.description} AI 只生成结构化规格和镜头草案；画布操作仍由九个本地白名单动作执行。</div></div>
            <label className="block text-[11px]"><span className="opacity-55">{recipe.sourceLabel}</span><Select className="mt-1" value={sourceCardId} onChange={setSourceCardId} placeholder={recipe.sourcePlaceholder} options={sourceCards.map(({ card, board }) => ({ value: card.id, label: card.title || '未命名文本', hint: board.name }))} /></label>
            <label className="block text-[11px]"><span className="opacity-55">创作目标</span><textarea className="ace-input mt-1 resize-none" rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px]"><span className="opacity-55">目标受众（可选）</span><input className="ace-input mt-1" value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="例如：年轻职场人" /></label>
              <label className="text-[11px]"><span className="opacity-55">画幅</span><select className="ace-input mt-1" value={aspect} onChange={(event) => setAspect(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option></select></label>
              <label className="text-[11px]"><span className="opacity-55">目标总时长（秒）</span><input className="ace-input mt-1" type="number" min="5" max="600" value={duration} onChange={(event) => setDuration(Math.max(5, Number(event.target.value) || recipe.defaultDuration))} /></label>
              <label className="text-[11px]"><span className="opacity-55">结尾要求（可选）</span><input className="ace-input mt-1" value={ending} onChange={(event) => setEnding(event.target.value)} placeholder={recipe.endingPlaceholder} /></label>
            </div>
            <section className="rounded-lg border p-3" style={{ borderColor: 'var(--ace-border)' }}>
              <div className="flex items-center justify-between"><div><div className="text-xs font-semibold">Mulby Skills</div><div className="text-[10px] opacity-45 mt-0.5">手动选择，只增强策划提示；不会开放 MCP 或内部工具。</div></div>{selectedSkillIds.length > 0 && <button type="button" disabled={previewing} onClick={() => void previewSkills()} className="text-[11px] text-indigo-500">{previewing ? '预览中…' : '预览影响'}</button>}</div>
              <div className="mt-2 max-h-36 overflow-auto ace-scroll space-y-1">
                {!skills.length && <div className="text-[11px] opacity-40 py-2">当前没有已启用 Skill，可直接使用固定导演规则。</div>}
                {skills.map((skill) => <label key={skill.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 text-[11px]"><input type="checkbox" className="mt-0.5" checked={selectedSkillIds.includes(skill.id)} onChange={(event) => setSelectedSkillIds((ids) => event.target.checked ? [...ids, skill.id] : ids.filter((id) => id !== skill.id))} /><span><span className="font-medium">{skill.descriptor.name}</span><span className="block opacity-50 line-clamp-2">{skill.descriptor.description || skill.id}</span></span></label>)}
              </div>
              {skillPreview && <div className="mt-2 rounded-md bg-black/[0.03] dark:bg-white/[0.04] p-2 text-[10px]"><div className="font-medium">将使用：{skillPreview.selected.map((skill) => skill.descriptor.name).join('、') || '无'}</div>{skillPreview.reasons.map((reason, index) => <div key={index} className="mt-0.5 opacity-55">• {reason}</div>)}<div className="mt-1 text-emerald-600 dark:text-emerald-300">安全边界：MCP 关闭、内部工具关闭，Skill 仅注入策划知识。</div></div>}
            </section>
            <button type="button" disabled={planning || !sourceCardId} onClick={() => void startPlanning()} className="w-full h-11 rounded-lg bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40">{planning ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{planning ? '正在生成结构化计划…' : '生成执行计划'}</button>
          </div>
        ) : (
          <RunDetail run={selectedRun} plan={generationPlan} onNewPlan={newPlan} onDelete={() => void deleteRun(selectedRun)} />
        )}
      </div>
    </aside>
  )
}

function RunDetail({ run, plan, onNewPlan, onDelete }: { run: WorkflowRun; plan: GenerationPlan | null; onNewPlan: () => void; onDelete: () => void }) {
  const recipe = getWorkflowRecipe(run.recipe)
  const stale = workflowIsStale(run)
  const checkpoint = run.steps.find((step) => step.status === 'checkpoint')
  const errorStep = run.steps.find((step) => step.status === 'error')
  const active = run.status === 'running'
  const lockWarnings = checkpoint?.command === 'lock_continuity' ? continuityLockWarnings(run) : []
  const videoCheckpointBlocked = checkpoint?.command === 'create_videos' && (!plan || plan.issues.some((issue) => issue.level === 'error' && /视频|Provider|画幅|镜头/.test(issue.message)))
  const rerun = async (step: WorkflowStep) => {
    const ok = await confirmDialog({ title: '重跑工作流步骤', message: `将从「${step.title}」开始重跑，并把后续步骤恢复为待执行；已生成的卡片会复用，不会重复铺卡。继续？`, confirmLabel: '重跑', cancelLabel: '取消' })
    if (!ok) return
    retryWorkflowStep(run.id, step.id)
    void resumeWorkflow(run.id)
  }
  return <div className="space-y-4">
    <div>
      <div className="mb-1 text-[10px] text-indigo-500">{recipe.label}</div>
      <div className="flex items-center gap-2"><div className="text-base font-semibold flex-1">{run.brief.title}</div><span className={`text-[10px] px-2 py-0.5 rounded-full ${run.status === 'error' || stale ? 'bg-red-500/10 text-red-500' : active ? 'bg-indigo-500/10 text-indigo-500' : 'bg-black/5 dark:bg-white/10'}`}>{stale ? '源内容已变化' : STATUS_LABEL[run.status]}</span></div>
      <div className="mt-1 text-xs opacity-60 leading-relaxed">{run.brief.summary || run.goal}</div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]"><span className="px-2 py-1 rounded bg-black/5 dark:bg-white/10">{run.brief.audience}</span><span className="px-2 py-1 rounded bg-black/5 dark:bg-white/10">{run.brief.aspect}</span><span className="px-2 py-1 rounded bg-black/5 dark:bg-white/10">目标成片 {run.brief.totalDuration}s</span><span className="px-2 py-1 rounded bg-black/5 dark:bg-white/10">{run.brief.shots.length} 镜</span></div>
    </div>
    {stale && <div className="rounded-lg bg-red-500/10 text-red-600 dark:text-red-300 p-3 text-xs"><div className="font-semibold">源文本已修改</div><div className="mt-1 opacity-70">当前计划已被冻结，防止按旧内容继续生成。请新建计划。</div></div>}
    {run.brief.product && <div className="rounded-lg border p-3 text-[11px]" style={{ borderColor: 'var(--ace-border)' }}><div className="flex items-center justify-between gap-2"><span className="font-semibold">{run.brief.product.productName}</span><span className="opacity-45">{run.brief.product.campaignObjective}</span></div>{run.brief.product.brandText && <div className="mt-1.5 text-[10px] text-indigo-600 dark:text-indigo-300"><span className="opacity-60">品牌文字锁：</span>{run.brief.product.brandText}</div>}<div className="mt-1.5 leading-relaxed"><span className="opacity-45">核心主张：</span>{run.brief.product.coreProposition || '待补充'}</div>{run.brief.product.sellingPoints.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{run.brief.product.sellingPoints.map((item, index) => <span key={`${item}-${index}`} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-300">{item}</span>)}</div>}{run.brief.product.mandatoryElements.length > 0 && <div className="mt-2 text-[10px]"><span className="opacity-45">必须保留：</span>{run.brief.product.mandatoryElements.join('、')}</div>}<div className="mt-1 text-[10px]"><span className="opacity-45">CTA：</span>{run.brief.product.callToAction || run.brief.ending}</div></div>}
    {!!run.brief.anchorSuggestions.length && <div><div className="text-xs font-semibold">建议语义锚点</div><div className="mt-2 flex flex-wrap gap-1.5">{run.brief.anchorSuggestions.map((anchor, index) => <span key={`${anchor.name}-${index}`} title={anchor.description} className="text-[10px] px-2 py-1 rounded-full border" style={{ borderColor: 'var(--ace-border)' }}>{anchor.role} · {anchor.name}</span>)}</div></div>}
    <PlanSummary plan={plan} />
    <div>
      <div className="text-xs font-semibold mb-2">执行步骤</div>
      <div className="space-y-1">
        {run.steps.map((step, index) => <div key={step.id} className={`rounded-lg border px-3 py-2 ${step.status === 'checkpoint' ? 'border-amber-400 bg-amber-500/[0.06]' : step.status === 'error' ? 'border-red-400/60 bg-red-500/[0.05]' : ''}`} style={step.status === 'checkpoint' || step.status === 'error' ? undefined : { borderColor: 'var(--ace-border)' }}><div className="flex items-center gap-2"><StepIcon step={step} /><span className="text-[11px] opacity-45">{index + 1}</span><span className="text-xs font-medium flex-1">{step.title}</span>{step.outputCardIds.length > 0 && <span className="text-[10px] opacity-45">{step.outputCardIds.length} 卡片</span>}{!active && (step.status === 'completed' || step.status === 'error') && <button type="button" onClick={() => void rerun(step)} className="w-6 h-6 grid place-items-center rounded hover:bg-black/5 dark:hover:bg-white/10" title="从此步骤重跑"><RefreshCw size={11} /></button>}</div><div className="ml-8 mt-0.5 text-[10px] opacity-50">{step.description}</div>{step.error && <div className="ml-8 mt-1 text-[10px] text-red-500">{step.error}</div>}</div>)}
      </div>
    </div>
    {checkpoint && <div className="rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-xs"><div className="font-semibold">需要你确认：{checkpoint.title}</div><div className="mt-1 opacity-70">{checkpoint.command === 'save_storyboard' ? '确认创作规格后会先准备角色、场景和道具的统一视觉设定。' : checkpoint.command === 'lock_continuity' ? '请检查画布中的设定图；可替换素材或重新生成。不满意不要确认，确认后当前人物、产品、道具和场景外观会被锁定，并作为相关镜头的共同参考。' : '请检查画布中的静帧；确认后才会创建并提交视频任务。'}</div>{lockWarnings.map((message) => <div key={message} className="mt-2 rounded bg-white/40 dark:bg-black/15 px-2 py-1.5 text-[10px] leading-relaxed">• {message}</div>)}</div>}
    <div className="grid grid-cols-2 gap-2">
      {stale ? <button type="button" onClick={onNewPlan} className="col-span-2 h-10 rounded-lg bg-indigo-500 text-white text-xs font-semibold">按新内容创建计划</button> : checkpoint || run.status === 'planned' ? <button type="button" disabled={videoCheckpointBlocked} onClick={() => void approveWorkflowCheckpoint(run.id)} className="col-span-2 h-10 rounded-lg bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40"><ShieldCheck size={14} />{videoCheckpointBlocked ? (plan ? '请先修复视频生成计划' : '正在检查视频生成计划…') : '确认并继续'}</button> : errorStep ? <button type="button" onClick={() => { retryWorkflowStep(run.id, errorStep.id); void resumeWorkflow(run.id) }} className="col-span-2 h-10 rounded-lg bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"><RefreshCw size={14} />修复后重试此步骤</button> : active ? <button type="button" onClick={() => pauseWorkflow(run.id)} className="col-span-2 h-10 rounded-lg bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"><Pause size={14} />暂停</button> : run.status !== 'completed' && run.status !== 'canceled' ? <button type="button" onClick={() => void resumeWorkflow(run.id)} className="col-span-2 h-10 rounded-lg bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"><Play size={14} />继续执行</button> : null}
      {run.status !== 'completed' && run.status !== 'canceled' && <button type="button" onClick={() => void cancelWorkflow(run.id)} className="h-8 rounded-md bg-black/5 dark:bg-white/10 text-[11px] flex items-center justify-center gap-1"><Square size={11} />取消工作流</button>}
      <button type="button" onClick={onDelete} className="h-8 rounded-md text-red-500 hover:bg-red-500/10 text-[11px] flex items-center justify-center gap-1"><Trash2 size={12} />删除记录</button>
    </div>
    {!!run.logs.length && <details><summary className="text-[11px] opacity-55 cursor-pointer">最近日志</summary><div className="mt-2 space-y-1">{run.logs.slice(-10).reverse().map((entry) => <div key={entry.id} className="flex gap-2 text-[10px]"><Clock3 size={10} className="mt-0.5 opacity-35 shrink-0" /><span className={entry.level === 'error' ? 'text-red-500' : 'opacity-55'}>{entry.message}</span></div>)}</div></details>}
  </div>
}
