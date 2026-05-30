// src/ui/components/Toolbar.tsx
import React, { useState } from 'react'
import { Palette, Copy, Trash2, Plus, Menu, Image as ImageIcon } from 'lucide-react'

interface ToolbarProps {
  onCopyAll: () => void
  onClear: () => void
  onNewPad: () => void
  onToggleSidebar: () => void
  isSidebarOpen: boolean
}

export const Toolbar: React.FC<ToolbarProps> = ({
  onCopyAll,
  onClear,
  onNewPad,
  onToggleSidebar,
  isSidebarOpen
}) => {
  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains('dark')
    if (isDark) {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    } else {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    }
  }

  const Btn = ({ icon: Icon, onClick, title }: any) => (
    <button
      onClick={onClick}
      title={title}
      className="p-2 text-gray-500 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/30 rounded-md transition-all active:scale-95"
    >
      <Icon size={18} />
    </button>
  )

  return (
    <div className="h-12 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between px-4 bg-white/80 dark:bg-gray-900/80 backdrop-blur shrink-0 select-none">
      <div className="flex items-center gap-1">
        <Btn icon={Palette} onClick={toggleTheme} title="切换主题" />
        <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-2"></div>
        <Btn icon={Copy} onClick={onCopyAll} title="复制所有结果" />
        <Btn icon={Trash2} onClick={onClear} title="清空当前稿纸 (Cmd+R)" />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onNewPad}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-full transition-colors active:scale-95"
        >
          <Plus size={16} />
          新稿纸
        </button>
        <button
          onClick={onToggleSidebar}
          className={`p-2 rounded-md transition-colors active:scale-95 ${isSidebarOpen ? 'bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          <Menu size={18} />
        </button>
      </div>
    </div>
  )
}
