import { X } from 'lucide-react'
import GlobalSettings from './GlobalSettings'
import { useGraphStore } from '../store/graphStore'

/** 项目风格弹窗（画风 / 画幅）：绑定当前工程，从编辑器顶栏打开。 */
export default function ProjectStylePanel({ onClose }: { onClose: () => void }) {
  const projectName = useGraphStore((s) => s.projectName)
  return (
    <div className="afs-lightbox" onClick={onClose}>
      <div className="afs-elform afs-elform--style" onClick={(e) => e.stopPropagation()}>
        <div className="afs-elform__head">
          <span>项目风格 · {projectName}</span>
          <button className="afs-lightbox__close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <GlobalSettings />
      </div>
    </div>
  )
}
