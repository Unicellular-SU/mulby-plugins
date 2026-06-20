/**
 * 工作台 · 项目主页：项目卡片列表 + 新建。
 */
import { Plus, Film, Trash2 } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { listStylePacks } from '../services/stylePacks'

export default function StudioHome() {
  const cards = useProjectStore((s) => s.cards)
  const createProject = useProjectStore((s) => s.createProject)
  const openProject = useProjectStore((s) => s.openProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const styles = listStylePacks()
  const styleLabel = (id: string) => styles.find((p) => p.id === id)?.label ?? id

  return (
    <div className="afs-studio__home">
      <header className="afs-studio__home-head">
        <h2>AI 短剧工作台</h2>
        <button className="afs-btn afs-btn--primary" onClick={() => void createProject({ name: '新项目' })}>
          <Plus size={16} /> 新建项目
        </button>
      </header>
      <p className="afs-studio__hint">从一句话/小说到成片：剧本 → 资产 → 分镜 → 视频 → 时间线，由 AI Agent 编排（建设中）。</p>

      {cards.length === 0 ? (
        <div className="afs-studio__empty">
          <Film size={40} opacity={0.3} />
          <p>还没有项目，点「新建项目」开始。</p>
        </div>
      ) : (
        <div className="afs-studio__grid">
          {cards.map((c) => (
            <div key={c.id} className="afs-studio__card" onClick={() => void openProject(c.id)}>
              <div className="afs-studio__card-cover">
                <Film size={28} opacity={0.4} />
              </div>
              <div className="afs-studio__card-body">
                <div className="afs-studio__card-name">{c.name}</div>
                <div className="afs-studio__card-meta">
                  {styleLabel(c.artStyle)} · {c.videoRatio} · {c.storyboardCount} 分镜
                </div>
              </div>
              <button
                className="afs-studio__card-del"
                title="删除项目"
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm(`删除项目「${c.name}」？此操作不可撤销。`)) void deleteProject(c.id)
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
