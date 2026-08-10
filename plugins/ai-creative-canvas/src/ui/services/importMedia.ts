import { useGraph } from '../store/graphStore'
import { saveBase64 } from './media'
import { arrayBufferToBase64 } from '../util'
import { toast } from '../store/toastStore'
import { extensionOf, kindForMime, resolveImportMime } from './importMediaTypes'

interface ImportFailure {
  name: string
  reason: string
}

function reasonOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  return raw.trim().slice(0, 100) || '读取或保存失败'
}

function reportFailures(failures: ImportFailure[]): void {
  if (!failures.length) return
  const shown = failures.slice(0, 3).map((f) => `${f.name}（${f.reason}）`).join('、')
  const more = failures.length > 3 ? `，另有 ${failures.length - 3} 个` : ''
  toast(`导入失败 ${failures.length} 个：${shown}${more}`, 'error')
}

export async function importFiles(files: File[] | FileList, world: { x: number; y: number }): Promise<void> {
  const g = useGraph.getState()
  const projectId = g.project.id
  const failures: ImportFailure[] = []
  let i = 0
  for (const file of Array.from(files)) {
    const ext = extensionOf(file.name) || 'bin'
    const mime = resolveImportMime(file.name, file.type)
    const pos = { x: world.x + i * 30, y: world.y + i * 30 }
    try {
      if (mime.startsWith('text/') || /\.(txt|md|json|srt)$/i.test(file.name)) {
        const text = await file.text()
        g.addCard('text', pos, { title: file.name, text, status: 'done' })
      } else {
        const buf = await file.arrayBuffer()
        const b64 = arrayBufferToBase64(buf)
        const saved = await saveBase64(projectId, 'import', b64, ext)
        g.addCard(kindForMime(mime), pos, {
          title: file.name,
          assetUrl: saved.url,
          assetLocalPath: saved.path,
          mime,
          status: 'done'
        })
      }
    } catch (error) {
      failures.push({ name: file.name || '未命名文件', reason: reasonOf(error) })
    }
    i++
  }
  reportFailures(failures)
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
  const fs = window.mulby?.filesystem
  const failures: ImportFailure[] = []
  let i = 0
  for (const a of atts) {
    const displayName = a.name || (a.path ? a.path.split(/[\\/]/).pop() : '') || '未命名附件'
    const pos = { x: world.x + i * 30, y: world.y + i * 30 }
    try {
      if (a.path && fs) {
        const b64 = (await fs.readFile(a.path, 'base64')) as string
        const ext = extensionOf(a.path) || 'bin'
        const mime = resolveImportMime(a.path, a.mime)
        const saved = await saveBase64(projectId, 'import', b64, ext)
        g.addCard(kindForMime(mime), pos, {
          title: displayName,
          assetUrl: saved.url,
          assetLocalPath: saved.path,
          mime,
          status: 'done'
        })
      } else if (a.dataUrl) {
        const m = /^data:([^;]+);base64,(.*)$/.exec(a.dataUrl)
        if (!m) throw new Error('附件 data URL 格式无效')
        const dmime = m[1].toLowerCase()
        const ext = (dmime.split('/')[1] || 'bin').toLowerCase()
        const saved = await saveBase64(projectId, 'import', m[2], ext)
        g.addCard(kindForMime(dmime), pos, {
          title: displayName,
          assetUrl: saved.url,
          assetLocalPath: saved.path,
          mime: dmime,
          status: 'done'
        })
      } else if (a.path) {
        throw new Error('Mulby 文件系统不可用')
      } else {
        throw new Error('附件缺少可读取的路径或数据')
      }
    } catch (error) {
      failures.push({ name: displayName, reason: reasonOf(error) })
    }
    i++
  }
  reportFailures(failures)
}
