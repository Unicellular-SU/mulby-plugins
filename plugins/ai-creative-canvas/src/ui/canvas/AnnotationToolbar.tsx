import { Pencil, ArrowUpRight, Square, Type, Eraser, MousePointer2 } from 'lucide-react'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#111827', '#ffffff']
const TOOLS = [
  { k: 'pen', icon: Pencil, title: '画笔' },
  { k: 'arrow', icon: ArrowUpRight, title: '箭头' },
  { k: 'rect', icon: Square, title: '矩形' },
  { k: 'text', icon: Type, title: '文字' }
] as const

// 标注工具条：底部居中浮岛；选中工具进入标注模式，再点同一工具退出
export function AnnotationToolbar() {
  const tool = useUi((s) => s.annotTool)
  const color = useUi((s) => s.annotColor)
  return (
    <div data-interactive className="ace-glass absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-1.5 py-1">
      <button
        onClick={() => useUi.getState().setAnnotTool(null)}
        data-tip="选择 / 退出标注（Esc）"
        className={`w-7 h-7 grid place-items-center rounded-md ${tool === null ? 'bg-indigo-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
      >
        <MousePointer2 size={15} />
      </button>
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      {TOOLS.map(({ k, icon: Icon, title }) => (
        <button
          key={k}
          onClick={() => useUi.getState().setAnnotTool(tool === k ? null : k)}
          data-tip={title}
          className={`w-7 h-7 grid place-items-center rounded-md ${tool === k ? 'bg-indigo-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
        >
          <Icon size={15} />
        </button>
      ))}
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      {COLORS.map((c) => (
        <button
          key={c}
          onClick={() => useUi.getState().setAnnotColor(c)}
          data-tip="颜色"
          className={`w-4 h-4 rounded-full border ${color === c ? 'ring-2 ring-indigo-400' : ''}`}
          style={{ background: c, borderColor: 'var(--ace-border)' }}
        />
      ))}
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      <button
        onClick={() => useGraph.getState().clearAnnotations()}
        data-tip="清空本画布标注"
        className="w-7 h-7 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-red-500"
      >
        <Eraser size={15} />
      </button>
    </div>
  )
}
