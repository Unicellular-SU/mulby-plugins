// src/ui/components/NoteTag.tsx
import React, { useState, useRef, useEffect } from 'react'

interface NoteTagProps {
  note: string
  onChange: (newNote: string) => void
  forceEdit?: boolean
  onCancelForceEdit?: () => void
}

export const NoteTag: React.FC<NoteTagProps> = ({ note, onChange, forceEdit, onCancelForceEdit }) => {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(note)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (forceEdit) {
      setIsEditing(true)
    }
  }, [forceEdit])

  useEffect(() => {
    setValue(note)
  }, [note])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleBlur = () => {
    setIsEditing(false)
    if (onCancelForceEdit) onCancelForceEdit()
    if (value !== note) {
      onChange(value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      setValue(note)
      setIsEditing(false)
      if (onCancelForceEdit) onCancelForceEdit()
    }
  }

  if (isEditing) {
    return (
      <div className="inline-block mt-1">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 px-2 py-0.5 rounded outline-none border border-orange-300 dark:border-orange-700 focus:border-orange-500 w-32"
          placeholder="备注..."
        />
      </div>
    )
  }

  if (!note && !isEditing) return null

  return (
    <div className="inline-block mt-1">
      <span
        className="text-xs bg-orange-100/80 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 rounded cursor-pointer hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors"
        onClick={() => setIsEditing(true)}
      >
        {note}
      </span>
    </div>
  )
}
