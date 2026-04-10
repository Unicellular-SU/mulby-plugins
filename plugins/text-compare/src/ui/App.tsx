import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeftRight,
  ClipboardPaste,
  Eraser,
  FileUp,
  Files,
  Copy
} from 'lucide-react'
import { useMulby } from './hooks/useMulby'
import { DiffMergeView } from './components/DiffMergeView'
import { LANG_OPTIONS, type LangId } from './lang'

const PLUGIN_ID = 'text_compare'
const STORAGE_LANG_KEY = 'text_compare.lang.v1'
export const DIFF_SPLIT_MARKER = '<<<DIFF_SPLIT>>>'

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
}

function parseInitInput(raw: string): { left: string; right: string } {
  const i = raw.indexOf(DIFF_SPLIT_MARKER)
  if (i === -1) {
    return { left: raw, right: '' }
  }
  return {
    left: raw.slice(0, i),
    right: raw.slice(i + DIFF_SPLIT_MARKER.length)
  }
}

/** showOpenDialog 在 Mulby 中返回 string[]；部分环境可能返回 { filePaths } */
function firstPathFromOpenDialog(result: unknown): string | undefined {
  if (Array.isArray(result) && typeof result[0] === 'string') {
    return result[0]
  }
  if (result && typeof result === 'object' && 'filePaths' in result) {
    const fp = (result as { filePaths?: string[] }).filePaths
    if (Array.isArray(fp) && typeof fp[0] === 'string') return fp[0]
  }
  return undefined
}

async function readFileAsUtf8(
  readFile: (path: string, encoding?: 'utf-8' | 'base64') => Promise<string | ArrayBuffer | Uint8Array>,
  path: string
): Promise<string> {
  const raw = await readFile(path, 'utf-8')
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) return new TextDecoder('utf-8').decode(raw)
  if (raw instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(raw)
  return ''
}

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [left, setLeft] = useState('')
  const [right, setRight] = useState('')
  const [language, setLanguage] = useState<LangId>('plain')

  const { clipboard, notification, dialog, filesystem, storage } = useMulby(PLUGIN_ID)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    setTheme(initialTheme)
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      setTheme(newTheme)
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.input) {
        const { left: l, right: r } = parseInitInput(data.input)
        setLeft(l)
        setRight(r)
        if (r) {
          window.mulby?.notification?.show('已按分隔符拆分为左右两侧', 'info')
        }
      }
    })
  }, [])

  useEffect(() => {
    void (async () => {
      const saved = await storage.get(STORAGE_LANG_KEY)
      if (saved && typeof saved === 'string') {
        const ok = LANG_OPTIONS.some((o) => o.id === saved)
        if (ok) setLanguage(saved as LangId)
      }
    })()
  }, [storage])

  const persistLang = useCallback(
    (id: LangId) => {
      setLanguage(id)
      void storage.set(STORAGE_LANG_KEY, id)
    },
    [storage]
  )

  const pasteLeft = useCallback(async () => {
    try {
      const t = await clipboard.readText()
      setLeft(t)
      notification.show('已粘贴到左侧', 'success')
    } catch (e) {
      notification.show('读取剪贴板失败', 'error')
    }
  }, [clipboard, notification])

  const pasteRight = useCallback(async () => {
    try {
      const t = await clipboard.readText()
      setRight(t)
      notification.show('已粘贴到右侧', 'success')
    } catch {
      notification.show('读取剪贴板失败', 'error')
    }
  }, [clipboard, notification])

  const loadFile = useCallback(
    async (side: 'left' | 'right') => {
      try {
        const result = await dialog.showOpenDialog({
          title: side === 'left' ? '打开左侧文件' : '打开右侧文件',
          properties: ['openFile']
        })
        const path = firstPathFromOpenDialog(result)
        if (!path) return

        const content = await readFileAsUtf8(filesystem.readFile.bind(filesystem), path)
        if (side === 'left') setLeft(content)
        else setRight(content)
        notification.show(`已载入 ${path}`, 'success')
      } catch (e) {
        console.error('[text-compare] loadFile', e)
        notification.show('读取文件失败', 'error')
      }
    },
    [dialog, filesystem, notification]
  )

  const swapSides = useCallback(() => {
    setLeft(right)
    setRight(left)
  }, [left, right])

  const clearAll = useCallback(() => {
    setLeft('')
    setRight('')
    notification.show('已清空', 'info')
  }, [notification])

  const copySide = useCallback(
    async (side: 'left' | 'right') => {
      const text = side === 'left' ? left : right
      await clipboard.writeText(text)
      notification.show(side === 'left' ? '左侧已复制' : '右侧已复制', 'success')
    },
    [clipboard, left, right, notification]
  )

  const largeWarning = left.length + right.length > 400_000

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar-group">
          <label className="toolbar-label">
            语言
            <select
              className="toolbar-select"
              value={language}
              onChange={(e) => persistLang(e.target.value as LangId)}
            >
              {LANG_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="toolbar-group">
          <button type="button" className="btn" onClick={pasteLeft} title="剪贴板 → 左侧">
            <ClipboardPaste size={16} />
            贴左
          </button>
          <button type="button" className="btn" onClick={pasteRight} title="剪贴板 → 右侧">
            <ClipboardPaste size={16} />
            贴右
          </button>
          <button type="button" className="btn" onClick={() => void loadFile('left')} title="打开文件到左侧">
            <FileUp size={16} />
            左文件
          </button>
          <button type="button" className="btn" onClick={() => void loadFile('right')} title="打开文件到右侧">
            <FileUp size={16} />
            右文件
          </button>
        </div>
        <div className="toolbar-group">
          <button type="button" className="btn" onClick={swapSides} title="交换左右">
            <ArrowLeftRight size={16} />
            交换
          </button>
          <button type="button" className="btn" onClick={() => void copySide('left')} title="复制左侧全文">
            <Copy size={16} />
            复制左
          </button>
          <button type="button" className="btn" onClick={() => void copySide('right')} title="复制右侧全文">
            <Copy size={16} />
            复制右
          </button>
          <button type="button" className="btn btn-danger" onClick={clearAll} title="清空两侧">
            <Eraser size={16} />
            清空
          </button>
        </div>
        {largeWarning && (
          <span className="toolbar-hint" title="过大文本可能导致卡顿">
            <Files size={14} /> 内容较大，若卡顿请分段对比
          </span>
        )}
      </header>

      <main className="diff-main">
        <DiffMergeView
          left={left}
          right={right}
          onLeftChange={setLeft}
          onRightChange={setRight}
          theme={theme}
          language={language}
        />
      </main>
    </div>
  )
}
