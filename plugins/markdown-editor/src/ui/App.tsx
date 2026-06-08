import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  LiveMarkdownEditor,
  type EditorSelectionInfo,
  type LiveMarkdownEditorHandle
} from './editor/LiveMarkdownEditor'
import { type CommandPayload } from './editor/markdownCommands'
import {
  ChevronDown,
  ChevronUp,
  FileDown,
  FileInput,
  FileUp,
  Redo2,
  Save,
  Sparkles,
  Undo2
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'
import { useDraftStorage } from './hooks/useDraftStorage'
import { useFileExplorer } from './hooks/useFileExplorer'
import { useTabs } from './hooks/useTabs'
import {
  applyCloseTabs,
  createBlankTab,
  deriveTabTitle,
  findTabByPath,
  makeTabId,
  moveTab,
  nextActiveTabId,
  splitClosableTabs,
  type EditorTab
} from './services/tabs'
import { normalizeSession, serializeSession, type PersistedSession } from './services/session'
import { getFsBridge, isFsBridgeAvailable } from './services/fsBridge'
import { isSameOrInside } from './services/filePath'
import { FileExplorer } from './components/FileExplorer'
import { TabBar } from './components/TabBar'
import { FindReplaceBar, type FindReplaceMode } from './components/FindReplaceBar'
import { AiPanel } from './components/AiPanel'
import { AiBubble } from './components/AiBubble'
import { ContextMenu } from './components/ContextMenu'
import { buildContextMenu, type MenuItem } from './services/contextMenu'
import { describeNodeAt, type EditorNodeContext } from './editor/nodeContext'
import {
  addColumn,
  addRow,
  parseTable,
  removeColumn,
  removeRow,
  serializeTable,
  setColumnAlign,
  type TableAlign,
  type TableData
} from './editor/tableModel'
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
import { isReasoningModel } from './services/ai'
import { requestCompletion } from './services/completion'
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
const STORAGE_SESSION_KEY = 'session:markdown-editor:v1'
const STORAGE_CHROME_KEY = 'ui:markdown-editor:chrome-collapsed:v1'
const STORAGE_AI_MODEL_KEY = 'ai:markdown-editor:model:v1'
// Inline-completion model is kept separate from the main AI model so users can
// point autocomplete at a fast, non-reasoning model (reasoning models are slow).
const STORAGE_AI_COMPLETION_MODEL_KEY = 'ai:markdown-editor:completion-model:v1'
const STORAGE_AI_IMAGE_MODEL_KEY = 'ai:markdown-editor:image-model:v1'
const STORAGE_AI_IMAGE_HISTORY_KEY = 'ai:markdown-editor:image-history:v1'
const STORAGE_LEFT_TAB_KEY = 'ui:markdown-editor:left-tab:v1'
const STORAGE_COMPLETION_KEY = 'ai:markdown-editor:inline-completion:v1'
const IMAGE_HISTORY_DIRNAME = 'gen-history'
// Auto-draft folder: untitled tabs with content are promoted to real .md files
// here so casual notes are findable in the file manager and never lost.
const DRAFTS_DIRNAME = 'drafts'

/** Compact local timestamp (YYYYMMDD-HHmmss) for fallback draft file names. */
function draftStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * Derive a draft file name from the document's first non-empty line (heading /
 * list markers stripped, illegal chars removed, truncated), falling back to a
 * timestamp. Uniqueness is handled by the fs bridge's createFile.
 */
