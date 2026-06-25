import { useState, useEffect, useCallback, useRef } from 'react'
import { useMulby } from './hooks/useMulby'
import {
  Copy, Check, Languages, Loader2, Type, Table2, FunctionSquare,
  ImageIcon, Download, RotateCcw, Sparkles, Cpu, Settings, X,
  Camera, FolderOpen, FileSpreadsheet, FileImage, ScanEye,
} from 'lucide-react'
import { latexToSvg, markdownTableToExcelHtml, markdownTableToTsv, normalizeLatex } from './exportUtils'
import { shouldProcessPluginInit } from './pluginInitSession'
import { requestCaptureRecognition } from './captureRecognition'
import {
  checkRapidOcrAvailable,
  processRapidOcrImage,
  isRapidOcrReady,
} from './rapidocr/engine'
import { RapidOcrProgressBar } from './rapidocr/RapidOcrProgress'
import type { RapidOcrEngineStatus } from './rapidocr/types'

type OcrMode = 'text' | 'table' | 'formula'
type OcrEngine = 'native' | 'ai' | 'rapidocr'

interface OcrResult { text: string; mode: OcrMode; engine: OcrEngine }
interface AiModelOption { id: string; label: string; providerLabel?: string }

const STORAGE_KEY_MODEL = 'ocr_ai_model'
const STORAGE_KEY_LANG = 'ocr_translate_lang'
const STORAGE_KEY_ENGINE = 'ocr_engine'

const LANGUAGES = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'es', label: 'Español' },
  { id: 'pt', label: 'Português' },
  { id: 'ru', label: 'Русский' },
  { id: 'ar', label: 'العربية' },
]

function getSystemPrompt(mode: OcrMode): string {
  switch (mode) {
    case 'table': return '你是一个专业的 OCR 表格识别助手。你需要识别图片中的表格内容，并以 Markdown 表格格式输出。保持表格的行列结构。如果有合并单元格，尽量拆分还原。只输出 Markdown 表格，不要添加任何解释。'
    case 'formula': return '你是一个专业的 OCR 数学公式识别助手。你需要识别图片中的数学公式，并以 LaTeX 格式输出。对于行内公式使用 $...$，对于独立公式使用 $$...$$。只输出 LaTeX 公式，不要添加任何解释。'
    default: return '你是一个专业的 OCR 文字识别助手。你需要准确识别图片中的所有文字内容，保持原始的段落结构和换行。只输出识别到的文字，不要添加任何解释或说明。'
  }
}

function getPromptByMode(mode: OcrMode): string {
  switch (mode) {
    case 'table': return '请识别这张图片中的表格内容，以 Markdown 表格格式输出。'
    case 'formula': return '请识别这张图片中的数学公式，以 LaTeX 格式输出。'
    default: return '请识别这张图片中的所有文字内容。'
  }
}

function dataUrlToBase64AndMime(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Invalid data URL')
  return { mimeType: match[1], base64: match[2] }
}

function dataUrlToArrayBuffer(dataUrl: string) {
  const { base64, mimeType } = dataUrlToBase64AndMime(dataUrl)
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return { buffer: bytes.buffer, mimeType }
}

