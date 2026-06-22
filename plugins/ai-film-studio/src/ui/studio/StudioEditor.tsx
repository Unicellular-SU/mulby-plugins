/**
 * 工作台 · 分阶段编辑器：顶栏（项目设置）+ 阶段 Tab（剧本/资产/分镜/时间线）+ Agent 对话面板占位。
 * 阶段2c 骨架：剧本 Tab 已可编辑落盘；资产/分镜/时间线为列表+新增占位，生成与 Agent 在阶段3 接入。
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, FileText, Users, Clapperboard, Film, Bot, Plus, Wand2, Loader2, AlertCircle, Trash2, Send, Link2, BookOpen, Settings2, Settings, Workflow, PanelLeft, ChevronUp, ChevronDown, X } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { useGraphStore } from '../store/graphStore'
import { useProviderStore } from '../store/providerStore'
import { listStylePacks } from '../services/stylePacks'
import { useMediaUrl } from '../services/mediaUrl'
import type { Asset, AssetType, Storyboard, VideoTrack, Clip } from '../domain/types'
import StudioDock from './StudioDock'
import EditorView from '../components/shell/EditorView'
import SettingsView from '../components/views/SettingsView'
import StudioSettings from './StudioSettings'
import { installFocusTracker } from './services/focusInsert'
import { listProviderVoices } from './services/audio'
import { loadAssetUrl } from '../services/assets'

type Tab = 'novel' | 'script' | 'assets' | 'storyboard' | 'timeline' | 'canvas'
const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'novel', label: '原著', icon: BookOpen },
  { id: 'script', label: '剧本', icon: FileText },
  { id: 'assets', label: '资产', icon: Users },
  { id: 'storyboard', label: '分镜', icon: Clapperboard },
  { id: 'timeline', label: '时间线', icon: Film },
  { id: 'canvas', label: '画布', icon: Workflow }, // 独立节点画布（高级编辑入口）；关键帧精修在「分镜」每镜的「精修」按钮
]

// 视频模式（对标 Toonflow 4 模式，§5.3；具体提示词模板在 phase4 接入）
const VIDEO_MODE_OPTIONS: { id: string; label: string }[] = [
  { id: 'firstFrame', label: '首帧驱动（图生视频）' },
  { id: 'startEndFrame', label: '首尾帧' },
  { id: 'multiRef', label: '多参考（seedance 类）' },
  { id: 'singleImageFirst', label: '单图首帧（wan2.6 类）' },
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
  const [dockOpen, setDockOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // 工作台输入焦点跟踪：左侧资源 Dock 的片段/资产名插入「最后聚焦的输入框」
  useEffect(() => installFocusTracker(), [])

  // 恢复/持久化工作台布局态（studio:ui）
  useEffect(() => {
    void (async () => {
      const ui = (await window.mulby?.storage?.get('studio:ui', 'ai-film-studio')) as { stageTab?: Tab; dockOpen?: boolean } | null
      if (ui?.stageTab && TABS.some((t) => t.id === ui.stageTab)) setTab(ui.stageTab)
      if (typeof ui?.dockOpen === 'boolean') setDockOpen(ui.dockOpen)
    })()
  }, [])
  useEffect(() => {
    void window.mulby?.storage?.set('studio:ui', { stageTab: tab, dockOpen }, 'ai-film-studio')
  }, [tab, dockOpen])

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
        <button className="afs-btn afs-btn--ghost afs-btn--sm" title="设置（模型供应商 / 提示词 / 外观 / 存储）" onClick={() => setSettingsOpen(true)}>
          <Settings size={15} />
        </button>
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
        <button
          className={`afs-studio__tab afs-studio__docktoggle${dockOpen ? ' is-active' : ''}`}
          title={dockOpen ? '收起资源面板' : '展开资源面板（素材/提示词）'}
          onClick={() => setDockOpen((v) => !v)}
        >
          <PanelLeft size={15} />
        </button>
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
        {dockOpen && tab !== 'canvas' && <StudioDock />}
        <div className={`afs-studio__stage${tab === 'canvas' ? ' is-canvas' : ''}`}>
          {tab === 'novel' && <NovelTab />}
          {tab === 'script' && <ScriptTab />}
          {tab === 'assets' && <AssetsTab />}
          {tab === 'storyboard' && <StoryboardTab />}
          {tab === 'timeline' && <TimelineTab />}
          {tab === 'canvas' && (
            <div className="afs-studio__canvaswrap">
              <div className="afs-studio__canvasnote">
                这是独立的「节点画布」（高级编辑），有自己的工程，与当前工作台项目<b>相互独立</b>。
                关键帧精修请用「分镜」里每个分镜卡片上的「精修」按钮。
              </div>
              <EditorView />
            </div>
          )}
        </div>
        <AgentPanel />
      </div>
      {settingsOpen && (
        <div className="afs-studio__drawer-scrim" onClick={() => setSettingsOpen(false)}>
          <div className="afs-studio__drawer" onClick={(e) => e.stopPropagation()}>
            <div className="afs-studio__drawer-head">
              <span>设置</span>
              <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={() => setSettingsOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="afs-studio__drawer-body">
              <StudioSettings />
              <SettingsView />
            </div>
          </div>
        </div>
      )}
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
  const meta = useProjectStore((s) => s.doc?.meta)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const providers = useProviderStore((s) => s.providers)
  const videoDefault = useProviderStore((s) => s.defaults.video)
  const setDefault = useProviderStore((s) => s.setDefault)
  const videoProviders = providers.filter((p) => (p.capabilities || ['video']).includes('video'))
  const videoProvider = videoProviders.find((p) => p.id === videoDefault) ?? videoProviders.find((p) => p.enabled) ?? null
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
          {videoProviders.length ? (
            <select className="afs-field__input" value={videoDefault ?? ''} onChange={(e) => setDefault('video', e.target.value || null)}>
              <option value="">（自动选第一个）</option>
              {videoProviders.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.model ? ` · ${p.model}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="afs-studio__modelstat is-missing">未配置 — 在设置抽屉添加视频供应商</div>
          )}
          <label>视频模式</label>
          <select className="afs-field__input" value={meta?.videoMode ?? 'firstFrame'} onChange={(e) => updateMeta({ videoMode: e.target.value })}>
            {VIDEO_MODE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <label>分辨率</label>
          <select className="afs-field__input" value={meta?.videoResolution ?? '720p'} onChange={(e) => updateMeta({ videoResolution: e.target.value })}>
            {['480p', '720p', '1080p'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
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
  const runAgentToolLoop = useProjectStore((s) => s.runAgentToolLoop)
  const abortAgent = useProjectStore((s) => s.abortAgent)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const busy = useProjectStore((s) => s.agentBusy)
  const stage = useProjectStore((s) => s.agentStage)
  const [text, setText] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [toolLoop, setToolLoop] = useState(false)
  const msgs = doc.memory.filter((m) => m.role === 'user' || m.role === 'assistant')
  const send = () => {
    if (!text.trim() || busy) return
    const t = text
    setText('')
    void (toolLoop ? runAgentToolLoop(t) : runAgent(t))
  }
  return (
    <aside className="afs-studio__agent">
      <div className="afs-studio__agent-head">
        <Bot size={16} /> AI 制片
        <button
          className={`afs-studio__manualtoggle${toolLoop ? ' is-on' : ''}`}
          title="实验：原生工具调用（Agent 自主调用工具读写工作区；依赖宿主 function-calling，未生效则用默认结构化管线）"
          onClick={() => setToolLoop((v) => !v)}
        >
          🛠
        </button>
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
            <Loader2 size={14} className="afs-spin" /> {stage || '思考中…'}
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
        {busy ? (
          <button className="afs-btn afs-btn--sm" title="停止" onClick={() => abortAgent()}>
            <X size={14} />
          </button>
        ) : (
          <button className="afs-btn afs-btn--primary afs-btn--sm" disabled={!text.trim()} onClick={send}>
            <Send size={14} />
          </button>
        )}
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
  const polishAllAssets = useProjectStore((s) => s.polishAllAssets)
  const autoBindVoices = useProjectStore((s) => s.autoBindVoices)
  const batch = useProjectStore((s) => s.batch)
  const groups: { type: AssetType; label: string }[] = [
    { type: 'role', label: '人物' },
    { type: 'scene', label: '场景' },
    { type: 'prop', label: '物品' },
  ]
  return (
    <div className="afs-studio__assets">
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" disabled={batch.running || doc.assets.length === 0} onClick={() => void polishAllAssets()}>
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 全部润色
        </button>
        <button className="afs-btn afs-btn--sm" disabled={batch.running || doc.assets.length === 0} onClick={() => void generateAllAssets()}>
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 全部生成
        </button>
        <button
          className="afs-btn afs-btn--sm"
          disabled={batch.running || !doc.assets.some((a) => a.type === 'role') || !doc.assets.some((a) => a.type === 'audio')}
          title="为各角色 AI 匹配最契合的音色"
          onClick={() => void autoBindVoices()}
        >
          {batch.running ? <Loader2 size={13} className="afs-spin" /> : <Bot size={13} />} AI 配音匹配
        </button>
      </div>
      {groups.map((g) => {
        const items = doc.assets.filter((a) => a.type === g.type && !a.parentAssetId)
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
      <VoiceLibrary />
    </div>
  )
}

function VoiceLibrary() {
  const doc = useProjectStore((s) => s.doc)!
  const addVoice = useProjectStore((s) => s.addVoice)
  const voices = doc.assets.filter((a) => a.type === 'audio')
  return (
    <div className="afs-studio__assetgroup">
      <div className="afs-studio__assetgroup-head">
        <b>音色</b>
        <button className="afs-btn afs-btn--sm" onClick={() => addVoice({ name: `音色${voices.length + 1}` })}>
          <Plus size={14} /> 新增音色
        </button>
      </div>
      <div className="afs-studio__cardgrid">
        {voices.length === 0 && <span className="afs-studio__hint">暂无音色（先在设置抽屉配置 tts 供应商，再新增音色试听）</span>}
        {voices.map((v) => (
          <VoiceCard key={v.id} asset={v} />
        ))}
      </div>
    </div>
  )
}

function VoiceCard({ asset }: { asset: Asset }) {
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const synthVoice = useProjectStore((s) => s.synthVoice)
  const url = useMediaUrl(asset.audioUrl ? { url: asset.audioUrl } : asset.audioFilePath ? { localPath: asset.audioFilePath } : null)
  const providerVoices = listProviderVoices()
  return (
    <div className="afs-studio__voicecard">
      <input className="afs-studio__cardname" value={asset.name} onChange={(e) => upsertAsset({ id: asset.id, type: 'audio', name: e.target.value })} />
      <select
        className="afs-field__input"
        value={asset.voice ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: 'audio', name: asset.name, voice: e.target.value })}
      >
        <option value="">（默认音色）</option>
        {providerVoices.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <input
        className="afs-studio__derivdesc"
        placeholder="音色描述（性别/音质/适配角色，供 AI 匹配）"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: 'audio', name: asset.name, desc: e.target.value })}
      />
      {url && <audio src={url} controls className="afs-studio__voiceaudio" />}
      <div className="afs-studio__cardactions">
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} title="合成试听" onClick={() => void synthVoice(asset.id)}>
          {asset.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 试听
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      {asset.state === 'failed' && <p className="afs-studio__sberr">{asset.error}</p>}
    </div>
  )
}

function AssetCard({ asset }: { asset: Asset }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const generateAsset = useProjectStore((s) => s.generateAsset)
  const polishAsset = useProjectStore((s) => s.polishAsset)
  const addDerivative = useProjectStore((s) => s.addDerivative)
  const bindRoleVoice = useProjectStore((s) => s.bindRoleVoice)
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  const [showDeriv, setShowDeriv] = useState(false)
  const children = doc.assets.filter((a) => a.parentAssetId === asset.id)
  const voiceAssets = asset.type === 'role' ? doc.assets.filter((a) => a.type === 'audio') : []
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
        placeholder="外貌/特征描述（中文）…"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, desc: e.target.value })}
      />
      <textarea
        className="afs-field__input afs-studio__cardprompt"
        rows={2}
        placeholder="英文生成提示词（点「润色」自动生成，可手改）…"
        value={asset.prompt ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, prompt: e.target.value })}
      />
      <AssetImageStrip asset={asset} />
      {asset.type === 'role' && voiceAssets.length > 0 && (
        <select
          className="afs-field__input afs-studio__voicesel"
          title="为该角色绑定音色"
          value={asset.voiceAssetId ?? ''}
          onChange={(e) => bindRoleVoice(asset.id, e.target.value || undefined)}
        >
          <option value="">（未配音）</option>
          {voiceAssets.map((v) => (
            <option key={v.id} value={v.id}>
              🎙 {v.name}
            </option>
          ))}
        </select>
      )}
      <div className="afs-studio__cardactions">
        <button
          className="afs-btn afs-btn--sm"
          disabled={asset.promptState === 'polishing'}
          title="按画风美术手册把描述润色成英文提示词"
          onClick={() => void polishAsset(asset.id)}
        >
          {asset.promptState === 'polishing' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 润色
        </button>
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} onClick={() => void generateAsset(asset.id)}>
          {asset.state === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 生成
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" title="衍生变体（换装/状态/场景）" onClick={() => setShowDeriv((v) => !v)}>
          <Users size={13} /> 衍生{children.length ? `(${children.length})` : ''}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      {asset.promptState === 'failed' && <p className="afs-studio__sberr">润色失败：{asset.promptError}</p>}
      {showDeriv && (
        <div className="afs-studio__derivrow">
          {children.map((c) => (
            <DerivativeCard key={c.id} asset={c} />
          ))}
          <button className="afs-btn afs-btn--sm afs-studio__derivadd" disabled={!asset.refImageId} title={asset.refImageId ? '新增衍生变体' : '先生成父资产图片'} onClick={() => addDerivative(asset.id)}>
            <Plus size={13} /> 变体
          </button>
        </div>
      )}
    </div>
  )
}

function DerivativeCard({ asset }: { asset: Asset }) {
  const upsertAsset = useProjectStore((s) => s.upsertAsset)
  const removeAsset = useProjectStore((s) => s.removeAsset)
  const generateDerivative = useProjectStore((s) => s.generateDerivative)
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  return (
    <div className="afs-studio__deriv">
      <div className="afs-studio__derivthumb">
        {asset.state === 'generating' ? <Loader2 size={16} className="afs-spin" /> : url ? <img src={url} alt={asset.name} /> : <Users size={16} opacity={0.3} />}
        {asset.state === 'failed' && (
          <span className="afs-studio__err" title={asset.error}>
            <AlertCircle size={12} />
          </span>
        )}
      </div>
      <input className="afs-studio__derivname" value={asset.name} onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: e.target.value })} />
      <input
        className="afs-studio__derivdesc"
        placeholder="变体描述（如：红色礼服 / 受伤狼狈）"
        value={asset.desc ?? ''}
        onChange={(e) => upsertAsset({ id: asset.id, type: asset.type, name: asset.name, desc: e.target.value })}
      />
      <div className="afs-studio__derivactions">
        <button className="afs-btn afs-btn--sm" disabled={asset.state === 'generating'} title="由父图 img2img 生成变体" onClick={() => void generateDerivative(asset.id)}>
          {asset.state === 'generating' ? <Loader2 size={12} className="afs-spin" /> : <Wand2 size={12} />}
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeAsset(asset.id)}>
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

function AssetImageStrip({ asset }: { asset: Asset }) {
  const selectAssetImage = useProjectStore((s) => s.selectAssetImage)
  const deleteAssetImage = useProjectStore((s) => s.deleteAssetImage)
  const imgs = asset.images ?? []
  if (imgs.length < 2) return null
  return (
    <div className="afs-studio__imgstrip" title="历史候选图：点击设为当前，× 删除">
      {imgs.map((im) => (
        <ImageStripThumb
          key={im.id}
          refImageId={im.refImageId}
          selected={im.id === asset.currentImageId}
          onSelect={() => selectAssetImage(asset.id, im.id)}
          onDelete={() => void deleteAssetImage(asset.id, im.id)}
        />
      ))}
    </div>
  )
}

function ImageStripThumb({ refImageId, selected, onSelect, onDelete }: { refImageId: string; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const url = useMediaUrl({ assetId: refImageId })
  return (
    <div className={`afs-studio__imgthumb${selected ? ' is-sel' : ''}`}>
      {url ? <img src={url} alt="" onClick={onSelect} /> : <span className="afs-studio__imgph" onClick={onSelect} />}
      <button title="删除此图" onClick={onDelete}>
        <X size={10} />
      </button>
    </div>
  )
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = src
  })
}

/** 分镜墙（§4.6）：把关键帧拼成 S## 编号网格，纯前端 Canvas 2D 合成 + 导出 PNG（零新依赖）。 */
function StoryboardWall({ onClose }: { onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const items = [...doc.storyboards].sort((a, b) => a.index - b.index).filter((s) => s.keyframeImageId)
      const COLS = 5,
        CW = 320,
        CH = 180,
        PAD = 8,
        LBL = 22
      const rows = Math.max(1, Math.ceil(items.length / COLS))
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = COLS * (CW + PAD) + PAD
      canvas.height = rows * (CH + LBL + PAD) + PAD
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < items.length; i++) {
        if (cancelled) return
        const col = i % COLS
        const row = Math.floor(i / COLS)
        const x = PAD + col * (CW + PAD)
        const y = PAD + row * (CH + LBL + PAD)
        try {
          const url = await loadAssetUrl(items[i].keyframeImageId!)
          if (url) {
            const img = await loadImageEl(url)
            if (cancelled) return
            ctx.drawImage(img, x, y, CW, CH)
          }
        } catch {
          // 单张失败留空
        }
        ctx.fillStyle = '#fff'
        ctx.font = '14px sans-serif'
        ctx.fillText(`S${String(i + 1).padStart(2, '0')}`, x + 4, y + CH + 16)
      }
      if (!cancelled) setBusy(false)
    })()
    return () => {
      cancelled = true
    }
  }, [doc.storyboards])
  const download = () => {
    const c = canvasRef.current
    if (!c) return
    const a = document.createElement('a')
    a.href = c.toDataURL('image/png')
    a.download = `${(doc.meta.name || 'storyboard').replace(/\s+/g, '_')}_wall.png`
    a.click()
  }
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__wall" onClick={(e) => e.stopPropagation()}>
        <div className="afs-studio__drawer-head">
          <span>故事板{busy ? ' · 合成中…' : ''}</span>
          <div>
            <button className="afs-btn afs-btn--sm" disabled={busy} onClick={download}>
              导出 PNG
            </button>
            <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={onClose} title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="afs-studio__wallbody">
          <canvas ref={canvasRef} className="afs-studio__wallcanvas" />
        </div>
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
  const [showWall, setShowWall] = useState(false)
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
        <button className="afs-btn afs-btn--sm afs-btn--ghost" disabled={!hasKeyframes} title="把关键帧拼成故事板网格，可导出 PNG" onClick={() => setShowWall(true)}>
          <Clapperboard size={14} /> 预览故事板
        </button>
      </div>
      {showWall && <StoryboardWall onClose={() => setShowWall(false)} />}
      <div className="afs-studio__sblist">
        {doc.storyboards.length === 0 && <p className="afs-studio__hint">暂无分镜（让右侧 AI 制片自动拆解，或手动新增）。</p>}
        {[...doc.storyboards]
          .sort((a, b) => a.index - b.index)
          .map((s, i, arr) => (
            <StoryboardItem key={s.id} sb={s} index={i} total={arr.length} />
          ))}
      </div>
    </div>
  )
}

