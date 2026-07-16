import { create } from 'zustand'

// 跨组件交互信号：卡片/分组 resize 由 CardView/GroupView 处理，但 CanvasStage 的虚拟化冻结需要知道
// 「正在 resize」以复用 drag 时的索引冻结（否则每个 pointermove 都 O(N) 重建三个派生集）。
// resize 结束翻 false 时，CanvasStage 因订阅变化重渲，frozen=false → 按最终尺寸重建一次。
interface InteractionState {
  resizing: boolean
  setResizing: (v: boolean) => void
}
export const useInteraction = create<InteractionState>((set) => ({
  resizing: false,
  setResizing: (resizing) => set({ resizing })
}))
