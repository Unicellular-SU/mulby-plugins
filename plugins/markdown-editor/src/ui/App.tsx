import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react'
import Editor, { type EditorType } from '@toast-ui/editor'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import {
  Bold,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  ClipboardPaste,
  Code2,
  Copy,
  Eraser,
  FileCode2,
  FileDown,
  FileInput,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  Quote,
  Save,
  ScanText,
  SeparatorHorizontal
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'

const PLUGIN_ID = 'markdown-editor'
const STORAGE_DRAFT_KEY = 'draft:markdown-editor:v1'
const STORAGE_CHROME_KEY = 'ui:markdown-editor:chrome-collapsed:v1'
const DEFAULT_EXPORT_NAME = 'markdown-note.md'
const EDITOR_PLACEHOLDER = '在这里开始写 Markdown'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

interface DraftPayload {
  content: string
  updatedAt: number
}

interface OutlineEntry {
  id: string
  text: string
  level: number
  line: number
}

const WYSIWYG_SCROLL_SELECTOR = '.toastui-editor-ww-container'

type SpellcheckSurface = HTMLElement & { spellcheck?: boolean }

function normalizeDraft(value: unknown): DraftPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const content = 'content' in value && typeof value.content === 'string' ? value.content : null
  const updatedAt = 'updatedAt' in value && typeof value.updatedAt === 'number' ? value.updatedAt : 0
  if (content === null) {
    return null
  }

  return { content, updatedAt }
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

function applyTextInputPreferences(root: ParentNode | null) {
  if (!root || !('querySelectorAll' in root)) {
    return
  }

  root.querySelectorAll<SpellcheckSurface>('[contenteditable="true"], textarea, input').forEach((element) => {
    element.setAttribute('spellcheck', 'false')
    element.setAttribute('autocorrect', 'off')
    element.setAttribute('autocapitalize', 'off')
    element.setAttribute('data-gramm', 'false')
    element.setAttribute('data-gramm_editor', 'false')
    element.setAttribute('data-enable-grammarly', 'false')
    element.setAttribute('translate', 'no')
    element.spellcheck = false
  })
}

function alignCodeBlockLanguageInput(host: HTMLElement | null, codeBlock: HTMLElement | null) {
  if (!host || !codeBlock) {
    return
  }

  const floatingInput = host.querySelector<HTMLElement>('.toastui-editor-ww-code-block-language')
  const container = floatingInput?.parentElement
  if (!floatingInput || !container) {
    return
  }

  const blockRect = codeBlock.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const top = Math.max(12, blockRect.top - containerRect.top + 10)
  const left = Math.max(12, blockRect.right - containerRect.left - floatingInput.offsetWidth - 10)

  floatingInput.style.position = 'absolute'
  floatingInput.style.top = `${top}px`
  floatingInput.style.left = `${left}px`
  floatingInput.style.right = 'auto'
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [content, setContent] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [sourceLabel, setSourceLabel] = useState('新草稿')
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [chromeCollapsed, setChromeCollapsed] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorType>('wysiwyg')
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const contentRef = useRef(content)
  const modeRef = useRef<EditorType>('wysiwyg')
  const lastPersistedRef = useRef('')
  const hasInitPayloadRef = useRef(false)
  const { clipboard, dialog, filesystem, notification, storage } = useMulby(PLUGIN_ID)

  contentRef.current = content
  modeRef.current = editorMode
  const outlineEntries = useMemo(() => parseOutline(content), [content])

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
      setEditorMode('wysiwyg')
      editorRef.current?.changeMode('wysiwyg', false)
      startTransition(() => {
        setContent(incoming)
      })
    })

    let cancelled = false

    async function loadDraft() {
      try {
        const [draftValue, collapsedValue] = await Promise.all([
          storage.get(STORAGE_DRAFT_KEY),
          storage.get(STORAGE_CHROME_KEY)
        ])

        if (!cancelled) {
          setChromeCollapsed(collapsedValue === true)
        }

        const draft = normalizeDraft(draftValue)
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
  }, [storage])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const editor = new Editor({
      el: host,
      height: '100%',
      minHeight: '100%',
      initialValue: contentRef.current,
      initialEditType: modeRef.current,
      previewStyle: 'vertical',
      hideModeSwitch: true,
      toolbarItems: [],
      autofocus: true,
      usageStatistics: false,
      placeholder: EDITOR_PLACEHOLDER,
      theme: theme === 'dark' ? 'dark' : 'light',
      events: {
        change: () => {
          const next = editor.getMarkdown()
          setContent(next)
        }
      }
    })

    editorRef.current = editor

    const syncEditorSurfaces = () => {
      const { mdEditor, wwEditor } = editor.getEditorElements()
      applyTextInputPreferences(mdEditor)
      applyTextInputPreferences(wwEditor)
    }

    syncEditorSurfaces()
    editor.on('changeMode', () => {
      setEditorMode(editor.isWysiwygMode() ? 'wysiwyg' : 'markdown')
      window.requestAnimationFrame(syncEditorSurfaces)
    })

    const handleEditorClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      const codeBlock = target.closest('.toastui-editor-ww-code-block')
      if (!codeBlock) {
        return
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          alignCodeBlockLanguageInput(host, codeBlock as HTMLElement)
          syncEditorSurfaces()
        })
      })
    }

    host.addEventListener('click', handleEditorClick, true)

    return () => {
      host.removeEventListener('click', handleEditorClick, true)
      editor.destroy()
      editorRef.current = null
    }
  }, [theme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    const current = editor.getMarkdown()
    if (current === content) {
      return
    }

    editor.setMarkdown(content, false)
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
    const host = hostRef.current
    if (!host || outlineEntries.length === 0) {
      return
    }

    const headingSelector = '.toastui-editor-ww-container .toastui-editor-contents h1, .toastui-editor-ww-container .toastui-editor-contents h2, .toastui-editor-ww-container .toastui-editor-contents h3, .toastui-editor-ww-container .toastui-editor-contents h4, .toastui-editor-ww-container .toastui-editor-contents h5, .toastui-editor-ww-container .toastui-editor-contents h6'
    const scrollContainer = host.querySelector<HTMLElement>(WYSIWYG_SCROLL_SELECTOR)
    let frameId = 0

    const syncHeadingTargets = () => {
      const headings = Array.from(host.querySelectorAll<HTMLElement>(headingSelector))
      headings.forEach((heading, index) => {
        const entry = outlineEntries[index]
        if (entry) {
          heading.dataset.outlineId = entry.id
        } else {
          delete heading.dataset.outlineId
        }
      })
    }

    const syncActiveOutline = () => {
      if (editorMode !== 'wysiwyg' || !scrollContainer) {
        return
      }

      const headings = Array.from(host.querySelectorAll<HTMLElement>(`${headingSelector}[data-outline-id]`))
      if (headings.length === 0) {
        return
      }

      const containerTop = scrollContainer.getBoundingClientRect().top
      let candidateId = headings[0].dataset.outlineId ?? null

      headings.forEach((heading) => {
        const headingTop = heading.getBoundingClientRect().top - containerTop
        if (headingTop <= 72) {
          candidateId = heading.dataset.outlineId ?? candidateId
        }
      })

      if (candidateId) {
        setActiveOutlineId((current) => current === candidateId ? current : candidateId)
      }
    }

    const scheduleSync = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        syncHeadingTargets()
        syncActiveOutline()
      })
    }

    scheduleSync()

    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', syncActiveOutline, { passive: true })
    }

    return () => {
      window.cancelAnimationFrame(frameId)
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', syncActiveOutline)
      }
    }
  }, [chromeCollapsed, editorMode, outlineEntries, content])

  const focusEditor = useCallback(() => {
    editorRef.current?.focus()
  }, [])

  const switchMode = useCallback((mode: EditorType) => {
    const editor = editorRef.current
    if (!editor || modeRef.current === mode) {
      return
    }

    editor.changeMode(mode, false)
    setEditorMode(mode)
    editor.focus()
  }, [])

  const execCommand = useCallback((name: string, payload?: Record<string, unknown>) => {
    const editor = editorRef.current
    if (!editor) {
      return
    }

    editor.exec(name, payload)
    editor.focus()
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
    const host = hostRef.current
    if (!editor || !host) {
      return
    }

    setActiveOutlineId(entry.id)

    if (editorMode === 'markdown') {
      editor.setSelection([entry.line, 1], [entry.line, 1])
      editor.focus()
      return
    }

    const target = host.querySelector<HTMLElement>(`[data-outline-id="${entry.id}"]`)
    const scrollContainer = host.querySelector<HTMLElement>(WYSIWYG_SCROLL_SELECTOR)
    if (target && scrollContainer) {
      const nextTop = scrollContainer.scrollTop + target.getBoundingClientRect().top - scrollContainer.getBoundingClientRect().top - 24
      scrollContainer.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' })
      editor.focus()
    }
  }, [editorMode])

  const isDirty = hydrated && content !== lastPersistedRef.current

  const persistDraft = useCallback(async (showToast: boolean) => {
    setSaving(true)
    try {
      const now = Date.now()
      const current = editorRef.current?.getMarkdown() ?? contentRef.current
      if (current.trim()) {
        await storage.set(STORAGE_DRAFT_KEY, { content: current, updatedAt: now })
      } else {
        await storage.remove(STORAGE_DRAFT_KEY)
      }
      lastPersistedRef.current = current
      setSavedAt(now)
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
  }, [focusEditor, notification, storage])

  useEffect(() => {
    if (!hydrated || !isDirty) {
      return
    }

    const timer = window.setTimeout(() => {
      void persistDraft(false)
    }, 600)

    return () => {
      window.clearTimeout(timer)
    }
  }, [hydrated, isDirty, persistDraft])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void persistDraft(true)
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [persistDraft])

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
      lastPersistedRef.current = ''
      setActiveFilePath(path)
      setSourceLabel(`载入 ${basename(path)}`)
      setSavedAt(null)
      startTransition(() => {
        setContent(fileContent)
      })
      switchMode('wysiwyg')
      notification.show('文件已载入', 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleOpenFile', error)
      notification.show('读取文件失败', 'error')
    }
  }, [dialog, filesystem, focusEditor, notification, switchMode])

  const handleExportFile = useCallback(async () => {
    try {
      const target = await dialog.showSaveDialog({
        title: '导出 Markdown 文件',
        defaultPath: activeFilePath ?? DEFAULT_EXPORT_NAME,
        buttonLabel: '导出',
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] }
        ]
      })

      if (!target) {
        return
      }

      const current = editorRef.current?.getMarkdown() ?? contentRef.current
      await filesystem.writeFile(target, current, 'utf-8')
      setActiveFilePath(target)
      notification.show(`已导出到 ${basename(target)}`, 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleExportFile', error)
      notification.show('导出文件失败', 'error')
    }
  }, [activeFilePath, dialog, filesystem, focusEditor, notification])

  const handlePasteClipboard = useCallback(async () => {
    try {
      const text = await clipboard.readText()
      if (!text.trim()) {
        notification.show('剪贴板里没有可粘贴的文本', 'warning')
        return
      }

      const editor = editorRef.current
      if (!editor) {
        setContent(text)
        return
      }

      editor.insertText(text)
      setSourceLabel('来自剪贴板')
      notification.show('已插入剪贴板文本', 'success')
      editor.focus()
    } catch (error) {
      console.error('[markdown-editor] handlePasteClipboard', error)
      notification.show('读取剪贴板失败', 'error')
    }
  }, [clipboard, notification])

  const handleCopyMarkdown = useCallback(async () => {
    try {
      const current = editorRef.current?.getMarkdown() ?? contentRef.current
      await clipboard.writeText(current)
      notification.show('Markdown 已复制到剪贴板', 'success')
      focusEditor()
    } catch (error) {
      console.error('[markdown-editor] handleCopyMarkdown', error)
      notification.show('复制失败', 'error')
    }
  }, [clipboard, focusEditor, notification])

  const handleClear = useCallback(() => {
    setContent('')
    setSourceLabel('新草稿')
    setActiveFilePath(null)
    switchMode('wysiwyg')
    focusEditor()
    notification.show('内容已清空', 'info')
  }, [focusEditor, notification, switchMode])

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

  const toolbarActions = [
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

  const lineCount = content.length === 0 ? 0 : content.split('\n').length
  const charCount = Array.from(content).length
  const documentName = activeFilePath ? basename(activeFilePath) : '未命名.md'

  return (
    <div className={`app theme-${theme}`}>
      {!chromeCollapsed && (
        <header className="toolbar">
          <div className="toolbar-actions">
            <button
              type="button"
              className="action-btn action-btn-icon"
              aria-label="打开文件"
              data-tooltip="打开文件"
              title="打开文件"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleOpenFile}
            >
              <FileInput size={15} />
            </button>
            <button
              type="button"
              className="action-btn action-btn-icon"
              aria-label="粘贴"
              data-tooltip="粘贴"
              title="粘贴"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handlePasteClipboard}
            >
              <ClipboardPaste size={15} />
            </button>
            <button
              type="button"
              className="action-btn action-btn-primary action-btn-icon"
              aria-label={saving ? '保存中' : '保存草稿'}
              data-tooltip={saving ? '保存中' : '保存草稿'}
              title={saving ? '保存中' : '保存草稿'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void persistDraft(true)}
              disabled={saving}
            >
              <Save size={15} />
            </button>
            <button
              type="button"
              className="action-btn action-btn-icon"
              aria-label="导出 .md"
              data-tooltip="导出 .md"
              title="导出 .md"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleExportFile}
            >
              <FileDown size={15} />
            </button>
            <button
              type="button"
              className="action-btn action-btn-icon"
              aria-label="复制"
              data-tooltip="复制"
              title="复制"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void handleCopyMarkdown()}
            >
              <Copy size={15} />
            </button>
            <button
              type="button"
              className="action-btn action-btn-danger action-btn-icon"
              aria-label="清空"
              data-tooltip="清空"
              title="清空"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleClear}
            >
              <Eraser size={15} />
            </button>
          </div>

          <div className="toolbar-formatters">
            {toolbarActions.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  type="button"
                  className="formatter-btn formatter-btn-icon"
                  aria-label={item.title}
                  data-tooltip={item.title}
                  title={item.title}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={item.onClick}
                >
                  <Icon size={15} />
                </button>
              )
            })}
          </div>

          <div className="toolbar-footer">
            <button
              type="button"
              className={`mode-btn mode-btn-icon ${editorMode === 'markdown' ? 'active' : ''}`}
              aria-label={editorMode === 'wysiwyg' ? '进入源代码模式' : '返回普通模式'}
              data-tooltip={editorMode === 'wysiwyg' ? '进入源代码模式' : '返回普通模式'}
              title={editorMode === 'wysiwyg' ? '进入源代码模式' : '返回普通模式'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => switchMode(editorMode === 'wysiwyg' ? 'markdown' : 'wysiwyg')}
            >
              {editorMode === 'wysiwyg' ? <FileCode2 size={15} /> : <ScanText size={15} />}
            </button>
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

      <section className="status-bar">
        <div className="status-group">
          <span className="status-pill">{sourceLabel}</span>
          <span className="status-pill">{editorMode === 'wysiwyg' ? '普通模式' : '源代码模式'}</span>
          <span className={`status-pill ${isDirty ? 'is-dirty' : 'is-saved'}`}>
            {isDirty ? '有未持久化修改' : `已保存 ${formatTimestamp(savedAt)}`}
          </span>
        </div>
        <div className="status-group status-group-metrics">
          <span>{lineCount} 行</span>
          <span>{charCount} 字符</span>
          <span>{editorMode === 'wysiwyg' ? '默认直接可视化编辑' : '当前为纯 Markdown 源码编辑'}</span>
          {chromeCollapsed && (
            <button
              type="button"
              className="status-toggle-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleChrome}
            >
              <ChevronDown size={14} />
              显示功能区
            </button>
          )}
        </div>
      </section>

      <main className="workspace">
        <section className={`panel editor-panel ${editorMode === 'markdown' ? 'mode-source' : 'mode-wysiwyg'}`}>
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
                  <span className="pane-header-label">{documentName}</span>
                </div>
                <div ref={hostRef} className="editor-host" />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
