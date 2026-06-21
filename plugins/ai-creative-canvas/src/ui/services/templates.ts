import type { Card, GroupTemplate, Edge } from '../types'
import { uid } from '../util'

const PLUGIN_ID = 'ai-creative-canvas'
const KEY = 'templates:list'
const storage = () => (window as any).mulby?.storage

export async function listTemplates(): Promise<GroupTemplate[]> {
  try {
    const v = await storage()?.get(KEY, PLUGIN_ID)
    return Array.isArray(v) ? (v as GroupTemplate[]) : []
  } catch {
    return []
  }
}

// 把一个组（含嵌套子树 + 内部连线）存为模板；坐标归一化到组左上角；不存产物
export async function saveGroupAsTemplate(
  groupId: string,
  name: string,
  board: { cards: Record<string, Card>; edges: Record<string, Edge> }
): Promise<GroupTemplate | null> {
  const grp = board.cards[groupId]
  if (!grp || grp.kind !== 'group') return null

  const memberIds = new Set<string>()
  const walk = (gid: string) => {
    for (const c of Object.values(board.cards)) {
      if (c.parentId === gid) {
        memberIds.add(c.id)
        if (c.kind === 'group') walk(c.id)
      }
    }
  }
  walk(groupId)

  const localOf = new Map<string, string>()
  let i = 0
  for (const id of memberIds) localOf.set(id, `m${i++}`)

  const members = [...memberIds].map((id) => {
    const c = board.cards[id]
    const { assetUrl, assetLocalPath, attachmentId, parentId, id: _id, ...rest } = c
    void assetUrl
    void assetLocalPath
    void attachmentId
    void _id
    return {
      localId: localOf.get(id) as string,
      parentLocalId: parentId === groupId ? null : (localOf.get(parentId as string) ?? null),
      card: { ...rest, x: c.x - grp.x, y: c.y - grp.y }
    }
  })

  const edges = Object.values(board.edges)
    .filter((e) => memberIds.has(e.source) && memberIds.has(e.target))
    .map((e) => ({ source: localOf.get(e.source) as string, target: localOf.get(e.target) as string, kind: e.kind }))

  const { expandedH: _expandedH, ...gparams } = (grp.params || {}) as Record<string, unknown>
  void _expandedH
  const tpl: GroupTemplate = {
    id: uid('tpl'),
    name: name.trim() || '未命名模板',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // 用展开高度（若当前折叠）而非折叠条高度；params 去掉 expandedH/collapsed
    group: { w: grp.w, h: (grp.params?.expandedH as number) || grp.h, title: grp.title, params: { ...gparams, collapsed: false } },
    members,
    edges
  }
  try {
    const all = await listTemplates()
    await storage()?.set(KEY, [...all, tpl], PLUGIN_ID)
    return tpl
  } catch {
    return null
  }
}

export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    const all = await listTemplates()
    await storage()?.set(KEY, all.filter((t) => t.id !== id), PLUGIN_ID)
    return true
  } catch {
    return false
  }
}
