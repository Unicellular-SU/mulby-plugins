import { useState } from 'react'
import { ZoomIn, ZoomOut, Maximize, Undo2, Redo2, Grid3x3, Map as MapIcon, Magnet } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { clampZoom } from './viewport'

export function CanvasControls({ onFit }: { onFit: () => void }) {
  const board = useGraph((s) => s.getActiveBoard())
  const setViewport = useGraph((s) => s.setViewport)
  const undo = useGraph((s) => s.undo)
  const redo = useGraph((s) => s.redo)
  const canUndo = useGraph((s) => (s.boardHistories[s.project.activeBoardId]?.past.length ?? 0) > 0)
  const canRedo = useGraph((s) => (s.boardHistories[s.project.activeBoardId]?.future.length ?? 0) > 0)
  const showGrid = useUi((s) => s.showGrid)
  const toggleGrid = useUi((s) => s.toggleGrid)
  const showMinimap = useUi((s) => s.showMinimap)
  const toggleMinimap = useUi((s) => s.toggleMinimap)
  const snapGrid = useUi((s) => s.snapGrid)
  const toggleSnapGrid = useUi((s) => s.toggleSnapGrid)
  const vp = board.viewport
  const [zoomMenu, setZoomMenu] = useState(false)

  const zoomBy = (factor: number) => {
    // 朝画布中心缩放（近似：用当前视口中点）
    const z = clampZoom(vp.zoom * factor)
    setViewport({ ...vp, zoom: z })
  }
  // 设为绝对缩放档位，保持视口中心世界点不动
  const setZoom = (z: number) => {
    const ss = useUi.getState().stageSize
    const nz = clampZoom(z)
    const cw = (ss.w / 2 - vp.x) / vp.zoom
    const ch = (ss.h / 2 - vp.y) / vp.zoom
    setViewport({ zoom: nz, x: ss.w / 2 - cw * nz, y: ss.h / 2 - ch * nz })
  }

  const btn = 'h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed'

  return (
    <div data-interactive className="ace-glass absolute bottom-3 left-3 flex items-center gap-1 px-1.5 py-1">
      <button className={btn} data-tip="撤销 (Ctrl+Z)" onClick={undo} disabled={!canUndo}><Undo2 size={16} /></button>
      <button className={btn} data-tip="重做 (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo}><Redo2 size={16} /></button>
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      <button className={btn} data-tip="缩小" onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={16} /></button>
      <div className="relative">
        <button className="px-1.5 text-xs tabular-nums min-w-[3rem] text-center hover:bg-black/5 dark:hover:bg-white/10 rounded-md h-8" data-tip="缩放档位" onClick={() => setZoomMenu((v) => !v)}>
          {Math.round(vp.zoom * 100)}%
        </button>
        {zoomMenu && (
          <>
            <div className="fixed inset-0 z-40" onPointerDown={() => setZoomMenu(false)} />
            <div className="ace-menu ace-anim-pop absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-50 py-1 min-w-[4.5rem]">
              {[0.25, 0.5, 1, 2].map((z) => (
                <button
                  key={z}
                  onClick={() => {
                    setZoom(z)
                    setZoomMenu(false)
                  }}
                  className={`w-full px-3 py-1 text-xs text-center hover:bg-black/5 dark:hover:bg-white/10 ${Math.abs(vp.zoom - z) < 0.01 ? 'text-indigo-500 font-medium' : ''}`}
                >
                  {z * 100}%
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <button className={btn} data-tip="放大" onClick={() => zoomBy(1.2)}><ZoomIn size={16} /></button>
      <button className={btn} data-tip="适配内容 (F)" onClick={onFit}><Maximize size={16} /></button>
      <div className="w-px h-5 bg-current opacity-10 mx-0.5" />
      <button className={`${btn} ${showGrid ? 'text-indigo-500' : ''}`} data-tip="网格" onClick={toggleGrid}><Grid3x3 size={16} /></button>
      <button className={`${btn} ${showMinimap ? 'text-indigo-500' : ''}`} data-tip="小地图 (M)" onClick={toggleMinimap}><MapIcon size={16} /></button>
      <button className={`${btn} ${snapGrid ? 'text-indigo-500' : ''}`} data-tip="网格吸附" onClick={toggleSnapGrid}><Magnet size={16} /></button>
    </div>
  )
}
