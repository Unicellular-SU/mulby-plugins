import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  X,
  ExternalLink,
  Languages,
  Plus,
  RefreshCw,
  Send,
  Settings,
  ShieldAlert
} from 'lucide-react'

type SiteId = string
type WebviewState = 'checking' | 'supported' | 'unsupported'
type StatusKind = 'idle' | 'loading' | 'success' | 'warning' | 'error'

interface TranslatorSite {
  id: SiteId
  title: string
  url: string
  inputSelectors: string[]
  fitWidth?: number
  custom?: boolean
}

interface SiteSettings {
  enabledSiteIds: string[]
  customSites: TranslatorSite[]
}

interface CustomSiteDraft {
  title: string
  url: string
}

interface FillResult {
  ok: boolean
  selector?: string
  tag?: string
  reason?: string
}

interface EmbeddedWebviewElement extends HTMLElement {
  src?: string
  reload?: () => void
  canGoBack?: () => boolean
  goBack?: () => void
  isLoading?: () => boolean
  isLoadingMainFrame?: () => boolean
  setZoomFactor?: (factor: number) => void
  executeJavaScript?: <T = unknown>(code: string, userGesture?: boolean) => Promise<T>
}

interface WebviewLoadFailureEvent extends Event {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
  isMainFrame?: boolean
}

interface WebviewNavigationEvent extends Event {
  url?: string
  isInPlace?: boolean
  isMainFrame?: boolean
}

const PLUGIN_ID = 'web-translator'
const SITE_SETTINGS_KEY = `${PLUGIN_ID}:site-settings:v1`
const DEFAULT_FIT_WIDTH = 1180
const MIN_WEBVIEW_ZOOM = 0.5
const DEFAULT_VISIBLE_SITE_IDS = ['youdao', 'tencent', 'baidu', 'google']

const DEFAULT_INPUT_SELECTORS = [
  'textarea',
  'input[type="text"]',
  'input[type="search"]',
  '[contenteditable="true"]',
  '[role="textbox"]'
]

const BUILTIN_TRANSLATOR_SITES: TranslatorSite[] = [
  {
    id: 'youdao',
    title: '有道翻译',
    url: 'https://fanyi.youdao.com/',
    inputSelectors: [
      '#js_fanyi_input',
      '#inputOriginal',
      'textarea[placeholder]',
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ]
  },
  {
    id: 'tencent',
    title: '腾讯翻译',
    url: 'https://fanyi.qq.com/',
    inputSelectors: [
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]',
      '.text-input',
      '.source textarea',
      '#source'
    ]
  },
  {
    id: 'baidu',
    title: '百度翻译',
    url: 'https://fanyi.baidu.com/',
    inputSelectors: [
      '#baidu_translate_input',
      'textarea#baidu_translate_input',
      'textarea',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ]
  },
  {
    id: 'google',
    title: 'Google Translate',
    url: 'https://translate.google.com/?sl=auto&op=translate',
    inputSelectors: [
      'textarea[aria-label]',
      'textarea',
      'div[role="textbox"]',
      '[contenteditable="true"][aria-label]',
      '[contenteditable="true"]'
    ]
  },
  {
    id: 'deepl',
    title: 'DeepL',
    url: 'https://www.deepl.com/translator',
    inputSelectors: [
      'd-textarea textarea',
      'textarea[aria-label]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ],
    fitWidth: 1160
  },
  {
    id: 'bing',
    title: 'Bing 翻译',
    url: 'https://www.bing.com/translator',
    inputSelectors: ['#tta_input_ta', 'textarea', '[contenteditable="true"]', '[role="textbox"]'],
    fitWidth: 1100
  },
  {
    id: 'sogou',
    title: '搜狗翻译',
    url: 'https://fanyi.sogou.com/text',
    inputSelectors: ['#trans-input', '.trans-input', 'textarea', '[contenteditable="true"]', '[role="textbox"]']
  },
  {
    id: 'caiyun',
    title: '彩云小译',
    url: 'https://fanyi.caiyunapp.com/',
    inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]']
  },
  {
    id: 'yandex',
    title: 'Yandex Translate',
    url: 'https://translate.yandex.com/',
    inputSelectors: ['#fakeArea', 'textarea', '[contenteditable="true"]', '[role="textbox"]'],
    fitWidth: 1120
  },
  {
    id: 'papago',
    title: 'Papago',
    url: 'https://papago.naver.com/',
    inputSelectors: ['#txtSource', 'textarea', '[contenteditable="true"]', '[role="textbox"]']
  },
  {
    id: 'reverso',
    title: 'Reverso',
    url: 'https://www.reverso.net/text-translation',
    inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]']
  },
  {
    id: 'niutrans',
    title: '小牛翻译',
    url: 'https://niutrans.com/trans',
    inputSelectors: ['#input_text', 'textarea', '[contenteditable="true"]', '[role="textbox"]']
  },
  {
    id: 'iciba',
    title: '金山词霸',
    url: 'https://www.iciba.com/translate',
    inputSelectors: ['textarea', '[contenteditable="true"]', '[role="textbox"]']
  }
]

