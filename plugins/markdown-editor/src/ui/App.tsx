import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  LiveMarkdownEditor,
  type EditorSelectionInfo,
  type LiveMarkdownEditorHandle
} from './editor/LiveMarkdownEditor'
import { type CommandPayload } from './editor/markdownCommands'
import {
  Bold,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  ClipboardPaste,
  Code2,
  Copy,
  FileDown,
  FileInput,
  FilePlus2,
  FileUp,
  Heading1,
  Heading2,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Italic,
  Link2,
  List,
  Quote,
  Redo2,
  Save,
  SeparatorHorizontal,
  Sparkles,
  Undo2
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'
import { useDraftStorage } from './hooks/useDraftStorage'
import { FindReplaceBar, type FindReplaceMode } from './components/FindReplaceBar'
import { AiPanel } from './components/AiPanel'
import { AiBubble } from './components/AiBubble'
import { ImageGenDialog } from './components/ImageGenDialog'
import { buildImageAlt, normalizeBase64 } from './services/imageGen'
import { renderMarkdownDocument } from './services/markdownHtml'
import {
  appendHistoryItem,
  docKeyForPath,
  getHistoryForDoc,
  makeHistoryId,
  normalizeHistoryMap,
  type ImageHistoryMap
} from './services/imageHistory'
import { type BubbleRect } from './services/bubble'
import { findMatches, replaceAll as replaceAllInText, replaceRange, type SearchMatch } from './services/search'
import {
  base64ToBytes,
  buildDataUrl,
  extensionFromMime,
  extractInlineImages,
  fitImageSize,
  getDirectory,
  getExtension,
  hasInlineDataImage,
  mimeFromExtension,
  resolveImageHref,
  saveImageAsset,
  saveImageToDir,
  toFileUrl
} from './services/image'
import {
  createExportDocument,
  exportDocxFile,
  exportHtmlFile,
  exportPdfFile,
  replaceExtension,
  type ExportFormat,
  type ExportImage,
  type ExportImageResolver
} from './services/export'

const PLUGIN_ID = 'markdown-editor'
const STORAGE_DRAFT_KEY = 'draft:markdown-editor:v1'
const STORAGE_CHROME_KEY = 'ui:markdown-editor:chrome-collapsed:v1'
const STORAGE_AI_MODEL_KEY = 'ai:markdown-editor:model:v1'
const STORAGE_AI_IMAGE_MODEL_KEY = 'ai:markdown-editor:image-model:v1'
const STORAGE_AI_IMAGE_HISTORY_KEY = 'ai:markdown-editor:image-history:v1'
const IMAGE_HISTORY_DIRNAME = 'gen-history'

/** A document offset range in the CodeMirror editor. */
interface EditorRange {
  from: number
  to: number
}
const DEFAULT_EXPORT_NAME = 'markdown-note.md'
const EDITOR_PLACEHOLDER = '在这里开始写 Markdown'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

interface OutlineEntry {
  id: string
  text: string
  level: number
  line: number
}

interface ToolbarButtonItem {
  key: string
  title: string
  icon: any
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}

function basename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function firstPathFromOpenDialog(result: unknown): string | undefined {
  if (Array.isArray(result) && typeof result[0] === 'string') {
    return result[0]
  }
  if (result && typeof result === 'object' && 'filePaths' in result) {
    const filePaths = (result as { filePaths?: string[] }).filePaths
    if (Array.isArray(filePaths) && typeof filePaths[0] === 'string') {
      return filePaths[0]
    }
  }
  return undefined
}

async function readFileAsUtf8(
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string | ArrayBuffer | Uint8Array>,
  path: string
) {
  const raw = await readFile(path, 'utf-8')
  if (typeof raw === 'string') {
    return raw
  }
  if (raw instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(raw)
  }
  if (raw instanceof ArrayBuffer) {
    return new TextDecoder('utf-8').decode(raw)
  }
  return ''
}

/** Max image display width (px) used when embedding pictures into exports. */
const MAX_EXPORT_IMAGE_WIDTH = 600

/**
 * Decodes an image URL via a canvas to obtain raw bytes + display size for
 * embedding. Output is normalized to PNG so any browser-decodable source
 * (png/jpg/gif/webp/bmp/svg) becomes a .docx-compatible picture. Returns null
 * when the image cannot be decoded or the canvas is tainted (cross-origin
 * without CORS) so the caller can fall back to a text placeholder.
 */
async function loadImageForExport(href: string): Promise<ExportImage | null> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.decoding = 'async'
  image.src = href

  try {
    await image.decode()
  } catch {
    const loaded = await new Promise<boolean>((resolve) => {
      if (image.complete && image.naturalWidth > 0) {
        resolve(true)
        return
      }
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
    })
    if (!loaded) {
      return null
    }
  }

  const naturalWidth = image.naturalWidth
  const naturalHeight = image.naturalHeight
  if (!naturalWidth || !naturalHeight) {
    return null
  }

  const canvas = document.createElement('canvas')
  canvas.width = naturalWidth
  canvas.height = naturalHeight
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }
  context.drawImage(image, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png')
  })
  if (!blob) {
    return null
  }

  const buffer = await blob.arrayBuffer()
  const { width, height } = fitImageSize(
    { width: naturalWidth, height: naturalHeight },
    MAX_EXPORT_IMAGE_WIDTH
  )
  return {
    data: new Uint8Array(buffer),
    width,
    height,
    type: 'png'
  }
}

