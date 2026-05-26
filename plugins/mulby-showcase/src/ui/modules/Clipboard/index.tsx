import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    ChartNoAxesColumn,
    Clipboard as ClipboardIcon,
    Copy,
    Eye,
    FileText,
    FolderOpen,
    Heart,
    Image,
    Inbox,
    Palette,
    PenLine,
    RefreshCw,
    Search,
    Star,
    Trash2,
    Upload,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type ClipboardFormat = 'text' | 'image' | 'files' | 'html' | 'empty'
type HistoryTypeFilter = 'all' | 'text' | 'image' | 'files'

interface ClipboardFile {
    path: string
    name: string
    size: number
    type?: string
    isDirectory: boolean
}

interface ClipboardHistoryItem {
    id: string
    type: 'text' | 'image' | 'files'
    content: string
    plainText?: string
    files?: string[]
    timestamp: number
    size: number
    favorite: boolean
    tags?: string[]
    sourceApp?: string
    sourceTitle?: string
}

interface ClipboardHistoryStats {
    total: number
    text: number
    image: number
    files: number
    favorite: number
}

interface HostCallResponse<T> {
    success: boolean
    data: T
    error?: string
}

interface ShowcaseHost {
    call<T>(method: string, ...args: unknown[]): Promise<HostCallResponse<T>>
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'

function arrayBufferToDataUrl(buffer: ArrayBuffer) {
    const bytes = new Uint8Array(buffer)
    const chunkSize = 0x8000
    let binary = ''
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return `data:image/png;base64,${btoa(binary)}`
}

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function summarizeHistoryItem(item: ClipboardHistoryItem) {
    if (item.type === 'files') {
        return item.files?.join('\n') || '(无文件路径)'
    }
    if (item.type === 'image') {
        return `图片数据 ${formatFileSize(item.size)}`
    }
    return item.plainText || item.content || '(空文本)'
}

function redactHistoryItem(item: ClipboardHistoryItem) {
    return {
        ...item,
        content: item.type === 'image' ? '[image data omitted]' : item.content.slice(0, 300),
        plainText: item.plainText ? item.plainText.slice(0, 300) : undefined,
    }
}

export function ClipboardModule() {
    const { clipboard, dialog, host } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [format, setFormat] = useState<ClipboardFormat>('empty')
    const [textContent, setTextContent] = useState('')
    const [imageData, setImageData] = useState<string | null>(null)
    const [files, setFiles] = useState<ClipboardFile[]>([])
    const [inputText, setInputText] = useState('')
    const [loading, setLoading] = useState(false)
    const [historyLoading, setHistoryLoading] = useState(false)
    const [historyItems, setHistoryItems] = useState<ClipboardHistoryItem[]>([])
    const [selectedHistoryItem, setSelectedHistoryItem] = useState<ClipboardHistoryItem | null>(null)
    const [historyStats, setHistoryStats] = useState<ClipboardHistoryStats | null>(null)
    const [historyType, setHistoryType] = useState<HistoryTypeFilter>('all')
    const [historySearch, setHistorySearch] = useState('')
    const [favoriteOnly, setFavoriteOnly] = useState(false)

    const readClipboard = useCallback(async () => {
        setLoading(true)
        try {
            const fmt = await clipboard.getFormat()
            setFormat(fmt || 'empty')

            switch (fmt) {
                case 'text': {
                    const text = await clipboard.readText()
                    setTextContent(text || '')
                    setImageData(null)
                    setFiles([])
                    break
                }
                case 'image': {
                    const img = await clipboard.readImage()
                    setImageData(img ? arrayBufferToDataUrl(img) : null)
                    setTextContent('')
                    setFiles([])
                    break
                }
                case 'files': {
                    const fileList = await clipboard.readFiles()
                    setFiles(fileList || [])
                    setTextContent('')
                    setImageData(null)
                    break
                }
                default:
                    setTextContent('')
                    setImageData(null)
                    setFiles([])
            }
        } catch (error) {
            notify.error('读取剪贴板失败')
            console.error(error)
        } finally {
            setLoading(false)
        }
    }, [clipboard, notify])

    const callHistoryRpc = useCallback(async <T,>(method: string, ...args: unknown[]) => {
        const result = await showcaseHost.call<T>(method, ...args)
        if (!result.success) {
            throw new Error(result.error || `RPC 调用失败：${method}`)
        }
        return result.data
    }, [showcaseHost])

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true)
        try {
            const [stats, items] = await Promise.all([
                callHistoryRpc<ClipboardHistoryStats>('getClipboardHistoryStats'),
                callHistoryRpc<ClipboardHistoryItem[]>('queryClipboardHistory', {
                    type: historyType === 'all' ? undefined : historyType,
                    search: historySearch.trim() || undefined,
                    favorite: favoriteOnly ? true : undefined,
                    limit: 20,
                    offset: 0,
                }),
            ])
            setHistoryStats(stats)
            setHistoryItems(items)
            setSelectedHistoryItem(current => {
                if (!current) return items[0] ?? null
                return items.find(item => item.id === current.id) ?? items[0] ?? null
            })
        } catch (error) {
            notify.error('加载剪贴板历史失败')
            console.error(error)
        } finally {
            setHistoryLoading(false)
        }
    }, [callHistoryRpc, favoriteOnly, historySearch, historyType, notify])

    useEffect(() => {
        readClipboard()
    }, [readClipboard])

    useEffect(() => {
        loadHistory()
    }, [loadHistory])

    const refreshAll = async () => {
        await Promise.all([readClipboard(), loadHistory()])
    }

    const handleWriteText = async () => {
        if (!inputText.trim()) {
            notify.warning('请输入要写入的内容')
            return
        }
        try {
            await clipboard.writeText(inputText)
            notify.success('已写入剪贴板')
            setInputText('')
            await refreshAll()
        } catch (error) {
            notify.error('写入失败')
            console.error(error)
        }
    }

    const handleWriteSampleText = async () => {
        const sampleText = `Mulby Showcase - 测试文本
时间: ${new Date().toLocaleString()}
这是一段测试文本，用于演示剪贴板写入功能。`
        try {
            await clipboard.writeText(sampleText)
            notify.success('已写入测试文本')
            await refreshAll()
        } catch (error) {
            notify.error('写入失败')
            console.error(error)
        }
    }

    const handleCopyFromContent = async () => {
        if (format === 'text' && textContent) {
            await clipboard.writeText(textContent)
            notify.success('内容已复制')
            await loadHistory()
        }
    }

    const handleWriteFiles = async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: '选择要复制的文件',
                properties: ['openFile', 'multiSelections']
            })
            if (result && result.length > 0) {
                await clipboard.writeFiles(result)
                notify.success(`已复制 ${result.length} 个文件`)
                await refreshAll()
            }
        } catch (error) {
            notify.error('复制文件失败')
            console.error(error)
        }
    }

    const handleWriteImageFromPath = async () => {
        try {
            const result = await dialog.showOpenDialog({
                title: '选择图片',
                filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] }],
                properties: ['openFile']
            })
            if (result && result.length > 0) {
                const ok = await clipboard.writeImage(result[0])
                if (ok === false) {
                    notify.error('写入图片失败')
                    return
                }
                notify.success('图片路径已写入剪贴板')
                await refreshAll()
            }
        } catch (error) {
            notify.error('写入图片失败')
            console.error(error)
        }
    }

    const handleWriteImageBase64 = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 100
        canvas.height = 100
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            notify.error('Canvas 不可用')
            return
        }
        ctx.fillStyle = '#2563eb'
        ctx.fillRect(0, 0, 100, 100)
        ctx.fillStyle = '#ffffff'
        ctx.font = '20px Arial'
        ctx.fillText('Test', 30, 55)
        try {
            const ok = await clipboard.writeImage(canvas.toDataURL('image/png'))
            if (ok === false) {
                notify.error('写入图片失败')
                return
            }
            notify.success('Data URL 图片已写入剪贴板')
            await refreshAll()
        } catch (error) {
            notify.error('写入 Data URL 图片失败')
            console.error(error)
        }
    }

    const handleCopyHistoryItem = async (id: string) => {
        const result = await callHistoryRpc<{ success: boolean; error?: string }>('copyClipboardHistoryItem', id)
        if (result.success) {
            notify.success('历史记录已复制到剪贴板')
            await readClipboard()
        } else {
            notify.error(result.error || '复制历史记录失败')
        }
    }

    const handleSelectHistoryItem = async (id: string) => {
        try {
            const item = await callHistoryRpc<ClipboardHistoryItem | null>('getClipboardHistoryItem', id)
            if (item) {
                setSelectedHistoryItem(item)
            }
        } catch (error) {
            notify.error('读取历史详情失败')
            console.error(error)
        }
    }

    const handleToggleFavorite = async (id: string) => {
        const result = await callHistoryRpc<{ success: boolean }>('toggleClipboardHistoryFavorite', id)
        if (result.success) {
            await loadHistory()
        } else {
            notify.error('切换收藏失败')
        }
    }

    const handleDeleteHistoryItem = async (id: string) => {
        const result = await callHistoryRpc<{ success: boolean }>('deleteClipboardHistoryItem', id)
        if (result.success) {
            notify.success('历史记录已删除')
            await loadHistory()
        } else {
            notify.error('删除历史记录失败')
        }
    }

    const handleClearHistory = async () => {
        const result = await callHistoryRpc<{ success: boolean }>('clearClipboardHistory')
        if (result.success) {
            notify.success('已清空非收藏历史记录')
            await loadHistory()
        } else {
            notify.error('清空历史记录失败')
        }
    }

    const getFormatBadge = () => {
        switch (format) {
            case 'text':
                return <StatusBadge status="info">文本</StatusBadge>
            case 'image':
                return <StatusBadge status="success">图片</StatusBadge>
            case 'files':
                return <StatusBadge status="warning">文件</StatusBadge>
            case 'html':
                return <StatusBadge status="info">HTML</StatusBadge>
            default:
                return <StatusBadge status="error">空</StatusBadge>
        }
    }

    const historyTypeLabel = (type: ClipboardHistoryItem['type']) => {
        switch (type) {
            case 'text':
                return '文本'
            case 'image':
                return '图片'
            case 'files':
                return '文件'
        }
    }

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Clipboard API',
            items: [
                { name: 'clipboard.getFormat()', description: '获取当前剪贴板内容格式。' },
                { name: 'clipboard.readText()', description: '读取剪贴板文本内容。' },
                { name: 'clipboard.writeText(text)', description: '写入文本到剪贴板。' },
                { name: 'clipboard.readImage()', description: '读取剪贴板图片 PNG 数据。' },
                { name: 'clipboard.writeImage(image)', description: '写入图片，渲染进程支持文件路径、Data URL、ArrayBuffer。' },
                { name: 'clipboard.readFiles()', description: '读取剪贴板文件列表。' },
                { name: 'clipboard.writeFiles(filePaths)', description: '将一个或多个文件路径写入剪贴板。' },
            ],
        },
        {
            title: 'Clipboard History API (backend)',
            items: [
                { name: 'mulby.clipboardHistory.query(options)', description: '后端查询历史记录，支持类型、搜索、收藏和分页过滤。' },
                { name: 'mulby.clipboardHistory.get(id)', description: '后端按 ID 获取单条历史记录。' },
                { name: 'mulby.clipboardHistory.copy(id)', description: '后端将历史记录重新复制到系统剪贴板。' },
                { name: 'mulby.clipboardHistory.toggleFavorite(id)', description: '后端切换历史记录收藏状态。' },
                { name: 'mulby.clipboardHistory.delete(id)', description: '后端删除单条历史记录。' },
                { name: 'mulby.clipboardHistory.clear()', description: '后端清空非收藏历史记录。' },
                { name: 'mulby.clipboardHistory.stats()', description: '后端获取历史记录总数、类型数量和收藏数量。' },
            ],
        },
        {
            title: 'Host RPC Bridge',
            items: [
                { name: 'host.call(pluginId, method, ...args)', description: 'UI 调用插件后端导出的 rpc 方法；本页面用它访问剪贴板历史。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '读取当前剪贴板',
            code: `const format = await window.mulby.clipboard.getFormat()

if (format === 'text') {
  const text = await window.mulby.clipboard.readText()
  console.log(text)
}

if (format === 'files') {
  const files = await window.mulby.clipboard.readFiles()
  console.log(files)
}`,
        },
        {
            title: '写入文本、图片和文件',
            code: `await window.mulby.clipboard.writeText('Hello Mulby')
await window.mulby.clipboard.writeImage('/path/to/image.png')
await window.mulby.clipboard.writeFiles([
  '/path/to/report.pdf',
  '/path/to/archive.zip'
])`,
        },
        {
            title: '查询并复制历史记录',
            code: `// src/main.ts
export const rpc = {
  queryClipboardHistory(options) {
    return mulby.clipboardHistory.query(options)
  },
  copyClipboardHistoryItem(id) {
    return mulby.clipboardHistory.copy(id)
  }
}

// UI
const result = await window.mulby.host.call('@mulby/showcase', 'queryClipboardHistory', {
  type: 'text',
  search: 'keyword',
  limit: 20
})

const items = result.data || []
if (items.length > 0) {
  await window.mulby.host.call('@mulby/showcase', 'copyClipboardHistoryItem', items[0].id)
}`,
        },
    ], [])

    const rawData = {
        current: {
            format,
            textLength: textContent.length,
            hasImage: Boolean(imageData),
            files,
        },
        history: {
            filters: { historyType, historySearch, favoriteOnly },
            stats: historyStats,
            selected: selectedHistoryItem
                ? redactHistoryItem(selectedHistoryItem)
                : null,
            items: historyItems.map(redactHistoryItem),
        },
    }

    return (
        <div className="main-content">
            <PageHeader
                icon={ClipboardIcon}
                title="剪贴板管理"
                description="读取、写入和管理剪贴板历史记录"
                actions={<Button onClick={refreshAll} loading={loading || historyLoading}>刷新</Button>}
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon"><ClipboardIcon aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{getFormatBadge()}</div>
                            <div className="stat-label">当前格式</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><ChartNoAxesColumn aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{historyStats?.total ?? '-'}</div>
                            <div className="stat-label">历史总数</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><FileText aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{historyStats?.text ?? '-'}</div>
                            <div className="stat-label">文本记录</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><Heart aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{historyStats?.favorite ?? '-'}</div>
                            <div className="stat-label">收藏记录</div>
                        </div>
                    </div>

                    <Card
                        title="内容预览"
                        icon={Eye}
                        actions={
                            format === 'text' && textContent ? (
                                <Button variant="secondary" onClick={handleCopyFromContent}>
                                    <Copy className="inline-icon" aria-hidden="true" size={14} />
                                    复制
                                </Button>
                            ) : null
                        }
                    >
                        {format === 'empty' && (
                            <div className="empty-state">
                                <Inbox className="empty-icon" aria-hidden="true" size={32} strokeWidth={1.8} />
                                <div>剪贴板为空</div>
                            </div>
                        )}

                        {format === 'text' && (
                            <CodeBlock>{textContent || '(空文本)'}</CodeBlock>
                        )}

                        {format === 'image' && imageData && (
                            <div className="preview-box">
                                <img src={imageData} alt="剪贴板图片" />
                            </div>
                        )}

                        {format === 'files' && files.length > 0 && (
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {files.map((file, index) => (
                                    <div className="list-row" key={`${file.path}-${index}`}>
                                        {file.isDirectory ? (
                                            <FolderOpen className="inline-icon" aria-hidden="true" size={16} />
                                        ) : (
                                            <FileText className="inline-icon" aria-hidden="true" size={16} />
                                        )}
                                        <span className="list-row-main">{file.name}</span>
                                        <span className="list-row-meta">{formatFileSize(file.size)}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card title="写入测试" icon={PenLine}>
                        <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="input-label">文本写入</label>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <textarea
                                    className="textarea"
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    placeholder="输入要写入剪贴板的内容..."
                                    rows={2}
                                    style={{ flex: 1 }}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <Button onClick={handleWriteText} disabled={!inputText.trim()}>
                                        写入文本
                                    </Button>
                                    <Button variant="secondary" onClick={handleWriteSampleText}>
                                        写入样例
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <div style={{ borderTop: '1px solid var(--border-primary)', margin: '16px 0', paddingTop: '16px' }}>
                            <label className="input-label" style={{ marginBottom: '12px', display: 'block' }}>高级写入</label>
                            <div className="action-bar">
                                <Button variant="secondary" onClick={handleWriteFiles}>
                                    <Upload className="inline-icon" aria-hidden="true" size={14} />
                                    复制文件...
                                </Button>
                                <Button variant="secondary" onClick={handleWriteImageFromPath}>
                                    <Image className="inline-icon" aria-hidden="true" size={14} />
                                    复制图片路径...
                                </Button>
                                <Button variant="secondary" onClick={handleWriteImageBase64}>
                                    <Palette className="inline-icon" aria-hidden="true" size={14} />
                                    复制 Data URL 图片
                                </Button>
                            </div>
                        </div>
                    </Card>

                    <Card title="剪贴板历史" icon={ChartNoAxesColumn} actions={
                        <div className="action-bar">
                            <Button variant="secondary" onClick={loadHistory} loading={historyLoading}>
                                <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                刷新历史
                            </Button>
                            <Button variant="secondary" onClick={handleClearHistory}>
                                <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                清空非收藏
                            </Button>
                        </div>
                    }>
                        <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                            <div className="input-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                                <select className="select" value={historyType} onChange={(event) => setHistoryType(event.target.value as HistoryTypeFilter)} style={{ width: '140px' }}>
                                    <option value="all">全部类型</option>
                                    <option value="text">文本</option>
                                    <option value="image">图片</option>
                                    <option value="files">文件</option>
                                </select>
                                <label className="input-row" style={{ alignItems: 'center', width: 'auto' }}>
                                    <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
                                    <span>只看收藏</span>
                                </label>
                                <div style={{ flex: 1, minWidth: '220px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Search className="inline-icon" aria-hidden="true" size={16} />
                                    <input
                                        className="input"
                                        value={historySearch}
                                        onChange={(event) => setHistorySearch(event.target.value)}
                                        placeholder="搜索文本历史"
                                    />
                                </div>
                            </div>

                            {historyItems.length === 0 ? (
                                <div className="empty-state">
                                    <Inbox className="empty-icon" aria-hidden="true" size={32} strokeWidth={1.8} />
                                    <div>暂无匹配的历史记录</div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                    {historyItems.map(item => (
                                        <div className={`history-item ${selectedHistoryItem?.id === item.id ? 'is-selected' : ''}`} key={item.id}>
                                            <button className="history-item-main" type="button" onClick={() => handleSelectHistoryItem(item.id)}>
                                                <div className="history-item-title">
                                                    <StatusBadge status={item.type === 'text' ? 'info' : item.type === 'image' ? 'success' : 'warning'}>
                                                        {historyTypeLabel(item.type)}
                                                    </StatusBadge>
                                                    {item.favorite && <Star className="inline-icon" aria-hidden="true" size={14} />}
                                                    <span>{item.sourceApp || '未知来源'}</span>
                                                    <span>{new Date(item.timestamp).toLocaleString()}</span>
                                                    <span>{formatFileSize(item.size)}</span>
                                                </div>
                                                <div className="history-item-preview">{summarizeHistoryItem(item)}</div>
                                            </button>
                                            <div className="history-item-actions">
                                                <Button variant="icon" onClick={() => handleCopyHistoryItem(item.id)} title="复制到剪贴板">
                                                    <Copy aria-hidden="true" size={15} />
                                                </Button>
                                                <Button variant="icon" onClick={() => handleToggleFavorite(item.id)} title="切换收藏">
                                                    <Star aria-hidden="true" size={15} />
                                                </Button>
                                                <Button variant="icon" onClick={() => handleDeleteHistoryItem(item.id)} title="删除">
                                                    <Trash2 aria-hidden="true" size={15} />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </Card>

                    {selectedHistoryItem && (
                        <Card title="历史详情" icon={Eye} actions={
                            <Button variant="secondary" onClick={() => handleCopyHistoryItem(selectedHistoryItem.id)}>
                                <Copy className="inline-icon" aria-hidden="true" size={14} />
                                复制该记录
                            </Button>
                        }>
                            <div className="info-grid">
                                <span className="info-label">ID</span>
                                <span className="info-value">{selectedHistoryItem.id}</span>
                                <span className="info-label">类型</span>
                                <span className="info-value">{historyTypeLabel(selectedHistoryItem.type)}</span>
                                <span className="info-label">时间</span>
                                <span className="info-value">{new Date(selectedHistoryItem.timestamp).toLocaleString()}</span>
                                <span className="info-label">大小</span>
                                <span className="info-value">{formatFileSize(selectedHistoryItem.size)}</span>
                                <span className="info-label">收藏</span>
                                <span className="info-value">{selectedHistoryItem.favorite ? '是' : '否'}</span>
                                <span className="info-label">来源</span>
                                <span className="info-value">{selectedHistoryItem.sourceApp || '未知'}{selectedHistoryItem.sourceTitle ? ` — ${selectedHistoryItem.sourceTitle}` : ''}</span>
                            </div>
                            <div style={{ marginTop: 'var(--spacing-md)' }}>
                                {selectedHistoryItem.type === 'image' ? (
                                    <div className="preview-box">
                                        <img src={selectedHistoryItem.content} alt="历史图片" />
                                    </div>
                                ) : (
                                    <CodeBlock>{summarizeHistoryItem(selectedHistoryItem)}</CodeBlock>
                                )}
                            </div>
                        </Card>
                    )}
                </div>
                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