const DEFAULT_ENABLED_SITE_IDS = DEFAULT_VISIBLE_SITE_IDS

function normalizeInitInput(raw: string) {
  const value = raw || ''
  const commandMatch = value.match(/^\s*(网页翻译|web-translate|web translator)(?:\s+|[:：-]\s*|$)/i)
  if (!commandMatch) return value
  return value.slice(commandMatch[0].length)
}

function normalizeCustomSiteUrl(raw: string) {
  const value = raw.trim()
  if (!value) return ''

  try {
    return new URL(value.includes('://') ? value : `https://${value}`).toString()
  } catch {
    return ''
  }
}

function getReadableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

function getDefaultSiteSettings(): SiteSettings {
  return {
    enabledSiteIds: DEFAULT_ENABLED_SITE_IDS,
    customSites: []
  }
}

function getSavedSiteSettings(): SiteSettings {
  try {
    const raw = window.localStorage.getItem(SITE_SETTINGS_KEY)
    if (!raw) return getDefaultSiteSettings()

    const parsed = JSON.parse(raw) as Partial<SiteSettings>
    const builtinIds = new Set(DEFAULT_ENABLED_SITE_IDS)
    const customSites = Array.isArray(parsed.customSites)
      ? parsed.customSites
          .filter((site): site is TranslatorSite => Boolean(site?.id && site.title && site.url))
          .map((site) => ({
            ...site,
            custom: true,
            inputSelectors: site.inputSelectors?.length ? site.inputSelectors : DEFAULT_INPUT_SELECTORS
          }))
      : []
    const customIds = new Set(customSites.map((site) => site.id))
    const savedEnabledSiteIds = Array.isArray(parsed.enabledSiteIds)
      ? parsed.enabledSiteIds.filter((id) => builtinIds.has(id) || customIds.has(id))
      : DEFAULT_ENABLED_SITE_IDS
    const savedBuiltinIds = savedEnabledSiteIds.filter((id) => builtinIds.has(id))
    const isLegacyAllBuiltinsEnabled =
      savedBuiltinIds.length === BUILTIN_TRANSLATOR_SITES.length &&
      BUILTIN_TRANSLATOR_SITES.every((site) => savedBuiltinIds.includes(site.id))
    const enabledSiteIds = isLegacyAllBuiltinsEnabled
      ? [...DEFAULT_ENABLED_SITE_IDS, ...savedEnabledSiteIds.filter((id) => customIds.has(id))]
      : savedEnabledSiteIds

    return {
      enabledSiteIds: enabledSiteIds.length ? enabledSiteIds : DEFAULT_ENABLED_SITE_IDS,
      customSites
    }
  } catch {
    return getDefaultSiteSettings()
  }
}

function saveSiteSettings(settings: SiteSettings) {
  window.localStorage.setItem(SITE_SETTINGS_KEY, JSON.stringify(settings))
}

