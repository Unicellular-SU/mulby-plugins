import { useEffect, useCallback } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import ChatPanel from './components/ChatPanel'
import FlowCanvas from './components/FlowCanvas'
import Toolbar from './components/Toolbar'
import ProjectList from './components/ProjectList'
import { useFlowStore } from './store/flowStore'

export default function App() {
  const {
    isChatCollapsed,
    undo,
    redo,
  } = useFlowStore()

  // ============ 主题跟随宿主程序 ============
  useEffect(() => {
    // 从 URL 参数读取初始主题
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'dark'
    document.documentElement.classList.toggle('light', initialTheme === 'light')

    // 监听宿主程序主题变化
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('light', newTheme === 'light')
    })
  }, [])

  // 全局快捷键
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      if (isMod && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        redo()
      }
      // Cmd/Ctrl+S 保存
      if (isMod && e.key === 's') {
        e.preventDefault()
        // 触发 Toolbar 的保存按钮点击
        const saveBtn = document.querySelector('.toolbar__btn--save') as HTMLButtonElement
        if (saveBtn) saveBtn.click()
      }
    },
    [undo, redo]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [handleGlobalKeyDown])

  return (
    <ReactFlowProvider>
      <div className="app">
        {/* 顶部工具栏 */}
        <Toolbar />

        {/* 主内容区 */}
        <div className="app__content">
          {/* 左侧项目列表 */}
          <div className="app__sidebar">
            <ProjectList />
          </div>

          {/* 中间画布 */}
          <div className="app__canvas">
            <FlowCanvas />
          </div>

          {/* 右侧对话面板 */}
          {!isChatCollapsed && (
            <div className="app__chat">
              <ChatPanel />
            </div>
          )}
        </div>
      </div>
    </ReactFlowProvider>
  )
}
