import type { Board, Card } from '../types'
import { resolveGenerationPrompt } from './references'
import { loadImageInput, toFileUrl } from './media'
import { useGraph } from '../store/graphStore'
import { getStylePack, applyStylePack } from './stylePacks'
import { toast } from '../store/toastStore'
import { PLUGIN_ID } from './persistence'
import { isLegacyImageResultTooLarge } from '../../backendGuards'

function ai() {
  return window.mulby.ai
}

// 参考 ai-film-studio：比例 → 尺寸（短边 ≥720，宿主原样转发给 provider）
const BASE_SIZE: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '2:1': [1440, 720] // 360 全景（等距柱状）基准
}

// 360 全景提示词（GPT Image 2 社区公认模板）：明确等距柱状(cylindrical equidistant)、2:1、
// 球形 VR 环绕、左右无缝、光照一致、地平线居中、禁鱼眼/小行星。场景描述来自 card.prompt（前置）。
function panoHint(): string {
  return (
    '\n\n360-degree equirectangular panorama, spherical panorama for VR viewing, equirectangular (cylindrical equidistant projection), 2:1 aspect ratio, ' +
    'a seamless 360° wrap-around environment that renders correctly in a 360 VR viewer, the left and right edges connect seamlessly, ' +
    'consistent lighting across the full 360-degree field of view, horizon centered, no fisheye, no tiny planet effect, no visible stitching seam.'
  )
}

function computeSize(aspect: string, resolution: string): string {
  let w = 1024
  let h = 1024
  if (BASE_SIZE[aspect]) {
    ;[w, h] = BASE_SIZE[aspect]
  } else {
    // 任意 W:H 通用解析：短边基准 720，长边按比例
    const m = /^(\d+):(\d+)$/.exec(aspect)
    if (m) {
      const aw = Number(m[1])
      const ah = Number(m[2])
      const S = 720
      if (aw >= ah) {
        h = S
        w = Math.round((S * aw) / ah)
      } else {
        w = S
        h = Math.round((S * ah) / aw)
      }
    }
  }
  const scale = resolution === '4K' ? 3 : resolution === '2K' ? 2 : 1
  const r64 = (n: number) => Math.max(64, Math.round((n * scale) / 64) * 64)
  return `${r64(w)}x${r64(h)}`
}
// 关键：把画幅写进提示词——很多图像模型忽略 size、只认提示词里的比例（ai-film-studio 同款做法）
function aspectHint(aspect: string): string {
  const m = /^(\d+):(\d+)$/.exec(aspect)
  if (!m) return ''
  const aw = Number(m[1])
  const ah = Number(m[2])
  const ori = aw > ah ? '横向 landscape' : aw < ah ? '竖向 portrait' : '方形 square'
  return `\n\n【画幅比例 ${aspect}，${ori}】`
}
// 风格包（项目级）注入所有图像提示词；自由画风作为补充叠加
function styleHint(board: Board): string {
  const g = useGraph.getState()
  const proj = g.project
  const pack = getStylePack(board.stylePackId ?? proj.stylePackId) // 画布级优先
  const freeStyle = board.style ?? proj.style
  const parts: string[] = []
  if (pack) parts.push(applyStylePack(pack, 'keyframe'))
  if (freeStyle && freeStyle.trim()) parts.push(freeStyle.trim())
  return parts.length ? `\n\n风格：${parts.join(', ')}` : ''
}

export interface ImageGenResult {
  outputs: Array<{ base64?: string; localPath?: string; url?: string; mime: string }>
  trace: ImageGenerationTrace
}

export interface ImageGenerationTrace {
  modelId: string
  providerId?: string
  profileId?: string
  profileVersion?: string
  requestIds: string[]
  taskIds: string[]
  sentPrompt: string
  promptSource: 'local' | 'upstream' | 'mentions' | 'combined' | 'empty'
  protocolWarnings: string[]
  startedAt: number
}

type ImageApiWithDiagnostics = ReturnType<typeof ai>['images'] & {
  providers?: {
    describe(input: { providerId?: string; model?: string }): Promise<{
      providerId?: string
      profile?: { id?: string; version?: string }
      warnings?: Array<{ message?: string }>
      resolution?: { unresolvedReasons?: string[] }
    }>
  }
  tasks?: {
    list(input?: { clientTag?: string; limit?: number }): Promise<{ tasks?: Array<{ taskId?: string }> }>
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => !!value))]
}