function getFitZoom(width: number, fitWidth: number) {
  if (width >= fitWidth) return 1
  return Math.max(MIN_WEBVIEW_ZOOM, width / fitWidth)
}

function syncWebviewGuestSize(webview: EmbeddedWebviewElement | null, width: number, height: number, fitWidth = DEFAULT_FIT_WIDTH) {
  if (!webview) return

  const normalizedWidth = Math.max(1, Math.floor(width))
  const normalizedHeight = Math.max(1, Math.floor(height))
  const attributes = {
    autosize: 'on',
    width: String(normalizedWidth),
    height: String(normalizedHeight),
    minwidth: String(normalizedWidth),
    minheight: String(normalizedHeight),
    maxwidth: String(normalizedWidth),
    maxheight: String(normalizedHeight)
  }

  Object.entries(attributes).forEach(([name, value]) => {
    if (webview.getAttribute(name) !== value) {
      webview.setAttribute(name, value)
    }
  })

  webview.style.width = `${normalizedWidth}px`
  webview.style.maxWidth = `${normalizedWidth}px`
  webview.style.minWidth = '0px'
  webview.style.height = `${normalizedHeight}px`
  webview.style.minHeight = `${normalizedHeight}px`
  webview.style.maxHeight = `${normalizedHeight}px`

  try {
    webview.setZoomFactor?.(getFitZoom(normalizedWidth, fitWidth))
  } catch {
    // Some hosts may expose webview without zoom controls.
  }
}

function showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  window.mulby?.notification?.show(message, type)
}

function fillPageText(value: string, selectors: string[]): FillResult {
  const isVisible = (element: Element) => {
    const el = element as HTMLElement
    const rect = el.getBoundingClientRect()
    const style = window.getComputedStyle(el)
    return rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none'
  }

  const cssPath = (element: Element) => {
    if (element.id) return `#${element.id}`
    const name = element.getAttribute('name')
    if (name) return `${element.tagName.toLowerCase()}[name="${name}"]`
    const aria = element.getAttribute('aria-label')
    if (aria) return `${element.tagName.toLowerCase()}[aria-label="${aria}"]`
    return element.tagName.toLowerCase()
  }

  const queryCandidates = () => {
    const result: Element[] = []
    const seen = new Set<Element>()
    const push = (element: Element | null) => {
      if (!element || seen.has(element)) return
      seen.add(element)
      result.push(element)
    }

    for (const selector of selectors) {
      try {
        document.querySelectorAll(selector).forEach(push)
      } catch {
        // Ignore selector drift from third-party pages.
      }
    }

    document
      .querySelectorAll('textarea, input[type="text"], input[type="search"], [contenteditable="true"], [role="textbox"]')
      .forEach(push)

    return result
  }

  const setNativeValue = (element: HTMLInputElement | HTMLTextAreaElement, nextValue: string) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (descriptor?.set) {
      descriptor.set.call(element, nextValue)
    } else {
      element.value = nextValue
    }
  }

  const dispatchInputEvents = (element: Element) => {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }))
  }

  const candidates = queryCandidates().filter((element) => {
    if (!isVisible(element)) return false
    if (element instanceof HTMLInputElement && (element.disabled || element.readOnly)) return false
    if (element instanceof HTMLTextAreaElement && (element.disabled || element.readOnly)) return false
    return true
  })

  for (const element of candidates) {
    const el = element as HTMLElement
    el.focus()

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      setNativeValue(element, value)
      dispatchInputEvents(element)
      return { ok: true, selector: cssPath(element), tag: element.tagName.toLowerCase() }
    }

    const editable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox'
    if (!editable) continue

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(el)
    selection?.removeAllRanges()
    selection?.addRange(range)

    const inserted = document.execCommand('insertText', false, value)
    if (!inserted) {
      el.textContent = value
    }
    dispatchInputEvents(el)
    return { ok: true, selector: cssPath(element), tag: element.tagName.toLowerCase() }
  }

  return { ok: false, reason: 'source-input-not-found' }
}

