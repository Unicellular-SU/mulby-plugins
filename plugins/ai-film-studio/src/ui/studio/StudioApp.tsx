/**
 * Toonflow 式重构 · 阶段2c：结构化工作台外壳。
 * 项目列表已统一到「项目」主页（ProjectHome）；这里只负责：有打开的工作流项目 → 分阶段编辑器；
 * 否则给一个去「项目」页的空状态。数据来自 projectStore。
 */
import { useEffect } from 'react'
import { Film, ArrowLeft, Plus } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import StudioEditor from './StudioEditor'

export default function StudioApp({ onHome }: { onHome: () => void }) {
  const doc = useProjectStore((s) => s.doc)
  const loading = useProjectStore((s) => s.loading)
  const init = useProjectStore((s) => s.init)
  const createProject = useProjectStore((s) => s.createProject)

  useEffect(() => {
    void init()
  }, [init])

  if (loading && !doc) return <div className="afs-studio afs-studio--center">加载中…</div>
  if (doc) return <div className="afs-studio">{<StudioEditor />}</div>
  return (
    <div className="afs-studio afs-studio--center">
      <div className="afs-studio__empty">
        <Film size={40} opacity={0.3} />
        <p>没有打开的工作流项目。</p>
        <div className="afs-studio__emptyactions">
          <button className="afs-btn" onClick={onHome}>
            <ArrowLeft size={15} /> 去项目列表
          </button>
          <button className="afs-btn afs-btn--primary" onClick={() => void createProject({ name: '新项目' })}>
            <Plus size={15} /> 新建工作流项目
          </button>
        </div>
      </div>
    </div>
  )
}
