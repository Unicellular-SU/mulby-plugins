import { useCallback, useEffect, useRef, useState, startTransition } from 'react'
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
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Editor | null>(null)
  const contentRef = useRef(content)
  const modeRef = useRef<EditorType>('wysiwyg')
  const lastPersistedRef = useRef('')
  const hasInitPayloadRef = useRef(false)
  const { clipboard, dialog, filesystem, notification, storage } = useMulby(PLUGIN_ID)

  contentRef.current = content
  modeRef.current = editorMode

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

  return (
    <div className={`app theme-${theme}`}>
      {!chromeCollapsed && (
        <header className="toolbar">
          <div className="toolbar-actions">
            <button type="button" className="action-btn" onMouseDown={(event) => event.preventDefault()} onClick={handleOpenFile}>
              <FileInput size={15} />
              打开
            </button>
            <button type="button" className="action-btn" onMouseDown={(event) => event.preventDefault()} onClick={handlePasteClipboard}>
              <ClipboardPaste size={15} />
              粘贴
            </button>
            <button
              type="button"
              className="action-btn action-btn-primary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void persistDraft(true)}
              disabled={saving}
            >
              <Save size={15} />
              {saving ? '保存中' : '保存草稿'}
            </button>
            <button type="button" className="action-btn" onMouseDown={(event) => event.preventDefault()} onClick={handleExportFile}>
              <FileDown size={15} />
              导出 .md
            </button>
            <button type="button" className="action-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => void handleCopyMarkdown()}>
              <Copy size={15} />
              复制
            </button>
            <button type="button" className="action-btn action-btn-danger" onMouseDown={(event) => event.preventDefault()} onClick={handleClear}>
              <Eraser size={15} />
              清空
            </button>
          </div>

          <div className="toolbar-formatters">
            {toolbarActions.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.label}
                  type="button"
                  className="formatter-btn"
                  title={item.title}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={item.onClick}
                >
                  <Icon size={15} />
                  {item.label}
                </button>
              )
            })}
          </div>

          <div className="toolbar-footer">
            <button
              type="button"
              className={`mode-btn ${editorMode === 'markdown' ? 'active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => switchMode(editorMode === 'wysiwyg' ? 'markdown' : 'wysiwyg')}
            >
              {editorMode === 'wysiwyg' ? <FileCode2 size={15} /> : <ScanText size={15} />}
              {editorMode === 'wysiwyg' ? '进入源代码模式' : '返回普通模式'}
            </button>
            <button
              type="button"
              className="mode-btn chrome-toggle-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleChrome}
            >
              <ChevronUp size={15} />
              隐藏顶部栏
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
              <aside className="editor-outline-slot" aria-hidden="true" />
              <div className="editor-canvas">
                <div ref={hostRef} className="editor-host" />
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
