/**
 * 工作台 · 分阶段编辑器：顶栏（项目设置）+ 阶段 Tab（剧本/资产/分镜/时间线）+ Agent 对话面板占位。
 * 阶段2c 骨架：剧本 Tab 已可编辑落盘；资产/分镜/时间线为列表+新增占位，生成与 Agent 在阶段3 接入。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileText, Users, Clapperboard, Film, Bot, Plus, Wand2, Loader2, AlertCircle, AlertTriangle, Trash2, Link2, BookOpen, Settings2, Settings, PanelLeft, ChevronUp, ChevronDown, X, Check, Download, Image as ImageIcon, RotateCcw, BookmarkPlus, Pencil, PauseCircle, PlayCircle, Search } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { useGraphStore } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { useAssetHubStore } from '../store/assetHubStore'
import { DND_ASSET, DND_ELEMENT } from '../components/NodeLibrary'
import { listStylePacks } from '../services/stylePacks'
import { useMediaUrl } from '../services/mediaUrl'
import { libraryEntityToElement, projectAssetIdentityUsageFromHub, type IdentityAssetUsage } from '../services/assetHub'
import { assetHubEntityVersionStatus } from '../services/assetHubDomain'
import type { Asset, AssetVariant, Storyboard, VideoTrack, Clip, Episode, ProjectDoc } from '../domain/types'
import StudioDock from './StudioDock'
import AgentPanel from './AgentPanel'
import Select from '../components/ui/Select'
import NumberStepper from '../components/ui/NumberStepper'
import Button from '../components/ui/Button'
import IconButton from '../components/ui/IconButton'
import Popover from '../components/ui/Popover'
import Tabs from '../components/ui/Tabs'
import StudioSettings from './StudioSettings'
import { installFocusTracker } from './services/focusInsert'
import { listProviderVoices } from './services/audio'
import { loadAssetUrl } from '../services/assets'
import { cleanAssetAliases, normalizeAssetLookup } from '../domain/assetAliases'
import { VARIANT_KIND_OPTIONS, variantKindLabel, variantLabelWithKind } from '../domain/variantKinds'
import { castRefsForStoryboard, refImageIdForCastRef } from '../domain/castRefs'
import { buildContinuityReport, CATEGORY_LABEL, type ContinuityCategory } from './services/continuityReport'
import { buildContinuityLedger, episodeCastRequirements } from '../domain/continuityLedger'
import { checkSceneVariation, storyboardToVariationShot, type SceneVariationIssue } from '../services/quality'
import { buildEpisodeProductionHandoff, episodeComposeReadiness, pendingEpisodesForSeries } from './services/episodeProduction'
import { applyEpisodeHandoffSuggestion } from './services/episodeHandoffSuggestions'
import { exportEpisodePackage, exportProducedEpisodes } from './services/episodeExport'

type Tab = 'series' | 'novel' | 'script' | 'assets' | 'storyboard' | 'timeline'
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'series', label: '系列', icon: Settings2 },
  { id: 'novel', label: '原著', icon: BookOpen },
  { id: 'script', label: '剧本', icon: FileText },
  { id: 'assets', label: '项目资产', icon: Users },
  { id: 'storyboard', label: '分镜', icon: Clapperboard },
  { id: 'timeline', label: '时间线', icon: Film },
]

// 镜头：景别 + 运镜预设（注入关键帧/视频提示词）
const SHOT_SIZES = ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写']
const CAMERA_MOVES = ['固定', '推', '拉', '摇', '移', '跟', '升降', '环绕', '手持']

// 视频模式（对标 Toonflow 4 模式，§5.3；具体提示词模板在 phase4 接入）
const VIDEO_MODE_OPTIONS: { id: string; label: string }[] = [
  { id: 'firstFrame', label: '首帧驱动（图生视频）' },
  { id: 'startEndFrame', label: '首尾帧' },
  { id: 'multiRef', label: '多参考（seedance 类）' },
  { id: 'singleImageFirst', label: '单图首帧（wan2.6 类）' },
]

function useStudioContinuityReport(doc: ProjectDoc) {
  const hubLoaded = useAssetHubStore((s) => s.loaded)
  const hubEntities = useAssetHubStore((s) => s.entities)
  const refreshHub = useAssetHubStore((s) => s.refresh)
  useEffect(() => {
    if (!hubLoaded) void refreshHub()
  }, [hubLoaded, refreshHub])
  void hubEntities
  return useMemo(() => buildContinuityReport(doc), [doc])
}

function projectAssetLinkStatusLabels(asset: Asset, linkedEntity?: { version: number; archived?: boolean }): string[] {
  return assetHubEntityVersionStatus(asset, linkedEntity).labels
}

function assetCenterUsageChips(usage: IdentityAssetUsage | undefined): string[] {
  if (!usage) return []
  return [
    usage.projectCount ? `${usage.projectCount} 项目` : '',
    usage.assetCount ? `${usage.assetCount} 项目资产` : '',
    usage.canvasNodeCount ? `${usage.canvasNodeCount} 画布节点` : '',
    usage.snapshotCount ? `${usage.snapshotCount} 快照` : '',
  ].filter(Boolean)
}

function assetCenterUsageTitle(usage: IdentityAssetUsage | undefined): string {
  if (!usage) return '暂未发现资产中心、画布或快照引用'
  const projectLines = usage.projects.map((project) => {
    const episode = project.episodeLabels?.length ? `出场：${project.episodeLabels.join('、')}` : ''
    const appearance = project.appearanceLabels?.length ? `形态：${project.appearanceLabels.join('、')}` : ''
    return `${project.projectName}：${[project.assetNames.join('、'), episode, appearance].filter(Boolean).join('；')}`
  })
  const canvasLines = usage.canvasProjects.map((project) => `画布 ${project.projectName}：${project.nodeTitles.join('、')}`)
  const snapshotLines = usage.snapshots.map((snapshot) => `快照 ${snapshot.snapshotName}：${snapshot.nodeTitles.join('、')}`)
  return [...projectLines, ...canvasLines, ...snapshotLines].filter(Boolean).join('\n') || '暂未发现资产中心、画布或快照引用'
}

function assetMatrixChipsetTitle(label: string, values: string[], empty: string): string {
  return `${label}：${values.length ? values.join('、') : empty}`
}

function studioAssetDomId(assetId: string): string {
  return `afs-studio-asset-${encodeURIComponent(assetId)}`
}

export default function StudioEditor({ onHome }: { onHome: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const closeProject = useProjectStore((s) => s.closeProject)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const batch = useProjectStore((s) => s.batch)
  const film = useProjectStore((s) => s.film)
  const autoProduce = useProjectStore((s) => s.autoProduce)
  const autoProduceSeries = useProjectStore((s) => s.autoProduceSeries)
  const pauseSeriesProduction = useProjectStore((s) => s.pauseSeriesProduction)
  const pipeline = useProjectStore((s) => s.pipeline)
  const runNovelPipeline = useProjectStore((s) => s.runNovelPipeline)
  const abortNovelPipeline = useProjectStore((s) => s.abortNovelPipeline)
  const busy = batch.running || film.state === 'composing' || pipeline.running
  const seriesRunning = batch.running && batch.kind === 'series'
  const episodes = doc.episodes ?? []
  const canProduceCurrent = doc.storyboards.length > 0
  const canProduceSeries = episodes.length > 1 && pendingEpisodesForSeries(doc).length > 0
  const producedEpisodeCount = episodes.filter((episode) => !!episode.filmPath).length
  const [tab, setTab] = useState<Tab>('series')
  const [dockOpen, setDockOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const exportSeason = async () => {
    try {
      const result = await exportProducedEpisodes(doc)
      if (result.cancelled) return
      if (result.errors.length) window.mulby?.notification?.show(`已导出 ${result.count} 集，${result.errors.length} 集失败`, 'warning')
      else window.mulby?.notification?.show(`已导出 ${result.count} 集成片`, 'success')
      if (result.manifestPath) void window.mulby?.shell?.showItemInFolder(result.manifestPath)
    } catch (error) {
      window.mulby?.notification?.show(`全季导出失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }

  // 工作台输入焦点跟踪：左侧资源 Dock 的片段/资产名插入「最后聚焦的输入框」
  useEffect(() => installFocusTracker(), [])

  // 恢复/持久化工作台布局态（studio:ui）
  useEffect(() => {
    void (async () => {
      const ui = (await window.mulby?.storage?.get('studio:ui', 'ai-film-studio')) as { stageTab?: Tab; dockOpen?: boolean } | null
      if (ui?.stageTab && TABS.some((t) => t.id === ui.stageTab)) setTab(ui.stageTab)
      if (typeof ui?.dockOpen === 'boolean') setDockOpen(ui.dockOpen)
    })()
  }, [])
  useEffect(() => {
    void window.mulby?.storage?.set('studio:ui', { stageTab: tab, dockOpen }, 'ai-film-studio')
  }, [tab, dockOpen])

  return (
    <div className="afs-stwb">
      <header className="afs-stwb__toolbar" role="toolbar" aria-label="工作台工具栏">
        <div className="afs-stwb__tbgroup">
          <IconButton
            aria-label="返回项目列表"
            variant="ghost"
            icon={<ArrowLeft size={18} />}
            title="返回项目列表"
            onClick={() => {
              void closeProject()
              onHome()
            }}
          />
          <input
            className="afs-stwb__title"
            value={doc.meta.name}
            onChange={(e) => updateMeta({ name: e.target.value })}
            placeholder="未命名工程"
            aria-label="工程名称"
          />
        </div>
        <span className="afs-stwb__tbdiv" aria-hidden />
        <EpisodeSwitcher busy={busy} />
        <span className="afs-stwb__tbdiv" aria-hidden />
        <div className="afs-stwb__tbgroup afs-stwb__tbcluster">
          <Select
            size="sm"
            className="afs-studio__sel"
            value={doc.meta.artStyle}
            onChange={(v) => updateMeta({ artStyle: v })}
            options={listStylePacks().map((p) => ({ value: p.id, label: p.label }))}
            ariaLabel="画风风格包"
          />
          <Select
            size="sm"
            className="afs-studio__sel"
            value={doc.meta.videoRatio}
            onChange={(v) => updateMeta({ videoRatio: v })}
            options={['16:9', '9:16', '1:1'].map((r) => ({ value: r, label: r }))}
            ariaLabel="视频画幅"
          />
          <span className="afs-stwb__tbdiv" aria-hidden />
          <StudioModelBar />
        </div>
        {busy && !pipeline.running && (
          <span className="afs-stwb__busy" role="status" aria-live="polite">
            <Loader2 size={14} className="afs-spin" aria-hidden /> {film.state === 'composing' ? film.text || '合成中…' : batch.label}
          </span>
        )}
        <span className="afs-stwb__tbspacer" aria-hidden />
        <div className="afs-stwb__tbgroup">
          <IconButton
            aria-label="项目设置（Agent 部署 / 记忆）"
            variant="ghost"
            icon={<Settings size={18} />}
            title="项目设置（Agent 部署 / 记忆）"
            onClick={() => setSettingsOpen(true)}
          />
          {pipeline.running ? (
            <Button
              variant="secondary"
              size="md"
              leadingIcon={PauseCircle}
              disabled={pipeline.abortRequested}
              title="当前阶段完成后停止；已完成的阶段会保留，下次点「小说→成片」从断点继续"
              onClick={() => abortNovelPipeline()}
            >
              {pipeline.abortRequested ? '停止中' : '停止流水线'}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              leadingIcon={Wand2}
              disabled={busy || doc.novel.length === 0}
              title={doc.novel.length ? '拆章 → 章节事件 → 分集 → 剧本 → 资产 → 分镜 → 成片；已完成的阶段自动跳过' : '先在「原著」页导入小说正文'}
              onClick={() => void runNovelPipeline()}
            >
              小说→成片
            </Button>
          )}
          {episodes.length > 1 && seriesRunning && (
            <Button
              variant="secondary"
              size="md"
              leadingIcon={PauseCircle}
              disabled={batch.pauseRequested}
              title="当前集完成后暂停后续剧集，不中断正在生成的当前集"
              onClick={() => pauseSeriesProduction()}
            >
              {batch.pauseRequested ? '暂停中' : '暂停后续'}
            </Button>
          )}
          {episodes.length > 1 && !seriesRunning && (
            <Button
              variant="secondary"
              size="md"
              leadingIcon={Film}
              disabled={busy || !canProduceSeries}
              title="按剧集顺序生成待处理剧集，已成片、失败和暂缓剧集会跳过；失败集需重置后重试"
              onClick={() => void autoProduceSeries()}
            >
              生成全剧
            </Button>
          )}
          {episodes.length > 1 && !seriesRunning && (
            <Button
              variant="secondary"
              size="md"
              leadingIcon={Download}
              disabled={busy || producedEpisodeCount === 0}
              title={producedEpisodeCount > 0 ? `导出 ${producedEpisodeCount} 集已成片视频和 manifest.json` : '暂无已成片剧集可导出'}
              onClick={() => void exportSeason()}
            >
              导出全季
            </Button>
          )}
          <Button
            variant="gradient"
            glow
            size="md"
            leadingIcon={busy ? undefined : Wand2}
            loading={busy}
            disabled={busy || !canProduceCurrent}
            title="资产 → 关键帧 → 视频 → 合成 一条龙"
            onClick={() => void autoProduce()}
          >
            一键成片
          </Button>
        </div>
      </header>

      <div className="afs-stwb__tabsbar">
        <IconButton
          size="md"
          variant="ghost"
          pressed={dockOpen}
          aria-label={dockOpen ? '收起资源面板' : '展开资源面板（资源/提示词）'}
          title={dockOpen ? '收起资源面板' : '展开资源面板（资源/提示词）'}
          icon={<PanelLeft size={18} />}
          onClick={() => setDockOpen((v) => !v)}
        />
        <span className="afs-stwb__tabsdiv" aria-hidden />
        <Tabs
          ariaLabel="工作台阶段"
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          tabs={TABS.map((t) => ({ value: t.id, label: t.label, icon: t.icon }))}
        />
      </div>

      {(pipeline.running || pipeline.stages.some((stage) => stage.state !== 'pending')) && <PipelineStrip />}
      <div className="afs-stwb__work">
        {dockOpen && <StudioDock />}
        <div className="afs-stwb__stage">
          {tab === 'series' && <SeriesTab />}
          {tab === 'novel' && <NovelTab />}
          {tab === 'script' && <ScriptTab />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'storyboard' && <StoryboardTab />}
          {tab === 'timeline' && <TimelineTab />}
        </div>
        <AgentPanel />
      </div>
      {settingsOpen && (
        <div className="afs-studio__drawer-scrim" onClick={() => setSettingsOpen(false)}>
          <div className="afs-studio__drawer" onClick={(e) => e.stopPropagation()}>
            <div className="afs-studio__drawer-head">
              <span>项目设置</span>
              <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={() => setSettingsOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="afs-studio__drawer-body">
              <StudioSettings />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EpisodeSwitcher({ busy }: { busy: boolean }) {
  const doc = useProjectStore((s) => s.doc)!
  const createEpisode = useProjectStore((s) => s.createEpisode)
  const switchEpisode = useProjectStore((s) => s.switchEpisode)
  const renameEpisode = useProjectStore((s) => s.renameEpisode)
  const deleteEpisode = useProjectStore((s) => s.deleteEpisode)
  const resetCurrentEpisodeProduction = useProjectStore((s) => s.resetCurrentEpisodeProduction)
  const setCurrentEpisodeSeriesSkip = useProjectStore((s) => s.setCurrentEpisodeSeriesSkip)
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const currentId = doc.currentEpisodeId ?? episodes[0]?.id ?? ''
  const current = episodes.find((e) => e.id === currentId) ?? episodes[0]
  const continuity = useStudioContinuityReport(doc)
  const currentReport = current ? continuity.episodes.find((episode) => episode.id === current.id) : undefined
  const currentIssues = currentReport?.issues ?? []
  const currentErrors = currentIssues.filter((issue) => issue.severity === 'error').length
  const currentWarnings = currentIssues.length - currentErrors
  const validChapterIds = new Set(doc.novel.map((chapter) => chapter.id))
  const chapterCount = (current?.novelChapterIds ?? []).filter((id) => validChapterIds.has(id)).length
  const castUseCount = new Set((currentReport?.castUses ?? []).map((use) => `${use.assetId}:${use.variantId ?? ''}`)).size
  const issueTitle = currentIssues.length ? currentIssues.slice(0, 5).map((issue) => issue.message).join('\n') : '当前集资产和变体引用正常'
  const canResetProduction = !!current && current.status !== 'generating' && (!!current.filmPath || !!current.filmError || !!current.producedAt || !!current.productionRecap || current.status === 'done')
  const renameCurrent = () => {
    if (!current) return
    const title = window.prompt('集标题', current.title)
    if (title != null) renameEpisode(current.id, title)
  }
  const deleteCurrent = () => {
    if (!current || episodes.length <= 1) return
    if (window.confirm(`删除「${current.title}」？`)) deleteEpisode(current.id)
  }
  const resetProduction = () => {
    if (!current) return
    if (window.confirm(`重置「${current.title}」的成片状态？该集会重新进入全剧生成队列。`)) resetCurrentEpisodeProduction()
  }
  const exportCurrentEpisode = async () => {
    if (!current) return
    try {
      const result = await exportEpisodePackage(doc, current)
      if (result.cancelled) return
      if (result.errors.length) window.mulby?.notification?.show(`本集导出失败：${result.errors[0]}`, 'error')
      else window.mulby?.notification?.show(`已导出 E${current.index + 1}「${current.title}」`, 'success')
      if (result.manifestPath) void window.mulby?.shell?.showItemInFolder(result.manifestPath)
    } catch (error) {
      window.mulby?.notification?.show(`本集导出失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    }
  }
  const toggleSeriesSkip = () => {
    if (!current) return
    setCurrentEpisodeSeriesSkip(!current.seriesSkip)
  }
  return (
    <div className="afs-stwb__episode" aria-label="剧集">
      <Select
        size="sm"
        className="afs-stwb__episode-select"
        value={currentId}
        onChange={(id) => switchEpisode(id)}
        disabled={busy || episodes.length === 0}
        options={episodes.map((episode) => ({ value: episode.id, label: `E${episode.index + 1} ${episode.title}` }))}
        ariaLabel="当前剧集"
      />
      {current && (
        <div className="afs-stwb__episode-meta" aria-label="当前集制作状态">
          {doc.novel.length > 0 && (
            <span className="afs-stwb__episode-chip" title={`当前集已分配 ${chapterCount}/${doc.novel.length} 个原著章节`}>
              章节 {chapterCount}/{doc.novel.length}
            </span>
          )}
          <span className="afs-stwb__episode-chip afs-stwb__episode-chip--optional" title="当前集分镜数量">
            分镜 {currentReport?.storyboards ?? 0}
          </span>
          <span className="afs-stwb__episode-chip afs-stwb__episode-chip--optional" title="当前集已绑定的角色/场景/物品引用数量">
            引用 {castUseCount}
          </span>
          {(current.filmPath || current.filmError || current.status === 'generating') && (
            <span
              className={`afs-stwb__episode-chip afs-stwb__episode-chip--optional afs-stwb__episode-chip--audit${current.filmError ? ' is-error' : current.status === 'generating' ? ' is-warning' : ' is-ok'}`}
              title={current.filmError || current.filmPath || '当前集正在生成'}
            >
              {current.filmError ? <AlertTriangle size={11} /> : current.status === 'generating' ? <Loader2 size={11} className="afs-spin" /> : <Check size={11} />}
              {current.filmError ? '成片失败' : current.status === 'generating' ? '生成中' : '已成片'}
            </span>
          )}
          {current.seriesSkip && (
            <span className="afs-stwb__episode-chip afs-stwb__episode-chip--optional afs-stwb__episode-chip--audit is-warning" title="当前集已暂缓，不会参与生成全剧">
              <PauseCircle size={11} />
              已暂缓
            </span>
          )}
          <span
            className={`afs-stwb__episode-chip afs-stwb__episode-chip--audit${currentErrors ? ' is-error' : currentWarnings ? ' is-warning' : ' is-ok'}`}
            title={issueTitle}
          >
            {currentErrors || currentWarnings ? <AlertTriangle size={11} /> : <Check size={11} />}
            {currentErrors ? `${currentErrors} 错误` : currentWarnings ? `${currentWarnings} 警告` : '一致'}
          </span>
        </div>
      )}
      {current && episodes.length > 1 && <EpisodeHandoffPopover doc={doc} episode={current} />}
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="新建剧集"
        title="新建剧集"
        icon={<Plus size={16} />}
        disabled={busy}
        onClick={() => createEpisode()}
      />
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="重命名当前剧集"
        title="重命名当前剧集"
        icon={<Pencil size={16} />}
        disabled={busy || !current}
        onClick={renameCurrent}
      />
      <IconButton
        size="sm"
        variant="ghost"
        aria-label={current?.seriesSkip ? '恢复当前集进入全剧生成队列' : '暂缓当前集，不参与生成全剧'}
        title={current?.seriesSkip ? '恢复当前集进入全剧生成队列' : '暂缓当前集，不参与生成全剧'}
        icon={current?.seriesSkip ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
        disabled={busy || !current || current.status === 'generating'}
        onClick={toggleSeriesSkip}
      />
      {canResetProduction && (
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="重置当前集成片状态"
          title="重置当前集成片状态"
          icon={<RotateCcw size={16} />}
          disabled={busy}
          onClick={resetProduction}
        />
      )}
      {current?.filmPath && (
        <IconButton
          size="sm"
          variant="ghost"
          aria-label="导出当前集成片包"
          title="导出当前集成片和 episode.json"
          icon={<Download size={16} />}
          disabled={busy}
          onClick={() => void exportCurrentEpisode()}
        />
      )}
      <IconButton
        size="sm"
        variant="ghost"
        aria-label="删除当前剧集"
        title="删除当前剧集"
        icon={<Trash2 size={16} />}
        disabled={busy || episodes.length <= 1}
        onClick={deleteCurrent}
      />
    </div>
  )
}

function handoffAssetTypeLabel(type: ProjectDoc['assets'][number]['type']): string {
  if (type === 'role') return '人物'
  if (type === 'scene') return '场景'
  if (type === 'prop') return '物品'
  if (type === 'audio') return '音色'
  return '片段'
}

function EpisodeHandoffPopover({ doc, episode }: { doc: ProjectDoc; episode: Episode }) {
  const actionBusy = useProjectStore((s) => s.batch.running || s.film.state === 'composing')
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const generateAssetVariant = useProjectStore((s) => s.generateAssetVariant)
  const handoff = useMemo(() => buildEpisodeProductionHandoff(doc, episode), [doc, episode])
  const hasHints = handoff.carriedState.length > 0 || handoff.recaps.length > 0 || handoff.suggestions.length > 0
  const autoSuggestions = handoff.suggestions.filter((suggestion) => suggestion.autoRepairable !== false && !suggestion.disabledReason)
  const runSuggestion = async (suggestion: (typeof handoff.suggestions)[number]) => {
    await applyEpisodeHandoffSuggestion(suggestion, {
      getDoc: () => useProjectStore.getState().doc,
      generateAsset,
      generateAssetVariant,
    })
  }
  const runAutoSuggestions = async () => {
    const attempted = new Set<string>()
    for (let i = 0; i < 24; i += 1) {
      const latestDoc = useProjectStore.getState().doc
      const latestEpisode = latestDoc?.episodes?.find((item) => item.id === episode.id)
      if (!latestDoc || !latestEpisode) break
      const suggestion = buildEpisodeProductionHandoff(latestDoc, latestEpisode).suggestions.find(
        (item) => item.autoRepairable !== false && !item.disabledReason && !attempted.has(item.id),
      )
      if (!suggestion) break
      attempted.add(suggestion.id)
      await runSuggestion(suggestion)
    }
  }
  return (
    <Popover
      side="bottom"
      align="start"
      className="afs-stwb__handoff-pop"
      ariaLabel="本集承接状态"
      trigger={
        <IconButton
          size="sm"
          variant="ghost"
          className={hasHints ? 'afs-stwb__handoff-trigger is-active' : 'afs-stwb__handoff-trigger'}
          aria-label="查看本集承接状态"
          title={hasHints ? '查看本集开拍时各资产的形态状态' : '暂无承接状态'}
          icon={<BookmarkPlus size={16} />}
        />
      }
    >
      <div className="afs-stwb__handoff">
        <div className="afs-stwb__handoff-head">
          <b>E{episode.index + 1} 开拍状态</b>
          <span>{handoff.carriedState.length} 个资产 · {handoff.recaps.length} 条回顾 · {handoff.suggestions.length} 条待补图</span>
        </div>
        {!hasHints && <p className="afs-stwb__handoff-empty">本集之前没有任何分镜，没有需要承接的形态。</p>}
        {handoff.carriedState.length > 0 && (
          <section className="afs-stwb__handoff-sec">
            <h4>进入本集时的形态</h4>
            <div className="afs-stwb__handoff-list">
              {handoff.carriedState.map((cue) => (
                <article key={cue.assetId} className={`afs-stwb__handoff-item${cue.refImageId ? '' : ' is-warning'}`}>
                  <strong>{cue.label}</strong>
                  <p>
                    {handoffAssetTypeLabel(cue.assetType)}
                    {cue.reason
                      ? ` · 自 E${(cue.sinceEpisodeIndex ?? 0) + 1} #${(cue.sinceStoryboardIndex ?? 0) + 1} 起：${cue.reason}`
                      : ' · 一直是主形象'}
                    {cue.refImageId ? '' : ' · 缺参考图'}
                  </p>
                </article>
              ))}
            </div>
          </section>
        )}
        {handoff.suggestions.length > 0 && (
          <section className="afs-stwb__handoff-sec">
            <div className="afs-stwb__handoff-secbar">
              <h4>补齐参考图</h4>
              <button
                type="button"
                className="afs-stwb__handoff-action afs-stwb__handoff-action--bulk"
                disabled={actionBusy || autoSuggestions.length === 0}
                title={autoSuggestions.length ? `顺序执行 ${autoSuggestions.length} 条补图` : '没有可自动处理的建议'}
                onClick={() => void runAutoSuggestions()}
              >
                <Wand2 size={11} />
                一键补齐
              </button>
            </div>
            <div className="afs-stwb__handoff-list">
              {handoff.suggestions.map((suggestion) => (
                <article key={suggestion.id} className="afs-stwb__handoff-item afs-stwb__handoff-suggestion">
                  <strong>{suggestion.label}</strong>
                  <p>{suggestion.detail}</p>
                  <button
                    type="button"
                    className="afs-stwb__handoff-action"
                    disabled={actionBusy || !!suggestion.disabledReason}
                    title={suggestion.disabledReason || suggestion.detail}
                    onClick={() => void runSuggestion(suggestion)}
                  >
                    <Wand2 size={11} />
                    生成
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
        {handoff.recaps.length > 0 && (
          <section className="afs-stwb__handoff-sec">
            <h4>最近制作回顾</h4>
            <div className="afs-stwb__handoff-list">
              {handoff.recaps.map((recap) => (
                <article key={recap.episodeId} className="afs-stwb__handoff-item">
                  <strong>E{recap.episodeIndex + 1} {recap.episodeTitle}</strong>
                  <p>{recap.recap}</p>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </Popover>
  )
}


function StudioModelBar() {
  const models = useGraphStore((s) => s.models)
  const imageModels = useGraphStore((s) => s.imageModels)
  const selectedModel = useGraphStore((s) => s.selectedModel)
  const selectedImageModel = useGraphStore((s) => s.selectedImageModel)
  const setSelectedModel = useGraphStore((s) => s.setSelectedModel)
  const setSelectedImageModel = useGraphStore((s) => s.setSelectedImageModel)
  const meta = useProjectStore((s) => s.doc?.meta)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const providers = useProviderStore((s) => s.providers)
  const videoDefault = useProviderStore((s) => s.defaults.video)
  const setDefault = useProviderStore((s) => s.setDefault)
  const videoProviders = providers.filter((p) => (p.capabilities || ['video']).includes('video'))
  const videoProvider = videoProviders.find((p) => p.id === videoDefault) ?? videoProviders.find((p) => p.enabled) ?? null
  const ok = !!selectedModel && !!selectedImageModel && !!videoProvider
  return (
    <Popover
      side="bottom"
      align="end"
      ariaLabel="模型设置"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={Settings2}
          trailingIcon={!ok ? AlertTriangle : undefined}
          title="文本/图像/视频 模型设置（工作台复用全局选择）"
        >
          模型
        </Button>
      }
    >
      <div className="afs-stwb__popbody">
        <label className="afs-stwb__poplbl">文本模型（剧本/对话/事件）</label>
        <Select
          block
          value={selectedModel ?? ''}
          onChange={(v) => setSelectedModel(v || null)}
          options={[{ value: '', label: '（未选）' }, ...models.map((m) => ({ value: m.id, label: m.label || m.id }))]}
          ariaLabel="文本模型"
        />
        <label className="afs-stwb__poplbl">图像模型（资产/关键帧）</label>
        <Select
          block
          value={selectedImageModel ?? ''}
          onChange={(v) => setSelectedImageModel(v || null)}
          options={[{ value: '', label: '（未选）' }, ...imageModels.map((m) => ({ value: m.id, label: m.label || m.id }))]}
          ariaLabel="图像模型"
        />
        <label className="afs-stwb__poplbl">视频供应商（片段）</label>
        {videoProviders.length ? (
          <Select
            block
            value={videoDefault ?? ''}
            onChange={(v) => setDefault('video', v || null)}
            options={[{ value: '', label: '（自动选第一个）' }, ...videoProviders.map((p) => ({ value: p.id, label: `${p.label}${p.model ? ` · ${p.model}` : ''}` }))]}
            ariaLabel="视频供应商"
          />
        ) : (
          <div className="afs-stwb__popmissing">
            <AlertTriangle size={12} aria-hidden /> 未配置 — 在「设置」添加视频供应商
          </div>
        )}
        <label className="afs-stwb__poplbl">视频模式</label>
        <Select
          block
          value={meta?.videoMode ?? 'firstFrame'}
          onChange={(v) => updateMeta({ videoMode: v })}
          options={VIDEO_MODE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
          ariaLabel="视频模式"
        />
        <label className="afs-stwb__poplbl">分辨率</label>
        <Select
          block
          value={meta?.videoResolution ?? '720p'}
          onChange={(v) => updateMeta({ videoResolution: v })}
          options={['480p', '720p', '1080p'].map((r) => ({ value: r, label: r }))}
          ariaLabel="分辨率"
        />
        <label className="afs-stwb__poplbl" title="「全部生成」等批量同时跑的数量（资产/润色/段提示词并发；含承接的关键帧/视频仍按需串行）">批量并发数</label>
        <NumberStepper
          block
          min={1}
          max={8}
          value={meta?.concurrency ?? 3}
          onChange={(n) => updateMeta({ concurrency: n })}
          ariaLabel="批量并发数"
        />
        {(models.length === 0 || imageModels.length === 0) && (
          <div className="afs-stwb__pophint">没有可选模型？先去「设置」配置宿主文本/图像模型供应商。</div>
        )}
      </div>
    </Popover>
  )
}

type AssetMatrixFilter = 'all' | 'unused' | 'variant' | 'appeared' | 'issue' | 'duplicate' | 'missingRef' | 'missingVariantRef' | 'library' | 'libraryNewer' | 'libraryArchived' | 'unlinked'
type AssetMatrixTypeFilter = 'all' | 'role' | 'scene' | 'prop'
const ASSET_MATRIX_LINK_ATTENTION_LABELS = new Set(['有新版', '已归档', '已分叉', '旧链接'])

/**
 * 系列页 = 系列圣经（4 个字段）+ 形态时间轴。
 *
 * 旧版这里是「每集 3 个文本框 + N 个资产复选 + M 个形态复选」的网格：20 集 × 15 资产 × 30 形态
 * 会渲染近千个控件，而这些勾选本身并不生产任何东西，只是给一致性检查提供另一份可能对不上的声明。
 * 现在勾选全部删掉——本集用到什么由分镜决定；这一页只回答一个问题：
 * **每个角色在每一集长什么样，以及是在哪一镜、因为什么变的。**
 */
