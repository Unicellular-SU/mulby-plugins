import { useState, useEffect } from 'react'
import { useMulby } from './useMulby'

export interface ImageModel {
  id: string
  label?: string
}

/**
 * 只拉取端点类型为 image-generation 的模型。
 * 依赖 Mulby allModels({ endpointType: 'image-generation' }) 过滤器。
 */
export function useImageModels() {
  const [models, setModels] = useState<ImageModel[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const mulby = useMulby('mulby-ai-image')
  const ai = mulby?.ai

  useEffect(() => {
    if (!ai) return
    setLoading(true)
    ai.allModels({ endpointType: 'image-generation' })
      .then((m: ImageModel[]) => {
        setModels(m)
        if (m.length > 0) setSelectedModel(m[0].id)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [ai])

  return { models, selectedModel, setSelectedModel, loading }
}
