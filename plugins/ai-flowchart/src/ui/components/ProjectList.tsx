import { useState, useEffect, useCallback } from 'react'
import {
  FolderOpen, Trash2, Clock, FileText, Plus,
} from 'lucide-react'
import { useFlowStore } from '../store/flowStore'
import { useMulby } from '../hooks/useMulby'
import { useAutoLayout } from '../hooks/useAutoLayout'

const PLUGIN_ID = 'ai-flowchart'

interface ProjectItem {
  id: string
  name: string
  updatedAt: number
}

export default function ProjectList() {
  const {
    projectId,
    setProjectInfo, resetSession, pushHistory,
    projectListVersion, bumpProjectListVersion,
  } = useFlowStore()

  const { host, notification } = useMulby(PLUGIN_ID)
  const { performLayout } = useAutoLayout()
  const [projects, setProjects] = useState<ProjectItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // 加载项目列表
  const loadProjects = useCallback(async () => {
    try {
      console.log('[ai-flowchart][ui] loadProjects calling host.call(listProjects)...')
      const result = await (host as any).call('listProjects')
      // host.call 返回 { success, data }，实际数据在 data 里
      const data = (result?.data || result || {}) as Record<string, any>
      console.log('[ai-flowchart][ui] listProjects result keys:', JSON.stringify(Object.keys(data)))
      const list = Object.values(data)
        .map((p: any) => ({
          id: p.id,
          name: p.name || '未命名流程图',
          updatedAt: p.updatedAt || 0,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      setProjects(list)
      console.log('[ai-flowchart][ui] project list loaded, count:', list.length)
    } catch (err) {
      console.error('[ai-flowchart][ui] loadProjects FAILED:', err)
    } finally {
      setIsLoading(false)
    }
  }, [host])

  useEffect(() => {
    loadProjects()
  }, [loadProjects, projectListVersion])

  // 打开项目
  const handleOpen = useCallback(async (id: string) => {
    try {
      // 切换项目时先清空聊天记录
      const { clearMessages } = useFlowStore.getState()
      clearMessages()

      const result = await (host as any).call('listProjects')
      const data = (result?.data || result || {}) as Record<string, any>
      const project = data[id]
      if (!project?.data) {
        notification.show('项目数据不存在', 'error')
        return
      }

      pushHistory()
      const fd = project.data
      // 先恢复图表类型（确保布局使用正确算法），再执行布局
      useFlowStore.getState().setDiagramType(fd.diagramType || 'flowchart')
      await performLayout(fd.nodes || [], fd.edges || [], fd.metadata || { title: project.name, description: '' }, 'TB', false)
      setProjectInfo(id, project.name)
      // 打开已保存的项目，标记为干净
      useFlowStore.getState().markClean()
    } catch (err: any) {
      notification.show(`打开失败: ${err?.message}`, 'error')
    }
  }, [host, notification, pushHistory, performLayout, setProjectInfo])

  // 删除项目
  const handleDelete = useCallback(async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await (host as any).call('deleteProject', { id })
      bumpProjectListVersion()
      notification.show(`已删除: ${name}`)
      // 如果删除的是当前项目，重置
      if (id === projectId) {
        resetSession()
      }
    } catch (err: any) {
      notification.show(`删除失败: ${err?.message}`, 'error')
    }
  }, [host, notification, projectId, resetSession])

  // 新建项目
  const handleNew = useCallback(() => {
    resetSession()
  }, [resetSession])

  // 格式化时间
  function formatTime(ts: number) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    return `${(d.getMonth() + 1)}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  return (
    <div className="project-list">
      <div className="project-list__header">
        <FolderOpen size={14} />
        <span>项目列表</span>
        <button
          className="project-list__new-btn"
          onClick={handleNew}
          title="新建项目"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="project-list__items">
        {isLoading && (
          <div className="project-list__empty">加载中...</div>
        )}

        {!isLoading && projects.length === 0 && (
          <div className="project-list__empty">
            <FileText size={24} />
            <span>暂无项目</span>
          </div>
        )}

        {projects.map((p) => (
          <button
            key={p.id}
            className={`project-list__item ${p.id === projectId ? 'active' : ''}`}
            onClick={() => handleOpen(p.id)}
          >
            <div className="project-list__item-info">
              <span className="project-list__item-name">{p.name}</span>
              <span className="project-list__item-time">
                <Clock size={10} /> {formatTime(p.updatedAt)}
              </span>
            </div>
            <button
              className="project-list__item-delete"
              onClick={(e) => handleDelete(p.id, p.name, e)}
              title="删除项目"
            >
              <Trash2 size={12} />
            </button>
          </button>
        ))}
      </div>

      <button
        className="project-list__refresh"
        onClick={loadProjects}
      >
        刷新列表
      </button>
    </div>
  )
}
