/**
 * 工作台 · 分阶段编辑器：顶栏（项目设置）+ 阶段 Tab（剧本/资产/分镜/时间线）+ Agent 对话面板占位。
 * 阶段2c 骨架：剧本 Tab 已可编辑落盘；资产/分镜/时间线为列表+新增占位，生成与 Agent 在阶段3 接入。
 */
import { useState } from 'react'
import { ArrowLeft, FileText, Users, Clapperboard, Film, Bot, Plus } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { listStylePacks } from '../services/stylePacks'
import type { AssetType } from '../domain/types'

type Tab = 'script' | 'assets' | 'storyboard' | 'timeline'
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'script', label: '剧本', icon: FileText },
  { id: 'assets', label: '资产', icon: Users },
  { id: 'storyboard', label: '分镜', icon: Clapperboard },
  { id: 'timeline', label: '时间线', icon: Film },
]

export default function StudioEditor() {
  const doc = useProjectStore((s) => s.doc)!
  const closeProject = useProjectStore((s) => s.closeProject)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const [tab, setTab] = useState<Tab>('script')

  return (
    <div className="afs-studio__editor">
      <header className="afs-studio__topbar">
        <button className="afs-btn afs-btn--ghost" onClick={() => void closeProject()} title="返回项目列表">
          <ArrowLeft size={16} />
        </button>
        <input
          className="afs-studio__title"
          value={doc.meta.name}
          onChange={(e) => updateMeta({ name: e.target.value })}
          placeholder="项目名称"
        />
        <select className="afs-field__input afs-studio__sel" value={doc.meta.artStyle} onChange={(e) => updateMeta({ artStyle: e.target.value })}>
          {listStylePacks().map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select className="afs-field__input afs-studio__sel" value={doc.meta.videoRatio} onChange={(e) => updateMeta({ videoRatio: e.target.value })}>
          {['16:9', '9:16', '1:1'].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </header>

      <nav className="afs-studio__tabs">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.id} className={`afs-studio__tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              <Icon size={15} /> {t.label}
            </button>
          )
        })}
      </nav>

      <div className="afs-studio__work">
        <div className="afs-studio__stage">
          {tab === 'script' && <ScriptTab />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'storyboard' && <StoryboardTab />}
          {tab === 'timeline' && <TimelineTab />}
        </div>
        <aside className="afs-studio__agent">
          <div className="afs-studio__agent-head">
            <Bot size={16} /> AI 制片
          </div>
          <div className="afs-studio__agent-body">
            <p className="afs-studio__hint">Agent 对话编排（剧本/资产/分镜/视频自动化）将在阶段3 接入。</p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function ScriptTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertScript = useProjectStore((s) => s.upsertScript)
  const removeScript = useProjectStore((s) => s.removeScript)
  const [sel, setSel] = useState<string | null>(doc.scripts[0]?.id ?? null)
  const current = doc.scripts.find((s) => s.id === sel) ?? null

  return (
    <div className="afs-studio__split">
      <div className="afs-studio__list">
        <button className="afs-btn afs-btn--sm" onClick={() => setSel(upsertScript({ name: `剧本 ${doc.scripts.length + 1}`, content: '' }))}>
          <Plus size={14} /> 新建剧本
        </button>
        {doc.scripts.map((s) => (
          <div key={s.id} className={`afs-studio__listitem${sel === s.id ? ' is-active' : ''}`} onClick={() => setSel(s.id)}>
            <span>{s.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeScript(s.id)
                if (sel === s.id) setSel(null)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="afs-studio__detail">
        {current ? (
          <>
            <input
              className="afs-studio__title"
              value={current.name}
              onChange={(e) => upsertScript({ id: current.id, name: e.target.value, content: current.content })}
            />
            <textarea
              className="afs-field__input afs-studio__editor-text"
              value={current.content}
              placeholder="剧本内容（阶段3 可由编剧 Agent 生成）…"
              onChange={(e) => upsertScript({ id: current.id, content: e.target.value })}
            />
          </>
        ) : (
          <p className="afs-studio__hint">选择或新建一个剧本。</p>
        )}
      </div>
    </div>
  )
}

function AssetsTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const groups: { type: AssetType; label: string }[] = [
    { type: 'role', label: '人物' },
    { type: 'scene', label: '场景' },
    { type: 'prop', label: '物品' },
  ]
  return (
    <div className="afs-studio__assets">
      {groups.map((g) => {
        const items = doc.assets.filter((a) => a.type === g.type)
        return (
          <div key={g.type} className="afs-studio__assetgroup">
            <div className="afs-studio__assetgroup-head">
              <b>{g.label}</b>
              <button className="afs-btn afs-btn--sm" onClick={() => upsertAsset({ type: g.type, name: `${g.label}${items.length + 1}` })}>
                <Plus size={14} /> 新增
              </button>
            </div>
            <div className="afs-studio__assetlist">
              {items.length === 0 && <span className="afs-studio__hint">暂无</span>}
              {items.map((a) => (
                <div key={a.id} className="afs-studio__chip">
                  <input value={a.name} onChange={(e) => upsertAsset({ id: a.id, type: a.type, name: e.target.value })} />
                  <button onClick={() => removeAsset(a.id)}>×</button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StoryboardTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const removeStoryboard = useProjectStore((s) => s.removeStoryboard)
  return (
    <div className="afs-studio__storyboard">
      <button className="afs-btn afs-btn--sm" onClick={() => upsertStoryboard({ videoDesc: '' })}>
        <Plus size={14} /> 新增分镜
      </button>
      <div className="afs-studio__sblist">
        {doc.storyboards.length === 0 && <p className="afs-studio__hint">暂无分镜（阶段3 由分镜 Agent 自动拆解生成）。</p>}
        {doc.storyboards.map((s, i) => (
          <div key={s.id} className="afs-studio__sbitem">
            <span className="afs-studio__sbidx">{i + 1}</span>
            <textarea
              className="afs-field__input"
              rows={2}
              value={s.videoDesc}
              placeholder="画面描述…"
              onChange={(e) => upsertStoryboard({ id: s.id, videoDesc: e.target.value })}
            />
            <button onClick={() => removeStoryboard(s.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineTab() {
  return (
    <div className="afs-studio__timeline">
      <p className="afs-studio__hint">时间线/轨道剪辑（多镜选优、拖拽排序、合成导出）将在阶段4 接入。</p>
    </div>
  )
}
