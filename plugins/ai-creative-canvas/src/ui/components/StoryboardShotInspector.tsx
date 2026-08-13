import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Image as ImageIcon, MapPin, Music, RefreshCcw, Sparkles, Trash2, Video } from 'lucide-react'
import { focusCard } from '../focusCard'
import { generateCard } from '../services/generate'
import { layoutStoryboardCards, materializeStoryboardShots, saveStoryboardDoc, shotToVideo } from '../services/storyboard'
import { moveStoryboardShot, removeStoryboardShot, storyboardStageCardId, storyboardStageState, updateStoryboardShot, type StoryboardStage, type StoryboardStageState } from '../services/storyboardV2'
import type { ProjectStoryboardEntry } from '../services/storyboardWorkspace'
import { toast } from '../store/toastStore'
import { useUi } from '../store/uiStore'
import type { AssetAnchor, StoryboardShotV2 } from '../types'

const STATE_LABEL: Record<StoryboardStageState, string> = {
  unmaterialized: '未落地',
  synced: '待生成',
  stale: '输入已变',
  running: '生成中',
  error: '失败',
  done: '已完成'
}

const STATE_CLASS: Record<StoryboardStageState, string> = {
  unmaterialized: 'bg-black/5 dark:bg-white/10 opacity-60',
  synced: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
  stale: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  running: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  error: 'bg-red-500/10 text-red-600 dark:text-red-300',
  done: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
}

const ROLE_LABEL: Record<AssetAnchor['role'], string> = {
  character: '角色', scene: '场景', prop: '道具', voice: '声音', style: '风格', music: '音乐', reference: '参考'
}

interface Draft {
  desc: string
  imagePrompt: string
  videoPrompt: string
  dialogue: string
  sfx: string
  duration: string
  shotSize: string
  scene: string
  character: string
}

function draftOf(shot: StoryboardShotV2): Draft {
  return {
    desc: shot.desc || '',
    imagePrompt: shot.imagePrompt || '',
    videoPrompt: shot.videoPrompt || '',
    dialogue: shot.dialogue || '',
    sfx: shot.sfx || '',
    duration: String(shot.duration || ''),
    shotSize: shot.shotSize || '',
    scene: shot.scene || '',
    character: shot.character || ''
  }
}

