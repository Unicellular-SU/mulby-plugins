import { useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Save, Maximize2, Play, Square, Camera } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'

interface ToolbarProps {
  onOpenSnapshots?: () => void
}

/**
 * 画布编辑器顶栏：聚焦「正在编辑的工程」——工程名(双击改名) + 状态 + 生成模型 + 画布/保存/快照/运行。
 * 工程的新建/切换/导入导出/删除统一走「工程主页」；画风/提示词/供应商走左侧 rail。
 */
export default function Toolbar({ onOpenSnapshots }: ToolbarProps) {
  const { fitView } = useReactFlow()

  const projectName = useGraphStore((s) => s.projectName)
  const dirty = useGraphStore((s) => s.dirty)
  const saving = useGraphStore((s) => s.saving)
  const nodeCount = useGraphStore((s) => s.nodes.length)
  const models = useGraphStore((s) => s.models)
  const imageModels = useGraphStore((s) => s.imageModels)
  const selectedModel = useGraphStore((s) => s.selectedModel)
  const selectedImageModel = useGraphStore((s) => s.selectedImageModel)
  const isRunning = useGraphStore((s) => s.isRunning)

  const renameProject = useGraphStore((s) => s.renameProject)
  const saveProject = useGraphStore((s) => s.saveProject)
  const setSelectedModel = useGraphStore((s) => s.setSelectedModel)
  const setSelectedImageModel = useGraphStore((s) => s.setSelectedImageModel)
  const runAll = useGraphStore((s) => s.runAll)
  const cancelRun = useGraphStore((s) => s.cancelRun)

  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const startEdit = () => {
    setDraftName(projectName)
    setEditingName(true)
  }
  const commitEdit = () => {
    const n = draftName.trim()
    if (n) renameProject(n)
    setEditingName(false)
  }

  return (
    <div className="afs-toolbar">
      <div className="afs-toolbar__group">
        {editingName ? (
          <input
            className="afs-toolbar__name"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              else if (e.key === 'Escape') setEditingName(false)
            }}
          />
        ) : (
          <span className="afs-toolbar__nametag" title="双击重命名工程" onDoubleClick={startEdit}>
            {projectName || '未命名工程'}
          </span>
        )}
        <span className="afs-toolbar__meta">
          {nodeCount} 节点 · {saving ? '保存中…' : dirty ? '未保存' : '已保存'}
        </span>
      </div>

      <div className="afs-toolbar__spacer" />

      <div className="afs-toolbar__group">
        <select
          className="afs-toolbar__select afs-toolbar__model"
          value={selectedModel || ''}
          onChange={(e) => setSelectedModel(e.target.value || null)}
          title="文本模型（复用 Mulby 已配置模型）"
        >
          {models.length === 0 && <option value="">默认文本模型</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              文本：{m.label || m.id}
            </option>
          ))}
        </select>
        <select
          className="afs-toolbar__select afs-toolbar__model"
          value={selectedImageModel || ''}
          onChange={(e) => setSelectedImageModel(e.target.value || null)}
          title="图像模型（endpointType=image-generation）"
        >
          {imageModels.length === 0 && <option value="">无图像模型</option>}
          {imageModels.map((m) => (
            <option key={m.id} value={m.id}>
              图像：{m.label || m.id}
            </option>
          ))}
        </select>
        <button className="afs-btn" onClick={() => fitView({ duration: 300, padding: 0.2 })} title="适应画布">
          <Maximize2 size={15} />
        </button>
        <button className="afs-btn afs-btn--save" onClick={() => saveProject()} title="保存 (Cmd/Ctrl+S)">
          <Save size={15} />
          <span>保存</span>
        </button>
        <button className="afs-btn" onClick={onOpenSnapshots} title="工程快照（命名版本，可回滚）">
          <Camera size={15} />
        </button>
        {isRunning ? (
          <button className="afs-btn afs-btn--stop" onClick={cancelRun} title="停止运行">
            <Square size={14} />
            <span>停止</span>
          </button>
        ) : (
          <button className="afs-btn afs-btn--save" onClick={() => runAll()} title="运行工作流（拓扑顺序执行）">
            <Play size={15} />
            <span>运行</span>
          </button>
        )}
      </div>
    </div>
  )
}
