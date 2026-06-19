import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ListVideo } from 'lucide-react'
import { useUiStore, type LightboxItem } from '../store/uiStore'
import { useMediaUrl } from '../services/mediaUrl'

/** M32/M33 应用级 Lightbox：看大图、带控件播视频，左右切换 + 键盘导航；多视频时「连看」自动顺播验证镜头衔接 */
export default function LightboxHost() {
  const lb = useUiStore((s) => s.lightbox)
  const close = useUiStore((s) => s.closeLightbox)
  const nav = useUiStore((s) => s.lightboxNav)
  const [autoplay, setAutoplay] = useState(true) // M33：连看——视频播完自动切下一个

  useEffect(() => {
    if (!lb) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') nav(-1)
      else if (e.key === 'ArrowRight') nav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lb, close, nav])

  if (!lb) return null
  const multi = lb.items.length > 1
  const hasVideo = lb.items.some((it) => it.type === 'video')
  // 末项播完不绕回（避免连看无限循环）；中间项播完进下一个
  const onVideoEnded = () => {
    if (autoplay && multi && lb.index < lb.items.length - 1) nav(1)
  }
  return (
    <div className="afs-lbhost" onClick={close}>
      <button className="afs-lbhost__close" onClick={close} title="关闭 (Esc)">
        <X size={20} />
      </button>
      {multi && hasVideo && (
        <button
          className={`afs-lbhost__toggle${autoplay ? ' is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setAutoplay((v) => !v)
          }}
          title={autoplay ? '连看中：视频播完自动放下一段（点击关闭）' : '开启连看：按顺序连续播放所有片段'}
        >
          <ListVideo size={15} /> {autoplay ? '连看中' : '连看'}
        </button>
      )}
      {multi && (
        <>
          <button
            className="afs-lbhost__nav afs-lbhost__nav--prev"
            onClick={(e) => {
              e.stopPropagation()
              nav(-1)
            }}
            title="上一个 (←)"
          >
            <ChevronLeft size={30} />
          </button>
          <button
            className="afs-lbhost__nav afs-lbhost__nav--next"
            onClick={(e) => {
              e.stopPropagation()
              nav(1)
            }}
            title="下一个 (→)"
          >
            <ChevronRight size={30} />
          </button>
        </>
      )}
      <div className="afs-lbhost__stage" onClick={(e) => e.stopPropagation()}>
        <LightboxMedia key={lb.index} item={lb.items[lb.index]} autoplay={autoplay} onEnded={onVideoEnded} />
      </div>
      {multi && (
        <div className="afs-lbhost__count">
          {lb.index + 1} / {lb.items.length}
        </div>
      )}
    </div>
  )
}

function LightboxMedia({ item, autoplay, onEnded }: { item: LightboxItem; autoplay: boolean; onEnded: () => void }) {
  const url = useMediaUrl(item.ref)
  if (!url) return <div className="afs-lbhost__loading">加载中…</div>
  return item.type === 'video' ? (
    // 连看时不 loop、播完触发 onEnded 切下一段；单看时 loop 循环
    <video className="afs-lbhost__media" src={url} controls autoPlay playsInline loop={!autoplay} onEnded={autoplay ? onEnded : undefined} />
  ) : (
    <img className="afs-lbhost__media" src={url} alt="" />
  )
}