function buildFillScript(text: string, site: TranslatorSite) {
  return `(${fillPageText.toString()})(${JSON.stringify(text)}, ${JSON.stringify(site.inputSelectors)})`
}

export default function App() {
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const topbarRef = useRef<HTMLElement | null>(null)
  const controlbarRef = useRef<HTMLElement | null>(null)
  const statusbarRef = useRef<HTMLDivElement | null>(null)
  const browserAreaRef = useRef<HTMLElement | null>(null)
  const webviewRef = useRef<EmbeddedWebviewElement | null>(null)
  const lastAutoFillKeyRef = useRef('')
  const browserHeightRef = useRef<number | null>(null)
  const [activeSiteId, setActiveSiteId] = useState<SiteId>('youdao')
  const [sourceText, setSourceText] = useState('')
  const [webviewState, setWebviewState] = useState<WebviewState>('checking')
  const [hostWebviewCapability, setHostWebviewCapability] = useState<boolean | null>(null)
  const [pageReady, setPageReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isFilling, setIsFilling] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(() => getSavedSiteSettings())
  const [customDraft, setCustomDraft] = useState<CustomSiteDraft>({ title: '', url: '' })
  const [status, setStatus] = useState<{ kind: StatusKind; text: string }>({
    kind: 'loading',
    text: '正在加载网页'
  })

  const allSites = useMemo(() => [...BUILTIN_TRANSLATOR_SITES, ...siteSettings.customSites], [siteSettings.customSites])
  const siteById = useMemo(() => new Map(allSites.map((site) => [site.id, site])), [allSites])
  const enabledSites = useMemo(() => {
    const enabled = siteSettings.enabledSiteIds.map((id) => siteById.get(id)).filter((site): site is TranslatorSite => Boolean(site))
    return enabled.length ? enabled : allSites.slice(0, 1)
  }, [allSites, siteById, siteSettings.enabledSiteIds])
  const activeSite = useMemo(() => siteById.get(activeSiteId) || enabledSites[0] || allSites[0], [activeSiteId, allSites, enabledSites, siteById])

  useEffect(() => {
    saveSiteSettings(siteSettings)
  }, [siteSettings])

  useEffect(() => {
    if (!settingsOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  useEffect(() => {
    if (!siteById.has(activeSiteId) || !siteSettings.enabledSiteIds.includes(activeSiteId)) {
      setActiveSiteId(enabledSites[0]?.id || BUILTIN_TRANSLATOR_SITES[0].id)
      lastAutoFillKeyRef.current = ''
    }
  }, [activeSiteId, enabledSites, siteById, siteSettings.enabledSiteIds])

  const applyTheme = useCallback((theme: 'light' | 'dark') => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [])

  const syncLayout = useCallback(() => {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || document.body?.clientHeight || 0
    const topbarHeight = topbarRef.current?.getBoundingClientRect().height || 0
    const controlbarHeight = controlbarRef.current?.getBoundingClientRect().height || 0
    const statusbarHeight = statusbarRef.current?.getBoundingClientRect().height || 0
    const chromeHeight = topbarHeight + controlbarHeight + statusbarHeight
    const availableHeight = Math.floor(viewportHeight - chromeHeight)
    const nextBrowserHeight = Number.isFinite(availableHeight) && availableHeight > 0 ? availableHeight : null

    if (nextBrowserHeight !== null && browserHeightRef.current !== nextBrowserHeight) {
      browserHeightRef.current = nextBrowserHeight
      document.documentElement.style.setProperty('--web-translator-browser-height', `${nextBrowserHeight}px`)
    } else if (nextBrowserHeight === null && browserHeightRef.current !== null) {
      browserHeightRef.current = null
      document.documentElement.style.removeProperty('--web-translator-browser-height')
    }

    const webview = webviewRef.current
    const browserAreaWidth =
      browserAreaRef.current?.getBoundingClientRect().width || document.documentElement.clientWidth || window.innerWidth || 1
    if (nextBrowserHeight !== null) {
      syncWebviewGuestSize(webview, browserAreaWidth, nextBrowserHeight, activeSite.fitWidth || DEFAULT_FIT_WIDTH)
    }
  }, [activeSite.fitWidth])

  useLayoutEffect(() => {
    syncLayout()
  })

  useEffect(() => {
    syncLayout()

    const handleResize = () => syncLayout()
    window.addEventListener('resize', handleResize)

    const firstFrame = window.requestAnimationFrame(() => {
      syncLayout()
      window.requestAnimationFrame(syncLayout)
    })

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            syncLayout()
          })
        : null

    ;[
      document.documentElement,
      document.body,
      document.getElementById('root'),
      appShellRef.current,
      topbarRef.current,
      controlbarRef.current,
      statusbarRef.current,
      browserAreaRef.current
    ].forEach((element) => {
      if (element) resizeObserver?.observe(element)
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      window.cancelAnimationFrame(firstFrame)
      resizeObserver?.disconnect()
    }
  }, [syncLayout])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    applyTheme((params.get('theme') as 'light' | 'dark') || 'light')

    window.mulby?.onThemeChange?.(applyTheme)
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (typeof data.capabilities?.webview === 'boolean') {
        setHostWebviewCapability(data.capabilities.webview)
      }

      const nextText = normalizeInitInput(data.input)
      setSourceText(nextText)
      lastAutoFillKeyRef.current = ''
      if (nextText.trim()) {
        setStatus({ kind: 'loading', text: '等待网页加载后填入' })
      }
    })
  }, [applyTheme])

  const unsupportedText =
    hostWebviewCapability === false
      ? '宿主未授予 webview 权限'
      : '当前宿主未启用嵌入网页'

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    syncLayout()

    if (hostWebviewCapability === false) {
      setWebviewState('unsupported')
      setIsLoading(false)
      setPageReady(false)
      setStatus({ kind: 'warning', text: unsupportedText })
      return
    }

    let disposed = false
    let readyForCurrentGuest = false
    const markNotReady = () => {
      readyForCurrentGuest = false
      setPageReady(false)
    }

    markNotReady()
    setIsLoading(true)
    setWebviewState('checking')
    setStatus({ kind: 'loading', text: '正在加载网页' })
    lastAutoFillKeyRef.current = ''

    const checkSupport = () => {
      const supported = typeof webview.executeJavaScript === 'function'
      syncLayout()
      setWebviewState(supported ? 'supported' : 'unsupported')
      if (!supported) {
        setIsLoading(false)
        markNotReady()
        setStatus({ kind: 'warning', text: unsupportedText })
      }

      return supported
    }

    const syncLoadingState = (fallback: boolean) => {
      const loading =
        typeof webview.isLoadingMainFrame === 'function'
          ? webview.isLoadingMainFrame()
          : typeof webview.isLoading === 'function'
            ? webview.isLoading()
            : fallback
      setIsLoading(loading)
      return loading
    }

    const handleStartLoading = () => {
      syncLayout()
      syncLoadingState(true)
      if (!readyForCurrentGuest) {
        setStatus({ kind: 'loading', text: '正在加载网页' })
      }
    }

    const handleStartNavigation = (event: Event) => {
      const navigation = event as WebviewNavigationEvent
      if (navigation.isMainFrame === false || navigation.isInPlace) return
      markNotReady()
      setIsLoading(true)
      setStatus({ kind: 'loading', text: '正在加载网页' })
    }

    const handleNavigateInPage = (event: Event) => {
      const navigation = event as WebviewNavigationEvent
      if (navigation.isMainFrame === false) return
      syncLayout()
    }

    const markReady = () => {
      if (!checkSupport()) return
      readyForCurrentGuest = true
      setPageReady(true)
      setStatus((current) => {
        if (current.kind === 'warning' || current.kind === 'error' || current.kind === 'success') return current
        return { kind: 'idle', text: '网页已就绪' }
      })
    }

    const probeReadyState = async () => {
      if (typeof webview.executeJavaScript !== 'function') return

      try {
        const readyState = await webview.executeJavaScript<string>('document.readyState', false)
        if (disposed || !['interactive', 'complete'].includes(readyState)) return
        markReady()
        syncLoadingState(false)
      } catch {
        // Navigation may still be committing. The next lifecycle event will probe again.
      }
    }

    const handleDomReady = () => {
      syncLayout()
      markReady()
      syncLoadingState(false)
    }

    const handleStopLoading = () => {
      syncLayout()
      setIsLoading(false)
      if (readyForCurrentGuest) {
        setStatus((current) => (current.kind === 'loading' ? { kind: 'idle', text: '网页已就绪' } : current))
      } else {
        void probeReadyState()
      }
    }

    const handleFinishLoad = () => {
      syncLayout()
      setIsLoading(false)
      if (readyForCurrentGuest) return
      void probeReadyState()
    }

    const handleAttach = () => {
      syncLayout()
      if (typeof webview.executeJavaScript === 'function') {
        setWebviewState('supported')
      }
      void probeReadyState()
    }

    const handleFail = (event: Event) => {
      const failure = event as WebviewLoadFailureEvent
      syncLayout()
      if (failure.isMainFrame === false || failure.errorCode === -3) return
      setIsLoading(false)
      markNotReady()
      setStatus({
        kind: 'error',
        text: failure.errorDescription ? `${activeSite.title} 加载失败：${failure.errorDescription}` : `${activeSite.title} 加载失败`
      })
    }

    setWebviewState('checking')
    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-stop-loading', handleStopLoading)
    webview.addEventListener('did-attach', handleAttach)
    webview.addEventListener('did-start-navigation', handleStartNavigation)
    webview.addEventListener('did-navigate-in-page', handleNavigateInPage)
    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-finish-load', handleFinishLoad)
    webview.addEventListener('did-fail-load', handleFail)
    void probeReadyState()

    return () => {
      disposed = true
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-stop-loading', handleStopLoading)
      webview.removeEventListener('did-attach', handleAttach)
      webview.removeEventListener('did-start-navigation', handleStartNavigation)
      webview.removeEventListener('did-navigate-in-page', handleNavigateInPage)
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-finish-load', handleFinishLoad)
      webview.removeEventListener('did-fail-load', handleFail)
    }
  }, [activeSite.id, activeSite.title, hostWebviewCapability, syncLayout, unsupportedText])

  const fillEmbedded = useCallback(
    async (reason: 'auto' | 'manual' = 'manual') => {
      const text = sourceText
      if (!text.trim()) {
        setStatus({ kind: 'warning', text: '没有可填入的文本' })
        return false
      }

      const webview = webviewRef.current
      if (!webview || typeof webview.executeJavaScript !== 'function') {
        setWebviewState('unsupported')
        setStatus({ kind: 'warning', text: unsupportedText })
        return false
      }

      try {
        setIsFilling(true)
        const result = await webview.executeJavaScript<FillResult>(buildFillScript(text, activeSite), true)
        if (result?.ok) {
          setStatus({ kind: 'success', text: `已填入 ${activeSite.title}` })
          if (reason === 'manual') showNotification(`已填入 ${activeSite.title}`, 'success')
          return true
        }

        setStatus({ kind: 'warning', text: `${activeSite.title} 未找到源文本框` })
        if (reason === 'manual') showNotification('未找到源文本框，可在网页内手动粘贴', 'warning')
        return false
      } catch (error) {
        setStatus({ kind: 'error', text: getReadableError(error, '自动填入失败') })
        return false
      } finally {
        setIsFilling(false)
      }
    },
    [activeSite, sourceText, unsupportedText]
  )

  useEffect(() => {
    if (webviewState !== 'supported' || !pageReady || !sourceText.trim()) return

    const fillKey = `${activeSite.id}:${sourceText}`
    if (lastAutoFillKeyRef.current === fillKey) return

    const timer = window.setTimeout(() => {
      lastAutoFillKeyRef.current = fillKey
      void fillEmbedded('auto')
    }, 500)

    return () => window.clearTimeout(timer)
  }, [activeSite.id, fillEmbedded, pageReady, sourceText, webviewState])

  const handleSiteChange = (siteId: SiteId) => {
    setActiveSiteId(siteId)
    lastAutoFillKeyRef.current = ''
    window.requestAnimationFrame(syncLayout)
  }

  const updateEnabledSite = (siteId: string, enabled: boolean) => {
    setSiteSettings((current) => {
      const enabledSet = new Set(current.enabledSiteIds)
      if (enabled) {
        enabledSet.add(siteId)
      } else if (enabledSet.size > 1) {
        enabledSet.delete(siteId)
      }

      return {
        ...current,
        enabledSiteIds: allSites.map((site) => site.id).filter((id) => enabledSet.has(id))
      }
    })
  }

  const addCustomSite = () => {
    const title = customDraft.title.trim()
    const url = normalizeCustomSiteUrl(customDraft.url)

    if (!title || !url) {
      setStatus({ kind: 'warning', text: '请填写有效的站点名称和网址' })
      return
    }

    const id = `custom-${Date.now()}`
    const site: TranslatorSite = {
      id,
      title,
      url,
      inputSelectors: DEFAULT_INPUT_SELECTORS,
      custom: true
    }

    setSiteSettings((current) => ({
      customSites: [...current.customSites, site],
      enabledSiteIds: [...current.enabledSiteIds, id]
    }))
    setCustomDraft({ title: '', url: '' })
    setActiveSiteId(id)
    lastAutoFillKeyRef.current = ''
    setStatus({ kind: 'idle', text: '已添加自定义站点' })
  }

  const removeCustomSite = (siteId: string) => {
    setSiteSettings((current) => ({
      customSites: current.customSites.filter((site) => site.id !== siteId),
      enabledSiteIds: current.enabledSiteIds.filter((id) => id !== siteId)
    }))
    lastAutoFillKeyRef.current = ''
  }

  const resetSites = () => {
    const defaults = getDefaultSiteSettings()
    setSiteSettings(defaults)
    setActiveSiteId(defaults.enabledSiteIds[0])
    setCustomDraft({ title: '', url: '' })
    lastAutoFillKeyRef.current = ''
    setStatus({ kind: 'idle', text: '已恢复默认站点' })
  }

  const reloadActiveSite = () => {
    syncLayout()
    lastAutoFillKeyRef.current = ''
    setPageReady(false)
    setIsLoading(true)
    setStatus({ kind: 'loading', text: '正在重新加载网页' })
    if (webviewRef.current?.reload) {
      webviewRef.current.reload()
    } else {
      setWebviewState('unsupported')
      setIsLoading(false)
      setStatus({ kind: 'warning', text: unsupportedText })
    }
  }

  const goBack = () => {
    const webview = webviewRef.current
    if (webview?.canGoBack?.()) webview.goBack?.()
  }

  const openInBrowser = async () => {
    if (!window.mulby?.inbrowser) {
      setStatus({ kind: 'error', text: '当前环境没有内置浏览器 API' })
      return
    }

    try {
      setStatus({ kind: 'loading', text: `正在打开 ${activeSite.title}` })
      const builder = window.mulby.inbrowser
        .goto(activeSite.url)
        .viewport(1180, 760)
        .show()
        .wait(1600)

      if (sourceText.trim()) {
        builder.evaluate(fillPageText, sourceText, activeSite.inputSelectors)
      }

      await builder.run({
        show: true,
        width: 1180,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        center: true
      })

      setStatus({ kind: 'success', text: `已在内置浏览器打开 ${activeSite.title}` })
    } catch (error) {
      setStatus({ kind: 'error', text: getReadableError(error, '内置浏览器打开失败') })
    }
  }

  return (
    <div className="app-shell" ref={appShellRef}>
      <header className="topbar" ref={topbarRef}>
        <div className="brand">
          <Languages size={20} aria-hidden="true" />
          <span>网页翻译</span>
        </div>

        <nav className="tabs" aria-label="翻译站点">
          {enabledSites.map((site) => (
            <button
              key={site.id}
              type="button"
              className={`tab-button ${site.id === activeSiteId ? 'is-active' : ''}`}
              onClick={() => handleSiteChange(site.id)}
            >
              {site.title}
            </button>
          ))}
        </nav>
      </header>

      <section className="controlbar" ref={controlbarRef} aria-label="文本与页面操作">
        <div className="actions">
          <button type="button" className="icon-button" onClick={goBack} title="后退">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" onClick={reloadActiveSite} title="重新载入">
            <RefreshCw size={17} aria-hidden="true" className={isLoading ? 'spin' : ''} />
          </button>
          <button type="button" className="icon-button" onClick={() => setSettingsOpen((value) => !value)} title="配置站点">
            <Settings size={17} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="text-button"
            disabled={isFilling}
            onClick={() => void fillEmbedded('manual')}
            title="填入当前网页"
          >
            <Send size={16} aria-hidden="true" />
            <span>填入</span>
          </button>
          <button type="button" className="text-button secondary" onClick={() => void openInBrowser()} title="用内置浏览器打开">
            <ExternalLink size={16} aria-hidden="true" />
            <span>打开</span>
          </button>
        </div>
      </section>

      <div className={`statusbar ${status.kind}`} ref={statusbarRef}>
        <span className="status-dot" aria-hidden="true" />
        <span>{status.text}</span>
      </div>

      <main className="browser-area" ref={browserAreaRef}>
        {webviewState === 'unsupported' ? (
          <div className="unsupported">
            <ShieldAlert size={34} aria-hidden="true" />
            <h1>嵌入网页不可用</h1>
            <p>{unsupportedText}。可用内置浏览器打开当前站点并自动填入文本。</p>
            <button type="button" className="text-button" onClick={() => void openInBrowser()}>
              <ExternalLink size={16} aria-hidden="true" />
              打开 {activeSite.title}
            </button>
          </div>
        ) : (
          <webview
            key={activeSite.id}
            ref={webviewRef as unknown as React.RefObject<HTMLElement>}
            className="translator-webview"
            src={activeSite.url}
            partition={`persist:${PLUGIN_ID}-${activeSite.id}`}
            autosize
            allowpopups
          />
        )}
      </main>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="翻译站点配置"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-header">
              <strong>翻译站点</strong>
              <div className="settings-header-actions">
                <button type="button" className="mini-button" onClick={resetSites}>
                  恢复默认
                </button>
                <button type="button" className="icon-button compact" onClick={() => setSettingsOpen(false)} title="关闭">
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="site-options">
              {allSites.map((site) => {
                const checked = siteSettings.enabledSiteIds.includes(site.id)
                const onlyOneEnabled = checked && siteSettings.enabledSiteIds.length <= 1

                return (
                  <label key={site.id} className="site-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={onlyOneEnabled}
                      onChange={(event) => updateEnabledSite(site.id, event.target.checked)}
                    />
                    <span>{site.title}</span>
                    {site.custom ? (
                      <button type="button" className="mini-button danger" onClick={() => removeCustomSite(site.id)}>
                        删除
                      </button>
                    ) : null}
                  </label>
                )
              })}
            </div>
            <div className="custom-site-form">
              <input
                value={customDraft.title}
                onChange={(event) => setCustomDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder="自定义名称"
              />
              <input
                value={customDraft.url}
                onChange={(event) => setCustomDraft((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://example.com"
              />
              <button type="button" className="mini-button primary" onClick={addCustomSite}>
                <Plus size={14} aria-hidden="true" />
                添加
              </button>
            </div>
            <div className="settings-note">
              <Check size={14} aria-hidden="true" />
              已启用的站点会显示为上方标签页，自定义站点使用通用输入框识别。
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
