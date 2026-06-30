import { useState } from 'react'
import { Sparkles, Loader2, RotateCcw } from 'lucide-react'
import { useGraphStore } from '../store/graphStore'
import { optimizeFieldText } from '../services/fieldOptimize'
import IconButton from './ui/IconButton'

/** 可 AI 优化的文本输入：右下角「AI 优化」按钮按节点特点优化输入、替换原文，可撤回 */
export function OptimizableField({
  nodeId,
  paramKey,
  value,
  control,
  placeholder,
  guide,
}: {
  nodeId: string
  paramKey: string
  value: string
  control: 'text' | 'textarea'
  placeholder?: string
  guide: string
}) {
  const update = useGraphStore((s) => s.updateNodeParam)
  const model = useGraphStore((s) => s.selectedModel)
  const [busy, setBusy] = useState(false)
  const [undoVal, setUndoVal] = useState<string | null>(null)
  const cur = String(value ?? '')

  const onChange = (v: string) => {
    update(nodeId, paramKey, v)
    if (undoVal != null) setUndoVal(null) // 用户手改后撤回点失效
  }

  const onOptimize = async () => {
    if (busy || !cur.trim()) return
    if (!model) {
      window.mulby?.notification?.show('未配置文本模型（请在顶栏选择）', 'error')
      return
    }
    setBusy(true)
    try {
      const out = await optimizeFieldText(guide, cur, model)
      if (out && out !== cur) {
        setUndoVal(cur)
        update(nodeId, paramKey, out)
      }
    } catch (e) {
      window.mulby?.notification?.show('AI 优化失败：' + (e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  const onUndo = () => {
    if (undoVal == null) return
    update(nodeId, paramKey, undoVal)
    setUndoVal(null)
  }

  return (
    <div className={`afs-optfield afs-optfield--${control}`}>
      {control === 'textarea' ? (
        <textarea
          className="afs-field__input afs-optfield__input"
          rows={4}
          value={cur}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="afs-field__input afs-optfield__input"
          type="text"
          value={cur}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <div className="afs-optfield__actions afs-insp4__optaffix">
        {undoVal != null && (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="撤回上一次优化"
            title="撤回上一次优化"
            icon={<RotateCcw size={14} />}
            onClick={onUndo}
          />
        )}
        <IconButton
          size="sm"
          className="afs-insp4__optai"
          aria-label="AI 优化此输入"
          title="AI 优化此输入（按该节点的特点）"
          disabled={busy || !cur.trim()}
          onClick={onOptimize}
          icon={busy ? <Loader2 size={14} className="afs-spin" /> : <Sparkles size={14} />}
        />
      </div>
    </div>
  )
}