function draftFileName(text: string): string {
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? ''
  const cleaned = firstLine
    .replace(/^#{1,6}\s*/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim()
  return `${cleaned || `未命名-${draftStamp()}`}.md`
}

/** A document offset range in the CodeMirror editor. */
interface EditorRange {
  from: number
  to: number
}
const DEFAULT_EXPORT_NAME = 'markdown-note.md'
const EDITOR_PLACEHOLDER = '在这里开始写 Markdown'
// How many chars on each side of the selection to pass as AI coherence context.
const SELECTION_CONTEXT_WINDOW = 600

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
  const [hydrated, setHydrated] = useState(false)
  const [, setSourceLabel] = useState('新草稿')
  // Tab id pending an unsaved-changes confirmation before closing (null = none).
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null)
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [leftTab, setLeftTab] = useState<'files' | 'outline'>('files')
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
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
  // Read-only context around the selection, passed to the AI surfaces so
  // polish/translate stay coherent (pronouns / terminology / tone).
  const [aiContext, setAiContext] = useState('')
  const [aiModel, setAiModel] = useState('')
  // '' means "follow the main AI model"; otherwise a dedicated inline-completion model.
  const [completionModel, setCompletionModel] = useState('')
  // modelId -> isReasoning, so inline completion can disable "thinking" on
  // reasoning models (keeps autocomplete fast). Sourced from the host's
  // models.dev-backed capabilities.
  const [modelReasoningMap, setModelReasoningMap] = useState<Record<string, boolean>>({})
  const [imageGenOpen, setImageGenOpen] = useState(false)
  const [imageGenPrompt, setImageGenPrompt] = useState('')
  const [imageModel, setImageModel] = useState('')
  // Inline AI completion (ghost text) toggle — off by default (costs tokens).
  const [completionEnabled, setCompletionEnabled] = useState(false)
  // Per-document AI image-generation history (persisted so reopening the
  // generator shows everything produced for the current document).
  const [imageHistoryMap, setImageHistoryMap] = useState<ImageHistoryMap>({})
  const [bubbleAnchor, setBubbleAnchor] = useState<BubbleRect | null>(null)
  const [bubbleSelection, setBubbleSelection] = useState('')
  const [bubbleContext, setBubbleContext] = useState('')
  // Bumped each time the bubble is summoned via shortcut so it remounts with a
  // fresh menu phase even if one was already showing.
  const [bubbleSummonKey, setBubbleSummonKey] = useState(0)
  // Right-click context menu: position + item tree. The construct under the click
  // (for link/image/table actions) is stashed in a ref so the dispatcher can read
  // its url / range / cell coordinates.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // Right-click menu for a specific tab (close / close others / close all / …).
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  // Auto-draft folder path (under userData), resolved once the fs bridge is ready.
  const [draftsDir, setDraftsDir] = useState<string | null>(null)
  const menuTargetRef = useRef<EditorNodeContext | null>(null)
  // Tab ids currently being promoted to a drafts file (guards against re-entry).
  const promotingRef = useRef<Set<string>>(new Set())
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<LiveMarkdownEditorHandle | null>(null)
  const contentRef = useRef('')
  const activeFilePathRef = useRef<string | null>(null)
  const hasInitPayloadRef = useRef(false)
  const aiOpenRef = useRef(false)
  // Mirrors completionEnabled for the once-attached contextmenu handler.
  const completionEnabledRef = useRef(false)
  const bubblePinnedRef = useRef(false)
  const bubbleRangeRef = useRef<EditorRange | null>(null)
  // Editor range captured when the image generator opens, so an inserted image
  // lands at the original caret instead of replacing the prompt selection.
  const imageRangeRef = useRef<EditorRange | null>(null)
  // Mirrors imageHistoryMap for stable reads inside callbacks (avoids stale closures).
  const imageHistoryMapRef = useRef<ImageHistoryMap>({})
  const { ai, clipboard, dialog, filesystem, notification, storage, system } = useMulby(PLUGIN_ID)
  const draftStorage = useDraftStorage(storage, STORAGE_DRAFT_KEY)

  // ---- Multi-tab document model ----
  // Each tab owns its markdown plus a CodeMirror state snapshot (history / cursor
  // / scroll). The single editor view loads the active tab's snapshot, and the
  // active tab's content drives everything downstream (outline / find / export /
  // AI / status bar). `content` / `activeFilePath` / `savedAt` are derived from
  // the active tab so the rest of App keeps using the same names.
  const { tabs, setTabs, activeTabId, setActiveTabId, tabsRef, activeTabIdRef, snapshotsRef } = useTabs()
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const content = activeTab?.content ?? ''
  const activeFilePath = activeTab?.filePath ?? null
  const savedAt = activeTab?.savedAt ?? null

  // Mirror editor edits into the active tab (drives the dirty dot + downstream).
  const setContent = useCallback(
    (value: string) => {
      setTabs((prev) => prev.map((tab) => (tab.id === activeTabIdRef.current ? { ...tab, content: value } : tab)))
    },
    [activeTabIdRef, setTabs]
  )

  // Snapshot the active tab's editor state (history / selection / scroll) and
  // sync its content mirror, so leaving and returning preserves everything.
  const snapshotActiveTab = useCallback(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }
    const fromId = activeTabIdRef.current
    const state = editor.getState()
    if (state) {
      snapshotsRef.current.set(fromId, {
        state,
        scrollTop: editor.getView()?.scrollDOM.scrollTop ?? 0
      })
    }
    const latest = editor.getValue()
    setTabs((prev) => prev.map((tab) => (tab.id === fromId ? { ...tab, content: latest } : tab)))
  }, [activeTabIdRef, setTabs, snapshotsRef])

  // Load a tab into the editor: restore its snapshot if present, otherwise build
  // a fresh state from its content (new / never-visited tabs).
  const loadTabIntoEditor = useCallback(
    (tabId: string) => {
      const editor = editorRef.current
      if (!editor) {
        return
      }
      const snap = snapshotsRef.current.get(tabId)
      if (snap) {
        editor.swapState(snap.state)
        const { scrollTop } = snap
        requestAnimationFrame(() => {
          const view = editor.getView()
          if (view) {
            view.scrollDOM.scrollTop = scrollTop
          }
        })
        return
      }
      const target = tabsRef.current.find((tab) => tab.id === tabId)
      editor.swapState(editor.createState(target?.content ?? ''))
    },
    [snapshotsRef, tabsRef]
  )

  const switchToTab = useCallback(
    (id: string) => {
      if (id === activeTabIdRef.current) {
        editorRef.current?.focus()
        return
      }
      if (!tabsRef.current.some((tab) => tab.id === id)) {
        return
      }
      snapshotActiveTab()
      setActiveTabId(id)
      loadTabIntoEditor(id)
    },
    [activeTabIdRef, loadTabIntoEditor, setActiveTabId, snapshotActiveTab, tabsRef]
  )

  // Open a file path in a tab: activate an existing tab for it, reuse a pristine
  // blank tab in place, otherwise append and activate a new tab.
  const openInTab = useCallback(
    (path: string, fileContent: string) => {
      const editor = editorRef.current
      const existing = findTabByPath(tabsRef.current, path)
      if (existing) {
        switchToTab(existing.id)
        return
      }
      const fromId = activeTabIdRef.current
      const current = tabsRef.current.find((tab) => tab.id === fromId)
      const reuseBlank =
        !!current && !current.filePath && current.content === '' && current.savedContent === ''
      if (reuseBlank) {
        snapshotsRef.current.delete(fromId)
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === fromId
              ? { ...tab, filePath: path, content: fileContent, savedContent: fileContent, savedAt: Date.now() }
              : tab
          )
        )
        editor?.swapState(editor.createState(fileContent))
        return
      }
      snapshotActiveTab()
      const tab: EditorTab = {
        id: makeTabId(),
        filePath: path,
        content: fileContent,
        savedContent: fileContent,
        savedAt: Date.now()
      }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
      editor?.swapState(editor.createState(fileContent))
    },
    [activeTabIdRef, setActiveTabId, setTabs, snapshotActiveTab, snapshotsRef, switchToTab, tabsRef]
  )

  const newUntitledTab = useCallback(() => {
    const editor = editorRef.current
    snapshotActiveTab()
    const tab = createBlankTab()
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
    editor?.swapState(editor.createState(''))
  }, [setActiveTabId, setTabs, snapshotActiveTab])

  // Remove a tab (no dirty check — callers gate that). Closing the active tab
  // activates a neighbor; closing the last tab leaves one blank untitled tab.
  const performCloseTab = useCallback(
    (id: string) => {
      const editor = editorRef.current
      const tabsNow = tabsRef.current
      if (!tabsNow.some((tab) => tab.id === id)) {
        return
      }
      snapshotsRef.current.delete(id)
      if (tabsNow.length === 1) {
        const blank = createBlankTab()
        setTabs([blank])
        setActiveTabId(blank.id)
        editor?.swapState(editor.createState(''))
        void draftStorage.clearDraft().catch(() => undefined)
        return
      }
      const wasActive = activeTabIdRef.current === id
      const nextId = nextActiveTabId(tabsNow, id, activeTabIdRef.current)
      setTabs((prev) => prev.filter((tab) => tab.id !== id))
      if (wasActive && nextId) {
        setActiveTabId(nextId)
        loadTabIntoEditor(nextId)
      }
    },
    [activeTabIdRef, draftStorage, loadTabIntoEditor, setActiveTabId, setTabs, snapshotsRef, tabsRef]
  )

  // Persist a specific tab to a path and mark it saved. Operates by tab id so it
  // never relies on which tab is active at call time (used by close-with-save).
  const writeTabToPath = useCallback(
    async (tabId: string, path: string, value: string) => {
      await filesystem.writeFile(path, value, 'utf-8')
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId
            ? { ...tab, filePath: path, content: value, savedContent: value, savedAt: Date.now() }
            : tab
        )
      )
      if (tabId === activeTabIdRef.current) {
        await draftStorage.clearDraft().catch(() => undefined)
      }
    },
    [activeTabIdRef, draftStorage, filesystem, setTabs]
  )

  // "Save" choice in the close-confirm: persist the tab (prompting for a path
  // when untitled) then close it. Cancelling the save dialog keeps the tab open.
  const saveTabAndClose = useCallback(
    async (id: string) => {
      const editor = editorRef.current
      const tab = tabsRef.current.find((item) => item.id === id)
      setCloseConfirmId(null)
      if (!tab) {
        return
      }
      const value = id === activeTabIdRef.current && editor ? editor.getValue() : tab.content
      try {
        let path = tab.filePath
        if (!path) {
          const target = await dialog.showSaveDialog({
            title: '保存 Markdown 文件',
            defaultPath: DEFAULT_EXPORT_NAME,
            buttonLabel: '保存',
            filters: [
              { name: 'Markdown', extensions: ['md', 'markdown'] },
              { name: 'Text', extensions: ['txt'] }
            ]
          })
          if (!target) {
            return
          }
          path = target
        }
        await writeTabToPath(id, path, value)
        notification.show(`已保存到 ${basename(path)}`, 'success')
        performCloseTab(id)
      } catch (error) {
        console.error('[markdown-editor] saveTabAndClose', error)
        notification.show('保存文件失败', 'error')
      }
    },
    [activeTabIdRef, dialog, notification, performCloseTab, tabsRef, writeTabToPath]
  )

  // Close request from the tab bar: confirm first when the tab has unsaved edits.
  const requestCloseTab = useCallback(
    (id: string) => {
      const editor = editorRef.current
      const tab = tabsRef.current.find((item) => item.id === id)
      if (!tab) {
        return
      }
      const live = id === activeTabIdRef.current && editor ? editor.getValue() : tab.content
      if (live !== tab.savedContent) {
        setCloseConfirmId(id)
        return
      }
      performCloseTab(id)
    },
    [activeTabIdRef, performCloseTab, tabsRef]
  )

  // Drag-to-reorder: move a tab next to a target (before/after its midpoint).
  // Order-only — active tab + snapshots stay valid, so nothing else changes.
  const reorderTabs = useCallback(
    (fromId: string, toId: string, before: boolean) => {
      setTabs((prev) => moveTab(prev, fromId, toId, before))
    },
    [setTabs]
  )

  // Ctrl/Cmd+Tab cycling: step the active tab by delta with wraparound.
  const switchRelativeTab = useCallback(
    (delta: number) => {
      const list = tabsRef.current
      if (list.length < 2) {
        return
      }
      const index = list.findIndex((tab) => tab.id === activeTabIdRef.current)
      const nextIndex = (((index < 0 ? 0 : index) + delta) % list.length + list.length) % list.length
      switchToTab(list[nextIndex].id)
    },
    [activeTabIdRef, switchToTab, tabsRef]
  )

  // Close a set of tabs at once (close-others / close-all). Dirty tabs are kept
  // open so a batch close never silently discards unsaved work; the rest close
  // and a surviving tab is activated (a fresh blank tab when none remain).
  const closeTabSet = useCallback(
    (ids: string[], preferActiveId?: string) => {
      const editor = editorRef.current
      const activeId = activeTabIdRef.current
      const live = editor?.getValue()
      // Patch the active tab's live content so its dirty check is accurate.
      const effective = tabsRef.current.map((tab) =>
        tab.id === activeId && live != null ? { ...tab, content: live } : tab
      )
      const { closable, dirty } = splitClosableTabs(effective, ids)
      if (closable.length === 0) {
        if (dirty.length > 0) {
          notification.show('有未保存改动的标签未关闭', 'info')
        }
        return
      }
      closable.forEach((id) => snapshotsRef.current.delete(id))
      const { remaining, nextActiveId } = applyCloseTabs(effective, closable, activeId, preferActiveId)
      if (nextActiveId == null) {
        const blank = createBlankTab()
        setTabs([blank])
        setActiveTabId(blank.id)
        editor?.swapState(editor.createState(''))
        void draftStorage.clearDraft().catch(() => undefined)
      } else {
        setTabs(remaining)
        if (nextActiveId !== activeId) {
          setActiveTabId(nextActiveId)
          loadTabIntoEditor(nextActiveId)
        }
      }
      if (dirty.length > 0) {
        notification.show(`已关闭 ${closable.length} 个，${dirty.length} 个有未保存改动已保留`, 'info')
      }
    },
    [activeTabIdRef, draftStorage, loadTabIntoEditor, notification, setActiveTabId, setTabs, snapshotsRef, tabsRef]
  )

  const closeOtherTabs = useCallback(
    (keepId: string) => {
      const ids = tabsRef.current.filter((tab) => tab.id !== keepId).map((tab) => tab.id)
      if (ids.length === 0) {
        return
      }
      closeTabSet(ids, keepId)
    },
    [closeTabSet, tabsRef]
  )

  const closeAllTabs = useCallback(() => {
    closeTabSet(tabsRef.current.map((tab) => tab.id))
  }, [closeTabSet, tabsRef])

  // Keep open tabs in sync when the tree renames/deletes their file.
  const handleFilePathRenamed = useCallback(
    (oldPath: string, newPath: string) => {
      setTabs((prev) => prev.map((tab) => (tab.filePath === oldPath ? { ...tab, filePath: newPath } : tab)))
      setSourceLabel(`已重命名 ${basename(newPath)}`)
    },
    [setTabs]
  )
  const handleFilePathDeleted = useCallback(
    (path: string) => {
      const victim = tabsRef.current.find((tab) => tab.filePath === path)
      if (victim) {
        performCloseTab(victim.id)
      }
      setSourceLabel('文件已删除')
    },
    [performCloseTab, tabsRef]
  )
  const explorer = useFileExplorer({
    storage,
    dialog,
    notification,
    clipboard,
    pinnedRoot: draftsDir,
    onFileRenamed: handleFilePathRenamed,
    onFileDeleted: handleFilePathDeleted
  })

  contentRef.current = content
  activeFilePathRef.current = activeFilePath
  aiOpenRef.current = aiOpen
  completionEnabledRef.current = completionEnabled
  imageHistoryMapRef.current = imageHistoryMap

  // Resolve + create the auto-draft folder under userData once the fs bridge is
  // ready, so untitled tabs can be promoted to real files there.
  useEffect(() => {
    if (!isFsBridgeAvailable()) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const userData = await system.getPath('userData')
        if (!userData || cancelled) {
          return
        }
        const dir = `${userData.replace(/[/\\]+$/, '')}/${PLUGIN_ID}/${DRAFTS_DIRNAME}`
        await getFsBridge().mkdir(dir)
        if (!cancelled) {
          setDraftsDir(dir)
        }
      } catch (error) {
        console.error('[markdown-editor] draftsDir', error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [system])

  // Auto-draft: promote the active untitled tab (once it has real content) into a
  // real .md in the drafts folder, then keep that draft file in sync on disk as
  // the user edits. Only drafts auto-save; user-folder files still need a save.
  const syncActiveDraft = useCallback(async () => {
    const dir = draftsDir
    if (!dir || !isFsBridgeAvailable()) {
      return
    }
    const editor = editorRef.current
    const activeId = activeTabIdRef.current
    const tab = tabsRef.current.find((item) => item.id === activeId)
    if (!tab) {
      return
    }
    const text = editor?.getValue() ?? tab.content
    if (!tab.filePath) {
      if (!text.trim() || promotingRef.current.has(tab.id)) {
        return
      }
      promotingRef.current.add(tab.id)
      try {
        const path = await getFsBridge().createFile(dir, draftFileName(text), text)
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tab.id ? { ...item, filePath: path, savedContent: text, savedAt: Date.now() } : item
          )
        )
        void explorer.revealPath(path)
      } catch (error) {
        console.error('[markdown-editor] promote draft', error)
      } finally {
        promotingRef.current.delete(tab.id)
      }
      return
    }
    // Keep an already-promoted draft file current on disk as the user edits.
    if (isSameOrInside(dir, tab.filePath) && text !== tab.savedContent) {
      try {
        await getFsBridge().writeText(tab.filePath, text)
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tab.id ? { ...item, savedContent: text, savedAt: Date.now() } : item
          )
        )
      } catch (error) {
        console.error('[markdown-editor] sync draft', error)
      }
    }
  }, [activeTabIdRef, draftsDir, explorer, setTabs, tabsRef])

  // Debounced draft sync (runs after the session autosave tick).
  useEffect(() => {
    if (!hydrated || hasInitPayloadRef.current || !draftsDir) {
      return
    }
    const timer = window.setTimeout(() => {
      void syncActiveDraft()
    }, 1200)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeTabId, content, draftsDir, hydrated, syncActiveDraft])

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
      // Load the selection into the active tab (untitled, dirty so it can be saved).
      startTransition(() => {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabIdRef.current
              ? { ...tab, filePath: null, content: incoming, savedContent: '', savedAt: null }
              : tab
          )
        )
      })
    })

    let cancelled = false

    // Rebuild tabs from a persisted session: clean file tabs reload from disk;
    // untitled / dirty tabs restore their stored content (unsaved work kept).
    async function restoreSessionTabs(session: PersistedSession) {
      const built = await Promise.all(
        session.tabs.map(async (pt): Promise<EditorTab | null> => {
          if (pt.filePath) {
            let disk: string | null = null
            try {
              disk = isFsBridgeAvailable()
                ? await getFsBridge().readText(pt.filePath)
                : await readFileAsUtf8(filesystem.readFile, pt.filePath)
            } catch {
              disk = null
            }
            if (pt.content == null) {
              // Was clean → reload from disk; skip the tab if the file is gone.
              if (disk == null) {
                return null
              }
              return { id: makeTabId(), filePath: pt.filePath, content: disk, savedContent: disk, savedAt: pt.savedAt }
            }
            // Was dirty → keep edits; refresh the baseline from disk if readable.
            const savedContent = disk ?? pt.savedContent ?? ''
            return { id: makeTabId(), filePath: pt.filePath, content: pt.content, savedContent, savedAt: pt.savedAt }
          }
          // Untitled tab → restore its content.
          const content = pt.content ?? ''
          return { id: makeTabId(), filePath: null, content, savedContent: pt.savedContent ?? '', savedAt: pt.savedAt }
        })
      )
      const restored = built.filter((tab): tab is EditorTab => tab !== null)
      if (restored.length === 0) {
        return null
      }
      const activeIndex = Math.min(session.activeIndex, restored.length - 1)
      return { tabs: restored, activeIndex }
    }

    async function loadSession() {
      try {
        const [
          sessionRaw,
          draft,
          collapsedValue,
          savedModel,
          savedImageModel,
          savedImageHistory,
          savedLeftTab,
          savedCompletion,
          savedCompletionModel
        ] = await Promise.all([
          storage.get(STORAGE_SESSION_KEY),
          draftStorage.loadDraft(),
          storage.get(STORAGE_CHROME_KEY),
          storage.get(STORAGE_AI_MODEL_KEY),
          storage.get(STORAGE_AI_IMAGE_MODEL_KEY),
          storage.get(STORAGE_AI_IMAGE_HISTORY_KEY),
          storage.get(STORAGE_LEFT_TAB_KEY),
          storage.get(STORAGE_COMPLETION_KEY),
          storage.get(STORAGE_AI_COMPLETION_MODEL_KEY)
        ])

        if (!cancelled) {
          setChromeCollapsed(collapsedValue === true)
          setCompletionEnabled(savedCompletion === true)
          if (savedLeftTab === 'files' || savedLeftTab === 'outline') {
            setLeftTab(savedLeftTab)
          }
          if (typeof savedModel === 'string') {
            setAiModel(savedModel)
          }
          if (typeof savedCompletionModel === 'string') {
            setCompletionModel(savedCompletionModel)
          }
          if (typeof savedImageModel === 'string') {
            setImageModel(savedImageModel)
          }
          setImageHistoryMap(normalizeHistoryMap(savedImageHistory))
        }

        // A 划词 (edit-selection) launch owns the active tab; don't restore over it.
        if (cancelled || hasInitPayloadRef.current) {
          return
        }

        const session = normalizeSession(sessionRaw)
        if (session) {
          const restored = await restoreSessionTabs(session)
          if (!cancelled && restored) {
            setTabs(restored.tabs)
            const active = restored.tabs[restored.activeIndex] ?? restored.tabs[0]
            setActiveTabId(active.id)
            // Seed the editor with the active tab's content + a clean history.
            editorRef.current?.setValue(active.content, { resetHistory: true })
            setSourceLabel('已恢复上次会话')
            return
          }
        }

        // Legacy single-draft fallback (users upgrading from the pre-session build).
        if (!cancelled && draft) {
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTabIdRef.current
                ? { ...tab, content: draft.content, savedContent: draft.content, savedAt: draft.updatedAt }
                : tab
            )
          )
          editorRef.current?.setValue(draft.content, { resetHistory: true })
          setSourceLabel('已恢复上次草稿')
        }
      } finally {
        if (!cancelled) {
          setHydrated(true)
        }
      }
    }

    void loadSession()

    return () => {
      cancelled = true
    }
  }, [activeTabIdRef, draftStorage, filesystem, setActiveTabId, setTabs, storage])

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

  // Editor edits flow up into the active tab as the markdown source of truth.
  const handleEditorChange = useCallback((value: string) => {
    setContent(value)
  }, [setContent])

  // Reads the text surrounding a selection range (defaults to the live editor
  // selection) so polish/translate get coherence context — pronouns, terminology
  // and tone. Returns '' for a collapsed / empty selection.
  const readSelectionContext = useCallback((range?: { from: number; to: number }): string => {
    const editor = editorRef.current
    if (!editor) {
      return ''
    }
    let from = range?.from
    let to = range?.to
    if (from == null || to == null) {
      try {
        const sel = editor.getSelection()
        from = sel.from
        to = sel.to
      } catch {
        return ''
      }
    }
    if (from === to) {
      return ''
    }
    const doc = editor.getValue()
    const before = doc.slice(Math.max(0, from - SELECTION_CONTEXT_WINDOW), from)
    const after = doc.slice(to, to + SELECTION_CONTEXT_WINDOW)
    const ctx = `${before}【选中片段】${after}`.trim()
    return ctx === '【选中片段】' ? '' : ctx
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
    setBubbleContext(readSelectionContext({ from: info.from, to: info.to }))
    setBubbleAnchor(rect)
  }, [readSelectionContext])

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

  const isDirty = hydrated && content !== (activeTab?.savedContent ?? '')

  // Persist the whole open-tab set (+ active tab) so reopening restores the
  // session. Captures the active tab's latest editor value at write time.
  const saveSession = useCallback(async () => {
    const editor = editorRef.current
    const activeContent = editor?.getValue()
    const snapshot = tabsRef.current.map((tab) =>
      tab.id === activeTabIdRef.current && activeContent != null ? { ...tab, content: activeContent } : tab
    )
    try {
      await storage.set(STORAGE_SESSION_KEY, serializeSession(snapshot, activeTabIdRef.current))
    } catch (error) {
      console.error('[markdown-editor] saveSession', error)
    }
  }, [activeTabIdRef, storage, tabsRef])

  const persistDraft = useCallback(async (showToast: boolean) => {
    try {
      const current = editorRef.current?.getValue() ?? contentRef.current
      // Mark the active tab saved (clears the dirty dot) and flush the session.
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabIdRef.current
            ? { ...tab, content: current, savedContent: current, savedAt: Date.now() }
            : tab
        )
      )
      await saveSession()
      // The session supersedes the legacy single-draft key; drop it so it never
      // double-restores for users upgrading from the pre-session build.
      await draftStorage.clearDraft().catch(() => undefined)
      if (showToast) {
        notification.show('草稿已保存', 'success')
      }
    } catch (error) {
      console.error('[markdown-editor] persistDraft', error)
      notification.show('保存草稿失败', 'error')
    } finally {
      focusEditor()
    }
  }, [activeTabIdRef, draftStorage, focusEditor, notification, saveSession, setTabs])

  // Debounced session autosave: any tab edit / open / close / switch persists the
  // full session (crash recovery for every untitled tab, not just one draft).
  // Skipped during a 划词 (edit-selection) launch so it never clobbers the saved
  // session with a throwaway tab.
  useEffect(() => {
    if (!hydrated || hasInitPayloadRef.current) {
      return
    }
    const timer = window.setTimeout(() => {
      void saveSession()
    }, 600)
    return () => {
      window.clearTimeout(timer)
    }
  }, [activeTabId, hydrated, saveSession, tabs])

  // Best-effort flush when the window hides / unloads so edits made in the last
  // debounce window aren't lost.
  useEffect(() => {
    if (!hydrated || hasInitPayloadRef.current) {
      return
    }
    const flush = () => {
      void saveSession()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [hydrated, saveSession])

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
      setSourceLabel(`载入 ${basename(path)}`)
      openInTab(path, fileContent)
      explorer.noteRecentFile(path)
      notification.show('文件已载入', 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleOpenFile', error)
      notification.show('读取文件失败', 'error')
    }
  }, [dialog, explorer, filesystem, focusEditor, notification, openInTab])

  // Open a file by path (from the file tree / recent list). Reads through the
  // preload fs bridge so paths that never came from a native dialog are readable
  // (the renderer's window.mulby.filesystem is sandboxed for such paths).
  const openFileFromPath = useCallback(
    async (path: string) => {
      try {
        const fileContent = isFsBridgeAvailable()
          ? await getFsBridge().readText(path)
          : await readFileAsUtf8(filesystem.readFile, path)
        setSourceLabel(`载入 ${basename(path)}`)
        openInTab(path, fileContent)
        explorer.noteRecentFile(path)
        void explorer.revealPath(path)
        notification.show('文件已载入', 'success')
        focusEditor()
      } catch (error) {
        console.error('[markdown-editor] openFileFromPath', error)
        notification.show('读取文件失败', 'error')
      }
    },
    [explorer, filesystem, focusEditor, notification, openInTab]
  )

  const selectLeftTab = useCallback(
    (tab: 'files' | 'outline') => {
      setLeftTab(tab)
      void storage.set(STORAGE_LEFT_TAB_KEY, tab).catch(() => undefined)
    },
    [storage]
  )

  const writeToFile = useCallback(async (path: string) => {
    const current = editorRef.current?.getValue() ?? contentRef.current
    await filesystem.writeFile(path, current, 'utf-8')
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabIdRef.current
          ? { ...tab, filePath: path, content: current, savedContent: current, savedAt: Date.now() }
          : tab
      )
    )
    setSourceLabel(`已保存 ${basename(path)}`)
    // The file is now the source of truth; clear the recovery draft.
    await draftStorage.clearDraft().catch(() => undefined)
  }, [activeTabIdRef, draftStorage, filesystem, setTabs])

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
    setAiContext(readSelectionContext())
    setAiOpen(true)
    // Dismiss the floating bubble so the two AI surfaces never overlap. Inlined
    // (not via closeBubble) to avoid a forward reference / TDZ at definition time.
    bubblePinnedRef.current = false
    bubbleRangeRef.current = null
    setBubbleAnchor(null)
  }, [readSelectionContext])

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
      // Tab management shortcuts (global, regardless of focus).
      if (key === 't' && !event.shiftKey) {
        event.preventDefault()
        newUntitledTab()
        return
      }
      if (key === 'w') {
        event.preventDefault()
        requestCloseTab(activeTabIdRef.current)
        return
      }
      // Cycle tabs. Ctrl/Cmd+Tab is swallowed by the OS, and plain Ctrl/Cmd+Arrow
      // is the editor's caret navigation (line/doc start-end, word jump), so use
      // PageUp/PageDown (universal) plus Alt+Arrow (Mac-style; the Alt keeps it off
      // the caret shortcuts). Shift mirrors PageUp/Down for keyboards without them.
      if (key === 'pageup' || (event.altKey && key === 'arrowleft')) {
        event.preventDefault()
        switchRelativeTab(-1)
        return
      }
      if (key === 'pagedown' || (event.altKey && key === 'arrowright')) {
        event.preventDefault()
        switchRelativeTab(1)
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
  }, [activeTabIdRef, handleRedo, handleSaveFile, handleSaveFileAs, handleUndo, newUntitledTab, openAiPanel, openFind, persistDraft, requestCloseTab, switchRelativeTab])

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

  // Inlines every <img> in the export HTML as a data URL so renderers without a
  // base path / file access (the headless PDF browser, or an HTML file opened
  // elsewhere) still show images. Relative paths anchor to the bound document
  // directory; already-inline (data:) and unresolvable images are left as-is.
  const inlineExportImages = useCallback(async (html: string): Promise<string> => {
    const boundPath = activeFilePathRef.current
    const baseDir = boundPath ? getDirectory(boundPath) : ''
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const images = Array.from(doc.querySelectorAll('img'))
    await Promise.all(
      images.map(async (img) => {
        const src = img.getAttribute('src') ?? ''
        if (!src || src.startsWith('data:')) {
          return
        }
        const href = resolveImageHref(src, baseDir)
        if (!href) {
          return
        }
        try {
          const loaded = await loadImageForExport(href)
          if (loaded) {
            img.setAttribute('src', buildDataUrl(loaded.data, 'image/png'))
          }
        } catch (error) {
          console.error('[markdown-editor] inlineExportImages', error)
        }
      })
    )
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
  }, [])

  // Writes export HTML to a temp file under userData and returns its file:// URL.
  // PDF export loads this instead of a data: URL, which overflows Chromium's
  // navigation URL length limit once images are inlined as data URLs.
  const prepareExportPageUrl = useCallback(
    async (html: string): Promise<string> => {
      const userData = await system.getPath('userData')
      const dir = `${userData.replace(/[/\\]+$/, '')}/${PLUGIN_ID}`
      await filesystem.mkdir(dir)
      const filePath = `${dir}/.pdf-export.html`
      await filesystem.writeFile(filePath, html, 'utf-8')
      return toFileUrl(filePath)
    },
    [filesystem, system]
  )

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
        // Exporting Markdown is effectively "save as .md": bind the active tab to
        // the new path so it's no longer dirty. Other formats don't rebind (the
        // tab keeps editing the original Markdown document).
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabIdRef.current
              ? { ...tab, filePath: target, savedContent: exportDocument.markdown, savedAt: Date.now() }
              : tab
          )
        )
      } else if (format === 'html') {
        const inlinedHtml = await inlineExportImages(exportDocument.fullHtml)
        await exportHtmlFile({ ...exportDocument, fullHtml: inlinedHtml }, target, filesystem)
      } else if (format === 'pdf') {
        const inlinedHtml = await inlineExportImages(exportDocument.fullHtml)
        let pageUrl: string | undefined
        try {
          pageUrl = await prepareExportPageUrl(inlinedHtml)
        } catch (error) {
          // Fall back to the data: URL (works for small docs without images).
          console.error('[markdown-editor] prepareExportPageUrl', error)
          pageUrl = undefined
        }
        await exportPdfFile({ ...exportDocument, fullHtml: inlinedHtml }, target, pageUrl)
      } else {
        await exportDocxFile(exportDocument, target, filesystem, resolveExportImage)
      }

      setExportMenuOpen(false)
      notification.show(`已导出到 ${basename(target)}`, 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleExportByFormat', error)
      setExportMenuOpen(false)
      notification.show('导出文件失败', 'error')
      focusEditor()
    }
  }, [activeFilePath, activeTabIdRef, closeExportMenu, dialog, filesystem, focusEditor, getCurrentExportDocument, inlineExportImages, notification, prepareExportPageUrl, resolveExportImage, setTabs])

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

  const handleCompletionModelChange = useCallback((model: string) => {
    setCompletionModel(model)
    void storage.set(STORAGE_AI_COMPLETION_MODEL_KEY, model).catch(() => undefined)
  }, [storage])

  // Load model capabilities once so inline completion can detect reasoning models
  // (to disable their "thinking" and keep autocomplete fast).
  useEffect(() => {
    if (!ai.allModels) {
      return
    }
    let cancelled = false
    void ai
      .allModels()
      .then((list) => {
        if (cancelled || !Array.isArray(list)) {
          return
        }
        const map: Record<string, boolean> = {}
        for (const item of list) {
          if (item?.id) {
            map[item.id] = isReasoningModel(item)
          }
        }
        setModelReasoningMap(map)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [ai])

  // Fetches an inline ghost-text completion using the current AI model. Forwards
  // streaming partials so the ghost text grows as it generates.
  // Inline completion uses its own model when set, falling back to the main AI
  // model — so users can point autocomplete at a fast, non-reasoning model. If a
  // reasoning model is used anyway, disable its "thinking" so it stays responsive.
  const requestInlineCompletion = useCallback(
    (prefix: string, suffix: string, signal: AbortSignal, onPartial?: (text: string) => void) => {
      const model = completionModel || aiModel || undefined
      const reasoning = model ? modelReasoningMap[model] === true : false
      return requestCompletion(
        ai,
        model,
        prefix,
        suffix,
        signal,
        onPartial,
        reasoning ? { thinking: 'disabled' } : undefined
      )
    },
    [ai, completionModel, aiModel, modelReasoningMap]
  )

  const toggleInlineCompletion = useCallback(() => {
    setCompletionEnabled((prev) => {
      const next = !prev
      void storage.set(STORAGE_COMPLETION_KEY, next).catch(() => undefined)
      notification.show(next ? '已开启行内 AI 补全（停顿后给灰色建议，Tab 接受）' : '已关闭行内 AI 补全', 'info')
      return next
    })
    focusEditor()
  }, [focusEditor, notification, storage])

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
    setAiContext(readSelectionContext())
    setAiOpen(true)
    closeBubble()
  }, [closeBubble, readSelectionContext])

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
    setBubbleContext(text ? readSelectionContext() : '')
    setBubbleAnchor(rect)
    setBubbleSummonKey((key) => key + 1)
  }, [readSelectionContext])

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

  // Close-tab confirmation (unsaved changes): keep / discard / save-then-close.
  const handleCancelCloseTab = useCallback(() => {
    setCloseConfirmId(null)
    focusEditor()
  }, [focusEditor])

  const handleDiscardCloseTab = useCallback(() => {
    const id = closeConfirmId
    setCloseConfirmId(null)
    if (id) {
      performCloseTab(id)
    }
  }, [closeConfirmId, performCloseTab])

  const handleSaveCloseTab = useCallback(() => {
    const id = closeConfirmId
    if (id) {
      void saveTabAndClose(id)
    }
  }, [closeConfirmId, saveTabAndClose])

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

  // ---- Right-click context menu ----
  // Applies a structural table edit (from a context-menu action) by reading the
  // table source from the stashed range, mutating the parsed model, and writing
  // it back. `row` is -1 for the header row.
  const applyTableEdit = useCallback(
    (target: EditorNodeContext | null, mutate: (table: TableData, row: number, col: number) => TableData) => {
      const view = editorRef.current?.getView()
      if (!view || !target || target.kind !== 'table') {
        return
      }
      const src = view.state.doc.sliceString(target.from, target.to)
      const parsed = parseTable(src)
      if (!parsed) {
        return
      }
      const insert = serializeTable(mutate(parsed, target.row, target.col))
      if (insert !== src) {
        view.dispatch({ changes: { from: target.from, to: target.to, insert } })
      }
      editorRef.current?.focus()
    },
    []
  )

  const handleMenuSelect = useCallback(
    (id: string) => {
      const editor = editorRef.current
      const view = editor?.getView()
      if (!editor || !view) {
        return
      }
      const target = menuTargetRef.current
      const openUrl = (url: string) => {
        if (!url) {
          return
        }
        const shell = (window as unknown as { mulby?: { shell?: { openExternal?: (u: string) => unknown } } })
          .mulby?.shell
        if (shell?.openExternal) {
          void shell.openExternal(url)
        } else {
          window.open(url, '_blank', 'noopener')
        }
      }
      switch (id) {
        case 'cut': {
          const text = editor.getSelectedText()
          if (text) {
            void clipboard.writeText(text)
            editor.replaceSelection('')
          }
          break
        }
        case 'copy': {
          const text = editor.getSelectedText()
          if (text) {
            void clipboard.writeText(text)
          }
          break
        }
        case 'paste':
          void handlePasteClipboard()
          break
        case 'fmt-bold':
          execCommand('bold')
          break
        case 'fmt-italic':
          execCommand('italic')
          break
        case 'fmt-strike':
          execCommand('strike')
          break
        case 'fmt-code':
          execCommand('code')
          break
        case 'fmt-highlight':
          execCommand('highlight')
          break
        case 'cv-h1':
          execCommand('heading', { level: 1 })
          break
        case 'cv-h2':
        case 'ins-h2':
          execCommand('heading', { level: 2 })
          break
        case 'cv-h3':
          execCommand('heading', { level: 3 })
          break
        case 'cv-quote':
        case 'ins-quote':
          execCommand('blockQuote')
          break
        case 'cv-ul':
        case 'ins-ul':
          execCommand('bulletList')
          break
        case 'cv-ol':
        case 'ins-ol':
          execCommand('orderedList')
          break
        case 'cv-task':
        case 'ins-task':
          execCommand('taskList')
          break
        case 'cv-codeblock': {
          const text = editor.getSelectedText()
          editor.replaceSelection('```\n' + text + '\n```')
          break
        }
        case 'make-link':
        case 'ins-link':
          handleInsertLink()
          break
        case 'ins-codeblock': {
          const { from } = editor.getSelection()
          editor.insertText('```\n\n```')
          editor.setSelection(from + 4, from + 4)
          editor.focus()
          break
        }
        case 'ins-table':
          editor.insertText('\n| 列1 | 列2 |\n| --- | --- |\n| 内容 | 内容 |\n')
          editor.focus()
          break
        case 'ins-hr':
          execCommand('hr')
          break
        case 'ins-image':
          void handleInsertImage()
          break
        case 'ins-math': {
          const { from } = editor.getSelection()
          editor.insertText('$$\n\n$$')
          editor.setSelection(from + 3, from + 3)
          editor.focus()
          break
        }
        case 'ai':
          summonBubble()
          break
        case 'ai-image':
          openImageGen('')
          break
        case 'organize-images':
          void handleOrganizeImages()
          break
        case 'toggle-completion':
          toggleInlineCompletion()
          break
        case 'find':
          openFind('find')
          break
        case 'replace':
          openFind('replace')
          break
        case 'select-all': {
          const len = editor.getValue().length
          editor.setSelection(0, len)
          editor.focus()
          break
        }
        case 'link-open':
          if (target?.kind === 'link') {
            openUrl(target.url)
          }
          break
        case 'link-copy':
          if (target?.kind === 'link' && target.url) {
            void clipboard.writeText(target.url)
          }
          break
        case 'link-edit':
          if (target?.kind === 'link') {
            editor.setSelection(target.from, target.to)
            editor.focus()
          }
          break
        case 'link-unlink':
          if (target?.kind === 'link') {
            const src = view.state.doc.sliceString(target.from, target.to)
            const match = /^\[([^\]]*)\]/.exec(src)
            view.dispatch({ changes: { from: target.from, to: target.to, insert: match ? match[1] : src } })
            editor.focus()
          }
          break
        case 'image-copy':
          if (target?.kind === 'image' && target.url) {
            void clipboard.writeText(target.url)
          }
          break
        case 'image-open':
          if (target?.kind === 'image') {
            openUrl(target.url)
          }
          break
        case 'image-remove':
          if (target?.kind === 'image') {
            view.dispatch({ changes: { from: target.from, to: target.to, insert: '' } })
            editor.focus()
          }
          break
        case 'table-row-above':
          applyTableEdit(target, (table, row) => addRow(table, Math.max(0, row)))
          break
        case 'table-row-below':
          applyTableEdit(target, (table, row) => addRow(table, row < 0 ? 0 : row + 1))
          break
        case 'table-row-del':
          applyTableEdit(target, (table, row) => (row < 0 ? table : removeRow(table, row)))
          break
        case 'table-col-left':
          applyTableEdit(target, (table, _row, col) => addColumn(table, col))
          break
        case 'table-col-right':
          applyTableEdit(target, (table, _row, col) => addColumn(table, col + 1))
          break
        case 'table-col-del':
          applyTableEdit(target, (table, _row, col) => removeColumn(table, col))
          break
        case 'table-align-none':
        case 'table-align-left':
        case 'table-align-center':
        case 'table-align-right':
          applyTableEdit(target, (table, _row, col) =>
            setColumnAlign(table, col, id.replace('table-align-', '') as TableAlign)
          )
          break
        default:
          break
      }
    },
    [applyTableEdit, clipboard, execCommand, handleInsertImage, handleInsertLink, handleOrganizeImages, handlePasteClipboard, openFind, openImageGen, summonBubble, toggleInlineCompletion]
  )

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // ---- Tab right-click menu ----
  const openTabMenu = useCallback((id: string, x: number, y: number) => {
    setContextMenu(null)
    setTabMenu({ x, y, tabId: id })
  }, [])

  const closeTabMenu = useCallback(() => setTabMenu(null), [])

  const handleTabMenuSelect = useCallback(
    (actionId: string) => {
      const id = tabMenu?.tabId
      if (!id) {
        return
      }
      const tab = tabsRef.current.find((item) => item.id === id)
      switch (actionId) {
        case 'tab-close':
          requestCloseTab(id)
          break
        case 'tab-close-others':
          closeOtherTabs(id)
          break
        case 'tab-close-all':
          closeAllTabs()
          break
        case 'tab-copy-path':
          if (tab?.filePath) {
            void clipboard
              .writeText(tab.filePath)
              .then(() => notification.show('已复制路径', 'success'))
              .catch(() => notification.show('复制失败', 'error'))
          }
          break
        case 'tab-reveal':
          if (tab?.filePath) {
            selectLeftTab('files')
            void explorer.revealPath(tab.filePath)
          }
          break
        default:
          break
      }
    },
    [clipboard, closeAllTabs, closeOtherTabs, explorer, notification, requestCloseTab, selectLeftTab, tabMenu, tabsRef]
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }
    const onContextMenu = (event: MouseEvent) => {
      const editor = editorRef.current
      const view = editor?.getView()
      if (!editor || !view) {
        return
      }
      event.preventDefault()
      const targetEl = event.target as HTMLElement
      let pos: number | null = null
      try {
        pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      } catch {
        pos = null
      }
      if (pos == null) {
        try {
          pos = view.posAtDOM(targetEl)
        } catch {
          pos = null
        }
      }
      if (pos == null) {
        pos = view.state.selection.main.head
      }
      let node: EditorNodeContext = { kind: 'text' }
      try {
        node = describeNodeAt(view, targetEl, pos)
      } catch {
        node = { kind: 'text' }
      }
      const hasSelection = editor.getSelectedText().length > 0
      // No selection on plain text: move the caret to the click point so
      // paste / insert target where the user clicked (standard editor behavior).
      if (!hasSelection && node.kind === 'text') {
        editor.setSelection(pos, pos)
      }
      menuTargetRef.current = node
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: buildContextMenu({
          hasSelection,
          node: node.kind === 'text' ? null : node.kind,
          tableHeader: node.kind === 'table' ? node.header : undefined,
          completionEnabled: completionEnabledRef.current
        })
      })
    }
    host.addEventListener('contextmenu', onContextMenu)
    return () => host.removeEventListener('contextmenu', onContextMenu)
  }, [])

  const exportMenuOptions: Array<{ format: ExportFormat; label: string; description: string }> = [
    { format: 'markdown', label: 'Markdown (.md)', description: '导出原始 Markdown 内容' },
    { format: 'html', label: 'HTML (.html)', description: '导出可在浏览器中打开的网页文档' },
    { format: 'pdf', label: 'PDF (.pdf)', description: '导出排版固定的打印版文档' },
    { format: 'docx', label: 'Word (.docx)', description: '导出可在 Word / WPS 中编辑的文档' }
  ]

  // Slim toolbar: only file-level ops + undo/redo + AI, which have no good home
  // elsewhere. Markdown formatting / insert / clipboard live in the right-click
  // menu (and direct typing), the tab bar has its own ＋, and 整理图片 / AI 生图
  // moved into the right-click menu.
  const toolbarGroups: ToolbarButtonItem[][] = [
    [
      { key: 'undo', title: '撤销 (Ctrl/Cmd+Z)', icon: Undo2, onClick: handleUndo },
      { key: 'redo', title: '重做 (Ctrl/Cmd+Shift+Z)', icon: Redo2, onClick: handleRedo }
    ],
    [
      { key: 'open', title: '打开文件', icon: FileInput, onClick: handleOpenFile },
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
        key: 'export',
        title: '导出文件（Markdown / HTML / PDF / Word）',
        icon: FileDown,
        onClick: handleOpenExportMenu
      }
    ],
    [
      {
        key: 'ai',
        title: 'AI 助手（润色/续写/翻译/总结，Ctrl/Cmd+K）',
        icon: Sparkles,
        onClick: openAiPanel
      }
    ]
  ]

  const lineCount = content.length === 0 ? 0 : content.split('\n').length
  const charCount = Array.from(content).length

  return (
    <div className={`app theme-${theme}`}>
      {closeConfirmId && (
        <div className="confirm-overlay" role="presentation" onClick={handleCancelCloseTab}>
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="close-confirm-title"
            aria-describedby="close-confirm-desc"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="confirm-dialog-header">
              <h2 id="close-confirm-title" className="confirm-dialog-title">关闭未保存的标签</h2>
            </div>
            <p id="close-confirm-desc" className="confirm-dialog-desc">
              「{deriveTabTitle(tabs.find((tab) => tab.id === closeConfirmId) ?? { filePath: null })}」
              还有未保存的改动。关闭前是否保存？
            </p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="action-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleCancelCloseTab}
              >
                取消
              </button>
              <button
                type="button"
                className="action-btn action-btn-danger confirm-danger-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleDiscardCloseTab}
              >
                不保存
              </button>
              <button
                type="button"
                className="action-btn action-btn-primary"
                onMouseDown={(event) => event.preventDefault()}
                onClick={handleSaveCloseTab}
              >
                保存
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
        contextText={aiContext}
        model={aiModel}
        onModelChange={handleAiModelChange}
        completionModel={completionModel}
        onCompletionModelChange={handleCompletionModelChange}
        completionEnabled={completionEnabled}
        onToggleCompletion={toggleInlineCompletion}
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
          contextText={bubbleContext}
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onSelect={handleMenuSelect}
          onClose={closeContextMenu}
        />
      )}

      {tabMenu && (
        <ContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          items={(() => {
            const tab = tabs.find((item) => item.id === tabMenu.tabId)
            const items: MenuItem[] = [
              { id: 'tab-close', label: '关闭', shortcut: '⌘W' },
              { id: 'tab-close-others', label: '关闭其他', disabled: tabs.length <= 1 },
              { id: 'tab-close-all', label: '关闭全部' }
            ]
            if (tab?.filePath) {
              items.push(
                { id: 'sep-tab', separator: true },
                { id: 'tab-copy-path', label: '复制路径' },
                { id: 'tab-reveal', label: '在文件树中显示' }
              )
            }
            return items
          })()}
          onSelect={handleTabMenuSelect}
          onClose={closeTabMenu}
        />
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
                <div className="editor-pane-header sidebar-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={leftTab === 'files'}
                    className={`sidebar-tab ${leftTab === 'files' ? 'active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectLeftTab('files')}
                  >
                    文件
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={leftTab === 'outline'}
                    className={`sidebar-tab ${leftTab === 'outline' ? 'active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectLeftTab('outline')}
                  >
                    大纲
                  </button>
                </div>
                {leftTab === 'files' ? (
                  <FileExplorer
                    state={explorer}
                    activeFilePath={activeFilePath}
                    onOpenFile={openFileFromPath}
                  />
                ) : (
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
                )}
              </aside>
              <div className="editor-canvas">
                <TabBar
                  tabs={tabs}
                  activeTabId={activeTabId}
                  onSelect={switchToTab}
                  onClose={requestCloseTab}
                  onNew={newUntitledTab}
                  onReorder={reorderTabs}
                  onContextMenu={openTabMenu}
                />
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
                    completionEnabled={completionEnabled}
                    requestCompletion={requestInlineCompletion}
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
