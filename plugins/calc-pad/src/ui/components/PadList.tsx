// src/ui/components/PadList.tsx
import React, { useState, useRef, useEffect } from 'react'
import { Pad } from '../store/padStore'
import { Trash2 } from 'lucide-react'

interface PadListProps {
  pads: Pad[]
  activePadId: string | null
  onSwitch: (id: string) => void
  onDelete: (id: string) => void
  onRename: (id: string, newName: string) => void
}

export const PadList: React.FC<PadListProps> = ({
  pads,
  activePadId,
  onSwitch,
  onDelete,
  onRename
}) => {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  const startRename = (pad: Pad) => {
    setEditingId(pad.id)
    setEditName(pad.name)
  }

  const commitRename = () => {
    if (editingId) {
      if (editName.trim()) {
        onRename(editingId, editName.trim())
      }
      setEditingId(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  return (
    <div className="w-64 border-l border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">历史稿纸</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
        {pads.map(pad => (
          <div
            key={pad.id}
            onClick={() => onSwitch(pad.id)}
            onDoubleClick={() => startRename(pad)}
            className={`group flex items-center justify-between p-3 rounded-lg mb-1 cursor-pointer transition-colors ${
              pad.id === activePadId
                ? 'bg-orange-100/50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                : 'hover:bg-gray-200/50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            <div className="min-w-0 flex-1">
              {editingId === pad.id ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-white dark:bg-gray-800 text-sm font-medium outline-none border border-orange-300 dark:border-orange-600 rounded px-1 -ml-1"
                  onClick={e => e.stopPropagation()}
                  onDoubleClick={e => e.stopPropagation()}
                />
              ) : (
                <div className="text-sm font-medium truncate select-none">{pad.name}</div>
              )}
              <div className="text-xs opacity-60 truncate">
                {pad.lines.length} 行记录
              </div>
            </div>
            {!editingId && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(pad.id)
                }}
                className="p-1.5 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                title="删除稿纸"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
