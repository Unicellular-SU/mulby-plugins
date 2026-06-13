import React, { useEffect, useState, useRef, Suspense, lazy } from 'react'
import { FileItem, getPreviewSpec, sizeLimitForRenderer, looksBinary } from '../utils'
import { useMulby } from '../hooks/useMulby'
import {
  PreviewEmpty,
  PreviewLoading,
  PreviewError,
  PreviewUnsupported,
  PreviewOversize,
  PreviewErrorBoundary,
  FileInfo,
} from './preview/PreviewChrome'
import ImagePreview from './preview/ImagePreview'
import MediaPreview from './preview/MediaPreview'
import TextPreview from './preview/TextPreview'
import PdfPreview from './preview/PdfPreview'

// 重型渲染器懒加载：各自的第三方库（highlighter / xlsx / mammoth / fflate）从首屏 chunk 分离
const CodePreview = lazy(() => import('./preview/CodePreview'))
const MarkdownPreview = lazy(() => import('./preview/MarkdownPreview'))
const JsonPreview = lazy(() => import('./preview/JsonPreview'))
const SpreadsheetPreview = lazy(() => import('./preview/SpreadsheetPreview'))
const DocxPreview = lazy(() => import('./preview/DocxPreview'))
const ArchivePreview = lazy(() => import('./preview/ArchivePreview'))

interface FilePreviewProps {
  file: FileItem | null
}

interface ImageMeta {
  width?: number
  height?: number
  format?: string
}

export default function FilePreview({ file }: FilePreviewProps) {
  const { readFileAsText, readFileAsBase64, getFileStat, previewImageAsPng } = useMulby()
  const [data, setData] = useState('')
  const [imageMeta, setImageMeta] = useState<ImageMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oversize, setOversize] = useState<number | null>(null)
  const [binary, setBinary] = useState(false)
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  // 记录「当前 state 对应哪个文件」。文件切换后、加载完成前，state 仍是旧文件的，
  // 用它把内容渲染拦在加载态，避免新渲染器闪现旧数据。
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const abortRef = useRef(0)

  useEffect(() => {
    if (!file) {
      setData('')
      setFileInfo(null)
      setError(null)
      setOversize(null)
      return
    }

    const id = ++abortRef.current
    const spec = getPreviewSpec(file.ext)
    setData('')
    setImageMeta(null)
    setError(null)
    setOversize(null)
    setBinary(false)
    setLoading(true)

    const load = async () => {
      try {
        const stat = await getFileStat(file.path)
        if (id !== abortRef.current) return
        setFileInfo(stat ? { size: stat.size, modifiedAt: stat.modifiedAt, createdAt: stat.createdAt } : null)

        if (spec.renderer === 'none') return

        const limit = sizeLimitForRenderer(spec.renderer)
        if (limit && stat && typeof stat.size === 'number' && stat.size > limit) {
          setOversize(limit)
          return
        }

        if (spec.source === 'text') {
          const t = await readFileAsText(file.path)
          if (id !== abortRef.current) return
          const str = typeof t === 'string' ? t : ''
          // 扩展名是文本/代码/json，但内容实为二进制（如带 .json 后缀的 zstd 缓存）→ 不按文本渲染
          if (looksBinary(str)) {
            setBinary(true)
            return
          }
          setData(str)
        } else if (spec.source === 'base64') {
          const b = await readFileAsBase64(file.path)
          if (id !== abortRef.current) return
          setData(typeof b === 'string' ? b : '')
        } else if (spec.source === 'filepath') {
          setData(file.path)
        } else if (spec.source === 'backend') {
          const res = await previewImageAsPng(file.path)
          if (id !== abortRef.current) return
          if (!res || !res.base64) throw new Error('后端未能解码该图片')
          setData(res.base64)
          setImageMeta(res.meta || null)
        }
      } catch (e) {
        if (id !== abortRef.current) return
        setError(e instanceof Error ? e.message : '读取文件失败')
      } finally {
        if (id === abortRef.current) {
          setLoading(false)
          setLoadedFor(file.path)
        }
      }
    }
    load()
  }, [file?.path])

  if (!file) return <PreviewEmpty />
  // state 尚未对应当前文件（切换后、加载完成前）→ 保持加载态
  if (loading || loadedFor !== file.path) return <PreviewLoading />
  if (error) return <PreviewError message={error} />

  const spec = getPreviewSpec(file.ext)
  if (oversize != null) return <PreviewOversize file={file} fileInfo={fileInfo} limit={oversize} />
  if (binary) return <PreviewUnsupported file={file} fileInfo={fileInfo} reason="二进制内容，无法作为文本预览" />
  if (spec.renderer === 'none') return <PreviewUnsupported file={file} fileInfo={fileInfo} />

  const lazyFallback = <PreviewLoading />
  const lazyWrap = (node: React.ReactNode) => (
    <PreviewErrorBoundary fileKey={file.path}>
      <Suspense fallback={lazyFallback}>{node}</Suspense>
    </PreviewErrorBoundary>
  )

  switch (spec.renderer) {
    case 'image':
    case 'image-native':
      return (
        <ImagePreview
          file={file}
          data={data}
          source={spec.source}
          renderer={spec.renderer}
          meta={imageMeta}
          fileInfo={fileInfo}
        />
      )
    case 'audio':
    case 'video':
      return <MediaPreview file={file} path={data} kind={spec.renderer} fileInfo={fileInfo} />
    case 'text':
      return <TextPreview file={file} text={data} fileInfo={fileInfo} />
    case 'pdf':
      return <PdfPreview file={file} base64={data} />
    case 'code':
      return lazyWrap(<CodePreview file={file} text={data} fileInfo={fileInfo} />)
    case 'markdown':
      return lazyWrap(<MarkdownPreview file={file} text={data} fileInfo={fileInfo} />)
    case 'json':
      return lazyWrap(<JsonPreview file={file} text={data} fileInfo={fileInfo} />)
    case 'spreadsheet':
      return lazyWrap(<SpreadsheetPreview file={file} base64={data} fileInfo={fileInfo} />)
    case 'docx':
      return lazyWrap(<DocxPreview file={file} base64={data} fileInfo={fileInfo} />)
    case 'archive':
      return lazyWrap(<ArchivePreview file={file} base64={data} fileInfo={fileInfo} />)
    default:
      return <PreviewUnsupported file={file} fileInfo={fileInfo} />
  }
}
