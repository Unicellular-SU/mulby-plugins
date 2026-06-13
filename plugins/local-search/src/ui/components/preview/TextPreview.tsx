import React, { useMemo, useState } from 'react'
import { WrapText } from 'lucide-react'
import { FileItem } from '../../utils'
import { PreviewMeta, FileInfo } from './PreviewChrome'

interface Props {
  file: FileItem
  text: string
  fileInfo: FileInfo | null
}

// 超过该行数时退化为单个 <pre>，避免渲染上万个行号 DOM 节点造成卡顿
const MAX_GUTTER_LINES = 5000

export default function TextPreview({ file, text, fileInfo }: Props) {
  const [wrap, setWrap] = useState(true)
  const lines = useMemo(() => (text.length ? text.split('\n') : ['']), [text])
  const showGutter = lines.length <= MAX_GUTTER_LINES

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="preview-toolbar">
        <span className="preview-toolbar-title">{lines.length} 行</span>
        <button
          className={`preview-toggle${wrap ? ' active' : ''}`}
          onClick={() => setWrap((w) => !w)}
          title="自动换行"
        >
          <WrapText size={14} /> 换行
        </button>
      </div>
      {showGutter ? (
        <div className="code-scroll">
          {lines.map((ln, i) => (
            <div className="code-line" key={i}>
              <span className="code-ln">{i + 1}</span>
              <span className="code-lc" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
                {ln || ' '}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <pre className="text-preview" style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>
          {text}
        </pre>
      )}
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
