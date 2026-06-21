// 各视频模型的合法时长档位（秒）。滑块按所选模型吸附，发送前再兜底吸附。
export function durationValues(modelId?: string | null): number[] {
  const id = (modelId || '').toLowerCase()
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  if (id.includes('veo3') && id.includes('official')) return [4, 6, 8]
  if (id.startsWith('veo3')) return [8] // veo3 转发版固定 8s
  if (id.startsWith('sora-2')) return [4, 8, 12]
  if (id === 'kling-v2-6') return [5, 10]
  if (id === 'kling-video-o1') return range(3, 10)
  if (id.startsWith('kling')) return range(3, 15) // v3 / v3-omni / 3.0-turbo
  if (id.startsWith('seedance-2')) return id.includes('mini') ? [4, 8, 10, 12, 15] : range(4, 15)
  if (id.startsWith('doubao-seedance-1-5')) return range(4, 12)
  if (id.startsWith('doubao-seedance')) return range(2, 12)
  if (id.includes('hailuo')) return [6, 10]
  if (id.startsWith('wan2.6')) return [5, 10, 15]
  if (id.includes('grok-video-1.5')) return [10, 15]
  if (id.startsWith('grok-video')) return [6, 10, 15]
  if (id === 'viduq3') return range(3, 16)
  if (id.startsWith('viduq3')) return range(1, 16)
  if (id.includes('gemini') && id.includes('omni')) return [4, 6, 10]
  if (id.startsWith('happyhorse')) return range(3, 15)
  return range(1, 15) // 未知模型：1–15 自由
}

export function snapDuration(modelId: string | null | undefined, v: number): number {
  const vals = durationValues(modelId)
  let best = vals[0]
  let bd = Infinity
  for (const x of vals) {
    const d = Math.abs(x - v)
    if (d < bd) {
      bd = d
      best = x
    }
  }
  return best
}
