import { MAX_LOCAL_IMPORT_FILES, MAX_TEXT_IMPORT_BYTES } from '../../backendGuards'
import { useGraph } from '../store/graphStore'
import type { MaterialKind, NodeAsset } from '../types'
import { base64ToArrayBuffer, uid } from '../util'
import { saveBytes, toFileUrl } from './media'
import { PLUGIN_ID } from './persistence'
import { toast } from '../store/toastStore'
import { isSupportedImportMime, kindForMime, normalizeOpenDialogPaths, resolveImportMime } from './importMediaTypes'

interface ImportFailure {
  name: string
  reason: string
}

interface ImportRpcData {
  items?: Array<{ name: string; mime: string; path?: string; text?: string; size?: number }>
  failures?: ImportFailure[]
  error?: string
}

export interface ImportedResource {
  name: string
  mime: string
  kind: MaterialKind
  url?: string
  localPath?: string
  text?: string
  size?: number
}

interface AttachmentLike {
  path?: string
  name?: string
  dataUrl?: string
  mime?: string
}

function reasonOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')
  return raw.trim().slice(0, 120) || '读取或保存失败'
}

function materialKind(mime: string): MaterialKind {
  const kind = kindForMime(mime)
  return kind === 'video' || kind === 'audio' || kind === 'text' ? kind : 'image'
}

