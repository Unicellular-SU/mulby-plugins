import { useEffect, useRef, useState } from 'react'
import { listImageModels, listTextModels, type ModelOption } from '../services/models'
import { Select, type SelectOption } from './Select'
import { useGraph } from '../store/graphStore'

export function ModelPicker({
  kind,
  value,
  onChange
}: {
  kind: 'text' | 'image'
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(true)
  const autoPicked = useRef(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const p = kind === 'image' ? listImageModels() : listTextModels()
    p.then((m) => {
      if (!alive) return
      setModels(m)
      setLoading(false)
      if (kind === 'image' && !value && !autoPicked.current && m.length > 0) {
        autoPicked.current = true
        const def = useGraph.getState().project.defaultImageModel
        onChange(def && m.some((x) => x.id === def) ? def : m[0].id)
      }
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  const opts: SelectOption[] = [
    { value: '', label: loading ? '加载模型…' : kind === 'image' ? '（选择图像模型）' : '默认文本模型' },
    ...models.map((m) => ({ value: m.id, label: m.label, hint: m.provider }))
  ]

  return (
    <div className="flex flex-col gap-1">
      <Select value={value || ''} options={opts} onChange={(v) => onChange(v || null)} />
      {!loading && kind === 'image' && models.length === 0 && (
        <span className="text-[11px] text-amber-500">未检测到图像模型，请在 Mulby「AI 设置 → 模型管理」配置 image-generation 模型。</span>
      )}
    </div>
  )
}
