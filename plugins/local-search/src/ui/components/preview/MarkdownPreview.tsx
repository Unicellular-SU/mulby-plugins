import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FileItem } from '../../utils'
import { PreviewMeta, FileInfo } from './PreviewChrome'

interface Props {
  file: FileItem
  text: string
  fileInfo: FileInfo | null
}

// react-markdown 默认禁用裸 HTML，天然防 XSS；remark-gfm 提供表格/任务列表/删除线
export default function MarkdownPreview({ file, text, fileInfo }: Props) {
  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="md-scroll">
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
      </div>
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
