import { useCallback, useState, useEffect } from 'react'
import {
  Save, Download, FileImage, FileJson, ClipboardCopy,
  Undo2, Redo2, PanelRightClose, PanelRight,
  ChevronDown, Cpu, Upload, Group,
  GitBranch, Database, Workflow,
} from 'lucide-react'
import { useFlowStore, type DiagramType } from '../store/flowStore'
import { useMulby } from '../hooks/useMulby'
import { useAutoLayout } from '../hooks/useAutoLayout'
import { getNodesBounds, getViewportForBounds } from '@xyflow/react'
import { toBlob, toSvg } from 'html-to-image'

const PLUGIN_ID = 'ai-flowchart'

// AI 模型信息
interface ModelInfo {
  id: string
  label: string
  providerLabel?: string
}

export default function Toolbar() {
  const {
    nodes,
    edges,
    metadata,
    messages,
    projectId,
    projectName,
    setProjectInfo,
    undo,
    redo,
    historyIndex,
    history,
    isChatCollapsed,
    toggleChat,
    selectedModel,
    setSelectedModel,
    diagramType,
    setDiagramType,
    importFlowData,
    bumpProjectListVersion,
    isDirty,
    markClean,
    resetSession,
  } = useFlowStore()

  const mulby = useMulby(PLUGIN_ID)
  const { host, notification, clipboard, dialog } = mulby
  const { performLayout } = useAutoLayout()
  const [isSaving, setIsSaving] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showDiagramMenu, setShowDiagramMenu] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])

  // 加载可用模型列表
  useEffect(() => {
    const loadModels = async () => {
      try {
        const allModels = await mulby.ai.allModels()
        setModels(allModels.map((m: any) => ({
          id: m.id,
          label: m.label || m.id,
          providerLabel: m.providerLabel,
        })))
      } catch (err) {
        console.error('[ai-flowchart] 加载模型列表失败:', err)
      }
    }
    loadModels()
  }, [mulby.ai])

  // 保存项目（用第一条用户消息做项目名）
  const handleSave = useCallback(async () => {
    if (nodes.length === 0) return
    setIsSaving(true)
    try {
      const id = projectId || `proj_${Date.now()}`
      // 项目名优先级：metadata.title > 第一条用户消息 > projectName
      const firstUserMsg = messages.find(m => m.role === 'user')?.content
      const name = metadata.title || firstUserMsg?.slice(0, 30) || projectName
      console.log('[ai-flowchart][ui] saving project, id:', id, 'name:', name)
      await (host as any).call('saveProject', {
        project: {
          id,
          name,
          data: { nodes, edges, metadata, diagramType },
          updatedAt: Date.now(),
        },
      })
      console.log('[ai-flowchart][ui] saveProject host.call succeeded')
      setProjectInfo(id, name)
      bumpProjectListVersion()
      markClean()
    } catch (err: any) {
      notification.show(`保存失败: ${err?.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [nodes, edges, metadata, diagramType, messages, projectId, projectName, host, notification, setProjectInfo, bumpProjectListVersion, markClean])

  // ====== 导出工具函数 ======

  /** 获取导出背景色 */
  const getExportBgColor = () =>
    document.documentElement.classList.contains('light') ? '#ffffff' : '#111827'

  /** 过滤掉不需要导出的元素 */
  const exportFilter = (node: Element) => {
    if (node.classList?.contains('react-flow__minimap')) return false
    if (node.classList?.contains('react-flow__controls')) return false
    if (node.classList?.contains('helper-lines')) return false
    if (node.classList?.contains('flow-canvas__stats')) return false
    return true
  }

  // 导出 PNG
  const handleExportPng = useCallback(async () => {
    setShowExportMenu(false)
    try {
      const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement
      if (!viewportEl || nodes.length === 0) return

      // 用 React Flow 官方 API 计算全部节点的边界和适配变换
      const bounds = getNodesBounds(nodes)
      const padding = 20
      const imgWidth = bounds.width + padding * 2
      const imgHeight = bounds.height + padding * 2
      const vp = getViewportForBounds(bounds, imgWidth, imgHeight, 0.8, 2, padding)

      const blob = await toBlob(viewportEl, {
        backgroundColor: getExportBgColor(),
        filter: exportFilter,
        pixelRatio: 2,
        width: imgWidth,
        height: imgHeight,
        style: {
          width: `${imgWidth}px`,
          height: `${imgHeight}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      })
      if (!blob) return

      const filePath = await dialog.showSaveDialog({
        title: '导出流程图',
        defaultPath: `${metadata.title || '流程图'}.png`,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      })

      if (filePath) {
        const buffer = await blob.arrayBuffer()
        const base64 = btoa(
          new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), '')
        )
        await (host as any).call('exportToFile', {
          filePath,
          data: base64,
          encoding: 'base64',
        })
        notification.show('已导出 PNG')
      }
    } catch (err: any) {
      notification.show(`导出失败: ${err?.message}`, 'error')
    }
  }, [dialog, host, metadata.title, notification, nodes])

  // 导出 SVG
  const handleExportSvg = useCallback(async () => {
    setShowExportMenu(false)
    try {
      const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement
      if (!viewportEl || nodes.length === 0) return

      const bounds = getNodesBounds(nodes)
      const padding = 20
      const imgWidth = bounds.width + padding * 2
      const imgHeight = bounds.height + padding * 2
      const vp = getViewportForBounds(bounds, imgWidth, imgHeight, 0.8, 2, padding)

      const svgDataUrl = await toSvg(viewportEl, {
        backgroundColor: getExportBgColor(),
        filter: exportFilter,
        width: imgWidth,
        height: imgHeight,
        style: {
          width: `${imgWidth}px`,
          height: `${imgHeight}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      })

      const svgContent = decodeURIComponent(svgDataUrl.split(',')[1] || '')

      const filePath = await dialog.showSaveDialog({
        title: '导出 SVG',
        defaultPath: `${metadata.title || '流程图'}.svg`,
        filters: [{ name: 'SVG 矢量图', extensions: ['svg'] }],
      })

      if (filePath) {
        await (host as any).call('exportToFile', { filePath, data: svgContent })
        notification.show('已导出 SVG')
      }
    } catch (err: any) {
      notification.show(`导出失败: ${err?.message}`, 'error')
    }
  }, [dialog, host, metadata.title, notification, nodes])

  // 导出 JSON
  const handleExportJson = useCallback(async () => {
    setShowExportMenu(false)
    try {
      const data = JSON.stringify({ nodes, edges, metadata, diagramType }, null, 2)
      const filePath = await dialog.showSaveDialog({
        title: '导出图表数据',
        defaultPath: `${metadata.title || '图表'}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      })
      if (filePath) {
        await (host as any).call('exportToFile', { filePath, data })
        notification.show('已导出 JSON')
      }
    } catch (err: any) {
      notification.show(`导出失败: ${err?.message}`, 'error')
    }
  }, [nodes, edges, metadata, diagramType, dialog, host, notification])

  const handleCopyToClipboard = useCallback(async () => {
    setShowExportMenu(false)
    try {
      const el = document.querySelector('.react-flow') as HTMLElement
      if (!el) return

      const blob = await toBlob(el, {
        backgroundColor: getExportBgColor(),
        filter: exportFilter,
        pixelRatio: 2,
      })
      if (!blob) return

      const buffer = await blob.arrayBuffer()
      await clipboard.writeImage(buffer)
      notification.show('已复制到剪贴板')
    } catch (err: any) {
      notification.show(`复制失败: ${err?.message}`, 'error')
    }
  }, [clipboard, notification])


  const handleImportJson = useCallback(() => {
    // 使用隐藏的 file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!data.nodes || !Array.isArray(data.nodes)) {
          notification.show('JSON 格式无效：缺少 nodes 数组', 'error')
          return
        }
        // 导入时先设置 diagramType，再布局（确保使用正确的布局算法）
        const importedType = data.diagramType || 'flowchart'
        useFlowStore.getState().setDiagramType(importedType)
        // 使用两阶段精确布局
        await performLayout(data.nodes, data.edges || [], data.metadata, 'TB', false)
        notification.show(`已导入图表：${data.metadata?.title || file.name}`)
      } catch (err: any) {
        notification.show(`导入失败: ${err?.message || '文件解析错误'}`, 'error')
      }
    }
    input.click()
  }, [importFlowData, notification])

  // 获取当前模型显示名
  const currentModelLabel = selectedModel
    ? (models.find(m => m.id === selectedModel)?.label || selectedModel)
    : '默认模型'

  // 创建分组节点
  const handleCreateGroup = useCallback(() => {
    const { nodes: currentNodes, setNodes, pushHistory } = useFlowStore.getState()
    pushHistory()
    const groupId = `group_${Date.now()}`
    const newGroup = {
      id: groupId,
      type: 'group',
      position: { x: 100, y: 100 },
      data: { label: '新建分组' },
      style: { width: 300, height: 200 },
    }
    setNodes([...currentNodes, newGroup])
    notification.show('已添加分组节点，可拖拽调整大小')
  }, [notification])

  // 图表类型配置
  const diagramTypes: { type: DiagramType; label: string; icon: typeof GitBranch }[] = [
    { type: 'flowchart', label: '流程图', icon: GitBranch },
    { type: 'swimlane', label: '泳道图', icon: Workflow },
    { type: 'er', label: 'ER 图', icon: Database },
  ]

  const currentDiagramInfo = diagramTypes.find(d => d.type === diagramType) || diagramTypes[0]
  const CurrentDiagramIcon = currentDiagramInfo.icon

  // 切换图表类型
  const handleDiagramTypeChange = useCallback((type: DiagramType) => {
    setShowDiagramMenu(false)
    if (type === diagramType) return
    // 切换类型时重置会话，但保留新类型
    setDiagramType(type)
    resetSession(true)
  }, [diagramType, setDiagramType, resetSession])

  return (
    <div className="toolbar">
      <div className="toolbar__left">
        {/* 图表类型选择器 */}
        <div className="toolbar__diagram-type-wrapper">
          <button
            className="toolbar__btn toolbar__btn--diagram-type"
            onClick={() => setShowDiagramMenu(!showDiagramMenu)}
            title="切换图表类型"
          >
            <CurrentDiagramIcon size={14} />
            <span>{currentDiagramInfo.label}</span>
            <ChevronDown size={12} />
          </button>
          {showDiagramMenu && (
            <div className="toolbar__diagram-type-menu">
              {diagramTypes.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  className={`toolbar__diagram-type-item ${diagramType === type ? 'active' : ''}`}
                  onClick={() => handleDiagramTypeChange(type)}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar__divider" />

        {diagramType === 'flowchart' && (
          <>
            <button className="toolbar__btn" onClick={handleCreateGroup} title="添加分组">
              <Group size={16} />
            </button>
            <div className="toolbar__divider" />
          </>
        )}
        <button
          className="toolbar__btn"
          onClick={undo}
          disabled={historyIndex <= 0}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className="toolbar__btn"
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
          title="重做 (Ctrl+Y)"
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="toolbar__center">
        <span className="toolbar__title">{metadata.title || projectName}</span>
        {isDirty && <span className="toolbar__dirty" title="未保存的更改">●</span>}
      </div>

      <div className="toolbar__right">
        {/* 模型选择 */}
        <div className="toolbar__model-wrapper">
          <button
            className="toolbar__btn toolbar__btn--model"
            onClick={() => setShowModelMenu(!showModelMenu)}
            title="选择 AI 模型"
          >
            <Cpu size={14} />
            <span className="toolbar__model-label">{currentModelLabel}</span>
            <ChevronDown size={12} />
          </button>
          {showModelMenu && (
            <div className="toolbar__model-menu">
              <button
                className={`toolbar__model-item ${!selectedModel ? 'active' : ''}`}
                onClick={() => { setSelectedModel(null); setShowModelMenu(false) }}
              >
                默认模型
              </button>
              {models.map(m => (
                <button
                  key={m.id}
                  className={`toolbar__model-item ${selectedModel === m.id ? 'active' : ''}`}
                  onClick={() => { setSelectedModel(m.id); setShowModelMenu(false) }}
                >
                  <span>{m.label}</span>
                  {m.providerLabel && <span className="toolbar__model-provider">{m.providerLabel}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="toolbar__divider" />

        <button
          className="toolbar__btn toolbar__btn--primary toolbar__btn--save"
          onClick={handleSave}
          disabled={nodes.length === 0 || isSaving}
          title="保存项目 (Ctrl+S)"
        >
          <Save size={14} /> 保存
        </button>

        <div className="toolbar__export-wrapper">
          <button
            className="toolbar__btn"
            onClick={() => setShowExportMenu(!showExportMenu)}
            disabled={nodes.length === 0}
            title="导出"
          >
            <Upload size={14} /> 导出
          </button>
          {showExportMenu && (
            <div className="toolbar__export-menu">
              <button onClick={handleExportPng}><FileImage size={14} /> 导出 PNG</button>
              <button onClick={handleExportSvg}><FileImage size={14} /> 导出 SVG</button>
              <button onClick={handleExportJson}><FileJson size={14} /> 导出 JSON</button>
              <button onClick={handleCopyToClipboard}><ClipboardCopy size={14} /> 复制到剪贴板</button>
            </div>
          )}
        </div>

        <button className="toolbar__btn" onClick={handleImportJson} title="导入 JSON">
          <Download size={14} /> 导入
        </button>

        <div className="toolbar__divider" />
        <button
          className="toolbar__btn"
          onClick={toggleChat}
          title={isChatCollapsed ? '展开对话' : '收起对话'}
        >
          {isChatCollapsed ? <PanelRight size={16} /> : <PanelRightClose size={16} />}
        </button>
      </div>
    </div>
  )
}
