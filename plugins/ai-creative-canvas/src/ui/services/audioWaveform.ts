// 音频波形：渲染进程 WebAudio 离线解码 → 降采样取峰值包络（无 ffprobe / 无解码 CLI）
// 设计依据：docs/ai-creative-canvas-video-editor.md §4.6「音频波形可视化」
// 解码失败（编码不支持 / 无音轨）返回 null，UI 退「仅时间标尺」。

export async function loadWaveform(url: string, buckets = 240): Promise<number[] | null> {
  try {
    const resp = await fetch(url)
    const buf = await resp.arrayBuffer()
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    let audio: AudioBuffer
    try {
      audio = await ctx.decodeAudioData(buf)
    } finally {
      ctx.close?.()
    }
    const ch = audio.getChannelData(0)
    const block = Math.max(1, Math.floor(ch.length / buckets))
    const peaks: number[] = []
    for (let i = 0; i < buckets; i++) {
      let max = 0
      const start = i * block
      const end = Math.min(ch.length, start + block)
      for (let j = start; j < end; j++) {
        const v = Math.abs(ch[j])
        if (v > max) max = v
      }
      peaks.push(max)
    }
    const norm = peaks.reduce((a, b) => Math.max(a, b), 0.001)
    return peaks.map((p) => Math.min(1, p / norm))
  } catch {
    return null
  }
}
