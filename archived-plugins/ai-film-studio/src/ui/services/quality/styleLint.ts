/**
 * 风格 / 提示词 lint（借鉴 OpenMontage styles `quality_rules` 的「让风格成为机器可用约束」**思路**，自研）。
 *
 * 这里是**通用、与风格无关**的固定启发式（风格专属规则改由 StylePack.qualityRules 作为 guidance 注入，见 stylePacks.ts）：
 *   · text_baking：镜头描述要求「画面内出现精确文字」——生成图常出错字/乱码，应改用字幕/overlay 叠加。
 *   · watermark_logo：要求生成 logo/水印——易畸变/侵权，应后期叠加。
 * 纯函数、零运行时依赖；由 composeGate 汇入 warnings（建议性，不硬阻断）。
 */

export interface StyleLintViolation {
  rule: string
  shotIndices: number[]
  message: string
  suggestion: string
}
export interface StyleLintResult {
  violations: StyleLintViolation[]
  summary: string
}

// 「画面内要出现精确文字」的请求（中/英）
const TEXT_BAKE =
  /(写着|字样|标题为|招牌写|牌子写|文案是|字幕烧录?进|文字内容为|屏幕(上)?显示文字|大字写)|(text\s+(saying|reading|that says)|the words?\s*["'“]|caption reading)/i
// 引号文字 + 「字样/标语」类要求
const QUOTED_TEXT = /["'“『「][^"'”』」\n]{1,40}["'”』」]\s*(字样|字|文字|标语|标题|slogan)/
// logo / 水印
const WATERMARK = /(水印|logo|商标|品牌标志|台标|watermark|brand\s*logo)/i

/** 对一组镜头跑通用风格 lint。shots 仅需 desc(+可选 index)。 */
export function styleLint(shots: { desc?: string; index?: number }[]): StyleLintResult {
  const violations: StyleLintViolation[] = []
  shots.forEach((s, i) => {
    const d = s.desc ?? ''
    if (!d) return
    const no = s.index ?? i + 1
    if (TEXT_BAKE.test(d) || QUOTED_TEXT.test(d)) {
      violations.push({
        rule: 'text_baking',
        shotIndices: [no],
        message: `第 ${no} 镜要求画面内出现精确文字`,
        suggestion: '生成图常出错字/乱码——改用字幕/overlay 叠加，勿烧进生成图。',
      })
    }
    if (WATERMARK.test(d)) {
      violations.push({
        rule: 'watermark_logo',
        shotIndices: [no],
        message: `第 ${no} 镜含 logo/水印/台标要求`,
        suggestion: '模型生成 logo 易畸变/侵权——改用后期 overlay 叠加。',
      })
    }
  })
  const summary = violations.length
    ? `风格 lint：${violations.length} 处建议（多为「文字勿烧进生成图」）`
    : '风格 lint：未发现问题'
  return { violations, summary }
}
