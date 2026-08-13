import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clapperboard, Image as ImageIcon, Loader2, RefreshCcw, Sparkles, Type, X } from 'lucide-react'
import { useEscClose } from '../hooks'
import { useGraph } from '../store/graphStore'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
import {
  buildDirectorPromptContext,
  compileDirectorPrompt,
  generateDirectorPrompt,
  missingDirectorMentionTokens,
  readDirectorPrompt,
  type DirectorPromptDraft
} from '../services/directorPrompt'

export function DirectorPromptModal() {
  const cardId = useUi((state) => state.directorPromptCardId)
  const close = () => useUi.getState().setDirectorPromptCardId(null)
  useEscClose(close, !!cardId)
  if (!cardId) return null
  return <DirectorPromptInner key={cardId} cardId={cardId} onClose={close} />
}

function DirectorPromptInner({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const project = useGraph((state) => state.project)
  const card = project.boards.flatMap((board) => Object.values(board.cards)).find((item) => item.id === cardId)
  const board = project.boards.find((item) => item.cards[cardId])
  const provider = useProviders((state) => state.activeFor('video'))
  const updateCard = useGraph((state) => state.updateCard)
  const initial = readDirectorPrompt(card?.meta)
  const [draft, setDraft] = useState<DirectorPromptDraft | null>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = useRef(false)
  const context = useMemo(
    () => card && board ? buildDirectorPromptContext(card, board, project, provider) : null,
    [board, card, project, provider]
  )
  const stale = !!draft && !!context && draft.contextFingerprint !== context.fingerprint
  const missingMentions = draft ? missingDirectorMentionTokens(card?.prompt || '', draft.localPrompt) : []
  const capabilityIssue = context
    ? !context.provider.id
      ? '尚未配置视频 Provider；可先分析或写回补充要求，但不能把导演方案应用到当前视频卡。'
      : context.imageInputs.length && !context.provider.imageToVideo
        ? '当前 Provider 不支持图生视频，请更换 Provider 或移除参考图。'
        : !context.imageInputs.length && !context.provider.textToVideo
          ? '当前 Provider 仅支持图生视频，请添加参考图。'
          : context.params.refMode === 'keyframe' && context.imageInputs.length > 1 && !context.provider.lastFrame
            ? '当前 Provider 不支持尾帧输入，请改为全能参考或更换 Provider。'
            : ''
    : ''

  const run = useCallback(async () => {
    if (!card || !board) return
    setBusy(true)
    setError('')
    try {
      const result = await generateDirectorPrompt(card, board, project, provider)
      setDraft(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [board, card, project, provider])

  useEffect(() => {
    if (started.current || draft || !card || !board) return
    started.current = true
    void run()
  }, [board, card, draft, run])

  useEffect(() => {
    if (!card || !board) onClose()
  }, [board, card, onClose])

  if (!card || !board || !context) return null

  const updateDraft = (patch: Partial<DirectorPromptDraft>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const applyToCurrentCard = () => {
    if (!draft || stale || !draft.compiledPrompt.trim()) return
    useGraph.getState().pushHistory()
    updateCard(card.id, { meta: { ...(card.meta || {}), directorPrompt: draft } })
    toast('导演方案已应用；请在视频卡点击“使用导演方案生成”', 'success')
    onClose()
  }
  const replaceLocalPrompt = () => {
    if (!draft?.localPrompt.trim() || missingMentions.length) return
    const meta = { ...(card.meta || {}) }
    delete meta.directorPrompt
    useGraph.getState().pushHistory()
    updateCard(card.id, { prompt: draft.localPrompt.trim(), meta })
    toast('已替换本节点补充要求', 'success')
    onClose()
  }
  const discardStored = () => {
    const meta = { ...(card.meta || {}) }
    delete meta.directorPrompt
    useGraph.getState().pushHistory()
    updateCard(card.id, { meta })
    setDraft(null)
    started.current = true
  }
  const planRows = draft ? [
    ['可见行动', draft.plan.visibleAction],
    ['摄影机', [draft.plan.cameraPosition, draft.plan.lensAndScale].filter(Boolean).join('；')],
    ['视觉流向', draft.plan.visualFlow],
    ['时间变化', draft.plan.temporalArc],
    ['运动设计', [draft.plan.subjectMotion, draft.plan.environmentMotion, draft.plan.cameraMotion].filter(Boolean).join('；')],
    ['光线', draft.plan.practicalLight],
    ['色彩', draft.plan.colorThesis]
  ].filter(([, value]) => value) : []

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div data-interactive className="ace-dialog ace-anim-scale w-[min(1120px,96vw)] h-[min(860px,92vh)] flex flex-col text-neutral-800 dark:text-neutral-200 overflow-hidden">
        <header className="px-4 py-3 border-b flex items-center gap-3 shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
          <span className="w-8 h-8 rounded-lg bg-indigo-500/12 text-indigo-500 grid place-items-center"><Clapperboard size={17} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">导演增强 · {card.title}</div>
            <div className="text-[10px] opacity-50 mt-0.5">从实际上下文生成单段视频镜头计划，不会直接覆盖原始输入</div>
          </div>
          {draft && !stale && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-300"><CheckCircle2 size={13} />上下文一致</span>}
          {stale && <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300"><AlertTriangle size={13} />已过期</span>}
          <button type="button" onClick={onClose} className="w-8 h-8 grid place-items-center opacity-55 hover:opacity-100"><X size={18} /></button>
        </header>

        <div className="px-4 py-2.5 border-b flex flex-wrap items-center gap-2 text-[10px] shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
          <span className="opacity-50">本次上下文：</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-2 py-1"><Type size={11} />{context.textInputs.length} 段上游文本</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 px-2 py-1"><ImageIcon size={11} />{context.imageInputs.length} 张参考图</span>
          <span className="rounded-full bg-pink-500/10 text-pink-700 dark:text-pink-300 px-2 py-1">风格：{context.style.label}</span>
          <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-1">{context.params.aspect} · {context.params.duration}s{context.params.camera ? ` · ${context.params.camera}` : ''}</span>
          <span className="rounded-full bg-black/5 dark:bg-white/10 px-2 py-1">{context.provider.label}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto ace-scroll p-4">
          {capabilityIssue && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-[11px] mb-3">{capabilityIssue}</div>}
          {busy && !draft ? (
            <div className="h-full grid place-items-center text-center">
              <div><Loader2 size={28} className="animate-spin text-indigo-500 mx-auto" /><div className="mt-3 text-sm font-medium">正在分析素材、关系与镜头运动…</div><div className="mt-1 text-xs opacity-45">参考图会作为视觉输入，而不是只转换成文字标签</div></div>
            </div>
          ) : (
            <div className="grid grid-cols-[minmax(280px,0.8fr)_minmax(420px,1.35fr)] gap-4 min-h-full">
              <div className="space-y-4 min-w-0">
                <section>
                  <div className="text-xs font-semibold mb-2">原始内容输入</div>
                  <div className="rounded-lg border p-3 text-[11px] whitespace-pre-wrap break-words leading-relaxed max-h-48 overflow-auto ace-scroll" style={{ borderColor: 'var(--ace-border)' }}>{context.resolvedPrompt || '（仅参考图）'}</div>
                </section>
                {draft && (
                  <section>
                    <div className="text-xs font-semibold mb-2">建议的本节点补充要求</div>
                    <textarea
                      value={draft.localPrompt}
                      onChange={(event) => {
                        const localPrompt = event.target.value
                        updateDraft({ localPrompt, compiledPrompt: compileDirectorPrompt(card, board, context, localPrompt, draft.plan, project) })
                      }}
                      rows={7}
                      className="ace-input ace-scroll resize-y w-full text-[11px] leading-relaxed"
                    />
                    <div className="mt-1 text-[10px] opacity-45">这部分不复制上游文本、素材名和风格包，只会写回左侧的本节点补充要求。</div>
                    {!!missingMentions.length && <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-300">不能写回补充要求：缺少 @{missingMentions.join('、@')} 素材选择。应用完整导演方案时仍会安全保留原选择。</div>}
                  </section>
                )}
                {!!planRows.length && (
                  <section>
                    <div className="text-xs font-semibold mb-2">导演判断</div>
                    <div className="space-y-1.5">
                      {planRows.map(([label, value]) => <div key={label} className="rounded-lg bg-black/[0.035] dark:bg-white/[0.045] p-2.5 text-[11px]"><div className="opacity-45 mb-0.5">{label}</div><div className="leading-relaxed">{value}</div></div>)}
                    </div>
                  </section>
                )}
              </div>

              <div className="min-w-0 flex flex-col">
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-xs font-semibold">编译后的最终视频提示词</div>
                  {draft && <span className="text-[10px] opacity-40">{draft.compiledPrompt.length} 字</span>}
                  <button type="button" onClick={() => void run()} disabled={busy} className="ml-auto inline-flex items-center gap-1 text-[11px] text-indigo-500 disabled:opacity-40"><RefreshCcw size={12} className={busy ? 'animate-spin' : ''} />重新分析</button>
                </div>
                {error && <div className="rounded-lg border border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300 p-3 text-xs mb-3">{error}</div>}
                {stale && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300 p-3 text-[11px] mb-3">素材、风格、参数或 Provider 已变化。请重新分析后再应用到当前视频卡。</div>}
                {draft ? (
                  <textarea value={draft.compiledPrompt} onChange={(event) => updateDraft({ compiledPrompt: event.target.value })} className="ace-input ace-scroll resize-none flex-1 min-h-[440px] w-full font-mono text-[11px] leading-relaxed" />
                ) : !busy && (
                  <div className="flex-1 min-h-[360px] rounded-lg border border-dashed grid place-items-center text-center text-xs opacity-50" style={{ borderColor: 'var(--ace-border)' }}>
                    <div><Sparkles size={22} className="mx-auto mb-2" /><div>尚未生成导演计划</div><button type="button" onClick={() => void run()} className="mt-3 px-3 py-1.5 rounded-md bg-indigo-500 text-white opacity-100">开始分析</button></div>
                  </div>
                )}
                {draft && draft.contextSummary.imageCount > draft.contextSummary.usedVisualImages && (
                  <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-300">有 {draft.contextSummary.imageCount - draft.contextSummary.usedVisualImages} 张参考图未能读取，已仅根据其角色标签进行规划。</div>
                )}
              </div>
            </div>
          )}
        </div>

        <footer className="px-4 py-3 border-t flex items-center gap-2 shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
          {initial && <button type="button" onClick={discardStored} className="text-xs text-red-500 hover:bg-red-500/10 px-3 py-1.5 rounded-md">移除已应用方案</button>}
          <span className="flex-1 text-right text-[10px] opacity-45">应用不会立即提交任务；返回视频卡后再点击生成</span>
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 text-xs">关闭</button>
          <button type="button" onClick={replaceLocalPrompt} disabled={!draft?.localPrompt.trim() || busy || !!missingMentions.length} title="只写回左侧的本节点补充要求，不包含上游文本、风格和参数" className="px-3 py-1.5 rounded-md bg-black/5 dark:bg-white/10 text-xs disabled:opacity-35">写回补充要求</button>
          <button type="button" onClick={applyToCurrentCard} disabled={!draft || stale || busy || !!capabilityIssue || !draft.compiledPrompt.trim()} title="应用后返回当前视频卡，再点击“使用导演方案生成”" className="px-4 py-1.5 rounded-md bg-indigo-500 hover:bg-indigo-600 text-white text-xs disabled:opacity-35">应用到本次生成</button>
        </footer>
      </div>
    </div>
  )
}
