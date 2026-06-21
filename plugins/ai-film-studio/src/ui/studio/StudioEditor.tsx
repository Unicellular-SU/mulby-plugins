/**
 * 工作台 · 分阶段编辑器：顶栏（项目设置）+ 阶段 Tab（剧本/资产/分镜/时间线）+ Agent 对话面板占位。
 * 阶段2c 骨架：剧本 Tab 已可编辑落盘；资产/分镜/时间线为列表+新增占位，生成与 Agent 在阶段3 接入。
 */
import { useState } from 'react'
import { ArrowLeft, FileText, Users, Clapperboard, Film, Bot, Plus, Wand2, Loader2, AlertCircle, Trash2, Send, Link2, BookOpen, Settings2 } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { useGraphStore } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { listStylePacks } from '../services/stylePacks'
import { useMediaUrl } from '../services/mediaUrl'
import type { Asset, AssetType, Storyboard } from '../domain/types'

type Tab = 'novel' | 'script' | 'assets' | 'storyboard' | 'timeline'
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'novel', label: '原著', icon: BookOpen },
  { id: 'script', label: '剧本', icon: FileText },
  { id: 'assets', label: '资产', icon: Users },
  { id: 'storyboard', label: '分镜', icon: Clapperboard },
  { id: 'timeline', label: '时间线', icon: Film },
]

export default function StudioEditor() {
  const doc = useProjectStore((s) => s.doc)!
  const closeProject = useProjectStore((s) => s.closeProject)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const batch = useProjectStore((s) => s.batch)
  const film = useProjectStore((s) => s.film)
  const autoProduce = useProjectStore((s) => s.autoProduce)
  const busy = batch.running || film.state === 'composing'
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
        <StudioModelBar />
        {busy && (
          <span className="afs-studio__batchstat">
            <Loader2 size={14} className="afs-spin" /> {film.state === 'composing' ? film.text || '合成中…' : batch.label}
          </span>
        )}
        <button
          className="afs-btn afs-btn--primary afs-btn--sm afs-studio__produce"
          disabled={busy || doc.storyboards.length === 0}
          title="资产 → 关键帧 → 视频 → 合成 一条龙"
          onClick={() => void autoProduce()}
        >
          {busy ? <Loader2 size={14} className="afs-spin" /> : <Wand2 size={14} />} 一键成片
        </button>
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
          {tab === 'novel' && <NovelTab />}
          {tab === 'script' && <ScriptTab />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'storyboard' && <StoryboardTab />}
          {tab === 'timeline' && <TimelineTab />}
        </div>
        <AgentPanel />
      </div>
    </div>
  )
}

function StudioModelBar() {
  const models = useGraphStore((s) => s.models)
  const imageModels = useGraphStore((s) => s.imageModels)
  const selectedModel = useGraphStore((s) => s.selectedModel)
  const selectedImageModel = useGraphStore((s) => s.selectedImageModel)
  const setSelectedModel = useGraphStore((s) => s.setSelectedModel)
  const setSelectedImageModel = useGraphStore((s) => s.setSelectedImageModel)
  const videoProvider = useProviderStore((s) => {
    const id = s.defaults.video
    const byDefault = id ? s.providers.find((p) => p.id === id) : undefined
    return byDefault ?? s.providers.find((p) => p.enabled && (p.capabilities || ['video']).includes('video')) ?? null
  })
  const [open, setOpen] = useState(false)
  const ok = !!selectedModel && !!selectedImageModel && !!videoProvider
  return (
    <div className="afs-studio__modelbar">
      <button className="afs-btn afs-btn--sm" onClick={() => setOpen((v) => !v)} title="文本/图像/视频 模型设置（工作台复用全局选择）">
        <Settings2 size={14} /> 模型{ok ? '' : ' ⚠'}
      </button>
      {open && (
        <div className="afs-studio__modelpop">
          <label>文本模型（剧本/对话/事件）</label>
          <select className="afs-field__input" value={selectedModel ?? ''} onChange={(e) => setSelectedModel(e.target.value || null)}>
            <option value="">（未选）</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id}
              </option>
            ))}
          </select>
          <label>图像模型（资产/关键帧）</label>
          <select className="afs-field__input" value={selectedImageModel ?? ''} onChange={(e) => setSelectedImageModel(e.target.value || null)}>
            <option value="">（未选）</option>
            {imageModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label || m.id}
              </option>
            ))}
          </select>
          <label>视频供应商（片段）</label>
          <div className={`afs-studio__modelstat${videoProvider ? '' : ' is-missing'}`}>
            {videoProvider ? videoProvider.label : '未配置 — 去左侧「设置」添加视频供应商并设为默认'}
          </div>
          {(models.length === 0 || imageModels.length === 0) && (
            <div className="afs-studio__hint">没有可选模型？先去「设置」配置宿主文本/图像模型供应商。</div>
          )}
        </div>
      )}
    </div>
  )
}

