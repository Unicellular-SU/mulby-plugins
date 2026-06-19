// 截图标注插件的「问 AI」服务层。
//
// 把宿主 `mulby.ai` 的多模态能力封装成几个小而可测的助手：动作预设与提示词、
// 把截图（带标注或原图）上传成视觉附件、流式文字调用，以及图生图（AI 修图）。
// 纯函数（动作/提示词/文本提取/模型过滤）便于单测；运行器是 `ai.call` / `ai.images.edit`
// 的薄封装。

// ── 动作预设 ──────────────────────────────────────────────────

export type VisionActionId = 'explain' | 'solve' | 'ocr' | 'translate' | 'edit' | 'custom'

export interface VisionActionMeta {
  id: VisionActionId
  label: string
  /** 选择动作后展示的简短提示。 */
  hint: string
  /** 该动作走图生图（images.edit），输出是图片而非文字。 */
  isImageEdit?: boolean
  /** 暴露目标语言选择器（翻译）。 */
  needsLanguage?: boolean
  /** 暴露自定义指令输入框（自定义提问 / 修图指令）。 */
  needsInstruction?: boolean
}

export const VISION_ACTIONS: VisionActionMeta[] = [
  {
    id: 'explain',
    label: '解释这是什么',
    hint: '描述并解释截图里的内容：报错、界面、图表都适用'
  },
  {
    id: 'solve',
    label: '解题 / 回答',
    hint: '针对截图里的题目或问题给出解答步骤'
  },
  {
    id: 'ocr',
    label: '提取文字',
    hint: '识别截图中的文字并原样输出，便于复制'
  },
  {
    id: 'translate',
    label: '翻译图中文字',
    hint: '识别截图里的文字并翻译成目标语言',
    needsLanguage: true
  },
  {
    id: 'edit',
    label: 'AI 修图',
    hint: '按指令编辑这张图，结果可直接回填到画布继续标注',
    isImageEdit: true,
    needsInstruction: true
  },
  {
    id: 'custom',
    label: '自定义提问',
    hint: '用你自己的问题询问这张截图',
    needsInstruction: true
  }
]

export function getVisionAction(id: VisionActionId): VisionActionMeta {
  return VISION_ACTIONS.find((action) => action.id === id) ?? VISION_ACTIONS[0]
}

export const TRANSLATE_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: '简体中文', label: '简体中文' },
  { value: '英文', label: '英文' },
  { value: '日文', label: '日文' },
  { value: '韩文', label: '韩文' },
  { value: '法文', label: '法文' },
  { value: '德文', label: '德文' },
  { value: '俄文', label: '俄文' },
  { value: '繁体中文', label: '繁体中文' }
]

// ── 提示词构建（纯函数，可单测） ───────────────────────────────

export interface VisionPrompt {
  system: string
  user: string
}

export interface VisionPromptInput {
  action: VisionActionId
  /** 翻译目标语言。 */
  language?: string
  /** 自定义提问 / 修图指令。 */
  instruction?: string
  /** 图中是否带标注（带标注时提示模型关注被圈出的区域）。 */
  annotated?: boolean
}

const ANNOTATED_HINT =
  '图中可能有用户添加的箭头、方框、高亮或编号等标注，它们用来指出需要重点关注的区域，请优先围绕被标注的部分作答。'

