import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  Upload,
  Trash2,
  Pencil,
  Clapperboard,
  Film,
  Workflow,
  MoreHorizontal,
  Search,
  X,
  Check,
} from 'lucide-react'
import { useGraphStore, type ProjectCard, type ProjectData } from '../../store/graphStore'
import { useProjectStore } from '../../store/projectStore'
import { listStylePacks } from '../../services/stylePacks'
import { TEMPLATES } from '../../templates'
import { useMediaUrl } from '../../services/mediaUrl'
import Select from '../ui/Select'
import Menu from '../ui/Menu'
import EmptyState from '../ui/EmptyState'
import Button from '../ui/Button'
import IconButton from '../ui/IconButton'
import Segmented from '../ui/Segmented'
import { useConfirm } from '../ui/ConfirmDialog'
import { usePrompt } from '../ui/PromptDialog'

function relTime(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleDateString()
}

/** 工程封面：按 assetId 经 useMediaUrl 解析 blob:（画布 coverAssetId / 工作流 coverImageId 都是同一素材库的 id） */
function Cover({ assetId, studio }: { assetId?: string; studio?: boolean }) {
  const url = useMediaUrl(assetId ? { assetId } : null)
  return url ? (
    <img src={url} alt="" />
  ) : (
    <div className="afs-lp-card__ph">{studio ? <Film size={26} /> : <Clapperboard size={26} />}</div>
  )
}

/** 统一项目主页：画布工程 + 工作流项目并为一个列表，按更新时间排序；新建/打开时区分类型。 */
type Row =
  | { kind: 'canvas'; id: string; updatedAt: number; card: ProjectCard }
  | { kind: 'studio'; id: string; updatedAt: number; name: string; cover?: string; meta: string }

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
}

const CAT_CANVAS: React.CSSProperties = { ['--cat' as never]: 'var(--afs-cat-image)' }
const CAT_STUDIO: React.CSSProperties = { ['--cat' as never]: 'var(--afs-type-video)' }

