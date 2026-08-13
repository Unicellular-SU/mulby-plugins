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

/** Provider 明确声明时优先用 Provider 档位，否则回退到模型规格。 */
export function effectiveDurationValues(modelId?: string | null, providerValues?: number[] | null): number[] {
  const configured = (providerValues || []).filter((value) => Number.isFinite(value) && value > 0)
  return configured.length ? configured : durationValues(modelId)
}

/**
 * 节点面板、导演增强和真实视频提交共用的时长解析。
 * 未显式写入 params.duration 时，使用当前面板显示的第一个合法档位，不再硬编码 5s。
 */
export function effectiveVideoDuration(modelId: string | null | undefined, value: unknown, providerValues?: number[] | null): number {
  const values = effectiveDurationValues(modelId, providerValues)
  const numeric = Number(value)
  const requested = Number.isFinite(numeric) && numeric > 0 ? numeric : values[0] || 5
  let best = values[0] || 5
  let distance = Infinity
  for (const candidate of values) {
    const nextDistance = Math.abs(candidate - requested)
    if (nextDistance < distance) {
      distance = nextDistance
      best = candidate
    }
  }
  return best
}

export function snapDuration(modelId: string | null | undefined, v: number): number {
  return effectiveVideoDuration(modelId, v)
}
