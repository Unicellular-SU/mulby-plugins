import { useState } from 'react'
import { X, Film, Loader2 } from 'lucide-react'
import { useEscClose } from '../hooks'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { Select } from './Select'
import { composeFilm, ensureFfmpeg, toFileUrl, type FilmTransition } from '../services/mediaVideo'
import type { Card } from '../types'
import { toast } from '../store/toastStore'

const ASPECT_WH: Record<string, [number, number]> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [1024, 1024],
  '4:3': [1024, 768],
  '3:4': [768, 1024]
}

// 选中的视频卡（有本地文件）按画布阅读顺序（行优先）排列
function collectClips(ids: string[], cards: Record<string, Card>): Card[] {
  return ids
    .map((id) => cards[id])
    .filter((c): c is Card => !!c && c.kind === 'video' && !!c.assetLocalPath)
    .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x))
}

export function ComposeModal() {
  const show = useUi((s) => s.showCompose)
  useEscClose(() => useUi.getState().setShowCompose(false))
  if (!show) return null
  return <Inner />
}

function Inner() {
  const board = useGraph((s) => s.getActiveBoard())
  const selectedIds = useGraph((s) => s.selectedIds)
  const [clips] = useState(() => collectClips(selectedIds, board.cards))
  const [audioCard] = useState(() => selectedIds.map((id) => board.cards[id]).find((c) => c && c.kind === 'audio' && c.assetLocalPath))
  const [transition, setTransition] = useState<FilmTransition>('none')
  const [resolution, setResolution] = useState('follow')
  const [fps, setFps] = useState(24)
  const [keepAudio, setKeepAudio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const close = () => {
    if (!busy) useUi.getState().setShowCompose(false)
  }

  const run = async () => {
    if (clips.length < 2) return
    setBusy(true)
    setProgress(0)
    const ok = await ensureFfmpeg()
    if (!ok) {
      setBusy(false)
      return
    }
    let w = 1280
    let h = 720
    if (resolution === 'follow') {
      const a = String(clips[0].params?.aspect || '16:9')
      ;[w, h] = ASPECT_WH[a] || [1280, 720]
    } else {
      const [pw, ph] = resolution.split('x').map(Number)
      w = pw
      h = ph
    }
    try {
      const projectId = useGraph.getState().project.id
      const out = await composeFilm(projectId, {
        clips: clips.map((c) => c.assetLocalPath as string),
        audioPath: audioCard?.assetLocalPath || undefined,
        width: w,
        height: h,
        fps,
        transition,
        useClipAudio: keepAudio,
        onProgress: (p) => setProgress(p)
      })
      const minX = Math.min(...clips.map((c) => c.x))
      const maxX = Math.max(...clips.map((c) => c.x + c.w))
      const maxBottom = Math.max(...clips.map((c) => c.y + c.h))
      const id = useGraph.getState().addCard('video', { x: (minX + maxX) / 2, y: maxBottom + 220 }, {
        title: '成片',
        status: 'done',
        assetUrl: toFileUrl(out),
        assetLocalPath: out,
        mime: 'video/mp4'
      }, board.id)
      useGraph.getState().setSelection([id])
      toast('成片已合成', 'success')
      useUi.getState().setShowCompose(false)
    } catch (e: any) {
      toast('合成失败：' + (e?.message || String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-6" onClick={close}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale w-[420px] max-w-full text-neutral-800 dark:text-neutral-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Film size={16} className="text-emerald-500" /> 合成成片
          </div>
          <button onClick={close} className="opacity-60 hover:opacity-100">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 text-sm">
          {clips.length < 2 ? (
            <div className="text-amber-500 text-xs">请至少选择 2 张已生成的视频卡片再合成。</div>
          ) : (
            <>
              <div className="text-xs opacity-70">
                将按画布顺序拼接 {clips.length} 个片段{audioCard ? '，并叠加所选音频作为背景音。' : '。'}
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
                保留片段原声{audioCard ? '（与背景音混合）' : ''}
              </label>
              <div className="flex items-center gap-2">
                <span className="w-14 text-xs opacity-60 shrink-0">转场</span>
                <Select className="flex-1" value={transition} onChange={(v) => setTransition(v as FilmTransition)} options={[{ value: 'none', label: '硬切' }, { value: 'xfade', label: '交叉淡化' }, { value: 'fade', label: '整片淡入淡出' }]} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 text-xs opacity-60 shrink-0">分辨率</span>
                <Select className="flex-1" value={resolution} onChange={setResolution} options={[{ value: 'follow', label: '跟随首个片段比例' }, { value: '1280x720', label: '1280×720 (16:9)' }, { value: '1920x1080', label: '1920×1080 (16:9)' }, { value: '720x1280', label: '720×1280 (9:16)' }, { value: '1080x1920', label: '1080×1920 (9:16)' }]} />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 text-xs opacity-60 shrink-0">帧率</span>
                <Select className="flex-1" value={String(fps)} onChange={(v) => setFps(Number(v))} options={[{ value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }]} />
              </div>
              {busy && (
                <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
              <button
                onClick={run}
                disabled={busy}
                className="mt-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-60"
              >
                {busy ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> 合成中… {Math.round(progress * 100)}%
                  </>
                ) : (
                  <>
                    <Film size={15} /> 开始合成
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
