import { X } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'

interface Props {
  open: boolean
  onClose: () => void
}

const ASPECTS: { value: string; label: string }[] = [
  { value: '16:9', label: '16:9（横屏）' },
  { value: '9:16', label: '9:16（竖屏）' },
  { value: '1:1', label: '1:1（方形）' },
]

/** 项目级全局设定：画风/画幅自动注入所有生成节点，画幅决定图像/视频尺寸（M7） */
export default function GlobalSettings({ open, onClose }: Props) {
  const globals = useGraphStore((s) => s.globals)
  const setGlobals = useGraphStore((s) => s.setGlobals)
  if (!open) return null

  return (
    <div className="afs-modal" onClick={onClose}>
      <div className="afs-modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="afs-modal__head">
          <span className="afs-modal__title">全局设定</span>
          <button className="afs-modal__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="afs-modal__body">
          <div className="afs-modal__hint">
            画风与画幅会自动注入所有生成节点（角色 / 场景 / 关键帧 / 视频），并决定图像/视频尺寸，保证跨镜一致。无需在画布上连线。
          </div>

          <div className="afs-field">
            <label className="afs-field__label">画幅</label>
            <select
              className="afs-field__input"
              value={globals.aspectRatio}
              onChange={(e) => setGlobals({ aspectRatio: e.target.value })}
            >
              {ASPECTS.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="afs-field">
            <label className="afs-field__label">全局画风</label>
            <textarea
              className="afs-field__input"
              rows={3}
              placeholder="如：电影感、赛博朋克、吉卜力水彩、写实 3D 渲染…（用于所有图像/视频生成）"
              value={globals.style}
              onChange={(e) => setGlobals({ style: e.target.value })}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
