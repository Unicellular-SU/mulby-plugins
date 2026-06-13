import React, { useEffect, useMemo, useState, Suspense, lazy } from 'react'
import { unzipSync } from 'fflate'
import { ChevronRight, ChevronDown, ChevronLeft, Folder, File as FileIcon } from 'lucide-react'
import {
  FileItem,
  formatFileSize,
  getExtension,
  getPreviewSpec,
  looksBinary,
  sizeLimitForRenderer,
} from '../../utils'
import {
  PreviewMeta,
  FileInfo,
  PreviewError,
  PreviewLoading,
  PreviewErrorBoundary,
} from './PreviewChrome'
import ImagePreview from './ImagePreview'
import MediaPreview from './MediaPreview'
import TextPreview from './TextPreview'
import PdfPreview from './PdfPreview'

// 压缩包内文件的预览也复用各渲染器；重型库仍懒加载（与顶层 FilePreview 共用同一 chunk）
const LazyCode = lazy(() => import('./CodePreview'))
const LazyMarkdown = lazy(() => import('./MarkdownPreview'))
const LazyJson = lazy(() => import('./JsonPreview'))
const LazySpreadsheet = lazy(() => import('./SpreadsheetPreview'))
const LazyDocx = lazy(() => import('./DocxPreview'))

interface Props {
  file: FileItem
  base64: string
  fileInfo: FileInfo | null
}

interface ZipFile {
  name: string
  path: string // 完整 entry 路径，用于回查字节
  size: number
}
interface TreeDir {
  dirs: Map<string, TreeDir>
  files: ZipFile[]
}

function newDir(): TreeDir {
  return { dirs: new Map(), files: [] }
}

function buildTree(entries: Record<string, Uint8Array>): { root: TreeDir; fileCount: number; totalSize: number } {
  const root = newDir()
  let fileCount = 0
  let totalSize = 0
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith('/')) continue // 目录标记项
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let dir = root
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]
      let next = dir.dirs.get(seg)
      if (!next) {
        next = newDir()
        dir.dirs.set(seg, next)
      }
      dir = next
    }
    dir.files.push({ name: parts[parts.length - 1], path, size: data.length })
    fileCount++
    totalSize += data.length
  }
  return { root, fileCount, totalSize }
}

const MEDIA_MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
}
function mediaMimeForExt(ext: string): string {
  return MEDIA_MIME[ext] || 'application/octet-stream'
}

function bytesToText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(bin)
}

function InnerNotice({ name, text }: { name: string; text: string }) {
  return (
    <div className="preview-area flex-1 gap-2 p-4">
      <FileIcon size={40} strokeWidth={1} style={{ color: 'var(--text-tertiary)' }} />
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{name}</p>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{text}</p>
    </div>
  )
}

// 根据扩展名把 zip 内的字节交给对应渲染器
function renderInnerBody(file: FileItem, bytes: Uint8Array, mediaUrl: string): React.ReactNode {
  const ext = file.ext
  const spec = getPreviewSpec(ext)
  const r = spec.renderer

  const limit = sizeLimitForRenderer(r)
  if (limit && bytes.length > limit) {
    return <InnerNotice name={file.name} text={`文件较大（${formatFileSize(bytes.length)}），超过 ${formatFileSize(limit)} 预览上限`} />
  }

  // 文本来源（svg 也走文本）
  if (spec.source === 'text') {
    if (r === 'image') {
      return <ImagePreview file={file} data={bytesToText(bytes)} source="text" renderer="image" meta={null} fileInfo={null} />
    }
    const text = bytesToText(bytes)
    if (looksBinary(text)) return <InnerNotice name={file.name} text="二进制内容，无法作为文本预览" />
    if (r === 'markdown') return <LazyMarkdown file={file} text={text} fileInfo={null} />
    if (r === 'json') return <LazyJson file={file} text={text} fileInfo={null} />
    if (r === 'code') return <LazyCode file={file} text={text} fileInfo={null} />
    return <TextPreview file={file} text={text} fileInfo={null} />
  }

  // 媒体：用 blob URL（zip 内文件没有磁盘路径）
  if (r === 'audio' || r === 'video') {
    return <MediaPreview file={file} path="" url={mediaUrl} kind={r} fileInfo={null} />
  }

  // tiff/psd 需后端 sharp（按磁盘路径解码），zip 内文件无法支持
  if (r === 'image-native') {
    return <InnerNotice name={file.name} text="该格式需后端解码，暂不支持压缩包内预览" />
  }

  // base64 来源（仅在确为可渲染类型时才编码，避免对不支持的大文件做无谓转换）
  if (r === 'image' || r === 'pdf' || r === 'spreadsheet' || r === 'docx' || r === 'archive') {
    const base64 = bytesToBase64(bytes)
    if (r === 'image') return <ImagePreview file={file} data={base64} source="base64" renderer="image" meta={null} fileInfo={null} />
    if (r === 'pdf') return <PdfPreview file={file} base64={base64} />
    if (r === 'spreadsheet') return <LazySpreadsheet file={file} base64={base64} fileInfo={null} />
    if (r === 'docx') return <LazyDocx file={file} base64={base64} fileInfo={null} />
    return <ArchivePreview file={file} base64={base64} fileInfo={null} /> // 嵌套压缩包
  }

  return <InnerNotice name={file.name} text="不支持预览" />
}

