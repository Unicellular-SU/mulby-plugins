/**
 * API Key 安全存储：使用 Mulby 宿主的 storage.encrypted（系统 Keychain / DPAPI 加密，
 * 仅渲染进程，自动按插件隔离）。工程/供应商结构里只存引用键名（providerId），不落明文，
 * 也不做明文回退——加密不可用时由宿主决定，绝不把密钥以明文写入存储。
 * 对齐设计文档 §6.5 / §8.2 / §14。
 */

const keyName = (providerId: string) => `k_${providerId}`

export async function setKey(providerId: string, apiKey: string): Promise<void> {
  try {
    await window.mulby?.storage?.encrypted?.set(keyName(providerId), apiKey)
  } catch {
    // 忽略（加密不可用或存储失败时不落明文）
  }
}

export async function getKey(providerId: string): Promise<string> {
  try {
    const v = await window.mulby?.storage?.encrypted?.get(keyName(providerId))
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

export async function hasKey(providerId: string): Promise<boolean> {
  try {
    return (await window.mulby?.storage?.encrypted?.has(keyName(providerId))) ?? false
  } catch {
    return false
  }
}

export async function removeKey(providerId: string): Promise<void> {
  try {
    await window.mulby?.storage?.encrypted?.remove(keyName(providerId))
  } catch {
    // 忽略
  }
}
