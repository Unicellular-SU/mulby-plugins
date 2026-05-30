// src/ui/App.tsx
import React, { useState, useEffect } from 'react'
import { usePadStore } from './hooks/usePadStore'
import { useMulby } from './hooks/useMulby'
import { PadView } from './components/PadView'
import { PadList } from './components/PadList'
import { Toolbar } from './components/Toolbar'
import { loadFromStorage } from './store/padStore'

export default function App() {
  const { state, activePad, createPad, switchPad, renamePad, deletePad, addLine, updateLine, removeLine, clearActivePad } = usePadStore()
  const mulby = useMulby()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // Load initial data
    loadFromStorage().then(() => setLoaded(true))

    // Initialize theme based on localStorage
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark')
    }
  }, [])

  useEffect(() => {
    // Global keyboard shortcuts
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + N
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        createPad()
      }
      // Cmd/Ctrl + R
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault()
        clearPadConfirm()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [activePad])

  const copyAll = () => {
    if (!activePad || !mulby) return
    const text = activePad.lines.map(l => `${l.expression} = ${l.result}`).join('\n')
    mulby.clipboard.writeText(text)
    mulby.notification.show('已复制所有计算结果')
  }

  const clearPadConfirm = () => {
    if (confirm('确定清空当前稿纸吗？')) {
      clearActivePad()
    }
  }

  if (!loaded) return null

  return (
    <div className="h-screen flex flex-col bg-[#FAFAF8] dark:bg-[#1A1A1A] text-gray-800 dark:text-gray-200 font-sans overflow-hidden">
      {/* Titlebar area for drag (if frameless, else just spacing) */}
      <div className="h-8 shrink-0 drag-region" />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {activePad ? (
            <PadView 
              key={activePad.id}
              lines={activePad.lines}
              onAddLine={addLine}
              onUpdateLine={updateLine}
              onRemoveLine={removeLine}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              加载中...
            </div>
          )}
          
          <Toolbar 
            onCopyAll={copyAll}
            onClear={clearPadConfirm}
            onNewPad={() => createPad()}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            isSidebarOpen={isSidebarOpen}
          />
        </div>

        {/* Sidebar */}
        {isSidebarOpen && (
          <PadList 
            pads={state.pads}
            activePadId={state.activePadId}
            onSwitch={switchPad}
            onRename={renamePad}
            onDelete={(id) => {
              if (confirm('确定删除该稿纸吗？')) {
                deletePad(id)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}
