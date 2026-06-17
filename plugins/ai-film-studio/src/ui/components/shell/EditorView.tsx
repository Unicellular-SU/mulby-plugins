import { useState } from 'react'
import Toolbar from '../Toolbar'
import WorkbenchDock from '../dock/WorkbenchDock'
import FlowCanvas from '../FlowCanvas'
import Inspector from '../Inspector'
import SnapshotPanel from '../SnapshotPanel'
import { useGraphStore } from '../../store/graphStore'

export type EditorNav = 'providers' | 'style' | 'prompts'

/** 画布编辑器界面：编辑器顶栏 + 左侧 Dock(节点/素材/提示词) + 中央画布 + 右侧属性面板。 */
export default function EditorView({ onNavigate }: { onNavigate: (t: EditorNav) => void }) {
  const loaded = useGraphStore((s) => s.loaded)
  const [snapOpen, setSnapOpen] = useState(false)
  return (
    <div className="afs-editor">
      <Toolbar
        onOpenProviders={() => onNavigate('providers')}
        onOpenGlobals={() => onNavigate('style')}
        onOpenPrompts={() => onNavigate('prompts')}
        onOpenSnapshots={() => setSnapOpen(true)}
      />
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
    </div>
  )
}
