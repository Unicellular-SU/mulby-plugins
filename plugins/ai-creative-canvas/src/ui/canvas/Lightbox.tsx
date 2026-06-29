import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUi } from '../store/uiStore'
import { Z } from '../zlayers'

export function Lightbox() {
  const preview = useUi((s) => s.preview)
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.getState().setPreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  if (!preview) return null
  const close = () => useUi.getState().setPreview(null)

  return (
    <div data-interactive className={`fixed inset-0 ${Z.panel} bg-black/80 flex items-center justify-center p-8`} onClick={close}>
      <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={close} title="关闭 (Esc)">
        <X size={26} />
      </button>
      {preview.kind === 'video' ? (
        <video src={preview.url} controls autoPlay className="max-w-[92vw] max-h-[92vh] rounded-lg" onClick={(e) => e.stopPropagation()} />
      ) : (
        <img src={preview.url} className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} alt="" />
      )}
    </div>
  )
}