/**
 * 主线流水线进度条：7 个阶段横向排开，显示每段的状态、进度和失败原因。
 * 阶段状态是从文档推导出来的，所以关掉重开、手工改内容之后再跑都能自洽。
 */
function PipelineStrip() {
  const pipeline = useProjectStore((s) => s.pipeline)
  const runNovelPipeline = useProjectStore((s) => s.runNovelPipeline)
  const failed = pipeline.stages.find((stage) => stage.state === 'failed')
  return (
    <div className="afs-stwb__pipeline" role="status" aria-live="polite" aria-label="小说到成片流水线进度">
      <ol className="afs-stwb__pipeline-steps">
        {pipeline.stages.map((stage) => (
          <li key={stage.id} className={`afs-stwb__pipeline-step is-${stage.state}`} title={stage.error || stage.detail || stage.label}>
            <span className="afs-stwb__pipeline-dot" aria-hidden>
              {stage.state === 'running' ? <Loader2 size={11} className="afs-spin" /> : stage.state === 'done' ? <Check size={11} /> : stage.state === 'failed' ? <AlertCircle size={11} /> : null}
            </span>
            <b>{stage.label}</b>
            {stage.progress && stage.state === 'running' && <i>{stage.progress.done}/{stage.progress.total}</i>}
            {stage.state === 'skipped' && <i>跳过</i>}
          </li>
        ))}
      </ol>
      {(pipeline.stages.find((stage) => stage.state === 'running')?.detail || failed?.error) && (
        <p className={failed ? 'afs-stwb__pipeline-detail is-error' : 'afs-stwb__pipeline-detail'}>
          {failed?.error ?? pipeline.stages.find((stage) => stage.state === 'running')?.detail}
        </p>
      )}
      {failed && !pipeline.running && (
        <button type="button" className="afs-stwb__pipeline-retry" onClick={() => void runNovelPipeline()}>
          修好后从这一步继续
        </button>
      )}
    </div>
  )
}

function AssetThumb({ assetId }: { assetId: string }) {
  const url = useMediaUrl({ assetId })
  return <span className="afs-series__timeline-thumb">{url ? <img src={url} alt="" /> : null}</span>
}

