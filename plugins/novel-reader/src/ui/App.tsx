import { useCallback, useEffect, useState } from 'react'
import Bookshelf from './components/Bookshelf'
import Reader from './components/Reader'
import { useMulby } from './hooks/useMulby'

const PLUGIN_ID = 'novel-reader'

export interface BookEntry {
  id: string
  title: string
  filePath: string
  addedAt: number
  lastReadAt: number
  progress: number
  chapterCount: number
  totalChars: number
  indexing: boolean
}

export interface ReaderSettings {
  fontSize: number
  lineHeight: number
  theme: 'system' | 'light' | 'dark' | 'sepia'
}

export default function App() {
  const { host } = useMulby(PLUGIN_ID)
  const call = async (method: string, ...args: unknown[]) => {
    const result = await host.call(method, ...args)
    return (result as any)?.data
  }
  const [view, setView] = useState<'bookshelf' | 'reader'>('bookshelf')
  const [currentBook, setCurrentBook] = useState<BookEntry | null>(null)
  const [hydrated, setHydrated] = useState(false)

  const [settings, setSettings] = useState<ReaderSettings>({
    fontSize: 18,
    lineHeight: 1.8,
    theme: 'system',
  })

  useEffect(() => {
    async function init() {
      try {
        const saved = await call('getSettings')
        if (saved) setSettings({ ...saved, theme: saved.theme || 'system' })
      } catch {
        // Use defaults
      } finally {
        setHydrated(true)
      }
    }
    init()
  }, [])

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    // Fetch initial system theme from Mulby
    window.mulby?.theme?.getActual?.().then((actual) => {
      setSystemTheme(actual || 'light')
    }).catch(() => {})

    // Listen for theme changes from Mulby
    window.mulby?.onThemeChange?.((theme) => {
      setSystemTheme(theme)
    })
  }, [])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-light', 'theme-dark', 'sepia', 'dark')
    
    if (settings.theme === 'light') {
      root.classList.add('theme-light')
    } else if (settings.theme === 'dark') {
      root.classList.add('theme-dark')
    } else if (settings.theme === 'sepia') {
      root.classList.add('sepia')
    } else if (settings.theme === 'system') {
      if (systemTheme === 'dark') {
        root.classList.add('dark')
      } else {
        root.classList.add('theme-light')
      }
    }
  }, [settings.theme, systemTheme])

  const importAndOpen = useCallback(async (filePath: string) => {
    try {
      const result = await call('importBook', filePath)
      if (result?.book) {
        setCurrentBook(result.book)
        setView('reader')
      }
    } catch (err) {
      console.error('[novel-reader] importAndOpen failed:', err)
    }
  }, [host])

  const importOnly = useCallback(async (filePath: string) => {
    await call('importBook', filePath)
  }, [host])

  // Handle file trigger from Mulby
  useEffect(() => {
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (data.featureCode === 'open-file' && data.input) {
        importAndOpen(data.input.trim())
      }
    })
  }, [importAndOpen])

  const handleOpenBook = useCallback((book: BookEntry) => {
    setCurrentBook(book)
    setView('reader')
  }, [])

  const handleBackToShelf = useCallback(() => {
    setView('bookshelf')
    setCurrentBook(null)
  }, [])

  const handleSettingsChange = useCallback(async (next: ReaderSettings) => {
    setSettings(next)
    await call('saveSettings', next)
  }, [host])

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-3)]">
        加载中...
      </div>
    )
  }

  if (view === 'reader' && currentBook) {
    return (
      <Reader
        book={currentBook}
        settings={settings}
        onBack={handleBackToShelf}
        onSettingsChange={handleSettingsChange}
      />
    )
  }

  return <Bookshelf onOpenBook={handleOpenBook} onImportBook={importOnly} />
}
