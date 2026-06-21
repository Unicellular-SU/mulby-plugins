import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import { Trash2, Sparkles, Square, Download, X, Link2, Plus, Image as ImageIcon, Video, Type as TypeIcon, Music, Clapperboard, Film, Wand2, ScanText, Loader2 } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { useProviders } from '../store/providerStore'
import { buildMaterials } from '../services/references'
import { generateCard, stopCard, canGenerate } from '../services/generate'
import { shotToVideo } from '../services/storyboard'
import { enhancePrompt, describeImage } from '../services/promptTools'
import { PROMPT_PRESETS } from '../services/presets'
import { saveBase64 } from '../services/media'
import { arrayBufferToBase64, uid } from '../util'
import { worldToScreen } from './viewport'
import { stageEl } from './stageEl'
import { ModelPicker } from '../components/ModelPicker'
import { MediaToolbox } from '../components/MediaToolbox'
import { ParamControls } from '../components/ParamControls'
import type { Material, MaterialKind, NodeAsset } from '../types'

const KIND_ACCENT: Record<string, string> = { image: '#6366f1', video: '#ec4899', text: '#10b981', audio: '#f59e0b', source: '#64748b' }
const MAT_ICON: Record<MaterialKind, typeof ImageIcon> = { image: ImageIcon, video: Video, audio: Music, text: TypeIcon }
const PANEL_W = 480

interface MentionState {
  mode: 'ref' | 'preset'
  query: string
  start: number
  end: number
  ax: number
  ayB: number
  ayT: number
  aw: number
}

function ProviderHintInline({ kind }: { kind: 'video' | 'audio' }) {
  const active = useProviders((s) => s.activeFor(kind))
  return (
    <div className="flex-1 min-w-[130px] text-[11px] rounded-md bg-black/5 dark:bg-white/5 px-2 py-1.5 flex items-center justify-between gap-2">
      <span className="opacity-70 truncate">{active ? `Provider：${active.label}` : `未配置 Provider`}</span>
      <button onClick={() => useUi.getState().setShowProviderSettings(true)} className="text-indigo-500 hover:underline shrink-0">设置</button>
    </div>
  )
}