function AgentPanel() {
  const doc = useProjectStore((s) => s.doc)!
  const runAgent = useProjectStore((s) => s.runAgent)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const busy = useProjectStore((s) => s.agentBusy)
  const [text, setText] = useState('')
  const [showManual, setShowManual] = useState(false)
  const msgs = doc.memory.filter((m) => m.role === 'user' || m.role === 'assistant')
  const send = () => {
    if (!text.trim() || busy) return
    const t = text
    setText('')
    void runAgent(t)
  }
  return (
    <aside className="afs-studio__agent">
      <div className="afs-studio__agent-head">
        <Bot size={16} /> AI 制片
        <button className="afs-studio__manualtoggle" title="导演手册（全局风格/节奏意图，注入 Agent）" onClick={() => setShowManual((v) => !v)}>
          🎬
        </button>
      </div>
      {showManual && (
        <textarea
          className="afs-field__input afs-studio__manual"
          rows={2}
          placeholder="导演手册：全局风格/节奏/调性意图（注入每次 Agent 生成）…"
          value={doc.meta.directorManual ?? ''}
          onChange={(e) => updateMeta({ directorManual: e.target.value })}
        />
      )}
      <div className="afs-studio__agent-msgs">
        {msgs.length === 0 && (
          <p className="afs-studio__hint">
            描述你的短剧（一句话/故事/指令），我来拆成剧本、资产和分镜。例如：「把这个故事改成 5 个镜头的悬疑短片，列出人物和场景」。
          </p>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`afs-studio__msg afs-studio__msg--${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="afs-studio__msg afs-studio__msg--assistant">
            <Loader2 size={14} className="afs-spin" /> 思考中…
          </div>
        )}
      </div>
      <div className="afs-studio__agent-input">
        <textarea
          value={text}
          placeholder="描述你的短剧或下一步…（Ctrl/Cmd+Enter 发送）"
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="afs-btn afs-btn--primary afs-btn--sm" disabled={busy || !text.trim()} onClick={send}>
          {busy ? <Loader2 size={14} className="afs-spin" /> : <Send size={14} />}
        </button>
      </div>
    </aside>
  )
}

function NovelTab() {
  const doc = useProjectStore((s) => s.doc)!
  const importNovel = useProjectStore((s) => s.importNovel)
  const clearNovel = useProjectStore((s) => s.clearNovel)
  const extractChapterEvents = useProjectStore((s) => s.extractChapterEvents)
  const extractAllEvents = useProjectStore((s) => s.extractAllEvents)
  const batch = useProjectStore((s) => s.batch)
  const [text, setText] = useState('')
  return (
    <div className="afs-studio__novel">
      {doc.novel.length === 0 ? (
        <>
          <p className="afs-studio__hint">粘贴小说原文，自动按「第N章/回/卷」切分（无标题则按长度分段）。导入后让右侧 AI 制片「按原著改编成短剧」。</p>
          <textarea
            className="afs-field__input afs-studio__novelpaste"
            placeholder="在此粘贴小说全文…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button
            className="afs-btn afs-btn--primary afs-btn--sm"
            disabled={!text.trim()}
            onClick={() => {
              importNovel(text)
              setText('')
            }}
          >
            <BookOpen size={14} /> 导入并分章
          </button>
        </>
      ) : (
        <>
          <div className="afs-studio__tabbar">
            <b>{doc.novel.length} 章</b>
            <button className="afs-btn afs-btn--sm" disabled={batch.running} onClick={() => void extractAllEvents()}>
              <Wand2 size={13} /> 提取全部事件
            </button>
            <span className="afs-studio__hint">提取后改编更省 token、长篇也装得下</span>
            <button className="afs-btn afs-btn--sm afs-btn--ghost" style={{ marginLeft: 'auto' }} onClick={() => clearNovel()}>
              <Trash2 size={13} /> 清空
            </button>
          </div>
          <div className="afs-studio__chapters">
            {doc.novel.map((c) => (
              <div key={c.id} className="afs-studio__chapter afs-studio__chapter--col">
                <div className="afs-studio__chapterhead">
                  <span className="afs-studio__chaptertitle">{c.title}</span>
                  <span className="afs-studio__chapterlen">{c.text.length} 字</span>
                  <button
                    className="afs-btn afs-btn--sm afs-btn--ghost"
                    disabled={c.eventState === 'generating'}
                    onClick={() => void extractChapterEvents(c.id)}
                  >
                    {c.eventState === 'generating' ? <Loader2 size={12} className="afs-spin" /> : <Wand2 size={12} />}
                    {c.event ? ' 重提事件' : ' 提取事件'}
                  </button>
                </div>
                {c.event && <div className="afs-studio__chapterevent">{c.event}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ScriptTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertScript = useProjectStore((s) => s.upsertScript)
  const removeScript = useProjectStore((s) => s.removeScript)
  const [sel, setSel] = useState<string | null>(doc.scripts[0]?.id ?? null)
  // sel 未初始化/失效时回退到首个剧本：Agent/autoProduce 新建剧本后能立刻显示，不必手动点
  const current = doc.scripts.find((s) => s.id === sel) ?? doc.scripts[0] ?? null

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
  const generateAllAssets = useProjectStore((s) => s.generateAllAssets)
  const batch = useProjectStore((s) => s.batch)
  const groups: { type: AssetType; label: string }[] = [
    { type: 'role', label: '人物' },
    { type: 'scene', label: '场景' },
    { type: 'prop', label: '物品' },
  ]
  return (
    <div className="afs-studio__assets">
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" disabled={batch.running || doc.assets.length === 0} onClick={() => void generateAllAssets()}>
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 全部生成
        </button>
      </div>
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
            <div className="afs-studio__cardgrid">
              {items.length === 0 && <span className="afs-studio__hint">暂无</span>}
              {items.map((a) => (
                <AssetCard key={a.id} asset={a} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function AssetCard({ asset }: { asset: Asset }) {
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  return (
    <div className="afs-studio__assetcard">
      <div className="afs-studio__thumb">
        {asset.state === 'generating' ? (
          <Loader2 size={20} className="afs-spin" />
        ) : url ? (
          <img src={url} alt={asset.name} />
        ) : (
          <Users size={20} opacity={0.3} />
        )}
        {asset.state === 'failed' && (
          <span className="afs-studio__err" title={asset.error}>
            <AlertCircle size={14} />
          </span>
        )}
      </div>
      <input className="afs-studio__cardname" value={asset.name} onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: e.target.value })} />
      <textarea
        className="afs-field__input afs-studio__carddesc"
        rows={2}
        placeholder="外貌/特征描述…"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, desc: e.target.value })}
      />
      <div className="afs-studio__cardactions">
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} onClick={() => void generateAsset(asset.id)}>
          <Wand2 size={13} /> 生成
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function StoryboardTab() {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const generateAllKeyframes = useProjectStore((s) => s.generateAllKeyframes)
  const generateAllClips = useProjectStore((s) => s.generateAllClips)
  const batch = useProjectStore((s) => s.batch)
  const hasKeyframes = doc.storyboards.some((s) => s.keyframeImageId)
  return (
    <div className="afs-studio__storyboard">
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" onClick={() => upsertStoryboard({ videoDesc: '' })}>
          <Plus size={14} /> 新增分镜
        </button>
        <button
          className="afs-btn afs-btn--sm"
          disabled={batch.running || doc.storyboards.length === 0}
          onClick={() => void generateAllKeyframes()}
        >
          <Wand2 size={14} /> 全部关键帧
        </button>
        <button className="afs-btn afs-btn--sm" disabled={batch.running || !hasKeyframes} onClick={() => void generateAllClips()}>
          <Film size={14} /> 全部视频
        </button>
      </div>
      <div className="afs-studio__sblist">
        {doc.storyboards.length === 0 && <p className="afs-studio__hint">暂无分镜（阶段3 由分镜 Agent 自动拆解生成）。</p>}
        {doc.storyboards.map((s, i) => (
          <StoryboardItem key={s.id} sb={s} index={i} />
        ))}
      </div>
    </div>
  )
}

function StoryboardItem({ sb, index }: { sb: Storyboard; index: number }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const removeStoryboard = useProjectStore((s) => s.removeStoryboard)
  const generateKeyframe = useProjectStore((s) => s.generateKeyframe)
  const generateClip = useProjectStore((s) => s.generateClip)
  const url = useMediaUrl(sb.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  const clip = doc.clips.find((c) => c.storyboardId === sb.id)
  return (
    <div className="afs-studio__sbitem">
      <div className="afs-studio__sbleft">
        <span className="afs-studio__sbidx">{index + 1}</span>
        {index > 0 && (
          <button
            className={`afs-studio__chain${sb.chainFromPrev ? ' is-on' : ''}`}
            title={sb.chainFromPrev ? '承接上一镜（关键帧由上一帧派生，保持连贯）— 点击关闭' : '与上一镜硬切 — 点击设为承接（连贯）'}
            onClick={() => upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, chainFromPrev: !sb.chainFromPrev })}
          >
            <Link2 size={12} />
          </button>
        )}
      </div>
      <div className="afs-studio__sbthumb">
        {sb.state === 'generating' ? <Loader2 size={18} className="afs-spin" /> : url ? <img src={url} alt="" /> : <Clapperboard size={18} opacity={0.3} />}
        {sb.state === 'failed' && (
          <span className="afs-studio__err" title={sb.error}>
            <AlertCircle size={13} />
          </span>
        )}
      </div>
      <textarea
        className="afs-field__input"
        rows={3}
        value={sb.videoDesc}
        placeholder="画面描述（主体+动作+环境+情绪+光影）…"
        onChange={(e) => upsertStoryboard({ id: sb.id, videoDesc: e.target.value })}
      />
      <div className="afs-studio__sbactions">
        <button className="afs-btn afs-btn--sm" disabled={sb.state === 'generating'} onClick={() => void generateKeyframe(sb.id)}>
          <Wand2 size={13} /> 关键帧
        </button>
        <button
          className="afs-btn afs-btn--sm"
          disabled={!sb.keyframeImageId || clip?.state === 'generating'}
          title={!sb.keyframeImageId ? '先生成关键帧' : '由关键帧生成视频片段'}
          onClick={() => void generateClip(sb.id)}
        >
          {clip?.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Film size={13} />} 视频
          {clip?.state === 'done' && ' ✓'}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeStoryboard(sb.id)}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function TimelineTab() {
  const doc = useProjectStore((s) => s.doc)!
  const compose = useProjectStore((s) => s.compose)
  const film = useProjectStore((s) => s.film)
  const ordered = [...doc.storyboards].sort((a, b) => a.index - b.index)
  const clips = ordered.map((s) => doc.clips.find((c) => c.id === doc.track.find((t) => t.storyboardId === s.id)?.selectClipId)).filter(Boolean)
  if (!clips.length)
    return (
      <div className="afs-studio__timeline">
        <p className="afs-studio__hint">还没有视频片段。去「分镜」给每个镜头生成关键帧 → 视频，回到这里即可合成成片。</p>
      </div>
    )
  return (
    <div className="afs-studio__timeline">
      <div className="afs-studio__timeline-head">
        <p className="afs-studio__hint">{clips.length} 个片段（按分镜顺序）。</p>
        <button className="afs-btn afs-btn--primary afs-btn--sm" disabled={film.state === 'composing'} onClick={() => void compose()}>
          {film.state === 'composing' ? <Loader2 size={14} className="afs-spin" /> : <Film size={14} />} 合成成片
        </button>
      </div>
      {film.state === 'composing' && <p className="afs-studio__hint">{film.text}</p>}
      {film.state === 'failed' && <p className="afs-studio__err-text">合成失败：{film.error}</p>}
      <div className="afs-studio__track">
        {clips.map((c, i) => (
          <TrackClip key={c!.id} localPath={c!.videoFilePath} url={c!.videoUrl} index={i} />
        ))}
      </div>
      {film.state === 'done' && film.path && (
        <div className="afs-studio__film">
          <FilmPreview path={film.path} />
          <p className="afs-studio__hint">成片已导出：{film.path}</p>
        </div>
      )}
    </div>
  )
}

function FilmPreview({ path }: { path: string }) {
  const src = useMediaUrl({ localPath: path })
  return <video className="afs-studio__filmvideo" src={src} controls preload="metadata" />
}

function TrackClip({ localPath, url, index }: { localPath?: string; url?: string; index: number }) {
  const src = useMediaUrl({ localPath, url })
  return (
    <div className="afs-studio__trackclip">
      <video src={src} muted playsInline preload="metadata" />
      <span className="afs-studio__trackidx">{index + 1}</span>
    </div>
  )
}
