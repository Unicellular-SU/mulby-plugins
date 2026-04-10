/**
 * 分组节点 — 可包含子节点的容器
 *
 * 功能：
 * 1. 可调整大小的容器框
 * 2. 标题栏 + 折叠/展开按钮
 * 3. 子节点自动归组（通过 parentId）
 * 4. 折叠时隐藏子节点
 */
import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps, NodeResizer } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useFlowStore } from '../../store/flowStore'

export const GroupNode = memo(({ id, data, selected }: NodeProps) => {
  const label = (data as any).label || '分组'
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const updateNodeLabel = useFlowStore((s) => s.updateNodeLabel)
  const setNodes = useFlowStore((s) => s.setNodes)
  const nodes = useFlowStore((s) => s.nodes)

  // 折叠/展开 → 隐藏/显示子节点 + 调整 group 高度
  const toggleCollapse = useCallback(() => {
    const newCollapsed = !isCollapsed
    setIsCollapsed(newCollapsed)

    const updatedNodes = nodes.map((n) => {
      // 隐藏/显示子节点
      if (n.parentId === id) {
        return { ...n, hidden: newCollapsed }
      }
      // 折叠时缩小 group 高度到只显示标题栏
      if (n.id === id) {
        const currentStyle = (n.style as any) || {}
        if (newCollapsed) {
          return {
            ...n,
            style: {
              ...currentStyle,
              // 保存原始高度以便恢复
              _originalHeight: currentStyle.height || currentStyle._originalHeight,
              height: 44,
            },
          }
        } else {
          return {
            ...n,
            style: {
              ...currentStyle,
              height: currentStyle._originalHeight || 200,
            },
          }
        }
      }
      return n
    })
    setNodes(updatedNodes)
  }, [isCollapsed, id, nodes, setNodes])

  const startEdit = useCallback(() => {
    setEditValue(label)
    setIsEditing(true)
  }, [label])

  const finishEdit = useCallback(() => {
    setIsEditing(false)
    if (editValue.trim() && editValue !== label) {
      updateNodeLabel(id, editValue.trim())
    }
  }, [editValue, label, id, updateNodeLabel])

  // 计算子节点数量
  const childCount = nodes.filter((n) => n.parentId === id).length

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={isCollapsed ? 40 : 100}
        lineClassName="group-node__resize-line"
        handleClassName="group-node__resize-handle"
      />
      <div
        className={`group-node ${isCollapsed ? 'group-node--collapsed' : ''}`}
        style={{ width: '100%', height: '100%' }}
      >
        {/* 标题栏 */}
        <div className="group-node__header" onDoubleClick={startEdit}>
          <button
            className="group-node__toggle"
            onClick={(e) => { e.stopPropagation(); toggleCollapse() }}
            title={isCollapsed ? '展开' : '折叠'}
          >
            {isCollapsed
              ? <ChevronRight size={14} />
              : <ChevronDown size={14} />
            }
          </button>
          {isEditing ? (
            <input
              className="group-node__input nodrag"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={finishEdit}
              onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
              autoFocus
            />
          ) : (
            <span className="group-node__label">{label}</span>
          )}
          {childCount > 0 && (
            <span className="group-node__badge">{childCount}</span>
          )}
        </div>
        {/* 子内容区（折叠时隐藏） */}
        {!isCollapsed && (
          <div className="group-node__content" />
        )}
      </div>
      {/* Handle — 四边连接 */}
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
    </>
  )
})
GroupNode.displayName = 'GroupNode'
