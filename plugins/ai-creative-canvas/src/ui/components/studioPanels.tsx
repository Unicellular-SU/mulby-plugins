// VideoStudioModal 的右侧参数面板族（按 op 类型分派）：从 VideoStudioModal.tsx 机械拆出（F1）。
// ParamPanel 是入口，按 op.kind 渲染各子面板；overlay 再按 sub 细分（含字幕独立面板）。改动仅为
// 「移动 + 导出 + 补充 import」，各面板内部逻辑与原内联定义完全一致。共享原语来自 ./studioControls。
import { useState } from 'react'
import { FlipHorizontal2, FlipVertical2, Plus, Trash2, Scissors, Music, Loader2 } from 'lucide-react'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { useStudio } from '../store/studioStore'
import { useProviders } from '../store/providerStore'
import { Select } from './Select'
import { runTts } from '../services/providers/engine'
import { toast } from '../store/toastStore'
import { PLATFORM_PRESETS } from '../services/videoEdit/exportPresets'
import { base64ToArrayBuffer } from '../util'
import type { EditOp, TrimParams, SpeedParams, TransformParams, ColorParams, AudioParams, ExportParams, OverlayParams, SubtitleCue } from '../services/videoEdit/types'
import { Row, SliderRow, Toggle, fmt } from './studioControls'

const RES_OPTIONS = [
  { value: 'follow', label: '跟随原视频' },
  { value: '1280x720', label: '720p 横屏 (16:9)' },
  { value: '1920x1080', label: '1080p 横屏 (16:9)' },
  { value: '720x1280', label: '竖屏 720×1280 (9:16)' },
  { value: '1080x1920', label: '竖屏 1080×1920 (9:16)' },
  { value: '1080x1080', label: '方屏 1080×1080 (1:1)' }
]

const COLOR_PRESETS: { id: string; label: string; params: Partial<ColorParams> }[] = [
  { id: 'warm', label: '暖阳', params: { temp: 35, saturation: 1.15, contrast: 1.05 } },
  { id: 'cool', label: '冷调', params: { temp: -35, saturation: 1.05, contrast: 1.02 } },
  { id: 'cine', label: '电影', params: { contrast: 1.15, saturation: 0.9, vignette: 0.4 } },
  { id: 'vintage', label: '复古', params: { saturation: 0.75, temp: 20, grain: 12, vignette: 0.5 } },
  { id: 'film', label: '老电影', params: { saturation: 0.6, contrast: 1.1, temp: 15, grain: 18, vignette: 0.5 } },
  { id: 'cyber', label: '赛博', params: { saturation: 1.4, contrast: 1.15, temp: -30, hue: 10 } },
  { id: 'bw', label: '黑白', params: { saturation: 0 } }
]

