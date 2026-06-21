import { useGraph } from '../store/graphStore'

function findVideoEl(cardId: string): HTMLVideoElement | null {
  const el = document.querySelector(`[data-card-id="${cardId}"] video`)
  return el instanceof HTMLVideoElement ? el : null
}

// 递归收集组内（含嵌套组）所有已渲染的视频卡的 <video> 元素
export function collectGroupVideos(groupId: string): Array<{ cardId: string; el: HTMLVideoElement }> {
  const board = useGraph.getState().getActiveBoard()
  const out: Array<{ cardId: string; el: HTMLVideoElement }> = []
  const walk = (gid: string) => {
    for (const c of Object.values(board.cards)) {
      if (c.parentId !== gid) continue
      if (c.kind === 'group') walk(c.id)
      else if (c.kind === 'video' && c.assetUrl) {
        const v = findVideoEl(c.id)
        if (v) out.push({ cardId: c.id, el: v })
      }
    }
  }
  walk(groupId)
  return out
}

function waitMeta(v: HTMLVideoElement, timeout = 800): Promise<boolean> {
  if (v.readyState >= 1) return Promise.resolve(true)
  return new Promise((resolve) => {
    const onMeta = () => {
      v.removeEventListener('loadedmetadata', onMeta)
      resolve(true)
    }
    v.addEventListener('loadedmetadata', onMeta, { once: true })
    setTimeout(() => {
      v.removeEventListener('loadedmetadata', onMeta)
      resolve(v.readyState >= 1)
    }, timeout)
  })
}

// 组内视频同步从头播放：先全部 seek 到 0 + 等元数据，再同一时刻批量 play()
export async function syncPlayGroup(groupId: string): Promise<{ played: number; total: number }> {
  const vids = collectGroupVideos(groupId)
  if (vids.length < 2) return { played: 0, total: vids.length }
  const keep = new Set(vids.map((v) => v.el))
  document.querySelectorAll('video').forEach((v) => {
    if (!keep.has(v as HTMLVideoElement)) {
      try {
        ;(v as HTMLVideoElement).pause()
      } catch {
        /* ignore */
      }
    }
  })
  const ready: HTMLVideoElement[] = []
  for (const { el } of vids) {
    try {
      el.currentTime = 0
    } catch {
      /* ignore */
    }
    if (await waitMeta(el)) ready.push(el)
  }
  if (ready.length < 2) return { played: 0, total: vids.length }
  const r = await Promise.all(ready.map((v) => v.play().then(() => true).catch(() => false)))
  return { played: r.filter(Boolean).length, total: vids.length }
}

export function pauseGroup(groupId: string): void {
  collectGroupVideos(groupId).forEach(({ el }) => {
    try {
      el.pause()
    } catch {
      /* ignore */
    }
  })
}
