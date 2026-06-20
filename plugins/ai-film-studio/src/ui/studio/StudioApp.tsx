/**
 * Toonflow 式重构 · 阶段2c：结构化工作台外壳。
 * 无打开项目 → 项目主页；有 → 分阶段编辑器。数据来自 projectStore。
 */
import { useEffect } from 'react'
import { useProjectStore } from '../store/projectStore'
import StudioHome from './StudioHome'
import StudioEditor from './StudioEditor'

export default function StudioApp() {
  const doc = useProjectStore((s) => s.doc)
  const loading = useProjectStore((s) => s.loading)
  const init = useProjectStore((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (loading && !doc) return <div className="afs-studio afs-studio--center">加载中…</div>
  return <div className="afs-studio">{doc ? <StudioEditor /> : <StudioHome />}</div>
}