// ---------- 参数面板（按 op 类型）----------
export function ParamPanel({ op, dur, playhead }: { op: EditOp; dur: number; playhead: number }) {
  const live = (patch: Record<string, unknown>) => useStudio.getState().updateOpLive(op.id, patch)
  const commit = () => useStudio.getState().commitLive()
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)

  if (op.kind === 'trim') return <TrimPanel op={op} params={op.params as TrimParams} dur={dur} playhead={playhead} />
  if (op.kind === 'overlay') return <OverlayPanel op={op} params={op.params as OverlayParams} dur={dur} playhead={playhead} />
  if (op.kind === 'speed') {
    const p = op.params as SpeedParams
    return (
      <div className="flex flex-col gap-2.5">
        <SliderRow label="倍率" value={p.rate} min={0.25} max={4} step={0.05} suffix="×" onLive={(v) => live({ rate: v })} onCommit={commit} />
        {p.rate < 1 && <Toggle label="平滑慢动作（补帧，较慢）" checked={!!p.smoothSlowmo} onChange={(v) => set({ smoothSlowmo: v })} />}
        <Toggle label="倒放" checked={p.reverse} onChange={(v) => set({ reverse: v })} />
        <Toggle label="保持音调（变速不变调）" checked={p.pitchCompensate !== false} onChange={(v) => set({ pitchCompensate: v })} />
        <Toggle label="回旋 Boomerang（正放→倒放，去音轨）" checked={!!p.boomerang} onChange={(v) => set({ boomerang: v })} />
        <SliderRow label="片尾冻结" value={p.freezeEnd ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ freezeEnd: v })} onCommit={commit} />
        <SliderRow label="运动残影" value={p.motionTrail ?? 0} min={0} max={6} step={1} onLive={(v) => live({ motionTrail: v })} onCommit={commit} />
      </div>
    )
  }
  if (op.kind === 'transform') {
    const p = op.params as TransformParams
    const cropOn = !!p.crop
    return (
      <div className="flex flex-col gap-2.5">
        <Row label="旋转">
          <div className="flex gap-1">
            {[0, 90, 180, 270].map((d) => (
              <button key={d} onClick={() => set({ rotate: d })} className={`px-2 py-1 rounded text-[11px] ${(p.rotate || 0) === d ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>{d}°</button>
            ))}
          </div>
        </Row>
        <Row label="翻转">
          <div className="flex gap-1">
            <button onClick={() => set({ hflip: !p.hflip })} className={`p-1.5 rounded ${p.hflip ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}><FlipHorizontal2 size={13} /></button>
            <button onClick={() => set({ vflip: !p.vflip })} className={`p-1.5 rounded ${p.vflip ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}><FlipVertical2 size={13} /></button>
          </div>
        </Row>
        <Toggle label="裁剪画面" checked={cropOn} onChange={(v) => set({ crop: v ? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } : undefined })} />
        {cropOn && p.crop && (
          <>
            <SliderRow label="左 X" value={p.crop.x} min={0} max={0.9} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, x: v, w: Math.min(p.crop!.w, 1 - v) } })} onCommit={commit} />
            <SliderRow label="上 Y" value={p.crop.y} min={0} max={0.9} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, y: v, h: Math.min(p.crop!.h, 1 - v) } })} onCommit={commit} />
            <SliderRow label="宽" value={p.crop.w} min={0.1} max={1} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, w: Math.min(v, 1 - p.crop!.x) } })} onCommit={commit} />
            <SliderRow label="高" value={p.crop.h} min={0.1} max={1} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, h: Math.min(v, 1 - p.crop!.y) } })} onCommit={commit} />
          </>
        )}
        <Row label="画幅">
          <Select className="flex-1" value={p.outW && p.outH ? `${p.outW}x${p.outH}:${p.fit || 'contain'}` : 'none'}
            onChange={(v) => {
              if (v === 'none') return set({ outW: undefined, outH: undefined })
              const [wh, fit] = v.split(':')
              const [w, h] = wh.split('x').map(Number)
              set({ outW: w, outH: h, fit: fit as TransformParams['fit'] })
            }}
            options={[
              { value: 'none', label: '不改画幅' },
              { value: '720x1280:blur-pad', label: '竖屏 9:16 · 模糊填充' },
              { value: '720x1280:contain', label: '竖屏 9:16 · 黑边' },
              { value: '1280x720:blur-pad', label: '横屏 16:9 · 模糊填充' },
              { value: '1080x1080:cover', label: '方屏 1:1 · 裁满' }
            ]} />
        </Row>
        <SliderRow label="像素化" value={p.pixelate ?? 1} min={1} max={30} step={1} onLive={(v) => live({ pixelate: v })} onCommit={commit} />
        <Row label="镜像">
          <Select className="flex-1" value={p.mirror || 'none'} onChange={(v) => set({ mirror: v as TransformParams['mirror'] })}
            options={[{ value: 'none', label: '无' }, { value: 'h', label: '左右镜像（万花筒）' }, { value: 'v', label: '上下镜像' }]} />
        </Row>
        <SliderRow label="镜头抖动" value={p.shake ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ shake: v })} onCommit={commit} />
        <SliderRow label="故障 Glitch" value={p.glitch ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ glitch: v })} onCommit={commit} />
        <Toggle label="画面去抖稳定" checked={!!p.deshake} onChange={(v) => set({ deshake: v })} />
      </div>
    )
  }
  if (op.kind === 'color') {
    const p = op.params as ColorParams
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1 pb-1">
          {COLOR_PRESETS.map((pr) => (
            <button key={pr.id} onClick={() => set({ ...pr.params, preset: pr.id })} className={`px-2 py-0.5 rounded text-[10px] ${p.preset === pr.id ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10 hover:bg-black/10'}`}>{pr.label}</button>
          ))}
          <button onClick={() => set({ brightness: 0, contrast: 1, saturation: 1, gamma: 1, temp: 0, hue: 0, sharpen: 0, denoise: 0, vignette: 0, grain: 0, preset: undefined })} className="px-2 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/10">重置</button>
        </div>
        <SliderRow label="亮度" value={p.brightness ?? 0} min={-0.5} max={0.5} step={0.02} onLive={(v) => live({ brightness: v })} onCommit={commit} />
        <SliderRow label="对比度" value={p.contrast ?? 1} min={0.5} max={2} step={0.02} onLive={(v) => live({ contrast: v })} onCommit={commit} />
        <SliderRow label="饱和度" value={p.saturation ?? 1} min={0} max={3} step={0.02} onLive={(v) => live({ saturation: v })} onCommit={commit} />
        <SliderRow label="伽马" value={p.gamma ?? 1} min={0.3} max={2.5} step={0.02} onLive={(v) => live({ gamma: v })} onCommit={commit} />
        <SliderRow label="色温" value={p.temp ?? 0} min={-100} max={100} step={1} onLive={(v) => live({ temp: v })} onCommit={commit} />
        <SliderRow label="色相" value={p.hue ?? 0} min={-180} max={180} step={1} suffix="°" onLive={(v) => live({ hue: v })} onCommit={commit} />
        <SliderRow label="锐化" value={p.sharpen ?? 0} min={0} max={3} step={0.1} onLive={(v) => live({ sharpen: v })} onCommit={commit} />
        <SliderRow label="降噪" value={p.denoise ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ denoise: v })} onCommit={commit} />
        <SliderRow label="暗角" value={p.vignette ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ vignette: v })} onCommit={commit} />
        <SliderRow label="颗粒" value={p.grain ?? 0} min={0} max={40} step={1} onLive={(v) => live({ grain: v })} onCommit={commit} />
        <Toggle label="反相 negate" checked={!!p.invert} onChange={(v) => set({ invert: v })} />
        <Row label="LUT">
          <button onClick={async () => {
            const m = window.mulby
            try {
              const paths = await m?.dialog?.showOpenDialog({ title: '选择 3D LUT', filters: [{ name: 'LUT', extensions: ['cube', '3dl'] }], properties: ['openFile'] })
              if (paths?.[0]) set({ lutPath: paths[0] })
            } catch { /* ignore */ }
          }} className="px-2 py-1 rounded text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10 truncate flex-1 text-left">
            {p.lutPath ? '已选：' + p.lutPath.split(/[\\/]/).pop() : '选择 .cube…'}
          </button>
          {p.lutPath && <button onClick={() => set({ lutPath: undefined })} className="px-1.5 py-1 rounded text-[10px] bg-black/5 dark:bg-white/10">清除</button>}
        </Row>
      </div>
    )
  }
  if (op.kind === 'audio') {
    const p = op.params as AudioParams
    const ranges = p.muteRanges || []
    return (
      <div className="flex flex-col gap-2.5">
        <SliderRow label="音量" value={p.gainDb ?? 0} min={-30} max={12} step={1} suffix="dB" onLive={(v) => live({ gainDb: v })} onCommit={commit} />
        <SliderRow label="淡入" value={p.fadeIn ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ fadeIn: v })} onCommit={commit} />
        <SliderRow label="淡出" value={p.fadeOut ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ fadeOut: v })} onCommit={commit} />
        <Toggle label="响度归一（loudnorm）" checked={!!p.loudnorm} onChange={(v) => set({ loudnorm: v })} />
        <Toggle label="人声降噪" checked={!!p.denoise} onChange={(v) => set({ denoise: v })} />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] opacity-60">区间静音（{ranges.length}）</span>
          <button onClick={() => set({ muteRanges: [...ranges, { start: Math.min(playhead, dur - 0.5), end: Math.min(playhead + 2, dur) }] })}
            className="text-[11px] flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-500/25">
            <Plus size={11} /> 在播放头加
          </button>
        </div>
        {ranges.map((r, i) => (
          <div key={i} className="rounded-md border p-2 flex flex-col gap-1" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="flex items-center text-[11px]">
              <span className="opacity-50">静音 #{i + 1}</span>
              <span className="ml-2 tabular-nums opacity-60">{fmt(r.start)}–{fmt(r.end)}</span>
              <button onClick={() => set({ muteRanges: ranges.filter((_, k) => k !== i) })} className="ml-auto opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
            </div>
            <SliderRow label="起" value={r.start} min={0} max={dur} step={0.1} suffix="s"
              onLive={(v) => live({ muteRanges: ranges.map((x, k) => (k === i ? { start: Math.min(v, x.end - 0.1), end: x.end } : x)) })} onCommit={commit} />
            <SliderRow label="止" value={r.end} min={0} max={dur} step={0.1} suffix="s"
              onLive={(v) => live({ muteRanges: ranges.map((x, k) => (k === i ? { start: x.start, end: Math.max(v, x.start + 0.1) } : x)) })} onCommit={commit} />
          </div>
        ))}
        <AudioBgmEditor op={op} p={p} />
      </div>
    )
  }
  if (op.kind === 'export') {
    const p = op.params as ExportParams
    const resVal = p.outW && p.outH ? `${p.outW}x${p.outH}` : 'follow'
    return (
      <div className="flex flex-col gap-2.5">
        <Row label="平台预设">
          <Select className="flex-1" value={p.platform || 'none'} onChange={(v) => {
            if (v === 'none') return set({ platform: undefined })
            const pr = PLATFORM_PRESETS.find((x) => x.id === v)
            if (pr) set({ platform: pr.id, outW: pr.w, outH: pr.h, fps: pr.fps, crf: pr.crf, fit: pr.fit })
          }} options={[{ value: 'none', label: '自定义' }, ...PLATFORM_PRESETS.map((pr) => ({ value: pr.id, label: pr.label, hint: pr.ratio }))]} />
        </Row>
        <Row label="格式">
          <Select className="flex-1" value={p.format} onChange={(v) => set({ format: v })} options={[
            { value: 'mp4', label: 'MP4 (H.264)' }, { value: 'webm', label: 'WebM (VP9)' }, { value: 'gif', label: 'GIF 动图' }, { value: 'webp', label: 'WebP 动图' }
          ]} />
        </Row>
        <Row label="分辨率">
          <Select className="flex-1" value={resVal} onChange={(v) => {
            if (v === 'follow') return set({ outW: undefined, outH: undefined, platform: undefined })
            const [w, h] = v.split('x').map(Number)
            set({ outW: w, outH: h, platform: undefined })
          }} options={RES_OPTIONS.map((r) => ({ value: r.value, label: r.label }))} />
        </Row>
        {(p.format === 'mp4' || p.format === 'webm') && (
          <SliderRow label="画质 CRF" value={p.crf ?? 23} min={16} max={34} step={1} onLive={(v) => live({ crf: v })} onCommit={commit} />
        )}
        <Row label="帧率">
          <Select className="flex-1" value={String(p.fps || 'src')} onChange={(v) => set({ fps: v === 'src' ? undefined : Number(v) })} options={[
            { value: 'src', label: '跟随原视频' }, { value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '12', label: '12 fps（动图）' }
          ]} />
        </Row>
        <SliderRow label="淡入" value={p.fadeIn ?? 0} min={0} max={3} step={0.1} suffix="s" onLive={(v) => live({ fadeIn: v })} onCommit={commit} />
        <SliderRow label="淡出" value={p.fadeOut ?? 0} min={0} max={3} step={0.1} suffix="s" onLive={(v) => live({ fadeOut: v })} onCommit={commit} />
        <div className="text-[10px] opacity-50 leading-relaxed">导出为画布上的一张新卡片，源卡保留；编辑配方写入卡片可二次编辑。</div>
      </div>
    )
  }
  return null
}