function reportFailures(failures: ImportFailure[]): void {
  if (!failures.length) return
  const shown = failures.slice(0, 3).map((f) => `${f.name}（${f.reason}）`).join('、')
  const more = failures.length > 3 ? `，另有 ${failures.length - 3} 个` : ''
  toast(`导入失败 ${failures.length} 个：${shown}${more}`, 'error')
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function uniquePaths(paths: unknown[]): string[] {
  return normalizeOpenDialogPaths(paths)
}

/** 旧 Host 中 basename 漏 await 后会把 Promise 克隆成空对象；识别该特征并热重启后端重试一次。 */
function hasAsyncFilenameRegression(data: ImportRpcData | undefined): boolean {
  if (!data || (data.items?.length || 0) > 0 || !Array.isArray(data.failures)) return false
  return data.failures.some((failure) => {
    if (!failure || typeof failure !== 'object') return true
    const name = (failure as { name?: unknown }).name
    return typeof name !== 'string' || /^\[object (?:Object|Promise)\]$/.test(name)
  })
}

function importRpcData(result: unknown): ImportRpcData | undefined {
  if (!result || typeof result !== 'object') return undefined
  const data = (result as { data?: unknown }).data
  return data && typeof data === 'object' ? data as ImportRpcData : undefined
}

/** Electron 新版不再保证 File.path 可见；在 drop 事件同步阶段通过宿主能力恢复物理路径。 */
export function resolveDroppedFilePaths(files: File[] | FileList): string[] {
  try {
    return uniquePaths(window.mulby?.plugin?.resolveDroppedFilePaths?.(Array.from(files)) || [])
  } catch {
    return []
  }
}

async function importLocalPaths(projectId: string, paths: string[]): Promise<{ resources: ImportedResource[]; failures: ImportFailure[] }> {
  const clean = uniquePaths(paths)
  if (!clean.length) return { resources: [], failures: [] }
  const selected = clean.slice(0, MAX_LOCAL_IMPORT_FILES)
  const overflow = clean.length > selected.length
    ? [{ name: '其余文件', reason: `一次最多 ${MAX_LOCAL_IMPORT_FILES} 个文件` }]
    : []
  const host = window.mulby?.host
  if (!host?.call) return { resources: [], failures: [...selected.map((path) => ({ name: basename(path), reason: 'Mulby 后端桥接不可用' })), ...overflow] }
  try {
    const requestImport = async () => importRpcData(
      await host.call(PLUGIN_ID, 'importLocalResources', { projectId, paths: selected })
    )
    let data = await requestImport()
    // 开发模式下 UI 可热更新、插件 Host 仍可能保留旧 main.js。只对这个明确的旧版故障特征
    // 自动重启一次，避免每次正常导入都扰动正在运行的后端任务。
    if (hasAsyncFilenameRegression(data) && host.restart) {
      await host.restart(PLUGIN_ID)
      data = await requestImport()
    }
    const resources = (data?.items || []).map((item) => ({
      name: item.name,
      mime: item.mime,
      kind: materialKind(item.mime),
      url: item.path ? toFileUrl(item.path) : undefined,
      localPath: item.path,
      text: item.text,
      size: item.size
    }))
    const failures = [...(data?.failures || []), ...overflow]
    if (!resources.length && data?.error && !failures.length) failures.push({ name: '本次导入', reason: data.error })
    return { resources, failures }
  } catch (error) {
    return { resources: [], failures: [...selected.map((path) => ({ name: basename(path), reason: reasonOf(error) })), ...overflow] }
  }
}

async function importBrowserFiles(projectId: string, files: File[]): Promise<{ resources: ImportedResource[]; failures: ImportFailure[] }> {
  const resources: ImportedResource[] = []
  const failures: ImportFailure[] = []
  for (const file of files.slice(0, MAX_LOCAL_IMPORT_FILES)) {
    try {
      const mime = resolveImportMime(file.name, file.type)
      if (!mime || !isSupportedImportMime(mime)) throw new Error('不支持的文件类型')
      const kind = materialKind(mime)
      if (kind === 'text') {
        if (file.size > MAX_TEXT_IMPORT_BYTES) throw new Error(`文本过大（上限 ${Math.round(MAX_TEXT_IMPORT_BYTES / 1024 / 1024)}MB）`)
        resources.push({ name: file.name || '未命名文本', mime, kind, text: await file.text(), size: file.size })
      } else {
        const saved = await saveBytes(projectId, 'import', await file.arrayBuffer(), mime)
        resources.push({ name: file.name || '未命名文件', mime, kind, url: saved.url, localPath: saved.path, size: file.size })
      }
    } catch (error) {
      failures.push({ name: file.name || '未命名文件', reason: reasonOf(error) })
    }
  }
  if (files.length > MAX_LOCAL_IMPORT_FILES) {
    failures.push({ name: '其余文件', reason: `一次最多 ${MAX_LOCAL_IMPORT_FILES} 个文件` })
  }
  return { resources, failures }
}

/**
 * 统一导入入口：有物理路径的文件交给后端直接复制；无路径（剪贴板/浏览器 File）才在前端读取。
 * pathCandidates 必须由 drop 处理器在任何 await 之前同步快照。
 */
export async function loadImportedResources(
  files: File[] | FileList,
  pathCandidates: string[] = []
): Promise<ImportedResource[]> {
  const projectId = useGraph.getState().project.id
  const list = Array.from(files)
  const filePaths = list.map((file) => (file as File & { path?: string }).path || '').filter(Boolean)
  const paths = uniquePaths([...pathCandidates, ...filePaths])
  const pathNames = new Set(paths.map((path) => basename(path).toLowerCase()))
  const browserCandidates = list.filter((file) => {
    const path = (file as File & { path?: string }).path
    return !path && !pathNames.has((file.name || '').toLowerCase())
  })
  const browserFiles = browserCandidates.slice(0, Math.max(0, MAX_LOCAL_IMPORT_FILES - Math.min(paths.length, MAX_LOCAL_IMPORT_FILES)))
  const overflow: ImportFailure[] = browserFiles.length < browserCandidates.length
    ? [{ name: '其余文件', reason: `一次最多 ${MAX_LOCAL_IMPORT_FILES} 个文件` }]
    : []
  const [local, browser] = await Promise.all([
    importLocalPaths(projectId, paths),
    importBrowserFiles(projectId, browserFiles)
  ])
  reportFailures([...local.failures, ...browser.failures, ...overflow])
  return [...local.resources, ...browser.resources]
}

export function resourcesToNodeAssets(resources: ImportedResource[]): NodeAsset[] {
  return resources.map((resource) => ({
    id: uid('a'),
    kind: resource.kind,
    url: resource.url,
    localPath: resource.localPath,
    mime: resource.mime,
    name: resource.name,
    text: resource.text
  }))
}

function addResourcesAsCards(resources: ImportedResource[], world: { x: number; y: number }): void {
  const graph = useGraph.getState()
  resources.forEach((resource, index) => {
    const pos = { x: world.x + index * 30, y: world.y + index * 30 }
    if (resource.kind === 'text') {
      graph.addCard('text', pos, { title: resource.name, text: resource.text || '', status: 'done', mime: resource.mime })
    } else {
      const kind = resource.kind === 'image' ? 'source' : resource.kind
      graph.addCard(kind, pos, {
        title: resource.name,
        assetUrl: resource.url || null,
        assetLocalPath: resource.localPath || null,
        mime: resource.mime,
        status: 'done',
        meta: {
          ...(resource.size ? { importSize: resource.size } : {}),
          ...(resource.kind === 'video' || resource.kind === 'audio' ? { resourceRole: 'source' } : {})
        }
      })
    }
  })
  if (resources.length) toast(`已导入 ${resources.length} 个资源`, 'success')
}

export async function importFiles(
  files: File[] | FileList,
  world: { x: number; y: number },
  pathCandidates: string[] = []
): Promise<void> {
  addResourcesAsCards(await loadImportedResources(files, pathCandidates), world)
}

export async function importPaths(paths: string[], world: { x: number; y: number }): Promise<void> {
  const result = await importLocalPaths(useGraph.getState().project.id, paths)
  reportFailures(result.failures)
  addResourcesAsCards(result.resources, world)
}

const IMPORT_EXTENSIONS: Record<MaterialKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'],
  video: ['mp4', 'mov', 'webm'],
  audio: ['mp3', 'wav', 'aac', 'opus', 'm4a', 'flac', 'ogg'],
  text: ['txt', 'md', 'json', 'srt']
}

