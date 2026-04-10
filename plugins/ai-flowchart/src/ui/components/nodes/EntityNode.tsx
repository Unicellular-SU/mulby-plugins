/**
 * 实体节点 — ER 图中的表格式实体
 *
 * 功能：
 * 1. 顶部标题栏（实体名称 + 色彩背景）
 * 2. 字段列表（字段名 | 类型），支持 PK/FK 标识
 * 3. 根据字段数量自动计算高度
 * 4. 支持双击编辑实体名称
 */
import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowStore } from '../../store/flowStore'

// 字段定义
interface EntityField {
  name: string
  type: string
  pk?: boolean   // 主键
  fk?: boolean   // 外键
}

export const EntityNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '实体'
  const fields: EntityField[] = (data as any).fields || []
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
    <div className="entity-node">
      {/* 顶部标题 */}
      <div className="entity-node__header" onDoubleClick={startEdit}>
        {isEditing ? (
          <input
            className="entity-node__input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
            autoFocus
          />
        ) : (
          <span className="entity-node__title">{label}</span>
        )}
      </div>

      {/* 字段列表 */}
      <div className="entity-node__fields">
        {fields.length > 0 ? (
          fields.map((field, idx) => (
            <div key={idx} className={`entity-node__field ${field.pk ? 'entity-node__field--pk' : ''}`}>
              <span className="entity-node__field-icon">
                {field.pk ? '🔑' : field.fk ? '🔗' : ''}
              </span>
              <span className="entity-node__field-name">{field.name}</span>
              <span className="entity-node__field-type">{field.type}</span>
            </div>
          ))
        ) : (
          <div className="entity-node__field entity-node__field--empty">
            （无字段）
          </div>
        )}
      </div>

      {/* 四边连接点 */}
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
    </div>
  )
})
EntityNode.displayName = 'EntityNode'
