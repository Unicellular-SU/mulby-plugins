import React, { useEffect, useState } from 'react'
// @ts-ignore mammoth 浏览器构建无该子路径的类型声明
import mammoth from 'mammoth/mammoth.browser'
import DOMPurify from 'dompurify'
import { FileItem } from '../../utils'
import { PreviewMeta, FileInfo, PreviewError, PreviewLoading } from './PreviewChrome'

interface Props {
  file: FileItem
  base64: string
  fileInfo: FileInfo | null
}

export default function DocxPreview({ file, base64, fileInfo }: Props) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setHtml(null)
    setError('')
    ;(async () => {
      try {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
        const res = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer })
        if (!alive) return
        const clean = DOMPurify.sanitize(res?.value || '<p style="opacity:.6">（空文档）</p>')
        setHtml(clean)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [base64])

  if (error) return <PreviewError message={error} />
  if (html === null) return <PreviewLoading />

  return (
    <div className="preview-area flex-1 relative" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <div className="docx-scroll">
        <div className="docx-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <PreviewMeta file={file} fileInfo={fileInfo} />
    </div>
  )
}