export async function pickImportPaths(kinds: readonly MaterialKind[] = ['image', 'video', 'audio', 'text']): Promise<string[]> {
  const dialog = window.mulby?.dialog
  if (!dialog?.showOpenDialog) return []
  const selectedKinds = [...new Set(kinds)]
  const extensions = selectedKinds.flatMap((kind) => IMPORT_EXTENSIONS[kind])
  const label = selectedKinds.map((kind) => kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文本').join('、')
  const picked: unknown = await dialog.showOpenDialog({
    title: '导入画布资源',
    buttonLabel: '导入',
    properties: ['openFile', 'multiSelections'],
    filters: [{
      name: label || '画布资源',
      extensions
    }]
  })
  const paths = normalizeOpenDialogPaths(picked)
  const reportedSelection = Array.isArray(picked)
    ? picked.length > 0
    : !!picked && typeof picked === 'object' && (picked as { canceled?: unknown }).canceled !== true
  if (!paths.length && reportedSelection) {
    toast('当前 Mulby 版本未返回可读取的文件路径，请升级宿主后重试', 'error')
  }
  return paths
}

export async function importAttachments(atts: AttachmentLike[], world: { x: number; y: number }): Promise<void> {
  const paths = atts.map((attachment) => attachment.path || '').filter(Boolean)
  const local = await importLocalPaths(useGraph.getState().project.id, paths)
  const resources = [...local.resources]
  const failures = [...local.failures]
  for (const attachment of atts.filter((item) => !item.path && item.dataUrl)) {
    const displayName = attachment.name || '未命名附件'
    try {
      const match = /^data:([^;]+);base64,(.*)$/.exec(attachment.dataUrl || '')
      if (!match) throw new Error('附件 data URL 格式无效')
      const mime = resolveImportMime(displayName, attachment.mime || match[1])
      if (!mime || !isSupportedImportMime(mime)) throw new Error('不支持的附件类型')
      const kind = materialKind(mime)
      const bytes = base64ToArrayBuffer(match[2])
      if (kind === 'text') {
        if (bytes.byteLength > MAX_TEXT_IMPORT_BYTES) throw new Error('文本附件过大')
        resources.push({ name: displayName, mime, kind, text: new TextDecoder().decode(bytes), size: bytes.byteLength })
      } else {
        const saved = await saveBytes(useGraph.getState().project.id, 'import', bytes, mime)
        resources.push({ name: displayName, mime, kind, url: saved.url, localPath: saved.path, size: bytes.byteLength })
      }
    } catch (error) {
      failures.push({ name: displayName, reason: reasonOf(error) })
    }
  }
  reportFailures(failures)
  addResourcesAsCards(resources, world)
}
