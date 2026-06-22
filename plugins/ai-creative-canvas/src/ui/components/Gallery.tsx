import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { Modal } from './Modal'

interface Item {
  boardId: string
  boardName: string
  cardId: string
  url: string
  kind: string
  title: string
}

// 作品库：扫描全工程卡片产物成网格；点击回画布定位、双击预览
export function Gallery() {
  const show = useUi((s) => s.showGallery)
  const project = useGraph((s) => s.project)
  if (!show) return null

  const items: Item[] = []
  for (const b of project.boards) {
    for (const c of Object.values(b.cards)) {
      if (c.assetUrl && (c.kind === 'image' || c.kind === 'video' || c.kind === 'source')) {
        items.push({ boardId: b.id, boardName: b.name, cardId: c.id, url: c.assetUrl, kind: c.kind, title: c.title || '未命名' })
      }
    }
  }
  const close = () => useUi.getState().setShowGallery(false)

  const focus = (it: Item) => {
    const g = useGraph.getState()
    if (g.project.activeBoardId !== it.boardId) g.setActiveBoard(it.boardId)
    g.setSelection([it.cardId])
    const b = g.getActiveBoard()
    const c = b.cards[it.cardId]
    if (c) {
      const ss = useUi.getState().stageSize
      const zoom = b.viewport.zoom
      g.setViewport({ zoom, x: ss.w / 2 - (c.x + c.w / 2) * zoom, y: ss.h / 2 - (c.y + c.h / 2) * zoom })
    }
    close()
  }
  const preview = (it: Item) => useUi.getState().setPreview({ url: it.url, kind: it.kind === 'video' ? 'video' : 'image' })

  return (
    <Modal title={`作品库（${items.length}）`} width={760} onClose={close}>
      {items.length === 0 ? (
        <div className="p-10 text-center text-sm opacity-50">还没有生成或导入的媒体</div>
      ) : (
        <div className="p-3 grid grid-cols-4 gap-2 max-h-[64vh] overflow-auto ace-scroll">
          {items.map((it) => (
            <button
              key={it.cardId}
              onClick={() => focus(it)}
              onDoubleClick={() => preview(it)}
              title={`${it.title} · ${it.boardName}（单击定位 / 双击预览）`}
              className="group relative aspect-square rounded-lg overflow-hidden border bg-black/5 dark:bg-white/5"
              style={{ borderColor: 'var(--ace-border)' }}
            >
              {it.kind === 'video' ? (
                <video src={it.url} muted preload="metadata" className="w-full h-full object-cover" />
              ) : (
                <img src={it.url} className="w-full h-full object-cover" draggable={false} alt="" />
              )}
              <span className="absolute bottom-0 inset-x-0 text-[10px] text-white bg-black/55 truncate px-1 py-0.5">{it.title}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}
