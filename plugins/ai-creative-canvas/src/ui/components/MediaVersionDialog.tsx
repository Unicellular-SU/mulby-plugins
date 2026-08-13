import { Check, Columns2, GitBranch, Star, ThumbsDown, X } from 'lucide-react'
import type { Card, MediaVersion, MediaVersionState } from '../types'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { toast } from '../store/toastStore'
import {
  adoptCardMediaVersion,
  branchFromCardMediaVersion,
  readCardMediaVersions,
  setCardVersionCompareSlot,
  setCardVersionDisposition
} from '../services/mediaVersions'
import { Z } from '../zlayers'

function Media({ version, className = '' }: { version: MediaVersion; className?: string }) {
  return version.kind === 'video'
    ? <video src={version.url} controls className={`h-full w-full bg-black object-contain ${className}`} />
    : <img src={version.url} alt={version.label} draggable={false} className={`h-full w-full bg-black/5 object-contain ${className}`} />
}

function Trace({ version }: { version: MediaVersion }) {
  return (
    <div className="space-y-1 text-[11px] opacity-55">
      <div>{version.source === 'generation' ? '生成结果' : version.source === 'reshoot' ? '局部重拍' : version.source === 'edit' ? '剪辑版本' : version.source === 'director' ? '导演 Take' : '导入素材'}</div>
      {(version.providerId || version.modelId) && <div className="truncate">{version.providerId || '默认 Provider'} · {version.modelId || '默认模型'}</div>}
      {version.prompt && <div className="line-clamp-3" title={version.prompt}>输入：{version.prompt}</div>}
    </div>
  )
}

export function VersionWorkspace({
  state,
  onAdopt,
  onDisposition,
  onCompare,
  onBranch
}: {
  state: MediaVersionState
  onAdopt: (id: string) => void
  onDisposition: (id: string, value: MediaVersion['disposition']) => void
  onCompare: (id: string, slot: 0 | 1) => void
  onBranch?: (id: string) => void
}) {
  const a = state.items.find((item) => item.id === state.compareIds?.[0])
  const b = state.items.find((item) => item.id === state.compareIds?.[1])
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.3fr)] gap-4 overflow-hidden p-4">
      <div className="min-h-0 overflow-auto ace-scroll">
        <div className="mb-2 flex items-center justify-between text-xs opacity-60"><span>版本 / Take</span><span>{state.items.length} 个</span></div>
        <div className="grid grid-cols-2 gap-3">
          {state.items.map((version) => {
            const current = version.id === state.currentId
            const compareA = version.id === state.compareIds?.[0]
            const compareB = version.id === state.compareIds?.[1]
            return (
              <article key={version.id} className={`overflow-hidden rounded-xl border ${current ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-black/10 dark:border-white/10'} ${version.disposition === 'rejected' ? 'opacity-55' : ''}`}>
                <div className="relative aspect-video overflow-hidden bg-black/5"><Media version={version} />
                  <div className="absolute left-2 top-2 flex gap-1 text-[10px] text-white">
                    {current && <span className="rounded bg-indigo-600 px-1.5 py-0.5">当前</span>}
                    {version.disposition === 'starred' && <span className="rounded bg-amber-500 px-1.5 py-0.5">★</span>}
                    {compareA && <span className="rounded bg-zinc-900/80 px-1.5 py-0.5">A</span>}
                    {compareB && <span className="rounded bg-zinc-900/80 px-1.5 py-0.5">B</span>}
                  </div>
                </div>
                <div className="space-y-2 p-2.5">
                  <div className="flex items-center gap-1"><span className="min-w-0 flex-1 truncate text-xs font-medium">{version.label}</span>
                    <button title="设为 A" onClick={() => onCompare(version.id, 0)} className={`h-6 w-6 rounded text-[10px] ${compareA ? 'bg-zinc-800 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}>A</button>
                    <button title="设为 B" onClick={() => onCompare(version.id, 1)} className={`h-6 w-6 rounded text-[10px] ${compareB ? 'bg-zinc-800 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}>B</button>
                    <button title={version.disposition === 'starred' ? '取消标星' : '标星'} onClick={() => onDisposition(version.id, version.disposition === 'starred' ? 'normal' : 'starred')} className="grid h-6 w-6 place-items-center rounded hover:bg-black/5 dark:hover:bg-white/10"><Star size={13} fill={version.disposition === 'starred' ? 'currentColor' : 'none'} /></button>
                    <button title={version.disposition === 'rejected' ? '恢复' : '淘汰'} onClick={() => onDisposition(version.id, version.disposition === 'rejected' ? 'normal' : 'rejected')} className="grid h-6 w-6 place-items-center rounded hover:bg-black/5 dark:hover:bg-white/10"><ThumbsDown size={13} fill={version.disposition === 'rejected' ? 'currentColor' : 'none'} /></button>
                  </div>
                  <Trace version={version} />
                  <div className="flex gap-2">
                    <button disabled={current} onClick={() => onAdopt(version.id)} className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 text-[11px] text-white disabled:opacity-35"><Check size={12} />采用</button>
                    {onBranch && <button onClick={() => onBranch(version.id)} className="flex h-7 items-center gap-1 rounded-lg border border-black/10 px-2 text-[11px] dark:border-white/10"><GitBranch size={12} />分支继续</button>}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      </div>
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-black/10 px-3 text-xs dark:border-white/10"><Columns2 size={14} />A/B 比较</div>
        <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-black/10 dark:divide-white/10">
          {[a, b].map((version, index) => version ? (
            <div key={version.id} className="flex min-w-0 flex-col"><div className="h-8 shrink-0 px-3 py-2 text-[11px] font-medium">{index ? 'B' : 'A'} · {version.label}</div><div className="min-h-0 flex-1"><Media version={version} /></div></div>
          ) : <div key={index} className="grid place-items-center p-8 text-center text-xs opacity-40">在左侧版本上选择 {index ? 'B' : 'A'}</div>)}
        </div>
      </div>
    </div>
  )
}

export function MediaVersionDialog() {
  const cardId = useUi((state) => state.versionCardId)
  const card = useGraph((state) => cardId ? state.project.boards.find((board) => board.cards[cardId])?.cards[cardId] : undefined) as Card | undefined
  if (!cardId || !card) return null
  const state = readCardMediaVersions(card)
  const close = () => useUi.getState().setVersionCardId(null)
  return (
    <div className={`fixed inset-0 ${Z.modal} grid place-items-center bg-black/55 p-5`} onClick={close}>
      <div data-interactive onClick={(event) => event.stopPropagation()} className="ace-dialog ace-anim-scale flex h-[88vh] w-[min(1440px,96vw)] flex-col overflow-hidden">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-black/10 px-4 dark:border-white/10"><Columns2 size={17} className="text-indigo-500" /><b className="text-sm">版本工作区</b><span className="truncate text-xs opacity-50">· {card.title}</span><button onClick={close} className="ml-auto grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"><X size={17} /></button></div>
        {state.items.length ? <VersionWorkspace state={state}
          onAdopt={(id) => adoptCardMediaVersion(card.id, id)}
          onDisposition={(id, value) => setCardVersionDisposition(card.id, id, value)}
          onCompare={(id, slot) => setCardVersionCompareSlot(card.id, id, slot)}
          onBranch={(id) => { const branched = branchFromCardMediaVersion(card.id, id); if (branched) { toast('已从该版本创建可继续生成/编辑的新分支', 'success'); close() } }}
        /> : <div className="grid flex-1 place-items-center text-sm opacity-45">还没有可比较的媒体结果</div>}
      </div>
    </div>
  )
}
