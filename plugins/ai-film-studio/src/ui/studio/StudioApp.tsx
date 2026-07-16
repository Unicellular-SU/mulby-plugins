/**
 * Toonflow 式重构 · 阶段2c：结构化工作台外壳。
 * 项目列表已统一到「项目」主页（ProjectHome）；这里只负责：有打开的工作流项目 → 分阶段编辑器；
 * 否则直接回「项目」主页（不再有独立空状态页）。数据来自 projectStore。
 */
import { useEffect } from 'react'
import { useProjectStore } from '../store/projectStore'
import { useAgentDeployStore } from '../store/agentDeployStore'
import StudioEditor from './StudioEditor'
import { registerToolCallingProbe } from './agent/toolCallingProbe'

export default function StudioApp({ onHome }: { onHome: () => void }) {
  const doc = useProjectStore((s) => s.doc)
  const loading = useProjectStore((s) => s.loading)
  const init = useProjectStore((s) => s.init)

  useEffect(() => {
    void init()
    void useAgentDeployStore.getState().load() // §6.3 载入按 Agent 部署配置
    registerToolCallingProbe() // 阶段0：暴露宿主 tool-calling 探针到控制台（dev 便利，无 UI）
  }, [init])

  // 无打开的工作流项目（且非加载中）→ 直接回项目列表，不再停留在独立空页
  useEffect(() => {
    if (!loading && !doc) onHome()
  }, [loading, doc, onHome])

  if (doc) return <div className="afs-studio">{<StudioEditor onHome={onHome} />}</div>
  if (loading) return <div className="afs-studio afs-studio--center">加载中…</div>
  return null
}
