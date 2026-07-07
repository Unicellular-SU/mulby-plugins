/**
 * 工作台 · 分阶段编辑器：顶栏（项目设置）+ 阶段 Tab（剧本/资产/分镜/时间线）+ Agent 对话面板占位。
 * 阶段2c 骨架：剧本 Tab 已可编辑落盘；资产/分镜/时间线为列表+新增占位，生成与 Agent 在阶段3 接入。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileText, Users, Clapperboard, Film, Bot, Plus, Wand2, Loader2, AlertCircle, AlertTriangle, Trash2, Link2, BookOpen, Settings2, Settings, PanelLeft, ChevronUp, ChevronDown, X, Check, Download, Image as ImageIcon, RotateCcw, BookmarkPlus, Pencil, PauseCircle, PlayCircle, Copy } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { useGraphStore } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { useAssetHubStore } from '../store/assetHubStore'
import { DND_ASSET, DND_ELEMENT } from '../components/NodeLibrary'
import { listStylePacks } from '../services/stylePacks'
import { useMediaUrl } from '../services/mediaUrl'
import { libraryEntityToElement, projectAssetIdentityUsageFromHub, type IdentityAssetUsage } from '../services/assetHub'
import type { Asset, AssetVariant, Storyboard, VideoTrack, Clip, Episode, EpisodePlan, ProjectDoc } from '../domain/types'
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
import { buildContinuityReport, variantScopePatchForUse } from './services/continuityReport'
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
  return useMemo(() => buildContinuityReport(doc, hubLoaded ? { libraryEntities: hubEntities } : undefined), [doc, hubLoaded, hubEntities])
}

function projectAssetLinkStatusLabels(asset: Asset, linkedEntity?: { version: number; archived?: boolean }): string[] {
  const labels: string[] = []
  const link = asset.libraryLink
  if (!link && asset.elementId) labels.push('旧链接')
  if (link?.syncPolicy === 'forked') labels.push('已分叉')
  else if (link?.syncPolicy === 'linked') labels.push('已关联')
  else if (link?.syncPolicy === 'snapshot') labels.push('快照')
  if (link?.entityVersion && linkedEntity && linkedEntity.version > link.entityVersion) labels.push('有新版')
  if (linkedEntity?.archived) labels.push('已归档')
  return labels
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

export default function StudioEditor({ onHome }: { onHome: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const closeProject = useProjectStore((s) => s.closeProject)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const batch = useProjectStore((s) => s.batch)
  const film = useProjectStore((s) => s.film)
  const autoProduce = useProjectStore((s) => s.autoProduce)
  const autoProduceSeries = useProjectStore((s) => s.autoProduceSeries)
  const pauseSeriesProduction = useProjectStore((s) => s.pauseSeriesProduction)
  const busy = batch.running || film.state === 'composing'
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
        {busy && (
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

function handoffEpisodeLabel(doc: ProjectDoc, episodeId: string): string {
  const episode = doc.episodes?.find((item) => item.id === episodeId)
  return episode ? `E${episode.index + 1}` : episodeId
}

function EpisodeHandoffPopover({ doc, episode }: { doc: ProjectDoc; episode: Episode }) {
  const actionBusy = useProjectStore((s) => s.batch.running || s.film.state === 'composing')
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const addAssetVariant = useProjectStore((s) => s.addAssetVariant)
  const updateAssetVariant = useProjectStore((s) => s.updateAssetVariant)
  const generateAssetVariant = useProjectStore((s) => s.generateAssetVariant)
  const setStoryboardCastVariant = useProjectStore((s) => s.setStoryboardCastVariant)
  const handoff = useMemo(() => buildEpisodeProductionHandoff(doc, episode), [doc, episode])
  const plannedCount = handoff.plannedAssets.length + handoff.plannedVariants.length
  const hasHints = plannedCount > 0 || handoff.recaps.length > 0 || handoff.sharedAssets.length > 0 || handoff.suggestions.length > 0
  const autoSuggestions = handoff.suggestions.filter((suggestion) => suggestion.autoRepairable !== false && !suggestion.disabledReason)
  const runSuggestion = async (suggestion: (typeof handoff.suggestions)[number]) => {
    await applyEpisodeHandoffSuggestion(episode, suggestion, {
      getDoc: () => useProjectStore.getState().doc,
      generateAsset,
      generateAssetVariant,
      updateAssetVariant,
      addAssetVariant,
      setStoryboardCastVariant,
    })
  }
  const runAutoSuggestions = async () => {
    const attempted = new Set<string>()
    for (let i = 0; i < 24; i += 1) {
      const latestDoc = useProjectStore.getState().doc
      const latestEpisode = latestDoc?.episodes?.find((item) => item.id === episode.id)
      if (!latestDoc || !latestEpisode) break
      const suggestion = buildEpisodeProductionHandoff(latestDoc, latestEpisode).suggestions.find((item) => item.autoRepairable !== false && !item.disabledReason && !attempted.has(item.id))
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
      ariaLabel="跨集承接线索"
      trigger={
        <IconButton
          size="sm"
          variant="ghost"
          className={hasHints ? 'afs-stwb__handoff-trigger is-active' : 'afs-stwb__handoff-trigger'}
          aria-label="查看跨集承接线索"
          title={hasHints ? '查看本集计划输入、制作回顾和复用资产线索' : '暂无跨集承接线索'}
          icon={<BookmarkPlus size={16} />}
        />
      }
    >
      <div className="afs-stwb__handoff">
        <div className="afs-stwb__handoff-head">
          <b>E{episode.index + 1} 跨集承接</b>
          <span>{plannedCount} 个计划输入 · {handoff.recaps.length} 条回顾 · {handoff.sharedAssets.length} 个复用资产 · {handoff.suggestions.length} 条建议</span>
        </div>
        {!hasHints && <p className="afs-stwb__handoff-empty">当前集还没有计划输入、制作回顾或跨集复用资产。</p>}
        {plannedCount > 0 && (
          <section className="afs-stwb__handoff-sec">
            <h4>本集计划输入</h4>
            <div className="afs-stwb__handoff-list">
              {handoff.plannedAssets.map((asset) => (
                <article key={`planned-asset-${asset.assetId}`} className={`afs-stwb__handoff-item afs-stwb__handoff-plan${asset.refImageId ? '' : ' is-warning'}`}>
                  <strong>{asset.assetName}</strong>
                  <p>
                    {handoffAssetTypeLabel(asset.assetType)}
                    {' · '}
                    {asset.refImageId ? '已有主参考图' : '缺主参考图'}
                    {asset.requiredVariantIds.length > 0 ? ` · 要求 ${asset.requiredVariantIds.length} 个形态` : ''}
                  </p>
                </article>
              ))}
              {handoff.plannedVariants.map((variant) => {
                const scopeLabels = variant.appliesToEpisodeIds?.map((episodeId) => handoffEpisodeLabel(doc, episodeId)) ?? []
                return (
                  <article key={`planned-variant-${variant.assetId}-${variant.variantId}`} className={`afs-stwb__handoff-item afs-stwb__handoff-plan${variant.refImageId && variant.scopeAppliesToEpisode ? '' : ' is-warning'}`}>
                    <strong>{variant.assetName}-{variant.variantLabel}</strong>
                    <p>
                      计划形态
                      {' · '}
                      {variant.refImageId ? '已有形态图' : '缺形态图'}
                      {' · '}
                      {variant.scopeAppliesToEpisode ? '已适用本集' : '未标记适用本集'}
                    </p>
                    {scopeLabels.length > 0 && (
                      <div className="afs-stwb__handoff-chips">
                        {scopeLabels.map((label) => <span key={label}>作用域 {label}</span>)}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>
        )}
        {handoff.suggestions.length > 0 && (
          <section className="afs-stwb__handoff-sec">
            <div className="afs-stwb__handoff-secbar">
              <h4>建议处理</h4>
              <button
                type="button"
                className="afs-stwb__handoff-action afs-stwb__handoff-action--bulk"
                disabled={actionBusy || autoSuggestions.length === 0}
                title={autoSuggestions.length ? `顺序执行 ${autoSuggestions.length} 条可自动处理建议` : '没有可自动处理的建议'}
                onClick={() => void runAutoSuggestions()}
              >
                <Wand2 size={11} />
                一键处理
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
                    {suggestion.kind === 'create_episode_variant' ? <Plus size={11} /> : <Wand2 size={11} />}
                    {suggestion.kind === 'add_variant_episode_scope' ? '标记适用' : suggestion.kind === 'create_episode_variant' ? '新建并应用' : '执行'}
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
        {handoff.sharedAssets.length > 0 && (
          <section className="afs-stwb__handoff-sec">
            <h4>资产/形态复用</h4>
            <div className="afs-stwb__handoff-list">
              {handoff.sharedAssets.map((cue) => (
                <article key={cue.assetId + cue.label} className="afs-stwb__handoff-item">
                  <strong>{cue.label}</strong>
                  {cue.detail && <p>{cue.detail}</p>}
                  <div className="afs-stwb__handoff-chips">
                    {cue.appearances.map((item) => (
                      <span key={item.episodeId} title={item.recap || `${item.episodeTitle} 使用 ${item.variants.join('、')}`}>
                        E{item.episodeIndex + 1} {item.variants.join('、')}
                      </span>
                    ))}
                  </div>
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

const splitRuleLines = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

function toggleId(list: string[] | undefined, id: string): string[] {
  const set = new Set(list ?? [])
  if (set.has(id)) set.delete(id)
  else set.add(id)
  return [...set]
}

function episodePlanInputCount(plan: EpisodePlan | undefined): number {
  return (plan?.requiredAssetIds?.length ?? 0) + (plan?.requiredVariantIds?.length ?? 0)
}

function episodePlanInputPatch(plan: EpisodePlan | undefined): Partial<EpisodePlan> {
  return {
    requiredAssetIds: [...(plan?.requiredAssetIds ?? [])],
    requiredVariantIds: [...(plan?.requiredVariantIds ?? [])],
  }
}

type SeriesPlanFilter = 'all' | 'unplanned' | 'risk' | 'ready'
type AssetMatrixFilter = 'all' | 'drift' | 'issue' | 'unlinked'

function SeriesTab() {
  const doc = useProjectStore((s) => s.doc)!
  const updateSeriesBible = useProjectStore((s) => s.updateSeriesBible)
  const updateEpisodePlan = useProjectStore((s) => s.updateEpisodePlan)
  const createEpisodes = useProjectStore((s) => s.createEpisodes)
  const hubLoaded = useAssetHubStore((s) => s.loaded)
  const usageByEntity = useAssetHubStore((s) => s.usageByEntity)
  const refreshHub = useAssetHubStore((s) => s.refresh)
  const [seriesPlanFilter, setSeriesPlanFilter] = useState<SeriesPlanFilter>('all')
  useEffect(() => {
    if (!hubLoaded) void refreshHub()
  }, [hubLoaded, refreshHub])
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const bible = doc.seriesBible ?? { continuityRules: [], plannedEpisodeCount: episodes.length || 1 }
  const plannedCount = bible.plannedEpisodeCount ?? (episodes.length || 1)
  const assetOptions = doc.assets
    .filter((asset) => (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop') && !asset.parentAssetId)
    .map((asset) => {
      const assetCenterUsage = hubLoaded ? projectAssetIdentityUsageFromHub(doc, asset, usageByEntity) : undefined
      return { asset, hasRefImage: !!asset.refImageId, assetCenterUsage, assetCenterChips: assetCenterUsageChips(assetCenterUsage) }
    })
  const variantOptions = assetOptions.flatMap((asset) =>
    (asset.asset.variants ?? []).map((variant) => ({
      id: variant.id,
      assetId: asset.asset.id,
      label: `${asset.asset.name} / ${variantLabelWithKind(variant.label, variant.variantKind)}`,
      title: [variantKindLabel(variant.variantKind) ? `类型：${variantKindLabel(variant.variantKind)}` : '', variant.desc].filter(Boolean).join(' · '),
      hasRefImage: !!variant.refImageId,
      appliesToEpisodeIds: variant.appliesToEpisodeIds ?? [],
      assetCenterUsage: asset.assetCenterUsage,
      assetCenterChips: asset.assetCenterChips,
    }))
  )
  const assetOptionById = new Map(assetOptions.map((option) => [option.asset.id, option]))
  const variantOptionById = new Map(variantOptions.map((option) => [option.id, option]))
  const fillEpisodes = () => {
    const missing = Math.max(0, plannedCount - episodes.length)
    if (missing > 0) createEpisodes(missing)
  }
  const patchPlan = (episode: Episode, patch: Partial<EpisodePlan>) => updateEpisodePlan(episode.id, patch)
  const copyPreviousPlanInputs = (episode: Episode, previousEpisode: Episode) => {
    patchPlan(episode, episodePlanInputPatch(previousEpisode.plan))
  }
  const countSeedableUnplannedEpisodes = () => {
    let carryInputs: Partial<EpisodePlan> | undefined
    let count = 0
    for (const episode of episodes) {
      if (episodePlanInputCount(episode.plan) > 0) {
        carryInputs = episodePlanInputPatch(episode.plan)
        continue
      }
      if (episodePlanInputCount(carryInputs) > 0) count += 1
      else carryInputs = undefined
    }
    return count
  }
  const seedUnplannedPlanInputsFromPrevious = () => {
    let carryInputs: Partial<EpisodePlan> | undefined
    for (const episode of episodes) {
      if (episodePlanInputCount(episode.plan) > 0) {
        carryInputs = episodePlanInputPatch(episode.plan)
        continue
      }
      if (!carryInputs || episodePlanInputCount(carryInputs) <= 0) {
        carryInputs = undefined
        continue
      }
      patchPlan(episode, carryInputs)
    }
  }
  const togglePlanAsset = (episode: Episode, plan: EpisodePlan, assetId: string) => {
    if (!(plan.requiredAssetIds ?? []).includes(assetId)) {
      patchPlan(episode, { requiredAssetIds: toggleId(plan.requiredAssetIds, assetId) })
      return
    }
    const childVariantIds = new Set(variantOptions.filter((variant) => variant.assetId === assetId).map((variant) => variant.id))
    patchPlan(episode, {
      requiredAssetIds: (plan.requiredAssetIds ?? []).filter((id) => id !== assetId),
      requiredVariantIds: (plan.requiredVariantIds ?? []).filter((id) => !childVariantIds.has(id)),
    })
  }
  const togglePlanVariant = (episode: Episode, plan: EpisodePlan, variantId: string, assetId: string) => {
    if ((plan.requiredVariantIds ?? []).includes(variantId)) {
      patchPlan(episode, { requiredVariantIds: toggleId(plan.requiredVariantIds, variantId) })
      return
    }
    patchPlan(episode, {
      requiredVariantIds: toggleId(plan.requiredVariantIds, variantId),
      requiredAssetIds: (plan.requiredAssetIds ?? []).includes(assetId)
        ? plan.requiredAssetIds
        : [...new Set([...(plan.requiredAssetIds ?? []), assetId])],
    })
  }
  const readinessForEpisode = (episode: Episode) => {
    const plan = episode.plan ?? {}
    const requiredAssetIds = new Set(plan.requiredAssetIds ?? [])
    const requiredVariantIds = new Set(plan.requiredVariantIds ?? [])
    const plannedAssetIds = plan.requiredAssetIds ?? []
    const plannedVariantIds = plan.requiredVariantIds ?? []
    const missingAssetRefs = plannedAssetIds.filter((id) => assetOptionById.get(id)?.hasRefImage === false).length
    const invalidAssetRefs = plannedAssetIds.filter((id) => !assetOptionById.has(id)).length
    const plannedVariantOptions = plannedVariantIds.map((id) => variantOptionById.get(id))
    const missingVariantRefs = plannedVariantOptions.filter((variant) => variant && !variant.hasRefImage).length
    const scopedOutsideEpisode = plannedVariantOptions.filter((variant) => variant && variant.appliesToEpisodeIds.length > 0 && !variant.appliesToEpisodeIds.includes(episode.id)).length
    const parentAssetMissing = plannedVariantOptions.filter((variant) => variant && !requiredAssetIds.has(variant.assetId)).length
    const invalidVariantRefs = plannedVariantIds.filter((id) => !variantOptionById.has(id)).length
    const plannedInputCount = plannedAssetIds.length + plannedVariantIds.length
    const readinessIssueCount = missingAssetRefs + invalidAssetRefs + missingVariantRefs + scopedOutsideEpisode + parentAssetMissing + invalidVariantRefs
    const readinessSummary = [
      missingAssetRefs ? `缺主图 ${missingAssetRefs}` : '',
      missingVariantRefs ? `缺形态图 ${missingVariantRefs}` : '',
      scopedOutsideEpisode ? `作用域 ${scopedOutsideEpisode}` : '',
      parentAssetMissing ? `父资产 ${parentAssetMissing}` : '',
      invalidAssetRefs || invalidVariantRefs ? `无效引用 ${invalidAssetRefs + invalidVariantRefs}` : '',
    ].filter(Boolean)
    const summaryTitle = [
      `计划资产 ${plannedAssetIds.length}`,
      `计划形态 ${plannedVariantIds.length}`,
      readinessSummary.length ? `风险：${readinessSummary.join(' · ')}` : plannedInputCount ? '生产输入就绪' : '还没有规划必需项目资产或形态',
    ].join('\n')
    return {
      plan,
      requiredAssetIds,
      requiredVariantIds,
      plannedInputCount,
      readinessIssueCount,
      summaryTitle,
    }
  }
  const episodeReadiness = episodes.map((episode) => ({ episode, readiness: readinessForEpisode(episode) }))
  const episodeIndexById = new Map(episodes.map((episode, index) => [episode.id, index]))
  const unplannedEpisodeCount = episodeReadiness.filter(({ readiness }) => readiness.plannedInputCount === 0).length
  const riskyEpisodeCount = episodeReadiness.filter(({ readiness }) => readiness.readinessIssueCount > 0).length
  const readyEpisodeCount = episodeReadiness.filter(({ readiness }) => readiness.plannedInputCount > 0 && readiness.readinessIssueCount === 0).length
  const missingEpisodeCount = Math.max(0, plannedCount - episodes.length)
  const seedableUnplannedEpisodeCount = countSeedableUnplannedEpisodes()
  const filteredEpisodeReadiness = episodeReadiness.filter(({ readiness }) => {
    if (seriesPlanFilter === 'unplanned') return readiness.plannedInputCount === 0
    if (seriesPlanFilter === 'risk') return readiness.readinessIssueCount > 0
    if (seriesPlanFilter === 'ready') return readiness.plannedInputCount > 0 && readiness.readinessIssueCount === 0
    return true
  })
  const seriesFilterOptions: { id: SeriesPlanFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: episodes.length },
    { id: 'unplanned', label: '未规划', count: unplannedEpisodeCount },
    { id: 'risk', label: '风险', count: riskyEpisodeCount },
    { id: 'ready', label: '就绪', count: readyEpisodeCount },
  ]
  const seriesReadinessTitle = [
    `已建剧集 ${episodes.length}`,
    `计划集数 ${plannedCount}`,
    missingEpisodeCount ? `缺少剧集 ${missingEpisodeCount}` : '',
    unplannedEpisodeCount ? `未规划剧集 ${unplannedEpisodeCount}` : '',
    riskyEpisodeCount ? `存在风险剧集 ${riskyEpisodeCount}` : '',
    readyEpisodeCount ? `生产输入就绪剧集 ${readyEpisodeCount}` : '',
  ].filter(Boolean).join('\n')
  return (
    <div className="afs-series">
      <section className="afs-series__bible">
        <div className="afs-studio__tabbar">
          <b>系列圣经</b>
          <span className="afs-studio__hint">整季生产蓝图，不直接生成媒体</span>
          <span className="afs-series__spacer" />
          <span className="afs-studio__hint">计划集数</span>
          <NumberStepper
            size="sm"
            min={1}
            max={100}
            value={plannedCount}
            onChange={(n) => updateSeriesBible({ plannedEpisodeCount: n })}
            ariaLabel="计划集数"
          />
          <button className="afs-btn afs-btn--sm" disabled={plannedCount <= episodes.length} onClick={fillEpisodes}>
            <Plus size={13} /> 补齐剧集
          </button>
        </div>
        <div className="afs-series__bible-grid">
          <label className="afs-series__field">
            <span>一句话钩子</span>
            <input
              className="afs-field__input"
              value={bible.logline ?? ''}
              placeholder="整季核心卖点 / 第一眼吸引力"
              onChange={(e) => updateSeriesBible({ logline: e.target.value })}
            />
          </label>
          <label className="afs-series__field">
            <span>主题</span>
            <input
              className="afs-field__input"
              value={bible.theme ?? ''}
              placeholder="复仇、成长、悬疑、爽感节奏等"
              onChange={(e) => updateSeriesBible({ theme: e.target.value })}
            />
          </label>
          <label className="afs-series__field afs-series__field--wide">
            <span>整季梗概</span>
            <textarea
              className="afs-field__input"
              rows={4}
              value={bible.synopsis ?? ''}
              placeholder="整季故事主线、主角目标、核心反转和结局方向"
              onChange={(e) => updateSeriesBible({ synopsis: e.target.value })}
            />
          </label>
          <label className="afs-series__field afs-series__field--wide">
            <span>世界规则</span>
            <textarea
              className="afs-field__input"
              rows={3}
              value={bible.worldRules ?? ''}
              placeholder="时代背景、空间规则、能力边界、视觉基调等"
              onChange={(e) => updateSeriesBible({ worldRules: e.target.value })}
            />
          </label>
          <label className="afs-series__field afs-series__field--wide">
            <span>连续性规则</span>
            <textarea
              className="afs-field__input"
              rows={4}
              value={(bible.continuityRules ?? []).join('\n')}
              placeholder={'每行一条，例如：\nE3 起女主左脸有伤疤\nE5 宴会前不能使用晚宴妆'}
              onChange={(e) => updateSeriesBible({ continuityRules: splitRuleLines(e.target.value) })}
            />
          </label>
        </div>
      </section>
      <section className="afs-series__episodes">
        <div className="afs-studio__tabbar">
          <b>剧集规划</b>
          <span className="afs-studio__hint">
            当前 {episodes.length} 集，计划 {plannedCount} 集
          </span>
          <span className="afs-series__spacer" />
          <span className="afs-series__rollup" title={seriesReadinessTitle} aria-label="整季规划摘要">
            {missingEpisodeCount > 0 && (
              <button
                type="button"
                className="is-warning"
                title="补齐缺少的剧集，并显示未规划剧集"
                onClick={() => {
                  setSeriesPlanFilter('unplanned')
                  fillEpisodes()
                }}
              >
                缺集 {missingEpisodeCount}
              </button>
            )}
            {unplannedEpisodeCount > 0 && (
              <button type="button" className={seriesPlanFilter === 'unplanned' ? 'is-on' : ''} onClick={() => setSeriesPlanFilter('unplanned')}>
                未规划 {unplannedEpisodeCount}
              </button>
            )}
            {riskyEpisodeCount > 0 && (
              <button type="button" className={seriesPlanFilter === 'risk' ? 'is-warning is-on' : 'is-warning'} onClick={() => setSeriesPlanFilter('risk')}>
                风险 {riskyEpisodeCount}
              </button>
            )}
            {readyEpisodeCount > 0 && (
              <button type="button" className={seriesPlanFilter === 'ready' ? 'is-ready is-on' : 'is-ready'} onClick={() => setSeriesPlanFilter('ready')}>
                就绪 {readyEpisodeCount}
              </button>
            )}
          </span>
          {seedableUnplannedEpisodeCount > 0 && (
            <button
              type="button"
              className="afs-series__bulk-copy"
              title="把每个未规划剧集的生产输入复制自上一集；只复制资产和形态，不覆盖钩子、冲突或结尾"
              onClick={seedUnplannedPlanInputsFromPrevious}
            >
              <Copy size={12} /> 沿用上集 {seedableUnplannedEpisodeCount}
            </button>
          )}
          <span className="afs-series__filters" aria-label="剧集规划筛选">
            {seriesFilterOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={seriesPlanFilter === option.id ? 'is-on' : ''}
                aria-pressed={seriesPlanFilter === option.id}
                onClick={() => setSeriesPlanFilter(option.id)}
              >
                {option.label} {option.count}
              </button>
            ))}
          </span>
        </div>
        {filteredEpisodeReadiness.length ? (
          <div className="afs-series__episode-grid">
            {filteredEpisodeReadiness.map(({ episode, readiness }) => {
            const { plan, requiredAssetIds, requiredVariantIds, plannedInputCount, readinessIssueCount, summaryTitle } = readiness
            const previousEpisode = episodes[(episodeIndexById.get(episode.id) ?? 0) - 1]
            const previousPlanInputCount = episodePlanInputCount(previousEpisode?.plan)
            const canCopyPreviousInputs = !!previousEpisode && previousPlanInputCount > 0
            return (
              <article key={episode.id} className="afs-series__episode">
                <div className="afs-series__episode-head">
                  <b>E{episode.index + 1}</b>
                  <span className="afs-series__episode-title" title={episode.title}>{episode.title}</span>
                  {previousEpisode && (
                    <button
                      type="button"
                      className="afs-series__episode-copy"
                      disabled={!canCopyPreviousInputs}
                      title={canCopyPreviousInputs ? `复用 E${previousEpisode.index + 1} 的 ${previousPlanInputCount} 个生产输入` : `E${previousEpisode.index + 1} 还没有生产输入`}
                      aria-label={`复用上一集生产输入到 E${episode.index + 1}`}
                      onClick={() => copyPreviousPlanInputs(episode, previousEpisode)}
                    >
                      <Copy size={12} />
                    </button>
                  )}
                  <div className="afs-series__episode-summary" title={summaryTitle} aria-label={`E${episode.index + 1} 计划摘要`}>
                    <i>{plannedInputCount ? `计划 ${plannedInputCount}` : '未规划'}</i>
                    {readinessIssueCount > 0 ? <i className="is-warning">风险 {readinessIssueCount}</i> : plannedInputCount > 0 ? <i className="is-ready">就绪</i> : null}
                  </div>
                </div>
                <div className="afs-series__plan-grid">
                  <label className="afs-series__field">
                    <span>开场钩子</span>
                    <textarea
                      className="afs-field__input"
                      rows={2}
                      value={plan.hook ?? ''}
                      onChange={(e) => patchPlan(episode, { hook: e.target.value })}
                    />
                  </label>
                  <label className="afs-series__field">
                    <span>本集冲突</span>
                    <textarea
                      className="afs-field__input"
                      rows={2}
                      value={plan.conflict ?? ''}
                      onChange={(e) => patchPlan(episode, { conflict: e.target.value })}
                    />
                  </label>
                  <label className="afs-series__field afs-series__field--wide">
                    <span>结尾钩子</span>
                    <textarea
                      className="afs-field__input"
                      rows={2}
                      value={plan.cliffhanger ?? ''}
                      onChange={(e) => patchPlan(episode, { cliffhanger: e.target.value })}
                    />
                  </label>
                </div>
                <div className="afs-series__requirements">
                  <span>必需项目资产</span>
                  {assetOptions.length ? (
                    <div className="afs-series__checks">
                      {assetOptions.map(({ asset, hasRefImage, assetCenterUsage, assetCenterChips }) => {
                        const readinessWarnings = hasRefImage ? [] : ['缺主参考图']
                        const title = [
                          readinessWarnings.length ? `提示：${readinessWarnings.join(' · ')}` : '',
                          assetCenterChips.length ? assetCenterUsageTitle(assetCenterUsage) : '',
                        ].filter(Boolean).join('\n') || asset.name
                        return (
                          <label
                            key={asset.id}
                            className={`afs-series__check${requiredAssetIds.has(asset.id) ? ' is-on' : ''}${readinessWarnings.length ? ' is-warning' : ''}`}
                            title={title}
                          >
                            <input
                              type="checkbox"
                              checked={requiredAssetIds.has(asset.id)}
                              onChange={() => togglePlanAsset(episode, plan, asset.id)}
                            />
                            <span className="afs-series__checktext">{asset.name}</span>
                            {readinessWarnings.length > 0 && (
                              <span className="afs-series__warnchips" aria-label={`${asset.name} 就绪提示`}>
                                {readinessWarnings.map((chip) => <i key={chip}>{chip}</i>)}
                              </span>
                            )}
                            {assetCenterChips.length > 0 && (
                              <span className="afs-series__usagechips" aria-label={`${asset.name} 资产中心图谱`}>
                                {assetCenterChips.slice(0, 2).map((chip) => <i key={chip}>{chip}</i>)}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="afs-studio__hint">项目资产页还没有角色、场景或道具。</p>
                  )}
                  {variantOptions.length ? (
                    <>
                      <span>必需形态/妆容</span>
                      <div className="afs-series__checks">
                        {variantOptions.map((variant) => {
                          const scopedToOtherEpisodes = variant.appliesToEpisodeIds.length > 0 && !variant.appliesToEpisodeIds.includes(episode.id)
                          const parentAssetMissing = requiredVariantIds.has(variant.id) && !requiredAssetIds.has(variant.assetId)
                          const readinessWarnings = [
                            parentAssetMissing ? '未规划父资产' : '',
                            variant.hasRefImage ? '' : '缺形态图',
                            scopedToOtherEpisodes ? '未适用本集' : '',
                          ].filter(Boolean)
                          const title = [
                            variant.title,
                            readinessWarnings.length ? `提示：${readinessWarnings.join(' · ')}` : '',
                            variant.assetCenterChips.length ? assetCenterUsageTitle(variant.assetCenterUsage) : '',
                          ].filter(Boolean).join('\n') || variant.label
                          return (
                            <label
                              key={variant.id}
                              className={`afs-series__check${requiredVariantIds.has(variant.id) ? ' is-on' : ''}${readinessWarnings.length ? ' is-warning' : ''}`}
                              title={title}
                            >
                              <input
                                type="checkbox"
                                checked={requiredVariantIds.has(variant.id)}
                                onChange={() => togglePlanVariant(episode, plan, variant.id, variant.assetId)}
                              />
                              <span className="afs-series__checktext">{variant.label}</span>
                              {readinessWarnings.length > 0 && (
                                <span className="afs-series__warnchips" aria-label={`${variant.label} 就绪提示`}>
                                  {readinessWarnings.map((chip) => <i key={chip}>{chip}</i>)}
                                </span>
                              )}
                              {variant.assetCenterChips.length > 0 && (
                                <span className="afs-series__usagechips" aria-label={`${variant.label} 资产中心图谱`}>
                                  {variant.assetCenterChips.slice(0, 2).map((chip) => <i key={chip}>{chip}</i>)}
                                </span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              </article>
            )
            })}
          </div>
        ) : (
          <p className="afs-series__empty">当前筛选下没有剧集。</p>
        )}
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
  const usageByEntity = useAssetHubStore((s) => s.usageByEntity)
  const [assetMatrixFilter, setAssetMatrixFilter] = useState<AssetMatrixFilter>('all')
  const hasAnyEpisodePlan = (doc.episodes ?? []).some((episode) => episodePlanInputCount(episode.plan) > 0)
  const rows = doc.assets
    .filter((asset) => !asset.parentAssetId && asset.type !== 'audio' && asset.type !== 'clip')
    .map((asset) => {
      const uses = continuity.episodes.flatMap((episode) => episode.castUses.filter((use) => use.assetId === asset.id).map((use) => ({ episode, use })))
      const episodeLabels = [...new Map(uses.map(({ episode }) => [episode.id, `E${episode.index + 1}`])).values()]
      const variantLabels = [...new Set(uses.map(({ use }) => use.variantLabel ?? (use.variantId ? use.variantId : '主形象')))]
      const variantById = new Map((asset.variants ?? []).map((variant) => [variant.id, variant]))
      const variantIds = new Set(variantById.keys())
      const plannedEpisodes = (doc.episodes ?? []).filter((episode) => {
        const plan = episode.plan
        return (plan?.requiredAssetIds ?? []).includes(asset.id) || (plan?.requiredVariantIds ?? []).some((id) => variantIds.has(id))
      })
      const planEpisodeLabels = plannedEpisodes.map((episode) => `E${episode.index + 1}`)
      const actualEpisodeIds = new Set(uses.map(({ episode }) => episode.id))
      const plannedEpisodeIds = new Set(plannedEpisodes.map((episode) => episode.id))
      const plannedUnusedLabels = plannedEpisodes.filter((episode) => !actualEpisodeIds.has(episode.id)).map((episode) => `E${episode.index + 1}`)
      const unplannedUseLabels = hasAnyEpisodePlan
        ? [...new Map(uses.filter(({ episode }) => !plannedEpisodeIds.has(episode.id)).map(({ episode }) => [episode.id, `E${episode.index + 1}`])).values()]
        : []
      const plannedVariantUses = (doc.episodes ?? []).flatMap((episode) =>
        (episode.plan?.requiredVariantIds ?? [])
          .filter((variantId) => variantIds.has(variantId))
          .map((variantId) => ({ episode, variantId }))
      )
      const actualVariantUses = uses.flatMap(({ episode, use }) => use.variantId && variantIds.has(use.variantId) ? [{ episode, use, variantId: use.variantId }] : [])
      const plannedVariantUseKeys = new Set(plannedVariantUses.map(({ episode, variantId }) => `${episode.id}:${variantId}`))
      const actualVariantUseKeys = new Set(actualVariantUses.map(({ episode, variantId }) => `${episode.id}:${variantId}`))
      const plannedVariantUnusedLabels = plannedVariantUses
        .filter(({ episode, variantId }) => !actualVariantUseKeys.has(`${episode.id}:${variantId}`))
        .map(({ episode, variantId }) => {
          const variant = variantById.get(variantId)
          return `E${episode.index + 1}/${variantLabelWithKind(variant?.label ?? variantId, variant?.variantKind)}`
        })
      const unplannedVariantUseLabels = hasAnyEpisodePlan
        ? actualVariantUses
            .filter(({ episode, variantId }) => !plannedVariantUseKeys.has(`${episode.id}:${variantId}`))
            .map(({ episode, use, variantId }) => {
              const variant = variantById.get(variantId)
              return `E${episode.index + 1}/${use.variantLabel ?? variantLabelWithKind(variant?.label ?? variantId, variant?.variantKind)}`
            })
        : []
      const planVariantLabels = (asset.variants ?? [])
        .filter((variant) => (doc.episodes ?? []).some((episode) => (episode.plan?.requiredVariantIds ?? []).includes(variant.id)))
        .map((variant) => variantLabelWithKind(variant.label, variant.variantKind))
      const issues = continuity.issues.filter((issue) => issue.assetId === asset.id)
      const assetCenterUsage = hubLoaded ? projectAssetIdentityUsageFromHub(doc, asset, usageByEntity) : undefined
      return { asset, episodeLabels, variantLabels, planEpisodeLabels, planVariantLabels, plannedUnusedLabels, unplannedUseLabels, plannedVariantUnusedLabels, unplannedVariantUseLabels, assetCenterUsage, assetCenterChips: assetCenterUsageChips(assetCenterUsage), issues }
    })
    .filter((row) => row.episodeLabels.length > 0 || row.planEpisodeLabels.length > 0 || row.issues.length > 0 || row.asset.type === 'role')
  const rowHasPlanDrift = (row: (typeof rows)[number]) =>
    row.plannedUnusedLabels.length > 0 ||
    row.unplannedUseLabels.length > 0 ||
    row.plannedVariantUnusedLabels.length > 0 ||
    row.unplannedVariantUseLabels.length > 0
  const rowHasIssue = (row: (typeof rows)[number]) => row.issues.length > 0
  const rowMissingAssetCenter = (row: (typeof rows)[number]) => hubLoaded && row.assetCenterChips.length === 0
  if (!rows.length) return null
  const issueCount = rows.reduce((sum, row) => sum + row.issues.length, 0)
  const assetCenterUsageCount = rows.filter((row) => row.assetCenterChips.length > 0).length
  const missingAssetCenterCount = hubLoaded ? rows.filter(rowMissingAssetCenter).length : 0
  const plannedAssetCount = rows.filter((row) => row.planEpisodeLabels.length > 0).length
  const planDriftCount = rows.filter(rowHasPlanDrift).length
  const filteredRows = rows.filter((row) => {
    if (assetMatrixFilter === 'drift') return rowHasPlanDrift(row)
    if (assetMatrixFilter === 'issue') return rowHasIssue(row)
    if (assetMatrixFilter === 'unlinked') return rowMissingAssetCenter(row)
    return true
  })
  const assetMatrixFilterOptions: { id: AssetMatrixFilter; label: string; count: number }[] = [
    { id: 'all', label: '全部', count: rows.length },
    { id: 'drift', label: '计划差异', count: planDriftCount },
    { id: 'issue', label: '连续性问题', count: rows.filter(rowHasIssue).length },
  ]
  if (hubLoaded) assetMatrixFilterOptions.push({ id: 'unlinked', label: '未入图谱', count: missingAssetCenterCount })
  const typeLabel = (type: Asset['type']) => (type === 'role' ? '人物' : type === 'scene' ? '场景' : type === 'prop' ? '物品' : type)
  return (
    <div className="afs-studio__assetmatrix" aria-label="跨集资产一致性">
      <div className="afs-studio__assetmatrix-head">
        <b>跨集资产一致性</b>
        <span>{rows.length} 个资产</span>
        {plannedAssetCount > 0 && <span>{plannedAssetCount} 个进入剧集计划</span>}
        {planDriftCount > 0 && <span className="is-warning">{planDriftCount} 个计划/出场差异</span>}
        {hubLoaded && assetCenterUsageCount > 0 && <span>{assetCenterUsageCount} 个有资产中心图谱</span>}
        {missingAssetCenterCount > 0 && <span className="is-warning">{missingAssetCenterCount} 个未入图谱</span>}
        {issueCount > 0 && <span className="is-warning">{issueCount} 个问题</span>}
        <span className="afs-studio__assetmatrix-spacer" />
        <span className="afs-studio__assetmatrix-filters" aria-label="资产矩阵筛选">
          {assetMatrixFilterOptions.map((option) => (
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
      </div>
      <div className="afs-studio__assetmatrix-rows">
        {filteredRows.length === 0 && <span className="afs-studio__assetmatrix-empty">当前筛选下没有资产</span>}
        {filteredRows.map((row) => (
          <div key={row.asset.id} className={`afs-studio__assetmatrix-row${rowHasIssue(row) || rowHasPlanDrift(row) || rowMissingAssetCenter(row) ? ' is-warning' : ''}`}>
            <span className="afs-studio__assetmatrix-name" title={row.asset.name}>
              <b>{row.asset.name}</b>
              <em>{typeLabel(row.asset.type)}</em>
            </span>
            <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 出现剧集`} title={assetMatrixChipsetTitle('出现剧集', row.episodeLabels, '未出场')}>
              {row.episodeLabels.length ? row.episodeLabels.slice(0, 8).map((label) => <i key={label}>{label}</i>) : <i>未出场</i>}
              {row.episodeLabels.length > 8 && <i>+{row.episodeLabels.length - 8}</i>}
            </span>
            <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 计划剧集`} title={assetMatrixChipsetTitle('计划剧集', row.planEpisodeLabels, '未计划')}>
              {row.planEpisodeLabels.length ? row.planEpisodeLabels.slice(0, 8).map((label) => <i key={label}>{label}</i>) : <i>未计划</i>}
              {row.planEpisodeLabels.length > 8 && <i>+{row.planEpisodeLabels.length - 8}</i>}
            </span>
            <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 使用形态`} title={assetMatrixChipsetTitle('使用形态', row.variantLabels, '未绑定形态')}>
              {row.variantLabels.length ? row.variantLabels.slice(0, 4).map((label) => <i key={label}>{label}</i>) : <i>未绑定形态</i>}
              {row.variantLabels.length > 4 && <i>+{row.variantLabels.length - 4}</i>}
            </span>
            <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 计划形态`} title={assetMatrixChipsetTitle('计划形态', row.planVariantLabels, '未计划形态')}>
              {row.planVariantLabels.length ? row.planVariantLabels.slice(0, 4).map((label) => <i key={label}>{label}</i>) : <i>未计划形态</i>}
              {row.planVariantLabels.length > 4 && <i>+{row.planVariantLabels.length - 4}</i>}
            </span>
            <span className="afs-studio__assetmatrix-chipset" aria-label={`${row.asset.name} 资产中心图谱`} title={assetCenterUsageTitle(row.assetCenterUsage)}>
              {row.assetCenterChips.length ? row.assetCenterChips.slice(0, 3).map((label) => <i key={label}>{label}</i>) : <i>{hubLoaded ? '未入图谱' : '图谱加载中'}</i>}
              {row.assetCenterChips.length > 3 && <i>+{row.assetCenterChips.length - 3}</i>}
            </span>
            {(row.plannedUnusedLabels.length > 0 || row.unplannedUseLabels.length > 0 || row.plannedVariantUnusedLabels.length > 0 || row.unplannedVariantUseLabels.length > 0 || rowMissingAssetCenter(row) || row.issues.length > 0) && (
              <span className="afs-studio__assetmatrix-status">
                {rowMissingAssetCenter(row) && (
                  <i className="afs-studio__assetmatrix-drift" title={`${row.asset.name} 尚未进入资产中心图谱`}>
                    未入图谱
                  </i>
                )}
                {row.plannedUnusedLabels.length > 0 && (
                  <i className="afs-studio__assetmatrix-drift" title={`计划未进入分镜：${row.plannedUnusedLabels.join('、')}`}>
                    计划未用 {row.plannedUnusedLabels.length}
                  </i>
                )}
                {row.unplannedUseLabels.length > 0 && (
                  <i className="afs-studio__assetmatrix-drift" title={`出场但未进入剧集计划：${row.unplannedUseLabels.join('、')}`}>
                    未计划 {row.unplannedUseLabels.length}
                  </i>
                )}
                {row.plannedVariantUnusedLabels.length > 0 && (
                  <i className="afs-studio__assetmatrix-drift" title={`计划形态未进入分镜：${row.plannedVariantUnusedLabels.join('、')}`}>
                    形态未用 {row.plannedVariantUnusedLabels.length}
                  </i>
                )}
                {row.unplannedVariantUseLabels.length > 0 && (
                  <i className="afs-studio__assetmatrix-drift" title={`分镜形态未进入剧集计划：${row.unplannedVariantUseLabels.join('、')}`}>
                    形态未计划 {row.unplannedVariantUseLabels.length}
                  </i>
                )}
                {row.issues.length > 0 && (
                  <i className="afs-studio__assetmatrix-issue" title={row.issues.slice(0, 4).map((issue) => issue.message).join('\n')}>
                    {row.issues.length} 问题
                  </i>
                )}
              </span>
            )}
          </div>
        ))}
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
    <div className="afs-studio__assetcard">
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
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const selectedEpisodeIds = new Set(variant.appliesToEpisodeIds ?? [])
  const plannedEpisodes = episodes.filter((episode) => (episode.plan?.requiredVariantIds ?? []).includes(variant.id))
  const plannedEpisodeIds = plannedEpisodes.map((episode) => episode.id)
  const plannedEpisodeLabels = plannedEpisodes.map((episode) => `E${episode.index + 1}`)
  const scopeMatchesPlan = plannedEpisodeIds.length > 0 && (
    selectedEpisodeIds.size === 0
      ? plannedEpisodeIds.length === episodes.length
      : selectedEpisodeIds.size === plannedEpisodeIds.length && plannedEpisodeIds.every((id) => selectedEpisodeIds.has(id))
  )
  const setEpisodeScope = (ids: string[]) => updateAssetVariant(asset.id, variant.id, { appliesToEpisodeIds: ids.length ? ids : undefined })
  const toggleEpisodeScope = (episodeId: string) => {
    const next = new Set(selectedEpisodeIds)
    if (next.has(episodeId)) next.delete(episodeId)
    else next.add(episodeId)
    setEpisodeScope([...next])
  }
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
      {episodes.length > 1 && (
        <div className="afs-studio__variantplan" title={plannedEpisodeLabels.length ? `剧集计划要求：${plannedEpisodeLabels.join('、')}` : '还没有剧集计划要求该形态'}>
          <span className="afs-studio__variantlabel">计划</span>
          <div className="afs-studio__variantchips">
            {plannedEpisodeLabels.length ? plannedEpisodeLabels.slice(0, 5).map((label) => <i key={label}>{label}</i>) : <i>未纳入</i>}
            {plannedEpisodeLabels.length > 5 && <i>+{plannedEpisodeLabels.length - 5}</i>}
            {plannedEpisodeIds.length > 0 && (
              <button
                type="button"
                className="afs-studio__variantchip afs-studio__variantchip--action"
                disabled={scopeMatchesPlan}
                title={scopeMatchesPlan ? '当前适用范围已覆盖计划剧集' : '将适用剧集同步为剧集计划中要求该形态的集数'}
                onClick={() => setEpisodeScope(plannedEpisodeIds)}
              >
                按计划适用
              </button>
            )}
          </div>
        </div>
      )}
      {episodes.length > 1 && (
        <div className="afs-studio__variantepisodes" aria-label="适用剧集">
          <span className="afs-studio__variantlabel">适用</span>
          <div className="afs-studio__variantchips">
            <button
              type="button"
              className={`afs-studio__variantchip${selectedEpisodeIds.size === 0 ? ' is-on' : ''}`}
              title="适用于全部剧集"
              onClick={() => setEpisodeScope([])}
            >
              全剧
            </button>
            {episodes.map((episode) => (
              <button
                key={episode.id}
                type="button"
                className={`afs-studio__variantchip${selectedEpisodeIds.has(episode.id) ? ' is-on' : ''}`}
                title={`${episode.title} · ${selectedEpisodeIds.has(episode.id) ? '已适用' : '点击设为适用'}`}
                onClick={() => toggleEpisodeScope(episode.id)}
              >
                {selectedEpisodeIds.has(episode.id) && <Check size={10} />}
                E{episode.index + 1}
              </button>
            ))}
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
  const chips: string[] = []
  const seen = new Set<string>()
  const push = (text: string) => {
    if (!text || seen.has(text)) return
    seen.add(text)
    chips.push(text)
  }
  const pushKind = (prefix: string, kind: typeof issue.variantKind) => {
    const label = variantKindLabel(kind)
    if (label) push(`${prefix}：${label}`)
  }

  pushKind('形态', issue.variantKind)
  const candidateKinds = [...new Set(issue.candidateVariantKinds ?? [])]
    .map((kind) => variantKindLabel(kind))
    .filter(Boolean)
  if (candidateKinds.length === 1) push(`候选：${candidateKinds[0]}`)
  else if (candidateKinds.length > 1) push(`候选：${candidateKinds.join('、')}`)
  pushKind('上一形态', issue.previousVariantKind)

  return chips
}

function ContinuityDetailsDrawer({ report, onClose }: { report: ContinuityReportView; onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const updateAssetVariant = useProjectStore((s) => s.updateAssetVariant)
  const updateEpisodePlan = useProjectStore((s) => s.updateEpisodePlan)
  const createEpisodes = useProjectStore((s) => s.createEpisodes)
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const generateAssetVariant = useProjectStore((s) => s.generateAssetVariant)
  const setStoryboardCastVariant = useProjectStore((s) => s.setStoryboardCastVariant)
  const linkAssetToLibraryEntity = useProjectStore((s) => s.linkAssetToLibraryEntity)
  const markAssetAsDistinctIdentity = useProjectStore((s) => s.markAssetAsDistinctIdentity)
  const mergeProjectAssetInto = useProjectStore((s) => s.mergeProjectAssetInto)
  const syncAssetFromLibraryEntity = useProjectStore((s) => s.syncAssetFromLibraryEntity)
  const promoteAssetToElement = useProjectStore((s) => s.promoteAssetToElement)
  const distributeNovelChaptersAcrossEpisodes = useProjectStore((s) => s.distributeNovelChaptersAcrossEpisodes)
  const hubEntities = useAssetHubStore((s) => s.entities)
  const refreshAssetHub = useAssetHubStore((s) => s.refresh)
  const errors = report.issues.filter((issue) => issue.severity === 'error')
  const warnings = report.issues.filter((issue) => issue.severity === 'warning')
  const chapterIssueCodes = new Set(['episode_without_chapters', 'invalid_episode_chapter', 'unassigned_chapter', 'duplicated_chapter_assignment'])
  const chapterIssueCount = report.issues.filter((issue) => chapterIssueCodes.has(issue.code)).length
  const canRedistributeChapters = chapterIssueCount > 0 && doc.novel.length > 0 && (doc.episodes?.length ?? 0) > 1
  const storyboardEntries = useMemo(() => {
    const seen = new Set<string>()
    const entries: { storyboard: Storyboard; episodeId?: string }[] = []
    for (const storyboard of doc.storyboards) {
      seen.add(storyboard.id)
      entries.push({ storyboard, episodeId: storyboard.episodeId ?? doc.currentEpisodeId })
    }
    for (const episode of doc.episodes ?? []) {
      for (const storyboard of episode.storyboards ?? []) {
        if (seen.has(storyboard.id)) continue
        seen.add(storyboard.id)
        entries.push({ storyboard, episodeId: storyboard.episodeId ?? episode.id })
      }
    }
    return entries
  }, [doc.currentEpisodeId, doc.episodes, doc.storyboards])
  const redistributeChapters = () => {
    if (!canRedistributeChapters) return
    if (window.confirm('按章节顺序重新均分到现有剧集？这会覆盖当前拆章。')) distributeNovelChaptersAcrossEpisodes()
  }
  const createMissingPlannedEpisodes = () => {
    const plannedCount = doc.seriesBible?.plannedEpisodeCount ?? 0
    const currentCount = doc.episodes?.length || report.episodes.length
    const missingCount = Math.max(0, plannedCount - currentCount)
    if (missingCount > 0) createEpisodes(missingCount)
  }
  const storyboardsForIssueEpisode = (episodeId?: string) => {
    if (!episodeId || episodeId === doc.currentEpisodeId) return doc.storyboards
    return doc.episodes?.find((episode) => episode.id === episodeId)?.storyboards ?? []
  }
  const findIssueStoryboard = (issue: ContinuityReportView['issues'][number]) => {
    if (!issue.storyboardId) return undefined
    return storyboardsForIssueEpisode(issue.episodeId).find((storyboard) => storyboard.id === issue.storyboardId)
  }
  const addVariantScope = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'variant_out_of_episode_scope' && issue.code !== 'asset_state_changed_variant' && issue.code !== 'episode_plan_variant_scope_mismatch') || !issue.assetId || !issue.variantId || !issue.episodeId) return
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    const variant = asset?.variants?.find((item) => item.id === issue.variantId)
    if (!asset || !variant) return
    const storyboard = findIssueStoryboard(issue)
    const storyboardId = issue.storyboardId ?? storyboard?.id
    if (!storyboardId && issue.scopeKind !== 'episode') return
    const patch = variantScopePatchForUse(variant, { id: issue.episodeId }, { id: storyboardId ?? '', sceneId: issue.sceneId ?? storyboard?.sceneId }, issue.scopeKind)
    if (patch) updateAssetVariant(asset.id, variant.id, patch)
  }
  const missingRefAction = (issue: ContinuityReportView['issues'][number]): { label: string; run: () => void } | null => {
    if (issue.code !== 'missing_ref_image' || !issue.assetId) return null
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    if (!asset || asset.type === 'audio' || asset.type === 'clip') return null
    if (!issue.variantId) return { label: '生成主形象参考图', run: () => void generateAsset(asset.id) }
    const variant = asset.variants?.find((item) => item.id === issue.variantId)
    if (!variant) return null
    if (!asset.refImageId) return { label: '先生成主形象参考图', run: () => void generateAsset(asset.id) }
    return { label: '生成该变体参考图', run: () => void generateAssetVariant(asset.id, variant.id) }
  }
  const bindEpisodeVariant = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'episode_variant_available' || issue.episodeId !== doc.currentEpisodeId || !issue.storyboardId || !issue.assetId) return
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    const candidates = (issue.candidateVariantIds ?? []).flatMap((id) => {
      const variant = asset?.variants?.find((item) => item.id === id)
      return variant ? [variant] : []
    })
    const directVariant = issue.variantId ? asset?.variants?.find((variant) => variant.id === issue.variantId) : undefined
    let variantId = directVariant?.id
    if (!variantId && candidates.length === 1) variantId = candidates[0].id
    if (!variantId && candidates.length > 1) {
      const options = candidates.map((variant, index) => `${index + 1}. ${variant.label} (${variant.id})`).join('\n')
      const raw = window.prompt(`选择要绑定的形态序号：\n${options}`, '1')?.trim()
      if (!raw) return
      const byIndex = Number(raw)
      const selected = Number.isFinite(byIndex)
        ? candidates[Math.max(0, Math.floor(byIndex) - 1)]
        : candidates.find((variant) => variant.id === raw || variant.label.toLowerCase() === raw.toLowerCase())
      variantId = selected?.id
    }
    if (!variantId) return
    setStoryboardCastVariant(issue.storyboardId, issue.assetId, variantId)
  }
  const carryPreviousVariant = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'asset_state_regressed_to_main' && issue.code !== 'asset_state_changed_variant') || !issue.episodeId || issue.episodeId !== doc.currentEpisodeId || !issue.storyboardId || !issue.assetId) return
    const targetVariantId = issue.previousVariantId ?? issue.variantId
    if (!targetVariantId) return
    const episodeId = issue.episodeId
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    const variant = asset?.variants?.find((item) => item.id === targetVariantId)
    if (!asset || !variant) return
    const storyboard = doc.storyboards.find((item) => item.id === issue.storyboardId)
    const scopePatch = storyboard ? variantScopePatchForUse(variant, { id: episodeId }, storyboard) : undefined
    if (scopePatch) updateAssetVariant(asset.id, variant.id, scopePatch)
    setStoryboardCastVariant(issue.storyboardId, asset.id, variant.id)
  }
  const unifySceneVariant = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'scene_group_variant_mismatch' || issue.episodeId !== doc.currentEpisodeId || !issue.sceneId || !issue.assetId) return
    const sceneId = issue.sceneId.trim()
    if (!sceneId) return
    for (const storyboard of doc.storyboards) {
      if (storyboard.sceneId?.trim() !== sceneId) continue
      if (!castRefsForStoryboard(storyboard).some((ref) => ref.assetId === issue.assetId)) continue
      setStoryboardCastVariant(storyboard.id, issue.assetId, issue.variantId)
    }
  }
  const patchStoryboardSceneAsset = (storyboard: Storyboard, sceneAssetId: string, replaceOtherSceneAssets: boolean) => {
    const refs = castRefsForStoryboard(storyboard)
    const nextRefs = replaceOtherSceneAssets
      ? refs.filter((ref) => ref.assetId === sceneAssetId || doc.assets.find((asset) => asset.id === ref.assetId)?.type !== 'scene')
      : refs
    if (!nextRefs.some((ref) => ref.assetId === sceneAssetId)) nextRefs.push({ assetId: sceneAssetId })
    upsertStoryboard({
      id: storyboard.id,
      videoDesc: storyboard.videoDesc,
      associateAssetIds: [...new Set(nextRefs.map((ref) => ref.assetId))],
      castRefs: nextRefs,
    })
  }
  const patchStoryboardAssetRef = (storyboard: Storyboard, assetId: string) => {
    const refs = castRefsForStoryboard(storyboard)
    if (refs.some((ref) => ref.assetId === assetId)) return
    const nextRefs = [...refs, { assetId }]
    upsertStoryboard({
      id: storyboard.id,
      videoDesc: storyboard.videoDesc,
      associateAssetIds: [...new Set(nextRefs.map((ref) => ref.assetId))],
      castRefs: nextRefs,
    })
  }
  const selectStoryboardForEpisodeIssue = (issue: ContinuityReportView['issues'][number], label: string): Storyboard | undefined => {
    const storyboards = [...storyboardsForIssueEpisode(issue.episodeId)].sort((a, b) => a.index - b.index)
    if (!storyboards.length) return undefined
    if (issue.storyboardId) return storyboards.find((storyboard) => storyboard.id === issue.storyboardId)
    const episode = issue.episodeId ? report.episodes.find((item) => item.id === issue.episodeId) : undefined
    const episodeLabel = episode ? `E${episode.index} ${episode.title}` : issue.episodeId ?? '当前集'
    const options = storyboards
      .slice(0, 12)
      .map((storyboard, index) => `${index + 1}. #${storyboard.index + 1} ${(storyboard.videoDesc || storyboard.prompt || '').slice(0, 60)}`)
      .join('\n')
    const raw = window.prompt(`${label}：${episodeLabel}\n${options}\n输入分镜序号`, '1')?.trim()
    if (!raw) return undefined
    const index = Number(raw)
    if (!Number.isFinite(index)) return undefined
    return storyboards[Math.max(0, Math.min(storyboards.length - 1, Math.floor(index) - 1))]
  }
  const addPlannedAssetToStoryboard = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'episode_plan_missing_asset' || !issue.assetId) return
    const storyboard = selectStoryboardForEpisodeIssue(issue, '选择要加入计划资产的分镜')
    if (!storyboard) return
    setStoryboardCastVariant(storyboard.id, issue.assetId, undefined)
  }
  const bindPlannedVariantToStoryboard = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'episode_plan_missing_variant' || !issue.assetId || !issue.variantId || !issue.episodeId) return
    const storyboard = selectStoryboardForEpisodeIssue(issue, '选择要绑定计划形态的分镜')
    if (!storyboard) return
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    const variant = asset?.variants?.find((item) => item.id === issue.variantId)
    if (!asset || !variant) return
    const patch = variantScopePatchForUse(variant, { id: issue.episodeId }, storyboard)
    if (patch) updateAssetVariant(asset.id, variant.id, patch)
    setStoryboardCastVariant(storyboard.id, asset.id, variant.id)
  }
  const addVariantParentToEpisodePlan = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'episode_plan_variant_asset_missing' || !issue.episodeId || !issue.assetId) return
    const episode = doc.episodes?.find((item) => item.id === issue.episodeId)
    const requiredAssetIds = [...new Set([...(episode?.plan?.requiredAssetIds ?? []), issue.assetId])]
    updateEpisodePlan(issue.episodeId, { requiredAssetIds })
  }
  const removeInvalidEpisodePlanRef = (issue: ContinuityReportView['issues'][number]) => {
    if (!issue.episodeId) return
    const episode = doc.episodes?.find((item) => item.id === issue.episodeId)
    const plan = episode?.plan
    if (issue.code === 'episode_plan_invalid_asset' && issue.assetId) {
      updateEpisodePlan(issue.episodeId, { requiredAssetIds: (plan?.requiredAssetIds ?? []).filter((id) => id !== issue.assetId) })
      return
    }
    if (issue.code === 'episode_plan_invalid_variant' && issue.variantId) {
      updateEpisodePlan(issue.episodeId, { requiredVariantIds: (plan?.requiredVariantIds ?? []).filter((id) => id !== issue.variantId) })
    }
  }
  const bindSceneAsset = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'scene_group_missing_asset' || issue.episodeId !== doc.currentEpisodeId || !issue.storyboardId || !issue.assetId) return
    const storyboard = doc.storyboards.find((item) => item.id === issue.storyboardId)
    if (!storyboard) return
    patchStoryboardSceneAsset(storyboard, issue.assetId, false)
  }
  const unifySceneAsset = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'scene_group_asset_mismatch' || issue.episodeId !== doc.currentEpisodeId || !issue.sceneId || !issue.assetId) return
    const sceneId = issue.sceneId.trim()
    if (!sceneId) return
    for (const storyboard of doc.storyboards) {
      if (storyboard.sceneId?.trim() !== sceneId) continue
      patchStoryboardSceneAsset(storyboard, issue.assetId, true)
    }
  }
  const removeDuplicateAlias = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'duplicate_asset_alias' || !issue.assetId || !issue.conflictLabel) return
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    if (!asset) return
    const conflictKey = normalizeAssetLookup(issue.conflictLabel)
    const aliases = asset.aliases ?? []
    const nextAliases = aliases.filter((alias) => normalizeAssetLookup(alias) !== conflictKey)
    if (nextAliases.length === aliases.length) return
    upsertAsset({ id: asset.id, type: asset.type, name: asset.name, aliases: nextAliases })
  }
  const renameConflictAsset = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'duplicate_asset_name' && issue.code !== 'duplicate_asset_alias') || !issue.assetId) return
    const asset = doc.assets.find((item) => item.id === issue.assetId)
    if (!asset) return
    const nextName = window.prompt('输入新的资产名称', asset.name)?.trim()
    if (!nextName || normalizeAssetLookup(nextName) === normalizeAssetLookup(asset.name)) return
    upsertAsset({ id: asset.id, type: asset.type, name: nextName })
  }
  const addUnusedAssetToStoryboard = (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'unused_project_asset' || !issue.assetId || !doc.storyboards.length) return
    const raw = window.prompt('输入要加入的当前集分镜序号', '1')?.trim()
    if (!raw) return
    const index = Number(raw)
    if (!Number.isFinite(index)) return
    const storyboard = [...doc.storyboards].sort((a, b) => a.index - b.index)[Math.max(0, Math.floor(index) - 1)]
    if (!storyboard) return
    patchStoryboardAssetRef(storyboard, issue.assetId)
  }
  const selectCandidateLibraryEntityId = (issue: ContinuityReportView['issues'][number]) => {
    const ids = issue.candidateLibraryEntityIds ?? []
    if (!ids.length) return undefined
    if (ids.length === 1) return ids[0]
    const labels = issue.candidateLibraryEntityLabels ?? []
    const options = ids.map((id, index) => `${index + 1}. ${labels[index] ?? id} (${id})`).join('\n')
    const raw = window.prompt(`选择身份资产序号：\n${options}`, '1')?.trim()
    if (!raw) return undefined
    const byIndex = Number(raw)
    if (Number.isFinite(byIndex)) return ids[Math.max(0, Math.floor(byIndex) - 1)]
    return ids.find((id, index) => id === raw || labels[index]?.toLowerCase() === raw.toLowerCase())
  }
  const linkCandidateLibraryEntity = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'asset_matches_unlinked_library_entity' && issue.code !== 'library_entity_alias_conflict') || !issue.assetId) return
    const entityId = selectCandidateLibraryEntityId(issue)
    if (!entityId) return
    const entity = hubEntities.find((item) => item.id === entityId)
    const linked = linkAssetToLibraryEntity(issue.assetId, {
      id: entityId,
      name: entity?.name,
      version: entity?.version,
      archived: entity?.archived,
      variants: entity?.variants?.map((variant) => ({ id: variant.id, label: variant.label })),
    })
    if (linked) window.mulby?.notification?.show('已关联身份资产快照', 'success')
  }
  const markDistinctLibraryIdentity = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'asset_matches_unlinked_library_entity' && issue.code !== 'library_entity_alias_conflict') || !issue.assetId) return
    const ids = issue.candidateLibraryEntityIds ?? []
    if (!ids.length) return
    if (markAssetAsDistinctIdentity(issue.assetId, ids)) window.mulby?.notification?.show('已标记为不同身份', 'success')
  }
  const selectMergeTargetAssetId = (issue: ContinuityReportView['issues'][number]) => {
    const ids = issue.relatedAssetIds ?? []
    if (!ids.length) return undefined
    if (ids.length === 1) return ids[0]
    const options = ids
      .map((id, index) => {
        const asset = doc.assets.find((item) => item.id === id)
        return `${index + 1}. ${asset?.name ?? id} (${id})`
      })
      .join('\n')
    const raw = window.prompt(`选择要合并到的目标项目资产：\n${options}`, '1')?.trim()
    if (!raw) return undefined
    const byIndex = Number(raw)
    if (Number.isFinite(byIndex)) return ids[Math.max(0, Math.floor(byIndex) - 1)]
    return ids.find((id) => id === raw || doc.assets.find((asset) => asset.id === id)?.name.toLowerCase() === raw.toLowerCase())
  }
  const mergeDuplicateProjectAsset = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'duplicate_library_entity_project_assets' && issue.code !== 'cross_episode_duplicate_project_asset_candidate') || !issue.assetId) return
    const targetId = selectMergeTargetAssetId(issue)
    if (!targetId) return
    const source = doc.assets.find((item) => item.id === issue.assetId)
    const target = doc.assets.find((item) => item.id === targetId)
    if (!window.confirm(`把「${source?.name ?? issue.assetId}」合并到「${target?.name ?? targetId}」？分镜和每集计划引用会迁移到目标资产，源资产会从项目资产中移除。`)) return
    if (mergeProjectAssetInto(issue.assetId, targetId)) window.mulby?.notification?.show('已合并重复项目资产', 'success')
  }
  const syncLinkedLibraryEntity = async (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'library_entity_version_outdated' || !issue.assetId || !issue.libraryEntityId) return
    const entity = hubEntities.find((item) => item.id === issue.libraryEntityId)
    if (!entity) return
    if (syncAssetFromLibraryEntity(issue.assetId, entity)) window.mulby?.notification?.show('已同步资产中心新版快照', 'success')
  }
  const publishMissingLibraryEntity = async (issue: ContinuityReportView['issues'][number]) => {
    if (issue.code !== 'library_entity_missing' || !issue.assetId) return
    await promoteAssetToElement(issue.assetId)
    await refreshAssetHub()
  }
  const episodeName = (episodeId?: string) => {
    if (!episodeId) return ''
    const episode = report.episodes.find((item) => item.id === episodeId)
    return episode ? `E${episode.index} ${episode.title}` : episodeId
  }
  const assetTypeLabel = (type: Asset['type']) => (type === 'role' ? '人物' : type === 'scene' ? '场景' : type === 'prop' ? '物品' : type === 'audio' ? '音色' : '片段')
  const mergeAssetUsage = (assetId: string) => {
    const episodeIds = new Set<string>()
    let storyboardCount = 0
    let variantRefCount = 0
    for (const entry of storyboardEntries) {
      const refs = castRefsForStoryboard(entry.storyboard)
      const inCastRefs = refs.some((ref) => ref.assetId === assetId)
      const inLegacyRefs = entry.storyboard.associateAssetIds.includes(assetId)
      if (!inCastRefs && !inLegacyRefs) continue
      storyboardCount += 1
      if (entry.episodeId) episodeIds.add(entry.episodeId)
      variantRefCount += refs.filter((ref) => ref.assetId === assetId && !!ref.variantId).length
    }
    const planCount = (doc.episodes ?? []).filter((episode) => episode.plan?.requiredAssetIds?.includes(assetId)).length
    const episodeLabels = [...episodeIds].map(episodeName).filter(Boolean).slice(0, 3)
    return { storyboardCount, variantRefCount, planCount, episodeLabels, moreEpisodes: Math.max(0, episodeIds.size - 3) }
  }
  const mergeAssetFacts = (asset: Asset) => {
    const usage = mergeAssetUsage(asset.id)
    const variants = asset.variants ?? []
    const scopedVariants = variants.filter(
      (variant) =>
        (variant.appliesToEpisodeIds?.length ?? 0) > 0 ||
        (variant.appliesToSceneIds?.length ?? 0) > 0 ||
        (variant.appliesToStoryboardIds?.length ?? 0) > 0,
    ).length
    const imageCount = asset.images?.length ?? (asset.refImageId ? 1 : 0)
    return [
      assetTypeLabel(asset.type),
      `${asset.aliases?.length ?? 0} 别名`,
      `${variants.length} 形态`,
      scopedVariants ? `${scopedVariants} 个作用域形态` : '无作用域形态',
      `${imageCount} 图`,
      usage.storyboardCount ? `${usage.storyboardCount} 分镜` : '未进分镜',
      usage.variantRefCount ? `${usage.variantRefCount} 形态绑定` : '',
      usage.planCount ? `${usage.planCount} 集计划` : '',
      usage.episodeLabels.length ? `${usage.episodeLabels.join(' / ')}${usage.moreEpisodes ? ` +${usage.moreEpisodes}` : ''}` : '',
      asset.libraryLink?.entityId ? `身份 v${asset.libraryLink.entityVersion ?? '-'}` : '未链身份',
    ].filter(Boolean)
  }
  const mergeAssetVariantLabels = (asset: Asset) => {
    const labels = (asset.variants ?? []).map((variant) => variant.label).filter(Boolean)
    if (!labels.length) return ''
    const shown = labels.slice(0, 4).join('、')
    return labels.length > 4 ? `${shown} 等 ${labels.length} 个` : shown
  }
  const renderMergeAssetPreviewRow = (role: string, asset: Asset) => {
    const variants = mergeAssetVariantLabels(asset)
    return (
      <div className="afs-studio__mergepreview-row">
        <span className="afs-studio__mergepreview-role">{role}</span>
        <div className="afs-studio__mergepreview-main">
          <strong>{asset.name}</strong>
          <span className="afs-studio__mergepreview-tags">
            {mergeAssetFacts(asset).map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </span>
          {variants && <span className="afs-studio__mergepreview-variants">形态：{variants}</span>}
        </div>
      </div>
    )
  }
  const renderMergePreview = (issue: ContinuityReportView['issues'][number]) => {
    if ((issue.code !== 'duplicate_library_entity_project_assets' && issue.code !== 'cross_episode_duplicate_project_asset_candidate') || !issue.assetId) return null
    const source = doc.assets.find((asset) => asset.id === issue.assetId)
    const targets = (issue.relatedAssetIds ?? []).map((id) => doc.assets.find((asset) => asset.id === id)).filter((asset): asset is Asset => !!asset)
    if (!source || !targets.length) return null
    return (
      <div className="afs-studio__mergepreview" aria-label="资产合并差异预览">
        <div className="afs-studio__mergepreview-title">
          <span>合并预览</span>
          {issue.conflictLabel && <code>命中：{issue.conflictLabel}</code>}
        </div>
        {renderMergeAssetPreviewRow('源', source)}
        {targets.map((target, index) => renderMergeAssetPreviewRow(targets.length > 1 ? `目标 ${index + 1}` : '目标', target))}
      </div>
    )
  }
  const renderIssues = (items: ContinuityReportView['issues']) => (
    <div className="afs-studio__continuityissues">
      {items.map((issue, index) => {
        const loc = [episodeName(issue.episodeId), issue.storyboardIndex ? `分镜 #${issue.storyboardIndex}` : '', issue.assetId ? `资产 ${issue.assetId}` : ''].filter(Boolean).join(' · ')
        const variantKindChips = continuityIssueVariantKindChips(issue)
        const issueStoryboard = findIssueStoryboard(issue)
        const variantScopeNeedsStoryboard = issue.scopeKind === 'scene' || issue.scopeKind === 'storyboard'
        const canAddVariantScope =
          (issue.code === 'variant_out_of_episode_scope' || issue.code === 'asset_state_changed_variant' || issue.code === 'episode_plan_variant_scope_mismatch') &&
          !!issue.assetId &&
          !!issue.variantId &&
          !!issue.episodeId &&
          (!variantScopeNeedsStoryboard || !!issueStoryboard)
        const addVariantScopeLabel =
          issue.code === 'episode_plan_variant_scope_mismatch'
            ? '标记计划形态适用于本集'
            : issue.code === 'asset_state_changed_variant'
            ? '标记当前形态适用于本集'
            : issue.scopeKind === 'scene'
              ? '标记变体适用于本场景'
              : issue.scopeKind === 'storyboard'
                ? '标记变体适用于本分镜'
                : '标记变体适用于本集'
        const canBindEpisodeVariant =
          issue.code === 'episode_variant_available' &&
          issue.episodeId === doc.currentEpisodeId &&
          !!issue.storyboardId &&
          !!issue.assetId &&
          (!!issue.variantId || (issue.candidateVariantIds?.length ?? 0) > 0)
        const canCarryPreviousVariant =
          (issue.code === 'asset_state_regressed_to_main' || issue.code === 'asset_state_changed_variant') &&
          issue.episodeId === doc.currentEpisodeId &&
          !!issue.storyboardId &&
          !!issue.assetId &&
          (!!issue.previousVariantId || !!issue.variantId)
        const canUnifySceneVariant = issue.code === 'scene_group_variant_mismatch' && issue.episodeId === doc.currentEpisodeId && !!issue.sceneId && !!issue.assetId
        const canBindSceneAsset = issue.code === 'scene_group_missing_asset' && issue.episodeId === doc.currentEpisodeId && !!issue.storyboardId && !!issue.assetId
        const canUnifySceneAsset = issue.code === 'scene_group_asset_mismatch' && issue.episodeId === doc.currentEpisodeId && !!issue.sceneId && !!issue.assetId
        const canAddPlannedAsset = issue.code === 'episode_plan_missing_asset' && !!issue.assetId && storyboardsForIssueEpisode(issue.episodeId).length > 0
        const canBindPlannedVariant =
          issue.code === 'episode_plan_missing_variant' &&
          !!issue.assetId &&
          !!issue.variantId &&
          !!issue.episodeId &&
          storyboardsForIssueEpisode(issue.episodeId).length > 0
        const canAddVariantParentToPlan = issue.code === 'episode_plan_variant_asset_missing' && !!issue.episodeId && !!issue.assetId
        const canCreateMissingPlannedEpisodes = issue.code === 'series_planned_episodes_missing' && (doc.seriesBible?.plannedEpisodeCount ?? 0) > (doc.episodes?.length || report.episodes.length)
        const canRemoveInvalidPlanRef =
          !!issue.episodeId &&
          ((issue.code === 'episode_plan_invalid_asset' && !!issue.assetId) || (issue.code === 'episode_plan_invalid_variant' && !!issue.variantId))
        const issueAsset = issue.assetId ? doc.assets.find((item) => item.id === issue.assetId) : undefined
        const canRemoveDuplicateAlias =
          issue.code === 'duplicate_asset_alias' &&
          !!issue.conflictLabel &&
          !!issueAsset?.aliases?.some((alias) => normalizeAssetLookup(alias) === normalizeAssetLookup(issue.conflictLabel))
        const canRenameConflictAsset =
          !!issueAsset &&
          (issue.code === 'duplicate_asset_name' || (issue.code === 'duplicate_asset_alias' && issue.conflictSource === 'name'))
        const canAddUnusedAsset = issue.code === 'unused_project_asset' && !!issue.assetId && doc.storyboards.length > 0
        const canResolveLibraryCandidate =
          (issue.code === 'asset_matches_unlinked_library_entity' || issue.code === 'library_entity_alias_conflict') &&
          !!issue.assetId &&
          (issue.candidateLibraryEntityIds?.length ?? 0) > 0
        const canMergeDuplicateLibraryAsset = (issue.code === 'duplicate_library_entity_project_assets' || issue.code === 'cross_episode_duplicate_project_asset_candidate') && !!issue.assetId && (issue.relatedAssetIds?.length ?? 0) > 0
        const canSyncLibraryEntity = issue.code === 'library_entity_version_outdated' && !!issue.assetId && !!issue.libraryEntityId && hubEntities.some((entity) => entity.id === issue.libraryEntityId && !entity.archived)
        const canPublishMissingLibraryEntity = issue.code === 'library_entity_missing' && !!issue.assetId
        const refAction = missingRefAction(issue)
        return (
          <div key={`${issue.code}-${index}`} className={`afs-studio__continuityissue is-${issue.severity}`}>
            <div className="afs-studio__continuityissue-top">
              <span>{issue.severity === 'error' ? '错误' : '警告'}</span>
              <code>{issue.code}</code>
            </div>
            <p>{issue.message}</p>
            {variantKindChips.length > 0 && (
              <div className="afs-studio__continuitymeta" aria-label="形态类型">
                {variantKindChips.map((chip) => <span key={chip}>{chip}</span>)}
              </div>
            )}
            {loc && <small>{loc}</small>}
            {canMergeDuplicateLibraryAsset && renderMergePreview(issue)}
            {canAddVariantScope && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => addVariantScope(issue)}>
                {addVariantScopeLabel}
              </button>
            )}
            {canBindEpisodeVariant && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => bindEpisodeVariant(issue)}>
                {(issue.candidateVariantIds?.length ?? 0) > 1 ? '选择并绑定形态' : '绑定本集形态'}
              </button>
            )}
            {canCarryPreviousVariant && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => carryPreviousVariant(issue)}>
                沿用上一形态
              </button>
            )}
            {canUnifySceneVariant && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => unifySceneVariant(issue)}>
                统一为此形态
              </button>
            )}
            {canBindSceneAsset && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => bindSceneAsset(issue)}>
                补场景资产
              </button>
            )}
            {canUnifySceneAsset && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => unifySceneAsset(issue)}>
                统一为此场景
              </button>
            )}
            {canAddPlannedAsset && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => addPlannedAssetToStoryboard(issue)}>
                加入计划资产到分镜
              </button>
            )}
            {canBindPlannedVariant && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => bindPlannedVariantToStoryboard(issue)}>
                绑定计划形态到分镜
              </button>
            )}
            {canAddVariantParentToPlan && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => addVariantParentToEpisodePlan(issue)}>
                补入本集计划资产
              </button>
            )}
            {canCreateMissingPlannedEpisodes && (
              <button type="button" className="afs-studio__continuityfix" onClick={createMissingPlannedEpisodes}>
                补齐计划剧集
              </button>
            )}
            {canRemoveInvalidPlanRef && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => removeInvalidEpisodePlanRef(issue)}>
                从剧集计划移除
              </button>
            )}
            {canRemoveDuplicateAlias && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => removeDuplicateAlias(issue)}>
                移除此别名
              </button>
            )}
            {canRenameConflictAsset && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => renameConflictAsset(issue)}>
                重命名资产
              </button>
            )}
            {canAddUnusedAsset && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => addUnusedAssetToStoryboard(issue)}>
                加入当前集分镜
              </button>
            )}
            {canResolveLibraryCandidate && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => linkCandidateLibraryEntity(issue)}>
                {issue.code === 'library_entity_alias_conflict' ? '改关联候选身份' : '关联候选身份'}
              </button>
            )}
            {canResolveLibraryCandidate && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => markDistinctLibraryIdentity(issue)}>
                {(issue.candidateLibraryEntityIds?.length ?? 0) > 1 ? '候选均为不同身份' : '标记为不同身份'}
              </button>
            )}
            {canMergeDuplicateLibraryAsset && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => mergeDuplicateProjectAsset(issue)}>
                合并到同身份项目资产
              </button>
            )}
            {canSyncLibraryEntity && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => void syncLinkedLibraryEntity(issue)}>
                同步资产中心新版
              </button>
            )}
            {canPublishMissingLibraryEntity && (
              <button type="button" className="afs-studio__continuityfix" onClick={() => void publishMissingLibraryEntity(issue)}>
                重新发布为身份资产
              </button>
            )}
            {refAction && (
              <button type="button" className="afs-studio__continuityfix" onClick={refAction.run}>
                {refAction.label}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
  return (
    <div className="afs-studio__drawer-scrim" onClick={onClose}>
      <div className="afs-studio__drawer" onClick={(e) => e.stopPropagation()}>
        <div className="afs-studio__drawer-head">
          <span>一致性检查详情</span>
          <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="afs-studio__drawer-body afs-studio__continuitydrawer">
          <div className="afs-studio__continuitysummary">
            <span>{report.episodes.length} 集</span>
            <span>{errors.length} 错误</span>
            <span>{warnings.length} 警告</span>
            {canRedistributeChapters && (
              <button type="button" className="afs-studio__continuityfix" onClick={redistributeChapters}>
                重新均分原著章节
              </button>
            )}
          </div>
          {errors.length > 0 && (
            <section className="afs-studio__continuitysection">
              <h3>错误</h3>
              {renderIssues(errors)}
            </section>
          )}
          {warnings.length > 0 && (
            <section className="afs-studio__continuitysection">
              <h3>警告</h3>
              {renderIssues(warnings)}
            </section>
          )}
        </div>
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
  const currentEpisodeId = doc.currentEpisodeId
  const episodeName = (id: string) => {
    const episode = doc.episodes?.find((item) => item.id === id)
    return episode ? `E${episode.index + 1} ${episode.title}` : id
  }
  const variantScope = (variant: AssetVariant) => {
    const ids = variant.appliesToEpisodeIds ?? []
    if (!ids.length) return { current: true, label: '全剧', title: '适用于全部剧集' }
    const current = !!currentEpisodeId && ids.includes(currentEpisodeId)
    return { current, label: current ? '当前集' : '其他集', title: `适用于：${ids.map(episodeName).join('、')}` }
  }
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