export default function App() {
  const mulby = useMulby('ocr-text')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translation, setTranslation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastInitNonceRef = useRef<number | string | null>(null)
  const [mode, setMode] = useState<OcrMode>('text')
  const [engine, setEngine] = useState<OcrEngine>('native')
  const engineRef = useRef<OcrEngine>('native')
  const wrapSetEngine = (next: OcrEngine) => {
    engineRef.current = next
    setEngine(next)
  }
  const [showSettings, setShowSettings] = useState(false)
  const [models, setModels] = useState<AiModelOption[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [targetLang, setTargetLang] = useState<string>('zh')
  // RapidOCR state
  const [rapidocrStatus, setRapidocrStatus] = useState<RapidOcrEngineStatus>('uninitialized')
  const [rapidocrDownloadPercent, setRapidocrDownloadPercent] = useState(0)
  const [rapidocrMessage, setRapidocrMessage] = useState('')
  const rapidocrMessageRef = useRef('')
  const rapidocrInitPromise = useRef<Promise<void> | null>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const streamTextRef = useRef<string>('')
  const abortedRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)

  useEffect(() => {
    Promise.all([
      mulby.storage.get(STORAGE_KEY_MODEL).catch(() => null),
      mulby.storage.get(STORAGE_KEY_LANG).catch(() => null),
      mulby.storage.get(STORAGE_KEY_ENGINE).catch(() => null),
    ]).then(([model, lang, savedEngine]) => {
      if (model && typeof model === 'string') setSelectedModel(model)
      if (lang && typeof lang === 'string') setTargetLang(lang)
      if (savedEngine && typeof savedEngine === 'string' && ['native', 'rapidocr', 'ai'].includes(savedEngine)) {
        engineRef.current = savedEngine as OcrEngine
        setEngine(savedEngine as OcrEngine)
      }
    })
  }, [mulby])

  // Persist engine selection to storage
  useEffect(() => {
    mulby.storage.set(STORAGE_KEY_ENGINE, engine).catch(() => {})
  }, [engine, mulby])

  useEffect(() => {
    if (!showSettings) return
    let cancelled = false
    setModelsLoading(true)
    setModelsError(null)
    mulby.ai.allModels().then((allModels: any[]) => {
      if (cancelled) return
      const list = Array.isArray(allModels) ? allModels : []
      // 宿主的 getEffectiveCapabilities 不会产出 'text' 能力类型，旧的
      // `c.type === 'vision' || c.type === 'text'` 过滤会把纯文本模型全部剔除，
      // 导致只配置了文本模型时列表为空、设置面板一直转圈。这里改为仅排除
      // 纯 embedding/rerank 模型：视觉模型用于 AI OCR，文本模型用于翻译。
      const opts = list
        .filter((m: any) => {
          const caps = Array.isArray(m?.capabilities) ? m.capabilities : []
          if (caps.length === 0) return true
          return caps.some((c: any) => c && c.type !== 'embedding' && c.type !== 'rerank')
        })
        .map((m: any) => ({ id: m.id, label: m.label || m.id, providerLabel: m.providerLabel }))
      setModels(opts)
    }).catch((err: any) => {
      if (cancelled) return
      setModels([])
      setModelsError(err?.message || '无法加载模型列表')
    }).finally(() => {
      if (!cancelled) setModelsLoading(false)
    })
    return () => { cancelled = true }
  }, [showSettings, mulby])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setShowSettings(false)
    }
    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSettings])

  // Backend-based RapidOCR doesn't need cleanup — no in-browser engine to dispose

  const handleSelectModel = async (modelId: string) => {
    setSelectedModel(modelId)
    try { await mulby.storage.set(STORAGE_KEY_MODEL, modelId) } catch {}
  }

  const handleSelectLang = async (langId: string) => {
    setTargetLang(langId)
    try { await mulby.storage.set(STORAGE_KEY_LANG, langId) } catch {}
  }

  const doNativeOcr = useCallback(async (dataUrl: string): Promise<{ success: boolean; text: string; error?: string }> => {
    try {
      const { base64, mimeType } = dataUrlToBase64AndMime(dataUrl)
      const res = await mulby.host.call('nativeOcr', base64, mimeType)
      return (res as any)?.data || { success: false, text: '', error: '调用失败' }
    } catch (err: any) {
      return { success: false, text: '', error: err?.message || '原生 OCR 调用失败' }
    }
  }, [mulby])

  const initRapidOcr = useCallback(async () => {
    if (isRapidOcrReady()) return
    // If an init is already in flight, wait for it
    if (rapidocrInitPromise.current) {
      await rapidocrInitPromise.current
      return
    }

    let resolveInit: () => void
    rapidocrInitPromise.current = new Promise<void>((resolve) => { resolveInit = resolve })

    setRapidocrStatus('initializing')
    setRapidocrDownloadPercent(0)

    try {
      setRapidocrMessage('正在检测 Python RapidOCR 环境...')
      console.log('[rapidocr] Starting checkRapidOcrAvailable...')
      const { available, error } = await checkRapidOcrAvailable(mulby)
      console.log('[rapidocr] check result — available:', available, 'error:', error)
      if (available) {
        setRapidocrStatus('ready')
        setRapidocrDownloadPercent(100)
        setRapidocrMessage('RapidOCR 就绪')
        rapidocrMessageRef.current = ''
      } else {
        setRapidocrStatus('error')
        setRapidocrMessage(error || 'RapidOCR 不可用')
        rapidocrMessageRef.current = error || 'RapidOCR 不可用'
        console.error('[rapidocr] Not available:', error)
      }
    } catch (err: any) {
      console.error('[rapidocr] init exception:', err)
      setRapidocrStatus('error')
      setRapidocrMessage(err?.message || '检测失败')
      rapidocrMessageRef.current = err?.message || '检测失败'
    } finally {
      resolveInit!()
      rapidocrInitPromise.current = null
    }
  }, [mulby])

  // Pre-check RapidOCR when engine is rapidocr (e.g. restored from storage)
  useEffect(() => {
    if (engine === 'rapidocr' && !isRapidOcrReady()) {
      initRapidOcr()
    }
  }, [engine, initRapidOcr])

  const doRapidOcr = useCallback(async (dataUrl: string): Promise<{ success: boolean; text: string; error?: string }> => {
    try {
      const result = await processRapidOcrImage(mulby, dataUrl)
      return { success: true, text: result.text }
    } catch (err: any) {
      return { success: false, text: '', error: err?.message || 'RapidOCR 识别失败' }
    }
  }, [mulby])

  const doAiOcrStream = useCallback(async (dataUrl: string, ocrMode: OcrMode) => {
    const { buffer, mimeType } = dataUrlToArrayBuffer(dataUrl)
    const attachment = await mulby.ai.attachments.upload({ buffer, mimeType, purpose: 'vision' })

    const aiOption: any = {
      messages: [
        { role: 'system', content: getSystemPrompt(ocrMode) },
        { role: 'user', content: [
          { type: 'text', text: getPromptByMode(ocrMode) },
          { type: 'image', attachmentId: attachment.attachmentId, mimeType },
        ] },
      ],
      capabilities: [], toolingPolicy: { enableInternalTools: false },
      mcp: { mode: 'off' }, skills: { mode: 'off' },
    }
    if (selectedModel) aiOption.model = selectedModel

    abortedRef.current = false
    requestIdRef.current = null
    streamTextRef.current = ''

    const req = mulby.ai.call(aiOption, (chunk: any) => {
      if (chunk.__requestId) { requestIdRef.current = chunk.__requestId; return }
      if (abortedRef.current) return
      if (chunk.chunkType === 'text' && chunk.content) {
        streamTextRef.current += chunk.content
        setResult({ text: streamTextRef.current, mode: ocrMode, engine: 'ai' })
      }
    })

    const finalMsg = await req
    mulby.ai.attachments.delete(attachment.attachmentId).catch(() => {})

    if (!abortedRef.current) {
      const finalText = typeof finalMsg?.content === 'string' ? finalMsg.content : streamTextRef.current
      setResult({ text: finalText, mode: ocrMode, engine: 'ai' })
      return finalText
    }
    return streamTextRef.current
  }, [mulby, selectedModel])

  const doRecognize = useCallback(async (dataUrl: string, ocrMode: OcrMode, ocrEngine: OcrEngine) => {
    setLoading(true)
    setError(null)
    setResult(null)
    setTranslation(null)

    try {
      if (ocrEngine === 'rapidocr') {
        // Ensure engine is initialized
        if (!isRapidOcrReady()) {
          await initRapidOcr()
          if (!isRapidOcrReady()) {
            const detail = rapidocrMessageRef.current || rapidocrMessage
            setError(detail || 'RapidOCR 引擎未就绪，请检查错误信息后重试')
            return
          }
        }
        const response = await doRapidOcr(dataUrl)
        if (response.success && response.text) {
          setResult({ text: response.text, mode: ocrMode, engine: 'rapidocr' })
        } else {
          setError(response.error || '未识别到内容')
        }
      } else if (ocrEngine === 'ai' || ocrMode === 'table' || ocrMode === 'formula') {
        await doAiOcrStream(dataUrl, ocrMode)
      } else {
        const response = await doNativeOcr(dataUrl)
        if (response.success && response.text) {
          setResult({ text: response.text, mode: ocrMode, engine: 'native' })
        } else {
          setError(response.error || '未识别到内容')
        }
      }
    } catch (err: any) {
      if (!abortedRef.current) setError(err?.message || '识别失败')
    } finally {
      setLoading(false)
    }
  }, [doNativeOcr, doAiOcrStream, doRapidOcr, initRapidOcr])

  useEffect(() => {
    const dispose = mulby.onPluginInit((data: any) => {
      if (!shouldProcessPluginInit(lastInitNonceRef, data)) return
      if (data.attachments?.[0]?.dataUrl) {
        const dataUrl = data.attachments[0].dataUrl
        setImageDataUrl(dataUrl)
        doRecognize(dataUrl, 'text', engineRef.current)
      } else if (data.attachments?.[0]?.path) {
        loadImageFromPath(data.attachments[0].path)
      }
    })
    return dispose
  }, [mulby, doRecognize])

  const loadImageFromPath = async (filePath: string) => {
    try {
      const buffer = await mulby.filesystem.readFile(filePath, 'base64')
      const ext = filePath.split('.').pop()?.toLowerCase() || 'png'
      const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' }
      const dataUrl = `data:${mimeMap[ext] || 'image/png'};base64,${buffer}`
      setImageDataUrl(dataUrl)
      doRecognize(dataUrl, 'text', engineRef.current)
    } catch { setError('无法读取图片文件') }
  }

  const handleCopy = async () => {
    if (!result?.text) return
    try {
      await mulby.clipboard.writeText(result.text)
      setCopied(true)
      mulby.notification.show('已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const handleCaptureImage = async () => {
    if (loading) return
    setError(null)
    try {
      const result = await requestCaptureRecognition(mulby)
      if (!result.success && result.error !== 'Capture cancelled') {
        setError(result.error || '截图失败，请检查屏幕录制权限')
      }
    } catch (err: any) {
      setError(err?.message || '截图失败，请检查屏幕录制权限')
    }
  }

  const handlePickImage = async () => {
    if (loading) return
    setError(null)
    try {
      const paths = await mulby.dialog.showOpenDialog({
        title: '选择要识别的图片',
        buttonLabel: '识别图片',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp'] }],
      })
      const filePath = paths?.[0]
      if (filePath) await loadImageFromPath(filePath)
    } catch (err: any) {
      setError(err?.message || '选择图片失败')
    }
  }

  const handleCopyMarkdownTable = async () => {
    if (!result?.text) return
    try {
      await mulby.clipboard.writeText(result.text)
      mulby.notification.show('已复制 Markdown 表格')
    } catch {}
  }

  const handleCopyExcelTable = async () => {
    if (!result?.text) return
    try {
      await mulby.clipboard.writeText(markdownTableToTsv(result.text))
      mulby.notification.show('已复制 Excel 可粘贴格式')
    } catch {}
  }

  const handleExportExcelTable = async () => {
    if (!result?.text) return
    try {
      const path = await mulby.dialog.showSaveDialog({
        title: '导出 Excel 表格',
        defaultPath: `ocr_table_${Date.now()}.xls`,
        filters: [{ name: 'Excel Workbook', extensions: ['xls'] }],
      })
      if (!path) return
      await mulby.filesystem.writeFile(path, markdownTableToExcelHtml(result.text), 'utf-8')
      mulby.notification.show('Excel 文件已导出')
    } catch (err: any) {
      setError(err?.message || '导出 Excel 失败')
    }
  }

  const handleCopyLatex = async () => {
    if (!result?.text) return
    try {
      await mulby.clipboard.writeText(normalizeLatex(result.text))
      mulby.notification.show('已复制 LaTeX')
    } catch {}
  }

  const handleExportFormulaImage = async () => {
    if (!result?.text) return
    try {
      const path = await mulby.dialog.showSaveDialog({
        title: '导出公式图片',
        defaultPath: `ocr_formula_${Date.now()}.svg`,
        filters: [{ name: 'SVG Image', extensions: ['svg'] }],
      })
      if (!path) return
      await mulby.filesystem.writeFile(path, latexToSvg(result.text), 'utf-8')
      mulby.notification.show('公式图片已导出')
    } catch (err: any) {
      setError(err?.message || '导出公式图片失败')
    }
  }

  const handleCopyTranslation = async () => {
    if (!translation) return
    try { await mulby.clipboard.writeText(translation); mulby.notification.show('译文已复制到剪贴板') } catch {}
  }

  const handleTranslate = async () => {
    if (!result?.text || translating) return
    setTranslating(true)
    setTranslation('')

    const langLabel = LANGUAGES.find(l => l.id === targetLang)?.label || targetLang
    try {
      const opt: any = {
        messages: [
          { role: 'system', content: `你是一个专业的翻译助手。请将给定的文本翻译成${langLabel}。只输出翻译结果，不要添加任何解释或说明。` },
          { role: 'user', content: result.text },
        ],
        capabilities: [], toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' }, skills: { mode: 'off' },
      }
      if (selectedModel) opt.model = selectedModel

      let streamTranslation = ''
      const req = mulby.ai.call(opt, (chunk: any) => {
        if (chunk.__requestId) return
        if (chunk.chunkType === 'text' && chunk.content) {
          streamTranslation += chunk.content
          setTranslation(streamTranslation)
        }
      })

      const finalMsg = await req
      setTranslation(typeof finalMsg?.content === 'string' ? finalMsg.content : streamTranslation)
    } catch (err: any) {
      setError(err?.message || '翻译失败，请检查 AI 配置')
    } finally {
      setTranslating(false)
    }
  }

  const handleRetry = () => { if (imageDataUrl) doRecognize(imageDataUrl, mode, engineRef.current) }

  const handleModeChange = (newMode: OcrMode) => {
    setMode(newMode)
    if (imageDataUrl) doRecognize(imageDataUrl, newMode, newMode === 'text' ? engineRef.current : 'ai')
  }

  const handleEngineToggle = () => {
    const engines: OcrEngine[] = ['native', 'rapidocr', 'ai']
    const currentIdx = engines.indexOf(engineRef.current)
    const newEngine = engines[(currentIdx + 1) % engines.length]
    wrapSetEngine(newEngine)
    // Start RapidOCR availability check immediately on switch
    if (newEngine === 'rapidocr' && !isRapidOcrReady()) {
      initRapidOcr()
    }
    if (imageDataUrl && mode === 'text') doRecognize(imageDataUrl, mode, newEngine)
  }

  const handleSaveImage = async () => {
    if (!imageDataUrl) return
    try {
      const path = await mulby.dialog.showSaveDialog({ title: '保存截图', defaultPath: `ocr_${Date.now()}.png`, filters: [{ name: 'PNG', extensions: ['png'] }] })
      if (path) {
        const base64 = imageDataUrl.split(',')[1]
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        await mulby.filesystem.writeFile(path, bytes.buffer)
        mulby.notification.show('截图已保存')
      }
    } catch {}
  }

  const modeItems: { key: OcrMode; label: string; icon: typeof Type }[] = [
    { key: 'text', label: '文字', icon: Type },
    { key: 'table', label: '表格', icon: Table2 },
    { key: 'formula', label: '公式', icon: FunctionSquare },
  ]

  const activeEngine = mode !== 'text' ? 'ai' : engine
  const currentLangLabel = LANGUAGES.find(l => l.id === targetLang)?.label || targetLang

  const resultActions = result?.text ? (
    <>
      <button onClick={handleRetry} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" title="重新识别"><RotateCcw className="w-3.5 h-3.5" /></button>
      {result.mode === 'text' && <button onClick={handleTranslate} disabled={translating} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-blue-500 transition-colors disabled:opacity-50" title={`翻译为${currentLangLabel}`}><Languages className="w-3.5 h-3.5" /></button>}
      {result.mode === 'table' && (
        <>
          <button onClick={handleCopyMarkdownTable} className="px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 text-[11px] text-zinc-500 hover:text-blue-500 transition-colors" title="复制 Markdown 表格">MD</button>
          <button onClick={handleCopyExcelTable} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-emerald-500 transition-colors" title="复制 Excel"><FileSpreadsheet className="w-3.5 h-3.5" /></button>
          <button onClick={handleExportExcelTable} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-emerald-500 transition-colors" title="导出 Excel"><Download className="w-3.5 h-3.5" /></button>
        </>
      )}
      {result.mode === 'formula' && (
        <>
          <button onClick={handleCopyLatex} className="px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-700 text-[11px] text-zinc-500 hover:text-blue-500 transition-colors" title="复制 LaTeX">TeX</button>
          <button onClick={handleExportFormulaImage} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-amber-500 transition-colors" title="导出公式图片"><FileImage className="w-3.5 h-3.5" /></button>
        </>
      )}
      <button onClick={handleCopy} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-green-500 transition-colors" title="复制原始结果">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </>
  ) : null

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Type className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-sm font-semibold">OCR 文字识别</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCaptureImage} disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50">
            <Camera className="w-3.5 h-3.5" />截图识别
          </button>
          <button onClick={handlePickImage} disabled={loading}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-zinc-100 dark:bg-zinc-700/60 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50">
            <FolderOpen className="w-3.5 h-3.5" />选择图片
          </button>
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-700/60 rounded-lg p-0.5">
            {modeItems.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => handleModeChange(key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${mode === key ? 'bg-white dark:bg-zinc-600 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            ))}
          </div>
          {mode === 'text' && (
            <button onClick={handleEngineToggle}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all ${
                engine === 'rapidocr'
                  ? 'border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                  : engine === 'ai'
                  ? 'border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
                  : 'border-emerald-300 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
              }`}>
              {engine === 'rapidocr' ? <ScanEye className="w-3 h-3" /> : engine === 'native' ? <Cpu className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
              {engine === 'rapidocr' ? 'Rapid' : engine === 'native' ? '本地' : 'AI'}
            </button>
          )}
          <div className="relative" ref={settingsRef}>
            <button onClick={() => setShowSettings(!showSettings)} className="flex items-center gap-1 p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" title="设置">
              <Settings className="w-3.5 h-3.5" />
            </button>
            {showSettings && (
              <div className="absolute right-0 top-8 z-50 w-72 bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-700">
                  <span className="text-xs font-medium">设置</span>
                  <button onClick={() => setShowSettings(false)} className="p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"><X className="w-3 h-3" /></button>
                </div>

                {/* AI Model */}
                <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-700/50">
                  <div className="text-[10px] text-zinc-400 mb-1.5 font-medium uppercase tracking-wider">AI 模型</div>
                  <div className="max-h-36 overflow-auto space-y-0.5">
                    <button onClick={() => handleSelectModel('')}
                      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${!selectedModel ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}>
                      默认模型
                    </button>
                    {models.map(m => (
                      <button key={m.id} onClick={() => handleSelectModel(m.id)}
                        className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedModel === m.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'hover:bg-zinc-50 dark:hover:bg-zinc-700/50'}`}>
                        <span>{m.label}</span>
                        {m.providerLabel && <span className="text-[10px] text-zinc-400 ml-1">({m.providerLabel})</span>}
                      </button>
                    ))}
                    {modelsLoading && <div className="px-2 py-3 text-center text-xs text-zinc-400"><Loader2 className="w-3 h-3 animate-spin mx-auto mb-1" />加载中...</div>}
                    {!modelsLoading && modelsError && <div className="px-2 py-2 text-center text-[11px] text-red-400 leading-relaxed">{modelsError}</div>}
                    {!modelsLoading && !modelsError && models.length === 0 && (
                      <div className="px-2 py-2 text-center text-[11px] text-zinc-400 leading-relaxed">未检测到可用模型<br />可使用“默认模型”，或先在设置中配置 AI 服务</div>
                    )}
                  </div>
                </div>

                {/* Translation Language */}
                <div className="px-3 py-2">
                  <div className="text-[10px] text-zinc-400 mb-1.5 font-medium uppercase tracking-wider">翻译目标语言</div>
                  <div className="flex flex-wrap gap-1">
                    {LANGUAGES.map(l => (
                      <button key={l.id} onClick={() => handleSelectLang(l.id)}
                        className={`px-2 py-1 rounded text-xs transition-colors ${targetLang === l.id ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium' : 'bg-zinc-50 dark:bg-zinc-700/50 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'}`}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-2/5 border-r border-zinc-200 dark:border-zinc-700 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-700/50 shrink-0">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><ImageIcon className="w-3 h-3" /> 截图预览</span>
            <div className="flex items-center gap-1">
              <button onClick={handleCaptureImage} disabled={loading} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-blue-500 transition-colors disabled:opacity-50" title="重新截图"><Camera className="w-3.5 h-3.5" /></button>
              <button onClick={handlePickImage} disabled={loading} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-blue-500 transition-colors disabled:opacity-50" title="选择图片"><FolderOpen className="w-3.5 h-3.5" /></button>
              {imageDataUrl && <button onClick={handleSaveImage} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors" title="保存图片"><Download className="w-3.5 h-3.5" /></button>}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-3 overflow-auto bg-zinc-50/50 dark:bg-zinc-800/30">
            {imageDataUrl ? <img src={imageDataUrl} alt="Screenshot" className="max-w-full max-h-full object-contain rounded-md shadow-sm" /> : (
              <div className="text-center text-zinc-400 dark:text-zinc-500">
                <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-xs mb-3">截图或选择图片后自动识别</p>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={handleCaptureImage} disabled={loading} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"><Camera className="w-3.5 h-3.5" />截图</button>
                  <button onClick={handlePickImage} disabled={loading} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"><FolderOpen className="w-3.5 h-3.5" />选图</button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-100 dark:border-zinc-700/50 shrink-0">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{loading ? '识别中...' : '识别结果'}</span>
            <div className="flex items-center gap-1">
              {resultActions}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-3">
            {loading && !result?.text && activeEngine === 'rapidocr' && rapidocrStatus !== 'ready' ? (
              <RapidOcrProgressBar
                status={rapidocrStatus}
                percent={rapidocrDownloadPercent}
                message={rapidocrMessage}
                onRetry={() => initRapidOcr()}
              />
            ) : loading && !result?.text ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {activeEngine === 'rapidocr' ? 'RapidOCR 识别中...' : activeEngine === 'native' ? '本地识别中...' : mode === 'table' ? 'AI 识别表格...' : mode === 'formula' ? 'AI 识别公式...' : 'AI 识别文字...'}
                </span>
              </div>
            ) : error && !result?.text ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center"><span className="text-red-500 text-lg">!</span></div>
                <p className="text-sm text-red-500 text-center px-4">{error}</p>
                {imageDataUrl && <button onClick={handleRetry} className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"><RotateCcw className="w-3 h-3" /> 重新识别</button>}
              </div>
            ) : result?.text ? (
              <div className="space-y-4">
                <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700 select-text">
                  {result.text}{loading && <span className="inline-block w-1 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />}
                </pre>
                {(translating || translation) && (
                  <div className="border-t border-zinc-200 dark:border-zinc-700 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1"><Languages className="w-3 h-3" /> 翻译结果 → {currentLangLabel}</span>
                      {translation && !translating && <button onClick={handleCopyTranslation} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-400 hover:text-green-500 transition-colors" title="复制译文"><Copy className="w-3 h-3" /></button>}
                    </div>
                    {translation ? (
                      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-mono bg-blue-50 dark:bg-blue-900/10 rounded-lg p-3 border border-blue-200 dark:border-blue-800/30 select-text">
                        {translation}{translating && <span className="inline-block w-1 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />}
                      </pre>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> 翻译中...</div>
                    )}
                  </div>
                )}
              </div>
            ) : !imageDataUrl ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-400 dark:text-zinc-500">
                <Type className="w-10 h-10 opacity-20" />
                <p className="text-xs">截图或选择图片后自动识别</p>
                <div className="flex items-center gap-2">
                  <button onClick={handleCaptureImage} disabled={loading} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-50"><Camera className="w-3.5 h-3.5" />截图识别</button>
                  <button onClick={handlePickImage} disabled={loading} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"><FolderOpen className="w-3.5 h-3.5" />选择图片</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-400 dark:text-zinc-500 shrink-0">
        <div className="flex items-center gap-2">
          <span>{result?.text ? `${result.text.length} 字` : '截图识别'}</span>
          {result?.engine && (
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${
              result.engine === 'rapidocr'
                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                : result.engine === 'native'
                ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
            }`}>
              {result.engine === 'rapidocr' ? <ScanEye className="w-2.5 h-2.5" /> : result.engine === 'native' ? <Cpu className="w-2.5 h-2.5" /> : <Sparkles className="w-2.5 h-2.5" />}
              {result.engine === 'rapidocr' ? 'Rapid' : result.engine === 'native' ? '本地' : 'AI'}
            </span>
          )}
        </div>
        <span>可设置全局快捷键一键调用</span>
      </div>
    </div>
  )
}
