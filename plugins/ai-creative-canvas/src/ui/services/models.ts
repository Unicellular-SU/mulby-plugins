function ai(): any {
  return (window as any).mulby?.ai
}

export interface ModelOption {
  id: string
  label: string
  provider?: string
}

function toOption(m: any): ModelOption {
  return { id: m.id, label: m.label || m.id, provider: m.providerLabel }
}

export async function listImageModels(): Promise<ModelOption[]> {
  try {
    const all: any[] = await ai().allModels()
    return all
      .filter(
        (m) =>
          m.endpointType === 'image-generation' ||
          (Array.isArray(m.supportedEndpointTypes) && m.supportedEndpointTypes.includes('image-generation'))
      )
      .map(toOption)
  } catch {
    return []
  }
}

export async function listTextModels(): Promise<ModelOption[]> {
  try {
    const all: any[] = await ai().allModels()
    return all
      .filter((m) => m.endpointType !== 'image-generation' && m.endpointType !== 'jina-rerank')
      .map(toOption)
  } catch {
    return []
  }
}

// 默认模型解析：卡片显式 > 工程默认（须在该类型可用列表内）> 列表第一个
export async function resolveModelId(
  kind: 'image' | 'text',
  explicit: string | null,
  globalDefault: string | null
): Promise<string | null> {
  if (explicit) return explicit
  const models = kind === 'image' ? await listImageModels() : await listTextModels()
  if (globalDefault && models.some((m) => m.id === globalDefault)) return globalDefault
  return models[0]?.id ?? null
}
