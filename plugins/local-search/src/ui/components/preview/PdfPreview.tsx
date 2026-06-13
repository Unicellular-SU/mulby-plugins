import React, { useEffect, useState } from 'react'
import { FileItem } from '../../utils'

interface Props {
  file: FileItem
  base64: string
}

// 用 Chromium 内置 PDF 查看器渲染：base64 → Blob → objectURL → <iframe>。
// 失败则回退到 file:// 直链。
export default function PdfPreview({ file, base64 }: Props) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let objectUrl = ''
    try {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      setUrl(objectUrl)
    } catch {
      setUrl(`file://${file.path}`)
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [base64, file.path])

  if (!url) return null

  return (
    <div className="preview-area flex-1" style={{ alignItems: 'stretch', justifyContent: 'stretch' }}>
      <iframe src={url} title={file.name} className="pdf-frame" />
    </div>
  )
}