function formatTimestamp(value: number | null) {
  if (!value) {
    return '未保存'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(value)
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function parseOutline(markdown: string): OutlineEntry[] {
  const lines = markdown.split('\n')
  const entries: OutlineEntry[] = []
  let fenceChar = ''
  let fenceLength = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)

    if (fenceMatch) {
      const fence = fenceMatch[1]
      if (!fenceChar) {
        fenceChar = fence[0]
        fenceLength = fence.length
      } else if (fence[0] === fenceChar && fence.length >= fenceLength) {
        fenceChar = ''
        fenceLength = 0
      }
      continue
    }

    if (fenceChar) {
      continue
    }

    const atxMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (atxMatch) {
      const text = stripInlineMarkdown(atxMatch[2])
      if (text) {
        entries.push({
          id: `outline-${entries.length}`,
          text,
          level: atxMatch[1].length,
          line: index + 1
        })
      }
      continue
    }

    const nextLine = lines[index + 1]
    const setextMatch = nextLine?.match(/^\s{0,3}(=+|-+)\s*$/)
    if (setextMatch && line.trim()) {
      entries.push({
        id: `outline-${entries.length}`,
        text: stripInlineMarkdown(line),
        level: setextMatch[1][0] === '=' ? 1 : 2,
        line: index + 1
      })
      index += 1
    }
  }

  return entries
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [content, setContent] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [, setSourceLabel] = useState('新草稿')
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findMode, setFindMode] = useState<FindReplaceMode>('find')
  const [findQuery, setFindQuery] = useState('')
  const [findReplacement, setFindReplacement] = useState('')
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findWholeWord, setFindWholeWord] = useState(false)
  const [findIndex, setFindIndex] = useState(0)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiSelection, setAiSelection] = useState('')
  const [aiModel, setAiModel] = useState('')
  const [imageGenOpen, setImageGenOpen] = useState(false)
  const [imageGenPrompt, setImageGenPrompt] = useState('')
  const [imageModel, setImageModel] = useState('')
  // Per-document AI image-generation history (persisted so reopening the
  // generator shows everything produced for the current document).
  const [imageHistoryMap, setImageHistoryMap] = useState<ImageHistoryMap>({})
  const [bubbleAnchor, setBubbleAnchor] = useState<BubbleRect | null>(null)
  const [bubbleSelection, setBubbleSelection] = useState('')
  // Bumped each time the bubble is summoned via shortcut so it remounts with a
  // fresh menu phase even if one was already showing.
  const [bubbleSummonKey, setBubbleSummonKey] = useState(0)
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<LiveMarkdownEditorHandle | null>(null)
  const contentRef = useRef(content)
  const lastPersistedRef = useRef('')
  const activeFilePathRef = useRef<string | null>(null)
  const hasInitPayloadRef = useRef(false)
  const aiOpenRef = useRef(false)
  const bubblePinnedRef = useRef(false)
  const bubbleRangeRef = useRef<EditorRange | null>(null)
  // Editor range captured when the image generator opens, so an inserted image
  // lands at the original caret instead of replacing the prompt selection.
  const imageRangeRef = useRef<EditorRange | null>(null)
  // Mirrors imageHistoryMap for stable reads inside callbacks (avoids stale closures).
  const imageHistoryMapRef = useRef<ImageHistoryMap>({})
  const { ai, clipboard, dialog, filesystem, notification, storage, system } = useMulby(PLUGIN_ID)
  const draftStorage = useDraftStorage(storage, STORAGE_DRAFT_KEY)

  contentRef.current = content
  activeFilePathRef.current = activeFilePath
  aiOpenRef.current = aiOpen
  imageHistoryMapRef.current = imageHistoryMap
  const outlineEntries = useMemo(() => parseOutline(content), [content])
  const searchMatches = useMemo<SearchMatch[]>(
    () => (findOpen && findQuery ? findMatches(content, findQuery, { caseSensitive: findCaseSensitive, wholeWord: findWholeWord }) : []),
    [content, findOpen, findQuery, findCaseSensitive, findWholeWord]
  )
  // The current document's image-generation history, with display URLs resolved
  // for the generator dialog. Recomputes when the bound file or history changes.
  const currentImageHistory = useMemo(
    () =>
      getHistoryForDoc(imageHistoryMap, docKeyForPath(activeFilePath)).map((entry) => ({
        id: entry.id,
        prompt: entry.prompt,
        size: entry.size,
        url: toFileUrl(entry.path),
        createdAt: entry.createdAt
      })),
    [imageHistoryMap, activeFilePath]
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((nextTheme: 'light' | 'dark') => {
      setTheme(nextTheme)
      document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.featureCode !== 'edit-selection') {
        return
      }

      const incoming = data.input ?? ''
      if (!incoming.trim()) {
        return
      }

      hasInitPayloadRef.current = true
      setSourceLabel('来自划词内容')
      setActiveFilePath(null)
      setSavedAt(null)
      lastPersistedRef.current = ''
      startTransition(() => {
        setContent(incoming)
      })
    })

    let cancelled = false

    async function loadDraft() {
      try {
        const [draft, collapsedValue, savedModel, savedImageModel, savedImageHistory] = await Promise.all([
          draftStorage.loadDraft(),
          storage.get(STORAGE_CHROME_KEY),
          storage.get(STORAGE_AI_MODEL_KEY),
          storage.get(STORAGE_AI_IMAGE_MODEL_KEY),
          storage.get(STORAGE_AI_IMAGE_HISTORY_KEY)
        ])

        if (!cancelled) {
          setChromeCollapsed(collapsedValue === true)
          if (typeof savedModel === 'string') {
            setAiModel(savedModel)
          }
          if (typeof savedImageModel === 'string') {
            setImageModel(savedImageModel)
          }
          setImageHistoryMap(normalizeHistoryMap(savedImageHistory))
        }

        if (!cancelled && !hasInitPayloadRef.current && draft) {
          lastPersistedRef.current = draft.content
          setContent(draft.content)
          setSavedAt(draft.updatedAt)
          setSourceLabel('已恢复上次草稿')
        }
      } finally {
        if (!cancelled) {
          setHydrated(true)
        }
      }
    }

    void loadDraft()

    return () => {
      cancelled = true
    }
  }, [draftStorage, storage])

  // Resolves Markdown image hrefs so the live preview can load them: relative
  // paths resolve against the bound document's directory; data/http/file pass
  // through unchanged.
  const resolveEditorImageUrl = useCallback(
    (href: string) => {
      const baseDir = activeFilePath ? getDirectory(activeFilePath) : ''
      return resolveImageHref(href, baseDir) ?? href
    },
    [activeFilePath]
  )

  // Editor edits flow up as the markdown source of truth.
  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
  }, [])

  // Drives the floating AI bubble from the live editor selection. The CM6
  // selection rect is read straight from the view, so it works in any scroll
  // position without DOM-selection guessing.
  const handleEditorSelection = useCallback((info: EditorSelectionInfo) => {
    if (aiOpenRef.current || bubblePinnedRef.current) {
      return
    }
    if (!info.hasFocus || !info.text.trim() || info.from === info.to) {
      setBubbleAnchor(null)
      return
    }
    const rect = editorRef.current?.getSelectionRect()
    if (!rect) {
      setBubbleAnchor(null)
      return
    }
    setBubbleSelection(info.text)
    setBubbleAnchor(rect)
  }, [])

  // Push external content changes (open file, draft restore, organize images,
  // undo across documents) into the editor when they diverge from its value.
  useEffect(() => {
    const handle = editorRef.current
    if (!handle) {
      return
    }
    if (handle.getValue() === content) {
      return
    }
    handle.setValue(content)
  }, [content])

  useEffect(() => {
    if (outlineEntries.length === 0) {
      setActiveOutlineId(null)
      return
    }

    if (!outlineEntries.some((entry) => entry.id === activeOutlineId)) {
      setActiveOutlineId(outlineEntries[0].id)
    }
  }, [activeOutlineId, outlineEntries])

  useEffect(() => {
    const handle = editorRef.current
    const view = handle?.getView()
    if (!handle || !view || outlineEntries.length === 0) {
      return
    }

    const scroller = view.scrollDOM
    let frameId = 0

    const syncActiveOutline = () => {
      const containerTop = scroller.getBoundingClientRect().top
      let candidateId = outlineEntries[0].id
      for (const entry of outlineEntries) {
        const coords = view.coordsAtPos(handle.posForLine(entry.line))
        if (coords && coords.top - containerTop <= 72) {
          candidateId = entry.id
        }
      }
      setActiveOutlineId((current) => (current === candidateId ? current : candidateId))
    }

    const scheduleSync = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(syncActiveOutline)
    }

    scheduleSync()
    scroller.addEventListener('scroll', syncActiveOutline, { passive: true })

    return () => {
      window.cancelAnimationFrame(frameId)
      scroller.removeEventListener('scroll', syncActiveOutline)
    }
  }, [chromeCollapsed, outlineEntries, content])

  const focusEditor = useCallback(() => {
    editorRef.current?.focus()
  }, [])

  const execCommand = useCallback((name: string, payload?: CommandPayload) => {
    editorRef.current?.runCommand(name, payload)
  }, [])

  const handleUndo = useCallback(() => {
    editorRef.current?.runCommand('undo')
  }, [])

  const handleRedo = useCallback(() => {
    editorRef.current?.runCommand('redo')
  }, [])

  const toggleChrome = useCallback(() => {
    setChromeCollapsed((current) => {
      const next = !current
      void storage.set(STORAGE_CHROME_KEY, next)
      return next
    })
  }, [storage])

  const handleOutlineSelect = useCallback((entry: OutlineEntry) => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    setActiveOutlineId(entry.id)
    const pos = editor.posForLine(entry.line)
    editor.setSelection(pos, pos)
    editor.scrollToPos(pos)
    editor.focus()
  }, [])

  const isDirty = hydrated && content !== lastPersistedRef.current

  const persistDraft = useCallback(async (showToast: boolean) => {
    setSaving(true)
    try {
      const current = editorRef.current?.getValue() ?? contentRef.current
      const payload = await draftStorage.saveDraft(current)
      lastPersistedRef.current = current
      setSavedAt(payload?.updatedAt ?? Date.now())
      setContent(current)
      if (showToast) {
        notification.show(current.trim() ? '草稿已保存' : '空草稿已清除', 'success')
      }
    } catch (error) {
      console.error('[markdown-editor] persistDraft', error)
      notification.show('保存草稿失败', 'error')
    } finally {
      setSaving(false)
      focusEditor()
    }
  }, [draftStorage, focusEditor, notification])

  useEffect(() => {
    if (!hydrated || !isDirty) {
      return
    }

    // When bound to a file, the file is the source of truth and the user saves
    // explicitly (Ctrl/Cmd+S); skip the recovery-draft autosave so reopening
    // never surfaces a stale draft.
    if (activeFilePath) {
      return
    }

    const timer = window.setTimeout(() => {
      void persistDraft(false)
    }, 600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [activeFilePath, hydrated, isDirty, persistDraft])

  const handleOpenFile = useCallback(async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '打开 Markdown 文件',
        properties: ['openFile'],
        filters: [
          { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }
        ]
      })
      const path = firstPathFromOpenDialog(result)
      if (!path) {
        return
      }

      const fileContent = await readFileAsUtf8(filesystem.readFile, path)
      lastPersistedRef.current = fileContent
      setActiveFilePath(path)
      setSourceLabel(`载入 ${basename(path)}`)
      setSavedAt(Date.now())
      startTransition(() => {
        setContent(fileContent)
      })
      notification.show('文件已载入', 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleOpenFile', error)
      notification.show('读取文件失败', 'error')
    }
  }, [dialog, filesystem, focusEditor, notification])

  const writeToFile = useCallback(async (path: string) => {
    const current = editorRef.current?.getValue() ?? contentRef.current
    await filesystem.writeFile(path, current, 'utf-8')
    lastPersistedRef.current = current
    setActiveFilePath(path)
    setSavedAt(Date.now())
    setContent(current)
    setSourceLabel(`已保存 ${basename(path)}`)
    // The file is now the source of truth; clear the recovery draft.
    await draftStorage.clearDraft().catch(() => undefined)
  }, [draftStorage, filesystem])

  const promptMarkdownSavePath = useCallback(() => {
    return dialog.showSaveDialog({
      title: '保存 Markdown 文件',
      defaultPath: activeFilePath ?? DEFAULT_EXPORT_NAME,
      buttonLabel: '保存',
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown'] },
        { name: 'Text', extensions: ['txt'] }
      ]
    })
  }, [activeFilePath, dialog])

  const handleSaveFileAs = useCallback(async () => {
    try {
      const target = await promptMarkdownSavePath()
      if (!target) {
        focusEditor()
        return
      }
      await writeToFile(target)
      notification.show(`已保存到 ${basename(target)}`, 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleSaveFileAs', error)
      notification.show('保存文件失败', 'error')
    }
  }, [focusEditor, notification, promptMarkdownSavePath, writeToFile])

  const handleSaveFile = useCallback(async () => {
    if (!activeFilePath) {
      await handleSaveFileAs()
      return
    }
    try {
      await writeToFile(activeFilePath)
      notification.show(`已保存到 ${basename(activeFilePath)}`, 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleSaveFile', error)
      notification.show('保存文件失败', 'error')
    }
  }, [activeFilePath, focusEditor, handleSaveFileAs, notification, writeToFile])

  useEffect(() => {
    if (findIndex > 0 && findIndex >= searchMatches.length) {
      setFindIndex(searchMatches.length > 0 ? searchMatches.length - 1 : 0)
    }
  }, [findIndex, searchMatches.length])

  const goToMatch = useCallback((index: number, matches: SearchMatch[]) => {
    if (matches.length === 0) {
      return
    }
    const normalized = ((index % matches.length) + matches.length) % matches.length
    setFindIndex(normalized)

    const editor = editorRef.current
    const match = matches[normalized]
    if (!editor || !match) {
      return
    }
    // CM6 selects by source offset directly — no mode switch required.
    editor.setSelection(match.start, match.end)
    editor.scrollToPos(match.start)
  }, [])

  const openFind = useCallback((mode: FindReplaceMode) => {
    const editor = editorRef.current
    const selected = editor?.getSelectedText?.() ?? ''
    setFindMode(mode)
    setFindOpen(true)
    setFindIndex(0)
    if (selected && !selected.includes('\n')) {
      setFindQuery(selected)
    }
  }, [])

  const openAiPanel = useCallback(() => {
    const editor = editorRef.current
    setAiSelection(editor?.getSelectedText?.() ?? '')
    setAiOpen(true)
    // Dismiss the floating bubble so the two AI surfaces never overlap. Inlined
    // (not via closeBubble) to avoid a forward reference / TDZ at definition time.
    bubblePinnedRef.current = false
    bubbleRangeRef.current = null
    setBubbleAnchor(null)
  }, [])

  const closeFind = useCallback(() => {
    setFindOpen(false)
    focusEditor()
  }, [focusEditor])

  const handleFindNext = useCallback(() => {
    goToMatch(findIndex + 1, searchMatches)
  }, [findIndex, goToMatch, searchMatches])

  const handleFindPrev = useCallback(() => {
    goToMatch(findIndex - 1, searchMatches)
  }, [findIndex, goToMatch, searchMatches])

  const handleReplaceOne = useCallback(() => {
    const editor = editorRef.current
    if (!editor || searchMatches.length === 0) {
      return
    }
    const target = searchMatches[Math.min(findIndex, searchMatches.length - 1)]
    const source = editor.getValue()
    const next = replaceRange(source, target.start, target.end, findReplacement)
    editor.setValue(next)
    setContent(next)

    const remaining = findMatches(next, findQuery, { caseSensitive: findCaseSensitive, wholeWord: findWholeWord })
    window.requestAnimationFrame(() => {
      goToMatch(findIndex, remaining)
    })
  }, [findCaseSensitive, findIndex, findQuery, findReplacement, findWholeWord, goToMatch, searchMatches])

  const handleReplaceAll = useCallback(() => {
    const editor = editorRef.current
    if (!editor || searchMatches.length === 0) {
      return
    }
    const count = searchMatches.length
    const source = editor.getValue()
    const next = replaceAllInText(source, findQuery, findReplacement, { caseSensitive: findCaseSensitive, wholeWord: findWholeWord })
    editor.setValue(next)
    setContent(next)
    setFindIndex(0)
    notification.show(`已替换 ${count} 处`, 'success')
  }, [findCaseSensitive, findQuery, findReplacement, findWholeWord, notification, searchMatches])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'f') {
        event.preventDefault()
        openFind('find')
        return
      }
      if (key === 'h') {
        event.preventDefault()
        openFind('replace')
        return
      }
      if (key === 'k') {
        event.preventDefault()
        openAiPanel()
        return
      }
      if (key === 's') {
        event.preventDefault()
        if (event.shiftKey) {
          void handleSaveFileAs()
        } else if (activeFilePathRef.current) {
          void handleSaveFile()
        } else {
          void persistDraft(true)
        }
        return
      }

      // Toast UI handles undo/redo natively when its editing surface is focused;
      // only intercept when focus is elsewhere (toolbar, outline, dialogs).
      const host = hostRef.current
      const focusInsideEditor = host?.contains(document.activeElement)
      if (focusInsideEditor) {
        return
      }

      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          handleRedo()
        } else {
          handleUndo()
        }
        return
      }

      if (key === 'y') {
        event.preventDefault()
        handleRedo()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [handleRedo, handleSaveFile, handleSaveFileAs, handleUndo, openAiPanel, openFind, persistDraft])

  const documentName = activeFilePath ? basename(activeFilePath) : '未命名.md'

  const getCurrentExportDocument = useCallback(() => {
    const markdown = editorRef.current?.getValue() ?? contentRef.current
    const html = renderMarkdownDocument(markdown)

    return createExportDocument({
      markdown,
      html,
      documentName
    })
  }, [documentName])

  const closeExportMenu = useCallback(() => {
    setExportMenuOpen(false)
    focusEditor()
  }, [focusEditor])

  // Resolves an <img> src from the export HTML into decoded bytes + display size
  // so DOCX export can embed real pictures. Relative paths anchor to the bound
  // document directory; unresolved images degrade to a text placeholder.
  const resolveExportImage = useCallback<ExportImageResolver>(async (src) => {
    const boundPath = activeFilePathRef.current
    const baseDir = boundPath ? getDirectory(boundPath) : ''
    const href = resolveImageHref(src, baseDir)
    if (!href) {
      return null
    }
    try {
      return await loadImageForExport(href)
    } catch (error) {
      console.error('[markdown-editor] resolveExportImage', error)
      return null
    }
  }, [])

  const handleExportByFormat = useCallback(async (format: ExportFormat) => {
    try {
      const exportDocument = getCurrentExportDocument()
      const defaultPath = (() => {
        switch (format) {
          case 'html':
            return replaceExtension(activeFilePath ?? DEFAULT_EXPORT_NAME, '.html')
          case 'pdf':
            return replaceExtension(activeFilePath ?? DEFAULT_EXPORT_NAME, '.pdf')
          case 'docx':
            return replaceExtension(activeFilePath ?? DEFAULT_EXPORT_NAME, '.docx')
          default:
            return activeFilePath ?? DEFAULT_EXPORT_NAME
        }
      })()

      const target = await dialog.showSaveDialog({
        title: format === 'markdown'
          ? '导出 Markdown 文件'
          : format === 'html'
            ? '导出 HTML 文件'
            : format === 'pdf'
              ? '导出 PDF 文件'
              : '导出 Word 文件',
        defaultPath,
        buttonLabel: '导出',
        filters: format === 'markdown'
          ? [
              { name: 'Markdown', extensions: ['md'] },
              { name: 'Text', extensions: ['txt'] }
            ]
          : format === 'html'
            ? [{ name: 'HTML', extensions: ['html'] }]
            : format === 'pdf'
              ? [{ name: 'PDF', extensions: ['pdf'] }]
              : [{ name: 'Word', extensions: ['docx'] }]
      })

      if (!target) {
        closeExportMenu()
        return
      }

      if (format === 'markdown') {
        await filesystem.writeFile(target, exportDocument.markdown, 'utf-8')
      } else if (format === 'html') {
        await exportHtmlFile(exportDocument, target, filesystem)
      } else if (format === 'pdf') {
        await exportPdfFile(exportDocument, target)
      } else {
        await exportDocxFile(exportDocument, target, filesystem, resolveExportImage)
      }

      setActiveFilePath(target)
      setExportMenuOpen(false)
      notification.show(`已导出到 ${basename(target)}`, 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleExportByFormat', error)
      setExportMenuOpen(false)
      notification.show('导出文件失败', 'error')
      focusEditor()
    }
  }, [activeFilePath, closeExportMenu, dialog, filesystem, focusEditor, getCurrentExportDocument, notification, resolveExportImage])

  const handleOpenExportMenu = useCallback(() => {
    setExportMenuOpen(true)
  }, [])

  const closeAiPanel = useCallback(() => {
    setAiOpen(false)
    focusEditor()
  }, [focusEditor])

  const handleAiModelChange = useCallback((model: string) => {
    setAiModel(model)
    void storage.set(STORAGE_AI_MODEL_KEY, model).catch(() => undefined)
  }, [storage])

  // Inserts Markdown text at the caret. The live editor renders Markdown in
  // place, so the raw source is exactly what should be inserted.
  const insertMarkdownText = useCallback(
    (editor: LiveMarkdownEditorHandle, text: string, asBlock = false) => {
      editor.insertText(asBlock ? `\n\n${text}\n` : text)
    },
    []
  )

  // Replaces the given range (or the live selection) with Markdown text. CM6
  // renders the inserted Markdown live, so no mode handling is needed.
  const replaceMarkdownText = useCallback(
    (editor: LiveMarkdownEditorHandle, text: string, range?: EditorRange | null) => {
      editor.replaceSelection(text, range)
    },
    []
  )

  const handleAiReplaceSelection = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    // Mode-aware so Markdown renders in WYSIWYG instead of showing raw source.
    replaceMarkdownText(editor, text)
    setContent(editor.getValue())
    setAiOpen(false)
    notification.show('已替换选中文字', 'success')
    editor.focus()
  }, [notification, replaceMarkdownText])

  const handleAiInsert = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    // Insert on its own line so generated blocks don't glue onto existing text.
    insertMarkdownText(editor, text, true)
    setContent(editor.getValue())
    setAiOpen(false)
    notification.show('已插入 AI 结果', 'success')
    editor.focus()
  }, [insertMarkdownText, notification])

  const handleAiCopy = useCallback((text: string) => {
    void clipboard.writeText(text)
      .then(() => notification.show('已复制 AI 结果', 'success'))
      .catch(() => notification.show('复制失败', 'error'))
  }, [clipboard, notification])

  const closeBubble = useCallback(() => {
    bubblePinnedRef.current = false
    bubbleRangeRef.current = null
    setBubbleAnchor(null)
  }, [])

  const shouldKeepBubbleOpenOnTarget = useCallback((target: Node) => {
    const host = hostRef.current
    return !!host && host.contains(target)
  }, [])

  // Pins the bubble and captures the live editor selection range the moment an
  // action starts (selection is still alive because the chips preventDefault on
  // mousedown). Subsequent activations keep the original range so applying a
  // result always targets the originally selected text.
  const handleBubbleActivate = useCallback(() => {
    if (bubblePinnedRef.current) {
      return
    }
    const editor = editorRef.current
    if (editor) {
      try {
        bubbleRangeRef.current = editor.getSelection()
      } catch {
        bubbleRangeRef.current = null
      }
    }
    bubblePinnedRef.current = true
  }, [])

  const handleBubbleReplace = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) {
      closeBubble()
      return
    }
    const range = bubbleRangeRef.current
    // Mode-aware so Markdown renders in WYSIWYG instead of showing raw source.
    replaceMarkdownText(editor, text, range)
    setContent(editor.getValue())
    notification.show('已替换选中文字', 'success')
    closeBubble()
    editor.focus()
  }, [closeBubble, notification, replaceMarkdownText])

  const handleBubbleInsert = useCallback((text: string) => {
    const editor = editorRef.current
    if (!editor) {
      closeBubble()
      return
    }
    const range = bubbleRangeRef.current
    if (range) {
      // Collapse to the end of the original selection, then insert below it.
      try {
        editor.setSelection(range.to, range.to)
      } catch {
        // Keep the current caret.
      }
    }
    insertMarkdownText(editor, text, true)
    setContent(editor.getValue())
    notification.show('已插入 AI 结果', 'success')
    closeBubble()
    editor.focus()
  }, [closeBubble, insertMarkdownText, notification])

  const handleBubbleExpand = useCallback(() => {
    const editor = editorRef.current
    setAiSelection(editor?.getSelectedText?.() ?? '')
    setAiOpen(true)
    closeBubble()
  }, [closeBubble])

  // Cmd/Ctrl+J summons the AI bubble regardless of whether text is selected.
  // With a selection it behaves like the on-select toolbar; with a collapsed
  // caret it anchors at the caret (or the editor's top area as a fallback) and
  // the bubble operates on the whole document.
  const summonBubble = useCallback(() => {
    if (aiOpenRef.current) {
      return
    }
    const host = hostRef.current
    const editor = editorRef.current
    if (!host || !editor) {
      return
    }

    const text = editor.getSelectedText()
    let rect: BubbleRect | null = text ? editor.getSelectionRect() : null

    if (!rect) {
      const hostRect = host.getBoundingClientRect()
      const left = hostRect.left + Math.min(hostRect.width / 2, 240)
      const top = hostRect.top + 72
      rect = { left, top, right: left, bottom: top, width: 0, height: 0 }
    }

    bubbleRangeRef.current = text ? editor.getSelection() : null
    bubblePinnedRef.current = true
    setBubbleSelection(text)
    setBubbleAnchor(rect)
    setBubbleSummonKey((key) => key + 1)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.shiftKey && !event.altKey && (event.key === 'j' || event.key === 'J')) {
        event.preventDefault()
        summonBubble()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [summonBubble])

  // Persists raw image bytes to disk and returns the short URL to reference it
  // by: a portable `assets/` relative path when a file is bound, otherwise a
  // `file://` URL into the plugin data dir. Throws if the write fails so callers
  // can decide how to fall back.
  const saveImageData = useCallback(async (data: ArrayBuffer | Uint8Array, ext: string) => {
    const safeExt = ext || 'png'
    const boundPath = activeFilePathRef.current
    if (boundPath) {
      const result = await saveImageAsset(filesystem, boundPath, data, safeExt)
      return result.relativePath
    }
    const userData = await system.getPath('userData')
    const assetsDir = `${userData.replace(/[/\\]+$/, '')}/${PLUGIN_ID}/assets`
    const absolutePath = await saveImageToDir(filesystem, assetsDir, data, safeExt)
    return toFileUrl(absolutePath)
  }, [filesystem, system])

  const embedImage = useCallback(async (data: ArrayBuffer | Uint8Array, ext: string, alt = '') => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const safeExt = ext || 'png'
    let imageUrl: string
    try {
      imageUrl = await saveImageData(data, safeExt)
    } catch (error) {
      console.error('[markdown-editor] embedImage', error)
      // Last-resort fallback keeps the image usable even if disk write fails.
      imageUrl = buildDataUrl(data, mimeFromExtension(safeExt))
    }
    // Use the editor's addImage command so the image renders as an <img> node in
    // WYSIWYG mode and is written as `![alt](url)` in source mode — inserting raw
    // Markdown via insertText would only show the literal syntax in WYSIWYG.
    editor.runCommand('addImage', { imageUrl, altText: alt })
    setContent(editor.getValue())
    editor.focus()
  }, [saveImageData])

  const handleImageModelChange = useCallback((model: string) => {
    setImageModel(model)
    void storage.set(STORAGE_AI_IMAGE_MODEL_KEY, model).catch(() => undefined)
  }, [storage])

  // Opens the AI image generator. Captures the current editor range so a later
  // insert targets the original caret, and closes any open AI surface first.
  const openImageGen = useCallback((prompt: string) => {
    const editor = editorRef.current
    if (editor) {
      try {
        imageRangeRef.current = editor.getSelection()
      } catch {
        imageRangeRef.current = null
      }
    } else {
      imageRangeRef.current = null
    }
    closeBubble()
    setAiOpen(false)
    setImageGenPrompt(prompt)
    setImageGenOpen(true)
  }, [closeBubble])

  const closeImageGen = useCallback(() => {
    setImageGenOpen(false)
    focusEditor()
  }, [focusEditor])

  const handleInsertGeneratedImage = useCallback(async (base64: string, prompt: string) => {
    const normalized = normalizeBase64(base64)
    if (!normalized) {
      notification.show('没有可插入的图片', 'warning')
      return
    }
    const editor = editorRef.current
    if (editor) {
      const range = imageRangeRef.current
      if (range) {
        // Collapse to the end of the captured range so the prompt text isn't
        // overwritten when the image is inserted.
        try {
          editor.setSelection(range.to, range.to)
        } catch {
          // Ignore: fall back to the editor's current caret.
        }
      }
    }
    let bytes: Uint8Array
    try {
      bytes = base64ToBytes(normalized)
    } catch (error) {
      console.error('[markdown-editor] handleInsertGeneratedImage decode', error)
      notification.show('图片解码失败', 'error')
      return
    }
    await embedImage(bytes, 'png', buildImageAlt(prompt))
    setSourceLabel('来自 AI 生图')
    setImageGenOpen(false)
    notification.show('已插入生成的图片', 'success')
  }, [embedImage, notification])

  // Saves a freshly generated image to the plugin's gen-history folder and
  // records its metadata under the current document, so it remains visible in
  // the generator even if it is never inserted (and survives reopening).
  const persistImageGeneration = useCallback(async (base64: string, prompt: string, size: string) => {
    const normalized = normalizeBase64(base64)
    if (!normalized) {
      return
    }
    let bytes: Uint8Array
    try {
      bytes = base64ToBytes(normalized)
    } catch {
      return
    }
    try {
      const userData = await system.getPath('userData')
      const dir = `${userData.replace(/[/\\]+$/, '')}/${PLUGIN_ID}/${IMAGE_HISTORY_DIRNAME}`
      const absolutePath = await saveImageToDir(filesystem, dir, bytes, 'png')
      const docKey = docKeyForPath(activeFilePathRef.current)
      const item = { id: makeHistoryId(), prompt, size, path: absolutePath, createdAt: Date.now() }
      setImageHistoryMap((prev) => {
        const next = appendHistoryItem(prev, docKey, item)
        void storage.set(STORAGE_AI_IMAGE_HISTORY_KEY, next).catch(() => undefined)
        return next
      })
    } catch (error) {
      console.error('[markdown-editor] persistImageGeneration', error)
    }
  }, [filesystem, storage, system])

  // Inserts a previously generated image (chosen from the history strip) by
  // reading it back from disk and routing through the normal image embed path.
  const handleInsertHistoryImage = useCallback(async (id: string) => {
    const docKey = docKeyForPath(activeFilePathRef.current)
    const item = getHistoryForDoc(imageHistoryMapRef.current, docKey).find((entry) => entry.id === id)
    if (!item) {
      notification.show('找不到该历史图片', 'warning')
      return
    }
    const editor = editorRef.current
    if (editor) {
      const range = imageRangeRef.current
      if (range) {
        try {
          editor.setSelection(range.to, range.to)
        } catch {
          // Fall back to the current caret.
        }
      }
    }
    let raw: string
    try {
      const data = await filesystem.readFile(item.path, 'base64')
      raw = typeof data === 'string' ? data : ''
    } catch (error) {
      console.error('[markdown-editor] handleInsertHistoryImage read', error)
      notification.show('读取历史图片失败，文件可能已被删除', 'error')
      return
    }
    let bytes: Uint8Array
    try {
      bytes = base64ToBytes(normalizeBase64(raw))
    } catch {
      notification.show('历史图片解码失败', 'error')
      return
    }
    if (bytes.byteLength === 0) {
      notification.show('历史图片为空', 'warning')
      return
    }
    await embedImage(bytes, 'png', buildImageAlt(item.prompt))
    setSourceLabel('来自生图历史')
    setImageGenOpen(false)
    notification.show('已插入历史图片', 'success')
  }, [embedImage, filesystem, notification])

  // Extracts every inline base64 image in the given markdown to disk, returning
  // the rewritten markdown and how many were extracted. References that cannot
  // be parsed or saved are left as-is so content is never lost.
  const extractMarkdownImages = useCallback(async (markdown: string) => {
    return extractInlineImages(markdown, async (image) => {
      try {
        return await saveImageData(image.bytes, image.ext)
      } catch (error) {
        console.error('[markdown-editor] extractMarkdownImages', error)
        return null
      }
    })
  }, [saveImageData])

  // "整理图片": converts every inline base64 image in the current document to a
  // short on-disk reference, keeping the source clean. Goes through the editor
  // so the change is part of undo history.
  const handleOrganizeImages = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const source = editor.getValue()
    if (!hasInlineDataImage(source)) {
      notification.show('当前文档没有内联 base64 图片', 'info')
      focusEditor()
      return
    }
    try {
      const { markdown, extracted } = await extractMarkdownImages(source)
      if (extracted === 0) {
        notification.show('未能整理任何图片', 'warning')
        focusEditor()
        return
      }
      editor.setValue(markdown)
      setContent(markdown)
      notification.show(`已整理 ${extracted} 张内联图片为文件引用`, 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleOrganizeImages', error)
      notification.show('整理图片失败', 'error')
      focusEditor()
    }
  }, [extractMarkdownImages, focusEditor, notification])

  const handlePasteClipboard = useCallback(async () => {
    try {
      const format = await clipboard.getFormat()
      if (format === 'image') {
        const image = await clipboard.readImage()
        if (image && image.byteLength > 0) {
          await embedImage(image, 'png', '')
          setSourceLabel('来自剪贴板')
          notification.show('已插入剪贴板图片', 'success')
          return
        }
      }

      const text = await clipboard.readText()
      if (!text.trim()) {
        notification.show('剪贴板里没有可粘贴的内容', 'warning')
        return
      }

      const editor = editorRef.current
      if (!editor) {
        setContent(text)
        return
      }

      // If the pasted markdown carries inline base64 images, extract them to
      // disk first so the source never gets flooded with huge data URLs.
      let insertText = text
      let extractedImages = 0
      if (hasInlineDataImage(text)) {
        const { markdown, extracted } = await extractMarkdownImages(text)
        insertText = markdown
        extractedImages = extracted
      }

      // Mode-aware: pasted Markdown renders in WYSIWYG, stays raw in source mode.
      insertMarkdownText(editor, insertText)
      setContent(editor.getValue())
      setSourceLabel('来自剪贴板')
      notification.show(
        extractedImages > 0
          ? `已插入剪贴板文本，并整理 ${extractedImages} 张内联图片`
          : '已插入剪贴板文本',
        'success'
      )
      editor.focus()
    } catch (error) {
      console.error('[markdown-editor] handlePasteClipboard', error)
      notification.show('读取剪贴板失败', 'error')
    }
  }, [clipboard, embedImage, extractMarkdownImages, insertMarkdownText, notification])

  const handleCopyMarkdown = useCallback(async () => {
    try {
      const current = editorRef.current?.getValue() ?? contentRef.current
      await clipboard.writeText(current)
      notification.show('Markdown 已复制到剪贴板', 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleCopyMarkdown', error)
      notification.show('复制失败', 'error')
    }
  }, [clipboard, focusEditor, notification])

  const clearDocument = useCallback(() => {
    setContent('')
    setSourceLabel('新草稿')
    setActiveFilePath(null)
    setSavedAt(null)
    lastPersistedRef.current = ''
    setClearConfirmOpen(false)
    void draftStorage.clearDraft().catch(() => undefined)
    focusEditor()
    notification.show('已新建空白文档', 'info')
  }, [draftStorage, focusEditor, notification])

  const handleClear = useCallback(() => {
    if (isDirty) {
      setClearConfirmOpen(true)
      return
    }

    clearDocument()
  }, [clearDocument, isDirty])

  const handleCancelClear = useCallback(() => {
    setClearConfirmOpen(false)
    focusEditor()
  }, [focusEditor])

  const handleConfirmClear = useCallback(() => {
    clearDocument()
  }, [clearDocument])

  const handleInsertLink = useCallback(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    const selectedText = editor.getSelectedText() || '链接文字'
    const linkUrl = window.prompt('输入链接地址', 'https://example.com')
    if (!linkUrl) {
      focusEditor()
      return
    }

    execCommand('addLink', { linkUrl, linkText: selectedText })
  }, [execCommand, focusEditor])

  const handleInsertImage = useCallback(async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: '插入图片',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
      })
      const path = firstPathFromOpenDialog(result)
      if (!path) {
        return
      }
      const raw = await filesystem.readFile(path, 'base64')
      const base64 = typeof raw === 'string' ? raw : ''
      const binary = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const ext = getExtension(path) || 'png'
      const name = (path.replace(/\\/g, '/').split('/').pop() ?? '').replace(/\.[^.]+$/, '')
      await embedImage(binary, ext, name)
      notification.show('图片已插入', 'success')
    } catch (error) {
      console.error('[markdown-editor] handleInsertImage', error)
      notification.show('插入图片失败', 'error')
    }
  }, [dialog, embedImage, filesystem, notification])

  const embedImageFile = useCallback(async (file: File) => {
    const buffer = await file.arrayBuffer()
    const ext = getExtension(file.name) || extensionFromMime(file.type)
    const alt = file.name.replace(/\.[^.]+$/, '')
    await embedImage(new Uint8Array(buffer), ext, alt)
  }, [embedImage])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const handleDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
    }

    const handleDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith('image/'))
      if (files.length === 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void (async () => {
        try {
          for (const file of files) {
            await embedImageFile(file)
          }
          notification.show(`已插入 ${files.length} 张图片`, 'success')
        } catch (error) {
          console.error('[markdown-editor] handleDrop', error)
          notification.show('拖入图片失败', 'error')
        }
      })()
    }

    host.addEventListener('dragover', handleDragOver)
    host.addEventListener('drop', handleDrop, true)
    return () => {
      host.removeEventListener('dragover', handleDragOver)
      host.removeEventListener('drop', handleDrop, true)
    }
  }, [embedImageFile, notification])

  const exportMenuOptions: Array<{ format: ExportFormat; label: string; description: string }> = [
    { format: 'markdown', label: 'Markdown (.md)', description: '导出原始 Markdown 内容' },
    { format: 'html', label: 'HTML (.html)', description: '导出可在浏览器中打开的网页文档' },
    { format: 'pdf', label: 'PDF (.pdf)', description: '导出排版固定的打印版文档' },
    { format: 'docx', label: 'Word (.docx)', description: '导出可在 Word / WPS 中编辑的文档' }
  ]

  const toolbarActions: Array<{
    label: string
    title: string
    icon: any
    onClick: () => void
  }> = [
    {
      label: 'H1',
      title: '一级标题',
      icon: Heading1,
      onClick: () => execCommand('heading', { level: 1 })
    },
    {
      label: 'H2',
      title: '二级标题',
      icon: Heading2,
      onClick: () => execCommand('heading', { level: 2 })
    },
    {
      label: '粗体',
      title: '加粗',
      icon: Bold,
      onClick: () => execCommand('bold')
    },
    {
      label: '斜体',
      title: '斜体',
      icon: Italic,
      onClick: () => execCommand('italic')
    },
    {
      label: '链接',
      title: '插入链接',
      icon: Link2,
      onClick: handleInsertLink
    },
    {
      label: '图片',
      title: '插入图片',
      icon: ImageIcon,
      onClick: () => void handleInsertImage()
    },
    {
      label: '引用',
      title: '引用块',
      icon: Quote,
      onClick: () => execCommand('blockQuote')
    },
    {
      label: '代码',
      title: '行内代码',
      icon: Code2,
      onClick: () => execCommand('code')
    },
    {
      label: '列表',
      title: '无序列表',
      icon: List,
      onClick: () => execCommand('bulletList')
    },
    {
      label: '任务',
      title: '任务列表',
      icon: CheckSquare,
      onClick: () => execCommand('taskList')
    },
    {
      label: '分割线',
      title: '插入分割线',
      icon: SeparatorHorizontal,
      onClick: () => execCommand('hr')
    }
  ]

  const toolbarGroups: ToolbarButtonItem[][] = [
    [
      {
        key: 'undo',
        title: '撤销 (Ctrl/Cmd+Z)',
        icon: Undo2,
        onClick: handleUndo
      },
      {
        key: 'redo',
        title: '重做 (Ctrl/Cmd+Shift+Z)',
        icon: Redo2,
        onClick: handleRedo
      }
    ],
    [
      {
        key: 'new',
        title: '新建文档',
        icon: FilePlus2,
        onClick: handleClear
      },
      {
        key: 'open',
        title: '打开文件',
        icon: FileInput,
        onClick: handleOpenFile
      }
    ],
    [
      {
        key: 'save-file',
        title: activeFilePath ? `保存到 ${basename(activeFilePath)} (Ctrl/Cmd+S)` : '保存到文件 (Ctrl/Cmd+S)',
        icon: FileUp,
        onClick: () => void handleSaveFile()
      },
      {
        key: 'save-as',
        title: '另存为 (Ctrl/Cmd+Shift+S)',
        icon: Save,
        onClick: () => void handleSaveFileAs()
      },
      {
        key: 'save-draft',
        title: saving ? '保存中' : '保存草稿',
        icon: Save,
        onClick: () => void persistDraft(true),
        disabled: saving
      },
      {
        key: 'export',
        title: '导出文件',
        icon: FileDown,
        onClick: handleOpenExportMenu
      }
    ],
    [
      {
        key: 'copy',
        title: '复制',
        icon: Copy,
        onClick: () => void handleCopyMarkdown()
      },
      {
        key: 'paste',
        title: '粘贴',
        icon: ClipboardPaste,
        onClick: handlePasteClipboard
      }
    ],
    [
      {
        key: 'ai',
        title: 'AI 助手（润色/续写/翻译/总结，Ctrl/Cmd+K）',
        icon: Sparkles,
        onClick: openAiPanel
      },
      {
        key: 'ai-image',
        title: 'AI 生图（根据描述或选中文字生成图片）',
        icon: ImagePlus,
        onClick: () => openImageGen('')
      }
    ],
    toolbarActions.slice(0, 2).map((item) => ({
      key: item.label,
      title: item.title,
      icon: item.icon,
      onClick: item.onClick
    })),
    toolbarActions.slice(2, 4).map((item) => ({
      key: item.label,
      title: item.title,
      icon: item.icon,
      onClick: item.onClick
    })),
    [
      ...toolbarActions.slice(4, 6).map((item) => ({
        key: item.label,
        title: item.title,
        icon: item.icon,
        onClick: item.onClick
      })),
      {
        key: 'organize-images',
        title: '整理图片（内联 base64 转文件引用）',
        icon: Images,
        onClick: () => void handleOrganizeImages()
      }
    ],
    toolbarActions.slice(6, 8).map((item) => ({
      key: item.label,
      title: item.title,
      icon: item.icon,
      onClick: item.onClick
    })),
    toolbarActions.slice(8).map((item) => ({
      key: item.label,
      title: item.title,
      icon: item.icon,
      onClick: item.onClick
    }))
  ]

  const lineCount = content.length === 0 ? 0 : content.split('\n').length
  const charCount = Array.from(content).length

  return (
    <div className={`app theme-${theme}`}>
      {clearConfirmOpen && (
        <div className="confirm-overlay" role="presentation" onClick={handleCancelClear}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-confirm-title"
            aria-describedby="clear-confirm-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-dialog-header">
              <h2 id="clear-confirm-title" className="confirm-dialog-title">新建空白文档</h2>
            </div>
            <p id="clear-confirm-desc" className="confirm-dialog-desc">
              当前文档还有未保存改动。新建后将清空当前内容，建议先保存到文件或草稿。
            </p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="action-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleCancelClear}
              >
                取消
              </button>
              <button
                type="button"
                className="action-btn action-btn-danger confirm-danger-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleConfirmClear}
              >
                确认新建
              </button>
            </div>
          </div>
        </div>
      )}

      {exportMenuOpen && (
        <div className="confirm-overlay" role="presentation" onClick={closeExportMenu}>
          <div
            className="confirm-dialog export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-dialog-title"
            aria-describedby="export-dialog-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-dialog-header export-dialog-header">
              <h2 id="export-dialog-title" className="confirm-dialog-title">选择导出格式</h2>
              <p id="export-dialog-desc" className="confirm-dialog-desc">
                当前文档将基于现有编辑内容导出为对应格式。
              </p>
            </div>
            <div className="export-menu-list">
              {exportMenuOptions.map((option) => (
                <button
                  key={option.format}
                  type="button"
                  className="export-menu-item"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void handleExportByFormat(option.format)}
                >
                  <span className="export-menu-item-title">{option.label}</span>
                  <span className="export-menu-item-desc">{option.description}</span>
                </button>
              ))}
            </div>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="action-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={closeExportMenu}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      <AiPanel
        open={aiOpen}
        ai={ai}
        selection={aiSelection}
        documentText={content}
        model={aiModel}
        onModelChange={handleAiModelChange}
        onReplaceSelection={handleAiReplaceSelection}
        onInsert={handleAiInsert}
        onCopy={handleAiCopy}
        onNotify={notification.show}
        onClose={closeAiPanel}
      />

      {bubbleAnchor && !aiOpen && createPortal(
        <AiBubble
          key={bubbleSummonKey}
          anchor={bubbleAnchor}
          ai={ai}
          model={aiModel}
          selection={bubbleSelection}
          documentText={content}
          onActivate={handleBubbleActivate}
          onReplace={handleBubbleReplace}
          onInsert={handleBubbleInsert}
          onCopy={handleAiCopy}
          onExpand={handleBubbleExpand}
          onImage={openImageGen}
          onNotify={notification.show}
          onClose={closeBubble}
          shouldKeepOpenOnTarget={shouldKeepBubbleOpenOnTarget}
        />,
        document.body
      )}

      <ImageGenDialog
        open={imageGenOpen}
        ai={ai}
        initialPrompt={imageGenPrompt}
        model={imageModel}
        history={currentImageHistory}
        onModelChange={handleImageModelChange}
        onGenerated={persistImageGeneration}
        onInsert={handleInsertGeneratedImage}
        onInsertHistory={handleInsertHistoryImage}
        onNotify={notification.show}
        onClose={closeImageGen}
      />

      {!chromeCollapsed && (
        <header className="toolbar">
          <div className="toolbar-main">
            {toolbarGroups.map((group, groupIndex) => (
              <div key={`toolbar-group-${groupIndex}`} className="toolbar-cluster">
                {group.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`action-btn action-btn-icon ${item.danger ? 'action-btn-danger' : ''}`}
                      aria-label={item.title}
                      data-tooltip={item.title}
                      title={item.title}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={item.onClick}
                      disabled={item.disabled}
                    >
                      <Icon size={15} />
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="toolbar-footer">
            <button
              type="button"
              className="mode-btn mode-btn-icon chrome-toggle-btn"
              aria-label="隐藏顶部栏"
              data-tooltip="隐藏顶部栏"
              title="隐藏顶部栏"
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleChrome}
            >
              <ChevronUp size={15} />
            </button>
          </div>
        </header>
      )}

      <main className="workspace">
        <section className="panel editor-panel">
          <div className="editor-shell">
            <div className="editor-layout">
              <aside className="editor-outline-slot">
                <div className="editor-pane-header outline-pane-header">
                  <span className="pane-header-label">大纲</span>
                </div>
                <div className="outline-panel">
                  {outlineEntries.length === 0 ? (
                    <div className="outline-empty">当前文档还没有标题</div>
                  ) : (
                    <nav className="outline-nav" aria-label="文档大纲">
                      {outlineEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          className={`outline-item outline-level-${Math.min(entry.level, 6)} ${activeOutlineId === entry.id ? 'active' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleOutlineSelect(entry)}
                          title={entry.text}
                        >
                          {entry.text}
                        </button>
                      ))}
                    </nav>
                  )}
                </div>
              </aside>
              <div className="editor-canvas">
                <div className="editor-pane-header editor-canvas-header">
                  <span className="pane-header-label">{isDirty ? '• ' : ''}{documentName}</span>
                  <div className="canvas-header-meta">
                    <span className="header-meta-text">{activeFilePath ? '文件' : '草稿'}</span>
                    <span className={`header-meta-text ${isDirty ? 'is-dirty' : ''}`}>保存时间 {formatTimestamp(savedAt)}</span>
                    <span className="header-meta-text">{lineCount} 行</span>
                    <span className="header-meta-text">{charCount} 字符</span>
                    {chromeCollapsed && (
                      <button
                        type="button"
                        className="header-meta-btn"
                        aria-label="显示功能区"
                        data-tooltip="显示功能区"
                        title="显示功能区"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={toggleChrome}
                      >
                        <ChevronDown size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <FindReplaceBar
                  open={findOpen}
                  mode={findMode}
                  query={findQuery}
                  replacement={findReplacement}
                  caseSensitive={findCaseSensitive}
                  wholeWord={findWholeWord}
                  matchCount={searchMatches.length}
                  currentIndex={findIndex}
                  onQueryChange={setFindQuery}
                  onReplacementChange={setFindReplacement}
                  onToggleCaseSensitive={() => setFindCaseSensitive((value) => !value)}
                  onToggleWholeWord={() => setFindWholeWord((value) => !value)}
                  onToggleMode={() => setFindMode((value) => (value === 'find' ? 'replace' : 'find'))}
                  onNext={handleFindNext}
                  onPrev={handleFindPrev}
                  onReplaceOne={handleReplaceOne}
                  onReplaceAll={handleReplaceAll}
                  onClose={closeFind}
                />
                <div ref={hostRef} className="editor-host">
                  <LiveMarkdownEditor
                    ref={editorRef}
                    initialValue={contentRef.current}
                    theme={theme}
                    placeholder={EDITOR_PLACEHOLDER}
                    onChange={handleEditorChange}
                    onSelectionChange={handleEditorSelection}
                    resolveImageUrl={resolveEditorImageUrl}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