export function NodeEditor() {
  const selectedIds = useGraph((s) => s.selectedIds)
  const board = useGraph((s) => s.getActiveBoard())
  const ss = useUi((s) => s.stageSize)
  const updateCard = useGraph((s) => s.updateCard)
  const removeCards = useGraph((s) => s.removeCards)
  const removeEdge = useGraph((s) => s.removeEdge)
  const fileRef = useRef<HTMLInputElement>(null)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [toolBusy, setToolBusy] = useState(false)

  if (selectedIds.length !== 1) return null
  const card = board.cards[selectedIds[0]]
  if (!card) return null
  if (card.kind === 'group') return null

  const vp = board.viewport
  const accent = KIND_ACCENT[card.kind]
  const materials = buildMaterials(card, board)
  const generatable = canGenerate(card.kind)
  const busy = card.status === 'running' || card.status === 'queued'
  const hasMedia = !!(card.assetUrl || card.assetLocalPath)

  // 定位：节点下方优先，空间不足翻到上方；左右夹取
  const bottom = worldToScreen(card.x + card.w / 2, card.y + card.h, vp)
  const topS = worldToScreen(card.x + card.w / 2, card.y, vp)
  const left = Math.max(8, Math.min(bottom.x - PANEL_W / 2, ss.w - PANEL_W - 8))
  const placeBelow = ss.h - (bottom.y + 8) >= 170
  const posTop = placeBelow ? bottom.y + 8 : undefined
  const posBottom = placeBelow ? undefined : Math.max(8, ss.h - (topS.y - 8))
  const maxH = placeBelow ? Math.max(160, ss.h - (bottom.y + 8) - 8) : Math.max(160, topS.y - 8 - 8)

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const projectId = useGraph.getState().project.id
    const added: NodeAsset[] = []
    for (const file of Array.from(files)) {
      const mime = file.type || ''
      const kind: MaterialKind = mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image'
      try {
        const buf = await file.arrayBuffer()
        const b64 = arrayBufferToBase64(buf)
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const saved = await saveBase64(projectId, 'upload', b64, ext)
        added.push({ id: uid('a'), kind, url: saved.url, localPath: saved.path, mime, name: file.name })
      } catch {
        /* skip */
      }
    }
    if (added.length) updateCard(card.id, { assets: [...card.assets, ...added] })
    if (fileRef.current) fileRef.current.value = ''
  }

  const removeMaterial = (m: Material) => {
    if (m.origin === 'upload') updateCard(card.id, { assets: card.assets.filter((a) => 'upload:' + a.id !== m.matId) })
    else if (m.origin === 'card') updateCard(card.id, { refIds: card.refIds.filter((id) => 'card:' + id !== m.matId) })
    else for (const e of Object.values(board.edges)) if (e.target === card.id && e.source === m.cardId) removeEdge(e.id)
  }

  const insertToken = (label: string, start: number, end: number) => {
    const val = card.prompt
    updateCard(card.id, { prompt: val.slice(0, start) + '@' + label + ' ' + val.slice(end) })
    setMention(null)
  }
  const insertPreset = (text: string, start: number, end: number) => {
    const val = card.prompt
    const sep = start > 0 && !/\s$/.test(val.slice(0, start)) ? ' ' : ''
    updateCard(card.id, { prompt: val.slice(0, start) + sep + text + ' ' + val.slice(end) })
    setMention(null)
  }
  const runTool = async (fn: (id: string) => Promise<void>) => {
    setToolBusy(true)
    try {
      await fn(card.id)
    } catch (e: any) {
      ;(window as any).mulby?.notification?.show?.(e?.message || '操作失败', 'error')
    } finally {
      setToolBusy(false)
    }
  }
  const onPrompt = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const val = ta.value
    const pos = ta.selectionStart ?? val.length
    updateCard(card.id, { prompt: val })
    const before = val.slice(0, pos)
    const at = before.lastIndexOf('@')
    const slash = before.lastIndexOf('/')
    const trig = Math.max(at, slash)
    if (trig >= 0) {
      const q = before.slice(trig + 1)
      if (!/\s/.test(q)) {
        const mode: 'ref' | 'preset' = before[trig] === '/' ? 'preset' : 'ref'
        const r = ta.getBoundingClientRect()
        const sr = stageEl.current?.getBoundingClientRect()
        setMention({ mode, query: q, start: trig, end: pos, ax: r.left - (sr?.left || 0), ayB: r.bottom - (sr?.top || 0), ayT: r.top - (sr?.top || 0), aw: r.width })
        return
      }
    }
    setMention(null)
  }
  const chipInsert = (m: Material) => {
    const val = card.prompt
    const sep = val && !val.endsWith(' ') ? ' ' : ''
    updateCard(card.id, { prompt: val + sep + '@' + m.label + ' ' })
  }

  const exportCard = async () => {
    const m = (window as any).mulby
    if (!m?.dialog || !card.assetLocalPath) return
    const ext = card.assetLocalPath.split('.').pop() || 'png'
    try {
      const dest = await m.dialog.showSaveDialog({ defaultPath: `${card.title}.${ext}`, filters: [{ name: '文件', extensions: [ext] }] })
      if (dest) {
        await m.filesystem.copy(card.assetLocalPath, dest)
        m.notification?.show?.('已导出：' + dest, 'success')
      }
    } catch {
      m.notification?.show?.('导出失败', 'error')
    }
  }

  const hasImageInput = materials.some((m) => m.kind === 'image')
  const refList = mention && mention.mode === 'ref' ? materials.filter((m) => !mention.query || m.label.includes(mention.query)) : []
  const presetList = mention && mention.mode === 'preset' ? PROMPT_PRESETS.filter((p) => !mention.query || p.label.includes(mention.query) || p.text.includes(mention.query)) : []
  const listLen = mention?.mode === 'preset' ? presetList.length : refList.length
  const menuW = mention ? Math.max(200, mention.aw) : 200
  const menuLeft = mention ? Math.max(8, Math.min(mention.ax, ss.w - menuW - 8)) : 0
  const menuBelow = mention ? mention.ayB + 210 <= ss.h : true
  const menuStyle: CSSProperties = mention
    ? menuBelow
      ? { left: menuLeft, top: mention.ayB + 2, width: menuW, maxHeight: 200 }
      : { left: menuLeft, bottom: ss.h - mention.ayT + 2, width: menuW, maxHeight: 200 }
    : {}

  return (
    <>
      <div
        data-interactive
        onWheel={(e) => e.stopPropagation()}
        className="absolute z-30 rounded-xl border bg-white/95 dark:bg-neutral-900/95 backdrop-blur shadow-2xl overflow-hidden text-neutral-800 dark:text-neutral-200"
        style={{ left, top: posTop, bottom: posBottom, width: PANEL_W, borderColor: accent + '55' }}
      >
        <div className="flex flex-col gap-1.5 p-2 overflow-y-auto ace-noscroll" style={{ maxHeight: maxH }}>
          <input
            value={card.title}
            onChange={(e) => updateCard(card.id, { title: e.target.value })}
            placeholder="节点名称（@ 引用时显示此名）"
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:opacity-40 px-0.5"
          />
          {/* 顶行：素材条 + 操作 */}
          <div className="flex items-center gap-1.5">
            <div className="flex-1 flex items-center gap-1 overflow-x-auto ace-noscroll min-w-0">
              {generatable &&
                materials.map((m) => {
                  const Icon = MAT_ICON[m.kind]
                  return (
                    <div
                      key={m.matId}
                      onClick={() => chipInsert(m)}
                      title={`点击插入 @${m.label}`}
                      className="group/chip relative shrink-0 w-9 h-9 rounded-md border bg-black/5 dark:bg-white/5 overflow-hidden cursor-pointer"
                      style={{ borderColor: 'var(--ace-border)' }}
                    >
                      {m.thumbUrl ? (
                        <img src={m.thumbUrl} className="w-full h-full object-cover" draggable={false} alt="" />
                      ) : (
                        <div className="w-full h-full grid place-items-center"><Icon size={13} style={{ color: KIND_ACCENT[m.kind] }} /></div>
                      )}
                      <span className="absolute bottom-0 inset-x-0 text-[8px] leading-[10px] text-white bg-black/55 truncate text-center">{m.label}</span>
                      {m.origin === 'edge' && <Link2 size={8} className="absolute top-0.5 left-0.5 text-white drop-shadow" />}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeMaterial(m) }}
                        className="absolute top-0 right-0 w-3.5 h-3.5 grid place-items-center rounded-bl bg-black/55 text-white opacity-0 group-hover/chip:opacity-100"
                      >
                        <X size={8} />
                      </button>
                    </div>
                  )
                })}
              {generatable && (
                <button
                  onClick={() => fileRef.current?.click()}
                  title="上传素材"
                  className="shrink-0 w-9 h-9 rounded-md border border-dashed grid place-items-center opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                  style={{ borderColor: 'var(--ace-border)' }}
                >
                  <Plus size={15} />
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            </div>
            {card.assetLocalPath && (
              <button onClick={exportCard} title="导出/下载" className="shrink-0 opacity-60 hover:opacity-100 p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
                <Download size={14} />
              </button>
            )}
            <button onClick={() => removeCards([card.id])} title="删除" className="shrink-0 text-red-500 hover:bg-red-500/10 p-1 rounded">
              <Trash2 size={14} />
            </button>
          </div>

          {/* 提示词工具 + 输入 */}
          {card.kind !== 'source' && (
            <>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button onClick={() => runTool(enhancePrompt)} disabled={toolBusy} className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-80 hover:opacity-100 disabled:opacity-40" title="LLM 改写优化提示词">
                  <Wand2 size={12} /> 增强
                </button>
                {hasImageInput && (
                  <button onClick={() => runTool(describeImage)} disabled={toolBusy} className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 opacity-80 hover:opacity-100 disabled:opacity-40" title="用视觉模型把图片反推成提示词">
                    <ScanText size={12} /> 描述图片
                  </button>
                )}
                {toolBusy && <Loader2 size={12} className="animate-spin opacity-60" />}
                <span className="ml-auto opacity-40">/ 预设 · @ 素材</span>
              </div>
              <textarea
                value={card.prompt}
                onChange={onPrompt}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && generatable && !busy) {
                    e.preventDefault()
                    generateCard(card.id)
                  }
                }}
                onBlur={() => setTimeout(() => setMention(null), 150)}
                rows={2}
                placeholder={card.kind === 'text' ? '让 AI 写点什么…（/ 预设，@ 素材）' : '描述画面（/ 预设，@ 素材，Ctrl+Enter 生成）'}
                className="ace-input ace-noscroll resize-y w-full"
              />
            </>
          )}

          {/* 底行：模型/Provider + 参数 + 生成 */}
          {generatable && (
            <div className="flex flex-wrap items-center gap-1.5">
              {card.kind === 'text' || card.kind === 'image' ? (
                <div className="flex-1 min-w-[130px]">
                  <ModelPicker kind={card.kind as 'text' | 'image'} value={card.modelId} onChange={(id) => updateCard(card.id, { modelId: id })} />
                </div>
              ) : (
                <ProviderHintInline kind={card.kind as 'video' | 'audio'} />
              )}
              <ParamControls card={card} />
              {busy ? (
                <button onClick={() => stopCard(card.id)} className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium">
                  <Square size={13} /> {card.progress ? `${Math.round(card.progress * 100)}%` : '停止'}
                </button>
              ) : (
                <button onClick={() => generateCard(card.id)} className="shrink-0 flex items-center gap-1 px-4 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium">
                  <Sparkles size={13} /> 生成
                </button>
              )}
            </div>
          )}

          {card.kind === 'text' && (
            <button
              onClick={() => useUi.getState().setStoryboardCardId(card.id)}
              className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-dashed text-sm hover:bg-black/5 dark:hover:bg-white/10"
              style={{ borderColor: 'var(--ace-border)' }}
            >
              <Clapperboard size={14} /> 分镜脚本（镜头表）
            </button>
          )}

        {card.kind === 'image' && hasMedia && (
          <button
            onClick={() => shotToVideo(card.id)}
            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-dashed text-sm hover:bg-black/5 dark:hover:bg-white/10"
            style={{ borderColor: 'var(--ace-border)' }}
          >
            <Film size={14} /> 转视频（以此为首帧）
          </button>
        )}

        {card.error && <div className="text-[11px] text-red-500 bg-red-500/10 rounded px-2 py-1">{card.error}</div>}

          {hasMedia && <MediaToolbox card={card} />}
        </div>
      </div>

      {/* @素材 / /预设 菜单：屏幕坐标浮层，不受面板裁剪 */}
      {mention && listLen > 0 && (
        <div data-interactive onWheel={(e) => e.stopPropagation()} className="absolute z-50 rounded-md border bg-white dark:bg-neutral-900 shadow-xl overflow-auto ace-noscroll text-neutral-800 dark:text-neutral-200" style={{ ...menuStyle, borderColor: 'var(--ace-border)' }}>
          {mention.mode === 'preset'
            ? presetList.map((p) => (
                <button key={p.label} onMouseDown={(e) => { e.preventDefault(); insertPreset(p.text, mention.start, mention.end) }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 text-left">
                  <Sparkles size={12} className="shrink-0 text-indigo-400" />
                  <span className="shrink-0 font-medium">{p.label}</span>
                  <span className="truncate opacity-50 text-xs">{p.text}</span>
                </button>
              ))
            : refList.map((m) => {
                const Icon = MAT_ICON[m.kind]
                return (
                  <button key={m.matId} onMouseDown={(e) => { e.preventDefault(); insertToken(m.label, mention.start, mention.end) }} className="w-full flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 text-left">
                    {m.thumbUrl ? <img src={m.thumbUrl} className="w-6 h-6 rounded object-cover" alt="" /> : <span className="w-6 h-6 rounded grid place-items-center bg-black/5 dark:bg-white/10"><Icon size={13} style={{ color: KIND_ACCENT[m.kind] }} /></span>}
                    <span className="truncate">{m.label}</span>
                  </button>
                )
              })}
        </div>
      )}
    </>
  )
}
