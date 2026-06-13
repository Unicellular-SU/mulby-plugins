import React from 'react'
import { Loader2, AlertTriangle, Eye, File as FileIcon, FileQuestion } from 'lucide-react'
import { FileItem, formatFileSize } from '../../utils'

export interface FileInfo {
  size: number
  modifiedAt: number
  createdAt: number
}

// 预览面板底部的元信息条：文件名 + 可选附加信息（如尺寸）+ 大小 + 修改日期
export function PreviewMeta({
  file,
  fileInfo,
  extra,
}: {
  file: FileItem
  fileInfo: FileInfo | null
  extra?: React.ReactNode
}) {
  return (
    <div
      className="absolute bottom-0 left-0 right-0 px-4 py-2 text-xs flex items-center gap-4"
      style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-color)' }}
    >
      <span className="truncate flex-1">{file.name}</span>
      {extra}
      {fileInfo && (
        <>
          <span>{formatFileSize(fileInfo.size)}</span>
          <span>{new Date(fileInfo.modifiedAt).toLocaleDateString()}</span>
        </>
      )}
    </div>
  )
}

export function PreviewEmpty() {
  return (
    <div className="preview-area flex-1 gap-2" style={{ color: 'var(--text-tertiary)' }}>
      <Eye size={40} strokeWidth={1} />
      <p className="text-sm mt-2">选择文件以预览</p>
    </div>
  )
}

export function PreviewLoading() {
  return (
    <div className="preview-area flex-1">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />
    </div>
  )
}

export function PreviewError({ message }: { message: string }) {
  return (
    <div className="preview-area flex-1 gap-2 p-6">
      <AlertTriangle size={40} strokeWidth={1} style={{ color: '#e0a23b' }} />
      <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>无法预览此文件</p>
      <p className="preview-error text-xs">{message}</p>
    </div>
  )
}

export function PreviewUnsupported({
  file,
  fileInfo,
  reason,
}: {
  file: FileItem
  fileInfo: FileInfo | null
  reason?: string
}) {
  return (
    <div className="preview-area flex-1 relative gap-2 p-4">
      <FileQuestion size={48} strokeWidth={1} style={{ color: 'var(--text-tertiary)' }} />
      <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{file.name}</p>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {file.ext ? `${file.ext.slice(1).toUpperCase()} 文件` : '未知类型'} · {reason || '不支持预览'}
      </p>
      {fileInfo && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {formatFileSize(fileInfo.size)} · {new Date(fileInfo.modifiedAt).toLocaleString()}
        </p>
      )}
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}

export function PreviewOversize({
  file,
  fileInfo,
  limit,
}: {
  file: FileItem
  fileInfo: FileInfo | null
  limit: number
}) {
  return (
    <div className="preview-area flex-1 relative gap-2 p-4">
      <FileIcon size={48} strokeWidth={1} style={{ color: 'var(--text-tertiary)' }} />
      <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{file.name}</p>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        文件较大（{formatFileSize(fileInfo?.size)}），超过 {formatFileSize(limit)} 预览上限
      </p>
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}

// 捕获懒加载子组件的「chunk 加载失败」与「渲染/解析异常」，避免整个预览面板白屏。
// fileKey 变化时自动复位错误状态，使切换文件后能重新尝试渲染。
export class PreviewErrorBoundary extends React.Component<
  { children: React.ReactNode; fileKey: string },
  { err: string | null }
> {
  state: { err: string | null } = { err: null }

  static getDerivedStateFromError(e: unknown): { err: string } {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '预览渲染失败'
    return { err: msg }
  }

  componentDidUpdate(prev: { fileKey: string }) {
    if (prev.fileKey !== this.props.fileKey && this.state.err) {
      this.setState({ err: null })
    }
  }

  render() {
    if (this.state.err) return <PreviewError message={this.state.err} />
    return this.props.children
  }
}