/** 构建文字类动作（解释/解题/OCR/翻译/自定义）的 system + user 提示词。 */
export function buildVisionPrompt(input: VisionPromptInput): VisionPrompt {
  const annotatedHint = input.annotated ? `\n${ANNOTATED_HINT}` : ''

  switch (input.action) {
    case 'explain':
      return {
        system: `你是一个看图答疑助手，用简洁清晰的中文解释用户截图里的内容。${annotatedHint}`,
        user: '请解释这张截图里是什么内容、表达了什么意思，必要时补充背景或排查建议。'
      }
    case 'solve':
      return {
        system: `你是一个解题助手。识别截图里的题目或问题，给出清晰的解答与必要的步骤；若是代码报错，请定位原因并给出修复方案。${annotatedHint}`,
        user: '请解答这张截图里的题目或问题，给出过程与最终答案。'
      }
    case 'ocr':
      return {
        system: `你是一个 OCR 文字识别助手。只输出截图中的文字，按原有阅读顺序与分行排版，不要翻译、不要解释、不要添加任何额外说明。若无文字，回复「未识别到文字」。${annotatedHint}`,
        user: '请提取这张截图中的所有文字。'
      }
    case 'translate': {
      const language = (input.language || '简体中文').trim()
      return {
        system: `你是一个看图翻译助手。先识别截图中的文字，再翻译成${language}。只输出译文，保持原有分行结构，不要输出原文、不要解释。${annotatedHint}`,
        user: `请把这张截图里的文字翻译成${language}。`
      }
    }
    case 'custom':
    default: {
      const instruction = (input.instruction || '').trim() || '请描述这张截图。'
      return {
        system: `你是一个看图问答助手，结合截图内容用中文回答用户的问题。${annotatedHint}`,
        user: instruction
      }
    }
  }
}

// ── 文本提取（纯函数，可单测） ─────────────────────────────────

type AiTextPart = { type?: string; text?: string }
type AiContent = string | AiTextPart[] | undefined | null

