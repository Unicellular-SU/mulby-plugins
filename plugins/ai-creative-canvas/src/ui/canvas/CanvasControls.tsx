import { ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Grid3x3, Map as MapIcon, Magnet } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { clampZoom } from './viewport'

export function CanvasControls({ onFit }: { onFit: () => void }) {
  const board = useGraph((s) => s.getActiveBoard())
  const setViewport = useGraph((s) => s.setViewport)
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)
  const canUndo = useGraph((s) => s.past.length > 0)
  const canRedo = useGraph((s) => s.future.length > 0)
  const showGrid = useUi((s) => s.showGrid)
  const toggleGrid = useUi((s) => s.toggleGrid)
  const showMinimap = useUi((s) => s.showMinimap)
  const toggleMinimap = useUi((s) => s.toggleMinimap)
  const snapGrid = useUi((s) => s.snapGrid)
  const toggleSnapGrid = useUi((s) => s.toggleSnapGrid)
  const vp = board.viewport

  const zoomBy = (factor: number) => {
    // 朝画布中心缩放（近似：用当前视口中点）
    const z = clampZoom(vp.zoom * factor)
    setViewport({ ...vp, zoom: z })
  }

  const btn = 'h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div data-interactive className="ace-glass absolute bottom-3 left-3 flex items-center gap-1 px-1.5 py-1">
      <button className={btn} title="撤销 (Ctrl+Z)" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></button>
      <button className={btn} title="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></button>
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      <button className={btn} title="缩小" onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={16} /></button>
      <button className="px-1.5 text-xs tabular-nums min-w-[3rem] text-center hover:bg-black/5 dark:hover:bg-white/10 rounded-md h-8"
        title="重置缩放" onClick={() => setViewport({ ...vp, zoom: 1 })}>
        {Math.round(vp.zoom * 100)}%
      </button>
      <button className={btn} title="放大" onClick={() => zoomBy(1.2)}><ZoomIn size={16} /></button>
      <button className={btn} title="适配内容 (F)" onClick={onFit}><Maximize size={16} /></button>
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      <button className={`${btn} ${showGrid ? 'text-indigo-500' : ''}`} title="网格" onClick={toggleGrid}><Grid3x3 size={16} /></button>
      <button className={`${btn} ${showMinimap ? 'text-indigo-500' : ''}`} title="小地图 (M)" onClick={toggleMinimap}><MapIcon size={16} /></button>
      <button className={`${btn} ${snapGrid ? 'text-indigo-500' : ''}`} title="网格吸附" onClick={toggleSnapGrid}><Magnet size={16} /></button>
    </div>
  )
}
