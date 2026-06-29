import { useRef, type ChangeEvent } from 'react'
import { FolderOpen, Plus, Upload, Download, Copy, Pencil, Trash2, Check, X, Layers } from 'lucide-react'
import { useEscClose } from '../hooks'
import { useUi } from '../store/uiStore'
import { useProject } from '../store/projectStore'
import { promptDialog } from '../store/dialogStore'
import { toast } from '../store/toastStore'

const fmtTime = (ts: number) => {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ProjectLibrary() {
  const show = useUi((s) => s.showProjectLibrary)
  useEscClose(() => useUi.getState().setShowProjectLibrary(false))
  if (!show) return null
  return <Inner />
}

function Inner() {
  const items = useProject((s) => s.items)
  const activeId = useProject((s) => s.activeId)
  const fileRef = useRef<HTMLInputElement>(null)
  const close = () => useUi.getState().setShowProjectLibrary(false)

  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt)

  const onOpen = async (id: string) => {
    if (id !== activeId) await useProject.getState().switchProject(id)
    close()
  }
  const onNew = async () => {
    await useProject.getState().newProject()
    close()
  }
  const onRename = async (id: string, cur: string) => {
    const name = await promptDialog({ title: '重命名工程', defaultValue: cur, confirmLabel: '保存' })
    if (name != null && name.trim()) await useProject.getState().renameProject(id, name.trim())
  }
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const doc = JSON.parse(await f.text())
      await useProject.getState().importProject(doc)
      close()
    } catch {
      toast('导入失败：文件不是有效的工程 JSON', 'error')
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-6" onClick={close}>
      <div data-interactive onClick={(e) => e.stopPropagation()} className="ace-dialog ace-anim-scale w-[860px] max-w-full max-h-[88vh] flex flex-col text-neutral-800 dark:text-neutral-200">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <FolderOpen size={16} className="text-indigo-500" /> 工程库
            <span className="text-xs opacity-50 font-normal">（{items.length}）</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={onNew} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs">
              <Plus size={14} /> 新建
            </button>
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs">
              <Upload size={14} /> 导入
            </button>
            <button onClick={close} className="ml-1 opacity-60 hover:opacity-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-4 overflow-auto ace-scroll grid grid-cols-3 gap-3">
          {sorted.map((p) => {
            const isActive = p.id === activeId
            return (
              <div
                key={p.id}
                onDoubleClick={() => void onOpen(p.id)}
                className={`group relative rounded-xl border overflow-hidden flex flex-col bg-white dark:bg-neutral-900 ${isActive ? 'ring-2 ring-indigo-500' : ''}`}
                style={{ borderColor: 'var(--ace-border)' }}
              >
                <div className="aspect-[16/10] bg-black/5 dark:bg-white/5 grid place-items-center overflow-hidden">
                  {p.cover ? (
                    <img src={p.cover} draggable={false} className="w-full h-full object-cover" />
                  ) : (
                    <Layers size={28} className="opacity-25" />
                  )}
                </div>
                {isActive && (
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] leading-none">
                    <Check size={11} /> 当前
                  </div>
                )}
                <div className="p-2 flex flex-col gap-0.5">
                  <div className="text-sm font-medium truncate" title={p.name}>{p.name || '未命名工程'}</div>
                  <div className="text-[11px] opacity-50 tabular-nums">{p.cardCount} 张卡片 · {fmtTime(p.updatedAt)}</div>
                </div>
                {/* 悬停动作条 */}
                <div className="flex items-center gap-0.5 px-1.5 pb-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!isActive && (
                    <button onClick={() => void onOpen(p.id)} className="flex-1 px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-[11px]">打开</button>
                  )}
                  <IconAct title="重命名" onClick={() => void onRename(p.id, p.name)} icon={Pencil} />
                  <IconAct title="复制" onClick={() => void useProject.getState().duplicateProject(p.id)} icon={Copy} />
                  <IconAct title="导出 JSON" onClick={() => void useProject.getState().exportProject(p.id)} icon={Download} />
                  <IconAct title="删除" onClick={() => void useProject.getState().deleteProject(p.id)} icon={Trash2} danger />
                </div>
              </div>
            )
          })}
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
      </div>
    </div>
  )
}

function IconAct({ title, onClick, icon: Icon, danger }: { title: string; onClick: () => void; icon: typeof Pencil; danger?: boolean }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-7 h-7 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/15 ${danger ? 'text-red-500' : 'opacity-70 hover:opacity-100'}`}
    >
      <Icon size={14} />
    </button>
  )
}