function ArchiveInnerView({ entryPath, bytes, onBack }: { entryPath: string; bytes: Uint8Array; onBack: () => void }) {
  const base = entryPath.split('/').pop() || entryPath
  const ext = getExtension(base)
  const file: FileItem = { name: base, path: entryPath, isDirectory: false, ext, size: bytes.length }
  const spec = getPreviewSpec(ext)

  // 媒体的 blob URL 生命周期
  const mediaUrl = useMemo(() => {
    if (spec.renderer === 'audio' || spec.renderer === 'video') {
      return URL.createObjectURL(new Blob([bytes], { type: mediaMimeForExt(ext) }))
    }
    return ''
  }, [entryPath])
  useEffect(() => () => { if (mediaUrl) URL.revokeObjectURL(mediaUrl) }, [mediaUrl])

  const body = useMemo(() => renderInnerBody(file, bytes, mediaUrl), [entryPath, mediaUrl])

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="preview-toolbar">
        <button className="preview-toggle" onClick={onBack} title="返回压缩包目录">
          <ChevronLeft size={14} /> 返回
        </button>
        <span className="archive-crumb">{entryPath}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>{formatFileSize(bytes.length)}</span>
      </div>
      <div className="archive-inner-body">
        <PreviewErrorBoundary fileKey={entryPath}>
          <Suspense fallback={<PreviewLoading />}>{body}</Suspense>
        </PreviewErrorBoundary>
      </div>
    </div>
  )
}

function DirNode({
  name,
  dir,
  depth,
  onOpen,
}: {
  name: string
  dir: TreeDir
  depth: number
  onOpen: (path: string) => void
}) {
  const [open, setOpen] = useState(depth < 1)
  const subDirs = Array.from(dir.dirs.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const files = [...dir.files].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div>
      <div className="tree-row dir" style={{ paddingLeft: depth * 16 + 4 }} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <Folder size={14} style={{ color: 'var(--accent)' }} />
        <span className="tree-name">{name}</span>
      </div>
      {open && (
        <>
          {subDirs.map(([n, d]) => (
            <DirNode key={n} name={n} dir={d} depth={depth + 1} onOpen={onOpen} />
          ))}
          {files.map((f) => (
            <div
              className="tree-row file"
              key={f.path}
              style={{ paddingLeft: (depth + 1) * 16 + 17 }}
              onClick={() => onOpen(f.path)}
              title="点击预览"
            >
              <FileIcon size={14} style={{ color: 'var(--text-tertiary)' }} />
              <span className="tree-name">{f.name}</span>
              <span className="tree-size">{formatFileSize(f.size)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

export default function ArchivePreview({ file, base64, fileInfo }: Props) {
  const parsed = useMemo(() => {
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const entries = unzipSync(bytes)
      return { ok: true as const, entries, ...buildTree(entries) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) }
    }
  }, [base64])

  const [selected, setSelected] = useState<string | null>(null)
  // 切换到新压缩包时重置选中项
  useEffect(() => setSelected(null), [base64])

  if (!parsed.ok) return <PreviewError message={parsed.error} />

  if (selected && parsed.entries[selected]) {
    return <ArchiveInnerView entryPath={selected} bytes={parsed.entries[selected]} onBack={() => setSelected(null)} />
  }

  const topDirs = Array.from(parsed.root.dirs.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  const topFiles = [...parsed.root.files].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="preview-banner">
        {parsed.fileCount} 个文件 · 解压后约 {formatFileSize(parsed.totalSize)} · 点击文件可预览
      </div>
      <div className="archive-scroll">
        {topDirs.map(([n, d]) => (
          <DirNode key={n} name={n} dir={d} depth={0} onOpen={setSelected} />
        ))}
        {topFiles.map((f) => (
          <div
            className="tree-row file"
            key={f.path}
            style={{ paddingLeft: 17 }}
            onClick={() => setSelected(f.path)}
            title="点击预览"
          >
            <FileIcon size={14} style={{ color: 'var(--text-tertiary)' }} />
            <span className="tree-name">{f.name}</span>
            <span className="tree-size">{formatFileSize(f.size)}</span>
          </div>
        ))}
      </div>
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
