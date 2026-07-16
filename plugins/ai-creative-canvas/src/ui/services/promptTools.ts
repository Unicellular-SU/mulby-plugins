import { useGraph } from '../store/graphStore'
import { resolveGenInputs } from './references'
import { loadImageInput } from './media'

function ai() {
  return window.mulby.ai
}

// 提示词增强：LLM 改写得更具体、更有画面感
export async function enhancePrompt(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const card = g.getActiveBoard().cards[cardId]
  if (!card) return
  const base = (card.prompt || '').trim()
  if (!base) throw new Error('请先填写一些提示词再增强')
  const isVideo = card.kind === 'video'
  const option: any = {
    messages: [
      {
        role: 'system',
        content: `你是${isVideo ? '视频' : '图像'}生成提示词专家。把用户的提示词改写得更具体、更有画面感（主体/构图/光线/材质/氛围${isVideo ? '/运镜' : ''}），保留原意与主体，不要解释、不要加引号，直接输出改写后的中文提示词。`
      },
      { role: 'user', content: base }
    ]
  }
  if (g.project.defaultTextModel) option.model = g.project.defaultTextModel
  const final = await ai().call(option)
  const out = typeof final?.content === 'string' ? final.content.trim() : ''
  if (out) useGraph.getState().updateCard(cardId, { prompt: out })
}

// 描述图片 → 提示词（图反推）：把连入/上传的第一张图交给视觉模型生成提示词
export async function describeImage(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const board = g.getActiveBoard()
  const card = board.cards[cardId]
  if (!card) return
  const inputs = resolveGenInputs(card, board)
  const img = inputs.images[0]
  if (!img) throw new Error('没有可描述的图片（先连入或上传一张图）')
  const buf = await loadImageInput(img)
  if (!buf) throw new Error('读取图片失败')
  const att = await ai().attachments.upload({ buffer: buf, mimeType: img.mime || 'image/png', purpose: 'vision' })
  const option: any = {
    messages: [
      { role: 'system', content: '用中文详细描述这张图片，输出可直接用于文生图的提示词（主体/外观/构图/光线/风格），不要解释。' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '描述这张图片' },
          { type: 'image', attachmentId: att.attachmentId, mimeType: img.mime || 'image/png' }
        ]
      }
    ]
  }
  if (g.project.defaultTextModel) option.model = g.project.defaultTextModel
  const final = await ai().call(option)
  const out = typeof final?.content === 'string' ? final.content.trim() : ''
  if (out) useGraph.getState().updateCard(cardId, { prompt: out })
}