function StoryboardItem({ sb, index, total }: { sb: Storyboard; index: number; total: number }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const removeStoryboard = useProjectStore((s) => s.removeStoryboard)
  const moveStoryboard = useProjectStore((s) => s.moveStoryboard)
  const generateKeyframe = useProjectStore((s) => s.generateKeyframe)
  const generateClip = useProjectStore((s) => s.generateClip)
  const [showDetail, setShowDetail] = useState(false)
  const [showFlow, setShowFlow] = useState(false)
  const url = useMediaUrl(sb.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  // 取该分镜所属段的「选用/最新」候选片段，反映状态（一镜多生后不再是唯一片段）
  const track = doc.track.find((t) => t.storyboardIds.includes(sb.id))
  const clipId = track ? track.selectClipId || track.clipIds[track.clipIds.length - 1] : undefined
  const clip = clipId ? doc.clips.find((c) => c.id === clipId) : undefined
  return (
    <div className="afs-studio__sbitem">
      <div className="afs-studio__sbleft">
        <button className="afs-studio__move" disabled={index === 0} title="上移" onClick={() => moveStoryboard(sb.id, -1)}>
          <ChevronUp size={13} />
        </button>
        <span className="afs-studio__sbidx">{index + 1}</span>
        <button className="afs-studio__move" disabled={index === total - 1} title="下移" onClick={() => moveStoryboard(sb.id, 1)}>
          <ChevronDown size={13} />
        </button>
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
        {clip?.state === 'failed' && (
          <span className="afs-studio__sberr" title={clip.error || '视频生成失败'}>
            <AlertCircle size={13} /> 失败
          </span>
        )}
        <button className="afs-btn afs-btn--sm afs-btn--ghost" title="精修关键帧（多参考图融合）" onClick={() => setShowFlow(true)}>
          <Settings2 size={13} /> 精修
        </button>
        <button className={`afs-btn afs-btn--sm afs-btn--ghost${showDetail ? ' is-active' : ''}`} title="详情（时长/轨道/出场资产/提示词/对白）" onClick={() => setShowDetail((v) => !v)}>
          <ChevronDown size={13} /> 详情
        </button>
        <button className="afs-btn afs-btn--sm afs-btn--ghost" onClick={() => removeStoryboard(sb.id)}>
          <Trash2 size={13} />
        </button>
      </div>
      {showDetail && <StoryboardDetail sb={sb} />}
      {showFlow && <ImageFlowEditor sb={sb} onClose={() => setShowFlow(false)} />}
    </div>
  )
}

function StoryboardDetail({ sb }: { sb: Storyboard }) {
  const doc = useProjectStore((s) => s.doc)!
  const upsertStoryboard = useProjectStore((s) => s.upsertStoryboard)
  const roleAssets = doc.assets.filter((a) => !a.parentAssetId)
  const dialogues = sb.dialogues ?? []
  const setDlg = (dlgs: { character: string; line: string; emotion?: string }[]) => upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, dialogues: dlgs })
  const toggleCast = (id: string) => {
    const has = sb.associateAssetIds.includes(id)
    upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, associateAssetIds: has ? sb.associateAssetIds.filter((x) => x !== id) : [...sb.associateAssetIds, id] })
  }
  return (
    <div className="afs-studio__sbdetail">
      <div className="afs-studio__sbfield">
        <label>时长(秒)</label>
        <input type="number" min={1} max={15} value={sb.duration} onChange={(e) => upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, duration: Number(e.target.value) || 5 })} />
        <label>轨道</label>
        <input value={sb.track} onChange={(e) => upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, track: e.target.value })} />
      </div>
      <label className="afs-studio__sbfieldlbl">出场资产</label>
      <div className="afs-studio__castchips">
        {roleAssets.length === 0 && <span className="afs-studio__hint">暂无资产</span>}
        {roleAssets.map((a) => (
          <button key={a.id} className={`afs-studio__chipbtn${sb.associateAssetIds.includes(a.id) ? ' is-on' : ''}`} onClick={() => toggleCast(a.id)}>
            {a.name}
          </button>
        ))}
      </div>
      <label className="afs-studio__sbfieldlbl">关键帧提示词</label>
      <textarea
        className="afs-field__input afs-studio__cardprompt"
        rows={2}
        value={sb.prompt ?? ''}
        placeholder="英文关键帧提示词…"
        onChange={(e) => upsertStoryboard({ id: sb.id, videoDesc: sb.videoDesc, prompt: e.target.value })}
      />
      <label className="afs-studio__sbfieldlbl">对白</label>
      {dialogues.map((d, i) => (
        <div key={i} className="afs-studio__dlgrow">
          <input placeholder="角色" value={d.character} onChange={(e) => setDlg(dialogues.map((x, j) => (j === i ? { ...x, character: e.target.value } : x)))} />
          <input placeholder="台词" value={d.line} onChange={(e) => setDlg(dialogues.map((x, j) => (j === i ? { ...x, line: e.target.value } : x)))} />
          <input placeholder="情绪" value={d.emotion ?? ''} onChange={(e) => setDlg(dialogues.map((x, j) => (j === i ? { ...x, emotion: e.target.value } : x)))} />
          <button title="删除" onClick={() => setDlg(dialogues.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button className="afs-btn afs-btn--sm" onClick={() => setDlg([...dialogues, { character: '', line: '' }])}>
        <Plus size={12} /> 台词
      </button>
    </div>
  )
}

function ImageFlowEditor({ sb, onClose }: { sb: Storyboard; onClose: () => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const refineKeyframe = useProjectStore((s) => s.refineKeyframe)
  const assets = doc.assets.filter((a) => a.refImageId)
  const [sel, setSel] = useState<string[]>(() =>
    sb.associateAssetIds.map((id) => doc.assets.find((a) => a.id === id)?.refImageId).filter((x): x is string => !!x)
  )
  const [prompt, setPrompt] = useState(sb.prompt || sb.videoDesc || '')
  const kfUrl = useMediaUrl(sb.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  const toggle = (refImageId: string) => setSel((s) => (s.includes(refImageId) ? s.filter((x) => x !== refImageId) : [...s, refImageId]))
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__flowedit" onClick={(e) => e.stopPropagation()}>
        <div className="afs-studio__drawer-head">
          <span>关键帧精修 · 多参考图融合</span>
          <button className="afs-btn afs-btn--ghost afs-btn--sm" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="afs-studio__flowbody">
          <div className="afs-studio__flowrefs">
            <div className="afs-studio__sbfieldlbl">参考图（勾选要融合的资产/已出图）</div>
            <div className="afs-studio__flowgrid">
              {assets.length === 0 && <span className="afs-studio__hint">暂无已出图资产</span>}
              {assets.map((a) => (
                <FlowRef key={a.id} asset={a} selected={!!a.refImageId && sel.includes(a.refImageId)} onToggle={() => a.refImageId && toggle(a.refImageId)} />
              ))}
            </div>
          </div>
          <div className="afs-studio__flowmain">
            {kfUrl && <img className="afs-studio__flowkf" src={kfUrl} alt="当前关键帧" />}
            <textarea className="afs-field__input" rows={4} value={prompt} placeholder="精修指令（保留参考图主体，改 xxx）…" onChange={(e) => setPrompt(e.target.value)} />
            <button className="afs-btn afs-btn--primary afs-btn--sm" disabled={sb.state === 'generating' || !prompt.trim()} onClick={() => void refineKeyframe(sb.id, sel, prompt)}>
              {sb.state === 'generating' ? <Loader2 size={14} className="afs-spin" /> : <Wand2 size={14} />} 生成并设为关键帧
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function FlowRef({ asset, selected, onToggle }: { asset: Asset; selected: boolean; onToggle: () => void }) {
  const url = useMediaUrl(asset.refImageId ? { assetId: asset.refImageId } : null)
  return (
    <div className={`afs-studio__flowref${selected ? ' is-sel' : ''}`} onClick={onToggle} title={asset.name}>
      {url ? <img src={url} alt={asset.name} /> : <Users size={16} opacity={0.3} />}
      <span>{asset.name}</span>
    </div>
  )
}

function TimelineTab() {
  const doc = useProjectStore((s) => s.doc)!
  const compose = useProjectStore((s) => s.compose)
  const film = useProjectStore((s) => s.film)
  const batch = useProjectStore((s) => s.batch)
  const generateAllTrackPrompts = useProjectStore((s) => s.generateAllTrackPrompts)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const [preview, setPreview] = useState<{ localPath?: string; url?: string } | null>(null)
  const tracks = [...doc.track].sort((a, b) => a.order - b.order)
  const anyDone = doc.clips.some((c) => c.state === 'done')
  if (tracks.length === 0)
    return (
      <div className="afs-studio__timeline">
        <p className="afs-studio__hint">还没有分镜。去「分镜」新增镜头并生成关键帧 → 视频，每段可多生候选、选优后合成。</p>
      </div>
    )
  return (
    <div className="afs-studio__timeline">
      <div className="afs-studio__timeline-head">
        <p className="afs-studio__hint">{tracks.length} 段 · 每段可多生候选、选优后合成</p>
        <button className="afs-btn afs-btn--sm" disabled={batch.running || !tracks.some((t) => t.storyboardIds.length)} title="按模型+模式批量生成各段视频提示词" onClick={() => void generateAllTrackPrompts()}>
          {batch.running ? <Loader2 size={14} className="afs-spin" /> : <Wand2 size={14} />} 全部段提示词
        </button>
        <select className="afs-field__input afs-studio__sel" title="整片转场" value={doc.meta.transition ?? 'fade'} onChange={(e) => updateMeta({ transition: e.target.value as 'none' | 'fade' | 'xfade' })}>
          <option value="fade">淡入淡出</option>
          <option value="xfade">交叉溶解</option>
          <option value="none">硬切</option>
        </select>
        <button className="afs-btn afs-btn--primary afs-btn--sm" disabled={film.state === 'composing' || !anyDone} onClick={() => void compose()}>
          {film.state === 'composing' ? <Loader2 size={14} className="afs-spin" /> : <Film size={14} />} 合成成片
        </button>
      </div>
      {film.state === 'composing' && <p className="afs-studio__hint">{film.text}</p>}
      {film.state === 'failed' && <p className="afs-studio__err-text">合成失败：{film.error}</p>}
      <div className="afs-studio__tracklist">
        {tracks.map((t, i) => (
          <TrackCard key={t.id} track={t} order={i} onPreview={(c) => setPreview({ localPath: c.videoFilePath, url: c.videoUrl })} />
        ))}
      </div>
      {film.state === 'done' && film.path && <FilmDone path={film.path} name={doc.meta.name} />}
      {preview && <ClipPreview localPath={preview.localPath} url={preview.url} onClose={() => setPreview(null)} />}
    </div>
  )
}

function TrackCard({ track, order, onPreview }: { track: VideoTrack; order: number; onPreview: (c: Clip) => void }) {
  const doc = useProjectStore((s) => s.doc)!
  const selectClip = useProjectStore((s) => s.selectClip)
  const deleteClip = useProjectStore((s) => s.deleteClip)
  const updateTrackDuration = useProjectStore((s) => s.updateTrackDuration)
  const updateTrackPrompt = useProjectStore((s) => s.updateTrackPrompt)
  const generateTrackPrompt = useProjectStore((s) => s.generateTrackPrompt)
  const generateClip = useProjectStore((s) => s.generateClip)
  const sb = track.storyboardIds.length ? doc.storyboards.find((s) => s.id === track.storyboardIds[0]) : undefined
  const kf = useMediaUrl(sb?.keyframeImageId ? { assetId: sb.keyframeImageId } : null)
  const cands = track.clipIds.map((id) => doc.clips.find((c) => c.id === id)).filter(Boolean) as Clip[]
  const selId = track.selectClipId || track.clipIds[0]
  const generating = cands.some((c) => c.state === 'generating')
  return (
    <div className="afs-studio__trackcard">
      <div className="afs-studio__trackcard-head">
        <span className="afs-studio__sbidx">{order + 1}</span>
        {kf ? <img className="afs-studio__trackkf" src={kf} alt="" /> : <Clapperboard size={16} opacity={0.3} />}
        <span className="afs-studio__trackdesc" title={sb?.videoDesc}>{sb?.videoDesc || '（无分镜）'}</span>
        <label className="afs-studio__trackdur" title="段时长（秒），留空用分镜推荐时长">
          <input
            type="number"
            min={1}
            max={15}
            value={track.duration ?? ''}
            placeholder={String(sb?.duration ?? 5)}
            onChange={(e) => updateTrackDuration(track.id, e.target.value ? Number(e.target.value) : undefined)}
          />
          s
        </label>
        <button
          className="afs-btn afs-btn--sm"
          disabled={!sb?.keyframeImageId || generating}
          title={!sb?.keyframeImageId ? '先生成关键帧' : cands.length ? '再生成一个候选（一镜多生选优）' : '由关键帧生成视频'}
          onClick={() => sb && void generateClip(sb.id)}
        >
          {generating ? <Loader2 size={13} className="afs-spin" /> : <Film size={13} />} {cands.length ? '再生一版' : '生成视频'}
        </button>
      </div>
      <div className="afs-studio__trackprompt">
        <textarea
          className="afs-field__input"
          rows={2}
          value={track.prompt ?? ''}
          placeholder="段视频提示词（按模型+模式生成，可手改；留空则用画面描述）…"
          onChange={(e) => updateTrackPrompt(track.id, e.target.value)}
        />
        <button
          className="afs-btn afs-btn--sm"
          disabled={track.promptState === 'generating' || !sb}
          title="按视频模型 + 模式生成段视频提示词（12 字段拆解 / 台词标注 / @图N）"
          onClick={() => void generateTrackPrompt(track.id)}
        >
          {track.promptState === 'generating' ? <Loader2 size={13} className="afs-spin" /> : <Wand2 size={13} />} 提示词
        </button>
      </div>
      {track.promptState === 'failed' && <p className="afs-studio__sberr">提示词生成失败：{track.promptError}</p>}
      {cands.length > 0 && (
        <div className="afs-studio__candrow">
          {cands.map((c) => (
            <CandidateClip
              key={c.id}
              clip={c}
              selected={c.id === selId}
              onSelect={() => selectClip(track.id, c.id)}
              onPreview={() => onPreview(c)}
              onDelete={() => deleteClip(track.id, c.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CandidateClip({ clip, selected, onSelect, onPreview, onDelete }: { clip: Clip; selected: boolean; onSelect: () => void; onPreview: () => void; onDelete: () => void }) {
  const src = useMediaUrl({ localPath: clip.videoFilePath, url: clip.videoUrl })
  return (
    <div className={`afs-studio__cand${selected ? ' is-sel' : ''}`}>
      {clip.state === 'generating' ? (
        <div className="afs-studio__cand-load">
          <Loader2 size={16} className="afs-spin" />
        </div>
      ) : clip.state === 'failed' ? (
        <div className="afs-studio__cand-load" title={clip.error || '生成失败'}>
          <AlertCircle size={16} />
        </div>
      ) : (
        <video src={src} muted playsInline preload="metadata" onClick={onSelect} title="点击设为当选" />
      )}
      {selected && <span className="afs-studio__cand-badge">当选</span>}
      <div className="afs-studio__cand-actions">
        <button title="设为当选" onClick={onSelect}>
          ✓
        </button>
        <button title="预览（有声）" onClick={onPreview}>
          <Film size={11} />
        </button>
        <button title="删除候选" onClick={onDelete}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function ClipPreview({ localPath, url, onClose }: { localPath?: string; url?: string; onClose: () => void }) {
  const src = useMediaUrl({ localPath, url })
  return (
    <div className="afs-studio__lightbox" onClick={onClose}>
      <div className="afs-studio__lightbox-body" onClick={(e) => e.stopPropagation()}>
        <button className="afs-studio__lightbox-close" onClick={onClose} title="关闭">
          <X size={18} />
        </button>
        {/* controls + 有声（不静音）→ 单独预览该片段 */}
        <video src={src} controls autoPlay playsInline className="afs-studio__lightbox-video" />
      </div>
    </div>
  )
}

function FilmPreview({ path }: { path: string }) {
  const src = useMediaUrl({ localPath: path })
  return <video className="afs-studio__filmvideo" src={src} controls preload="metadata" />
}

function FilmDone({ path, name }: { path: string; name: string }) {
  const openFolder = () => void window.mulby?.shell?.showItemInFolder(path)
  const saveAs = async () => {
    try {
      const dest = await window.mulby?.dialog?.showSaveDialog({
        title: '另存成片',
        defaultPath: `${(name || 'film').replace(/\s+/g, '_')}.mp4`,
        filters: [{ name: '视频', extensions: ['mp4'] }],
      })
      if (!dest) return
      const data = await window.mulby?.filesystem?.readFile(path, 'base64')
      if (typeof data === 'string') await window.mulby?.filesystem?.writeFile(dest, data, 'base64')
      window.mulby?.notification?.show('已另存成片', 'success')
    } catch (e) {
      window.mulby?.notification?.show('另存失败：' + (e instanceof Error ? e.message : String(e)), 'error')
    }
  }
  return (
    <div className="afs-studio__film">
      <FilmPreview path={path} />
      <div className="afs-studio__tabbar">
        <button className="afs-btn afs-btn--sm" onClick={openFolder}>
          <Film size={13} /> 打开所在文件夹
        </button>
        <button className="afs-btn afs-btn--sm" onClick={() => void saveAs()}>
          <BookOpen size={13} /> 另存为…
        </button>
      </div>
      <p className="afs-studio__hint">成片已导出：{path}</p>
    </div>
  )
}
