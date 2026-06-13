import React from 'react'
import { Music } from 'lucide-react'
import { FileItem } from '../../utils'
import { PreviewMeta, FileInfo } from './PreviewChrome'

interface Props {
  file: FileItem
  path: string
  kind: 'audio' | 'video'
  fileInfo: FileInfo | null
  url?: string // 直接指定播放地址（如压缩包内文件的 blob URL）；缺省则用 file://path
}

export default function MediaPreview({ file, path, kind, fileInfo, url: urlOverride }: Props) {
  const url = urlOverride || `file://${path}`

  if (kind === 'audio') {
    return (
      <div className="preview-area flex-1 relative gap-3 p-4">
        <Music size={48} strokeWidth={1} style={{ color: 'var(--accent)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{file.name}</p>
        <audio controls src={url} className="w-4/5 max-w-md mt-2" />
        <PreviewMeta file={file} fileInfo={fileInfo} />
      </div>
    )
  }

  return (
    <div className="preview-area flex-1 relative p-4">
      <video controls src={url} className="max-w-full max-h-full rounded" />
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
