import { CATEGORY_META, CATEGORY_ORDER, getDefsByCategory, type NodeDef } from '../nodes/nodeDefs'
import { useGraphStore } from '../store/graphStore'

export const DND_MIME = 'application/afs-node'
export const DND_ASSET = 'application/afs-asset'
export const DND_ELEMENT = 'application/afs-element'
export const DND_SNIPPET = 'application/afs-snippet'

export default function NodeLibrary() {
  const nodes = useGraphStore((s) => s.nodes)
  const addNode = useGraphStore((s) => s.addNode)

  const onDragStart = (e: React.DragEvent, def: NodeDef) => {
    e.dataTransfer.setData(DND_MIME, def.kind)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onClickAdd = (def: NodeDef) => {
    const count = nodes.length
    addNode(def.kind, { x: 360 + (count % 6) * 34, y: 150 + (count % 6) * 34 })
  }

  return (
    <div className="afs-library">
      <div className="afs-library__title">节点库</div>
      <div className="afs-library__hint">拖拽到画布，或点击添加</div>
      <div className="afs-library__scroll">
        {CATEGORY_ORDER.map((cat) => {
          const defs = getDefsByCategory(cat)
          if (defs.length === 0) return null
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
                    draggable
                    onDragStart={(e) => onDragStart(e, def)}
                    onClick={() => onClickAdd(def)}
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
