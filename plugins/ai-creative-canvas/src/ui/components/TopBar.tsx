import { Plus, Sparkles, Check, Loader2, Settings, LayoutTemplate, ListChecks, Images, FolderOpen, Clapperboard, Search, LayoutDashboard, Rows3, Bot } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { useTask } from '../store/taskStore'
import { Select } from './Select'
import { STYLE_PACKS } from '../services/stylePacks'
import { ProjectSettings } from './ProjectSettings'
import { promptDialog, confirmDialog } from '../store/dialogStore'

export function TopBar() {
  const name = useGraph((s) => s.project.name)
  const boards = useGraph((s) => s.project.boards)
  const activeBoardId = useGraph((s) => s.project.activeBoardId)
  const renameProject = useGraph((s) => s.renameProject)
  const addBoard = useGraph((s) => s.addBoard)
  const setActiveBoard = useGraph((s) => s.setActiveBoard)
  const renameBoard = useGraph((s) => s.renameBoard)
  const removeBoard = useGraph((s) => s.removeBoard)
  const stylePackId = useGraph((s) => s.getActiveBoard().stylePackId || '')
  const setStylePack = useGraph((s) => s.setStylePack)
  const saving = useUi((s) => s.saving)
  const workspaceView = useUi((s) => s.workspaceView)
  const setWorkspaceView = useUi((s) => s.setWorkspaceView)
  const active = useTask((s) => s.active)
  const workflowActive = useGraph((s) => Object.values(s.project.workflowRuns || {}).filter((run) => run.status === 'running' || run.status === 'paused' || run.status === 'error').length)

  return (
    <div
      className="ace-bar h-11 shrink-0 flex items-center gap-3 px-3 border-b"
      style={{ borderColor: 'var(--ace-border)' }}
    >
      <div className="flex items-center gap-1.5 font-semibold text-[15px] pr-2">
        <Sparkles size={17} className="text-indigo-500" />
        <span>创意画布</span>
      </div>
      <button
        onClick={() => useUi.getState().setShowProjectLibrary(true)}
        title="工程库"
        className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20 shrink-0"
      >
        <FolderOpen size={15} />
      </button>
      <button onClick={() => useUi.getState().setShowAgent(!useUi.getState().showAgent)} title="创作 Agent" className="relative h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20">
        <Bot size={15} />
        {workflowActive > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-indigo-500 text-white text-[8px] grid place-items-center">{Math.min(9, workflowActive)}</span>}
      </button>
      <input
        value={name}
        onChange={(e) => renameProject(e.target.value)}
        className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/10 text-sm w-44 outline-none focus:ring-1 focus:ring-indigo-400"
        placeholder="工程名称"
      />
      <div className="shrink-0 flex items-center rounded-md bg-black/5 dark:bg-white/10 p-0.5 text-[11px]">
        <button
          type="button"
          onClick={() => setWorkspaceView('canvas')}
          title="自由画布视图"
          className={`h-6 px-1.5 rounded flex items-center gap-1 ${workspaceView === 'canvas' ? 'bg-white dark:bg-white/15 text-indigo-500 shadow-sm' : 'opacity-60 hover:opacity-100'}`}
        >
          <LayoutDashboard size={12} /> 画布
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceView('storyboard')}
          title="故事板工作区"
          className={`h-6 px-1.5 rounded flex items-center gap-1 ${workspaceView === 'storyboard' ? 'bg-white dark:bg-white/15 text-indigo-500 shadow-sm' : 'opacity-60 hover:opacity-100'}`}
        >
          <Rows3 size={12} /> 故事板
        </button>
      </div>
      <Select
        className="w-44"
        value={stylePackId}
        onChange={(v) => setStylePack(v || undefined)}
        placeholder="风格包"
        options={[{ value: '', label: '风格包 · 无' }, ...STYLE_PACKS.map((p) => ({ value: p.id, label: p.label }))]}
      />
      <div className="flex items-center gap-1 overflow-x-auto ace-scroll flex-1">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => setActiveBoard(b.id)}
            onDoubleClick={async () => {
              const next = await promptDialog({ title: '重命名画布', defaultValue: b.name, confirmLabel: '重命名' })
              if (next && next.trim()) renameBoard(b.id, next.trim())
            }}
            onContextMenu={async (e) => {
              e.preventDefault()
              if (boards.length <= 1) return // 至少保留一块画布
              const ok = await confirmDialog({ title: '删除画布', message: `删除画布「${b.name}」及其全部卡片？不可撤销。`, confirmLabel: '删除', cancelLabel: '取消', danger: true })
              if (ok) removeBoard(b.id)
            }}
            title="单击切换 · 双击重命名 · 右键删除"
            className={`px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors ${
              b.id === activeBoardId
                ? 'bg-indigo-500 text-white'
                : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20'
            }`}
          >
            {b.name}
          </button>
        ))}
        <button
          onClick={addBoard}
          title="新建画布"
          className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20"
        >
          <Plus size={15} />
        </button>
      </div>
      <button
        onClick={() => useUi.getState().setShowTaskCenter(true)}
        title="任务中心"
        className="text-[11px] px-2 py-0.5 rounded-full flex items-center gap-1 whitespace-nowrap hover:bg-black/5 dark:hover:bg-white/10"
      >
        {active > 0 ? (
          <>
            <Loader2 size={11} className="animate-spin text-indigo-500" />
            <span className="text-indigo-500">{active} 生成中</span>
          </>
        ) : (
          <ListChecks size={14} className="opacity-70" />
        )}
      </button>
      <button onClick={() => useUi.getState().setShowDirector(true)} title="3D 导演台" className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20">
        <Clapperboard size={15} />
      </button>
      <button onClick={() => useUi.getState().setShowSearch(true)} title="搜索卡片" className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20">
        <Search size={15} />
      </button>
      <button onClick={() => useUi.getState().setShowGallery(true)} title="作品库" className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20">
        <Images size={15} />
      </button>
      <button onClick={() => useUi.getState().setShowTemplates(true)} title="模板" className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20">
        <LayoutTemplate size={15} />
      </button>
      <ProjectSettings />
      <button
        onClick={() => useUi.getState().setShowProviderSettings(true)}
        title="Provider 设置"
        className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20"
      >
        <Settings size={15} />
      </button>
      <div className="text-[11px] opacity-60 flex items-center gap-1 w-16 justify-end">
        {saving ? (
          <>
            <Loader2 size={12} className="animate-spin" /> 保存中
          </>
        ) : (
          <>
            <Check size={12} /> 已保存
          </>
        )}
      </div>
    </div>
  )
}
