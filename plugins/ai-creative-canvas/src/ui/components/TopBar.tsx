import { Plus, Sparkles, Check, Loader2, Settings } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { useTask } from '../store/taskStore'

export function TopBar() {
  const name = useGraph((s) => s.project.name)
  const boards = useGraph((s) => s.project.boards)
  const activeBoardId = useGraph((s) => s.project.activeBoardId)
  const renameProject = useGraph((s) => s.renameProject)
  const addBoard = useGraph((s) => s.addBoard)
  const setActiveBoard = useGraph((s) => s.setActiveBoard)
  const saving = useUi((s) => s.saving)
  const active = useTask((s) => s.active)

  return (
    <div
      className="h-11 shrink-0 flex items-center gap-3 px-3 border-b bg-white/80 dark:bg-neutral-900/80 backdrop-blur"
      style={{ borderColor: 'var(--ace-border)' }}
    >
      <div className="flex items-center gap-1.5 font-semibold text-[15px] pr-2">
        <Sparkles size={17} className="text-indigo-500" />
        <span>创意画布</span>
      </div>
      <input
        value={name}
        onChange={(e) => renameProject(e.target.value)}
        className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/10 text-sm w-44 outline-none focus:ring-1 focus:ring-indigo-400"
        placeholder="工程名称"
      />
      <div className="flex items-center gap-1 overflow-x-auto ace-scroll flex-1">
        {boards.map((b) => (
          <button
            key={b.id}
            onClick={() => setActiveBoard(b.id)}
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
      {active > 0 && (
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500 flex items-center gap-1 whitespace-nowrap">
          <Loader2 size={11} className="animate-spin" />
          {active} 生成中
        </span>
      )}
      <button
        onClick={() => useUi.getState().setShowProviderSettings(true)}
        title="Provider 设置（视频/音频生成）"
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