export default function ProjectHome({ onOpenCanvas, onOpenStudio }: { onOpenCanvas: () => void; onOpenStudio: () => void }) {
  // —— 画布（节点图）——
  const currentId = useGraphStore((s) => s.currentId)
  const projects = useGraphStore((s) => s.projects) // 列表变化触发刷新
  const loadProjectCards = useGraphStore((s) => s.loadProjectCards)
  const switchProject = useGraphStore((s) => s.switchProject)
  const newProject = useGraphStore((s) => s.newProject)
  const duplicateProject = useGraphStore((s) => s.duplicateProject)
  const deleteProject = useGraphStore((s) => s.deleteProject)
  const renameProjectById = useGraphStore((s) => s.renameProjectById)
  const exportProjectById = useGraphStore((s) => s.exportProjectById)
  const importProject = useGraphStore((s) => s.importProject)
  const loadTemplate = useGraphStore((s) => s.loadTemplate)
  // —— 工作流（结构化工作台）——
  const studioCards = useProjectStore((s) => s.cards)
  const refreshStudioCards = useProjectStore((s) => s.refreshCards)
  const createStudio = useProjectStore((s) => s.createProject)
  const openStudio = useProjectStore((s) => s.openProject)
  const deleteStudio = useProjectStore((s) => s.deleteProject)

  // —— 应用内确认/输入（ConfirmProvider / PromptProvider 已挂在 App 根）——
  const confirm = useConfirm()
  const prompt = usePrompt()

  const styles = listStylePacks()
  const styleLabel = (id: string) => styles.find((p) => p.id === id)?.label ?? id

  const fileRef = useRef<HTMLInputElement>(null)
  const [canvasCards, setCanvasCards] = useState<ProjectCard[]>([])
  const refreshCanvas = async () => setCanvasCards(await loadProjectCards())
  useEffect(() => {
    void refreshCanvas()
    void refreshStudioCards()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length, currentId])

  // —— 本屏 UI 局部状态（仅影响渲染子集 / chrome，不触碰数据流）——
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('all')
  const [scrolled, setScrolled] = useState(false)
  const [creatingCanvas, setCreatingCanvas] = useState(false)
  const [creatingStudio, setCreatingStudio] = useState(false)

  const rows: Row[] = useMemo(() => {
    const a: Row[] = canvasCards.map((c) => ({ kind: 'canvas', id: c.id, updatedAt: c.updatedAt, card: c }))
    const b: Row[] = studioCards.map((c) => ({
      kind: 'studio',
      id: c.id,
      updatedAt: c.updatedAt,
      name: c.name,
      cover: c.coverImageId,
      meta: `${styleLabel(c.artStyle)} · ${c.videoRatio} · ${c.storyboardCount} 分镜`,
    }))
    return [...a, ...b].sort((x, y) => y.updatedAt - x.updatedAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasCards, studioCards])

  // 仅过滤「渲染子集」：不重排、不合并、不改 rows
  const filtered: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false
      if (!q) return true
      const name = r.kind === 'canvas' ? r.card.name : r.name
      return name.toLowerCase().includes(q)
    })
  }, [rows, kind, query])

  // —— 画布操作 ——
  const openCanvas = async (id: string) => {
    await switchProject(id)
    onOpenCanvas()
  }
  const onNewCanvas = async () => {
    setCreatingCanvas(true)
    try {
      await newProject()
      onOpenCanvas()
    } finally {
      setCreatingCanvas(false)
    }
  }
  const onTemplate = async (tid: string) => {
    if (!tid) return
    await loadTemplate(tid)
    onOpenCanvas()
  }
  const onRename = async (c: ProjectCard) => {
    const name = await prompt({ title: '重命名工程', defaultValue: c.name, confirmLabel: '确定' })
    if (name && name.trim()) {
      await renameProjectById(c.id, name.trim())
      void refreshCanvas()
    }
  }
  const onDup = async (c: ProjectCard) => {
    await duplicateProject(c.id)
    void refreshCanvas()
  }
  const onDeleteCanvas = async (c: ProjectCard) => {
    if (await confirm({ title: '删除画布工程', message: `确定删除画布工程「${c.name}」？此操作不可撤销。`, confirmLabel: '删除', danger: true })) {
      await deleteProject(c.id)
      void refreshCanvas()
    }
  }
  const onExport = async (c: ProjectCard) => {
    const data = await exportProjectById(c.id)
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${c.name || 'ai-film-project'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const data = JSON.parse(await file.text()) as Partial<ProjectData>
      await newProject()
      await importProject(data)
      void refreshCanvas()
      onOpenCanvas()
    } catch {
      window.mulby?.notification?.show('导入失败：文件格式不正确', 'error')
    }
  }

  // —— 工作流操作 ——
  const onNewStudio = async () => {
    setCreatingStudio(true)
    try {
      await createStudio({ name: '新项目' })
      onOpenStudio()
    } finally {
      setCreatingStudio(false)
    }
  }
  const openStudioCard = async (id: string) => {
    await openStudio(id)
    onOpenStudio()
  }
  const onDeleteStudio = async (id: string, name: string) => {
    if (await confirm({ title: '删除工作流项目', message: `确定删除工作流项目「${name}」？此操作不可撤销。`, confirmLabel: '删除', danger: true })) {
      await deleteStudio(id)
    }
  }

  return (
    <div className="afs-surface afs-lp">
      {/* —— 玻璃工具栏 —— */}
      <div className={`afs-lp-bar${scrolled ? ' is-scrolled' : ''}`} role="toolbar" aria-label="项目工具栏">
        <h2 className="afs-lp-bar__title">项目</h2>
        <div className="afs-lp-bar__spacer" />
        <div className="afs-lp-bar__group">
          <div className="afs-lp-search">
            <Search size={15} aria-hidden />
            <input
              className="afs-lp-search__input"
              type="search"
              value={query}
              placeholder="搜索项目…"
              aria-label="搜索项目"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setQuery('')
                }
              }}
            />
            {query && (
              <button className="afs-lp-search__clear" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            )}
          </div>
          <span className="afs-lp-bar__divider" aria-hidden />
          <Segmented
            ariaLabel="按类型筛选"
            value={kind}
            onChange={setKind}
            size="sm"
            options={[
              { value: 'all', label: '全部' },
              { value: 'canvas', label: '画布' },
              { value: 'studio', label: '工作流' },
            ]}
          />
          <span className="afs-lp-bar__divider" aria-hidden />
          <Button variant="ghost" size="sm" leadingIcon={Upload} onClick={() => fileRef.current?.click()} title="导入画布工程 JSON">
            导入
          </Button>
        </div>
        <span style={VISUALLY_HIDDEN} aria-live="polite">{`${filtered.length} 个项目`}</span>
      </div>

      {/* —— 滚动体（静态极光铺底）—— */}
      <div className="afs-lp-body" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        {/* HERO 新建行 */}
        <div className="afs-lp-hero">
          <div className="afs-lp-herocard">
            <div className="afs-lp-herocard__head">
              <div className="afs-lp-herocard__tile" style={CAT_CANVAS}>
                <Workflow size={20} />
              </div>
              <div>
                <div className="afs-lp-herocard__title">新建画布工程</div>
                <div className="afs-lp-herocard__caption">自由节点图，精细编排生成流程</div>
              </div>
            </div>
            <div className="afs-lp-herocard__foot">
              <Button variant="gradient" glow leadingIcon={Workflow} loading={creatingCanvas} onClick={onNewCanvas} title="新建空白画布工程">
                新建画布
              </Button>
              <Select
                value=""
                onChange={(v) => onTemplate(v)}
                options={TEMPLATES.map((t) => ({ value: t.id, label: t.name, title: t.desc }))}
                placeholder="从模板…"
                title="从模板新建画布工程"
                ariaLabel="从模板新建画布工程"
                size="sm"
              />
            </div>
          </div>

          <div className="afs-lp-herocard">
            <div className="afs-lp-herocard__head">
              <div className="afs-lp-herocard__tile" style={CAT_STUDIO}>
                <Film size={20} />
              </div>
              <div>
                <div className="afs-lp-herocard__title">新建工作流项目</div>
                <div className="afs-lp-herocard__caption">AI 短剧工作台，分镜→成片</div>
              </div>
            </div>
            <div className="afs-lp-herocard__foot">
              <Button variant="gradient" glow leadingIcon={Film} loading={creatingStudio} onClick={onNewStudio} title="新建工作流（AI 短剧工作台）项目">
                新建工作流
              </Button>
            </div>
          </div>
        </div>

        {/* RECENT 区 */}
        {rows.length === 0 ? (
          <EmptyState icon={Clapperboard} title="开始你的第一个项目" description="点上方「新建画布 / 新建工作流」开始。" />
        ) : (
          <>
            <div className="afs-lp-recenthead">
              <span className="afs-lp-recenthead__label">最近项目</span>
              <span className="afs-lp-recenthead__count">{filtered.length}</span>
            </div>
            {filtered.length === 0 ? (
              <EmptyState icon={Clapperboard} title="无匹配项目" description="调整筛选或搜索关键词。" />
            ) : (
              <div className="afs-lp-grid">
                {filtered.map((r) =>
                  r.kind === 'canvas' ? (
                    <div key={`c:${r.id}`} className={`afs-lp-card${r.id === currentId ? ' is-selected' : ''}`}>
                      <div
                        className="afs-lp-card__media"
                        role="button"
                        tabIndex={0}
                        onClick={() => openCanvas(r.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            void openCanvas(r.id)
                          }
                        }}
                        title="打开工程"
                      >
                        <Cover assetId={r.card.coverAssetId} />
                        <span className="afs-lp-card__cat" style={CAT_CANVAS}>
                          画布
                        </span>
                        {r.card.aspectRatio && <span className="afs-lp-card__pill afs-lp-card__pill--ratio">{r.card.aspectRatio}</span>}
                        <span className="afs-lp-card__pill afs-lp-card__pill--count">{r.card.nodeCount} 节点</span>
                      </div>
                      <div className="afs-lp-card__body">
                        <div className="afs-lp-card__name" title={r.card.name}>
                          <span className="afs-lp-card__nametext">{r.card.name}</span>
                          {r.id === currentId && (
                            <span className="afs-lp-card__current">
                              <Check size={11} />
                              当前
                            </span>
                          )}
                        </div>
                        <div className="afs-lp-card__time">{relTime(r.updatedAt)}</div>
                        {r.card.style && (
                          <div className="afs-lp-card__meta" title={r.card.style}>
                            风格：{r.card.style}
                          </div>
                        )}
                      </div>
                      <div className="afs-lp-card__foot">
                        <Button variant="secondary" size="sm" onClick={() => openCanvas(r.id)}>
                          打开
                        </Button>
                        <span className="afs-lp-card__footspacer" />
                        <Menu
                          align="end"
                          trigger={<IconButton size="sm" aria-label="更多操作" title="更多操作" icon={<MoreHorizontal size={16} />} />}
                          items={[
                            { label: '重命名', icon: Pencil, onSelect: () => onRename(r.card) },
                            { label: '复制工程', icon: Copy, onSelect: () => onDup(r.card) },
                            { label: '导出 JSON', icon: Download, onSelect: () => onExport(r.card) },
                            { label: '删除工程', icon: Trash2, danger: true, separatorBefore: true, onSelect: () => onDeleteCanvas(r.card) },
                          ]}
                        />
                      </div>
                    </div>
                  ) : (
                    <div key={`s:${r.id}`} className="afs-lp-card">
                      <div
                        className="afs-lp-card__media"
                        role="button"
                        tabIndex={0}
                        onClick={() => openStudioCard(r.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            void openStudioCard(r.id)
                          }
                        }}
                        title="打开工作流项目"
                      >
                        <Cover assetId={r.cover} studio />
                        <span className="afs-lp-card__cat" style={CAT_STUDIO}>
                          工作流
                        </span>
                      </div>
                      <div className="afs-lp-card__body">
                        <div className="afs-lp-card__name" title={r.name}>
                          <span className="afs-lp-card__nametext">{r.name}</span>
                        </div>
                        <div className="afs-lp-card__time">{relTime(r.updatedAt)}</div>
                        <div className="afs-lp-card__meta" title={r.meta}>
                          {r.meta}
                        </div>
                      </div>
                      <div className="afs-lp-card__foot">
                        <Button variant="secondary" size="sm" onClick={() => openStudioCard(r.id)}>
                          打开
                        </Button>
                        <span className="afs-lp-card__footspacer" />
                        <Menu
                          align="end"
                          trigger={<IconButton size="sm" aria-label="更多操作" title="更多操作" icon={<MoreHorizontal size={16} />} />}
                          items={[{ label: '删除项目', icon: Trash2, danger: true, onSelect: () => onDeleteStudio(r.id, r.name) }]}
                        />
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </>
        )}
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
    </div>
  )
}
