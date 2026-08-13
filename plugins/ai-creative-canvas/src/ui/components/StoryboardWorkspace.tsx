import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clapperboard, Image as ImageIcon, LayoutList, MapPin, Plus, RefreshCcw, Search, Sparkles, Video } from 'lucide-react'
import { focusCard } from '../focusCard'
import { generateCard } from '../services/generate'
import { layoutStoryboardCards, materializeStoryboardShots, saveStoryboardDoc, shotToVideo } from '../services/storyboard'
import { appendStoryboardShot, storyboardStageState, type StoryboardStageState } from '../services/storyboardV2'
import {
  filterStoryboardShots,
  listProjectStoryboards,
  stagePreview,
  virtualShotWindow,
  type ProjectStoryboardEntry
} from '../services/storyboardWorkspace'
import { useGraph } from '../store/graphStore'
import { toast } from '../store/toastStore'
import { useUi } from '../store/uiStore'
import type { AssetAnchor, StoryboardShotV2 } from '../types'
import { StoryboardShotInspector } from './StoryboardShotInspector'

const STATE_LABEL: Record<StoryboardStageState, string> = {
  unmaterialized: '未落地', synced: '待生成', stale: '输入已变', running: '生成中', error: '失败', done: '已完成'
}

const STATE_CLASS: Record<StoryboardStageState, string> = {
  unmaterialized: 'opacity-45',
  synced: 'text-indigo-500',
  stale: 'text-amber-600 dark:text-amber-300',
  running: 'text-blue-500',
  error: 'text-red-500',
  done: 'text-emerald-600 dark:text-emerald-300'
}

const ROLE_LABEL: Record<AssetAnchor['role'], string> = {
  character: '角色', scene: '场景', prop: '道具', voice: '声音', style: '风格', music: '音乐', reference: '参考'
}

