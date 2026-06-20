import type { ReactNode } from 'react'
import { Trash2, Sparkles, Square, X, Download } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { collectRefCards } from '../services/references'
import { generateCard, stopCard, canGenerate } from '../services/generate'
import { ModelPicker } from './ModelPicker'
import { MediaToolbox } from './MediaToolbox'
import { useProviders } from '../store/providerStore'
import { useUi } from '../store/uiStore'
import type { CardKind } from '../types'

const KIND_LABEL: Record<string, string> = {
  image: 'AI 图片',
  video: 'AI 视频',
  text: 'AI 文本',
  audio: 'AI 音频',
  source: '素材'
}
const KIND_ACCENT: Record<CardKind, string> = {
  image: '#6366f1',
  video: '#ec4899',
  text: '#10b981',
  audio: '#f59e0b',
  source: '#64748b'
}

export function Inspector() {
  const selectedIds = useGraph((s) => s.selectedIds)
  const board = useGraph((s) => s.getActiveBoard())
  const updateCard = useGraph((s) => s.updateCard)
  const removeCards = useGraph((s) => s.removeCards)
  const removeEdge = useGraph((s) => s.removeEdge)

  if (selectedIds.length === 0) {
    return (
      <Panel>
        <div className="text-xs opacity-50 leading-relaxed p-1">
          选中一张卡片以编辑与生成。
          <br />
          <br />
          双击空白新建文本卡 · 左侧添加卡片 · 拖卡片右侧圆点连线作引用 · 拖文件/粘贴图片导入素材 · 滚轮缩放 · 空格平移 · 框选多选 · Ctrl+C/V 复制粘贴 · Ctrl+Z 撤销。
        </div>
      </Panel>
    )
  }
  if (selectedIds.length > 1) {
    return (
      <Panel>
        <div className="flex items-center justify-between">
          <span className="text-xs opacity-60">已选中 {selectedIds.length} 张卡片</span>
          <button
            onClick={() => removeCards(selectedIds)}
            className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-500/10 px-2 py-1 rounded-md"
          >
            <Trash2 size={13} /> 删除
          </button>
        </div>
      </Panel>
    )
  }

  const card = board.cards[selectedIds[0]]
  if (!card) {
    return (
      <Panel>
        <div className="text-xs opacity-50">—</div>
      </Panel>
    )
  }

  const generatable = canGenerate(card.kind)
  const busy = card.status === 'running' || card.status === 'queued'
  const refCards = collectRefCards(card, board)
  const others = Object.values(board.cards).filter((c) => c.id !== card.id && !refCards.some((r) => r.id === c.id))

  const addRef = (id: string) => updateCard(card.id, { refIds: Array.from(new Set([...card.refIds, id])) })
  const removeRef = (id: string) => {
    if (card.refIds.includes(id)) {
      updateCard(card.id, { refIds: card.refIds.filter((x) => x !== id) })
    } else {
      for (const e of Object.values(board.edges)) {
        if (e.target === card.id && e.source === id) removeEdge(e.id)
      }
    }
  }

  const exportCard = async () => {
    const m = (window as any).mulby
    if (!m?.dialog || !card.assetLocalPath) return
    const ext = card.assetLocalPath.split('.').pop() || 'png'
    try {
      const dest = await m.dialog.showSaveDialog({
        defaultPath: `${card.title}.${ext}`,
        filters: [{ name: '文件', extensions: [ext] }]
      })
      if (dest) {
        await m.filesystem.copy(card.assetLocalPath, dest)
        m.notification?.show?.('已导出：' + dest, 'success')
      }
    } catch {
      m.notification?.show?.('导出失败', 'error')
    }
  }

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <span className="text-[11px] px-1.5 py-0.5 rounded text-white" style={{ background: KIND_ACCENT[card.kind] }}>
          {KIND_LABEL[card.kind] ?? card.kind}
        </span>
        <div className="flex items-center gap-1">
          {card.assetLocalPath && (
            <button
              onClick={exportCard}
              title="导出 / 下载"
              className="opacity-70 hover:opacity-100 px-2 py-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Download size={13} />
            </button>
          )}
          <button
            onClick={() => removeCards([card.id])}
            title="删除卡片"
            className="text-red-500 hover:bg-red-500/10 px-2 py-1 rounded-md"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <Field label="标题">
        <input value={card.title} onChange={(e) => updateCard(card.id, { title: e.target.value })} className="ace-input" />
      </Field>

      {card.kind !== 'source' && (
        <Field label="提示词">
          <textarea
            value={card.prompt}
            onChange={(e) => updateCard(card.id, { prompt: e.target.value })}
            rows={5}
            placeholder={card.kind === 'text' ? '让 AI 写点什么（分镜脚本 / 文案 / 提示词扩写）…' : '描述你想生成的画面…'}
            className="ace-input resize-none"
          />
        </Field>
      )}

      {generatable && (
        <>
          <Field label="引用（@ 参考其它卡片）">
            <div className="flex flex-wrap gap-1">
              {refCards.length === 0 && <span className="text-[11px] opacity-40">无 · 连线或下拉添加</span>}
              {refCards.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 text-[11px] pl-1.5 pr-1 py-0.5 rounded bg-black/5 dark:bg-white/10"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: KIND_ACCENT[r.kind] }} />
                  <span className="max-w-[120px] truncate">{r.title}</span>
                  <button onClick={() => removeRef(r.id)} className="opacity-60 hover:opacity-100">
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            {others.length > 0 && (
              <select
                className="ace-input mt-1"
                value=""
                onChange={(e) => {
                  if (e.target.value) addRef(e.target.value)
                }}
              >
                <option value="">+ 添加引用…</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {KIND_LABEL[c.kind]}：{c.title}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {card.kind === 'text' || card.kind === 'image' ? (
            <Field label="模型">
              <ModelPicker
                kind={card.kind as 'text' | 'image'}
                value={card.modelId}
                onChange={(id) => updateCard(card.id, { modelId: id })}
              />
            </Field>
          ) : (
            <ProviderHintInline kind={card.kind as 'video' | 'audio'} />
          )}

          {card.error && <div className="text-[11px] text-red-500 bg-red-500/10 rounded p-2">{card.error}</div>}

          {busy ? (
            <button
              onClick={() => stopCard(card.id)}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium"
            >
              <Square size={14} /> 停止生成 {card.progress ? `(${Math.round(card.progress * 100)}%)` : ''}
            </button>
          ) : (
            <button
              onClick={() => generateCard(card.id)}
              className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium"
            >
              <Sparkles size={14} /> 生成
            </button>
          )}
        </>
      )}

      {(card.kind === 'image' || card.kind === 'source' || card.kind === 'video') &&
        (card.assetUrl || card.assetLocalPath) && <MediaToolbox card={card} />}

      {card.kind === 'text' && card.text && (
        <Field label="产物">
          <div className="text-[12px] max-h-48 overflow-auto ace-scroll whitespace-pre-wrap rounded-md bg-black/5 dark:bg-white/5 p-2">
            {card.text}
          </div>
        </Field>
      )}
    </Panel>
  )
}

function ProviderHintInline({ kind }: { kind: 'video' | 'audio' }) {
  const active = useProviders((s) => s.activeFor(kind))
  return (
    <div className="text-[11px] rounded bg-black/5 dark:bg-white/5 p-2 flex items-center justify-between gap-2">
      <span className="opacity-70">{active ? `Provider：${active.label}` : `未配置${kind === 'video' ? '视频' : '音频'} Provider`}</span>
      <button onClick={() => useUi.getState().setShowProviderSettings(true)} className="text-indigo-500 hover:underline shrink-0">
        设置
      </button>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      className="w-[300px] shrink-0 border-l bg-white/70 dark:bg-neutral-900/70 p-3 flex flex-col gap-3 overflow-y-auto ace-scroll"
      style={{ borderColor: 'var(--ace-border)' }}
    >
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium opacity-60">{label}</span>
      {children}
    </label>
  )
}
