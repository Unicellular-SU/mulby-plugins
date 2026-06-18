/**
 * 字段级 AI 优化：根据所在节点字段的「特点」，把用户的粗略输入优化为更专业、更适合该用途的文本。
 * 在 Inspector 的可输入文本框右下角提供按钮触发；优化后替换原文，可撤回。
 */
import { runText } from './textEngine'
import { stripCodeFences } from './jsonParse'

/** kind → paramKey → 优化指令（system）。仅这些字段显示「AI 优化」按钮。 */
const FIELD_GUIDES: Record<string, Record<string, string>> = {
  story: {
    text: '你是资深编剧。把用户零碎的想法/一句话扩写成更有画面感的故事梗概：要有主角、核心冲突与情绪走向，简洁有张力（中文，2-5 句）。',
  },
  text: {
    text: '你是文案润色助手。把用户文本改写得更清晰、有画面感，保留原意与信息（中文）。',
  },
  'script-gen': {
    instruction: '你在帮用户给「剧本生成」补充创作要求。把输入整理成清晰的风格 / 篇幅 / 视角 / 基调等要求（中文，简洁，可分点）。',
  },
  outline: {
    instruction: '你在帮用户给「故事大纲」补充要求。把输入整理成清晰的主题 / 结构 / 节奏 / 基调要求（中文，简洁）。',
  },
  character: {
    appearance:
      '你是角色设定师。把用户的人物外貌/服饰描述补充得更具体、有视觉细节：发型发色、五官气质、服装款式材质颜色、配饰、体型、标志性特征，便于图像生成保持一致（中文，直接给描述，不要解释）。',
    refPrompt:
      '你是图像提示词工程师。把用户输入整理成用于角色形象生成的高质量英文提示词：主体+外观+服饰+材质+风格关键词，逗号分隔，直接输出英文。',
  },
  scene: {
    description:
      '你是场景概念设计师。把用户的场景描述补充得更具体：环境结构、时间光线、天气氛围、材质色调、标志性元素；只描述环境，不要出现人物（中文，直接给描述）。',
    refPrompt:
      '你是图像提示词工程师。把用户输入整理成场景概念图的英文提示词：环境+光线+氛围+风格关键词，逗号分隔，含 no people，直接输出英文。',
  },
  prop: {
    description:
      '你是道具/物品设计师。把用户的物品描述补充得更具体：材质、形状结构、颜色、工艺细节、磨损或发光等特征，便于生成干净一致的物品参考图（中文，直接给描述）。',
    refPrompt:
      '你是图像提示词工程师。把用户输入整理成单个物品参考图的英文提示词：物体+材质+颜色+细节+studio lighting，逗号分隔，含 single object、no people，直接输出英文。',
  },
  i2v: {
    motion: '你是运镜师。把用户输入优化为清晰的运镜与画面运动描述：镜头如何移动、主体如何动作、节奏快慢，便于图生视频（中文，直接给描述）。',
  },
  bgm: {
    prompt: '你是配乐师。把用户输入优化为专业的音乐描述：风格流派、主奏乐器、节奏速度、情绪、参考风格，便于音乐生成（中文，直接给描述）。',
  },
  tts: {
    text: '你是配音导演。把用户的配音文本润色为更适合朗读的旁白/台词：口语自然、有节奏、去书面腔，保留原意（中文，直接给文本）。',
  },
  'image-edit': {
    instruction: '你是图像编辑指令助手。把用户输入优化为清晰、具体、可执行的图像编辑指令：要改什么、改成什么样、保留什么（中文，直接给指令）。',
  },
  upscale: {
    instruction: '你是高清重绘提示助手。把用户输入优化为增强提示：保留原构图与内容，重点提升哪些细节/材质/清晰度（中文，直接给提示）。',
  },
}

export function getFieldOptimizer(kind: string, key: string): string | null {
  return FIELD_GUIDES[kind]?.[key] ?? null
}

/** 调用文本模型按 guide 优化输入，返回优化后的纯文本 */
export async function optimizeFieldText(guide: string, value: string, model: string | null): Promise<string> {
  const system = `${guide}\n\n严格要求：只输出优化后的文本本身，不要任何前言、说明、引号或 markdown 代码块。`
  const r = await runText({ model, system, user: value })
  return (stripCodeFences(r.content) || r.content || '').trim()
}