// ---- 字幕：cue 序列编辑 + .srt 导入 ----
function srtTime(t: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0
}
function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = text.replace(/\r/g, '').split(/\n\n+/)
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '')
    const tl = lines.find((l) => l.includes('-->'))
    if (!tl) continue
    const [a, b2] = tl.split('-->')
    const start = srtTime(a.trim())
    const end = srtTime(b2.trim())
    const txt = lines.slice(lines.indexOf(tl) + 1).join('\n').trim()
    if (txt && end > start) cues.push({ start, end, text: txt })
  }
  return cues
}

function SubtitlePanel({ op, params, dur, playhead }: { op: EditOp; params: OverlayParams; dur: number; playhead: number }) {
  const cues = params.cues || []
  const style = (params.style || {}) as Record<string, unknown>
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const setCues = (c: SubtitleCue[]) => set({ cues: c })
  const setStyle = (patch: Record<string, unknown>) => set({ style: { ...style, ...patch } })

  const addCue = () => {
    const start = Math.min(playhead, dur - 0.5)
    setCues([...cues, { start, end: Math.min(start + 2, dur), text: '字幕内容' }].sort((a, b) => a.start - b.start))
  }
  const importSrt = async () => {
    const m = window.mulby
    try {
      const paths = await m?.dialog?.showOpenDialog({ title: '导入 .srt 字幕', filters: [{ name: '字幕', extensions: ['srt', 'vtt', 'txt'] }], properties: ['openFile'] })
      if (!paths?.[0]) return
      const b64 = (await m.filesystem.readFile(paths[0], 'base64')) as string
      const buf = base64ToArrayBuffer(b64)
      let text = new TextDecoder('utf-8').decode(buf)
      if (text.includes('�')) { try { text = new TextDecoder('gbk').decode(buf) } catch { /* keep utf-8 */ } }
      const parsed = parseSrt(text)
      if (parsed.length) { setCues(parsed); toast(`已导入 ${parsed.length} 条字幕`, 'success') }
      else toast('未解析到字幕', 'error')
    } catch { toast('导入失败', 'error') }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button onClick={addCue} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25"><Plus size={11} /> 在播放头加</button>
        <button onClick={importSrt} className="px-2 py-1 rounded text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10">导入 .srt</button>
        <span className="text-[10px] opacity-50 ml-auto">{cues.length} 条</span>
      </div>
      <div className="flex items-center gap-2">
        <Row label="字号">
          <input type="range" min={16} max={120} step={2} value={Number(style.fontSize) || 44} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} className="flex-1" />
        </Row>
        <input type="color" value={String(style.color || '#ffffff')} onChange={(e) => setStyle({ color: e.target.value })} className="w-7 h-6 rounded" />
      </div>
      <SliderRow label="垂直位置" value={params.rect.y} min={0} max={0.95} step={0.01} onLive={(v) => useStudio.getState().updateOpLive(op.id, { rect: { ...params.rect, y: v } })} onCommit={() => useStudio.getState().commitLive()} />
      <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-auto ace-scroll">
        {cues.map((c, i) => {
          const active = playhead >= c.start && playhead <= c.end
          return (
            <div key={i} className={`rounded-md border p-1.5 flex flex-col gap-1 ${active ? 'ring-1 ring-pink-500' : ''}`} style={{ borderColor: 'var(--ace-border)' }}>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="tabular-nums opacity-60">{fmt(c.start)}–{fmt(c.end)}</span>
                <button onClick={() => setCues(cues.filter((_, k) => k !== i))} className="ml-auto opacity-50 hover:opacity-100"><Trash2 size={11} /></button>
              </div>
              <input value={c.text} onChange={(e) => setCues(cues.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} className="rounded px-1.5 py-0.5 text-xs bg-black/5 dark:bg-white/10 outline-none" />
              <div className="flex items-center gap-1">
                <input type="number" step={0.1} value={c.start.toFixed(1)} onChange={(e) => setCues(cues.map((x, k) => (k === i ? { ...x, start: Math.max(0, Math.min(Number(e.target.value), x.end - 0.1)) } : x)))} className="w-16 rounded px-1 py-0.5 text-[10px] bg-black/5 dark:bg-white/10 outline-none tabular-nums" />
                <span className="text-[10px] opacity-40">→</span>
                <input type="number" step={0.1} value={c.end.toFixed(1)} onChange={(e) => setCues(cues.map((x, k) => (k === i ? { ...x, end: Math.min(dur, Math.max(Number(e.target.value), x.start + 0.1)) } : x)))} className="w-16 rounded px-1 py-0.5 text-[10px] bg-black/5 dark:bg-white/10 outline-none tabular-nums" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- trim 多段编辑 ----
function TrimPanel({ op, params, dur, playhead }: { op: EditOp; params: TrimParams; dur: number; playhead: number }) {
  const segs = params.segments || []
  const set = (segments: TrimParams['segments']) => useStudio.getState().updateOp(op.id, { segments })
  const splitAtPlayhead = () => {
    const t = playhead
    const idx = segs.findIndex((s) => t > s.in + 0.05 && t < s.out - 0.05)
    if (idx < 0) return
    const s = segs[idx]
    const next = [...segs]
    next.splice(idx, 1, { in: s.in, out: t, keep: s.keep }, { in: t, out: s.out, keep: s.keep })
    set(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button onClick={splitAtPlayhead} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25">
          <Scissors size={12} /> 在播放头切一刀
        </button>
        <button onClick={() => set([...segs, { in: 0, out: dur || 1, keep: true }])} className="px-2 py-1 rounded text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10"><Plus size={11} className="inline" /> 片段</button>
      </div>
      {segs.map((s, i) => (
        <div key={i} className="rounded-md border p-2 flex flex-col gap-1.5" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="opacity-50">#{i + 1}</span>
            <button onClick={() => set(segs.map((x, k) => (k === i ? { ...x, keep: !x.keep } : x)))}
              className={`px-1.5 py-0.5 rounded text-[10px] ${s.keep ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/20 text-rose-600 dark:text-rose-300'}`}>
              {s.keep ? '保留' : '删除'}
            </button>
            <span className="tabular-nums opacity-60">{fmt(s.in)}–{fmt(s.out)} · {(s.out - s.in).toFixed(1)}s</span>
            <button onClick={() => set(segs.filter((_, k) => k !== i))} className="ml-auto opacity-50 hover:opacity-100" disabled={segs.length <= 1}><Trash2 size={12} /></button>
          </div>
          <SliderRow label="起" value={s.in} min={0} max={dur} step={0.1} suffix="s"
            onLive={(v) => useStudio.getState().updateOpLive(op.id, { segments: segs.map((x, k) => (k === i ? { ...x, in: Math.min(v, x.out - 0.1) } : x)) })}
            onCommit={() => useStudio.getState().commitLive()} />
          <SliderRow label="止" value={s.out} min={0} max={dur} step={0.1} suffix="s"
            onLive={(v) => useStudio.getState().updateOpLive(op.id, { segments: segs.map((x, k) => (k === i ? { ...x, out: Math.max(v, x.in + 0.1) } : x)) })}
            onCommit={() => useStudio.getState().commitLive()} />
        </div>
      ))}
      <div className="text-[10px] opacity-50">保留段按顺序拼接为成片；删除段被剔除。</div>
    </div>
  )
}

// ---- 配乐 / AI 旁白 ----
function AudioBgmEditor({ op, p }: { op: EditOp; p: AudioParams }) {
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const board = useGraph((s) => s.getActiveBoard())
  const selfId = useUi((s) => s.studioCardId)
  const audioCards = Object.values(board.cards).filter((c) => c.kind === 'audio' && !!c.assetLocalPath && c.id !== selfId)
  const [ttsText, setTtsText] = useState('')
  const [ttsBusy, setTtsBusy] = useState(false)
  const bgm = p.bgm

  const pickCard = (id: string) => {
    const c = board.cards[id]
    if (c?.assetLocalPath) set({ bgm: { path: c.assetLocalPath, source: 'card', cardId: id, volume: 0.6, offset: 0, mode: 'mix' } })
  }
  const genTts = async () => {
    if (!ttsText.trim()) return
    const cfg = useProviders.getState().activeFor('audio')
    if (!cfg) { toast('请先在 Provider 设置里配置音频 / TTS 服务', 'error'); return }
    setTtsBusy(true)
    try {
      const key = await useProviders.getState().getKey(cfg.id)
      const r = await runTts(cfg, key, ttsText.trim(), { projectId: useGraph.getState().project.id })
      set({ bgm: { path: r.path, source: 'tts', text: ttsText.trim(), volume: 1, offset: 0, mode: 'mix' } })
      toast('配音已生成', 'success')
    } catch (e: any) {
      toast('配音失败：' + (e?.message || String(e)), 'error')
    } finally {
      setTtsBusy(false)
    }
  }

  return (
    <div className="rounded-md border p-2 flex flex-col gap-2 mt-1" style={{ borderColor: 'var(--ace-border)' }}>
      <span className="text-[11px] font-medium opacity-70 flex items-center gap-1"><Music size={12} /> 配乐 / 旁白</span>
      {bgm ? (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate flex-1">{bgm.source === 'tts' ? '🎙 ' + (bgm.text || 'AI 配音') : '🎵 ' + (board.cards[bgm.cardId || '']?.title || '音频卡')}</span>
            <button onClick={() => set({ bgm: undefined })} className="opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
          </div>
          <Row label="关系">
            <Select className="flex-1" value={bgm.mode} onChange={(v) => set({ bgm: { ...bgm, mode: v as 'mix' | 'replace' | 'duck' } })}
              options={[{ value: 'mix', label: '混音（叠在原声上）' }, { value: 'replace', label: '替换原声' }, { value: 'duck', label: '闪避（说话时压低）' }]} />
          </Row>
          <SliderRow label="音量" value={bgm.volume ?? 1} min={0} max={2} step={0.05} onLive={(v) => useStudio.getState().updateOpLive(op.id, { bgm: { ...bgm, volume: v } })} onCommit={() => useStudio.getState().commitLive()} />
          <SliderRow label="延迟" value={bgm.offset ?? 0} min={0} max={10} step={0.1} suffix="s" onLive={(v) => useStudio.getState().updateOpLive(op.id, { bgm: { ...bgm, offset: v } })} onCommit={() => useStudio.getState().commitLive()} />
        </>
      ) : (
        <>
          {audioCards.length > 0 && (
            <Row label="选音频卡">
              <Select className="flex-1" value="" placeholder="画布上的音频卡" onChange={pickCard} options={audioCards.map((c) => ({ value: c.id, label: c.title || '音频' }))} />
            </Row>
          )}
          <div className="flex flex-col gap-1">
            <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={2} placeholder="AI 配音文案…" className="rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10 outline-none resize-none" />
            <button onClick={genTts} disabled={ttsBusy || !ttsText.trim()} className="self-start flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-amber-500/15 text-amber-600 dark:text-amber-300 hover:bg-amber-500/25 disabled:opacity-40">
              {ttsBusy ? <Loader2 size={11} className="animate-spin" /> : <Music size={11} />} 生成 AI 配音
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---- overlay 叠加编辑（文字/水印/贴纸/打码）----
function OverlayPanel({ op, params, dur, playhead }: { op: EditOp; params: OverlayParams; dur: number; playhead: number }) {
  const p = params
  if (p.sub === 'subtitle') return <SubtitlePanel op={op} params={p} dur={dur} playhead={playhead} />
  const live = (patch: Record<string, unknown>) => useStudio.getState().updateOpLive(op.id, patch)
  const commit = () => useStudio.getState().commitLive()
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const setRect = (patch: Partial<OverlayParams['rect']>) => live({ rect: { ...p.rect, ...patch } })
  const setStyle = (patch: Record<string, unknown>) => set({ style: { ...(p.style || {}), ...patch } })
  const style = (p.style || {}) as Record<string, unknown>
  const isText = p.sub === 'text' || p.sub === 'watermark' || p.sub === 'sticker'
  const rangeOn = !!p.range
  const board = useGraph((s) => s.getActiveBoard())
  const selfId = useUi((s) => s.studioCardId)
  const videoCards = Object.values(board.cards).filter((c) => c.kind === 'video' && !!c.assetLocalPath && c.id !== selfId)

  if (p.sub === 'timecode') {
    const ts = (p.style || {}) as Record<string, unknown>
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] font-medium opacity-70">时间码</div>
        <Row label="颜色"><input type="color" value={String(ts.color || '#ffffff')} onChange={(e) => set({ style: { ...ts, color: e.target.value } })} className="w-8 h-6 rounded" /></Row>
        <SliderRow label="位置 X" value={p.rect.x} min={0} max={1} step={0.01} onLive={(v) => live({ rect: { ...p.rect, x: Math.min(v, 1 - p.rect.w) } })} onCommit={commit} />
        <SliderRow label="位置 Y" value={p.rect.y} min={0} max={1} step={0.01} onLive={(v) => live({ rect: { ...p.rect, y: Math.min(v, 1 - p.rect.h) } })} onCommit={commit} />
        <div className="text-[10px] opacity-50">显示从 0 开始的运行时间（M:SS），随播放推进。</div>
      </div>
    )
  }
  if (p.sub === 'progress') {
    const ps = (p.style || {}) as Record<string, unknown>
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] font-medium opacity-70">播放进度条</div>
        <Row label="颜色"><input type="color" value={String(ps.color || '#ff2d55')} onChange={(e) => set({ style: { ...ps, color: e.target.value } })} className="w-8 h-6 rounded" /></Row>
        <SliderRow label="粗细" value={Number(ps.heightPct) || 0.014} min={0.004} max={0.05} step={0.002} onLive={(v) => live({ style: { ...ps, heightPct: v } })} onCommit={commit} />
        <SliderRow label="垂直位置" value={p.rect.y} min={0} max={0.98} step={0.01} onLive={(v) => live({ rect: { ...p.rect, y: v } })} onCommit={commit} />
      </div>
    )
  }
  if (p.sub === 'frame') {
    const fs = (p.style || {}) as Record<string, unknown>
    const setFs = (patch: Record<string, unknown>) => set({ style: { ...fs, ...patch } })
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] font-medium opacity-70">相框 / 边框</div>
        <Row label="颜色">
          <input type="color" value={String(fs.color || '#ffffff')} onChange={(e) => setFs({ color: e.target.value })} className="w-8 h-6 rounded" />
        </Row>
        <SliderRow label="粗细" value={Number(fs.widthPct) || 0.03} min={0.005} max={0.12} step={0.005} onLive={(v) => live({ style: { ...fs, widthPct: v } })} onCommit={commit} />
        <SliderRow label="圆角" value={Number(fs.radiusPct) || 0} min={0} max={0.2} step={0.01} onLive={(v) => live({ style: { ...fs, radiusPct: v } })} onCommit={commit} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11px] font-medium opacity-70">{p.sub === 'mosaic' ? '局部打码' : p.sub === 'pip' ? '画中画 PiP' : p.sub === 'watermark' ? '水印' : p.sub === 'sticker' ? '贴纸/Emoji' : '文字'}</div>
      {p.sub === 'pip' && (
        <>
          <Row label="来源">
            <Select className="flex-1" value={p.pipCardId || ''} onChange={(v) => set({ pipCardId: v })} placeholder="选择画布上的视频卡"
              options={videoCards.map((c) => ({ value: c.id, label: c.title || '视频' }))} />
          </Row>
          <SliderRow label="大小" value={p.rect.w} min={0.1} max={0.6} step={0.01} onLive={(v) => setRect({ w: Math.min(v, 1 - p.rect.x), h: Math.min(v, 1 - p.rect.y) })} onCommit={commit} />
          {!videoCards.length && <div className="text-[10px] text-amber-500">画布上需另有视频卡作为子画面来源。</div>}
        </>
      )}
      {isText && (
        <>
          <Row label="内容">
            <input value={p.text || ''} onChange={(e) => set({ text: e.target.value })} className="flex-1 rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10 outline-none" placeholder="文字…" />
          </Row>
          <Row label="字号">
            <input type="range" min={12} max={160} step={2} value={Number(style.fontSize) || 48} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} className="flex-1" />
            <span className="w-10 text-right tabular-nums opacity-70">{Number(style.fontSize) || 48}</span>
          </Row>
          <Row label="颜色">
            <input type="color" value={String(style.color || '#ffffff')} onChange={(e) => setStyle({ color: e.target.value })} className="w-8 h-6 rounded" />
            <Toggle label="居中" checked={style.align === 'center'} onChange={(v) => setStyle({ align: v ? 'center' : 'left' })} />
            <Toggle label="描边" checked={style.stroke !== false} onChange={(v) => setStyle({ stroke: v })} />
          </Row>
        </>
      )}
      {p.sub === 'mosaic' && (
        <>
          <Row label="方式">
            <div className="flex gap-1">
              <button onClick={() => set({ blurKind: 'mosaic' })} className={`px-2 py-0.5 rounded text-[10px] ${p.blurKind !== 'blur' ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>马赛克</button>
              <button onClick={() => set({ blurKind: 'blur' })} className={`px-2 py-0.5 rounded text-[10px] ${p.blurKind === 'blur' ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>模糊</button>
            </div>
          </Row>
          <SliderRow label="强度" value={p.pixelSize || 14} min={4} max={40} step={1} onLive={(v) => live({ pixelSize: v })} onCommit={commit} />
          <SliderRow label="宽" value={p.rect.w} min={0.05} max={1} step={0.01} onLive={(v) => setRect({ w: Math.min(v, 1 - p.rect.x) })} onCommit={commit} />
          <SliderRow label="高" value={p.rect.h} min={0.05} max={1} step={0.01} onLive={(v) => setRect({ h: Math.min(v, 1 - p.rect.y) })} onCommit={commit} />
        </>
      )}
      <SliderRow label="位置 X" value={p.rect.x} min={0} max={1} step={0.01} onLive={(v) => setRect({ x: Math.min(v, 1 - p.rect.w) })} onCommit={commit} />
      <SliderRow label="位置 Y" value={p.rect.y} min={0} max={1} step={0.01} onLive={(v) => setRect({ y: Math.min(v, 1 - p.rect.h) })} onCommit={commit} />
      {isText && <SliderRow label="盒宽" value={p.rect.w} min={0.1} max={1} step={0.01} onLive={(v) => setRect({ w: Math.min(v, 1 - p.rect.x) })} onCommit={commit} />}
      <Toggle label="限定时间段（默认全程）" checked={rangeOn} onChange={(v) => set({ range: v ? { start: 0, end: Math.min(3, dur || 3) } : undefined })} />
      {rangeOn && p.range && (
        <>
          <SliderRow label="起" value={p.range.start} min={0} max={dur} step={0.1} suffix="s" onLive={(v) => live({ range: { start: Math.min(v, p.range!.end - 0.1), end: p.range!.end } })} onCommit={commit} />
          <SliderRow label="止" value={p.range.end} min={0} max={dur} step={0.1} suffix="s" onLive={(v) => live({ range: { start: p.range!.start, end: Math.max(v, p.range!.start + 0.1) } })} onCommit={commit} />
        </>
      )}
    </div>
  )
}