function requestIdFor(cardId: string): string {
  return `ace-${cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function imageProviderTrace(model: string): Promise<Pick<ImageGenerationTrace, 'providerId' | 'profileId' | 'profileVersion' | 'protocolWarnings'>> {
  const api = ai().images as ImageApiWithDiagnostics
  const fallbackProviderId = model.includes(':') ? model.split(':', 1)[0] : undefined
  try {
    const description = await api.providers?.describe({ model })
    const warningMessages = description?.warnings?.map((warning) => warning.message).filter((message): message is string => !!message) || []
    const resolutionWarnings = description?.resolution?.unresolvedReasons?.map((reason) => `协议解析：${reason}`) || []
    return {
      providerId: description?.providerId || fallbackProviderId,
      profileId: description?.profile?.id,
      profileVersion: description?.profile?.version,
      protocolWarnings: unique([...warningMessages, ...resolutionWarnings])
    }
  } catch {
    return { providerId: fallbackProviderId, protocolWarnings: [] }
  }
}

async function taskIdsFor(requestIds: string[]): Promise<string[]> {
  const tasks = (ai().images as ImageApiWithDiagnostics).tasks
  if (!tasks) return []
  const ids: Array<string | undefined> = []
  for (const clientTag of unique(requestIds)) {
    try {
      const page = await tasks.list({ clientTag, limit: 1 })
      ids.push(page.tasks?.[0]?.taskId)
    } catch {
      // 老版本宿主没有持久任务查询能力时仍正常返回图片，只缺少诊断 ID。
    }
  }
  return unique(ids)
}

type ImageOperationError = Error & { code?: string; taskId?: string }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * 兼容 contextBridge 丢失 Error 自定义字段：用 facade 写入任务的 clientTag 反查 taskId。
 * 错误事件与任务索引之间可能有极短延迟，因此做一次有界重试。
 */
async function taskIdForClientTag(clientTag: string): Promise<string> {
  const tasks = (ai().images as ImageApiWithDiagnostics).tasks
  if (!tasks || !clientTag) return ''
  for (const waitMs of [0, 100, 300, 700]) {
    if (waitMs) await delay(waitMs)
    try {
      const page = await tasks.list({ clientTag, limit: 1 })
      const taskId = page.tasks?.[0]?.taskId
      if (typeof taskId === 'string' && taskId.trim()) return taskId.trim()
    } catch {
      // 查询可能暂时不可用；继续有限重试，最后给出可理解的恢复错误。
    }
  }
  return ''
}

/**
 * Mulby 新图片任务已把完整产物落盘；旧 generate/edit facade 只是在把大图转回 Base64 时失败。
 * 用 owner 隔离的 taskId 让插件后端核验并复制同一产物，不重新请求模型、不产生二次计费。
 */
async function recoverOversizedLegacyResult(
  error: unknown,
  clientTag: string,
  projectId: string,
  cardId: string
): Promise<{ taskId: string; outputs: Array<{ localPath: string; url: string; mime: string }> } | null> {
  const operationError = error as ImageOperationError
  if (!isLegacyImageResultTooLarge(error)) return null
  const directTaskId = typeof operationError?.taskId === 'string' ? operationError.taskId.trim() : ''
  const taskId = directTaskId || await taskIdForClientTag(clientTag)
  if (!taskId) throw new Error('4K 图片已生成，但宿主未返回可恢复的任务 ID；请升级 Mulby 后重试')
  const host = window.mulby?.host
  if (!host?.call) throw new Error('4K 图片已生成，但当前 Mulby 后端桥接不可用')
  const result = await host.call(PLUGIN_ID, 'importAiImageTaskArtifacts', { taskId, projectId, cardId }) as {
    data?: {
      ok?: boolean
      items?: Array<{ path?: string; mime?: string; size?: number }>
      error?: string
    }
  }
  const items = result?.data?.ok === true && Array.isArray(result.data.items)
    ? result.data.items.filter((item): item is { path: string; mime?: string; size?: number } => typeof item?.path === 'string' && !!item.path)
    : []
  if (!items.length) {
    throw new Error(`4K 图片已生成，但保存到工程失败：${result?.data?.error || '未找到任务产物'}`)
  }
  return {
    taskId,
    outputs: items.map((item) => ({
      localPath: item.path,
      url: toFileUrl(item.path),
      mime: item.mime || 'image/png'
    }))
  }
}

export async function generateImage(
  card: Card,
  board: Board,
  onProgress: (p: number, previewDataUrl?: string) => void,
  onRequestId: (id: string) => void
): Promise<ImageGenResult> {
  const params = card.params || {}
  const pano = card.kind === 'pano'
  // 模型优先级：卡片显式所选 > 工程「360 专用模型」>（generateCard 回填的图像默认）
  const panoModel = useGraph.getState().project.defaultPanoModel || null
  const model = card.modelId || (pano ? panoModel : null)
  if (!model) throw new Error('请先选择图像模型（面板内"模型"下拉；或在工程设置里配 360 专用模型）')

  const startedAt = Date.now()
  const providerTrace = await imageProviderTrace(model)
  const resolved = resolveGenerationPrompt(card, board, 'media', useGraph.getState().project)
  const inputs = resolved.inputs
  const aspect = pano ? '2:1' : String(params.aspect || '1:1') // 全景强制等距柱状 2:1
  // 全景看的是 ~60° 一小片（约占贴图宽 1/6），分辨率要够才不糊：至少 2K
  const resolution = pano && ['', '1K'].includes(String(params.resolution || '')) ? '2K' : String(params.resolution || '1K')
  const size = computeSize(aspect, resolution)
  const count = pano ? 1 : Math.max(1, Math.min(4, Number(params.count) || 1)) // 全景单张
  // 图生图全景：显式告知「以参考图场景重构 360 环绕」，纯文字则直接描述场景
  const panoRefLead = pano && inputs.images.length > 0 ? '以参考图片的场景与风格为基础，重构为完整的 360 环绕环境。' : ''
  const prompt = panoRefLead + resolved.text + aspectHint(aspect) + (pano ? panoHint() : '') + styleHint(board)
  const requestIds: string[] = []
  const recoveredTaskIds: string[] = []
  const rememberRequestId = (requestId: string) => {
    if (!requestIds.includes(requestId)) requestIds.push(requestId)
    onRequestId(requestId)
  }

  // 参考图（连入卡片 + 上传素材）→ 附件；首图主图、其余多图参考
  const attIds: string[] = []
  for (const img of inputs.images) {
    const buf = await loadImageInput(img)
    if (!buf) continue
    try {
      const att = await ai().attachments.upload({ buffer: buf, mimeType: img.mime || 'image/png', purpose: 'image' })
      attIds.push(att.attachmentId)
    } catch {
      /* skip */
    }
  }

  const outputs: ImageGenResult['outputs'] = []
  if (attIds.length > 0) {
    onProgress(0.3)
    const requestId = requestIdFor(card.id)
    rememberRequestId(requestId)
    try {
      const res = await ai().images.edit({
        model,
        imageAttachmentId: attIds[0],
        referenceAttachmentIds: attIds.slice(1),
        prompt,
        size,
        aspectRatio: aspect, // 编辑生成同样吃尺寸/画幅（宿主已支持；OpenAI 系消费 size，Gemini 系消费 aspectRatio）
        requestId
      })
      for (const base64 of res.images || []) outputs.push({ base64, mime: 'image/png' })
    } catch (error) {
      const recovered = await recoverOversizedLegacyResult(error, requestId, useGraph.getState().project.id, card.id)
      if (!recovered) throw error
      recoveredTaskIds.push(recovered.taskId)
      outputs.push(...recovered.outputs)
    }
    onProgress(1)
  } else {
    // 多图：逐张以 count=1 调用，避免向不支持 n>1 的模型（如 gpt-image-2）传 n 而报错
    let lastErr: any = null
    for (let k = 0; k < count; k++) {
      let currentRequestId = ''
      try {
        const genReq: { model: string; prompt: string; size?: string; aspectRatio?: string; count?: number; seed?: number } = {
          model,
          prompt,
          size,
          aspectRatio: aspect,
          count: 1
        }
        if (params.seed) genReq.seed = Number(params.seed) + k // 多张时按 k 偏移，既可复现又不重复
        const req = ai().images.generateStream(
          genReq,
          (chunk: any) => {
            if (chunk.__requestId) {
              currentRequestId = chunk.__requestId
              rememberRequestId(chunk.__requestId)
              return
            }
            if (chunk.type === 'preview' && chunk.image) {
              onProgress((k + 0.6) / count, `data:image/png;base64,${chunk.image}`)
            } else if (chunk.type === 'status') {
              const map: Record<string, number> = { start: 0.1, partial: 0.5, finalizing: 0.85, completed: 1 }
              onProgress((k + (map[chunk.stage as string] ?? 0.3)) / count)
            }
          }
        )
        const res = await req
        if (res.images?.length) outputs.push({ base64: res.images[0], mime: 'image/png' })
      } catch (e) {
        try {
          const recovered = await recoverOversizedLegacyResult(e, currentRequestId, useGraph.getState().project.id, `${card.id}_${k}`)
          if (recovered) {
            recoveredTaskIds.push(recovered.taskId)
            outputs.push(...recovered.outputs)
          } else {
            lastErr = e
          }
        } catch (recoveryError) {
          lastErr = recoveryError
        }
      }
    }
    if (!outputs.length && lastErr) throw lastErr
    if (lastErr && outputs.length < count) toast(`部分图片生成失败（成功 ${outputs.length}/${count}）`, 'warning') // 部分成功不再静默
    onProgress(1)
  }

  if (!outputs.length) throw new Error('模型未返回图像')
  const taskIds = unique([...await taskIdsFor(requestIds), ...recoveredTaskIds])
  // 接缝不再做羽化（效果差）——改由「修复接缝」走偏移+生成式重绘（mediaPano.repairEquirectSeam）
  return {
    outputs,
    trace: {
      modelId: model,
      ...providerTrace,
      requestIds: unique(requestIds),
      taskIds,
      sentPrompt: prompt,
      promptSource: resolved.source,
      startedAt
    }
  }
}
