/**
 * 风格包（Style Skill-Pack）：把"画风"从一个自由字符串升级为结构化配置——
 * 正向锚定（全局 + 角色/场景/物品分项）+ 一致性锚 + 软避免 + 调色板 + 视频风格标签。
 * 统一经 applyStylePack 注入所有图像/视频提示词，根治"同一片跨镜画风/色调漂移"。
 * （移植自 ai-film-studio）
 */
export interface StylePack {
  id: string
  label: string
  hint?: string
  /** 锚定词：all 恒注入；character/scene/prop 按生成对象注入；consistency 用于参考图模式 */
  anchors: { all: string; character?: string; scene?: string; prop?: string; consistency?: string }
  /** 软避免：以 "no X" 形式追加到正向 prompt（本插件图像 API 仅单 prompt，无独立负向口） */
  negative?: string
  /** 核心调色板（展示/参考用，主色已并入 anchors） */
  palette?: { name: string; hex: string }[]
  /** 视频提示词风格标签（i2v/t2v 用） */
  videoTag?: string
}

export type StyleRole = 'character' | 'scene' | 'prop' | 'keyframe' | 'video'

export const STYLE_PACKS: StylePack[] = [
  {
    id: 'guofeng-2d',
    label: '国风二次元 · 新国潮',
    hint: '赛璐璐平涂 + 东方古韵；适合古风/仙侠/宫廷短剧。',
    anchors: {
      all: '国风二次元，新国潮东方美学，日式动画渲染，赛璐璐平涂，细腻笔触，电影质感',
      character: '二次元国风造型，线条清晰，赛璐璐上色，服饰细节精致，光影层次丰富',
      scene: '国风二次元场景，传统建筑细节丰富，日式渲染，前中后景层次，空气透视',
      prop: '国风器物，玉/木/金属材质以赛璐璐平涂表现，单一物品，studio lighting',
      consistency: '保持造型与参考图一致，光影色彩基调统一'
    },
    negative: 'no photorealistic, no 3D render, no plastic texture, no western fantasy, no subtitles, no watermark',
    palette: [
      { name: '月白', hex: '#E8EAF5' },
      { name: '青绿', hex: '#4A9B8A' },
      { name: '朱红', hex: '#C93752' },
      { name: '靛蓝', hex: '#2B4C7E' },
      { name: '金黄', hex: '#D4AF37' }
    ],
    videoTag: '国风二次元动画，赛璐璐平涂，新国潮东方美学，电影风格，色彩鲜明'
  },
  {
    id: 'cinematic-real',
    label: '写实电影感',
    hint: '照片级真实 + 电影打光；适合现代都市/写实题材。',
    anchors: {
      all: 'cinematic photography, photorealistic, film still, natural lighting, shallow depth of field, high detail, 35mm',
      character: 'realistic skin texture, natural facial features, detailed fabric and wardrobe',
      scene: 'realistic environment, atmospheric volumetric lighting, depth and scale',
      prop: 'realistic material, product photography, studio lighting, single object',
      consistency: 'consistent with the reference image, unified color grade and lighting'
    },
    negative: 'no cartoon, no anime, no illustration, no cgi look, no oversaturation, no watermark, no text overlay',
    palette: [
      { name: 'teal', hex: '#2B4C5A' },
      { name: 'amber', hex: '#C8853E' },
      { name: 'slate', hex: '#3A4048' }
    ],
    videoTag: 'cinematic, photorealistic, natural camera motion, subtle film grain'
  },
  {
    id: 'flat-illustration',
    label: '扁平插画',
    hint: '矢量扁平 + 大色块；适合轻量/科普/广告。',
    anchors: {
      all: 'flat design illustration, vector art style, clean shapes, bold flat colors, minimal shading, modern editorial',
      character: 'simple flat character, clean outlines, geometric shapes',
      scene: 'flat environment, minimal background, bold color blocks',
      prop: 'flat icon-style object, simple shapes, single object',
      consistency: 'consistent palette and line weight with the reference'
    },
    negative: 'no photorealistic, no 3D, no gradient mesh, no heavy shadow, no watermark, no text',
    palette: [
      { name: 'coral', hex: '#FF6B6B' },
      { name: 'teal', hex: '#4ECDC4' },
      { name: 'navy', hex: '#1A535C' }
    ],
    videoTag: 'flat 2D animation, clean vector style, bold colors, smooth motion'
  },
  {
    id: 'anime-90s',
    label: '90 年代日系动画',
    hint: '复古赛璐璐 + 胶片颗粒；适合怀旧/青春/校园题材。',
    anchors: {
      all: '90s retro Japanese cel anime, hand-painted cel shading, film grain, slightly faded warm colors, analog nostalgia, detailed line art',
      character: 'classic 90s anime character, large expressive eyes, hand-drawn linework, flat cel coloring',
      scene: 'hand-painted background art, soft gradient skies, nostalgic everyday Japan, painterly detail',
      prop: 'hand-drawn object, simple cel shading, retro design',
      consistency: 'consistent cel shading and faded palette with the reference'
    },
    negative: 'no modern digital gloss, no 3D, no photorealistic, no neon oversaturation, no watermark',
    palette: [
      { name: 'faded amber', hex: '#C8A27A' },
      { name: 'dusty teal', hex: '#7A9EA3' },
      { name: 'brick', hex: '#B5503C' },
      { name: 'navy', hex: '#2E3A4A' }
    ],
    videoTag: '90s cel anime, film grain, hand-painted, nostalgic, limited-animation feel'
  },
  {
    id: 'anime-3d',
    label: '3D 动画电影',
    hint: '风格化 3D 角色 + 柔光渲染；适合合家欢/冒险题材。',
    anchors: {
      all: '3D animated film style, stylized character models, soft global illumination, subsurface skin, polished render',
      character: 'appealing stylized 3D character, rounded forms, soft skin shading, expressive face',
      scene: '3D rendered environment, soft ambient occlusion, depth of field, warm cinematic lighting',
      prop: '3D modeled object, clean surfaces, soft specular highlights',
      consistency: 'consistent model design and shading with the reference'
    },
    negative: 'no flat 2D, no anime cel lines, no photorealistic humans, no rough low-poly, no watermark',
    palette: [
      { name: 'sun', hex: '#F2C879' },
      { name: 'sky', hex: '#5FA8D3' },
      { name: 'coral', hex: '#E08552' },
      { name: 'indigo', hex: '#3D4A6B' }
    ],
    videoTag: '3D animated film, soft lighting, stylized characters, smooth motion'
  },
  {
    id: 'clay-stop',
    label: '黏土定格动画',
    hint: '手作黏土质感 + 定格动画；适合童话/趣味短片。',
    anchors: {
      all: 'claymation stop-motion, handmade clay and plasticine texture, visible fingerprint marks, miniature handcrafted sets, tactile and slightly imperfect',
      character: 'clay puppet character, sculpted plasticine, soft rounded shapes, handmade charm',
      scene: 'miniature handcrafted set, felt and clay materials, tabletop scale, warm practical lighting',
      prop: 'handmade clay prop, sculpted texture, tactile material',
      consistency: 'consistent clay material and craft style with the reference'
    },
    negative: 'no smooth CGI, no 2D, no photorealistic, no plastic-perfect surfaces, no watermark',
    palette: [
      { name: 'terracotta', hex: '#C76B4A' },
      { name: 'moss', hex: '#7C9A6E' },
      { name: 'ochre', hex: '#E3C16F' },
      { name: 'umber', hex: '#4A3B33' }
    ],
    videoTag: 'claymation stop-motion, handmade clay texture, tactile, slight frame-step motion'
  },
  {
    id: 'guofeng-3d',
    label: '3D 国风传统',
    hint: '玉石漆器材质 + 飘逸丝绸；适合仙侠/古风 3D。',
    anchors: {
      all: '3D Chinese traditional style, ornate render, jade and lacquer materials, flowing silk simulation, oriental architecture detail',
      character: '3D guofeng character, elegant hanfu, refined facial model, silk and embroidery detail',
      scene: '3D oriental environment, pavilions and gardens, misty depth, volumetric light',
      prop: '3D oriental artifact, jade / bronze / lacquer material, intricate carving',
      consistency: 'consistent oriental material and design language with the reference'
    },
    negative: 'no western fantasy, no photorealistic, no flat 2D, no neon, no watermark',
    palette: [
      { name: '朱', hex: '#9B2D30' },
      { name: '金', hex: '#D4AF37' },
      { name: '青', hex: '#2B5C4F' },
      { name: '玉白', hex: '#E8E0CE' }
    ],
    videoTag: '3D Chinese traditional, silk and jade, oriental elegance, flowing motion'
  },
  {
    id: 'guofeng-cyber',
    label: '国潮赛博',
    hint: '东方美学 × 霓虹赛博；适合科幻/未来都市国风。',
    anchors: {
      all: 'neo-Chinese cyberpunk, oriental aesthetics fused with neon cyber tech, holographic hanzi signage, rainy neon streets, high contrast',
      character: 'guofeng-cyber character, hanfu-tech fusion outfit, neon rim light, futuristic ornaments',
      scene: 'neon oriental megacity, holographic signs, wet reflective streets, dense atmosphere',
      prop: 'cyber-oriental gadget, glowing accents, ornate-tech fusion',
      consistency: 'consistent neon palette and tech-oriental fusion with the reference'
    },
    negative: 'no plain historical, no soft pastel, no flat illustration, no flat daylight, no watermark',
    palette: [
      { name: 'neon rose', hex: '#FF2E63' },
      { name: 'cyan', hex: '#08D9D6' },
      { name: 'violet', hex: '#7A04EB' },
      { name: 'void', hex: '#1A1A2E' }
    ],
    videoTag: 'neo-Chinese cyberpunk, neon, holographic hanzi, rainy reflections, cinematic'
  },
  {
    id: 'urban-romance',
    label: '都市言情（半写实）',
    hint: '半写实漫画感 + 暖调电影光；适合现代情感剧。',
    anchors: {
      all: 'mature urban romance manhua style, semi-realistic proportions, soft rendering, warm cinematic lighting, refined modern fashion',
      character: 'attractive semi-realistic character, detailed eyes and hair, modern stylish outfit, soft shading',
      scene: 'modern city interior and exterior, cafes and skylines, warm bokeh lighting, intimate mood',
      prop: 'modern lifestyle object, refined material, soft highlights',
      consistency: 'consistent rendering and lighting mood with the reference'
    },
    negative: 'no chibi, no flat cartoon, no 3D, no harsh thick outlines, no watermark',
    palette: [
      { name: 'blush', hex: '#E8A6A1' },
      { name: 'caramel', hex: '#C98A6B' },
      { name: 'dusk', hex: '#6B7B99' },
      { name: 'charcoal', hex: '#2E2A33' }
    ],
    videoTag: '2D urban romance, semi-realistic, soft cinematic light, warm intimate mood'
  },
  {
    id: 'ancient-real',
    label: '真人古装（写实）',
    hint: '照片级真人古装剧；适合历史/宫廷正剧。',
    anchors: {
      all: 'live-action ancient Chinese costume drama, photorealistic, cinematic period lighting, authentic hanfu textiles, traditional architecture',
      character: 'realistic actor in detailed period hanfu, natural skin, authentic hairstyle and ornaments',
      scene: 'realistic ancient Chinese setting, palaces and courtyards, atmospheric haze, natural light',
      prop: 'realistic period artifact, authentic material wear, fine detail',
      consistency: 'consistent period authenticity, color grade and lighting with the reference'
    },
    negative: 'no anime, no cartoon, no 3D render, no modern objects, no watermark, no text overlay',
    palette: [
      { name: 'vermilion', hex: '#7A2E2E' },
      { name: 'gold silk', hex: '#C7A86A' },
      { name: 'pine', hex: '#3A4A3E' },
      { name: 'ink', hex: '#23201C' }
    ],
    videoTag: 'live-action period drama, cinematic, authentic costume, natural motion'
  },
  {
    id: 'ink-wash',
    label: '水墨国画',
    hint: '写意笔墨 + 大量留白；适合诗意/武侠/意境片。',
    anchors: {
      all: 'traditional Chinese ink wash painting, expressive brush strokes, flowing ink gradients, abundant negative space, rice-paper texture',
      character: 'ink-painted figure, minimal expressive brushwork, flowing robes rendered in ink',
      scene: 'ink wash landscape, misty mountains and water, generous white space, subtle ink tones',
      prop: 'ink-brushed object, minimal strokes, suggestive form',
      consistency: 'consistent brush language and ink tonality with the reference'
    },
    negative: 'no photorealistic, no 3D, no bright saturated colors, no hard digital outlines, no watermark',
    palette: [
      { name: '焦墨', hex: '#1A1A1A' },
      { name: '淡墨', hex: '#5C5C5C' },
      { name: '赭', hex: '#A89F8C' },
      { name: '宣纸', hex: '#F4F1E8' }
    ],
    videoTag: 'Chinese ink wash, flowing brush strokes, misty, negative space, subtle motion'
  }
]

export function getStylePack(id?: string | null): StylePack | null {
  if (!id) return null
  return STYLE_PACKS.find((p) => p.id === id) ?? null
}

/** 把风格包组合成可追加到生成 prompt 的后缀：全局锚定 + 角色锚定 + 一致性锚 + 软避免。 */
export function applyStylePack(pack: StylePack, role: StyleRole): string {
  const roleAnchor =
    role === 'character' ? pack.anchors.character : role === 'scene' ? pack.anchors.scene : role === 'prop' ? pack.anchors.prop : undefined
  const parts = [pack.anchors.all, roleAnchor, pack.anchors.consistency].filter(Boolean) as string[]
  if (role === 'video' && pack.videoTag) parts.push(pack.videoTag)
  let s = parts.join(', ')
  if (pack.negative && role !== 'video') s += `, ${pack.negative}` // 视频路径不追加负向词（多数视频模型不解析）
  return s
}

/** 视频提示词风格标签：选了包用 videoTag，否则回退自由画风字符串。 */
export function videoStyleTag(stylePackId?: string | null, fallbackStyle?: string): string {
  const pack = getStylePack(stylePackId)
  if (pack) return pack.videoTag || pack.anchors.all
  return fallbackStyle || ''
}
