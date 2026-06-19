import { useState } from 'react'
import Toolbar from '../Toolbar'
import WorkbenchDock from '../dock/WorkbenchDock'
import FlowCanvas from '../FlowCanvas'
import Inspector from '../Inspector'
import SnapshotPanel from '../SnapshotPanel'
import ProjectStylePanel from '../ProjectStylePanel'
import { useGraphStore } from '../../store/graphStore'

/** 画布编辑器界面：编辑器顶栏 + 左侧 Dock(节点/素材/提示词) + 中央画布 + 右侧属性面板(选中节点时悬浮)。 */
export default function EditorView() {
  const loaded = useGraphStore((s) => s.loaded)
  // 仅在选中真实节点时显示右侧属性抽屉（未选中→隐藏，画布占满）；抽屉绝对定位悬浮于画布之上，不挤压画布
  const hasSelection = useGraphStore((s) => !!s.selectedNodeId && s.nodes.some((n) => n.id === s.selectedNodeId))
  const [snapOpen, setSnapOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  return (
    <div className="afs-editor">
      <Toolbar onOpenSnapshots={() => setSnapOpen(true)} onOpenStyle={() => setStyleOpen(true)} />
      <div className="afs-app__body">
        <aside className="afs-app__left">
          <WorkbenchDock />
        </aside>
        <main className="afs-app__center">
          {loaded ? <FlowCanvas /> : <div className="afs-loading">加载工程中…</div>}
        </main>
        {hasSelection && (
          <aside className="afs-app__right afs-app__right--float">
            <Inspector />
          </aside>
        )}
      </div>
      {snapOpen && <SnapshotPanel onClose={() => setSnapOpen(false)} />}
      {styleOpen && <ProjectStylePanel onClose={() => setStyleOpen(false)} />}
    </div>
  )
}
