import { useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Save, Maximize2, Play, Square, Camera, Palette, Type, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import Select from './ui/Select'
import Tooltip from './ui/Tooltip'

interface ToolbarProps {
  onOpenSnapshots?: () => void
  onOpenStyle?: () => void
}

/**
 * 画布编辑器顶栏：聚焦「正在编辑的工程」——工程名(双击改名) + 状态 + 生成模型 + 画布/保存/快照/运行。
 * 工程的新建/切换/导入导出/删除统一走「工程主页」；画风/提示词/供应商走左侧 rail。
 */
export default function Toolbar({ onOpenSnapshots, onOpenStyle }: ToolbarProps) {
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
          <span
            className={`afs-toolbar__statusdot afs-toolbar__statusdot--${saving ? 'saving' : dirty ? 'dirty' : 'saved'}`}
          />
          {nodeCount} 节点 ·{' '}
          {saving ? (
            <>
              <Loader2 size={11} className="afs-spin" /> 保存中…
            </>
          ) : dirty ? (
            '未保存'
          ) : (
            '已保存'
          )}
        </span>
      </div>

      <div className="afs-toolbar__spacer" />

      <div className="afs-toolbar__group">
        <Select
          className="afs-toolbar__model"
          leadingIcon={Type}
          value={selectedModel || ''}
          onChange={(v) => setSelectedModel(v || null)}
          options={models.map((m) => ({ value: m.id, label: `文本：${m.label || m.id}` }))}
          placeholder="默认文本模型"
          title="文本模型（复用 Mulby 已配置模型）"
          ariaLabel="文本模型"
        />
        <Select
          className="afs-toolbar__model"
          leadingIcon={ImageIcon}
          value={selectedImageModel || ''}
          onChange={(v) => setSelectedImageModel(v || null)}
          options={imageModels.map((m) => ({ value: m.id, label: `图像：${m.label || m.id}` }))}
          placeholder="无图像模型"
          title="图像模型（endpointType=image-generation）"
          ariaLabel="图像模型"
        />
        <Tooltip content="适应画布">
          <button className="afs-iconbtn" onClick={() => fitView({ duration: 300, padding: 0.2 })} aria-label="适应画布">
            <Maximize2 size={16} />
          </button>
        </Tooltip>
        <button className="afs-btn afs-btn--save" onClick={() => saveProject()} title="保存 (Cmd/Ctrl+S)">
          <Save size={15} />
          <span>保存</span>
        </button>
        <Tooltip content="项目风格（画风 / 画幅，注入本工程所有生成）">
          <button className="afs-iconbtn" onClick={onOpenStyle} aria-label="项目风格">
            <Palette size={16} />
          </button>
        </Tooltip>
        <Tooltip content="工程快照（命名版本，可回滚）">
          <button className="afs-iconbtn" onClick={onOpenSnapshots} aria-label="工程快照">
            <Camera size={16} />
          </button>
        </Tooltip>
        {isRunning ? (
          <button className="afs-btn afs-btn--stop" onClick={cancelRun} title="停止运行">
            <Square size={14} />
            <span>停止</span>
          </button>
        ) : (
          <button className="afs-btn afs-btn--gradient" onClick={() => runAll()} title="运行工作流（拓扑顺序执行）">
            <Play size={15} />
            <span>运行</span>
          </button>
        )}
      </div>
    </div>
  )
}
