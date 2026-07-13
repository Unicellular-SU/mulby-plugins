import { Music, Maximize2 } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { Modal } from './Modal'
import { Empty } from './ui'
import { focusCard } from '../focusCard'

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
      // 排除生成中的卡：流式生成期 assetUrl 存的是半成品预览 dataURL，不是成品。
      // 用「非 running/queued」而非「== done」——保留 idle 的导入素材卡(source)。纳入 audio(TTS/配音成品)。
      const generating = c.status === 'running' || c.status === 'queued'
      if (!generating && c.assetUrl && (c.kind === 'image' || c.kind === 'video' || c.kind === 'source' || c.kind === 'audio')) {
        items.push({ boardId: b.id, boardName: b.name, cardId: c.id, url: c.assetUrl, kind: c.kind, title: c.title || '未命名' })
      }
    }
  }
  const close = () => useUi.getState().setShowGallery(false)

  const focus = (it: Item) => {
    focusCard(it.boardId, it.cardId)
    close()
  }
  const preview = (it: Item) => {
    if (it.kind === 'audio') { focus(it); return } // 音频无 Lightbox，双击直接跳到卡片播放
    useUi.getState().setPreview({ url: it.url, kind: it.kind === 'video' ? 'video' : 'image' })
  }

  return (
    <Modal title={`作品库（${items.length}）`} width={760} onClose={close}>
      {items.length === 0 ? (
        <Empty text="还没有生成或导入的媒体" />
      ) : (
        <div className="p-3 grid grid-cols-4 gap-2 max-h-[64vh] overflow-auto ace-scroll">
          {items.map((it) => (
            // 单击=定位跳卡（会关闭作品库）；预览走右上角悬停按钮（独立入口）——此前 onClick 先 close 致 dblclick 永不触发
            <div
              key={it.cardId}
              role="button"
              tabIndex={0}
              onClick={() => focus(it)}
              onKeyDown={(e) => { if (e.key === 'Enter') focus(it) }}
              title={`${it.title} · ${it.boardName}（点击定位；右上角放大预览）`}
              className="group relative aspect-square rounded-lg overflow-hidden border bg-black/5 dark:bg-white/5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              style={{ borderColor: 'var(--ace-border)' }}
            >
              {it.kind === 'video' ? (
                <video src={it.url} muted preload="metadata" className="w-full h-full object-cover" />
              ) : it.kind === 'audio' ? (
                <div className="w-full h-full grid place-items-center text-neutral-400 dark:text-neutral-500"><Music size={28} /></div>
              ) : (
                <img src={it.url} className="w-full h-full object-cover" draggable={false} alt="" />
              )}
              {it.kind !== 'audio' && (
                <button
                  onClick={(e) => { e.stopPropagation(); preview(it) }}
                  title="预览"
                  className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-md bg-black/55 text-white opacity-0 group-hover:opacity-100 hover:bg-black/75 transition-opacity"
                >
                  <Maximize2 size={13} />
                </button>
              )}
              <span className="absolute bottom-0 inset-x-0 text-[10px] text-white bg-black/55 truncate px-1 py-0.5 pointer-events-none">{it.title}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
