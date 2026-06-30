/**
 * Toonflow 式重构 · 阶段1（§7.1/§7.3）：工作台左侧资源 Dock。
 *
 * 把「素材库 / 角色 / 提示词片段」收敛进工作台（不再是与工作台平级的顶层视图）。点击即插入到
 * 「最后聚焦的输入框」（见 focusInsert）——素材/角色插名字，片段插正文。复用 AssetsView 的缩略图组件
 * 与 promptStore 片段，以及画布 Dock 的全部 CSS 类（afs-dock*），零新增样式逻辑。
 */
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { AssetThumb, RefThumb } from '../components/views/AssetsView'
import { DND_ASSET, DND_ELEMENT } from '../components/NodeLibrary'
import { useAssetStore } from '../store/assetStore'
import { usePromptStore, resolveSnippet, SNIPPET_GROUPS, type PromptSnippet } from '../store/promptStore'
import { insertAtFocused } from './services/focusInsert'
import Segmented from '../components/ui/Segmented'

type DockTab = 'assets' | 'prompts'
const TAB_LABEL: Record<DockTab, string> = { assets: '素材', prompts: '提示词' }

function notifyInsert(ok: boolean) {
  window.mulby?.notification?.show(ok ? '已插入到聚焦的输入框' : '请先点选一个输入框/文本域', ok ? 'success' : 'warning')
}

/** 工作台左侧资源 Dock：素材 | 提示词 两标签。 */
export default function StudioDock() {
  const [tab, setTab] = useState<DockTab>('assets')
  return (
    <div className="afs-dock afs-studio__dock">
      <div className="afs-dock__tabs">
        <Segmented
          size="sm"
          value={tab}
          onChange={(v) => setTab(v as DockTab)}
          options={(['assets', 'prompts'] as const).map((t) => ({ value: t, label: TAB_LABEL[t] }))}
          ariaLabel="资源类型"
        />
      </div>
      <div className="afs-dock__body">
        {tab === 'assets' && <AssetInsertPanel />}
        {tab === 'prompts' && <SnippetInsertPanel />}
      </div>
    </div>
  )
}

function AssetInsertPanel() {
  const assets = useAssetStore((s) => s.assets)
  const elements = useAssetStore((s) => s.elements)
  const loaded = useAssetStore((s) => s.loaded)
  const load = useAssetStore((s) => s.load)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const kw = q.trim().toLowerCase()
  const fa = assets
    .filter((a) => !kw || `${a.name || ''} ${a.nodeKind || ''} ${a.projectName || ''}`.toLowerCase().includes(kw))
    .sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="afs-dockpanel">
      <div className="afs-dockpanel__search">
        <Search size={13} />
        <input placeholder="搜索素材…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="afs-dockpanel__hint">点击把名称插入到聚焦输入框；拖到右侧「资产」对应分组（人物/场景/物品）即按该类加入项目（含参考图）</div>
      <div className="afs-dockpanel__scroll">
        {elements.length > 0 && (
          <>
            <div className="afs-dockpanel__sec">角色 / 场景</div>
            <div className="afs-dock__grid">
              {elements.map((el) => (
                <div
                  key={el.id}
                  className="afs-dockitem"
                  draggable
                  onClick={() => notifyInsert(insertAtFocused(el.name))}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_ELEMENT, el.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={`${el.kind === 'character' ? '角色' : el.kind === 'prop' ? '物品' : '场景'}：${el.name}（点击插名称 · 拖到「资产」分组加入）`}
                >
                  <RefThumb assetId={el.views?.front ?? el.refAssetIds?.[0]} />
                  <span className="afs-dockitem__cap">{el.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="afs-dockpanel__sec">素材</div>
        {fa.length === 0 ? (
          <div className="afs-dockpanel__empty">{loaded ? '暂无素材' : '加载中…'}</div>
        ) : (
          <div className="afs-dock__grid">
            {fa.map((a) => {
              const label = a.name || a.nodeKind || a.type
              return (
                <div
                  key={a.id}
                  className="afs-dockitem"
                  draggable
                  onClick={() => notifyInsert(insertAtFocused(label))}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_ASSET, a.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  title={`${label}（点击插名称 · 图片可拖到「资产」分组加入）`}
                >
                  <AssetThumb rec={a} />
                  <span className="afs-dockitem__cap">{label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SnippetInsertPanel() {
  const snippets = usePromptStore((s) => s.snippets)
  const onUse = (s: PromptSnippet) => notifyInsert(insertAtFocused(resolveSnippet(s)))
  return (
    <div className="afs-dockpanel">
      <div className="afs-dockpanel__hint">点击把片段插入到聚焦的输入框</div>
      <div className="afs-dockpanel__scroll">
        {snippets.length === 0 ? (
          <div className="afs-dockpanel__empty">暂无片段，去设置抽屉「提示词库」新建</div>
        ) : (
          SNIPPET_GROUPS.map((g) => {
            const items = snippets.filter((s) => s.group === g.id)
            return items.length ? (
              <div key={g.id}>
                <div className="afs-dockpanel__sec">{g.label}</div>
                {items.map((s) => (
                  <div key={s.id} className="afs-docksnip" onClick={() => onUse(s)} title="点击插入到聚焦的输入框">
                    {s.name}
                  </div>
                ))}
              </div>
            ) : null
          })
        )}
      </div>
    </div>
  )
}
