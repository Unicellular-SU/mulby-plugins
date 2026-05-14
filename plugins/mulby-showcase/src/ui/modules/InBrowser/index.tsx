import { useCallback, useMemo, useState } from 'react'
import {
    Bot,
    Cookie,
    Database,
    Download,
    Eye,
    FileDown,
    FileText,
    Globe2,
    Image as ImageIcon,
    List,
    MousePointerClick,
    RefreshCw,
    Search,
    Settings2,
    Smartphone,
    TerminalSquare,
    Upload,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type RecipeId =
    | 'extract'
    | 'interaction'
    | 'cookies'
    | 'capture'
    | 'pdf'
    | 'download'
    | 'upload'
    | 'device'
    | 'reuse'
    | 'devtools'

type OperationStatus = 'success' | 'warning' | 'error' | 'info'

interface BrowserInstanceSummary {
    id: number
    url?: string
    title?: string
    width?: number
    height?: number
    x?: number
    y?: number
}

interface ResultSummary {
    index: number
    type: string
    value?: unknown
    length?: number
    byteLength?: number
    keys?: string[]
}

interface RunRecord {
    recipe: RecipeId | 'manager' | 'proxy' | 'clear-proxy'
    status: OperationStatus
    message: string
    timestamp: number
    durationMs?: number
    resultCount?: number
    instance?: BrowserInstanceSummary | null
    outputs?: ResultSummary[]
    error?: string
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

const LOCAL_TEST_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mulby InBrowser Fixture</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 32px; line-height: 1.5; background: #f8fafc; color: #0f172a; }
    main { max-width: 760px; margin: 0 auto; }
    .panel { border: 1px solid #cbd5e1; border-radius: 8px; padding: 16px; margin: 16px 0; background: white; }
    #dropzone { border: 2px dashed #2563eb; min-height: 90px; display: grid; place-items: center; color: #1e40af; }
    #result { min-height: 24px; font-weight: 700; color: #047857; }
    button { padding: 8px 12px; }
    input, textarea { display: block; width: 100%; margin-top: 8px; padding: 8px; box-sizing: border-box; }
    .spacer { height: 900px; }
  </style>
</head>
<body>
  <main>
    <h1>Mulby InBrowser Fixture</h1>
    <p id="intro">This local page is used by the showcase plugin to exercise InBrowser APIs without depending on external websites.</p>
    <div class="panel">
      <label>Search <input id="search" name="q" placeholder="type here"></label>
      <label><input id="accept" type="checkbox"> Accept automation</label>
      <button id="action" type="button" onclick="document.querySelector('#result').textContent = 'clicked:' + document.querySelector('#search').value">Run</button>
      <p id="result"></p>
    </div>
    <div class="panel">
      <textarea id="notes" rows="4" placeholder="paste target"></textarea>
      <input id="file-input" type="file" multiple>
      <div id="dropzone">Drop files here</div>
    </div>
    <div class="spacer"></div>
    <section id="bottom"><h2>Bottom Section</h2><p>Scroll target reached.</p></section>
  </main>
  <script>
    window.__fixtureReady = true;
    document.querySelector('#dropzone').addEventListener('drop', (event) => {
      event.preventDefault();
      document.querySelector('#dropzone').textContent = 'Dropped files: ' + event.dataTransfer.files.length;
    });
    document.querySelector('#dropzone').addEventListener('dragover', (event) => event.preventDefault());
  </script>
</body>
</html>`

const LOCAL_TEST_URL = `data:text/html;charset=utf-8,${encodeURIComponent(LOCAL_TEST_HTML)}`
const EXAMPLE_URL = 'https://example.com'

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString()
}

function summarizeLargeString(value: string) {
    return value.length > 360 ? `${value.slice(0, 360)}...[truncated ${value.length}]` : value
}

function isBrowserInstance(value: unknown): value is BrowserInstanceSummary {
    if (!value || typeof value !== 'object') return false
    const record = value as Record<string, unknown>
    return typeof record.id === 'number' && ('url' in record || 'title' in record)
}

function summarizeValue(value: unknown, index: number): ResultSummary {
    if (value === null) return { index, type: 'null', value: null }
    if (value === undefined) return { index, type: 'undefined' }
    if (typeof value === 'string') {
        return { index, type: 'string', length: value.length, value: summarizeLargeString(value) }
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return { index, type: typeof value, value }
    }
    if (value instanceof ArrayBuffer) {
        return { index, type: 'ArrayBuffer', byteLength: value.byteLength }
    }
    if (value instanceof Uint8Array) {
        return { index, type: 'Uint8Array', byteLength: value.byteLength }
    }
    if (Array.isArray(value)) {
        return { index, type: 'array', length: value.length, value: value.slice(0, 5) }
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        return {
            index,
            type: 'object',
            keys: Object.keys(record).slice(0, 12),
            value: Object.fromEntries(Object.entries(record).slice(0, 8)),
        }
    }
    return { index, type: typeof value, value: String(value) }
}

function splitRunResult(result: unknown[]) {
    const last = result[result.length - 1]
    const instance = isBrowserInstance(last) ? last : null
    const outputs = instance ? result.slice(0, -1) : result

    return {
        instance,
        outputs: outputs.map((value, index) => summarizeValue(value, index)),
    }
}

function createOperationRecord(
    recipe: RunRecord['recipe'],
    status: OperationStatus,
    message: string,
    startedAt: number,
    result?: unknown[],
    error?: string
): RunRecord {
    const parsed = result ? splitRunResult(result) : { instance: null, outputs: [] }
    return {
        recipe,
        status,
        message,
        timestamp: Date.now(),
        durationMs: Date.now() - startedAt,
        resultCount: result?.length,
        instance: parsed.instance,
        outputs: parsed.outputs,
        error,
    }
}

function ensureHttpUrl(url: string) {
    const normalized = url.trim()
    if (!normalized) throw new Error('URL is empty')
    if (normalized.startsWith('data:')) return normalized
    if (!/^https?:\/\//i.test(normalized)) {
        return `https://${normalized}`
    }
    return normalized
}

function pathJoin(base: string, name: string) {
    const separator = base.includes('\\') ? '\\' : '/'
    return `${base.replace(/[\\/]+$/, '')}${separator}${name}`
}

export default function InBrowserDemo() {
    const { inbrowser, system, filesystem, dialog } = useMulby()
    const notify = useNotification()

    const [targetUrl, setTargetUrl] = useState(EXAMPLE_URL)
    const [fixtureText, setFixtureText] = useState('Mulby InBrowser')
    const [showBrowser, setShowBrowser] = useState(false)
    const [useLocalFixture, setUseLocalFixture] = useState(true)
    const [reuseInstanceId, setReuseInstanceId] = useState<number | null>(null)
    const [idleInstances, setIdleInstances] = useState<BrowserInstanceSummary[]>([])
    const [proxyRules, setProxyRules] = useState('')
    const [lastSavePath, setLastSavePath] = useState<string | null>(null)
    const [uploadFilePath, setUploadFilePath] = useState<string | null>(null)
    const [lastRun, setLastRun] = useState<RunRecord | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<RecipeId | 'manager' | 'proxy' | 'clear-proxy' | null>(null)

    const runUrl = useMemo(() => {
        if (useLocalFixture) return LOCAL_TEST_URL
        const trimmed = targetUrl.trim()
        return trimmed ? ensureHttpUrl(trimmed) : EXAMPLE_URL
    }, [targetUrl, useLocalFixture])

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 12))
    }, [])

    const ensureDemoFile = useCallback(async () => {
        if (uploadFilePath && await filesystem.exists(uploadFilePath)) {
            return uploadFilePath
        }

        const tempDir = await system.getPath('temp')
        const filePath = pathJoin(tempDir, `mulby-inbrowser-upload-${Date.now()}.txt`)
        await filesystem.writeFile(filePath, `Mulby InBrowser upload demo\n${new Date().toISOString()}`, 'utf-8')
        setUploadFilePath(filePath)
        return filePath
    }, [filesystem, system, uploadFilePath])

    const chooseUploadFile = useCallback(async () => {
        try {
            const [filePath] = await dialog.showOpenDialog({
                title: '选择用于 InBrowser file/drop 的文件',
                properties: ['openFile'],
            })
            if (filePath) {
                setUploadFilePath(filePath)
                pushOperation({
                    action: 'dialog.showOpenDialog',
                    status: 'success',
                    message: '已选择上传/拖放文件',
                    details: { filePath },
                })
            }
        } catch (error) {
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('选择文件失败')
        }
    }, [dialog, notify, pushOperation])

    const chooseSavePath = useCallback(async (defaultName: string, extensions: string[]) => {
        const selected = await dialog.showSaveDialog({
            title: '选择保存路径',
            defaultPath: defaultName,
            filters: [{ name: defaultName.split('.').pop()?.toUpperCase() || 'File', extensions }],
        })
        if (selected) setLastSavePath(selected)
        return selected
    }, [dialog])

    const runRecipe = useCallback(async (recipe: RecipeId) => {
        const startedAt = Date.now()
        setLoadingAction(recipe)
        try {
            let result: unknown[] = []
            let message = ''
            const options: InBrowserOptions = {
                width: 980,
                height: 720,
                show: showBrowser,
                center: true,
                backgroundColor: '#ffffff',
            }
            const idArg = recipe === 'reuse' && reuseInstanceId ? reuseInstanceId : undefined

            if (recipe === 'extract') {
                result = await inbrowser
                    .goto(runUrl, { 'User-Agent': 'MulbyShowcase/1.0' }, 15000)
                    .viewport(980, 720)
                    .when(() => Boolean(document.body))
                    .evaluate(() => ({
                        title: document.title,
                        href: location.href,
                        text: document.body.innerText.slice(0, 260),
                    }))
                    .markdown('body')
                    .run(idArg ?? options, idArg ? options : undefined)
                message = '已提取标题、正文摘要和 Markdown'
            } else if (recipe === 'interaction') {
                result = await inbrowser
                    .goto(LOCAL_TEST_URL)
                    .show()
                    .viewport(980, 720)
                    .wait('#search')
                    .focus('#search')
                    .input(fixtureText)
                    .value('#search', fixtureText)
                    .check('#accept', true)
                    .hover('#action')
                    .mousedown('#action')
                    .mouseup('#action')
                    .dblclick('#action')
                    .click('#action')
                    .scroll('#bottom', { block: 'center' })
                    .evaluate(() => ({
                        value: document.querySelector<HTMLInputElement>('#search')?.value,
                        checked: document.querySelector<HTMLInputElement>('#accept')?.checked,
                        result: document.querySelector('#result')?.textContent,
                        scrollY: window.scrollY,
                    }))
                    .run(options)
                message = '已执行输入、鼠标、勾选和滚动操作'
            } else if (recipe === 'cookies') {
                result = await inbrowser
                    .goto(EXAMPLE_URL, {}, 15000)
                    .setCookies('showcase', fixtureText)
                    .cookies('showcase')
                    .removeCookies('showcase')
                    .cookies('showcase')
                    .clearCookies()
                    .run(options)
                message = '已设置、读取、删除并清理 Cookie'
            } else if (recipe === 'capture') {
                const savePath = await chooseSavePath(`mulby-inbrowser-${Date.now()}.png`, ['png'])
                result = await inbrowser
                    .goto(runUrl, {}, 15000)
                    .viewport(980, 720)
                    .css('body { outline: 6px solid #2563eb; outline-offset: -6px; }')
                    .screenshot('body', savePath || undefined)
                    .run(options)
                message = savePath ? '已保存页面截图' : '已返回页面截图数据'
            } else if (recipe === 'pdf') {
                const savePath = await chooseSavePath(`mulby-inbrowser-${Date.now()}.pdf`, ['pdf'])
                if (!savePath) {
                    pushOperation({
                        action: 'inbrowser.pdf',
                        status: 'info',
                        message: '已取消保存 PDF',
                    })
                    return
                }
                result = await inbrowser
                    .goto(runUrl, {}, 15000)
                    .viewport(980, 720)
                    .pdf({ printBackground: true }, savePath)
                    .run(options)
                message = '已保存 PDF'
            } else if (recipe === 'download') {
                const downloads = await system.getPath('downloads')
                const savePath = pathJoin(downloads, `mulby-inbrowser-download-${Date.now()}.html`)
                result = await inbrowser
                    .goto(EXAMPLE_URL, {}, 15000)
                    .download(() => location.href, savePath)
                    .run({ ...options, show: true })
                setLastSavePath(savePath)
                message = '已触发下载并设置保存路径'
            } else if (recipe === 'upload') {
                const filePath = await ensureDemoFile()
                result = await inbrowser
                    .goto(LOCAL_TEST_URL)
                    .show()
                    .wait('#file-input')
                    .file('#file-input', filePath)
                    .drop('#dropzone', filePath)
                    .evaluate(() => ({
                        fileCount: document.querySelector<HTMLInputElement>('#file-input')?.files?.length || 0,
                        dropzone: document.querySelector('#dropzone')?.textContent,
                    }))
                    .run(options)
                message = '已执行文件选择和拖放'
            } else if (recipe === 'device') {
                result = await inbrowser
                    .device('iPhone X')
                    .goto(LOCAL_TEST_URL)
                    .show()
                    .wait(() => Boolean((window as unknown as { __fixtureReady?: boolean }).__fixtureReady))
                    .evaluate(() => ({
                        userAgent: navigator.userAgent,
                        width: window.innerWidth,
                        height: window.innerHeight,
                    }))
                    .end()
                    .run({ show: true })
                message = '已用移动设备预设运行并关闭窗口'
            } else if (recipe === 'reuse') {
                const initial = reuseInstanceId
                    ? await inbrowser
                        .goto(LOCAL_TEST_URL)
                        .hide()
                        .wait('#search')
                        .value('#search', `${fixtureText} reused`)
                        .evaluate(() => ({
                            title: document.title,
                            value: document.querySelector<HTMLInputElement>('#search')?.value,
                        }))
                        .run(reuseInstanceId, options)
                    : await inbrowser
                        .goto(LOCAL_TEST_URL)
                        .hide()
                        .wait('#search')
                        .evaluate(() => ({ title: document.title, hidden: true }))
                        .run({ ...options, show: false })
                result = initial
                message = reuseInstanceId ? '已复用隐藏 InBrowser 实例' : '已创建隐藏 InBrowser 实例'
            } else if (recipe === 'devtools') {
                result = await inbrowser
                    .goto(LOCAL_TEST_URL)
                    .show()
                    .devTools('right')
                    .wait(500)
                    .run({ ...options, show: true })
                message = '已打开 InBrowser DevTools'
            }

            const record = createOperationRecord(recipe, 'success', message, startedAt, result)
            setLastRun(record)
            if (record.instance?.id) {
                setReuseInstanceId(record.instance.id)
            }
            pushOperation({
                action: `inbrowser.${recipe}`,
                status: 'success',
                message,
                details: record,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            const record = createOperationRecord(recipe, 'error', message, startedAt, undefined, message)
            setLastRun(record)
            pushOperation({
                action: `inbrowser.${recipe}`,
                status: 'error',
                message,
            })
            notify.error(`InBrowser ${recipe} 执行失败`)
        } finally {
            setLoadingAction(null)
        }
    }, [chooseSavePath, ensureDemoFile, fixtureText, inbrowser, notify, pushOperation, reuseInstanceId, runUrl, showBrowser, system])

    const loadIdleInstances = useCallback(async () => {
        const startedAt = Date.now()
        setLoadingAction('manager')
        try {
            const instances = await inbrowser.getIdleInBrowsers()
            setIdleInstances(instances)
            const record = createOperationRecord('manager', 'success', `已读取 ${instances.length} 个空闲实例`, startedAt, [instances])
            setLastRun(record)
            pushOperation({
                action: 'inbrowser.getIdleInBrowsers',
                status: 'success',
                message: record.message,
                details: instances,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({
                action: 'inbrowser.getIdleInBrowsers',
                status: 'error',
                message,
            })
            notify.error('读取 InBrowser 实例失败')
        } finally {
            setLoadingAction(null)
        }
    }, [inbrowser, notify, pushOperation])

    const clearCache = useCallback(async () => {
        setLoadingAction('manager')
        try {
            const success = await inbrowser.clearInBrowserCache()
            pushOperation({
                action: 'inbrowser.clearInBrowserCache',
                status: success ? 'success' : 'warning',
                message: success ? '缓存已清理' : '宿主未返回成功',
            })
        } catch (error) {
            pushOperation({
                action: 'inbrowser.clearInBrowserCache',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('清理 InBrowser 缓存失败')
        } finally {
            setLoadingAction(null)
        }
    }, [inbrowser, notify, pushOperation])

    const applyProxy = useCallback(async () => {
        setLoadingAction('proxy')
        try {
            const success = await inbrowser.setInBrowserProxy(
                proxyRules.trim()
                    ? { proxyRules: proxyRules.trim() }
                    : { proxyRules: 'direct://' }
            )
            pushOperation({
                action: 'inbrowser.setInBrowserProxy',
                status: success ? 'success' : 'warning',
                message: proxyRules.trim() ? '已设置 InBrowser 代理' : '已切换为直连代理配置',
                details: proxyRules.trim() ? { proxyRules } : { proxyRules: 'direct://' },
            })
        } catch (error) {
            pushOperation({
                action: 'inbrowser.setInBrowserProxy',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('设置 InBrowser 代理失败')
        } finally {
            setLoadingAction(null)
        }
    }, [inbrowser, notify, proxyRules, pushOperation])

    const clearProxy = useCallback(async () => {
        setProxyRules('')
        setLoadingAction('clear-proxy')
        try {
            const success = await inbrowser.setInBrowserProxy({ proxyRules: 'direct://' })
            pushOperation({
                action: 'inbrowser.setInBrowserProxy direct',
                status: success ? 'success' : 'warning',
                message: '已设置 InBrowser 直连',
            })
        } catch (error) {
            pushOperation({
                action: 'inbrowser.setInBrowserProxy direct',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('清除代理失败')
        } finally {
            setLoadingAction(null)
        }
    }, [inbrowser, notify, pushOperation])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Navigation and Window',
            items: [
                { name: 'inbrowser.goto(url, headers, timeout)', description: '加载页面并可设置请求头和导航超时。' },
                { name: 'inbrowser.show() / hide()', description: '显示或隐藏 InBrowser 窗口。' },
                { name: 'inbrowser.viewport(width, height)', description: '设置 InBrowser 窗口视口尺寸。' },
                { name: 'inbrowser.useragent(ua)', description: '设置 User-Agent。' },
                { name: 'inbrowser.device(name | options)', description: '应用移动设备预设或自定义 UA/尺寸。' },
                { name: 'inbrowser.devTools(mode)', description: '打开 InBrowser DevTools。' },
                { name: 'inbrowser.end()', description: '结束并销毁当前 InBrowser 实例。' },
                { name: 'builder.run(options)', description: '执行当前链式队列并返回结果数组，末尾通常是实例信息。' },
                { name: 'builder.run(id, options)', description: '复用已有 InBrowser 实例继续执行队列。' },
            ],
        },
        {
            title: 'Interaction',
            items: [
                { name: 'inbrowser.when(selector | fn)', description: '等待选择器或条件成立。' },
                { name: 'inbrowser.wait(ms | selector | fn)', description: '等待时间、元素或自定义条件。' },
                { name: 'inbrowser.focus(selector)', description: '聚焦元素。' },
                { name: 'inbrowser.input(text) / input(selector, text)', description: '输入文本到当前焦点或指定元素。' },
                { name: 'inbrowser.type(selector, text)', description: '向指定元素输入文本，兼容旧方法。' },
                { name: 'inbrowser.value(selector, value)', description: '直接设置输入控件值并触发 input/change。' },
                { name: 'inbrowser.press(key, modifiers)', description: '模拟键盘按键。' },
                { name: 'inbrowser.paste(text)', description: '写入剪贴板并在页面内粘贴。' },
                { name: 'inbrowser.click/mousedown/mouseup/dblclick', description: '按选择器或坐标发送鼠标事件。' },
                { name: 'inbrowser.hover(selector | x, y)', description: '移动鼠标到元素或坐标。' },
                { name: 'inbrowser.check(selector, checked)', description: '设置 checkbox/radio 状态。' },
                { name: 'inbrowser.scroll(...)', description: '滚动页面、坐标或元素。' },
            ],
        },
        {
            title: 'Extraction and Files',
            items: [
                { name: 'inbrowser.evaluate(fn, ...params)', description: '在页面上下文执行函数并返回结果。' },
                { name: 'inbrowser.css(cssText)', description: '向页面插入 CSS。' },
                { name: 'inbrowser.markdown(selector)', description: '提取元素文本作为 Markdown 内容。' },
                { name: 'inbrowser.screenshot(target, savePath)', description: '按页面、元素或矩形截图，可保存到路径或返回 PNG 数据。' },
                { name: 'inbrowser.pdf(options, savePath)', description: '生成 PDF，可保存到文件或返回数据。' },
                { name: 'inbrowser.download(urlOrFunc, savePath)', description: '触发下载，URL 可由页面函数动态返回。' },
                { name: 'inbrowser.file(selector, payload)', description: '给 file input 设置本地文件。' },
                { name: 'inbrowser.drop(selector | x, y, payload)', description: '向页面元素或坐标模拟文件拖放。' },
            ],
        },
        {
            title: 'Cookies and Manager',
            items: [
                { name: 'inbrowser.cookies(nameOrFilter)', description: '读取当前 InBrowser session 的 Cookie。' },
                { name: 'inbrowser.setCookies(name, value)', description: '写入 Cookie。' },
                { name: 'inbrowser.removeCookies(name)', description: '删除当前页面 URL 下指定 Cookie。' },
                { name: 'inbrowser.clearCookies(url)', description: '清理 Cookie，可按 URL 限定。' },
                { name: 'inbrowser.getIdleInBrowsers()', description: '列出隐藏且仍存活的 InBrowser 实例。' },
                { name: 'inbrowser.setInBrowserProxy(config)', description: '设置 InBrowser 代理配置，作用于现有和后续实例。' },
                { name: 'inbrowser.clearInBrowserCache()', description: '清理默认和活跃 InBrowser session 缓存。' },
            ],
        },
        {
            title: 'Related APIs Used By This Page',
            items: [
                { name: 'dialog.showSaveDialog(options)', description: '选择截图/PDF 保存路径。' },
                { name: 'dialog.showOpenDialog(options)', description: '选择上传或拖放文件。' },
                { name: 'system.getPath("temp" | "downloads")', description: '生成测试文件或下载保存路径。' },
                { name: 'filesystem.writeFile(path, data, encoding)', description: '写入用于 file/drop 的临时文件。' },
                { name: 'filesystem.exists(path)', description: '确认临时文件仍存在。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '提取页面内容',
            code: `const result = await window.mulby.inbrowser
  .goto('https://example.com', {}, 15000)
  .viewport(980, 720)
  .when(() => Boolean(document.body))
  .evaluate(() => ({ title: document.title, href: location.href, text: document.body.innerText.slice(0, 260) }))
  .markdown('body')
  .run({ show: false, width: 980, height: 720 })`,
        },
        {
            title: '页面交互',
            code: `await window.mulby.inbrowser
  .goto(localFixtureUrl)
  .show()
  .wait('#search')
  .focus('#search')
  .input('Mulby InBrowser')
  .check('#accept', true)
  .hover('#action')
  .click('#action')
  .scroll('#bottom', { block: 'center' })
  .run({ show: true, width: 980, height: 720 })`,
        },
        {
            title: '截图、PDF 和下载',
            code: `await window.mulby.inbrowser
  .goto('https://example.com')
  .screenshot('body', 'D:/tmp/example.png')
  .pdf({ printBackground: true }, 'D:/tmp/example.pdf')
  .download(() => location.href, 'D:/tmp/example.html')
  .run({ show: true })`,
        },
        {
            title: '文件上传、拖放和实例复用',
            code: `const result = await window.mulby.inbrowser
  .goto(localFixtureUrl)
  .hide()
  .file('#file-input', filePath)
  .drop('#dropzone', filePath)
  .run({ show: false })

const instance = result.at(-1)

await window.mulby.inbrowser
  .goto(localFixtureUrl)
  .value('#search', 'reuse')
  .run(instance.id, { show: false })`,
        },
        {
            title: 'Cookie、代理和缓存',
            code: `await window.mulby.inbrowser
  .goto(localFixtureUrl)
  .setCookies('showcase', 'Mulby')
  .cookies('showcase')
  .removeCookies('showcase')
  .clearCookies()
  .run()

await window.mulby.inbrowser.setInBrowserProxy({ proxyRules: 'direct://' })
const idle = await window.mulby.inbrowser.getIdleInBrowsers()
await window.mulby.inbrowser.clearInBrowserCache()`,
        },
    ], [])

    const rawData = useMemo(() => ({
        form: {
            targetUrl,
            useLocalFixture,
            showBrowser,
            fixtureText,
            reuseInstanceId,
            proxyRules: proxyRules ? '[configured]' : '',
        },
        paths: {
            lastSavePath,
            uploadFilePath,
        },
        idleInstances,
        lastRun,
        operationLog,
    }), [fixtureText, idleInstances, lastRun, lastSavePath, operationLog, proxyRules, reuseInstanceId, showBrowser, targetUrl, uploadFilePath, useLocalFixture])

    return (
        <div className="main-content">
            <PageHeader
                icon={Bot}
                title="InBrowser"
                description="链式自动化浏览器：导航、交互、提取、截图/PDF、文件、Cookie 和实例管理"
                actions={
                    <Button variant="secondary" onClick={() => void loadIdleInstances()} loading={loadingAction === 'manager'}>
                        <RefreshCw aria-hidden="true" size={14} />刷新实例
                    </Button>
                }
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon"><Globe2 aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{useLocalFixture ? 'Local' : 'HTTP'}</div>
                            <div className="stat-label">目标页面</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><Database aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{reuseInstanceId ?? '-'}</div>
                            <div className="stat-label">复用实例</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><List aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{idleInstances.length}</div>
                            <div className="stat-label">空闲实例</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><TerminalSquare aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{lastRun?.status ?? 'idle'}</div>
                            <div className="stat-label">最近执行</div>
                        </div>
                    </div>

                    <Card title="运行配置" icon={Settings2}>
                        <div className="grid grid-2">
                            <div className="input-group">
                                <label className="input-label" htmlFor="inbrowser-url">外部 URL</label>
                                <input
                                    id="inbrowser-url"
                                    className="input"
                                    value={targetUrl}
                                    onChange={(event) => setTargetUrl(event.target.value)}
                                />
                            </div>
                            <div className="input-group">
                                <label className="input-label" htmlFor="inbrowser-text">测试输入文本</label>
                                <input
                                    id="inbrowser-text"
                                    className="input"
                                    value={fixtureText}
                                    onChange={(event) => setFixtureText(event.target.value)}
                                />
                            </div>
                        </div>
                        <div className="action-bar" style={{ marginTop: 'var(--spacing-md)' }}>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
                                <input
                                    type="checkbox"
                                    checked={useLocalFixture}
                                    onChange={(event) => setUseLocalFixture(event.target.checked)}
                                />
                                <span>使用本地测试页</span>
                            </label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--spacing-xs)' }}>
                                <input
                                    type="checkbox"
                                    checked={showBrowser}
                                    onChange={(event) => setShowBrowser(event.target.checked)}
                                />
                                <span>显示 InBrowser 窗口</span>
                            </label>
                            <Button variant="secondary" onClick={() => setReuseInstanceId(null)} disabled={reuseInstanceId === null}>清空复用 ID</Button>
                        </div>
                    </Card>

                    <div className="grid grid-2">
                        <Card title="提取与交互" icon={MousePointerClick}>
                            <div className="action-bar">
                                <Button onClick={() => void runRecipe('extract')} loading={loadingAction === 'extract'}>
                                    <Search aria-hidden="true" size={14} />提取标题/Markdown
                                </Button>
                                <Button variant="secondary" onClick={() => void runRecipe('interaction')} loading={loadingAction === 'interaction'}>
                                    <MousePointerClick aria-hidden="true" size={14} />本地交互链
                                </Button>
                                <Button variant="secondary" onClick={() => void runRecipe('device')} loading={loadingAction === 'device'}>
                                    <Smartphone aria-hidden="true" size={14} />移动设备预设
                                </Button>
                                <Button variant="secondary" onClick={() => void runRecipe('devtools')} loading={loadingAction === 'devtools'}>
                                    <TerminalSquare aria-hidden="true" size={14} />打开 DevTools
                                </Button>
                            </div>
                        </Card>

                        <Card title="Cookie 与实例" icon={Cookie}>
                            <div className="action-bar">
                                <Button variant="secondary" onClick={() => void runRecipe('cookies')} loading={loadingAction === 'cookies'}>
                                    <Cookie aria-hidden="true" size={14} />Cookie 流程
                                </Button>
                                <Button variant="secondary" onClick={() => void runRecipe('reuse')} loading={loadingAction === 'reuse'}>
                                    <Database aria-hidden="true" size={14} />隐藏实例/复用
                                </Button>
                                <Button variant="secondary" onClick={() => void loadIdleInstances()} loading={loadingAction === 'manager'}>
                                    <List aria-hidden="true" size={14} />读取空闲实例
                                </Button>
                                <Button variant="secondary" onClick={() => void clearCache()} loading={loadingAction === 'manager'}>
                                    <RefreshCw aria-hidden="true" size={14} />清理缓存
                                </Button>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2">
                        <Card title="文件输出" icon={FileDown}>
                            <div className="action-bar">
                                <Button variant="secondary" onClick={() => void runRecipe('capture')} loading={loadingAction === 'capture'}>
                                    <ImageIcon aria-hidden="true" size={14} />截图
                                </Button>
                                <Button variant="secondary" onClick={() => void runRecipe('pdf')} loading={loadingAction === 'pdf'}>
                                    <FileText aria-hidden="true" size={14} />保存 PDF
                                </Button>
                                <Button variant="secondary" onClick={() => void runRecipe('download')} loading={loadingAction === 'download'}>
                                    <Download aria-hidden="true" size={14} />下载 HTML
                                </Button>
                            </div>
                            <div className="info-grid" style={{ marginTop: 'var(--spacing-md)' }}>
                                <span className="info-label">最近保存</span>
                                <span className="info-value">{lastSavePath || '-'}</span>
                            </div>
                        </Card>

                        <Card title="文件输入/拖放" icon={Upload}>
                            <div className="action-bar">
                                <Button variant="secondary" onClick={() => void chooseUploadFile()}>
                                    <Upload aria-hidden="true" size={14} />选择文件
                                </Button>
                                <Button variant="secondary" onClick={() => void ensureDemoFile()} loading={loadingAction === 'upload'}>
                                    <FileText aria-hidden="true" size={14} />生成测试文件
                                </Button>
                                <Button onClick={() => void runRecipe('upload')} loading={loadingAction === 'upload'}>
                                    <Upload aria-hidden="true" size={14} />执行 file/drop
                                </Button>
                            </div>
                            <div className="info-grid" style={{ marginTop: 'var(--spacing-md)' }}>
                                <span className="info-label">当前文件</span>
                                <span className="info-value">{uploadFilePath || '-'}</span>
                            </div>
                        </Card>
                    </div>

                    <Card title="代理配置" icon={Settings2}>
                        <div className="input-group">
                            <label className="input-label" htmlFor="inbrowser-proxy">proxyRules</label>
                            <input
                                id="inbrowser-proxy"
                                className="input"
                                value={proxyRules}
                                onChange={(event) => setProxyRules(event.target.value)}
                                placeholder="例如 http=127.0.0.1:7890;https=127.0.0.1:7890"
                            />
                        </div>
                        <div className="action-bar" style={{ marginTop: 'var(--spacing-md)' }}>
                            <Button variant="secondary" onClick={() => void applyProxy()} loading={loadingAction === 'proxy'}>应用代理</Button>
                            <Button variant="secondary" onClick={() => void clearProxy()} loading={loadingAction === 'clear-proxy'}>直连</Button>
                        </div>
                    </Card>

                    {lastRun && (
                        <Card title="最近结果" icon={Eye}>
                            <div className="info-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <span className="info-label">Recipe</span>
                                <span className="info-value">{lastRun.recipe}</span>
                                <span className="info-label">Status</span>
                                <span className="info-value">{lastRun.status}</span>
                                <span className="info-label">Duration</span>
                                <span className="info-value">{lastRun.durationMs ?? 0} ms</span>
                                <span className="info-label">Instance</span>
                                <span className="info-value">{lastRun.instance?.id ?? '-'}</span>
                            </div>
                            <CodeBlock>{JSON.stringify(lastRun, null, 2)}</CodeBlock>
                        </Card>
                    )}

                    <div className="grid grid-2">
                        <Card title="空闲实例" icon={Database}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {idleInstances.length > 0 ? idleInstances.map(instance => (
                                    <div className="list-row" key={instance.id}>
                                        <StatusBadge status={reuseInstanceId === instance.id ? 'success' : 'info'}>id {instance.id}</StatusBadge>
                                        <span className="list-row-main">{instance.title || instance.url || 'untitled'}</span>
                                        <Button variant="secondary" onClick={() => setReuseInstanceId(instance.id)}>复用</Button>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <Database aria-hidden="true" size={28} />
                                        <p>没有空闲隐藏实例</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card title="操作日志" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length > 0 ? operationLog.map((item, index) => (
                                    <div key={`${item.timestamp}-${index}`} className="list-row">
                                        <StatusBadge status={item.status}>{item.status}</StatusBadge>
                                        <span className="list-row-main">{item.action}</span>
                                        <span className="list-row-meta">{item.message}</span>
                                        <span className="list-row-meta">{formatTime(item.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <List aria-hidden="true" size={28} />
                                        <p>暂无操作记录</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
