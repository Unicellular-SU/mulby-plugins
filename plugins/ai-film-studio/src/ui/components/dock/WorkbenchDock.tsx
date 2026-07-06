import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import NodeLibrary, { DND_ASSET, DND_ELEMENT, DND_SNIPPET } from '../NodeLibrary'
import { AssetThumb, RefThumb } from '../views/AssetsView'
import { useAssetHubStore } from '../../store/assetHubStore'
import { useGraphStore } from '../../store/graphStore'
import { usePromptStore, resolveSnippet, SNIPPET_GROUPS, type PromptSnippet } from '../../store/promptStore'

type DockTab = 'nodes' | 'assets' | 'prompts'
const TAB_LABEL: Record<DockTab, string> = { nodes: '节点', assets: '资源', prompts: '提示词' }

/** 编辑器左侧 Dock：节点 | 资源 | 提示词 三标签，可把媒体文件/身份资产/片段拖到画布。 */
export default function WorkbenchDock() {
  const [tab, setTab] = useState<DockTab>('nodes')
  return (
    <div className="afs-dock">
      <div className="afs-dock__tabs">
        {(['nodes', 'assets', 'prompts'] as const).map((t) => (
          <button key={t} className={`afs-dock__tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="afs-dock__body">
        {tab === 'nodes' && <NodeLibrary />}
        {tab === 'assets' && <AssetDockPanel />}
        {tab === 'prompts' && <SnippetDockPanel />}
      </div>
    </div>
  )
}

function AssetDockPanel() {
  const assets = useAssetHubStore((s) => s.mediaAssets)
  const entities = useAssetHubStore((s) => s.entities)
  const loaded = useAssetHubStore((s) => s.loaded)
  const refresh = useAssetHubStore((s) => s.refresh)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!loaded) void refresh()
  }, [loaded, refresh])

  const kw = q.trim().toLowerCase()
  const fa = assets
    .filter((a) => !kw || `${a.name || ''} ${a.nodeKind || ''} ${a.projectName || ''}`.toLowerCase().includes(kw))
    .sort((a, b) => b.createdAt - a.createdAt)
  const filteredEntities = entities.filter((entity) => !kw || `${entity.name || ''} ${entity.aliases?.join(' ') || ''} ${entity.kind}`.toLowerCase().includes(kw))
  const entityPreviewAssetId = (entity: (typeof entities)[number]) =>
    entity.mediaRefs?.find((ref) => ref.role === 'front' && ref.assetId)?.assetId ??
    entity.mediaRefs?.find((ref) => (ref.role === 'primary' || ref.role === 'reference') && ref.assetId)?.assetId ??
    entity.mediaRefs?.find((ref) => !!ref.assetId)?.assetId
  const entityKindLabel = (kind: string) => (kind === 'character' ? '角色' : kind === 'prop' ? '物品' : kind === 'voice' ? '音色' : '场景')

  return (
    <div className="afs-dockpanel">
      <div className="afs-dockpanel__search">
        <Search size={13} />
        <input placeholder="搜索资源…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="afs-dockpanel__hint">拖到画布即插入：媒体文件→参考节点；身份资产→人物/场景/物品节点</div>
      <div className="afs-dockpanel__scroll">
        {filteredEntities.length > 0 && (
          <>
            <div className="afs-dockpanel__sec">身份资产</div>
            <div className="afs-dock__grid">
              {filteredEntities.map((entity) => (
                <div
                  key={entity.id}
                  className="afs-dockitem"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_ELEMENT, entity.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  title={`${entityKindLabel(entity.kind)}：${entity.name}`}
                >
                  <RefThumb assetId={entityPreviewAssetId(entity)} />
                  <span className="afs-dockitem__cap">{entity.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="afs-dockpanel__sec">媒体文件</div>
        {fa.length === 0 ? (
          <div className="afs-dockpanel__empty">{loaded ? '暂无媒体文件' : '加载中…'}</div>
        ) : (
          <div className="afs-dock__grid">
            {fa.map((a) => (
              <div
                key={a.id}
                className="afs-dockitem"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_ASSET, a.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                title={a.name || a.nodeKind || a.type}
              >
                <AssetThumb rec={a} />
                <span className="afs-dockitem__cap">{a.name || a.nodeKind || a.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SnippetDockPanel() {
  const snippets = usePromptStore((s) => s.snippets)
  const append = useGraphStore((s) => s.appendTextToSelected)

  const onUse = (s: PromptSnippet) => {
    const ok = append(resolveSnippet(s))
    window.mulby?.notification?.show(ok ? '已插入到选中节点' : '请先选中一个含文本参数的节点', ok ? 'success' : 'warning')
  }

  return (
    <div className="afs-dockpanel">
      <div className="afs-dockpanel__hint">点击插入到选中节点，或拖到画布</div>
      <div className="afs-dockpanel__scroll">
        {snippets.length === 0 ? (
          <div className="afs-dockpanel__empty">暂无片段，去「提示词库」新建</div>
        ) : (
          SNIPPET_GROUPS.map((g) => {
            const items = snippets.filter((s) => s.group === g.id)
            return items.length ? (
              <div key={g.id}>
                <div className="afs-dockpanel__sec">{g.label}</div>
                {items.map((s) => (
                  <div
                    key={s.id}
                    className="afs-docksnip"
                    draggable
                    onClick={() => onUse(s)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_SNIPPET, s.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    title="点击插入 / 拖到画布"
                  >
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
