import { useGraph } from './store/graphStore'
import { useUi } from './store/uiStore'

// 定位到指定卡片：切到其所属画布 → 选中 → 视口居中。任务中心 / 作品库共用，
// 确保跨画布的定位不再「只改选中态」而看不到卡片。
export function focusCard(boardId: string, cardId: string): void {
  const g = useGraph.getState()
  if (g.project.activeBoardId !== boardId) g.setActiveBoard(boardId)
  g.setSelection([cardId])
  const b = g.getActiveBoard()
  const c = b.cards[cardId]
  if (!c) return
  const ss = useUi.getState().stageSize
  const zoom = b.viewport.zoom
  g.setViewport({ zoom, x: ss.w / 2 - (c.x + c.w / 2) * zoom, y: ss.h / 2 - (c.y + c.h / 2) * zoom })
}