/** 从 AI 消息的 content 字段里稳健地取出纯文本。 */
export function extractAiText(content: AiContent): string {
  if (!content) {
    return ''
  }
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .filter((part) => part && part.type !== 'image' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

// ── 模型过滤（纯函数，可单测） ─────────────────────────────────

export interface AiModelLike {
  id: string
  label?: string
  endpointType?: string
  supportedEndpointTypes?: string[]
  capabilities?: Array<{ type?: string }>
}

/** 支持视觉输入的模型（capabilities 含 vision）；若一个都没有则退回全部非生图模型。 */
export function filterVisionModels<T extends AiModelLike>(models: T[]): T[] {
  const list = Array.isArray(models) ? models : []
  const vision = list.filter((m) => m.capabilities?.some((c) => c?.type === 'vision'))
  if (vision.length > 0) {
    return vision
  }
  return list.filter(
    (m) => m.endpointType !== 'image-generation' && !m.supportedEndpointTypes?.includes('image-generation')
  )
}

/** 支持图生图的模型（endpointType 或 supportedEndpointTypes 含 image-generation）。 */
export function filterImageEditModels<T extends AiModelLike>(models: T[]): T[] {
  const list = Array.isArray(models) ? models : []
  return list.filter(
    (m) => m.endpointType === 'image-generation' || m.supportedEndpointTypes?.includes('image-generation')
  )
}

// ── dataURL → ArrayBuffer ─────────────────────────────────────

function dataUrlToBuffer(dataUrl: string): { buffer: ArrayBuffer; mimeType: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl)
  const mimeType = match?.[1] || 'image/png'
  const isBase64 = Boolean(match?.[2])
  const payload = match?.[3] ?? ''
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return { buffer: bytes.buffer, mimeType }
}

// ── 运行器 ────────────────────────────────────────────────────

/** 与 mulby.ai 交互所需的最小接口（便于在测试中替换）。 */
export interface VisionAiClient {
  call: (
    option: { model?: string; messages: unknown[]; [key: string]: unknown },
    onChunk?: (chunk: unknown) => void
  ) => Promise<unknown> & { abort?: () => void }
  allModels?: () => Promise<AiModelLike[]>
  attachments?: {
    upload: (input: { buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<{ attachmentId: string; mimeType: string }>
  }
  images?: {
    edit: (input: { model: string; imageAttachmentId: string; prompt: string }) => Promise<{ images: string[] }>
  }
}

/**
 * 把一张 dataURL 截图上传为附件，返回 attachmentId。
 * purpose 默认 'vision'（看图问答）；图生图编辑应传 'image-edit'，与宿主图像编辑流程语义一致。
 */
export async function uploadScreenshot(
  ai: VisionAiClient,
  dataUrl: string,
  purpose: 'vision' | 'image-edit' = 'vision'
): Promise<{ attachmentId: string; mimeType: string }> {
  if (!ai.attachments?.upload) {
    throw new Error('当前环境不支持上传图片附件')
  }
  const { buffer, mimeType } = dataUrlToBuffer(dataUrl)
  const ref = await ai.attachments.upload({ buffer, mimeType, purpose })
  if (!ref?.attachmentId) {
    throw new Error('图片上传失败')
  }
  return { attachmentId: ref.attachmentId, mimeType: ref.mimeType || mimeType }
}

interface AiChunkShape {
  content?: AiContent
  reasoning_content?: string
  chunkType?: string
  error?: { message?: string }
}

export interface RunVisionChatOptions {
  ai: VisionAiClient
  model?: string
  prompt: VisionPrompt
  attachmentId: string
  mimeType?: string
  onDelta?: (text: string) => void
  onReasoning?: (text: string) => void
}

export interface RunVisionResult {
  text: string
  aborted: boolean
}

export interface VisionRequestHandle {
  result: Promise<RunVisionResult>
  abort: () => void
}

/**
 * 跑一次视觉文字动作：把图片作为一个 image content part 连同提示词发给模型，
 * 流式回吐文字增量，最终 resolve 完整文本。返回的 handle 暴露 abort()。
 */
export function runVisionChat(options: RunVisionChatOptions): VisionRequestHandle {
  if (!options.ai?.call) {
    return {
      result: Promise.reject(new Error('当前环境未启用 Mulby AI 能力')),
      abort: () => undefined
    }
  }

  let aborted = false
  let acc = ''

  const request = options.ai.call(
    {
      model: options.model || undefined,
      messages: [
        { role: 'system', content: options.prompt.system },
        {
          role: 'user',
          content: [
            { type: 'text', text: options.prompt.user },
            { type: 'image', attachmentId: options.attachmentId, mimeType: options.mimeType || 'image/png' }
          ]
        }
      ],
      capabilities: [],
      tools: [],
      internalTools: [],
      toolingPolicy: { enableInternalTools: false },
      mcp: { mode: 'off' },
      skills: { mode: 'off' },
      maxToolSteps: 1,
      params: { temperature: 0.3 }
    },
    (raw: unknown) => {
      if (aborted) {
        return
      }
      const chunk = (raw ?? {}) as AiChunkShape
      if (chunk?.chunkType === 'reasoning' && typeof chunk.reasoning_content === 'string') {
        options.onReasoning?.(chunk.reasoning_content)
        return
      }
      if (chunk?.chunkType === 'error') {
        return
      }
      const delta = extractAiText(chunk?.content)
      if (delta) {
        acc += delta
        options.onDelta?.(delta)
      }
    }
  )

  const result = request.then((value: unknown) => {
    const final = (value ?? {}) as AiChunkShape
    if (aborted) {
      return { text: acc, aborted: true }
    }
    if (final?.error?.message) {
      throw new Error(final.error.message)
    }
    const finalText = extractAiText(final?.content)
    const text = finalText.length >= acc.length ? finalText : acc
    return { text, aborted: false }
  })

  return {
    result,
    abort: () => {
      aborted = true
      request.abort?.()
    }
  }
}

export interface RunImageEditOptions {
  ai: VisionAiClient
  model: string
  attachmentId: string
  prompt: string
}

/** 跑一次图生图（AI 修图），返回结果图片的 dataURL（PNG）。 */
export async function runImageEdit(options: RunImageEditOptions): Promise<string> {
  if (!options.ai?.images?.edit) {
    throw new Error('当前环境不支持 AI 修图')
  }
  const res = await options.ai.images.edit({
    model: options.model,
    imageAttachmentId: options.attachmentId,
    prompt: options.prompt
  })
  const base64 = res?.images?.[0]
  if (!base64) {
    throw new Error('未生成图片，请重试')
  }
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
}
