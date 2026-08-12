export type InpaintOp = 'repaint' | 'remove'

export interface InpaintGuidanceInput {
  op: InpaintOp
  prompt: string
  hasMask: boolean
  hasAnnotations: boolean
  annotationTexts?: string[]
}

export function normalizedAnnotationTexts(values: string[] = []): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

/**
 * 把画面标注和普通输入合并成模型可理解的编辑指令。
 * 标注图层会被烘焙进参考图，所以必须明确要求模型理解后移除这些辅助标记。
 */
export function buildInpaintInstruction(input: InpaintGuidanceInput): string {
  const prompt = input.prompt.trim()
  const annotationTexts = normalizedAnnotationTexts(input.annotationTexts)
  const annotationRequirements = annotationTexts.length
    ? `文字标注中的要求：${annotationTexts.map((text, index) => `${index + 1}. ${text}`).join('；')}。`
    : ''
  const annotationRule = input.hasAnnotations
    ? `图中的红色箭头和黄色文字标注只用于指示修改位置与要求；请理解这些辅助标记，但最终结果必须完全移除箭头、标注框和标注文字。${annotationRequirements}`
    : ''
  const extra = prompt ? `补充要求：${prompt}。` : ''

  if (input.op === 'remove') {
    const target = input.hasMask
      ? '移除画面中绿色覆盖区域内的物体'
      : '根据画面中的箭头、文字标注和补充要求，移除被指示的物体或内容'
    return `${target}，用与周围一致、自然连贯的背景无缝填补；其余区域严格保持与原图一致。${annotationRule}${extra}`
  }

  const target = input.hasMask
    ? '图中透明（被挖空）的区域是待修改区域'
    : '根据画面中的箭头和文字标注定位待修改区域'
  const requirements = [annotationRequirements ? '' : prompt, annotationTexts.length ? prompt : '']
    .map((value) => value.trim())
    .filter(Boolean)
    .join('；')
  return `${target}，请按修改要求进行局部重绘，并与周围光影、风格和边缘无缝衔接；其余区域严格保持与原图一致。${annotationRule}${requirements ? `修改要求：${requirements}。` : ''}`
}
