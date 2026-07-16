import { useEffect, useState } from 'react'
import { X, Camera, RotateCcw, Trash2, Brush } from 'lucide-react'
import { useGraphStore, type ProjectSnapshot } from '../store/graphStore'
import { useConfirm } from './ui/ConfirmDialog'
import { usePrompt } from './ui/PromptDialog'

function relTime(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days} 天前`
  return new Date(ts).toLocaleString()
}

/** 工程命名快照：存为快照 + 列表（恢复 / 重命名 / 删除）。 */
export default function SnapshotPanel({ onClose }: { onClose: () => void }) {
  const createSnapshot = useGraphStore((s) => s.createSnapshot)
  const listSnapshots = useGraphStore((s) => s.listSnapshots)
  const restoreSnapshot = useGraphStore((s) => s.restoreSnapshot)
  const deleteSnapshot = useGraphStore((s) => s.deleteSnapshot)
  const renameSnapshot = useGraphStore((s) => s.renameSnapshot)
  const projectName = useGraphStore((s) => s.projectName)
  const nodeCount = useGraphStore((s) => s.nodes.length)

  const confirm = useConfirm()
  const prompt = usePrompt()

  const [list, setList] = useState<ProjectSnapshot[]>([])
  const [name, setName] = useState('')

  const refresh = async () => setList(await listSnapshots())
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCreate = async () => {
    await createSnapshot(name)
    setName('')
    void refresh()
  }
  const onRestore = async (s: ProjectSnapshot) => {
    if (await confirm({ title: '恢复快照', message: `恢复到快照「${s.name}」？当前画布会被覆盖（建议先存为快照）。`, confirmLabel: '恢复' })) {
      await restoreSnapshot(s.id)
      window.mulby?.notification?.show(`已恢复到快照：${s.name}`, 'success')
      onClose()
    }
  }
  const onRename = async (s: ProjectSnapshot) => {
    const n = await prompt({ title: '重命名快照', defaultValue: s.name })
    if (n && n.trim()) {
      await renameSnapshot(s.id, n.trim())
      void refresh()
    }
  }
  const onDelete = async (s: ProjectSnapshot) => {
    if (await confirm({ title: '删除快照', message: `删除快照「${s.name}」？`, danger: true, confirmLabel: '删除' })) {
      await deleteSnapshot(s.id)
      void refresh()
    }
  }

  return (
    <div className="afs-lightbox" onClick={onClose}>
      <div className="afs-elform" onClick={(e) => e.stopPropagation()}>
        <div className="afs-elform__head">
          <span>工程快照 · {projectName}</span>
          <button className="afs-lightbox__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="afs-snapnew">
          <input
            className="afs-field__input"
            placeholder={`快照名称（默认当前时间）· 现 ${nodeCount} 节点`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          />
          <button className="afs-btn afs-btn--save" onClick={onCreate}>
            <Camera size={14} /> 存为快照
          </button>
        </div>
        <div className="afs-snaplist">
          {list.length === 0 ? (
            <div className="afs-dockpanel__empty">暂无快照。随时「存为快照」，之后可一键回滚。</div>
          ) : (
            list.map((s) => (
              <div key={s.id} className="afs-snapitem">
                <div className="afs-snapitem__main">
                  <div className="afs-snapitem__name">{s.name}</div>
                  <div className="afs-snapitem__meta">
                    {relTime(s.createdAt)} · {s.nodeCount} 节点
                  </div>
                </div>
                <button onClick={() => onRestore(s)} title="恢复到此快照">
                  <RotateCcw size={13} /> 恢复
                </button>
                <button onClick={() => onRename(s)} title="重命名">
                  <Brush size={13} />
                </button>
                <button className="afs-snapitem__del" onClick={() => onDelete(s)} title="删除">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
