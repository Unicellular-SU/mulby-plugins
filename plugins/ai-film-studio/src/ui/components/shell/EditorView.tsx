import { useState } from 'react'
import Toolbar from '../Toolbar'
import WorkbenchDock from '../dock/WorkbenchDock'
import FlowCanvas from '../FlowCanvas'
import Inspector from '../Inspector'
import SnapshotPanel from '../SnapshotPanel'
import ProjectStylePanel from '../ProjectStylePanel'
import { useGraphStore } from '../../store/graphStore'

/** 画布编辑器界面：编辑器顶栏 + 左侧 Dock(节点/素材/提示词) + 中央画布 + 右侧属性面板。 */
export default function EditorView() {
  const loaded = useGraphStore((s) => s.loaded)
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
        <aside className="afs-app__right">
          <Inspector />
        </aside>
      </div>
      {snapOpen && <SnapshotPanel onClose={() => setSnapOpen(false)} />}
      {styleOpen && <ProjectStylePanel onClose={() => setStyleOpen(false)} />}
    </div>
  )
}
