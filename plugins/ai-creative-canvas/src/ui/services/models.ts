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
