import { useEffect, useMemo, useRef, useState } from 'react'
import { Copy, Download, Upload, Trash2, Pencil, Clapperboard, Film, Workflow, MoreHorizontal } from 'lucide-react'
import { useGraphStore, type ProjectCard, type ProjectData } from '../../store/graphStore'
import { useProjectStore } from '../../store/projectStore'
import { listStylePacks } from '../../services/stylePacks'
import { TEMPLATES } from '../../templates'
import { useMediaUrl } from '../../services/mediaUrl'
import Select from '../ui/Select'
import Menu from '../ui/Menu'

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
  return url ? <img src={url} alt="" /> : <div className="afs-pcard__ph">{studio ? <Film size={26} /> : <Clapperboard size={26} />}</div>
}

/** 统一项目主页：画布工程 + 工作流项目并为一个列表，按更新时间排序；新建/打开时区分类型。 */
type Row =
  | { kind: 'canvas'; id: string; updatedAt: number; card: ProjectCard }
  | { kind: 'studio'; id: string; updatedAt: number; name: string; cover?: string; meta: string }

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

  // —— 画布操作 ——
  const openCanvas = async (id: string) => {
    await switchProject(id)
    onOpenCanvas()
  }
  const onNewCanvas = async () => {
    await newProject()
    onOpenCanvas()
  }
  const onTemplate = async (tid: string) => {
    if (!tid) return
    await loadTemplate(tid)
    onOpenCanvas()
  }
  const onRename = async (c: ProjectCard) => {
    const name = window.prompt('重命名工程', c.name)
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
    if (window.confirm(`确定删除画布工程「${c.name}」？此操作不可撤销。`)) {
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
    await createStudio({ name: '新项目' })
    onOpenStudio()
  }
  const openStudioCard = async (id: string) => {
    await openStudio(id)
    onOpenStudio()
  }
  const onDeleteStudio = async (id: string, name: string) => {
    if (window.confirm(`确定删除工作流项目「${name}」？此操作不可撤销。`)) await deleteStudio(id)
  }

  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">项目</h2>
        <div className="afs-surface__actions">
          <Select
            value=""
            onChange={(v) => onTemplate(v)}
            options={TEMPLATES.map((t) => ({ value: t.id, label: t.name, title: t.desc }))}
            placeholder="从模板新建…"
            title="从模板新建画布工程"
            ariaLabel="从模板新建画布工程"
          />
          <button className="afs-btn" onClick={() => fileRef.current?.click()} title="导入画布工程 JSON">
            <Upload size={15} /> 导入
          </button>
          <button className="afs-btn" onClick={onNewCanvas} title="新建空白画布工程">
            <Workflow size={15} /> 新建画布
          </button>
          <button className="afs-btn afs-btn--save" onClick={onNewStudio} title="新建工作流（AI 短剧工作台）项目">
            <Film size={15} /> 新建工作流
          </button>
        </div>
      </div>

      <div className="afs-home__scroll">
        {rows.length === 0 ? (
          <div className="afs-studio__empty">
            <Clapperboard size={40} opacity={0.3} />
            <p>还没有项目，点上方「新建画布 / 新建工作流」开始。</p>
          </div>
        ) : (
          <div className="afs-home__grid">
            {rows.map((r) =>
              r.kind === 'canvas' ? (
                <div key={`c:${r.id}`} className={`afs-pcard${r.id === currentId ? ' is-current' : ''}`}>
                  <div
                    className="afs-pcard__cover"
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
                    <span className="afs-pcard__kind afs-pcard__kind--canvas">画布</span>
                    {r.card.aspectRatio && <span className="afs-pcard__ratio">{r.card.aspectRatio}</span>}
                    <span className="afs-pcard__count">{r.card.nodeCount} 节点</span>
                  </div>
                  <div className="afs-pcard__body">
                    <div className="afs-pcard__name" title={r.card.name}>
                      {r.card.name}
                      {r.id === currentId && <span className="afs-tag">当前</span>}
                    </div>
                    <div className="afs-pcard__time">{relTime(r.updatedAt)}</div>
                    {r.card.style && (
                      <div className="afs-pcard__style" title={r.card.style}>
                        风格：{r.card.style}
                      </div>
                    )}
                  </div>
                  <div className="afs-pcard__actions">
                    <button className="afs-pcard__open" onClick={() => openCanvas(r.id)}>
                      打开
                    </button>
                    <span className="afs-pcard__spacer" />
                    <Menu
                      align="end"
                      trigger={
                        <button aria-label="更多操作" title="更多操作">
                          <MoreHorizontal size={14} />
                        </button>
                      }
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
                <div key={`s:${r.id}`} className="afs-pcard">
                  <div
                    className="afs-pcard__cover"
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
                    <span className="afs-pcard__kind afs-pcard__kind--studio">工作流</span>
                  </div>
                  <div className="afs-pcard__body">
                    <div className="afs-pcard__name" title={r.name}>
                      {r.name}
                    </div>
                    <div className="afs-pcard__time">{relTime(r.updatedAt)}</div>
                    <div className="afs-pcard__style" title={r.meta}>
                      {r.meta}
                    </div>
                  </div>
                  <div className="afs-pcard__actions">
                    <button className="afs-pcard__open" onClick={() => openStudioCard(r.id)}>
                      打开
                    </button>
                    <span className="afs-pcard__spacer" />
                    <Menu
                      align="end"
                      trigger={
                        <button aria-label="更多操作" title="更多操作">
                          <MoreHorizontal size={14} />
                        </button>
                      }
                      items={[{ label: '删除项目', icon: Trash2, danger: true, onSelect: () => onDeleteStudio(r.id, r.name) }]}
                    />
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
    </div>
  )
}
