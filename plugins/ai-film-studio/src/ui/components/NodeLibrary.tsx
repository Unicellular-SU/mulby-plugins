import { useState } from 'react'
import { Search, X } from 'lucide-react'
import { CATEGORY_META, CATEGORY_ORDER, getDefsByCategory, type NodeDef } from '../nodes/nodeDefs'
import { useGraphStore } from '../store/graphStore'

export const DND_MIME = 'application/afs-node'
export const DND_ASSET = 'application/afs-asset'
export const DND_ELEMENT = 'application/afs-element'
export const DND_SNIPPET = 'application/afs-snippet'

export default function NodeLibrary() {
  const nodes = useGraphStore((s) => s.nodes)
  const addNode = useGraphStore((s) => s.addNode)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const onDragStart = (e: React.DragEvent, def: NodeDef) => {
    e.dataTransfer.setData(DND_MIME, def.kind)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onClickAdd = (def: NodeDef) => {
    const count = nodes.length
    addNode(def.kind, { x: 360 + (count % 6) * 34, y: 150 + (count % 6) * 34 })
  }

  const match = (def: NodeDef) =>
    !q ||
    def.label.toLowerCase().includes(q) ||
    (def.desc || '').toLowerCase().includes(q) ||
    def.kind.toLowerCase().includes(q)
  const groups = CATEGORY_ORDER.map((cat) => ({ cat, defs: getDefsByCategory(cat).filter(match) })).filter((g) => g.defs.length > 0)

  return (
    <div className="afs-library">
      <div className="afs-library__title">节点库</div>
      <div className="afs-library__hint">拖拽到画布，或点击添加</div>
      <div className="afs-library__search">
        <Search size={14} className="afs-library__search-icon" aria-hidden />
        <input
          type="text"
          className="afs-library__search-input"
          placeholder="搜索节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="搜索节点"
        />
        {query && (
          <button type="button" className="afs-library__search-clear" aria-label="清除搜索" onClick={() => setQuery('')}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="afs-library__scroll">
        {groups.length === 0 && <div className="afs-library__empty">无匹配节点</div>}
        {groups.map(({ cat, defs }) => {
          const meta = CATEGORY_META[cat]
          return (
            <div key={cat} className="afs-libgroup">
              <div className="afs-libgroup__header">
                <span className="afs-libgroup__dot" style={{ background: `var(--afs-cat-${cat})` }} />
                {meta.label}
              </div>
              {defs.map((def) => {
                const Icon = def.icon
                return (
                  <div
                    key={def.kind}
                    className="afs-libitem"
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => onDragStart(e, def)}
                    onClick={() => onClickAdd(def)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onClickAdd(def)
                      }
                    }}
                    title={def.desc}
                  >
                    <span className="afs-libitem__icon" style={{ color: `var(--afs-cat-${cat})` }}>
                      <Icon size={15} />
                    </span>
                    <div className="afs-libitem__text">
                      <div className="afs-libitem__label">{def.label}</div>
                      <div className="afs-libitem__desc">{def.desc}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
