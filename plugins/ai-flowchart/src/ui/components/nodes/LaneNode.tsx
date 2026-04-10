/**
 * 泳道节点 — 水平全宽的分区容器
 *
 * 功能：
 * 1. 左侧标题区域（角色/部门名称）
 * 2. 右侧内容区域（子节点通过 parentId 归属）
 * 3. 可调整高度
 * 4. 深浅主题适配
 */
import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps, NodeResizer } from '@xyflow/react'
import { useFlowStore } from '../../store/flowStore'

export const LaneNode = memo(({ id, data, selected }: NodeProps) => {
  const label = (data as any).label || '泳道'
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const updateNodeLabel = useFlowStore((s) => s.updateNodeLabel)

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

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={400}
        minHeight={100}
        lineClassName="lane-node__resize-line"
        handleClassName="lane-node__resize-handle"
      />
      <div
        className={`lane-node ${selected ? 'lane-node--selected' : ''}`}
        style={{ width: '100%', height: '100%' }}
      >
        {/* 左侧标题区 */}
        <div className="lane-node__header" onDoubleClick={startEdit}>
          {isEditing ? (
            <input
              className="lane-node__input nodrag"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={finishEdit}
              onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
              autoFocus
            />
          ) : (
            <span className="lane-node__label">{label}</span>
          )}
        </div>
        {/* 右侧内容区 */}
        <div className="lane-node__content" />
      </div>
      {/* 连接点 */}
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </>
  )
})
LaneNode.displayName = 'LaneNode'