export function StoryboardShotInspector({
  entry,
  shot,
  anchors
}: {
  entry: ProjectStoryboardEntry
  shot: StoryboardShotV2
  anchors: Record<string, AssetAnchor>
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(shot))
  useEffect(() => setDraft(draftOf(shot)), [shot.id, shot.version])

  const commit = (key: keyof Draft) => {
    let value: string | number | undefined = draft[key].trim()
    if (key === 'duration') value = Number(value) > 0 ? Number(value) : undefined
    const current = key === 'duration' ? shot.duration : shot[key as keyof StoryboardShotV2]
    if ((current || '') === (value || '')) return
    const next = updateStoryboardShot(entry.doc, shot.id, { [key]: value } as Partial<StoryboardShotV2>)
    saveStoryboardDoc(entry.owner.id, next)
  }

  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const toggleAnchor = (anchorId: string) => {
    const anchorIds = shot.anchorIds.includes(anchorId)
      ? shot.anchorIds.filter((id) => id !== anchorId)
      : [...shot.anchorIds, anchorId]
    saveStoryboardDoc(entry.owner.id, updateStoryboardShot(entry.doc, shot.id, { anchorIds }))
  }
  const locate = (stage: StoryboardStage) => {
    const cardId = storyboardStageCardId(shot, stage)
    if (!cardId || !entry.board.cards[cardId]) return
    useUi.getState().setWorkspaceView('canvas')
    focusCard(entry.boardId, cardId)
  }
  const syncImage = () => materializeStoryboardShots(entry.owner.id, entry.doc, new Set([shot.id]))
  const generateImage = () => {
    const result = syncImage()
    const cardId = result?.doc.shots.find((item) => item.id === shot.id)?.imageCardId
    if (cardId) generateCard(cardId)
  }
  const openVideo = () => {
    if (shot.videoCardId && entry.board.cards[shot.videoCardId]) {
      useUi.getState().setWorkspaceView('canvas')
      focusCard(entry.boardId, shot.videoCardId)
      return
    }
    let imageCardId = shot.imageCardId
    if (!imageCardId) {
      const result = syncImage()
      imageCardId = result?.doc.shots.find((item) => item.id === shot.id)?.imageCardId
    }
    if (!imageCardId) return
    shotToVideo(imageCardId)
  }
  const reflow = () => {
    const result = layoutStoryboardCards(entry.owner.id, entry.doc)
    if (result) toast(result.moved ? `已重排 ${result.moved} 张镜头产物卡` : '镜头产物已经按顺序排列', 'success')
  }
  const move = (direction: -1 | 1) => saveStoryboardDoc(entry.owner.id, moveStoryboardShot(entry.doc, shot.id, direction))
  const remove = () => saveStoryboardDoc(entry.owner.id, removeStoryboardShot(entry.doc, shot.id))

  const fields: Array<{ key: keyof Draft; label: string; rows?: number; placeholder?: string }> = [
    { key: 'desc', label: '画面描述', rows: 3 },
    { key: 'imagePrompt', label: '图片提示词', rows: 4 },
    { key: 'videoPrompt', label: '视频提示词', rows: 4 },
    { key: 'dialogue', label: '对白', rows: 2 },
    { key: 'sfx', label: '音效 / 环境声', rows: 2 }
  ]

  return (
    <aside className="w-[340px] shrink-0 border-l flex flex-col min-h-0 bg-white/55 dark:bg-neutral-950/30" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 text-white grid place-items-center font-semibold text-sm">{shot.shotNumber ?? shot.order + 1}</div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate">镜头 {shot.shotNumber ?? shot.order + 1}</div>
            <div className="text-[11px] opacity-50 truncate">{shot.scene || '未填写场景'} · {shot.character || '未填写角色'}</div>
          </div>
          <button type="button" onClick={() => move(-1)} disabled={shot.order === 0} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-25" title="上移镜头"><ChevronUp size={14} /></button>
          <button type="button" onClick={() => move(1)} disabled={shot.order >= entry.doc.shots.length - 1} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-25" title="下移镜头"><ChevronDown size={14} /></button>
          <button type="button" onClick={reflow} className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10" title="按镜头顺序重新排版画布产物"><RefreshCcw size={14} /></button>
          <button type="button" onClick={remove} className="p-1.5 rounded text-red-500 hover:bg-red-500/10" title="删除镜头；产物卡会保留为自由卡片"><Trash2 size={14} /></button>
        </div>
        <div className="grid grid-cols-3 gap-1.5 mt-3">
          {(['image', 'video', 'audio'] as const).map((stage) => {
            const state = storyboardStageState(entry.doc, shot, entry.board, stage)
            const Icon = stage === 'image' ? ImageIcon : stage === 'video' ? Video : Music
            const cardId = storyboardStageCardId(shot, stage)
            return (
              <button
                key={stage}
                type="button"
                disabled={!cardId}
                onClick={() => locate(stage)}
                className={`rounded-md px-2 py-1.5 text-[10px] flex items-center justify-center gap-1 disabled:cursor-default ${STATE_CLASS[state]}`}
                title={cardId ? '定位到画布产物' : STATE_LABEL[state]}
              >
                <Icon size={11} /> {STATE_LABEL[state]}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-2 gap-1.5 mt-2">
          <button type="button" onClick={syncImage} className="px-2 py-1.5 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px]">同步静帧卡</button>
          <button type="button" onClick={generateImage} className="px-2 py-1.5 rounded-md bg-indigo-500 text-white hover:bg-indigo-600 text-[11px] flex items-center justify-center gap-1"><Sparkles size={11} /> {shot.imageCardId ? '生成 / 重做静帧' : '落地并生成静帧'}</button>
          <button type="button" onClick={openVideo} className="col-span-2 px-2 py-1.5 rounded-md bg-pink-500/10 text-pink-600 dark:text-pink-300 hover:bg-pink-500/15 text-[11px] flex items-center justify-center gap-1"><Video size={11} /> {shot.videoCardId ? '打开视频卡' : '创建视频卡'}</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto ace-noscroll px-3 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {(['shotSize', 'duration', 'scene', 'character'] as const).map((key) => (
            <label key={key} className="text-[10px] opacity-70">
              <span>{key === 'shotSize' ? '景别' : key === 'duration' ? '时长（秒）' : key === 'scene' ? '场景' : '角色'}</span>
              <input
                value={draft[key]}
                onChange={(event) => update(key, event.target.value)}
                onBlur={() => commit(key)}
                className="mt-1 w-full rounded-md bg-black/5 dark:bg-white/10 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </label>
          ))}
        </div>
        {fields.map((field) => (
          <label key={field.key} className="block text-[10px] opacity-70">
            <span>{field.label}</span>
            <textarea
              rows={field.rows || 2}
              value={draft[field.key]}
              onChange={(event) => update(field.key, event.target.value)}
              onBlur={() => commit(field.key)}
              placeholder={field.placeholder}
              className="mt-1 w-full resize-y rounded-md bg-black/5 dark:bg-white/10 px-2 py-1.5 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-indigo-400 ace-noscroll"
            />
          </label>
        ))}

        <div>
          <div className="text-[10px] opacity-60 mb-1.5">关键元素</div>
          <div className="flex flex-wrap gap-1">
            {Object.values(anchors).length ? Object.values(anchors).map((anchor) => {
              const active = shot.anchorIds.includes(anchor.id)
              return (
                <button
                  key={anchor.id}
                  type="button"
                  onClick={() => toggleAnchor(anchor.id)}
                  className={`px-2 py-1 rounded-full text-[10px] border ${active ? 'border-indigo-400 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'border-transparent bg-black/5 dark:bg-white/10 opacity-60 hover:opacity-100'}`}
                  title={`${ROLE_LABEL[anchor.role]} · ${anchor.description || anchor.name}`}
                >
                  {ROLE_LABEL[anchor.role]} · {anchor.name}
                </button>
              )
            }) : <span className="text-[11px] opacity-40">工程中还没有语义锚点</span>}
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-t text-[10px] opacity-50 flex items-center gap-1" style={{ borderColor: 'var(--ace-border)' }}>
        <MapPin size={10} /> 修改在离开输入框时保存；不会自动触发生成
      </div>
    </aside>
  )
}
