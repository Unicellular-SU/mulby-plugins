export interface LegacyImageEditInput {
  model: string
  imageAttachmentId: string
  prompt: string
  referenceAttachmentIds?: string[]
  size?: string
  aspectRatio?: string
  maskAttachmentId?: string
  requestId?: string
}

export interface LegacyImageEditResult {
  images: string[]
  tokens: unknown
}

interface ImageProviderDescription {
  capabilities?: {
    operations?: string[]
    input?: { supportsMask?: boolean }
  }
}

export interface ImageEditApi {
  edit(input: LegacyImageEditInput): Promise<LegacyImageEditResult>
  providers?: {
    describe(input: { model?: string; providerId?: string }): Promise<ImageProviderDescription>
  }
}

export type ImageEditMode = 'native-mask' | 'composite-fallback' | 'plain-edit'

/**
 * 当前宿主会把带 maskAttachmentId 的 legacy images.edit 规范化为 inpaint，并严格校验 Profile 能力。
 * 对不支持 mask/inpaint 的模型，调用方传入的主图本身已经包含透明洞/绿幕标记，因此可安全降级为普通 edit。
 *
 * 为避免可能计费的重复提交：
 * 1. 优先只读 describe 能力后一次性选择路径；
 * 2. describe 不可用时，仅对宿主明确标记为 validate + billed=no 的能力错误重试。
 */
export async function editImageWithMaskCompatibility(
  images: ImageEditApi,
  input: LegacyImageEditInput
): Promise<{ result: LegacyImageEditResult; mode: ImageEditMode }> {
  if (!input.maskAttachmentId) {
    return { result: await images.edit(input), mode: 'plain-edit' }
  }

  let nativeMask: boolean | null = null
  try {
    const description = await images.providers?.describe({ model: input.model })
    const operations = description?.capabilities?.operations
    const supportsMask = description?.capabilities?.input?.supportsMask
    if (Array.isArray(operations) && typeof supportsMask === 'boolean') {
      nativeMask = supportsMask && operations.includes('inpaint')
    }
  } catch {
    // 老宿主或只读能力查询不可用：走 legacy 调用，再按结构化的预提交错误决定是否降级。
  }

  if (nativeMask === false) {
    const { maskAttachmentId: _mask, ...fallback } = input
    void _mask
    return { result: await images.edit(fallback), mode: 'composite-fallback' }
  }

  try {
    return { result: await images.edit(input), mode: 'native-mask' }
  } catch (error) {
    const detail = error && typeof error === 'object' ? error as Record<string, unknown> : {}
    const capabilityError = detail.code === 'unsupported_operation' || detail.code === 'unsupported_parameter'
    // 宿主图片错误契约：validate + billed=no 明确证明请求未到 Provider，可无计费风险地降级一次。
    if (!capabilityError || detail.phase !== 'validate' || detail.billed !== 'no') throw error
    const { maskAttachmentId: _mask, ...fallback } = input
    void _mask
    return { result: await images.edit(fallback), mode: 'composite-fallback' }
  }
}
