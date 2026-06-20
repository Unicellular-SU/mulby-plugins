import { useGraph } from '../store/graphStore'
import { saveBase64 } from './media'
import { arrayBufferToBase64 } from '../util'
import type { CardKind } from '../types'

function kindForMime(mime: string): CardKind {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/')) return 'text'
  return 'source' // image/* 及其它 → 素材卡（渲染为图片）
}

function guessMimeByExt(ext: string): string {
  const e = ext.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e)) return `image/${e === 'jpg' ? 'jpeg' : e}`
  if (['mp4', 'webm', 'mov'].includes(e)) return `video/${e}`
  if (['mp3', 'wav', 'aac', 'opus'].includes(e)) return `audio/${e}`
  return ''
}

export async function importFiles(files: File[] | FileList, world: { x: number; y: number }): Promise<void> {
  const g = useGraph.getState()
  const projectId = g.project.id
  let i = 0
  for (const file of Array.from(files)) {
    const mime = file.type || ''
    const pos = { x: world.x + i * 30, y: world.y + i * 30 }
    try {
      if (mime.startsWith('text/') || /\.(txt|md|json|srt)$/i.test(file.name)) {
        const text = await file.text()
        g.addCard('text', pos, { title: file.name, text, status: 'done' })
      } else {
        const buf = await file.arrayBuffer()
        const b64 = arrayBufferToBase64(buf)
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
        const saved = await saveBase64(projectId, 'import', b64, ext)
        g.addCard(kindForMime(mime), pos, {
          title: file.name,
          assetUrl: saved.url,
          assetLocalPath: saved.path,
          mime,
          status: 'done'
        })
      }
    } catch {
      /* skip file */
    }
    i++
  }
}

interface AttachmentLike {
  path?: string
  name?: string
  dataUrl?: string
  mime?: string
}

export async function importAttachments(atts: AttachmentLike[], world: { x: number; y: number }): Promise<void> {
  const g = useGraph.getState()
  const projectId = g.project.id
  const fs = (window as any).mulby?.filesystem
  let i = 0
  for (const a of atts) {
    const pos = { x: world.x + i * 30, y: world.y + i * 30 }
    try {
      if (a.path && fs) {
        const b64 = (await fs.readFile(a.path, 'base64')) as string
        const ext = (a.path.split('.').pop() || 'png').toLowerCase()
        const mime = a.mime || guessMimeByExt(ext)
        const saved = await saveBase64(projectId, 'import', b64, ext)
        g.addCard(kindForMime(mime), pos, {
          title: a.name || a.path.split(/[\\/]/).pop() || '素材',
          assetUrl: saved.url,
          assetLocalPath: saved.path,
          mime,
          status: 'done'
        })
      } else if (a.dataUrl) {
        const m = /^data:([^;]+);base64,(.*)$/.exec(a.dataUrl)
        if (m) {
          const dmime = m[1]
          const ext = (dmime.split('/')[1] || 'png').toLowerCase()
          const saved = await saveBase64(projectId, 'import', m[2], ext)
          g.addCard(kindForMime(dmime), pos, {
            title: a.name || '素材',
            assetUrl: saved.url,
            assetLocalPath: saved.path,
            mime: dmime,
            status: 'done'
          })
        }
      }
    } catch {
      /* skip */
    }
    i++
  }
}