function StageBadge({ state, label }: { state: StoryboardStageState; label: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap text-[10px] ${STATE_CLASS[state]}`}><span className="opacity-60">{label}</span>{STATE_LABEL[state]}</span>
}

function ShotPreview({ url, icon }: { url?: string; icon: 'image' | 'video' }) {
  return (
    <div className="relative w-full h-full rounded-md overflow-hidden bg-black/5 dark:bg-white/5 border" style={{ borderColor: 'var(--ace-border)' }}>
      {url ? <img src={url} draggable={false} className="w-full h-full object-cover" alt="" /> : (
        <div className="w-full h-full grid place-items-center opacity-25">{icon === 'image' ? <ImageIcon size={18} /> : <Video size={18} />}</div>
      )}
      <span className="absolute left-1 bottom-1 rounded bg-black/60 text-white px-1 text-[8px]">{icon === 'image' ? '静帧' : '视频'}</span>
    </div>
  )
}

function WindowedShots({
  entry,
  shots,
  selectedId,
  density,
  anchors,
  onSelect
}: {
  entry: ProjectStoryboardEntry
  shots: StoryboardShotV2[]
  selectedId: string | null
  density: 'list' | 'thumb'
  anchors: Record<string, AssetAnchor>
  onSelect: (shotId: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(480)
  const rowHeight = density === 'thumb' ? 132 : 82
  const virtualized = shots.length > 50
  const range = virtualShotWindow(shots.length, rowHeight, scrollTop, viewportHeight)
  const visible = virtualized ? shots.slice(range.start, range.end) : shots

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setViewportHeight(element.clientHeight || 480)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!virtualized || !selectedId || !ref.current) return
    const index = shots.findIndex((shot) => shot.id === selectedId)
    if (index < 0) return
    const top = index * rowHeight
    const bottom = top + rowHeight
    if (top < ref.current.scrollTop || bottom > ref.current.scrollTop + ref.current.clientHeight) {
      const next = Math.max(0, top - ref.current.clientHeight / 3)
      ref.current.scrollTop = next
      setScrollTop(next)
    }
  }, [selectedId, shots, rowHeight, virtualized])

  const locate = (shot: StoryboardShotV2) => {
    const cardId = shot.imageCardId || shot.videoCardId || shot.audioCardId || entry.owner.id
    useUi.getState().setWorkspaceView('canvas')
    focusCard(entry.boardId, cardId)
  }
  const sync = (shot: StoryboardShotV2) => {
    const result = materializeStoryboardShots(entry.owner.id, entry.doc, new Set([shot.id]))
    if (result) toast(`镜头 ${shot.shotNumber ?? shot.order + 1} 已同步`, 'success')
  }
  const generateImage = (shot: StoryboardShotV2) => {
    const result = materializeStoryboardShots(entry.owner.id, entry.doc, new Set([shot.id]))
    const cardId = result?.doc.shots.find((item) => item.id === shot.id)?.imageCardId
    if (cardId) generateCard(cardId)
  }
  const createVideo = (shot: StoryboardShotV2) => {
    if (shot.videoCardId && entry.board.cards[shot.videoCardId]) {
      useUi.getState().setWorkspaceView('canvas')
      focusCard(entry.boardId, shot.videoCardId)
      return
    }
    let imageCardId = shot.imageCardId
    if (!imageCardId) {
      const result = materializeStoryboardShots(entry.owner.id, entry.doc, new Set([shot.id]))
      imageCardId = result?.doc.shots.find((item) => item.id === shot.id)?.imageCardId
    }
    if (imageCardId) shotToVideo(imageCardId)
  }

  const renderRow = (shot: StoryboardShotV2, absoluteIndex: number) => {
    const imageCard = shot.imageCardId ? entry.board.cards[shot.imageCardId] : undefined
    const videoCard = shot.videoCardId ? entry.board.cards[shot.videoCardId] : undefined
    const imageState = storyboardStageState(entry.doc, shot, entry.board, 'image')
    const videoState = storyboardStageState(entry.doc, shot, entry.board, 'video')
    const selected = selectedId === shot.id
    const anchorList = shot.anchorIds.map((id) => anchors[id]).filter((anchor): anchor is AssetAnchor => !!anchor)
    return (
      <div
        key={shot.id}
        data-shot-id={shot.id}
        onClick={() => onSelect(shot.id)}
        className={`absolute left-0 right-0 px-2 py-1 cursor-pointer ${selected ? 'bg-indigo-500/10' : 'hover:bg-black/[0.035] dark:hover:bg-white/[0.04]'}`}
        style={{ top: absoluteIndex * rowHeight, height: rowHeight }}
      >
        <div className="h-full rounded-lg border px-2 py-2 flex items-center gap-2 bg-white/65 dark:bg-white/[0.025]" style={{ borderColor: selected ? '#818cf8' : 'var(--ace-border)' }}>
          <div className="w-8 shrink-0 text-center">
            <div className="text-sm font-semibold">{shot.shotNumber ?? shot.order + 1}</div>
            <div className="text-[9px] opacity-45">{shot.duration || 0}s</div>
          </div>
          <div className={density === 'thumb' ? 'w-[104px] h-[104px] shrink-0' : 'w-12 h-12 shrink-0'}><ShotPreview url={stagePreview(imageCard, 'image')} icon="image" /></div>
          <div className={density === 'thumb' ? 'w-[104px] h-[104px] shrink-0' : 'w-12 h-12 shrink-0'}><ShotPreview url={stagePreview(videoCard, 'video')} icon="video" /></div>
          <div className="min-w-0 flex-1 self-stretch flex flex-col justify-center">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-medium shrink-0">{shot.shotSize || '未定景别'}</span>
              <span className="text-xs truncate">{shot.imagePrompt || shot.desc || '未填写画面'}</span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <StageBadge state={imageState} label="图" />
              <StageBadge state={videoState} label="视频" />
              {shot.dialogue && <span className="text-[10px] opacity-45 truncate">对白：{shot.dialogue}</span>}
            </div>
            {!!anchorList.length && (
              <div className="flex items-center gap-1 mt-1 overflow-hidden">
                {anchorList.slice(0, 4).map((anchor) => <span key={anchor.id} className="shrink-0 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 px-1.5 py-0.5 text-[9px]">{anchor.name}</span>)}
                {anchorList.length > 4 && <span className="text-[9px] opacity-40">+{anchorList.length - 4}</span>}
              </div>
            )}
          </div>
          <div className="w-[98px] shrink-0 grid grid-cols-2 gap-1" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => locate(shot)} className="h-7 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 grid place-items-center" title="定位画布"><MapPin size={12} /></button>
            <button type="button" onClick={() => sync(shot)} className="h-7 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 grid place-items-center" title="同步静帧卡"><RefreshCcw size={12} /></button>
            <button type="button" onClick={() => generateImage(shot)} className="h-7 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/15 grid place-items-center" title={imageState === 'done' ? '重做静帧' : '生成缺失静帧'}><Sparkles size={12} /></button>
            <button type="button" onClick={() => createVideo(shot)} className="h-7 rounded bg-pink-500/10 text-pink-600 dark:text-pink-300 hover:bg-pink-500/15 grid place-items-center" title={shot.videoCardId ? '打开视频卡' : '创建视频卡'}><Video size={12} /></button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-y-auto ace-noscroll" onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="relative" style={{ height: virtualized ? range.totalHeight : shots.length * rowHeight }}>
        {visible.map((shot, index) => renderRow(shot, virtualized ? range.start + index : index))}
      </div>
    </div>
  )
}

export function StoryboardWorkspace() {
  const project = useGraph((state) => state.project)
  const selection = useUi((state) => state.storyboardSelection)
  const entries = useMemo(() => listProjectStoryboards(project), [project])
  const anchors = project.assetAnchors || {}
  const [query, setQuery] = useState('')
  const [selectedAnchors, setSelectedAnchors] = useState<Set<string>>(new Set())
  const [stateFilter, setStateFilter] = useState<'all' | 'needs-attention' | StoryboardStageState>('all')
  const [density, setDensity] = useState<'list' | 'thumb'>('list')

  const entry = entries.find((item) => item.doc.id === selection?.storyboardId) || entries[0]
  const filtered = entry ? filterStoryboardShots(entry, anchors, { query, anchorIds: selectedAnchors, state: stateFilter, stage: 'image' }) : []
  const shot = filtered.find((item) => item.id === selection?.shotId)
    || filtered[0]
    || entry?.doc.shots.find((item) => item.id === selection?.shotId)
    || entry?.doc.shots[0]
    || null

  useEffect(() => {
    if (!entry) {
      if (selection) useUi.getState().setStoryboardSelection(null)
      return
    }
    if (selection?.storyboardId !== entry.doc.id || selection?.shotId !== shot?.id) {
      useUi.getState().setStoryboardSelection({ storyboardId: entry.doc.id, shotId: shot?.id || null })
    }
  }, [entry?.doc.id, shot?.id, selection?.storyboardId, selection?.shotId])

  const chooseStoryboard = (next: ProjectStoryboardEntry) => {
    useUi.getState().setStoryboardSelection({ storyboardId: next.doc.id, shotId: next.doc.shots[0]?.id || null })
    setSelectedAnchors(new Set())
    setQuery('')
  }
  const toggleAnchor = (id: string) => setSelectedAnchors((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const selectShot = (shotId: string) => entry && useUi.getState().setStoryboardSelection({ storyboardId: entry.doc.id, shotId })
  const reflow = () => {
    if (!entry) return
    const result = layoutStoryboardCards(entry.owner.id, entry.doc)
    if (result) toast(result.moved ? `已按镜头顺序重排 ${result.moved} 张产物卡` : '镜头产物已经按顺序排列', 'success')
  }
  const syncAll = () => {
    if (!entry) return
    const result = materializeStoryboardShots(entry.owner.id, entry.doc)
    if (result) toast(`已同步 ${result.cardIds.length} 个镜头（新建 ${result.created}，更新 ${result.updated}）`, 'success')
  }
  const addShot = () => {
    if (!entry) return
    const next = appendStoryboardShot(entry.doc)
    const saved = saveStoryboardDoc(entry.owner.id, next)
    const created = saved?.shots[saved.shots.length - 1]
    if (created) useUi.getState().setStoryboardSelection({ storyboardId: saved!.id, shotId: created.id })
  }

  if (!entry) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-[var(--ace-bg)]">
        <div className="text-center max-w-md px-6">
          <Clapperboard size={36} className="mx-auto text-indigo-400 opacity-70" />
          <div className="mt-3 font-semibold">工程中还没有故事板</div>
          <div className="mt-1 text-sm opacity-55">回到画布，选择一张文本卡并打开“分镜”；可以用 AI 生成，也可以手动添加第一个镜头。</div>
          <button type="button" onClick={() => useUi.getState().setWorkspaceView('canvas')} className="mt-4 px-4 py-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 text-sm">返回画布</button>
        </div>
      </div>
    )
  }

  const groupedAnchors = Object.values(anchors).reduce<Partial<Record<AssetAnchor['role'], AssetAnchor[]>>>((groups, anchor) => {
    ;(groups[anchor.role] ||= []).push(anchor)
    return groups
  }, {})

  return (
    <div className="absolute inset-0 flex min-w-0 min-h-0 bg-[var(--ace-bg)]">
      <aside className="w-[218px] shrink-0 border-r flex flex-col min-h-0 bg-white/55 dark:bg-neutral-950/30" style={{ borderColor: 'var(--ace-border)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="text-[10px] uppercase tracking-wide opacity-45">当前故事板</div>
          <div className="mt-2 space-y-1 max-h-32 overflow-y-auto ace-noscroll">
            {entries.map((item) => (
              <button
                key={item.doc.id}
                type="button"
                onClick={() => chooseStoryboard(item)}
                className={`w-full rounded-md px-2 py-1.5 text-left ${item.doc.id === entry.doc.id ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
              >
                <div className="text-xs font-medium truncate">{item.doc.title}</div>
                <div className="text-[9px] opacity-50 truncate">{item.boardName} · {item.doc.shots.length} 镜</div>
              </button>
            ))}
          </div>
        </div>
        <div className="px-3 py-3 flex-1 min-h-0 overflow-y-auto ace-noscroll">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide opacity-45">关键元素筛选</span>
            {!!selectedAnchors.size && <button type="button" onClick={() => setSelectedAnchors(new Set())} className="text-[10px] text-indigo-500 hover:underline">清除</button>}
          </div>
          {!Object.keys(groupedAnchors).length ? (
            <div className="mt-3 text-[11px] opacity-40 leading-relaxed">暂无语义锚点。可在图片、文本或素材节点中登记角色、场景和道具。</div>
          ) : Object.entries(groupedAnchors).map(([role, list]) => (
            <div key={role} className="mt-3">
              <div className="text-[10px] opacity-45 mb-1">{ROLE_LABEL[role as AssetAnchor['role']]}</div>
              <div className="space-y-1">
                {list!.map((anchor) => {
                  const active = selectedAnchors.has(anchor.id)
                  return <button key={anchor.id} type="button" onClick={() => toggleAnchor(anchor.id)} className={`w-full px-2 py-1.5 rounded-md text-left text-[11px] truncate ${active ? 'bg-indigo-500 text-white' : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15'}`}>{anchor.name}</button>
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t text-[10px] opacity-45" style={{ borderColor: 'var(--ace-border)' }}>筛选只改变投影视图，不修改镜头数据</div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col min-h-0">
        <div className="h-12 shrink-0 px-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="relative flex-1 min-w-[130px] max-w-md">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-40" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索画面、角色、场景、对白…" className="w-full rounded-md bg-black/5 dark:bg-white/10 pl-7 pr-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-400" />
          </div>
          <select value={stateFilter} onChange={(event) => setStateFilter(event.target.value as typeof stateFilter)} className="rounded-md bg-black/5 dark:bg-white/10 px-2 py-1.5 text-[11px] outline-none">
            <option value="all">全部状态</option>
            <option value="needs-attention">仅需处理</option>
            <option value="unmaterialized">未落地</option>
            <option value="synced">待生成</option>
            <option value="stale">输入已变</option>
            <option value="running">生成中</option>
            <option value="error">失败</option>
            <option value="done">已完成</option>
          </select>
          <button type="button" onClick={() => setDensity((value) => value === 'list' ? 'thumb' : 'list')} className="h-7 px-2 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px] flex items-center gap-1" title="切换列表 / 缩略图密度"><LayoutList size={12} /> {density === 'list' ? '列表' : '缩略图'}</button>
          <button type="button" onClick={addShot} className="h-7 px-2 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px] flex items-center gap-1"><Plus size={12} /> 添加镜头</button>
          <button type="button" onClick={reflow} className="h-7 px-2 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px] flex items-center gap-1" title="只移动当前故事板关联的产物卡"><RefreshCcw size={12} /> 自动排版</button>
          <button type="button" onClick={syncAll} className="h-7 px-2 rounded-md bg-indigo-500 text-white hover:bg-indigo-600 text-[11px] flex items-center gap-1"><Clapperboard size={12} /> 同步全部</button>
        </div>
        <div className="h-8 shrink-0 px-3 flex items-center text-[10px] opacity-50 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <span>{entry.doc.shots.length} 镜</span><span className="mx-1.5">·</span><span>当前显示 {filtered.length}</span>
          {entry.doc.shots.length > 50 && <><span className="mx-1.5">·</span><span>已启用虚拟滚动</span></>}
        </div>
        {filtered.length ? (
          <WindowedShots entry={entry} shots={filtered} selectedId={shot?.id || null} density={density} anchors={anchors} onSelect={selectShot} />
        ) : entry.doc.shots.length === 0 ? (
          <div className="flex-1 grid place-items-center text-center px-6">
            <div>
              <Clapperboard size={24} className="mx-auto opacity-35" />
              <div className="mt-2 text-sm opacity-60">该故事板还没有镜头</div>
              <button type="button" onClick={addShot} className="mt-3 px-3 py-1.5 rounded-md bg-indigo-500 text-white hover:bg-indigo-600 text-xs"><Plus size={12} className="inline mr-1" />手动添加镜头</button>
            </div>
          </div>
        ) : (
          <div className="flex-1 grid place-items-center text-center px-6">
            <div>
              <AlertTriangle size={24} className="mx-auto opacity-35" />
              <div className="mt-2 text-sm opacity-60">没有符合当前筛选条件的镜头</div>
              <button type="button" onClick={() => { setQuery(''); setSelectedAnchors(new Set()); setStateFilter('all') }} className="mt-2 text-xs text-indigo-500 hover:underline">清除筛选</button>
            </div>
          </div>
        )}
      </main>

      {shot ? <StoryboardShotInspector key={`${entry.doc.id}:${shot.id}`} entry={entry} shot={shot} anchors={anchors} /> : (
        <aside className="w-[340px] shrink-0 border-l grid place-items-center text-sm opacity-45" style={{ borderColor: 'var(--ace-border)' }}>该故事板还没有镜头</aside>
      )}
    </div>
  )
}
