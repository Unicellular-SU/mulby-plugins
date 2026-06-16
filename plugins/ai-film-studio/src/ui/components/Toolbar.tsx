import { useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Clapperboard, Plus, Save, Download, Upload, Maximize2, Play, Square, Trash2, Settings } from 'lucide-react'
import { useGraphStore, type ProjectData } from '../store/graphStore'
import { TEMPLATES } from '../templates'

interface ToolbarProps {
  onOpenProviders?: () => void
}

export default function Toolbar({ onOpenProviders }: ToolbarProps) {
  const { fitView } = useReactFlow()
  const fileRef = useRef<HTMLInputElement>(null)

  const projects = useGraphStore((s) => s.projects)
  const currentId = useGraphStore((s) => s.currentId)
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
  const newProject = useGraphStore((s) => s.newProject)
  const saveProject = useGraphStore((s) => s.saveProject)
  const switchProject = useGraphStore((s) => s.switchProject)
  const deleteProject = useGraphStore((s) => s.deleteProject)
  const exportProject = useGraphStore((s) => s.exportProject)
  const importProject = useGraphStore((s) => s.importProject)
  const setSelectedModel = useGraphStore((s) => s.setSelectedModel)
  const setSelectedImageModel = useGraphStore((s) => s.setSelectedImageModel)
  const runAll = useGraphStore((s) => s.runAll)
  const cancelRun = useGraphStore((s) => s.cancelRun)
  const loadTemplate = useGraphStore((s) => s.loadTemplate)

  const onExport = () => {
    const data = exportProject()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${projectName || 'ai-film-project'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImportClick = () => fileRef.current?.click()

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text) as Partial<ProjectData>
      importProject(data)
    } catch {
      window.mulby?.notification?.show('导入失败：文件格式不正确', 'error')
    }
    e.target.value = ''
  }

  const onDeleteProject = async () => {
    if (!currentId) return
    const ok = window.confirm(`确定删除工程「${projectName}」？此操作不可撤销。`)
    if (ok) await deleteProject(currentId)
  }

  return (
    <div className="afs-toolbar">
      <div className="afs-toolbar__group">
        <span className="afs-toolbar__logo">
          <Clapperboard size={18} />
        </span>
        <span className="afs-toolbar__brand">AI 影视工坊</span>
      </div>

      <div className="afs-toolbar__group">
        <select
          className="afs-toolbar__select"
          value={currentId || ''}
          onChange={(e) => switchProject(e.target.value)}
          title="切换工程"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          className="afs-toolbar__name"
          value={projectName}
          onChange={(e) => renameProject(e.target.value)}
          placeholder="工程名称"
          title="重命名当前工程"
        />
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
        <span className="afs-toolbar__meta">
          {nodeCount} 节点 · {saving ? '保存中…' : dirty ? '未保存' : '已保存'}
        </span>
      </div>

      <div className="afs-toolbar__group">
        <button className="afs-btn" onClick={() => fitView({ duration: 300, padding: 0.2 })} title="适应画布">
          <Maximize2 size={15} />
        </button>
        <select
          className="afs-toolbar__select"
          value=""
          onChange={(e) => {
            const id = e.target.value
            e.target.value = ''
            if (id) void loadTemplate(id)
          }}
          title="从模板新建工程"
        >
          <option value="">＋ 模板…</option>
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id} title={t.desc}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="afs-btn" onClick={newProject} title="新建空白工程">
          <Plus size={15} />
        </button>
        <button className="afs-btn afs-btn--save toolbar__btn--save" onClick={() => saveProject()} title="保存 (Cmd/Ctrl+S)">
          <Save size={15} />
          <span>保存</span>
        </button>
        <button className="afs-btn" onClick={onImportClick} title="导入工程 JSON">
          <Upload size={15} />
        </button>
        <button className="afs-btn" onClick={onExport} title="导出工程 JSON">
          <Download size={15} />
        </button>
        <button className="afs-btn afs-btn--danger" onClick={onDeleteProject} title="删除当前工程">
          <Trash2 size={15} />
        </button>
        <button className="afs-btn" onClick={onOpenProviders} title="视频供应商设置">
          <Settings size={15} />
        </button>
        {isRunning ? (
          <button className="afs-btn afs-btn--stop" onClick={cancelRun} title="停止运行">
            <Square size={14} />
            <span>停止</span>
          </button>
        ) : (
          <button className="afs-btn afs-btn--save" onClick={() => runAll()} title="运行工作流（拓扑顺序执行文本链路）">
            <Play size={15} />
            <span>运行</span>
          </button>
        )}
      </div>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImportFile} />
    </div>
  )
}
