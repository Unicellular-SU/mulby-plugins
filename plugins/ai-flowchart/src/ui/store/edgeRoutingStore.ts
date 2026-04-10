/**
 * 边路由全局协调 store
 *
 * 作用：
 * 1. 各 SmartEdge 组件路由完成后注册路径到此处
 * 2. 使用 debounced separateParallelEdges 做批量并行边分离
 * 3. 分离后的路径供 SmartEdge 查询使用
 *
 * 过期检测由 SmartEdge 的 ref 机制负责，store 只负责数据存储和分离计算。
 */
import { create } from 'zustand'
import type { EdgeLayout } from '../layout/edge/routing'
import { separateParallelEdges } from '../layout/edge/edgeSeparation'

interface EdgeRoutingState {
  /** 各边注册的原始路由结果 */
  rawLayouts: Map<string, EdgeLayout>
  /** 分离后的路由结果 */
  separatedLayouts: Map<string, EdgeLayout>
  /** 版本号（每次分离完成后递增，触发订阅者重渲染） */
  version: number
  /** 注册边的路由结果 */
  registerEdgePath: (edgeId: string, layout: EdgeLayout) => void
  /** 注销边（边删除时调用） */
  unregisterEdgePath: (edgeId: string) => void
  /** 清空所有缓存 */
  clear: () => void
}

/** 分离计算的延迟时间（毫秒） */
const SEPARATION_DELAY = 150

let separationTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 触发延迟的并行边分离计算
 */
function scheduleSeparation(store: { getState: () => EdgeRoutingState; setState: (s: Partial<EdgeRoutingState>) => void }) {
  if (separationTimer) clearTimeout(separationTimer)
  separationTimer = setTimeout(() => {
    separationTimer = null
    const { rawLayouts, version } = store.getState()
    if (rawLayouts.size <= 1) {
      store.setState({ separatedLayouts: new Map(), version: version + 1 })
      return
    }
    const separated = separateParallelEdges(rawLayouts)
    store.setState({ separatedLayouts: separated, version: version + 1 })
  }, SEPARATION_DELAY)
}

export const useEdgeRoutingStore = create<EdgeRoutingState>((set, get, store) => ({
  rawLayouts: new Map(),
  separatedLayouts: new Map(),
  version: 0,

  registerEdgePath: (edgeId, layout) => {
    const { rawLayouts } = get()
    const newMap = new Map(rawLayouts)
    newMap.set(edgeId, layout)
    set({ rawLayouts: newMap })
    scheduleSeparation(store)
  },

  unregisterEdgePath: (edgeId) => {
    const { rawLayouts } = get()
    if (!rawLayouts.has(edgeId)) return
    const newMap = new Map(rawLayouts)
    newMap.delete(edgeId)
    set({ rawLayouts: newMap })
    scheduleSeparation(store)
  },

  clear: () => {
    if (separationTimer) clearTimeout(separationTimer)
    set({ rawLayouts: new Map(), separatedLayouts: new Map(), version: 0 })
  },
}))
