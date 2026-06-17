import { useEffect, useRef, useState } from 'react'
import { Plus, Copy, Download, Upload, Trash2, Pencil, Clapperboard } from 'lucide-react'
import { useGraphStore, type ProjectCard, type ProjectData } from '../../store/graphStore'
import { TEMPLATES } from '../../templates'
import { loadAsset, toDataUrl } from '../../services/assets'

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

/** 工程主页：工程封面卡片网格 + 新建 / 从模板新建 / 导入；卡片支持打开 / 重命名 / 复制 / 导出 / 删除。 */
export default function ProjectHome({ onOpen }: { onOpen: () => void }) {
  const currentId = useGraphStore((s) => s.currentId)
  const projects = useGraphStore((s) => s.projects) // 列表变化时触发刷新
  const loadProjectCards = useGraphStore((s) => s.loadProjectCards)
  const switchProject = useGraphStore((s) => s.switchProject)
  const newProject = useGraphStore((s) => s.newProject)
  const duplicateProject = useGraphStore((s) => s.duplicateProject)
  const deleteProject = useGraphStore((s) => s.deleteProject)
  const renameProjectById = useGraphStore((s) => s.renameProjectById)
  const exportProjectById = useGraphStore((s) => s.exportProjectById)
  const importProject = useGraphStore((s) => s.importProject)
  const loadTemplate = useGraphStore((s) => s.loadTemplate)

  const fileRef = useRef<HTMLInputElement>(null)
  const [cards, setCards] = useState<ProjectCard[]>([])
  const [covers, setCovers] = useState<Record<string, string>>({})

  const refresh = async () => setCards(await loadProjectCards())
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects.length, currentId])

  // 懒加载封面缩略图
  useEffect(() => {
    let alive = true
    void (async () => {
      const next: Record<string, string> = {}
      for (const c of cards) {
        if (c.coverAssetId && !covers[c.coverAssetId]) {
          const a = await loadAsset(c.coverAssetId)
          if (a) next[c.coverAssetId] = toDataUrl(a.base64, a.mime)
        }
      }
      if (alive && Object.keys(next).length) setCovers((p) => ({ ...p, ...next }))
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards])

  const open = async (id: string) => {
    await switchProject(id)
    onOpen()
  }
  const onNew = async () => {
    await newProject()
    onOpen()
  }
  const onTemplate = async (tid: string) => {
    if (!tid) return
    await loadTemplate(tid)
    onOpen()
  }
  const onRename = async (c: ProjectCard) => {
    const name = window.prompt('重命名工程', c.name)
    if (name && name.trim()) {
      await renameProjectById(c.id, name.trim())
      void refresh()
    }
  }
  const onDup = async (c: ProjectCard) => {
    await duplicateProject(c.id)
    void refresh()
  }
  const onDelete = async (c: ProjectCard) => {
    if (window.confirm(`确定删除工程「${c.name}」？此操作不可撤销。`)) {
      await deleteProject(c.id)
      void refresh()
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
      // 从主页导入：先建新工程再灌入，避免覆盖当前工程（importProject 语义为覆盖当前）
      await newProject()
      await importProject(data)
      void refresh()
      onOpen()
    } catch {
      window.mulby?.notification?.show('导入失败：文件格式不正确', 'error')
    }
  }

  return (
    <div className="afs-surface">
      <div className="afs-surface__head">
        <h2 className="afs-surface__title">工程</h2>
        <div className="afs-surface__actions">
          <select className="afs-toolbar__select" value="" onChange={(e) => onTemplate(e.target.value)} title="从模板新建工程">
            <option value="">从模板新建…</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id} title={t.desc}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="afs-btn" onClick={() => fileRef.current?.click()} title="导入工程 JSON">
            <Upload size={15} /> 导入
          </button>
          <button className="afs-btn afs-btn--save" onClick={onNew} title="新建空白工程">
            <Plus size={15} /> 新建工程
          </button>
        </div>
      </div>

      <div className="afs-home__scroll">
        <div className="afs-home__grid">
          {cards.map((c) => {
            const cover = c.coverAssetId ? covers[c.coverAssetId] : undefined
            const isCur = c.id === currentId
            return (
              <div key={c.id} className={`afs-pcard${isCur ? ' is-current' : ''}`}>
                <div className="afs-pcard__cover" onClick={() => open(c.id)} title="打开工程">
                  {cover ? (
                    <img src={cover} alt="" />
                  ) : (
                    <div className="afs-pcard__ph">
                      <Clapperboard size={26} />
                    </div>
                  )}
                  <span className="afs-pcard__count">{c.nodeCount} 节点</span>
                </div>
                <div className="afs-pcard__body">
                  <div className="afs-pcard__name" title={c.name}>
                    {c.name}
                    {isCur && <span className="afs-tag">当前</span>}
                  </div>
                  <div className="afs-pcard__time">{relTime(c.updatedAt)}</div>
                </div>
                <div className="afs-pcard__actions">
                  <button className="afs-pcard__open" onClick={() => open(c.id)}>
                    打开
                  </button>
                  <span className="afs-pcard__spacer" />
                  <button onClick={() => onRename(c)} title="重命名">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => onDup(c)} title="复制工程">
                    <Copy size={13} />
                  </button>
                  <button onClick={() => onExport(c)} title="导出 JSON">
                    <Download size={13} />
                  </button>
                  <button className="afs-pcard__del" onClick={() => onDelete(c)} title="删除工程">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
    </div>
  )
}
