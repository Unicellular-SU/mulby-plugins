import { useEffect, useState } from 'react'
import { X, LayoutTemplate, Trash2, Plus } from 'lucide-react'
import { Empty } from './ui'
import { useEscClose } from '../hooks'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { listTemplates, deleteTemplate } from '../services/templates'
import { isBuiltinTemplate } from '../services/builtinTemplates'
import { screenToWorld } from '../canvas/viewport'
import type { GroupTemplate } from '../types'
import { toast } from '../store/toastStore'

export function TemplatePanel({ show, onClose }: { show: boolean; onClose: () => void }) {
  useEscClose(onClose, show)
  const [tpls, setTpls] = useState<GroupTemplate[]>([])
  useEffect(() => {
    if (show) void listTemplates().then(setTpls)
  }, [show])
  if (!show) return null

  const insert = (t: GroupTemplate) => {
    const ss = useUi.getState().stageSize
    const vp = useGraph.getState().getActiveBoard().viewport
    const world = screenToWorld(ss.w / 2, ss.h / 2, vp)
    useGraph.getState().insertTemplate(t, { x: world.x - t.group.w / 2, y: world.y - t.group.h / 2 })
    toast(`已插入模板：${t.name}`, 'success')
    onClose()
  }
  const del = async (id: string) => {
    if (await deleteTemplate(id)) setTpls(await listTemplates())
    else toast('删除失败', 'error')
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-start justify-center pt-20 p-6" onClick={onClose}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale w-[420px] max-w-full max-h-[70vh] flex flex-col text-neutral-800 dark:text-neutral-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <LayoutTemplate size={16} className="text-indigo-500" /> 模板
          </div>
          <button onClick={onClose} className="opacity-60 hover:opacity-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto ace-noscroll p-2">
          {tpls.length === 0 ? (
            <Empty icon={<LayoutTemplate size={22} className="opacity-50" />} text="还没有模板。选中一个分组 → 工具条「保存为模板」。" />
          ) : (
            tpls.map((t) => (
              <div key={t.id} className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-[11px] opacity-50">{t.members.length} 个节点</div>
                </div>
                <button onClick={() => insert(t)} className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-500 hover:bg-indigo-600 text-white">
                  <Plus size={12} /> 插入
                </button>
                {isBuiltinTemplate(t.id) ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 opacity-60">内置</span>
                ) : (
                  <button onClick={() => void del(t.id)} title="删除模板" className="p-1 text-red-500 opacity-70 hover:opacity-100">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