function SeriesTab() {
  const doc = useProjectStore((s) => s.doc)!
  const updateSeriesBible = useProjectStore((s) => s.updateSeriesBible)
  const updateEpisodePlan = useProjectStore((s) => s.updateEpisodePlan)
  const createEpisodes = useProjectStore((s) => s.createEpisodes)
  const switchEpisode = useProjectStore((s) => s.switchEpisode)
  const revertAppearance = useProjectStore((s) => s.revertAppearanceToInherited)
  const [typeFilter, setTypeFilter] = useState<AssetMatrixTypeFilter>('role')
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const bible = doc.seriesBible ?? { plannedEpisodeCount: episodes.length || 1 }
  const plannedCount = bible.plannedEpisodeCount ?? (episodes.length || 1)

  const ledger = useMemo(() => buildContinuityLedger(doc), [doc])
  const assetsById = useMemo(() => new Map(doc.assets.map((asset) => [asset.id, asset])), [doc.assets])

  /** 每个资产 × 每一集：进入该集时的形态 + 该集内发生的变更点 */
  const timeline = useMemo(() => {
    const tracked = doc.assets.filter(
      (asset) => !asset.parentAssetId && (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop'),
    )
    const shotsByEpisode = new Map<string, typeof ledger.shots>()
    for (const shot of ledger.shots) shotsByEpisode.set(shot.episodeId, [...(shotsByEpisode.get(shot.episodeId) ?? []), shot])

    return tracked
      .filter((asset) => typeFilter === 'all' || asset.type === typeFilter)
      .map((asset) => {
        const cells = episodes.map((episode) => {
          const shots = shotsByEpisode.get(episode.id) ?? []
          const appears = shots.some((shot) => castRefsForStoryboard(shot.storyboard).some((ref) => ref.assetId === asset.id))
          const entryVariantId = shots.length ? shots[0].inherited.get(asset.id) : undefined
          const changes = shots.flatMap((shot) =>
            shot.changes
              .filter((change) => change.assetId === asset.id)
              .map((change) => ({ shot, change })),
          )
          const exitVariantId = changes.length ? changes[changes.length - 1].change.toVariantId : entryVariantId
          return { episode, appears, entryVariantId, exitVariantId, changes }
        })
        return { asset, cells, everAppears: cells.some((cell) => cell.appears) }
      })
      .filter((row) => row.everAppears || row.asset.type === 'role')
  }, [doc.assets, episodes, ledger, typeFilter])

  const variantLabel = (asset: Asset, variantId: string | undefined) =>
    variantId ? asset.variants?.find((item) => item.id === variantId)?.label ?? variantId : '主形象'

  const fillEpisodes = () => {
    const missing = plannedCount - episodes.length
    if (missing > 0) createEpisodes(missing)
  }

  return (
    <div className="afs-series">
      <section className="afs-series__bible">
        <div className="afs-studio__tabbar">
          <b>系列圣经</b>
          <span className="afs-studio__hint">整季基调，注入各 Agent；不直接生成媒体</span>
          <span className="afs-series__spacer" />
          <span className="afs-studio__hint">计划集数</span>
          <NumberStepper size="sm" min={1} max={100} value={plannedCount} onChange={(n) => updateSeriesBible({ plannedEpisodeCount: n })} ariaLabel="计划集数" />
          <button className="afs-btn afs-btn--sm" disabled={plannedCount <= episodes.length} onClick={fillEpisodes}>
            <Plus size={13} /> 补齐剧集
          </button>
        </div>
        <div className="afs-series__bible-grid">
          <label className="afs-series__field">
            <span>一句话钩子</span>
            <input className="afs-field__input" value={bible.logline ?? ''} placeholder="整季核心卖点 / 第一眼吸引力" onChange={(e) => updateSeriesBible({ logline: e.target.value })} />
          </label>
          <label className="afs-series__field">
            <span>主题</span>
            <input className="afs-field__input" value={bible.theme ?? ''} placeholder="复仇、成长、悬疑、爽感节奏等" onChange={(e) => updateSeriesBible({ theme: e.target.value })} />
          </label>
          <label className="afs-series__field afs-series__field--wide">
            <span>整季梗概</span>
            <textarea className="afs-field__input" rows={3} value={bible.synopsis ?? ''} placeholder="整季故事主线、主角目标、核心反转和结局方向" onChange={(e) => updateSeriesBible({ synopsis: e.target.value })} />
          </label>
          <label className="afs-series__field afs-series__field--wide">
            <span>世界规则</span>
            <textarea className="afs-field__input" rows={2} value={bible.worldRules ?? ''} placeholder="时代背景、空间规则、能力边界、视觉基调等" onChange={(e) => updateSeriesBible({ worldRules: e.target.value })} />
          </label>
        </div>
      </section>

      <section className="afs-series__episodes">
        <div className="afs-studio__tabbar">
          <b>形态时间轴</b>
          <span className="afs-studio__hint">
            外观自动沿用上一镜，只在真的变化时登记一次。共 {ledger.shots.length} 镜
          </span>
          <span className="afs-series__spacer" />
          <span className="afs-series__filters" aria-label="资产类型筛选">
            {([['role', '角色'], ['scene', '场景'], ['prop', '道具'], ['all', '全部']] as const).map(([id, label]) => (
              <button key={id} type="button" className={typeFilter === id ? 'is-on' : ''} aria-pressed={typeFilter === id} onClick={() => setTypeFilter(id)}>
                {label}
              </button>
            ))}
          </span>
        </div>

        {episodes.length === 0 ? (
          <p className="afs-series__empty">还没有剧集。先在上面设定计划集数并「补齐剧集」。</p>
        ) : timeline.length === 0 ? (
          <p className="afs-series__empty">当前筛选下没有资产。</p>
        ) : (
          <div className="afs-series__timeline" role="table" aria-label="资产形态时间轴">
            <div className="afs-series__timeline-head" role="row">
              <span role="columnheader">资产</span>
              {episodes.map((episode) => (
                <button
                  key={episode.id}
                  type="button"
                  role="columnheader"
                  className={episode.id === doc.currentEpisodeId ? 'is-current' : ''}
                  title={`切换到 E${episode.index + 1}「${episode.title}」`}
                  onClick={() => switchEpisode(episode.id)}
                >
                  E{episode.index + 1}
                </button>
              ))}
            </div>
            {timeline.map(({ asset, cells }) => (
              <div key={asset.id} className="afs-series__timeline-row" role="row">
                <span className="afs-series__timeline-asset" role="rowheader" title={asset.name}>
                  {asset.refImageId && <AssetThumb assetId={asset.refImageId} />}
                  <b>{asset.name}</b>
                </span>
                {cells.map((cell) => {
                  const label = variantLabel(asset, cell.exitVariantId)
                  const changed = cell.changes.length > 0
                  const title = changed
                    ? cell.changes
                        .map(({ shot, change }) => `#${shot.storyboardIndex + 1} → ${variantLabel(asset, change.toVariantId)}：${change.reason}`)
                        .join('\n')
                    : cell.appears
                      ? `沿用${label}`
                      : '本集未出场'
                  return (
                    <span
                      key={cell.episode.id}
                      role="cell"
                      className={`afs-series__timeline-cell${cell.appears ? '' : ' is-absent'}${changed ? ' is-changed' : ''}`}
                      title={title}
                    >
                      {cell.appears ? (
                        <>
                          <i className="afs-series__timeline-label">{label}</i>
                          {changed && (
                            <button
                              type="button"
                              className="afs-series__timeline-undo"
                              title={`撤销 E${cell.episode.index + 1} 的形态变更，沿用上一镜`}
                              aria-label={`撤销 ${asset.name} 在 E${cell.episode.index + 1} 的形态变更`}
                              onClick={() => {
                                for (const { shot } of cell.changes) revertAppearance(shot.storyboardId, asset.id)
                              }}
                            >
                              ×
                            </button>
                          )}
                        </>
                      ) : (
                        <i className="afs-series__timeline-label">—</i>
                      )}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="afs-series__episodes">
        <div className="afs-studio__tabbar">
          <b>剧集叙事</b>
          <span className="afs-studio__hint">每集的钩子与冲突；出场资产由分镜决定，无需在此勾选</span>
        </div>
        <div className="afs-series__episode-grid">
          {episodes.map((episode) => {
            const plan = episode.plan ?? {}
            const cast = episodeCastRequirements(doc, episode.id)
            return (
              <article key={episode.id} className="afs-series__episode">
                <div className="afs-series__episode-head">
                  <b>E{episode.index + 1}</b>
                  <span className="afs-series__episode-title" title={episode.title}>{episode.title}</span>
                  <div className="afs-series__episode-summary">
                    <i>{cast.length ? `${cast.length} 个出场资产` : '尚无分镜'}</i>
                  </div>
                </div>
                <div className="afs-series__plan-grid">
                  <label className="afs-series__field">
                    <span>开场钩子</span>
                    <textarea className="afs-field__input" rows={2} value={plan.hook ?? ''} onChange={(e) => updateEpisodePlan(episode.id, { hook: e.target.value })} />
                  </label>
                  <label className="afs-series__field">
                    <span>本集冲突</span>
                    <textarea className="afs-field__input" rows={2} value={plan.conflict ?? ''} onChange={(e) => updateEpisodePlan(episode.id, { conflict: e.target.value })} />
                  </label>
                  <label className="afs-series__field afs-series__field--wide">
                    <span>结尾钩子</span>
                    <textarea className="afs-field__input" rows={2} value={plan.cliffhanger ?? ''} onChange={(e) => updateEpisodePlan(episode.id, { cliffhanger: e.target.value })} />
                  </label>
                </div>
                {cast.length > 0 && (
                  <div className="afs-series__requirements">
                    <span>本集出场（来自分镜）</span>
                    <div className="afs-series__checks">
                      {cast.map((item) => {
                        const asset = assetsById.get(item.assetId)
                        if (!asset) return null
                        const labels = item.variantIds.map((id) => variantLabel(asset, id))
                        return (
                          <span key={item.assetId} className="afs-series__check is-on" title={`形态：${labels.join('、')}`}>
                            <span className="afs-series__checktext">{asset.name}</span>
                            {labels.length > 1 && (
                              <span className="afs-series__warnchips">
                                <i>{labels.length} 种形态</i>
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function NovelTab() {
  const doc = useProjectStore((s) => s.doc)!
  const importNovel = useProjectStore((s) => s.importNovel)
  const clearNovel = useProjectStore((s) => s.clearNovel)
  const extractChapterEvents = useProjectStore((s) => s.extractChapterEvents)
  const extractAllEvents = useProjectStore((s) => s.extractAllEvents)
  const setEpisodeNovelChapters = useProjectStore((s) => s.setEpisodeNovelChapters)
  const createEpisodes = useProjectStore((s) => s.createEpisodes)
  const distributeNovelChaptersAcrossEpisodes = useProjectStore((s) => s.distributeNovelChaptersAcrossEpisodes)
  const batch = useProjectStore((s) => s.batch)
  const [text, setText] = useState('')
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const chapterById = new Map(doc.novel.map((chapter) => [chapter.id, chapter]))
  const chapterUseCounts = new Map<string, number>()
  for (const episode of episodes) {
    for (const chapterId of episode.novelChapterIds ?? []) {
      if (chapterById.has(chapterId)) chapterUseCounts.set(chapterId, (chapterUseCounts.get(chapterId) ?? 0) + 1)
    }
  }
  const assignedChapterIds = new Set(chapterUseCounts.keys())
  const unassignedChapters = doc.novel.filter((chapter) => !assignedChapterIds.has(chapter.id))
  const reusedChapters = doc.novel.filter((chapter) => (chapterUseCounts.get(chapter.id) ?? 0) > 1)
  const toggleChapterEpisode = (chapterId: string, episodeId: string) => {
    const episode = episodes.find((item) => item.id === episodeId)
    if (!episode) return
    const current = new Set(episode.novelChapterIds ?? [])
    if (current.has(chapterId)) current.delete(chapterId)
    else current.add(chapterId)
    setEpisodeNovelChapters(episodeId, [...current])
  }
  return (
    <div className="afs-studio__novel">
      {doc.novel.length === 0 ? (
        <>
          <p className="afs-studio__hint">粘贴小说原文，自动按「第N章/回/卷」切分（无标题则按长度分段）。导入后让右侧 AI 制片「按原著改编成短剧」。</p>
          <textarea
            className="afs-field__input afs-studio__novelpaste"
            placeholder="在此粘贴小说全文…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="afs-btn afs-btn--primary afs-btn--sm"
            disabled={!text.trim()}
            onClick={() => {
              importNovel(text)
              setText('')
            }}
          >
            <BookOpen size={14} /> 导入并分章
          </button>
        </>
      ) : (
        <>
          <div className="afs-studio__tabbar">
            <b>{doc.novel.length} 章</b>
            <button className="afs-btn afs-btn--sm" disabled={batch.running} onClick={() => void extractAllEvents()}>
              <Wand2 size={13} /> 提取全部事件
            </button>
            <span className="afs-studio__hint">提取后改编更省 token、长篇也装得下</span>
            <button
              className="afs-btn afs-btn--sm afs-btn--ghost"
              title="一次新增多集空白生产线"
              onClick={() => {
                const raw = window.prompt('要新增几集？', '5')
                const count = raw == null ? 0 : Math.floor(Number(raw))
                if (count > 0) createEpisodes(count)
              }}
            >
              <Plus size={13} /> 新增多集
            </button>
            {episodes.length > 1 && (
              <button
                className="afs-btn afs-btn--sm afs-btn--ghost"
                title="按章节顺序覆盖当前多集拆章"
                onClick={() => {
                  if (window.confirm('按章节顺序重新均分到现有剧集？这会覆盖当前拆章。')) distributeNovelChaptersAcrossEpisodes()
                }}
              >
                <BookOpen size={13} /> 顺序均分
              </button>
            )}
            <button className="afs-btn afs-btn--sm afs-btn--ghost" style={{ marginLeft: 'auto' }} onClick={() => clearNovel()}>
              <Trash2 size={13} /> 清空
            </button>
          </div>
          {episodes.length > 1 && (
            <div className="afs-studio__episodeplan" aria-label="多集章节规划">
              <div className="afs-studio__episodeplan-head">
                <b>多集拆章</b>
                <span>
                  已分配 {assignedChapterIds.size}/{doc.novel.length}
                </span>
                {unassignedChapters.length > 0 && <span className="is-warning">未分配 {unassignedChapters.length}</span>}
                {reusedChapters.length > 0 && <span className="is-warning">重复 {reusedChapters.length}</span>}
              </div>
              <div className="afs-studio__episodeplan-grid">
                {episodes.map((episode) => {
                  const validChapters = (episode.novelChapterIds ?? []).map((id) => chapterById.get(id)).filter(Boolean) as typeof doc.novel
                  const invalidCount = (episode.novelChapterIds ?? []).filter((id) => !chapterById.has(id)).length
                  return (
                    <div key={episode.id} className={`afs-studio__episodeplan-row${validChapters.length ? '' : ' is-empty'}`}>
                      <div className="afs-studio__episodeplan-title">
                        <b>E{episode.index + 1}</b>
                        <span title={episode.title}>{episode.title}</span>
                      </div>
                      <div className="afs-studio__episodeplan-chapters">
                        {validChapters.length ? (
                          validChapters.slice(0, 5).map((chapter) => (
                            <button key={chapter.id} type="button" title={`从 ${episode.title} 移出 ${chapter.title}`} onClick={() => toggleChapterEpisode(chapter.id, episode.id)}>
                              {chapter.index + 1}. {chapter.title}
                            </button>
                          ))
                        ) : (
                          <span>未分配章节</span>
                        )}
                        {validChapters.length > 5 && <span>+{validChapters.length - 5}</span>}
                        {invalidCount > 0 && <span className="is-warning">失效 {invalidCount}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
              {unassignedChapters.length > 0 && (
                <div className="afs-studio__episodeplan-unassigned">
                  <span>未分配</span>
                  {unassignedChapters.slice(0, 8).map((chapter) => (
                    <span key={chapter.id} title={chapter.title}>
                      {chapter.index + 1}. {chapter.title}
                    </span>
                  ))}
                  {unassignedChapters.length > 8 && <span>+{unassignedChapters.length - 8}</span>}
                </div>
              )}
            </div>
          )}
          <div className="afs-studio__chapters">
            {doc.novel.map((c) => (
              <div key={c.id} className="afs-studio__chapter afs-studio__chapter--col">
                <div className="afs-studio__chapterhead">
                  <span className="afs-studio__chaptertitle">{c.title}</span>
                  <span className="afs-studio__chapterlen">{c.text.length} 字</span>
                  <button
                    className="afs-btn afs-btn--sm afs-btn--ghost"
                    disabled={c.eventState === 'generating'}
                    onClick={() => void extractChapterEvents(c.id)}
                  >
                    {c.eventState === 'generating' ? <Loader2 size={12} className="afs-spin" /> : <Wand2 size={12} />}
                    {c.event ? ' 重提事件' : ' 提取事件'}
                  </button>
                </div>
                {c.event && <div className="afs-studio__chapterevent">{c.event}</div>}
                {episodes.length > 1 && (
                  <div className="afs-studio__chapterepisodes" aria-label={`${c.title} 剧集分配`}>
                    <span className="afs-studio__chapterep-label">分配</span>
                    {episodes.map((episode) => {
                      const assigned = (episode.novelChapterIds ?? []).includes(c.id)
                      return (
                        <button
                          key={episode.id}
                          type="button"
                          className={`afs-studio__chapterep${assigned ? ' is-on' : ''}`}
                          title={`${assigned ? '移出' : '加入'} ${episode.title}`}
                          onClick={() => toggleChapterEpisode(c.id, episode.id)}
                        >
                          {assigned && <Check size={10} />}
                          E{episode.index + 1}
                        </button>
                      )
                    })}
                    {!episodes.some((episode) => (episode.novelChapterIds ?? []).includes(c.id)) && <span className="afs-studio__chapterep-empty">未分配</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ScriptTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertScript = useProjectStore((s) => s.upsertScript)
  const removeScript = useProjectStore((s) => s.removeScript)
  const [sel, setSel] = useState<string | null>(doc.scripts[0]?.id ?? null)
  // sel 未初始化/失效时回退到首个剧本：Agent/autoProduce 新建剧本后能立刻显示，不必手动点
  const current = doc.scripts.find((s) => s.id === sel) ?? doc.scripts[0] ?? null

  return (
    <div className="afs-studio__split">
      <div className="afs-studio__list">
        <button className="afs-btn afs-btn--sm" onClick={() => setSel(upsertScript({ name: `剧本 ${doc.scripts.length + 1}`, content: '' }))}>
          <Plus size={14} /> 新建剧本
        </button>
        {doc.scripts.map((s) => (
          <div key={s.id} className={`afs-studio__listitem${sel === s.id ? ' is-active' : ''}`} onClick={() => setSel(s.id)}>
            <span>{s.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeScript(s.id)
                if (sel === s.id) setSel(null)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="afs-studio__detail">
        {current ? (
          <>
            <input
              className="afs-studio__title"
              value={current.name}
              onChange={(e) => upsertScript({ id: current.id, name: e.target.value, content: current.content })}
            />
            <textarea
              className="afs-field__input afs-studio__editor-text"
              value={current.content}
              placeholder="剧本内容（阶段3 可由编剧 Agent 生成）…"
              onChange={(e) => upsertScript({ id: current.id, content: e.target.value })}
            />
          </>
        ) : (
          <p className="afs-studio__hint">选择或新建一个剧本。</p>
        )}
      </div>
    </div>
  )
}

function AssetsTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const importImageToProject = useProjectStore((s) => s.importImageToProject)
  const importElementToProject = useProjectStore((s) => s.importElementToProject)
  const generateAllAssets = useProjectStore((s) => s.generateAllAssets)
  const polishAllAssets = useProjectStore((s) => s.polishAllAssets)
  const autoBindVoices = useProjectStore((s) => s.autoBindVoices)
  const batch = useProjectStore((s) => s.batch)
  const [dropKind, setDropKind] = useState<'role' | 'scene' | 'prop' | null>(null)
  const groups: { type: 'role' | 'scene' | 'prop'; label: string }[] = [
    { type: 'role', label: '人物' },
    { type: 'scene', label: '场景' },
    { type: 'prop', label: '物品' },
  ]

  // 从 Dock 拖入媒体文件/身份资产：落到哪个分组就按该分组类别（人物/场景/物品）加入项目资产快照
  const canAcceptDrag = (e: React.DragEvent) => {
    const t = Array.from(e.dataTransfer.types)
    return t.includes(DND_ELEMENT) || t.includes(DND_ASSET)
  }
  const onDrop = async (e: React.DragEvent, kind: 'role' | 'scene' | 'prop', label: string) => {
    if (!canAcceptDrag(e)) return
    e.preventDefault()
    setDropKind(null)
    const elId = e.dataTransfer.getData(DND_ELEMENT)
    const asId = e.dataTransfer.getData(DND_ASSET)
    const hub = useAssetHubStore.getState()
    if (!hub.loaded) await hub.refresh()
    const hubState = useAssetHubStore.getState()
    if (elId) {
      const entity = hubState.entities.find((item) => item.id === elId)
      if (entity?.archived) {
        window.mulby?.notification?.show(`「${entity.name}」已归档，恢复后才能加入项目资产`, 'warning')
        return
      }
      const el = entity ? libraryEntityToElement(entity) : undefined
      if (el && (await importElementToProject(doc.meta.id, el, kind)))
        window.mulby?.notification?.show(`已把「${el.name}」加入${label}`, 'success')
    } else if (asId) {
      const rec = hubState.mediaAssets.find((x) => x.id === asId)
      if (rec && (await importImageToProject(doc.meta.id, rec, kind)))
        window.mulby?.notification?.show(`已把「${rec.name || '媒体文件'}」加入${label}`, 'success')
    }
  }

  return (
    <div className="afs-studio__assets">
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" disabled={batch.running || doc.assets.length === 0} onClick={() => void polishAllAssets()}>
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 全部润色
        </button>
        <button className="afs-btn afs-btn--sm" disabled={batch.running || doc.assets.length === 0} onClick={() => void generateAllAssets()}>
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 全部生成
        </button>
        <button
          className="afs-btn afs-btn--sm"
          disabled={batch.running || !doc.assets.some((a) => a.type === 'role') || !doc.assets.some((a) => a.type === 'audio')}
          title="为各角色 AI 匹配最契合的音色"
          onClick={() => void autoBindVoices()}
        >
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Bot size={13} />} AI 配音匹配
        </button>
      </div>
      {(doc.episodes?.length ?? 0) > 1 && <AssetContinuityPanel />}
      {groups.map((g) => {
        const items = doc.assets.filter((a) => a.type === g.type && !a.parentAssetId)
        return (
          <div
            key={g.type}
            className={`afs-studio__assetgroup${dropKind === g.type ? ' is-dragover' : ''}`}
            onDragOver={(e) => {
              if (!canAcceptDrag(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              if (dropKind !== g.type) setDropKind(g.type)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropKind((k) => (k === g.type ? null : k))
            }}
            onDrop={(e) => void onDrop(e, g.type, g.label)}
          >
            <div className="afs-studio__assetgroup-head">
              <b>{g.label}</b>
              <button className="afs-btn afs-btn--sm" onClick={() => upsertAsset({ type: g.type, name: `${g.label}${items.length + 1}` })}>
                <Plus size={14} /> 新增
              </button>
            </div>
            <div className="afs-studio__cardgrid">
              {items.length === 0 && <span className="afs-studio__hint">暂无（可从左侧 Dock 拖图片媒体 / 身份资产到这里）</span>}
              {items.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          </div>
        )
      })}
      <VoiceLibrary />
    </div>
  )
}

function AssetContinuityPanel() {
  const doc = useProjectStore((s) => s.doc)!
  const continuity = useStudioContinuityReport(doc)
  const hubLoaded = useAssetHubStore((s) => s.loaded)
  const hubEntities = useAssetHubStore((s) => s.entities)
  const usageByEntity = useAssetHubStore((s) => s.usageByEntity)
  const syncAssetFromLibraryEntity = useProjectStore((s) => s.syncAssetFromLibraryEntity)
  const promoteAssetToElement = useProjectStore((s) => s.promoteAssetToElement)
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const generateAssetVariant = useProjectStore((s) => s.generateAssetVariant)
  const mergeProjectAssetInto = useProjectStore((s) => s.mergeProjectAssetInto)
  const linkAssetToLibraryEntity = useProjectStore((s) => s.linkAssetToLibraryEntity)
  const markAssetAsDistinctIdentity = useProjectStore((s) => s.markAssetAsDistinctIdentity)
  const refreshAssetHub = useAssetHubStore((s) => s.refresh)
  const [assetMatrixFilter, setAssetMatrixFilter] = useState<AssetMatrixFilter>('all')
  const [assetMatrixTypeFilter, setAssetMatrixTypeFilter] = useState<AssetMatrixTypeFilter>('all')
  const [assetMatrixEpisodeFilter, setAssetMatrixEpisodeFilter] = useState('all')
  const [assetMatrixSearch, setAssetMatrixSearch] = useState('')
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const rows = doc.assets
    .filter((asset) => !asset.parentAssetId && asset.type !== 'audio' && asset.type !== 'clip')
    .map((asset) => {
      const uses = continuity.episodes.flatMap((episode) => episode.castUses.filter((use) => use.assetId === asset.id).map((use) => ({ episode, use })))
      const episodeEntries = [...new Map(uses.map(({ episode }) => [episode.id, { episodeId: episode.id, label: `E${episode.index + 1}` }])).values()]
      const episodeLabels = episodeEntries.map(({ label }) => label)
      const variantEntries = uses.map(({ episode, use }) => ({
        episodeId: episode.id,
        label: use.variantLabel ?? (use.variantId ? use.variantId : '主形象'),
      }))
      const variantLabels = [...new Set(variantEntries.map(({ label }) => label))]
      const variantById = new Map((asset.variants ?? []).map((variant) => [variant.id, variant]))
      const variantIds = new Set(variantById.keys())
      const actualEpisodeIds = new Set(uses.map(({ episode }) => episode.id))
      const actualVariantUses = uses.flatMap(({ episode, use }) => (use.variantId && variantIds.has(use.variantId) ? [{ episode, use, variantId: use.variantId }] : []))
      const missingVariantRefEntries = actualVariantUses
        .map(({ episode, use, variantId }) => {
          const variant = variantById.get(variantId)
          const variantLabel = use.variantLabel ?? variantLabelWithKind(variant?.label ?? variantId, variant?.variantKind)
          return { episodeId: episode.id, variantId, label: `E${episode.index + 1}/${variantLabel}`, variantLabel, state: variant?.state, refImageId: variant?.refImageId }
        })
        .filter((entry) => !entry.refImageId)
      const issues = continuity.issues.filter((issue) => issue.assetId === asset.id)
      const assetCenterUsage = hubLoaded ? projectAssetIdentityUsageFromHub(doc, asset, usageByEntity) : undefined
      const linkedEntityId = asset.libraryLink?.entityId ?? asset.elementId
      const linkedEntity = linkedEntityId ? hubEntities.find((entity) => entity.id === linkedEntityId) : undefined
      const linkStatusLabels = projectAssetLinkStatusLabels(asset, linkedEntity)
      return { asset, episodeIds: [...actualEpisodeIds], episodeEntries, variantEntries, missingVariantRefEntries, episodeLabels, variantLabels, assetCenterUsage, assetCenterChips: assetCenterUsageChips(assetCenterUsage), linkedEntity, linkStatusLabels, issues }
    })
    .filter((row) => row.episodeLabels.length > 0 || row.issues.length > 0 || row.asset.type === 'role')
  const labelsForEpisodeFilter = (entries: { episodeId: string; label: string }[], episodeFilter = assetMatrixEpisodeFilter) =>
    [...new Set((episodeFilter === 'all' ? entries : entries.filter((entry) => entry.episodeId === episodeFilter)).map((entry) => entry.label))]
  const rowVisibleEpisodeLabels = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => labelsForEpisodeFilter(row.episodeEntries, episodeFilter)
  const rowVisibleVariantLabels = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => labelsForEpisodeFilter(row.variantEntries, episodeFilter)
  const rowVisibleMissingVariantRefs = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => {
    const entries = episodeFilter === 'all' ? row.missingVariantRefEntries : row.missingVariantRefEntries.filter((entry) => entry.episodeId === episodeFilter)
    return [...new Map(entries.map((entry) => [`${entry.episodeId}:${entry.variantId}`, entry])).values()]
  }
  const issueMatchesEpisodeFilter = (issue: (typeof rows)[number]['issues'][number], episodeFilter = assetMatrixEpisodeFilter) =>
    episodeFilter === 'all' || issue.episodeId === episodeFilter || !issue.episodeId
  const rowVisibleIssues = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => row.issues.filter((issue) => issueMatchesEpisodeFilter(issue, episodeFilter))
  const rowHasVisibleIssue = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => rowVisibleIssues(row, episodeFilter).length > 0
  const rowVisibleDuplicateIssues = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) =>
    rowVisibleIssues(row, episodeFilter).filter((issue) => issue.code === 'duplicate_identity')
  const rowHasDuplicateRisk = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => rowVisibleDuplicateIssues(row, episodeFilter).length > 0
  const rowHasNewerLibraryVersion = (row: (typeof rows)[number]) => row.linkStatusLabels.includes('有新版')
  const rowHasArchivedLibraryLink = (row: (typeof rows)[number]) => row.linkStatusLabels.includes('已归档')
  const rowMissingAssetCenter = (row: (typeof rows)[number]) => hubLoaded && row.assetCenterChips.length === 0
  const rowNeedsMainReference = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) =>
    !row.asset.refImageId && rowVisibleEpisodeLabels(row, episodeFilter).length > 0
  const rowNeedsVariantReference = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => rowVisibleMissingVariantRefs(row, episodeFilter).length > 0
  const rowHasLibraryStatusAttention = (row: (typeof rows)[number]) => row.linkStatusLabels.some((label) => ASSET_MATRIX_LINK_ATTENTION_LABELS.has(label))
  const rowHasStatusWarning = (row: (typeof rows)[number]) => rowHasVisibleIssue(row) || rowNeedsMainReference(row) || rowNeedsVariantReference(row) || rowMissingAssetCenter(row) || rowHasLibraryStatusAttention(row)
  const rowMatchesEpisode = (row: (typeof rows)[number], episodeId: string) =>
    row.episodeIds.includes(episodeId) || row.issues.some((issue) => issue.episodeId === episodeId || !issue.episodeId)
  const rowPriority = (row: (typeof rows)[number]) => {
    if (rowHasVisibleIssue(row)) return 0
    if (rowNeedsMainReference(row)) return 1
    if (rowNeedsVariantReference(row)) return 2
    if (rowHasLibraryStatusAttention(row)) return 3
    if (rowMissingAssetCenter(row)) return 4
    if (rowVisibleEpisodeLabels(row).length > 0) return 5
    return 6
  }
  if (!rows.length) return null
  const sortedRows = [...rows].sort((a, b) =>
    rowPriority(a) - rowPriority(b) ||
    rowVisibleIssues(b).length - rowVisibleIssues(a).length ||
    rowVisibleEpisodeLabels(b).length - rowVisibleEpisodeLabels(a).length ||
    a.asset.name.localeCompare(b.asset.name, 'zh-Hans') ||
    a.asset.id.localeCompare(b.asset.id)
  )
  const assetMatrixSearchKey = normalizeAssetLookup(assetMatrixSearch)
  const searchFilteredRows = assetMatrixSearchKey
    ? sortedRows.filter((row) => [row.asset.name, ...(row.asset.aliases ?? [])].some((value) => normalizeAssetLookup(value).includes(assetMatrixSearchKey)))
    : sortedRows
  const episodeOptionRows = searchFilteredRows.filter((row) => assetMatrixTypeFilter === 'all' || row.asset.type === assetMatrixTypeFilter)
  const episodeFilteredRows = searchFilteredRows.filter((row) => assetMatrixEpisodeFilter === 'all' || rowMatchesEpisode(row, assetMatrixEpisodeFilter))
  const rowMatchesAssetMatrixFilter = (row: (typeof rows)[number], episodeFilter = assetMatrixEpisodeFilter) => {
    if (assetMatrixFilter === 'unused') return rowVisibleEpisodeLabels(row, episodeFilter).length === 0
    if (assetMatrixFilter === 'variant') return rowVisibleVariantLabels(row, episodeFilter).length > 1
    if (assetMatrixFilter === 'appeared') return rowVisibleEpisodeLabels(row, episodeFilter).length > 0
    if (assetMatrixFilter === 'issue') return rowHasVisibleIssue(row, episodeFilter)
    if (assetMatrixFilter === 'duplicate') return rowHasDuplicateRisk(row, episodeFilter)
    if (assetMatrixFilter === 'missingRef') return rowNeedsMainReference(row, episodeFilter)
    if (assetMatrixFilter === 'missingVariantRef') return rowNeedsVariantReference(row, episodeFilter)
    if (assetMatrixFilter === 'library') return rowHasLibraryStatusAttention(row)
    if (assetMatrixFilter === 'libraryNewer') return rowHasNewerLibraryVersion(row)
    if (assetMatrixFilter === 'libraryArchived') return rowHasArchivedLibraryLink(row)
    if (assetMatrixFilter === 'unlinked') return rowMissingAssetCenter(row)
    return true
  }
  const typeOptionRows = episodeFilteredRows.filter((row) => rowMatchesAssetMatrixFilter(row))
  const typeFilteredRows = episodeFilteredRows.filter((row) => assetMatrixTypeFilter === 'all' || row.asset.type === assetMatrixTypeFilter)
  const issueCount = typeFilteredRows.reduce((sum, row) => sum + rowVisibleIssues(row).length, 0)
  const assetCenterUsageCount = typeFilteredRows.filter((row) => row.assetCenterChips.length > 0).length
  const missingAssetCenterCount = hubLoaded ? typeFilteredRows.filter(rowMissingAssetCenter).length : 0
  const unusedAssetCount = typeFilteredRows.filter((row) => rowVisibleEpisodeLabels(row).length === 0).length
  const variantAssetCount = typeFilteredRows.filter((row) => rowVisibleVariantLabels(row).length > 1).length
  const appearedAssetCount = typeFilteredRows.filter((row) => rowVisibleEpisodeLabels(row).length > 0).length
  const issueAssetCount = typeFilteredRows.filter((row) => rowHasVisibleIssue(row)).length
  const duplicateRiskCount = typeFilteredRows.filter((row) => rowHasDuplicateRisk(row)).length
  const missingMainReferenceCount = typeFilteredRows.filter((row) => rowNeedsMainReference(row)).length
  const missingVariantReferenceCount = typeFilteredRows.filter((row) => rowNeedsVariantReference(row)).length
  const libraryStatusCount = typeFilteredRows.filter((row) => rowHasLibraryStatusAttention(row)).length
  const libraryNewerCount = typeFilteredRows.filter((row) => rowHasNewerLibraryVersion(row)).length
  const libraryArchivedCount = typeFilteredRows.filter((row) => rowHasArchivedLibraryLink(row)).length
  const filteredRows = typeFilteredRows.filter((row) => rowMatchesAssetMatrixFilter(row))
  const assetMatrixScopeTotal = assetMatrixFilter === 'all' ? rows.length : typeFilteredRows.length
  const assetMatrixTypeOptions: { id: AssetMatrixTypeFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部类型', count: typeOptionRows.length },
    { id: 'role', label: '人物', count: typeOptionRows.filter((row) => row.asset.type === 'role').length },
    { id: 'scene', label: '场景', count: typeOptionRows.filter((row) => row.asset.type === 'scene').length },
    { id: 'prop', label: '物品', count: typeOptionRows.filter((row) => row.asset.type === 'prop').length },
  ]
  const assetMatrixEpisodeOptions = [
    { id: 'all', label: '全部剧集', count: episodeOptionRows.filter((row) => rowMatchesAssetMatrixFilter(row, 'all')).length },
    ...episodes.map((episode) => ({
      id: episode.id,
      label: `E${episode.index + 1}${episode.title ? ` ${episode.title}` : ''}`,
      count: episodeOptionRows.filter((row) => rowMatchesEpisode(row, episode.id) && rowMatchesAssetMatrixFilter(row, episode.id)).length,
    })),
  ]
  const assetMatrixFilterGroups: { label: string; options: { id: AssetMatrixFilter; label: string; count: number }[] }[] = [
    {
      label: '范围',
      options: [
        { id: 'all', label: '全部', count: typeFilteredRows.length },
        { id: 'appeared', label: '已出场', count: appearedAssetCount },
      ],
    },
    {
      label: '出场',
      options: [
        { id: 'unused', label: '未出场', count: unusedAssetCount },
        { id: 'variant', label: '多形态', count: variantAssetCount },
      ],
    },
    {
      label: '质量',
      options: [
        { id: 'issue', label: '连续性问题', count: issueAssetCount },
        { id: 'missingRef', label: '缺主图', count: missingMainReferenceCount },
        { id: 'missingVariantRef', label: '缺形态图', count: missingVariantReferenceCount },
      ],
    },
    {
      label: '身份',
      options: [
        { id: 'library', label: '身份状态', count: libraryStatusCount },
        { id: 'libraryNewer', label: '有新版', count: libraryNewerCount },
        { id: 'libraryArchived', label: '已归档', count: libraryArchivedCount },
        { id: 'duplicate', label: '重复身份', count: duplicateRiskCount },
      ],
    },
  ]
  if (hubLoaded) assetMatrixFilterGroups[3].options.push({ id: 'unlinked', label: '未入图谱', count: missingAssetCenterCount })
  const activeFilterOption = assetMatrixFilterGroups.flatMap((group) => group.options).find((option) => option.id === assetMatrixFilter)
  const activeEpisodeOption = assetMatrixEpisodeOptions.find((option) => option.id === assetMatrixEpisodeFilter)
  const activeTypeOption = assetMatrixTypeOptions.find((option) => option.id === assetMatrixTypeFilter)
  const activeFilterLabels = [
    assetMatrixSearchKey ? `搜索“${assetMatrixSearch.trim()}”` : undefined,
    assetMatrixEpisodeFilter !== 'all' ? activeEpisodeOption?.label ?? '当前剧集' : undefined,
    assetMatrixTypeFilter !== 'all' ? activeTypeOption?.label ?? '当前类型' : undefined,
    assetMatrixFilter !== 'all' ? activeFilterOption?.label ?? '当前' : undefined,
  ].filter(Boolean)
  const hasActiveAssetMatrixFilter = activeFilterLabels.length > 0
  const activeFilterLabel = activeFilterLabels.length ? activeFilterLabels.join(' / ') : '当前'
  const resetAssetMatrixFilters = () => {
    setAssetMatrixSearch('')
    setAssetMatrixEpisodeFilter('all')
    setAssetMatrixTypeFilter('all')
    setAssetMatrixFilter('all')
  }
  const jumpToAssetCard = (asset: Asset) => {
    const card = document.getElementById(studioAssetDomId(asset.id)) as HTMLElement | null
    if (!card) return
    card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    card.focus({ preventScroll: true })
  }
  const syncAssetMatrixLibraryEntity = (row: (typeof rows)[number]) => {
    if (!row.linkedEntity || row.linkedEntity.archived) return
    if (row.asset.libraryLink?.syncPolicy === 'forked') return
    if (!row.asset.libraryLink?.entityVersion || row.linkedEntity.version <= row.asset.libraryLink.entityVersion) return
    if (syncAssetFromLibraryEntity(row.asset.id, row.linkedEntity)) window.mulby?.notification?.show('已同步资产中心新版快照', 'success')
  }
  const publishAssetMatrixLibraryEntity = async (row: (typeof rows)[number]) => {
    if (!row.asset.refImageId || row.asset.libraryLink?.syncPolicy === 'forked' || row.linkedEntity?.archived) return
    await promoteAssetToElement(row.asset.id)
    await refreshAssetHub()
  }
  const generateAssetMatrixReference = (row: (typeof rows)[number]) => {
    if (row.asset.refImageId || row.asset.state === 'generating') return
    void generateAsset(row.asset.id)
  }
  const generateAssetMatrixVariantReference = (row: (typeof rows)[number], variantId: string) => {
    const variant = row.asset.variants?.find((item) => item.id === variantId)
    if (!row.asset.refImageId || !variant || variant.refImageId || variant.state === 'generating') return
    void generateAssetVariant(row.asset.id, variant.id)
  }
  const mergeAssetMatrixDuplicate = (row: (typeof rows)[number], targets: Asset[]) => {
    if (!targets.length) return
    let target = targets[0]
    if (targets.length > 1) {
      const options = targets.map((asset, index) => `${index + 1}. ${asset.name} (${asset.id})`).join('\n')
      const raw = window.prompt(`「${row.asset.name}」有多个可合并目标，选择要合并到的项目资产序号：\n${options}`, '1')?.trim()
      if (!raw) return
      const byIndex = Number(raw)
      const selected = Number.isFinite(byIndex)
        ? targets[Math.max(0, Math.floor(byIndex) - 1)]
        : targets.find((asset) => asset.id === raw || asset.name.toLowerCase() === raw.toLowerCase())
      if (!selected) return
      target = selected
    }
    if (!window.confirm(`把「${row.asset.name}」合并到「${target.name}」？分镜和每集计划引用会迁移到目标资产，源资产会从项目资产中移除。`)) return
    if (mergeProjectAssetInto(row.asset.id, target.id)) window.mulby?.notification?.show('已合并重复项目资产', 'success')
  }
  // 「疑似同一身份」现在只在项目资产之间比对；与资产中心身份的撞名提示挪到资产卡角标，不再进一致性报告
  const rowLibraryCandidateEntries = (_row: (typeof rows)[number]): { id: string; label: string }[] => []
  const linkAssetMatrixCandidateIdentity = (row: (typeof rows)[number]) => {
    const candidates = rowLibraryCandidateEntries(row)
    if (!candidates.length) return
    let candidate = candidates[0]
    if (candidates.length > 1) {
      const options = candidates.map((entry, index) => `${index + 1}. ${entry.label} (${entry.id})`).join('\n')
      const raw = window.prompt(`选择要关联的身份资产序号：\n${options}`, '1')?.trim()
      if (!raw) return
      const byIndex = Number(raw)
      const selected = Number.isFinite(byIndex)
        ? candidates[Math.max(0, Math.floor(byIndex) - 1)]
        : candidates.find((entry) => entry.id === raw || entry.label.toLowerCase() === raw.toLowerCase())
      if (!selected) return
      candidate = selected
    }
    const entity = hubEntities.find((item) => item.id === candidate.id)
    const linked = linkAssetToLibraryEntity(row.asset.id, {
      id: candidate.id,
      name: entity?.name ?? candidate.label,
      version: entity?.version,
      archived: entity?.archived,
      variants: entity?.variants?.map((variant) => ({ id: variant.id, label: variant.label })),
    })
    if (linked) window.mulby?.notification?.show('已关联身份资产快照', 'success')
  }
  const markAssetMatrixDistinctIdentity = (row: (typeof rows)[number]) => {
    const candidates = rowLibraryCandidateEntries(row)
    if (!candidates.length) return
    const names = candidates.map((entry) => entry.label).join('、')
    if (!window.confirm(`确认「${row.asset.name}」与候选身份（${names}）不是同一身份？之后这些候选不会再提示。`)) return
    if (markAssetAsDistinctIdentity(row.asset.id, candidates.map((entry) => entry.id))) window.mulby?.notification?.show('已标记为不同身份', 'success')
  }
  const typeLabel = (type: Asset['type']) => (type === 'role' ? '人物' : type === 'scene' ? '场景' : type === 'prop' ? '物品' : type)
  return (
    <div className="afs-studio__assetmatrix" aria-label="跨集资产一致性">
      <div className="afs-studio__assetmatrix-head">
        <b>跨集资产一致性</b>
        <span>{rows.length} 个资产</span>
        {appearedAssetCount > 0 && <span>{appearedAssetCount} 个已有分镜出场</span>}
        {unusedAssetCount > 0 && <span>{unusedAssetCount} 个尚未出场</span>}
        {variantAssetCount > 0 && <span>{variantAssetCount} 个用到多种形态</span>}
        {hubLoaded && assetCenterUsageCount > 0 && <span>{assetCenterUsageCount} 个有资产中心图谱</span>}
        {missingAssetCenterCount > 0 && <span className="is-warning">{missingAssetCenterCount} 个未入图谱</span>}
        {missingMainReferenceCount > 0 && <span className="is-warning">{missingMainReferenceCount} 个缺主图</span>}
        {missingVariantReferenceCount > 0 && <span className="is-warning">{missingVariantReferenceCount} 个缺形态图</span>}
        {duplicateRiskCount > 0 && <span className="is-warning">{duplicateRiskCount} 个重复身份风险</span>}
        {libraryStatusCount > 0 && <span className="is-warning">{libraryStatusCount} 个身份状态待确认</span>}
        {issueCount > 0 && <span className="is-warning">{issueCount} 个问题</span>}
        {hasActiveAssetMatrixFilter && <span className="afs-studio__assetmatrix-scope">当前显示 {filteredRows.length}/{assetMatrixScopeTotal}</span>}
        {hasActiveAssetMatrixFilter && <span className="afs-studio__assetmatrix-filterlabel" title={activeFilterLabel}>筛选：{activeFilterLabel}</span>}
        {hasActiveAssetMatrixFilter && (
          <button type="button" className="afs-studio__assetmatrix-clear" title="清空资产矩阵筛选" onClick={resetAssetMatrixFilters}>
            <X size={12} /> 清空
          </button>
        )}
        <span className="afs-studio__assetmatrix-spacer" />
        <span className="afs-studio__assetmatrix-filters" aria-label="资产矩阵筛选">
          <label className="afs-studio__assetmatrix-search">
            <Search size={13} />
            <input
              value={assetMatrixSearch}
              onChange={(event) => setAssetMatrixSearch(event.target.value)}
              placeholder="搜索名称/别名"
              aria-label="搜索资产名称或别名"
            />
          </label>
          <label className="afs-studio__assetmatrix-select">
            <span>剧集</span>
            <select value={assetMatrixEpisodeFilter} onChange={(event) => setAssetMatrixEpisodeFilter(event.target.value)} aria-label="按剧集筛选资产矩阵">
              {assetMatrixEpisodeOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label} {option.count}</option>
              ))}
            </select>
          </label>
          <span className="afs-studio__assetmatrix-filtergroup" role="group" aria-label="资产矩阵类型筛选">
            <em>类型</em>
            {assetMatrixTypeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={assetMatrixTypeFilter === option.id ? 'is-on' : ''}
                aria-pressed={assetMatrixTypeFilter === option.id}
                onClick={() => setAssetMatrixTypeFilter(option.id)}
              >
                {option.label} {option.count}
              </button>
            ))}
          </span>
          {assetMatrixFilterGroups.map((group) => (
            <span key={group.label} className="afs-studio__assetmatrix-filtergroup" role="group" aria-label={`资产矩阵${group.label}筛选`}>
              <em>{group.label}</em>
              {group.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={assetMatrixFilter === option.id ? 'is-on' : ''}
                  aria-pressed={assetMatrixFilter === option.id}
                  onClick={() => setAssetMatrixFilter(option.id)}
                >
                  {option.label} {option.count}
                </button>
              ))}
            </span>
          ))}
        </span>
      </div>
      <div className="afs-studio__assetmatrix-columns" aria-hidden="true">
        <span>资产</span>
        <span>出现剧集</span>
        <span>计划剧集</span>
        <span>使用形态</span>
        <span>计划形态</span>
        <span>资产中心</span>
        <span>状态</span>
      </div>
      <div className="afs-studio__assetmatrix-rows">
        {filteredRows.length === 0 && (
          <span className="afs-studio__assetmatrix-empty">
            当前没有符合「{activeFilterLabel}」筛选的资产
            {hasActiveAssetMatrixFilter && (
              <button type="button" onClick={resetAssetMatrixFilters}>
                显示全部
              </button>
            )}
          </span>
        )}
        {filteredRows.map((row) => {
          const visibleEpisodeLabels = rowVisibleEpisodeLabels(row)
          const visibleVariantLabels = rowVisibleVariantLabels(row)
          const visibleMissingVariantRefs = rowVisibleMissingVariantRefs(row)
          const visibleMissingVariantRefLabels = visibleMissingVariantRefs.map((entry) => entry.label)
          const firstGeneratableMissingVariantRef = visibleMissingVariantRefs.find((entry) => entry.state !== 'generating' && !!row.asset.refImageId)
          const generatingVariantRefCount = visibleMissingVariantRefs.filter((entry) => entry.state === 'generating').length
          const visibleIssues = rowVisibleIssues(row)
          const visibleDuplicateIssues = rowVisibleDuplicateIssues(row)
          const duplicateRelatedAssetIds = [...new Set(visibleDuplicateIssues.flatMap((issue) => issue.relatedAssetIds ?? []))]
          const mergeableDuplicateTargets = duplicateRelatedAssetIds
            .map((id) => doc.assets.find((asset) => asset.id === id))
            .filter((asset): asset is Asset => !!asset && asset.type === row.asset.type && !asset.parentAssetId)
          const libraryCandidateEntries = rowLibraryCandidateEntries(row)
          const duplicateRelatedAssetCount = duplicateRelatedAssetIds.length
          const duplicateIdentityCount = duplicateRelatedAssetCount
          return (
            <div key={row.asset.id} className={`afs-studio__assetmatrix-row${rowHasStatusWarning(row) ? ' is-warning' : ''}`}>
              <span className="afs-studio__assetmatrix-name" title={[row.asset.name, row.asset.aliases?.length ? `别名：${row.asset.aliases.join('、')}` : undefined].filter(Boolean).join('\n')}>
                <b>{row.asset.name}</b>
                <em>{typeLabel(row.asset.type)}</em>
                {!!row.asset.aliases?.length && <small>别名 {row.asset.aliases.length}</small>}
                <button
                  type="button"
                  className="afs-studio__assetmatrix-jump"
                  title={`定位到项目资产卡：${row.asset.name}`}
                  aria-label={`定位到项目资产卡：${row.asset.name}`}
                  onClick={() => jumpToAssetCard(row.asset)}
                >
                  <Link2 size={11} />
                </button>
              </span>
              <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 出现剧集`} title={assetMatrixChipsetTitle('出现剧集', visibleEpisodeLabels, '未出场')}>
                {visibleEpisodeLabels.length ? visibleEpisodeLabels.slice(0, 8).map((label) => <i key={label}>{label}</i>) : <i>未出场</i>}
                {visibleEpisodeLabels.length > 8 && <i>+{visibleEpisodeLabels.length - 8}</i>}
              </span>
              <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 使用形态`} title={assetMatrixChipsetTitle('使用形态', visibleVariantLabels, '未绑定形态')}>
                {visibleVariantLabels.length ? visibleVariantLabels.slice(0, 4).map((label) => <i key={label}>{label}</i>) : <i>未绑定形态</i>}
                {visibleVariantLabels.length > 4 && <i>+{visibleVariantLabels.length - 4}</i>}
              </span>
              <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 资产中心图谱`} title={[row.linkStatusLabels.length ? `身份状态：${row.linkStatusLabels.join('、')}` : undefined, assetCenterUsageTitle(row.assetCenterUsage)].filter(Boolean).join('\n')}>
                {row.linkStatusLabels.map((label) => (
                  <i key={label} className={`afs-studio__assetmatrix-linkstatus${ASSET_MATRIX_LINK_ATTENTION_LABELS.has(label) ? ' is-attention' : ''}`}>{label}</i>
                ))}
                {row.assetCenterChips.length ? row.assetCenterChips.slice(0, 3).map((label) => <i key={label}>{label}</i>) : <i>{hubLoaded ? '未入图谱' : '图谱加载中'}</i>}
                {row.assetCenterChips.length > 3 && <i>+{row.assetCenterChips.length - 3}</i>}
              </span>
              <span className="afs-studio__assetmatrix-status">
                {rowMissingAssetCenter(row) && (
                  <i className="afs-studio__assetmatrix-drift" title={`${row.asset.name} 尚未进入资产中心图谱`}>
                    未入图谱
                  </i>
                )}
                {visibleIssues.length > 0 && (
                  <i className="afs-studio__assetmatrix-issue" title={visibleIssues.slice(0, 4).map((issue) => issue.message).join('\n')}>
                    {visibleIssues.length} 问题
                  </i>
                )}
                {visibleDuplicateIssues.length > 0 && (
                  <i
                    className="afs-studio__assetmatrix-drift"
                    title={visibleDuplicateIssues.slice(0, 4).map((issue) => issue.message).join('\n')}
                  >
                    重复身份 {duplicateRelatedAssetCount || duplicateIdentityCount || visibleDuplicateIssues.length}
                  </i>
                )}
                {rowNeedsMainReference(row) && row.asset.state !== 'generating' && (
                  <i className="afs-studio__assetmatrix-drift" title={`${row.asset.name} 已进入计划或分镜，但还没有主参考图`}>
                    缺主图
                  </i>
                )}
                {visibleMissingVariantRefLabels.length > 0 && generatingVariantRefCount < visibleMissingVariantRefLabels.length && (
                  <i className="afs-studio__assetmatrix-drift" title={`缺少形态参考图：${visibleMissingVariantRefLabels.join('、')}`}>
                    缺形态图 {visibleMissingVariantRefLabels.length}
                  </i>
                )}
                {rowHasLibraryStatusAttention(row) && (
                  <i className="afs-studio__assetmatrix-drift" title={`身份状态：${row.linkStatusLabels.join('、')}`}>
                    身份状态 {row.linkStatusLabels.filter((label) => ASSET_MATRIX_LINK_ATTENTION_LABELS.has(label)).length}
                  </i>
                )}
                {row.asset.libraryLink?.syncPolicy !== 'forked' && row.linkedEntity && !row.linkedEntity.archived && row.asset.libraryLink?.entityVersion && row.linkedEntity.version > row.asset.libraryLink.entityVersion && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={`同步资产中心新版：v${row.asset.libraryLink.entityVersion} -> v${row.linkedEntity.version}`}
                    onClick={() => syncAssetMatrixLibraryEntity(row)}
                  >
                    同步
                  </button>
                )}
                {mergeableDuplicateTargets.length > 0 && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={
                      mergeableDuplicateTargets.length > 1
                        ? `合并到重复项目资产（${mergeableDuplicateTargets.length} 个候选目标）：${mergeableDuplicateTargets.map((asset) => asset.name).join('、')}`
                        : `合并到重复项目资产：${mergeableDuplicateTargets[0].name}`
                    }
                    onClick={() => mergeAssetMatrixDuplicate(row, mergeableDuplicateTargets)}
                  >
                    合并{mergeableDuplicateTargets.length > 1 ? ` ${mergeableDuplicateTargets.length}` : ''}
                  </button>
                )}
                {libraryCandidateEntries.length > 0 && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={`关联候选身份（${libraryCandidateEntries.length} 个候选）：${libraryCandidateEntries.map((entry) => entry.label).join('、')}`}
                    onClick={() => linkAssetMatrixCandidateIdentity(row)}
                  >
                    关联{libraryCandidateEntries.length > 1 ? ` ${libraryCandidateEntries.length}` : ''}
                  </button>
                )}
                {libraryCandidateEntries.length > 0 && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={`标记与候选身份不是同一身份：${libraryCandidateEntries.map((entry) => entry.label).join('、')}`}
                    onClick={() => markAssetMatrixDistinctIdentity(row)}
                  >
                    不同身份
                  </button>
                )}
                {rowMissingAssetCenter(row) && !!row.asset.refImageId && row.asset.libraryLink?.syncPolicy !== 'forked' && !row.linkedEntity?.archived && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={`发布到资产中心：${row.asset.name}`}
                    onClick={() => void publishAssetMatrixLibraryEntity(row)}
                  >
                    发布
                  </button>
                )}
                {!row.asset.refImageId && row.asset.state !== 'generating' && visibleEpisodeLabels.length > 0 && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={`生成主参考图：${row.asset.name}`}
                    onClick={() => generateAssetMatrixReference(row)}
                  >
                    生成图
                  </button>
                )}
                {!row.asset.refImageId && row.asset.state === 'generating' && (
                  <i className="afs-studio__assetmatrix-drift" title={`${row.asset.name} 主参考图生成中`}>
                    生成中
                  </i>
                )}
                {firstGeneratableMissingVariantRef && (
                  <button
                    type="button"
                    className="afs-studio__assetmatrix-action"
                    title={`生成形态参考图：${row.asset.name} / ${firstGeneratableMissingVariantRef.variantLabel}`}
                    onClick={() => generateAssetMatrixVariantReference(row, firstGeneratableMissingVariantRef.variantId)}
                  >
                    生成形态
                  </button>
                )}
                {generatingVariantRefCount > 0 && (
                  <i className="afs-studio__assetmatrix-drift" title={`${row.asset.name} 有 ${generatingVariantRefCount} 个形态参考图生成中`}>
                    形态生成中 {generatingVariantRefCount}
                  </i>
                )}
                {!rowHasStatusWarning(row) && (
                  <i className="afs-studio__assetmatrix-ok" title={`${row.asset.name} 当前没有计划差异、连续性问题、参考图缺口或资产中心图谱警告`}>
                    正常
                  </i>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VoiceLibrary() {
  const doc = useProjectStore((s) => s.doc)!
  const addVoice = useProjectStore((s) => s.addVoice)
  const voices = doc.assets.filter((a) => a.type === 'audio')
  return (
    <div className="afs-studio__assetgroup">
      <div className="afs-studio__assetgroup-head">
        <b>音色</b>
        <button className="afs-btn afs-btn--sm" onClick={() => addVoice({ name: `音色${voices.length + 1}` })}>
          <Plus size={14} /> 新增音色
        </button>
      </div>
      <div className="afs-studio__cardgrid">
        {voices.length === 0 && <span className="afs-studio__hint">暂无音色（先在「设置」配置 tts 供应商，再新增音色试听）</span>}
        {voices.map((v) => (
          <VoiceCard key={v.id} asset={v} />
        ))}
      </div>
    </div>
  )
}

function VoiceCard({ asset }: { asset: Asset }) {
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const synthVoice = useProjectStore((s) => s.synthVoice)
  const url = useMediaUrl(asset.audioUrl ? { url: asset.audioUrl } : asset.audioFilePath ? { localPath: asset.audioFilePath } : null)
  const providerVoices = listProviderVoices()
  return (
    <div className="afs-studio__voicecard">
      <input className="afs-studio__cardname" value={asset.name} onChange={(e) => upsertAsset({ id: asset.id, type: 'audio', name: e.target.value })} />
      <Select
        block
        value={asset.voice ?? ''}
        onChange={(val) => upsertAsset({ id: asset.id, type: 'audio', name: asset.name, voice: val })}
        options={[{ value: '', label: '（默认音色）' }, ...providerVoices.map((v) => ({ value: v, label: v }))]}
        ariaLabel="音色"
      />
      <input
        className="afs-studio__derivdesc"
        placeholder="音色描述（性别/音质/适配角色，供 AI 匹配）"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: 'audio', name: asset.name, desc: e.target.value })}
      />
      {url && <audio src={url} controls className="afs-studio__voiceaudio" />}
      <div className="afs-studio__cardactions">
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} title="合成试听" aria-label="合成试听" onClick={() => void synthVoice(asset.id)}>
          {asset.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" title="删除音色" aria-label="删除音色" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      {asset.state === 'failed' && <p className="afs-studio__sberr">{asset.error}</p>}
    </div>
  )
}

function AssetCard({ asset }: { asset: Asset }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const polishAsset = useProjectStore((s) => s.polishAsset)
  const addDerivative = useProjectStore((s) => s.addDerivative)
  const addAssetVariant = useProjectStore((s) => s.addAssetVariant)
  const bindRoleVoice = useProjectStore((s) => s.bindRoleVoice)
  const promoteAssetToElement = useProjectStore((s) => s.promoteAssetToElement)
  const hubLoaded = useAssetHubStore((s) => s.loaded)
  const hubEntities = useAssetHubStore((s) => s.entities)
  const refreshAssetHub = useAssetHubStore((s) => s.refresh)
  const canPromote = asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop'
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  const [showDeriv, setShowDeriv] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const children = doc.assets.filter((a) => a.parentAssetId === asset.id)
  const variants = asset.variants ?? []
  const voiceAssets = asset.type === 'role' ? doc.assets.filter((a) => a.type === 'audio') : []
  const linkedEntityId = asset.libraryLink?.entityId ?? asset.elementId
  const linkedEntity = linkedEntityId ? hubEntities.find((entity) => entity.id === linkedEntityId) : undefined
  const linkedEntityArchived = !!linkedEntity?.archived
  const forkedLibraryLink = asset.libraryLink?.syncPolicy === 'forked'
  const archivedLinkBlocksPublish = linkedEntityArchived && !forkedLibraryLink
  const linkedStatusLabels = projectAssetLinkStatusLabels(asset, linkedEntity)
  const publishActionLabel = forkedLibraryLink ? '另存为新身份资产' : '发布到资产中心'
  const publishActionTitle = !asset.refImageId
    ? '先生成或选择一张参考图'
    : archivedLinkBlocksPublish
      ? '关联身份已归档，恢复后才能更新'
      : forkedLibraryLink
        ? '已分叉资产会另存为新的身份资产'
        : '发布/更新到资产中心身份资产'
  useEffect(() => {
    if (linkedEntityId && !hubLoaded) void refreshAssetHub()
  }, [hubLoaded, linkedEntityId, refreshAssetHub])
  return (
    <div id={studioAssetDomId(asset.id)} className="afs-studio__assetcard" tabIndex={-1}>
      {viewer && asset.refImageId && (
        <StudioImageViewer
          assetId={asset.refImageId}
          prompt={asset.prompt ?? ''}
          onPromptChange={(v) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, prompt: v })}
          onRegenerate={() => void generateAsset(asset.id)}
          generating={asset.state === 'generating'}
          onClose={() => setViewer(false)}
        />
      )}
      <div
        className={`afs-studio__thumb${asset.refImageId ? ' afs-studio__thumb--zoom' : ''}`}
        title={asset.refImageId ? '双击放大查看 · 改提示词重新生成' : undefined}
        onDoubleClick={asset.refImageId ? () => setViewer(true) : undefined}
      >
        {asset.state === 'generating' ? (
          <Loader2 size={20} className="afs-spin" />
        ) : url ? (
          <img src={url} alt={asset.name} />
        ) : (
          <Users size={20} opacity={0.3} />
        )}
        {asset.state === 'failed' && (
          <span className="afs-studio__err" title={asset.error}>
            <AlertCircle size={14} />
          </span>
        )}
      </div>
      <input className="afs-studio__cardname" value={asset.name} onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: e.target.value })} />
      <input
        className="afs-studio__cardalias"
        value={(asset.aliases ?? []).join('、')}
        placeholder="别名（用顿号/逗号分隔）"
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, aliases: cleanAssetAliases(e.target.value) })}
      />
      {linkedEntityId && (
        <div className="afs-studio__assetlink" title="该项目资产来自资产中心的身份资产快照；生产仍使用项目内资产和变体">
          <BookmarkPlus size={12} />
          身份资产：{linkedEntity?.name ?? '已关联'}
          {asset.libraryLink?.entityVersion ? ` · v${asset.libraryLink.entityVersion}` : ''}
          {linkedStatusLabels.length ? ` · ${linkedStatusLabels.join(' · ')}` : ''}
        </div>
      )}
      <textarea
        className="afs-field__input afs-studio__carddesc"
        rows={2}
        placeholder="外貌/特征描述（中文）…"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, desc: e.target.value })}
      />
      <textarea
        className="afs-field__input afs-studio__cardprompt"
        rows={2}
        placeholder="英文生成提示词（点「润色」自动生成，可手改）…"
        value={asset.prompt ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, prompt: e.target.value })}
      />
      <AssetImageStrip asset={asset} />
      {asset.type === 'role' && voiceAssets.length > 0 && (
        <Select
          block
          className="afs-studio__voicesel"
          title="为该角色绑定音色"
          value={asset.voiceAssetId ?? ''}
          onChange={(val) => bindRoleVoice(asset.id, val || undefined)}
          options={[{ value: '', label: '（未配音）' }, ...voiceAssets.map((v) => ({ value: v.id, label: v.name }))]}
          ariaLabel="为该角色绑定音色"
        />
      )}
      <div className="afs-studio__cardactions">
        <button
          className="afs-btn afs-btn--sm"
          disabled={asset.promptState === 'polishing'}
          title="润色：按画风美术手册把描述生成英文提示词"
          aria-label="润色提示词"
          onClick={() => void polishAsset(asset.id)}
        >
          {asset.promptState === 'polishing' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />}
        </button>
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} title="生成图片" aria-label="生成图片" onClick={() => void generateAsset(asset.id)}>
          {asset.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <ImageIcon size={13} />}
        </button>
        <button
          className="afs-btn afs-btn--sm afs-btn--ghost"
          title={`形态/妆容/衍生变体${variants.length || children.length ? ` · ${variants.length + children.length}` : ''}`}
          aria-label="形态/妆容/衍生变体"
          onClick={() => setShowDeriv((v) => !v)}
        >
          <Users size={13} />
        </button>
        {canPromote && (
          <button
            className="afs-btn afs-btn--sm afs-btn--ghost"
            disabled={!asset.refImageId || promoting || archivedLinkBlocksPublish}
            title={publishActionTitle}
            aria-label={publishActionLabel}
            onClick={async () => {
              setPromoting(true)
              try {
                await promoteAssetToElement(asset.id)
                await refreshAssetHub()
              } finally {
                setPromoting(false)
              }
            }}
          >
            {promoting ? <Loader2 size={13} className="afs-spin" /> : <BookmarkPlus size={13} />}
          </button>
        )}
        <button className="afs-btn afs-btn--sm afs-btn--ghost" title="删除资产" aria-label="删除资产" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      {asset.promptState === 'failed' && <p className="afs-studio__sberr">润色失败：{asset.promptError}</p>}
      {showDeriv && (
        <div className="afs-studio__derivrow">
          {variants.map((variant) => (
            <AssetVariantCard key={variant.id} asset={asset} variant={variant} />
          ))}
          <button
            className="afs-btn afs-btn--sm afs-studio__derivadd"
            disabled={!asset.refImageId}
            title={asset.refImageId ? '新增可被分镜引用的形态/妆容' : '先生成父资产图片'}
            onClick={() => addAssetVariant(asset.id)}
          >
            <Plus size={13} /> 形态
          </button>
          {children.map((c) => (
            <DerivativeCard key={c.id} asset={c} />
          ))}
          <button className="afs-btn afs-btn--sm afs-studio__derivadd" disabled={!asset.refImageId} title={asset.refImageId ? '新增衍生变体' : '先生成父资产图片'} onClick={() => addDerivative(asset.id)}>
            <Plus size={13} /> 子资产
          </button>
        </div>
      )}
    </div>
  )
}

function AssetVariantCard({ asset, variant }: { asset: Asset; variant: AssetVariant }) {
  const doc = useProjectStore((s) => s.doc)!
  const updateAssetVariant = useProjectStore((s) => s.updateAssetVariant)
  const deleteAssetVariant = useProjectStore((s) => s.deleteAssetVariant)
  const generateAssetVariant = useProjectStore((s) => s.generateAssetVariant)
  const url = useMediaUrl(variant.refImageId ? { assetId: variant.refImageId } : null)
  // 形态没有"适用范围"了——它在哪些集生效由分镜上的变更点决定，这里只展示实际使用情况
  const usedInEpisodes = useMemo(() => {
    const labels = new Set<string>()
    const scan = (episode: Episode | undefined, storyboards: Storyboard[]) => {
      for (const storyboard of storyboards) {
        if (castRefsForStoryboard(storyboard).some((ref) => ref.assetId === asset.id && ref.variantId === variant.id)) {
          if (episode) labels.add(`E${episode.index + 1}`)
        }
      }
    }
    for (const episode of doc.episodes ?? []) {
      if (episode.id === doc.currentEpisodeId) continue
      scan(episode, episode.storyboards ?? [])
    }
    scan((doc.episodes ?? []).find((episode) => episode.id === doc.currentEpisodeId), doc.storyboards)
    return [...labels]
  }, [asset.id, variant.id, doc.episodes, doc.storyboards, doc.currentEpisodeId])
  return (
    <div className="afs-studio__deriv afs-studio__variantcard">
      <div className="afs-studio__derivthumb">
        {variant.state === 'generating' ? <Loader2 size={16} className="afs-spin" /> : url ? <img src={url} alt={variant.label} /> : <Users size={16} opacity={0.3} />}
        {variant.state === 'failed' && (
          <span className="afs-studio__err" title={variant.error}>
            <AlertCircle size={12} />
          </span>
        )}
      </div>
      <input className="afs-studio__derivname" value={variant.label} onChange={(e) => updateAssetVariant(asset.id, variant.id, { label: e.target.value })} />
      <Select
        size="sm"
        block
        className="afs-studio__variantkind"
        value={variant.variantKind ?? ''}
        options={VARIANT_KIND_OPTIONS}
        ariaLabel="形态类型"
        title="形态类型"
        onChange={(value) => updateAssetVariant(asset.id, variant.id, { variantKind: value ? (value as AssetVariant['variantKind']) : undefined })}
      />
      <input
        className="afs-studio__derivdesc"
        placeholder="妆容/服装/年龄/状态"
        value={variant.desc ?? ''}
        onChange={(e) => updateAssetVariant(asset.id, variant.id, { desc: e.target.value })}
      />
      <input
        className="afs-studio__derivdesc"
        placeholder="英文提示词（可选）"
        value={variant.prompt ?? ''}
        onChange={(e) => updateAssetVariant(asset.id, variant.id, { prompt: e.target.value })}
      />
      {usedInEpisodes.length > 0 && (
        <div className="afs-studio__variantepisodes" aria-label="实际出现剧集">
          <span className="afs-studio__variantlabel">出现于</span>
          <div className="afs-studio__variantchips">
            {usedInEpisodes.slice(0, 8).map((label) => <i key={label}>{label}</i>)}
            {usedInEpisodes.length > 8 && <i>+{usedInEpisodes.length - 8}</i>}
          </div>
        </div>
      )}
      <div className="afs-studio__derivactions">
        <button className="afs-btn afs-btn--sm" disabled={variant.state === 'generating' || !asset.refImageId} title="由主图生成该形态" onClick={() => void generateAssetVariant(asset.id, variant.id)}>
          {variant.state === 'generating' ? <Loader2 size={12} className="afs-spin" /> : <Wand2 size={12} />}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" title="删除形态" onClick={() => void deleteAssetVariant(asset.id, variant.id)}>
          <Trash2 size={12} />
        </button>
      </div>
      {variant.state === 'failed' && <p className="afs-studio__sberr">{variant.error}</p>}
    </div>
  )
}

function DerivativeCard({ asset }: { asset: Asset }) {
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const generateDerivative = useProjectStore((s) => s.generateDerivative)
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  return (
    <div className="afs-studio__deriv">
      <div className="afs-studio__derivthumb">
        {asset.state === 'generating' ? <Loader2 size={16} className="afs-spin" /> : url ? <img src={url} alt={asset.name} /> : <Users size={16} opacity={0.3} />}
        {asset.state === 'failed' && (
          <span className="afs-studio__err" title={asset.error}>
            <AlertCircle size={12} />
          </span>
        )}
      </div>
      <input className="afs-studio__derivname" value={asset.name} onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: e.target.value })} />
      <input
        className="afs-studio__derivdesc"
        placeholder="变体描述（如：红色礼服 / 受伤狼狈）"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, desc: e.target.value })}
      />
      <div className="afs-studio__derivactions">
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} title="由父图 img2img 生成变体" onClick={() => void generateDerivative(asset.id)}>
          {asset.state === 'generating' ? <Loader2 size={12} className="afs-spin" /> : <Wand2 size={12} />}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

function AssetImageStrip({ asset }: { asset: Asset }) {
  const selectAssetImage = useProjectStore((s) => s.selectAssetImage)
  const deleteAssetImage = useProjectStore((s) => s.deleteAssetImage)
  const imgs = asset.images ?? []
  if (imgs.length < 2) return null
  return (
    <div className="afs-studio__imgstrip" title="历史候选图：点击设为当前，× 删除">
      {imgs.map((im) => (
        <ImageStripThumb
          key={im.id}
          refImageId={im.refImageId}
          selected={im.id === asset.currentImageId}
          onSelect={() => selectAssetImage(asset.id, im.id)}
          onDelete={() => void deleteAssetImage(asset.id, im.id)}
        />
      ))}
    </div>
  )
}

function ImageStripThumb({ refImageId, selected, onSelect, onDelete }: { refImageId: string; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const url = useMediaUrl({ assetId: refImageId })
  return (
    <div className={`afs-studio__imgthumb${selected ? ' is-sel' : ''}`}>
      {url ? <img src={url} alt="" onClick={onSelect} /> : <span className="afs-studio__imgph" onClick={onSelect} />}
      <button title="删除此图" onClick={onDelete}>
        <X size={10} />
      </button>
    </div>
  )
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = src
  })
}

/** 分镜墙（§4.6）：把关键帧拼成 S## 编号网格，纯前端 Canvas 2D 合成 + 导出 PNG（零新依赖）。 */
function StoryboardWall({ onClose }: { onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const items = [...doc.storyboards].sort((a, b) => a.index - b.index).filter((s) => s.keyframeImageId)
      const COLS = 5,
        CW = 320,
        CH = 180,
        PAD = 8,
        LBL = 22
      const rows = Math.max(1, Math.ceil(items.length / COLS))
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = COLS * (CW + PAD) + PAD
      canvas.height = rows * (CH + LBL + PAD) + PAD
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < items.length; i++) {
        if (cancelled) return
        const col = i % COLS
        const row = Math.floor(i / COLS)
        const x = PAD + col * (CW + PAD)
        const y = PAD + row * (CH + LBL + PAD)
        try {
          const url = await loadAssetUrl(items[i].keyframeImageId!)
          if (url) {
            const img = await loadImageEl(url)
            if (cancelled) return
            ctx.drawImage(img, x, y, CW, CH)
          }
        } catch {
          // 单张失败留空
        }
        ctx.fillStyle = '#fff'
        ctx.font = '14px sans-serif'
        ctx.fillText(`S${String(i + 1).padStart(2, '0')}`, x + 4, y + CH + 16)
      }
      if (!cancelled) setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [doc.storyboards])
  const download = () => {
    const c = canvasRef.current
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `${(doc.meta.name || 'storyboard').replace(/\s+/g, '_')}_wall.png`
    a.click()
  }
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__wall" onClick={(e) => e.stopPropagation()}>
        <div className="afs-studio__drawer-head">
          <span>故事板{busy ? ' · 合成中…' : ''}</span>
          <div>
            <button className="afs-btn afs-btn--sm" disabled={busy} onClick={download}>
              导出 PNG
            </button>
            <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={onClose} title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="afs-studio__wallbody">
          <canvas ref={canvasRef} className="afs-studio__wallcanvas" />
        </div>
      </div>
    </div>
  )
}

function StoryboardTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const generateAllKeyframes = useProjectStore((s) => s.generateAllKeyframes)
  const generateAllClips = useProjectStore((s) => s.generateAllClips)
  const batch = useProjectStore((s) => s.batch)
  const hasKeyframes = doc.storyboards.some((s) => s.keyframeImageId)
  const continuity = useStudioContinuityReport(doc)
  // 场景组变化度：抓"每镜单看都对、整组放一起像同一张图"这类同质化，现有护栏覆盖不到
  const variation = useMemo(() => checkSceneVariation(doc.storyboards.map(storyboardToVariationShot)), [doc.storyboards])
  const [showWall, setShowWall] = useState(false)
  const [showContinuity, setShowContinuity] = useState(false)
  return (
    <div className="afs-studio__storyboard">
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" onClick={() => upsertStoryboard({ videoDesc: '' })}>
          <Plus size={14} /> 新增分镜
        </button>
        <button
          className="afs-btn afs-btn--sm"
          disabled={batch.running || doc.storyboards.length === 0}
          onClick={() => void generateAllKeyframes()}
        >
          <Wand2 size={14} /> 全部关键帧
        </button>
        <button className="afs-btn afs-btn--sm" disabled={batch.running || !hasKeyframes} onClick={() => void generateAllClips()}>
          <Film size={14} /> 全部视频
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" disabled={!hasKeyframes} title="把关键帧拼成故事板网格，可导出 PNG" onClick={() => setShowWall(true)}>
          <Clapperboard size={14} /> 预览故事板
        </button>
      </div>
      <ContinuityNotice report={continuity} onOpen={() => setShowContinuity(true)} />
      <SceneVariationNotice issues={variation.issues} />
      {showWall && <StoryboardWall onClose={() => setShowWall(false)} />}
      {showContinuity && <ContinuityDetailsDrawer report={continuity} onClose={() => setShowContinuity(false)} />}
      <div className="afs-studio__sblist">
        {doc.storyboards.length === 0 && <p className="afs-studio__hint">暂无分镜（让右侧 AI 制片自动拆解，或手动新增）。</p>}
        {[...doc.storyboards]
          .sort((a, b) => a.index - b.index)
          .map((s, i, arr) => (
            <StoryboardItem key={s.id} sb={s} index={i} total={arr.length} />
          ))}
      </div>
    </div>
  )
}

/**
 * 场景组同质化提醒。不进连续性报告——那份报告管的是"资产是不是同一个人"，
 * 这里管的是"这一组镜头值不值得分开拍"，是两类问题，混在一起会让两边都变模糊。
 */
function SceneVariationNotice({ issues }: { issues: SceneVariationIssue[] }) {
  const [open, setOpen] = useState(false)
  if (!issues.length) return null
  const high = issues.filter((issue) => issue.severity === 'high').length
  return (
    <div className={`afs-studio__variation${high ? ' is-warning' : ''}`}>
      <div className="afs-studio__variation-head">
        <AlertTriangle size={13} aria-hidden />
        <b>{issues.length} 个场景组镜头同质</b>
        <span className="afs-studio__hint">整组景别/机位/构图机制变化不足，成片会像同一张图配不同台词</span>
        <span className="afs-series__spacer" />
        <button type="button" className="afs-studio__continuityopen" onClick={() => setOpen((value) => !value)}>
          {open ? '收起' : '查看'}
        </button>
      </div>
      {open && (
        <ul className="afs-studio__variation-list">
          {issues.map((issue) => (
            <li key={`${issue.sceneId}-${issue.shotIndexes.join('-')}`}>
              <b>#{issue.shotIndexes.join(' #')}</b>
              <span>{issue.message}</span>
              <em>{issue.suggestion}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type ContinuityReportView = ReturnType<typeof buildContinuityReport>

function ContinuityNotice({ report, onOpen }: { report: ContinuityReportView; onOpen: () => void }) {
  const issues = report.issues
  if (!issues.length) return null
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const visible = issues.slice(0, 3)
  return (
    <div className={`afs-studio__continuity${errors.length ? ' is-error' : ' is-warning'}`}>
      <AlertTriangle size={15} />
      <div className="afs-studio__continuitybody">
        <div className="afs-studio__continuityhead">
          <span>一致性检查：{errors.length} 错误 / {warnings.length} 警告</span>
          <button type="button" className="afs-studio__continuityopen" onClick={onOpen}>
            查看全部
          </button>
        </div>
        <div className="afs-studio__continuitylist">
          {visible.map((issue, index) => (
            <span key={`${issue.code}-${index}`}>{issue.message}</span>
          ))}
          {issues.length > visible.length && <span>还有 {issues.length - visible.length} 项</span>}
        </div>
      </div>
    </div>
  )
}

function continuityIssueVariantKindChips(issue: ContinuityReportView['issues'][number]): string[] {
  return issue.expectedVariantLabel ? [`应为 ${issue.expectedVariantLabel}`] : []
}

const CATEGORY_ORDER: ContinuityCategory[] = ['blocking', 'appearance', 'identity', 'scene', 'coverage', 'hint']
/** 每类默认只展开这么多条：一个根因常常产出几十条同形状的问题，全列出来没人看得下去 */
const COLLAPSED_ISSUE_COUNT = 5

/**
 * 一致性抽屉：按 6 个分类分组，每类最多两个修复动作。
 *
 * 旧版是 619 行、31 个问题码各配一套按钮的巨型 switch。问题码收敛之后，
 * 真正需要人做的决定只剩三种：补图 / 这算不算剧情变化 / 这两个资产是不是同一个人。
 */
function ContinuityDetailsDrawer({ report, onClose }: { report: ContinuityReportView; onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const generateAssetVariant = useProjectStore((s) => s.generateAssetVariant)
  const setAppearanceChange = useProjectStore((s) => s.setAppearanceChange)
  const revertAppearanceToInherited = useProjectStore((s) => s.revertAppearanceToInherited)
  const setStoryboardCastVariant = useProjectStore((s) => s.setStoryboardCastVariant)
  const splitVariantByBase = useProjectStore((s) => s.splitVariantByBase)
  const mergeProjectAssetInto = useProjectStore((s) => s.mergeProjectAssetInto)
  const distributeNovelChaptersAcrossEpisodes = useProjectStore((s) => s.distributeNovelChaptersAcrossEpisodes)
  const busy = useProjectStore((s) => s.batch.running || s.film.state === 'composing')
  const [expandedCategories, setExpandedCategories] = useState<Set<ContinuityCategory>>(new Set())

  const grouped = useMemo(() => {
    const map = new Map<ContinuityCategory, ContinuityReportView['issues']>()
    for (const issue of report.issues) map.set(issue.category, [...(map.get(issue.category) ?? []), issue])
    return CATEGORY_ORDER.filter((category) => map.has(category)).map((category) => ({ category, issues: map.get(category)! }))
  }, [report.issues])

  const errorCount = report.issues.filter((issue) => issue.severity === 'error').length
  const warningCount = report.issues.filter((issue) => issue.severity === 'warning').length
  const canRedistributeChapters = doc.novel.length > 0 && (doc.episodes?.length ?? 0) > 1

  const assetOf = (assetId?: string) => (assetId ? doc.assets.find((item) => item.id === assetId) : undefined)

  /** 承认这是剧情里的变化：把当前形态登记为变更点，后续镜头一起沿用 */
  const confirmChange = (issue: ContinuityReportView['issues'][number]) => {
    if (!issue.storyboardId || !issue.assetId) return
    const asset = assetOf(issue.assetId)
    const label = issue.variantId ? asset?.variants?.find((item) => item.id === issue.variantId)?.label ?? issue.variantId : '主形象'
    const reason = window.prompt(`「${asset?.name ?? issue.assetId}」从这一镜起变成「${label}」，原因是？`, '剧情中的换装/状态变化')
    if (!reason?.trim()) return
    setAppearanceChange(issue.storyboardId, { assetId: issue.assetId, toVariantId: issue.variantId, reason: reason.trim() })
  }

  /** 否认变化：回到台账推导的继承形态 */
  const keepInherited = (issue: ContinuityReportView['issues'][number]) => {
    if (!issue.storyboardId || !issue.assetId) return
    revertAppearanceToInherited(issue.storyboardId, issue.assetId)
  }

  const mergeIdentity = (issue: ContinuityReportView['issues'][number]) => {
    const target = assetOf(issue.assetId)
    const sources = (issue.relatedAssetIds ?? []).map(assetOf).filter((item): item is Asset => !!item)
    if (!target || !sources.length) return
    if (!window.confirm(`把 ${sources.map((item) => item.name).join('、')} 合并进「${target.name}」？分镜引用会一并改写。`)) return
    for (const source of sources) mergeProjectAssetInto(source.id, target.id)
  }

  const renameAsset = (issue: ContinuityReportView['issues'][number]) => {
    const asset = assetOf(issue.assetId)
    if (!asset) return
    const name = window.prompt(`给「${asset.name}」改一个不冲突的名字`, asset.name)
    if (!name?.trim() || name.trim() === asset.name) return
    upsertAsset({ id: asset.id, type: asset.type, name: name.trim() })
  }

  /** 把整个场景组统一到同一个场景资产 */
  const unifyScene = (issue: ContinuityReportView['issues'][number]) => {
    if (!issue.assetId || !issue.storyboardIds?.length) return
    for (const storyboardId of issue.storyboardIds) setStoryboardCastVariant(storyboardId, issue.assetId, undefined)
  }

  const fixesFor = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code === 'missing_ref_image' && issue.assetId) {
      return [
        issue.variantId
          ? { label: '生成形态图', run: () => void generateAssetVariant(issue.assetId!, issue.variantId!) }
          : { label: '生成参考图', run: () => void generateAsset(issue.assetId!) },
      ]
    }
    if (issue.code === 'unexplained_appearance_change') {
      return [
        { label: '确认是剧情变化', run: () => confirmChange(issue) },
        { label: `沿用${issue.expectedVariantLabel ?? '上一形态'}`, run: () => keepInherited(issue) },
      ]
    }
    if (issue.code === 'ambiguous_variant_base' && issue.assetId && issue.variantId) {
      const labels = issue.baseVariantLabels ?? []
      return [
        {
          label: `拆成 ${labels.length} 个形态`,
          run: () => {
            if (!window.confirm(`把这个形态按 ${labels.join('、')} 拆成 ${labels.length} 个独立形态？\n第一种保留原形态和它的参考图，其余会新建并需要重新出图。`)) return
            const created = splitVariantByBase(issue.assetId!, issue.variantId!)
            if (created) window.mulby?.notification?.show(`已拆出 ${created} 个新形态，记得补参考图`, 'success')
          },
        },
      ]
    }
    if (issue.code === 'duplicate_identity') {
      return [
        { label: '合并为同一资产', run: () => mergeIdentity(issue) },
        { label: '改名区分', run: () => renameAsset(issue) },
      ]
    }
    if (issue.code === 'scene_asset_inconsistent') {
      return [{ label: '统一场景资产', run: () => unifyScene(issue) }]
    }
    if (issue.code === 'chapter_coverage' && canRedistributeChapters) {
      return [
        {
          label: '重新均分章节',
          run: () => {
            if (window.confirm('按章节顺序重新均分到现有剧集？这会覆盖当前拆章。')) distributeNovelChaptersAcrossEpisodes()
          },
        },
      ]
    }
    return []
  }

  /**
   * 整类批量修复。一个根因常常产出几十条同形状的问题（比如一批资产都没出图），
   * 让用户点四十次「生成参考图」是没有道理的。
   */
  const bulkFixFor = (category: ContinuityCategory, issues: ContinuityReportView['issues']) => {
    if (category === 'blocking') {
      const missing = issues.filter((issue) => issue.code === 'missing_ref_image' && issue.assetId)
      if (!missing.length) return undefined
      return {
        label: `生成全部缺失参考图（${missing.length}）`,
        run: async () => {
          // 先补主图再补形态图：形态是从主图 img2img 派生的，顺序反了会失败
          const mains = [...new Set(missing.filter((issue) => !issue.variantId).map((issue) => issue.assetId!))]
          for (const assetId of mains) await generateAsset(assetId)
          const variants = missing.filter((issue) => issue.variantId)
          for (const issue of variants) await generateAssetVariant(issue.assetId!, issue.variantId!)
        },
      }
    }
    if (category === 'appearance') {
      // 只对"未说明的形态变化"批量回退；ambiguous_variant_base 要逐个决定拆不拆
      const fixable = issues.filter((issue) => issue.code === 'unexplained_appearance_change' && issue.storyboardId && issue.assetId)
      if (!fixable.length) return undefined
      return {
        label: `全部沿用上一形态（${fixable.length}）`,
        run: async () => {
          if (!window.confirm(`把这 ${fixable.length} 处形态变化都当作"不是剧情变化"，回退为沿用上一镜？`)) return
          for (const issue of fixable) revertAppearanceToInherited(issue.storyboardId!, issue.assetId!)
        },
      }
    }
    return undefined
  }

  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__continuitymodal" onClick={(e) => e.stopPropagation()}>
        <div className="afs-studio__continuityhead">
          <b>连续性检查</b>
          <span className="afs-studio__hint">
            {errorCount > 0 ? `${errorCount} 个阻断项` : '无阻断项'}
            {warningCount > 0 ? ` · ${warningCount} 个提醒` : ''}
          </span>
          <span className="afs-series__spacer" />
          <IconButton size="sm" variant="ghost" aria-label="关闭" icon={<X size={16} />} onClick={onClose} />
        </div>

        {report.issues.length === 0 ? (
          <p className="afs-stwb__handoff-empty">没有发现连续性问题。</p>
        ) : (
          <div className="afs-studio__continuitybody">
            {grouped.map(({ category, issues }) => {
              const bulk = bulkFixFor(category, issues)
              const expanded = expandedCategories.has(category)
              const shown = expanded ? issues : issues.slice(0, COLLAPSED_ISSUE_COUNT)
              const hidden = issues.length - shown.length
              return (
              <section key={category} className="afs-studio__continuitysection">
                <h4>
                  {CATEGORY_LABEL[category]}
                  <i>{issues.length}</i>
                  {category === 'blocking' && <em>生成前必须解决</em>}
                  {category === 'appearance' && <em>形态默认沿用上一镜，这些镜头变了但没说明原因</em>}
                  {category === 'hint' && <em>不影响生成</em>}
                  <span className="afs-series__spacer" />
                  {bulk && (
                    <button type="button" className="afs-stwb__handoff-action afs-stwb__handoff-action--bulk" disabled={busy} onClick={() => void bulk.run()}>
                      <Wand2 size={11} /> {bulk.label}
                    </button>
                  )}
                </h4>
                <div className="afs-studio__continuityissues">
                  {shown.map((issue, index) => {
                    const fixes = fixesFor(issue)
                    return (
                      <article key={`${issue.code}-${issue.storyboardId ?? issue.assetId ?? index}`} className={`afs-studio__continuityissue is-${issue.severity}`}>
                        <p>{issue.message}</p>
                        {continuityIssueVariantKindChips(issue).length > 0 && (
                          <div className="afs-stwb__handoff-chips">
                            {continuityIssueVariantKindChips(issue).map((chip) => <span key={chip}>{chip}</span>)}
                          </div>
                        )}
                        {fixes.length > 0 && (
                          <div className="afs-studio__continuityactions">
                            {fixes.map((fix) => (
                              <button key={fix.label} type="button" className="afs-stwb__handoff-action" disabled={busy} onClick={fix.run}>
                                {fix.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </article>
                    )
                  })}
                  {hidden > 0 && (
                    <button
                      type="button"
                      className="afs-studio__continuitymore"
                      onClick={() => setExpandedCategories((prev) => new Set([...prev, category]))}
                    >
                      展开另外 {hidden} 条同类问题
                    </button>
                  )}
                  {expanded && issues.length > COLLAPSED_ISSUE_COUNT && (
                    <button
                      type="button"
                      className="afs-studio__continuitymore"
                      onClick={() => setExpandedCategories((prev) => new Set([...prev].filter((item) => item !== category)))}
                    >
                      收起
                    </button>
                  )}
                </div>
              </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function StoryboardItem({ sb, index, total }: { sb: Storyboard; index: number; total: number }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const removeStoryboard = useProjectStore((s) => s.removeStoryboard)
  const moveStoryboard = useProjectStore((s) => s.moveStoryboard)
  const generateKeyframe = useProjectStore((s) => s.generateKeyframe)
  const generateClip = useProjectStore((s) => s.generateClip)
  const setStoryboardCastVariant = useProjectStore((s) => s.setStoryboardCastVariant)
  const [showFlow, setShowFlow] = useState(false)
  const [viewer, setViewer] = useState(false)
  const [gridViewer, setGridViewer] = useState(false)
  const url = useMediaUrl(sb.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  // 取该分镜所属段的「选用/最新」候选片段，反映状态（一镜多生后不再是唯一片段）
  const track = doc.track.find((t) => t.storyboardIds.includes(sb.id))
  const clipId = track ? track.selectClipId || track.clipIds[track.clipIds.length - 1] : undefined
  const clip = clipId ? doc.clips.find((c) => c.id === clipId) : undefined
  const candCount = track?.clipIds.length ?? 0
  const roleAssets = doc.assets.filter((a) => !a.parentAssetId && a.type !== 'audio') // 出场资产候选：角色/场景/物品
  const charAssets = doc.assets.filter((a) => a.type === 'role' && !a.parentAssetId) // 说话人候选：仅角色（+旁白）
  const dialogues = sb.dialogues ?? []
  const castRefs = castRefsForStoryboard(sb)
  // 所有形态都可选：某一镜用哪个由变更点决定，不再按"适用范围"筛掉选项
  const variantScope = (_variant: AssetVariant) => ({ current: true, label: '可用', title: '选中后会成为本镜的形态；若与上一镜不同会提示登记变更原因' })
  const variantGroupsForAsset = (asset: Asset) => {
    const currentOptions = [
      { value: '', label: '主形象', title: '不使用妆容/服装/时期变体' },
      ...(asset.variants ?? [])
        .filter((variant) => variantScope(variant).current)
        .map((variant) => {
          const scope = variantScope(variant)
          const kind = variantKindLabel(variant.variantKind)
          return {
            value: variant.id,
            label: `${variantLabelWithKind(variant.label, variant.variantKind)} · ${scope.label}`,
            title: [scope.title, kind ? `类型：${kind}` : '', variant.desc].filter(Boolean).join(' · '),
          }
        }),
    ]
    const otherOptions = (asset.variants ?? [])
      .filter((variant) => !variantScope(variant).current)
      .map((variant) => {
        const scope = variantScope(variant)
        const kind = variantKindLabel(variant.variantKind)
        return {
          value: variant.id,
          label: `${variantLabelWithKind(variant.label, variant.variantKind)} · ${scope.label}`,
          title: [scope.title, kind ? `类型：${kind}` : '', variant.desc].filter(Boolean).join(' · '),
        }
      })
    return otherOptions.length
      ? [
          { label: '当前可用', options: currentOptions },
          { label: '其他剧集', options: otherOptions },
        ]
      : [{ label: '当前可用', options: currentOptions }]
  }
  // 统一改字段：保留 videoDesc 必填，合并其余 Partial
  const patch = (p: Partial<Storyboard>) => upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, ...p })
  const setDlg = (dlgs: { character: string; line: string; emotion?: string }[]) => patch({ dialogues: dlgs })
  const toggleCast = (id: string) => {
    const has = sb.associateAssetIds.includes(id)
    const associateAssetIds = has ? sb.associateAssetIds.filter((x) => x !== id) : [...sb.associateAssetIds, id]
    patch({
      associateAssetIds,
      castRefs: associateAssetIds.map((assetId) => sb.castRefs?.find((ref) => ref.assetId === assetId) ?? { assetId }),
    })
  }
  const variantForAsset = (assetId: string) => castRefs.find((ref) => ref.assetId === assetId)?.variantId ?? ''
  return (
    <div className="afs-studio__sbcard">
      {gridViewer && sb.gridImageId && (
        <StudioImageViewer
          assetId={sb.gridImageId}
          prompt={sb.gridError ? `宫格失败：${sb.gridError}` : '宫格分镜板原图（本组关键帧从这张切出）'}
          onPromptChange={() => {}}
          onRegenerate={() => setGridViewer(false)}
          generating={false}
          onClose={() => setGridViewer(false)}
        />
      )}
      {viewer && sb.keyframeImageId && (
        <StudioImageViewer
          assetId={sb.keyframeImageId}
          prompt={sb.prompt ?? ''}
          onPromptChange={(v) => patch({ prompt: v })}
          onRegenerate={() => void generateKeyframe(sb.id)}
          generating={sb.state === 'generating'}
          onClose={() => setViewer(false)}
        />
      )}
      <div className="afs-studio__sbmain">
        {/* 左：大缩略图（按项目画幅显示真实方向）+ 导航 */}
        <div className="afs-studio__sbcol">
          <div
            className="afs-studio__sbthumb"
            style={{ aspectRatio: (doc.meta.videoRatio || '16:9').replace(':', ' / ') }}
            title={sb.keyframeImageId ? '双击放大查看 · 改提示词重新生成' : undefined}
            onDoubleClick={sb.keyframeImageId ? () => setViewer(true) : undefined}
          >
            {sb.state === 'generating' ? <Loader2 size={22} className="afs-spin" /> : url ? <img src={url} alt="" /> : <Clapperboard size={24} opacity={0.3} />}
            {sb.gridImageId && (
              <button
                type="button"
                className={`afs-studio__sbgrid${sb.gridError ? ' is-error' : ''}`}
                title={sb.gridError ? `宫格失败，已回退逐镜：${sb.gridError}\n点击查看模型实际画出的原图` : '查看本组宫格分镜板原图'}
                aria-label="查看宫格原图"
                onClick={(e) => {
                  e.stopPropagation()
                  setGridViewer(true)
                }}
              >
                {sb.gridError ? <AlertTriangle size={11} /> : <Clapperboard size={11} />} 宫格
              </button>
            )}
            <span className="afs-studio__sbnum">{index + 1}</span>
            {sb.state === 'failed' && (
              <span className="afs-studio__err" title={sb.error}>
                <AlertCircle size={13} />
              </span>
            )}
          </div>
          <div className="afs-studio__sbnav">
            <button className="afs-studio__move" disabled={index === 0} title="上移" onClick={() => moveStoryboard(sb.id, -1)}>
              <ChevronUp size={15} />
            </button>
            <button className="afs-studio__move" disabled={index === total - 1} title="下移" onClick={() => moveStoryboard(sb.id, 1)}>
              <ChevronDown size={15} />
            </button>
            {index > 0 && (
              <button
                className={`afs-studio__chain${sb.chainFromPrev ? ' is-on' : ''}`}
                title={sb.chainFromPrev ? '承接上一镜（关键帧由上一帧派生，连贯）— 点击关闭' : '与上一镜硬切 — 点击设为承接'}
                onClick={() => patch({ chainFromPrev: !sb.chainFromPrev })}
              >
                <Link2 size={12} />
              </button>
            )}
          </div>
        </div>
        {/* 右：字段（默认全部展开） */}
        <div className="afs-studio__sbfields">
          <div className="afs-studio__sbhead">
            <label className="afs-studio__sbinline">
              时长
              <input type="number" min={1} max={15} value={sb.duration} onChange={(e) => patch({ duration: Number(e.target.value) || 5 })} />秒
            </label>
            <label className="afs-studio__sbinline">
              景别
              <Select
                size="sm"
                value={sb.shotSize ?? ''}
                onChange={(val) => patch({ shotSize: val || undefined })}
                options={[{ value: '', label: '—' }, ...SHOT_SIZES.map((s) => ({ value: s, label: s }))]}
                ariaLabel="景别"
              />
            </label>
            <label className="afs-studio__sbinline">
              运镜
              <Select
                size="sm"
                value={sb.cameraMove ?? ''}
                onChange={(val) => patch({ cameraMove: val || undefined })}
                options={[{ value: '', label: '—' }, ...CAMERA_MOVES.map((m) => ({ value: m, label: m }))]}
                ariaLabel="运镜"
              />
            </label>
            <label className="afs-studio__sbinline">
              轨道
              <input value={sb.track} onChange={(e) => patch({ track: e.target.value })} />
            </label>
            <span className="afs-studio__sbspacer" />
            <button className="afs-btn afs-btn--sm afs-btn--ghost" title="删除分镜" onClick={() => removeStoryboard(sb.id)}>
              <Trash2 size={13} />
            </button>
          </div>
          <label className="afs-studio__sbfieldlbl">画面描述</label>
          <textarea
            className="afs-field__input"
            rows={2}
            value={sb.videoDesc}
            placeholder="主体 + 动作 + 环境 + 情绪 + 光影…"
            onChange={(e) => upsertStoryboard({ id: sb.id, videoDesc: e.target.value })}
          />
          <label className="afs-studio__sbfieldlbl" title="英文关键帧提示词，可空；点「精修」或让 AI 制片生成">
            关键帧提示词 <span className="afs-studio__lblhint">英文 · 可空</span>
          </label>
          <textarea
            className="afs-field__input afs-studio__cardprompt"
            rows={2}
            value={sb.prompt ?? ''}
            placeholder="english keyframe prompt…"
            onChange={(e) => patch({ prompt: e.target.value })}
          />
          <label className="afs-studio__sbfieldlbl">出场资产</label>
          <div className="afs-studio__castchips">
            {roleAssets.length === 0 && <span className="afs-studio__hint">暂无资产（去「资产」新增）</span>}
            {roleAssets.map((a) => (
              <div key={a.id} className="afs-studio__castpick">
                <CastChip asset={a} on={sb.associateAssetIds.includes(a.id)} onToggle={() => toggleCast(a.id)} />
                {sb.associateAssetIds.includes(a.id) && (a.variants?.length ?? 0) > 0 && (
                  <Select
                    size="sm"
                    className="afs-studio__castvariant"
                    value={variantForAsset(a.id)}
                    onChange={(variantId) => setStoryboardCastVariant(sb.id, a.id, variantId || undefined)}
                    groups={variantGroupsForAsset(a)}
                    ariaLabel={`${a.name} 形态`}
                  />
                )}
              </div>
            ))}
          </div>
          <label className="afs-studio__sbfieldlbl">对白</label>
          {dialogues.length === 0 && <span className="afs-studio__hint">暂无对白</span>}
          {dialogues.map((d, i) => (
            <DialogueLine
              key={i}
              d={d}
              charAssets={charAssets}
              onChange={(nd) => setDlg(dialogues.map((x, j) => (j === i ? nd : x)))}
              onRemove={() => setDlg(dialogues.filter((_, j) => j !== i))}
            />
          ))}
          <button className="afs-btn afs-btn--sm afs-studio__dlgadd" onClick={() => setDlg([...dialogues, { character: '', line: '' }])}>
            <Plus size={12} /> 加台词
          </button>
        </div>
      </div>
      {/* 底部：生成操作 */}
      <div className="afs-studio__sbbar">
        <button className="afs-btn afs-btn--sm" disabled={sb.state === 'generating'} onClick={() => void generateKeyframe(sb.id)}>
          {sb.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 关键帧
        </button>
        <button
          className="afs-btn afs-btn--sm"
          disabled={!sb.keyframeImageId || clip?.state === 'generating'}
          title={!sb.keyframeImageId ? '先生成关键帧' : '由关键帧生成视频片段（可多生选优）'}
          onClick={() => void generateClip(sb.id)}
        >
          {clip?.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Film size={13} />} 视频
          {candCount > 1 ? `(${candCount})` : ''}
          {clip?.state === 'done' && <Check size={13} style={{ color: 'var(--afs-success)' }} />}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" title="精修关键帧（多参考图融合）" onClick={() => setShowFlow(true)}>
          <Settings2 size={13} /> 精修
        </button>
        {clip?.state === 'failed' && (
          <span className="afs-studio__sberr" title={clip.error || '视频生成失败'}>
            <AlertCircle size={13} /> 视频失败
          </span>
        )}
      </div>
      {showFlow && <ImageFlowEditor sb={sb} onClose={() => setShowFlow(false)} />}
    </div>
  )
}

function CastChip({ asset, on, onToggle }: { asset: Asset; on: boolean; onToggle: () => void }) {
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  const TYPE_TXT: Record<string, string> = { role: '角', scene: '景', prop: '物' }
  return (
    <button className={`afs-studio__castchip${on ? ' is-on' : ''}`} onClick={onToggle} title={`${asset.name}（${on ? '出场，点击移除' : '点击加入出场'}）`}>
      <span className="afs-studio__castav">{url ? <img src={url} alt="" /> : <span>{TYPE_TXT[asset.type] ?? asset.name.slice(0, 1)}</span>}</span>
      <span className="afs-studio__castnm">{asset.name}</span>
    </button>
  )
}

type Dlg = { character: string; line: string; emotion?: string }

function SpeakerAv({ asset }: { asset: Asset }) {
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  return <span className="afs-studio__castav">{url ? <img src={url} alt="" /> : <span>{asset.name.slice(0, 1)}</span>}</span>
}

/** 对白行：说话人 = 角色头像药丸 + 旁白（单选，非下拉）；下面是台词 + 情绪。 */
function DialogueLine({ d, charAssets, onChange, onRemove }: { d: Dlg; charAssets: Asset[]; onChange: (d: Dlg) => void; onRemove: () => void }) {
  const opts: { name: string; asset?: Asset }[] = [...charAssets.map((a) => ({ name: a.name, asset: a })), { name: '旁白' }]
  const extra = d.character && !opts.some((o) => o.name === d.character) ? d.character : '' // 保留已有的非列表说话人（如 Agent 写入/已删角色）
  return (
    <div className="afs-studio__dlg">
      <div className="afs-studio__dlgtop">
        <div className="afs-studio__dlgspk">
          {opts.map((o) => (
            <button key={o.name} className={`afs-studio__spk${d.character === o.name ? ' is-on' : ''}`} title={o.name} onClick={() => onChange({ ...d, character: o.name })}>
              {o.asset && <SpeakerAv asset={o.asset} />}
              <span className="afs-studio__spknm">{o.name}</span>
            </button>
          ))}
          {extra && (
            <button className="afs-studio__spk is-on" title={extra} onClick={() => onChange({ ...d, character: extra })}>
              <span className="afs-studio__spknm">{extra}</span>
            </button>
          )}
        </div>
        <button className="afs-studio__dlgdel" title="删除台词" onClick={onRemove}>
          <X size={13} />
        </button>
      </div>
      <div className="afs-studio__dlgbody">
        <input className="afs-studio__dlglinein" placeholder="台词…" value={d.line} onChange={(e) => onChange({ ...d, line: e.target.value })} />
        <input className="afs-studio__dlgemo" placeholder="情绪" value={d.emotion ?? ''} onChange={(e) => onChange({ ...d, emotion: e.target.value })} />
      </div>
    </div>
  )
}

function ImageFlowEditor({ sb, onClose }: { sb: Storyboard; onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const refineKeyframe = useProjectStore((s) => s.refineKeyframe)
  const byAssetId = new Map(doc.assets.map((a) => [a.id, a]))
  const assets = doc.assets.filter((a) => a.refImageId)
  const [sel, setSel] = useState<string[]>(() =>
    castRefsForStoryboard(sb)
      .map((ref) => refImageIdForCastRef(byAssetId.get(ref.assetId), ref))
      .filter((x): x is string => !!x)
  )
  const [prompt, setPrompt] = useState(sb.prompt || sb.videoDesc || '')
  const kfUrl = useMediaUrl(sb.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  const toggle = (refImageId: string) => setSel((s) => (s.includes(refImageId) ? s.filter((x) => x !== refImageId) : [...s, refImageId]))
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__flowedit" onClick={(e) => e.stopPropagation()}>
        <div className="afs-studio__drawer-head">
          <span>关键帧精修 · 多参考图融合</span>
          <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="afs-studio__flowbody">
          <div className="afs-studio__flowrefs">
            <div className="afs-studio__sbfieldlbl">参考图（勾选要融合的资产/已出图）</div>
            <div className="afs-studio__flowgrid">
              {assets.length === 0 && <span className="afs-studio__hint">暂无已出图资产</span>}
              {assets.map((a) => (
                <FlowRef key={a.id} asset={a} selected={!!a.refImageId && sel.includes(a.refImageId)} onToggle={() => a.refImageId && toggle(a.refImageId)} />
              ))}
            </div>
          </div>
          <div className="afs-studio__flowmain">
            {kfUrl && <img className="afs-studio__flowkf" src={kfUrl} alt="当前关键帧" />}
            <textarea className="afs-field__input" rows={4} value={prompt} placeholder="精修指令（保留参考图主体，改 xxx）…" onChange={(e) => setPrompt(e.target.value)} />
            <button className="afs-btn afs-btn--gradient afs-btn--sm" disabled={sb.state === 'generating' || !prompt.trim()} onClick={() => void refineKeyframe(sb.id, sel, prompt)}>
              {sb.state === 'generating' ? <Loader2 size={14} className="afs-spin" /> : <Wand2 size={14} />} 生成并设为关键帧
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FlowRef({ asset, selected, onToggle }: { asset: Asset; selected: boolean; onToggle: () => void }) {
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  return (
    <div className={`afs-studio__flowref${selected ? ' is-sel' : ''}`} onClick={onToggle} title={asset.name}>
      {url ? <img src={url} alt={asset.name} /> : <Users size={16} opacity={0.3} />}
      <span>{asset.name}</span>
    </div>
  )
}

function TimelineTab() {
  const doc = useProjectStore((s) => s.doc)!
  const compose = useProjectStore((s) => s.compose)
  const film = useProjectStore((s) => s.film)
  const batch = useProjectStore((s) => s.batch)
  const generateAllTrackPrompts = useProjectStore((s) => s.generateAllTrackPrompts)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const [preview, setPreview] = useState<{ localPath?: string; url?: string } | null>(null)
  const tracks = [...doc.track].sort((a, b) => a.order - b.order)
  const composeReadiness = episodeComposeReadiness(doc)
  const composeTitle = composeReadiness.ready
    ? '合成当前集成片'
    : composeReadiness.total
      ? `仍有 ${composeReadiness.missingStoryboardIndexes.length} 个分镜缺少可用视频片段`
      : '没有可合成的视频片段'
  if (tracks.length === 0)
    return (
      <div className="afs-studio__timeline">
        <p className="afs-studio__hint">还没有分镜。去「分镜」新增镜头并生成关键帧 → 视频，每段可多生候选、选优后合成。</p>
      </div>
    )
  return (
    <div className="afs-studio__timeline">
      <div className="afs-studio__timeline-head">
        <p className="afs-studio__hint">{tracks.length} 段 · 每段可多生候选、选优后合成</p>
        <button className="afs-btn afs-btn--sm" disabled={batch.running || !tracks.some((t) => t.storyboardIds.length)} title="按模型+模式批量生成各段视频提示词" onClick={() => void generateAllTrackPrompts()}>
          {batch.running ? <Loader2 size={14} className="afs-spin" /> : <Wand2 size={14} />} 全部段提示词
        </button>
        <Select
          className="afs-studio__sel"
          title="整片转场"
          value={doc.meta.transition ?? 'fade'}
          onChange={(v) => updateMeta({ transition: v as 'none' | 'fade' | 'xfade' })}
          options={[
            { value: 'fade', label: '淡入淡出' },
            { value: 'xfade', label: '交叉溶解' },
            { value: 'none', label: '硬切' },
          ]}
          ariaLabel="整片转场"
        />
        <button className="afs-btn afs-btn--gradient afs-btn--sm" disabled={film.state === 'composing' || !composeReadiness.ready} title={composeTitle} onClick={() => void compose()}>
          {film.state === 'composing' ? <Loader2 size={14} className="afs-spin" /> : <Film size={14} />} 合成成片
        </button>
      </div>
      {film.state === 'composing' && <p className="afs-studio__hint">{film.text}</p>}
      {film.state === 'failed' && <p className="afs-studio__err-text">合成失败：{film.error}</p>}
      <div className="afs-studio__tracklist">
        {tracks.map((t, i) => (
          <TrackCard key={t.id} track={t} order={i} onPreview={(c) => setPreview({ localPath: c.videoFilePath, url: c.videoUrl })} />
        ))}
      </div>
      {film.state === 'done' && film.path && <FilmDone path={film.path} name={doc.meta.name} />}
      {preview && <ClipPreview localPath={preview.localPath} url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  )
}

function TrackCard({ track, order, onPreview }: { track: VideoTrack; order: number; onPreview: (c: Clip) => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const selectClip = useProjectStore((s) => s.selectClip)
  const deleteClip = useProjectStore((s) => s.deleteClip)
  const updateTrackDuration = useProjectStore((s) => s.updateTrackDuration)
  const updateTrackPrompt = useProjectStore((s) => s.updateTrackPrompt)
  const generateTrackPrompt = useProjectStore((s) => s.generateTrackPrompt)
  const generateClip = useProjectStore((s) => s.generateClip)
  const sb = track.storyboardIds.length ? doc.storyboards.find((s) => s.id === track.storyboardIds[0]) : undefined
  const kf = useMediaUrl(sb?.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  const cands = track.clipIds.map((id) => doc.clips.find((c) => c.id === id)).filter(Boolean) as Clip[]
  const selId = track.selectClipId || track.clipIds[0]
  const generating = cands.some((c) => c.state === 'generating')
  return (
    <div className="afs-studio__trackcard">
      <div className="afs-studio__trackcard-head">
        <span className="afs-studio__sbidx">{order + 1}</span>
        {kf ? <img className="afs-studio__trackkf" src={kf} alt="" /> : <Clapperboard size={16} opacity={0.3} />}
        <span className="afs-studio__trackdesc" title={sb?.videoDesc}>{sb?.videoDesc || '（无分镜）'}</span>
        <label className="afs-studio__trackdur" title="段时长（秒），留空用分镜推荐时长">
          <input
            type="number"
            min={1}
            max={15}
            value={track.duration ?? ''}
            placeholder={String(sb?.duration ?? 5)}
            onChange={(e) => updateTrackDuration(track.id, e.target.value ? Number(e.target.value) : undefined)}
          />
          s
        </label>
        <button
          className="afs-btn afs-btn--sm"
          disabled={!sb?.keyframeImageId || generating}
          title={!sb?.keyframeImageId ? '先生成关键帧' : cands.length ? '再生成一个候选（一镜多生选优）' : '由关键帧生成视频'}
          onClick={() => sb && void generateClip(sb.id)}
        >
          {generating ? <Loader2 size={13} className="afs-spin" /> : <Film size={13} />} {cands.length ? '再生一版' : '生成视频'}
        </button>
      </div>
      <div className="afs-studio__trackprompt">
        <textarea
          className="afs-field__input"
          rows={2}
          value={track.prompt ?? ''}
          placeholder="段视频提示词（按模型+模式生成，可手改；留空则用画面描述）…"
          onChange={(e) => updateTrackPrompt(track.id, e.target.value)}
        />
        <button
          className="afs-btn afs-btn--sm"
          disabled={track.promptState === 'generating' || !sb}
          title="按视频模型 + 模式生成段视频提示词（12 字段拆解 / 台词标注 / @图N）"
          onClick={() => void generateTrackPrompt(track.id)}
        >
          {track.promptState === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 提示词
        </button>
      </div>
      {track.promptState === 'failed' && <p className="afs-studio__sberr">提示词生成失败：{track.promptError}</p>}
      {cands.length > 0 && (
        <div className="afs-studio__candrow">
          {cands.map((c) => (
            <CandidateClip
              key={c.id}
              clip={c}
              selected={c.id === selId}
              onSelect={() => selectClip(track.id, c.id)}
              onPreview={() => onPreview(c)}
              onDelete={() => deleteClip(track.id, c.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CandidateClip({ clip, selected, onSelect, onPreview, onDelete }: { clip: Clip; selected: boolean; onSelect: () => void; onPreview: () => void; onDelete: () => void }) {
  const src = useMediaUrl({ localPath: clip.videoFilePath, url: clip.videoUrl })
  return (
    <div className={`afs-studio__cand${selected ? ' is-sel' : ''}`}>
      {clip.state === 'generating' ? (
        <div className="afs-studio__cand-load">
          <Loader2 size={16} className="afs-spin" />
        </div>
      ) : clip.state === 'failed' ? (
        <div className="afs-studio__cand-load" title={clip.error || '生成失败'}>
          <AlertCircle size={16} />
        </div>
      ) : (
        <video src={src} muted playsInline preload="metadata" onClick={onSelect} title="点击设为当选" />
      )}
      {selected && <span className="afs-studio__cand-badge">当选</span>}
      <div className="afs-studio__cand-actions">
        <button title="设为当选" onClick={onSelect} aria-label="设为当选">
          <Check size={14} />
        </button>
        <button title="预览（有声）" onClick={onPreview}>
          <Film size={11} />
        </button>
        <button title="删除候选" onClick={onDelete}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

/** 图片放大查看：大图 + 原始提示词（可改）+ 重新生成。资产图 / 分镜关键帧双击进入。 */
function StudioImageViewer({
  assetId,
  prompt,
  onPromptChange,
  onRegenerate,
  generating,
  onClose,
}: {
  assetId: string
  prompt: string
  onPromptChange: (v: string) => void
  onRegenerate: () => void
  generating: boolean
  onClose: () => void
}) {
  const url = useMediaUrl({ assetId })
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__imgviewer" onClick={(e) => e.stopPropagation()}>
        <button className="afs-studio__lightbox-close" onClick={onClose} title="关闭">
          <X size={16} />
        </button>
        <div className="afs-studio__imgviewer-media">{url ? <img src={url} alt="" /> : <Loader2 size={24} className="afs-spin" />}</div>
        <div className="afs-studio__imgviewer-panel">
          <label className="afs-studio__sbfieldlbl">提示词（可修改后重新生成）</label>
          <textarea
            className="afs-field__input"
            value={prompt}
            placeholder="生成提示词…"
            onChange={(e) => onPromptChange(e.target.value)}
          />
          <button className="afs-btn afs-btn--gradient afs-btn--sm" disabled={generating} onClick={onRegenerate}>
            {generating ? <Loader2 size={13} className="afs-spin" /> : <RotateCcw size={13} />} 重新生成
          </button>
        </div>
      </div>
    </div>
  )
}

function ClipPreview({ localPath, url, onClose }: { localPath?: string; url?: string; onClose: () => void }) {
  const src = useMediaUrl({ localPath, url })
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__lightbox-body" onClick={(e) => e.stopPropagation()}>
        <button className="afs-studio__lightbox-close" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        {/* controls + 有声（不静音）→ 单独预览该片段 */}
        <video src={src} controls autoPlay playsInline className="afs-studio__lightbox-video" />
      </div>
    </div>
  )
}

function FilmPreview({ path }: { path: string }) {
  const src = useMediaUrl({ localPath: path })
  return <video className="afs-studio__filmvideo" src={src} controls preload="metadata" />
}

function FilmDone({ path, name }: { path: string; name: string }) {
  const openFolder = () => void window.mulby?.shell?.showItemInFolder(path)
  const saveAs = async () => {
    try {
      const dest = await window.mulby?.dialog?.showSaveDialog({
        title: '另存成片',
        defaultPath: `${(name || 'film').replace(/\s+/g, '_')}.mp4`,
        filters: [{ name: '视频', extensions: ['mp4'] }],
      })
      if (!dest) return
      const data = await window.mulby?.filesystem?.readFile(path, 'base64')
      if (typeof data === 'string') await window.mulby?.filesystem?.writeFile(dest, data, 'base64')
      window.mulby?.notification?.show('已另存成片', 'success')
    } catch (e) {
      window.mulby?.notification?.show('另存失败：' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }
  return (
    <div className="afs-studio__film">
      <FilmPreview path={path} />
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" onClick={openFolder}>
          <Film size={13} /> 打开所在文件夹
        </button>
        <button className="afs-btn afs-btn--sm" onClick={() => void saveAs()}>
          <BookOpen size={13} /> 另存为…
        </button>
      </div>
      <p className="afs-studio__hint">成片已导出：{path}</p>
    </div>
  )
}
