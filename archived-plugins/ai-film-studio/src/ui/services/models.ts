/**
 * 文本模型列表：复用 Mulby 宿主已配置的 Provider/模型（零配置）。
 * 过滤掉图像生成 / rerank 端点，保留可用于文本生成的模型。
 */

const EXCLUDED_ENDPOINTS = new Set(['image-generation', 'jina-rerank'])

async function allModels(): Promise<AiModel[]> {
  try {
    const all = await window.mulby?.ai?.allModels?.()
    return Array.isArray(all) ? all : []
  } catch {
    return []
  }
}

export async function listTextModels(): Promise<AiModel[]> {
  const all = await allModels()
  return all.filter((m) => !m.endpointType || !EXCLUDED_ENDPOINTS.has(m.endpointType))
}

export async function listImageModels(): Promise<AiModel[]> {
  const all = await allModels()
  return all.filter((m) => m.endpointType === 'image-generation')
}
