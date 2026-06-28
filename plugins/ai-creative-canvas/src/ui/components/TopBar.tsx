import { Plus, Sparkles, Check, Loader2, Settings, LayoutTemplate, ListChecks, Images, FolderOpen, Clapperboard } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { useTask } from '../store/taskStore'
import { Select } from './Select'
import { STYLE_PACKS } from '../services/stylePacks'
import { ProjectSettings } from './ProjectSettings'

export function TopBar() {
  const name = useGraph((s) => s.project.name)
  const boards = useGraph((s) => s.project.boards)
  const activeBoardId = useGraph((s) => s.project.activeBoardId)
  const renameProject = useGraph((s) => s.renameProject)
  const addBoard = useGraph((s) => s.addBoard)
  const setActiveBoard = useGraph((s) => s.setActiveBoard)
  const stylePackId = useGraph((s) => s.getActiveBoard().stylePackId || '')
  const setStylePack = useGraph((s) => s.setStylePack)
  const saving = useUi((s) => s.saving)
  const active = useTask((s) => s.active)

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
        title="工程库（多工程管理）"
        className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20 shrink-0"
      >
        <FolderOpen size={15} />
      </button>
      <input
        value={name}
        onChange={(e) => renameProject(e.target.value)}
        className="px-2 py-1 rounded-md bg-black/5 dark:bg-white/10 text-sm w-44 outline-none focus:ring-1 focus:ring-indigo-400"
        placeholder="工程名称"
      />
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
      <button onClick={() => useUi.getState().setShowDirector(true)} title="3D 导演台（摆机位/人台 → 生成）" className="h-7 w-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/20">
        <Clapperboard size={15} />
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
