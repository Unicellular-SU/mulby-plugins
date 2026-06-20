// 提示词预设（输入 / 唤出）
export interface Preset {
  label: string
  text: string
}

export const PROMPT_PRESETS: Preset[] = [
  { label: '电影感', text: '电影感，戏剧化布光，浅景深，胶片质感' },
  { label: '写实摄影', text: '写实摄影，自然光，高细节，35mm' },
  { label: '特写', text: '特写镜头，面部细节清晰' },
  { label: '广角', text: '广角镜头，宏大场景，强透视' },
  { label: '俯拍', text: '俯拍视角，上帝视角构图' },
  { label: '低角度', text: '低角度仰拍，强烈透视压迫感' },
  { label: '黄金时刻', text: '黄金时刻光线，温暖柔和' },
  { label: '逆光', text: '逆光，轮廓光，丁达尔效应' },
  { label: '霓虹夜景', text: '霓虹夜景，赛博朋克氛围，湿润反光街道' },
  { label: '高细节', text: '极致细节，8k，精细纹理' },
  { label: '柔和氛围', text: '柔和氛围，朦胧梦幻' },
  { label: '高对比', text: '高对比度，强烈明暗对比' },
  { label: '水彩', text: '水彩画风，柔和笔触，晕染' },
  { label: '3D 渲染', text: '3D 渲染，柔和全局光照，次表面散射' },
  { label: '极简', text: '极简构图，大量留白' }
]
