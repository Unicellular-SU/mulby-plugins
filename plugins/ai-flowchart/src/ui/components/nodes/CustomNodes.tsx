import { memo, useState, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useFlowStore } from '../../store/flowStore'

// ============ 通用编辑逻辑 ============

function useInlineEdit(nodeId: string, initialLabel: string) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(initialLabel)
  const updateNodeLabel = useFlowStore((s) => s.updateNodeLabel)

  const startEdit = useCallback(() => {
    setEditValue(initialLabel)
    setIsEditing(true)
  }, [initialLabel])

  const finishEdit = useCallback(() => {
    setIsEditing(false)
    if (editValue.trim() && editValue !== initialLabel) {
      updateNodeLabel(nodeId, editValue.trim())
    }
  }, [editValue, initialLabel, nodeId, updateNodeLabel])

  return { isEditing, editValue, setEditValue, startEdit, finishEdit }
}

// ============ 开始节点 ============
export const StartNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '开始'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)

  return (
    <div className="flow-node flow-node--start" onDoubleClick={startEdit}>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      {isEditing ? (
        <input
          className="flow-node__input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
          autoFocus
        />
      ) : (
        <div className="flow-node__label">{label}</div>
      )}
    </div>
  )
})
StartNode.displayName = 'StartNode'

// ============ 结束节点 ============
export const EndNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '结束'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)

  return (
    <div className="flow-node flow-node--end" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      {isEditing ? (
        <input
          className="flow-node__input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
          autoFocus
        />
      ) : (
        <div className="flow-node__label">{label}</div>
      )}
    </div>
  )
})
EndNode.displayName = 'EndNode'

// ============ 处理节点 ============
export const ProcessNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '处理'
  const description = (data as any).description
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)

  return (
    <div className="flow-node flow-node--process" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input
          className="flow-node__input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
          autoFocus
        />
      ) : (
        <>
          <div className="flow-node__label">{label}</div>
          {description && <div className="flow-node__desc">{description}</div>}
        </>
      )}
    </div>
  )
})
ProcessNode.displayName = 'ProcessNode'

// ============ 判断节点 ============
export const DecisionNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '判断'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)

  return (
    <div className="flow-node flow-node--decision" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input
          className="flow-node__input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
          autoFocus
        />
      ) : (
        <div className="flow-node__label">{label}</div>
      )}
    </div>
  )
})
DecisionNode.displayName = 'DecisionNode'

// ============ 文字节点 ============
export const TextNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '文字'
  const description = (data as any).description
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)

  return (
    <div className="flow-node flow-node--text" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input
          className="flow-node__input"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit}
          onKeyDown={(e) => e.key === 'Enter' && finishEdit()}
          autoFocus
        />
      ) : (
        <>
          <div className="flow-node__label">{label}</div>
          {description && <div className="flow-node__desc">{description}</div>}
        </>
      )}
    </div>
  )
})
TextNode.displayName = 'TextNode'

// ============ 输入/输出节点（平行四边形）============
export const IoNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '输入/输出'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--io" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
IoNode.displayName = 'IoNode'

// ============ 数据库节点（圆柱体）============
export const DatabaseNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '数据库'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--database" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      <div className="flow-node__db-top" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
DatabaseNode.displayName = 'DatabaseNode'

// ============ 文档节点（波浪底边）============
export const DocumentNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '文档'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--document" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
DocumentNode.displayName = 'DocumentNode'

// ============ 预定义处理/子程序节点（双竖线矩形）============
export const SubroutineNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '子程序'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--subroutine" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
SubroutineNode.displayName = 'SubroutineNode'

// ============ 延迟节点（D 型）============
export const DelayNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '延迟'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--delay" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
DelayNode.displayName = 'DelayNode'

// ============ 准备节点（六边形）============
export const PreparationNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '准备'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--preparation" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
PreparationNode.displayName = 'PreparationNode'

// ============ 手动操作节点（倒梯形）============
export const ManualNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || '手动操作'
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--manual" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Left} id="left" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
ManualNode.displayName = 'ManualNode'

// ============ 连接器节点（小圆圈）============
export const ConnectorNode = memo(({ id, data }: NodeProps) => {
  const label = (data as any).label || ''
  const { isEditing, editValue, setEditValue, startEdit, finishEdit } = useInlineEdit(id, label)
  return (
    <div className="flow-node flow-node--connector" onDoubleClick={startEdit}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
      {isEditing ? (
        <input className="flow-node__input" value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={finishEdit} onKeyDown={(e) => e.key === 'Enter' && finishEdit()} autoFocus />
      ) : <div className="flow-node__label">{label}</div>}
    </div>
  )
})
ConnectorNode.displayName = 'ConnectorNode'

import { GroupNode } from './GroupNode'
import { LaneNode } from './LaneNode'
import { EntityNode } from './EntityNode'

// ============ 导出节点类型映射 ============
export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  process: ProcessNode,
  decision: DecisionNode,
  text: TextNode,
  io: IoNode,
  database: DatabaseNode,
  document: DocumentNode,
  subroutine: SubroutineNode,
  delay: DelayNode,
  preparation: PreparationNode,
  manual: ManualNode,
  connector: ConnectorNode,
  group: GroupNode,
  lane: LaneNode,
  entity: EntityNode,
}
