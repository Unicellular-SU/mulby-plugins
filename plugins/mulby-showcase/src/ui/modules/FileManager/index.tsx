import { useCallback, useMemo, useState } from 'react'
import {
    AlertTriangle,
    Bell,
    Copy,
    ExternalLink,
    Eye,
    FileSearch,
    FileText,
    FolderOpen,
    FolderPlus,
    HardDrive,
    List,
    MessageSquare,
    MoveRight,
    RefreshCw,
    Save,
    Search,
    Trash2,
    Volume2,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

interface FileStat {
    name: string
    path: string
    size: number
    isFile: boolean
    isDirectory: boolean
    createdAt: number
    modifiedAt: number
}

interface DesktopFileSearchResult {
    name: string
    path: string
    isDirectory: boolean
    size?: number
}

interface DesktopAppSearchResult {
    name: string
    path: string
    kind: 'application' | 'shortcut' | 'executable'
    iconPath?: string
}

interface OperationLogItem {
    action: string
    status: 'success' | 'error' | 'info'
    message: string
    timestamp: number
    details?: unknown
}

const MAX_TEXT_PREVIEW = 2000
const MAX_READABLE_TEXT = 50000

function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatDate(timestamp: number) {
    return new Date(timestamp).toLocaleString()
}

function truncateText(text: string, limit = MAX_TEXT_PREVIEW) {
    return text.length > limit ? `${text.slice(0, limit)}\n...[已截断]` : text
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function summarizeFileContent(content: string | null) {
    if (content === null) return null
    return {
        length: content.length,
        preview: truncateText(content, 1000),
        truncated: content.length > 1000,
    }
}

export function FileManagerModule() {
    const { filesystem, dialog, shell, desktop } = useMulby()
    const notify = useNotification()

    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [fileInfo, setFileInfo] = useState<FileStat | null>(null)
    const [fileExists, setFileExists] = useState<boolean | null>(null)
    const [fileContent, setFileContent] = useState<string | null>(null)
    const [dirContent, setDirContent] = useState<string[]>([])
    const [demoFilePath, setDemoFilePath] = useState<string | null>(null)
    const [newFolderName, setNewFolderName] = useState('mulby-showcase-demo-folder')
    const [searchQuery, setSearchQuery] = useState('')
    const [fileSearchResults, setFileSearchResults] = useState<DesktopFileSearchResult[]>([])
    const [appSearchResults, setAppSearchResults] = useState<DesktopAppSearchResult[]>([])
    const [searchLoading, setSearchLoading] = useState(false)
    const [lastMessageResult, setLastMessageResult] = useState<{ response: number; checkboxChecked: boolean } | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 8))
    }, [])

    const loadPath = useCallback(async (path: string) => {
        setSelectedPath(path)

        const exists = await filesystem.exists(path)
        setFileExists(exists)

        if (!exists) {
            setFileInfo(null)
            setFileContent('[路径不存在]')
            setDirContent([])
            return null
        }

        const stat = await filesystem.stat(path)
        setFileInfo(stat)

        if (!stat) {
            setFileContent('[无法获取路径信息]')
            setDirContent([])
            return null
        }

        if (stat.isDirectory) {
            const entries = await filesystem.readdir(path)
            setDirContent(entries || [])
            setFileContent(null)
            return stat
        }

        setDirContent([])

        try {
            const content = await filesystem.readFile(path, 'utf-8')
            if (typeof content === 'string' && content.length <= MAX_READABLE_TEXT) {
                setFileContent(content)
            } else if (typeof content === 'string') {
                setFileContent('[文件过大，未展示完整文本]')
            } else {
                setFileContent('[读取结果为二进制数据]')
            }
        } catch {
            setFileContent('[无法按文本读取文件内容]')
        }

        return stat
    }, [filesystem])

    const handleSelectFile = useCallback(async () => {
        try {
            const files = await dialog.showOpenDialog({
                title: '选择文件',
                properties: ['openFile'],
                filters: [
                    { name: '文本文件', extensions: ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'css', 'html'] },
                    { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                    { name: '所有文件', extensions: ['*'] },
                ],
            })

            if (!files.length) return

            const stat = await loadPath(files[0])
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'success',
                message: '已选择文件',
                details: { path: files[0], stat },
            })
            notify.success('文件已选择')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'dialog.showOpenDialog', status: 'error', message })
            notify.error('打开文件失败')
        }
    }, [dialog, loadPath, notify, pushOperation])

    const handleSelectFolder = useCallback(async () => {
        try {
            const dirs = await dialog.showOpenDialog({
                title: '选择文件夹',
                properties: ['openDirectory'],
            })

            if (!dirs.length) return

            const stat = await loadPath(dirs[0])
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'success',
                message: '已选择文件夹',
                details: { path: dirs[0], stat },
            })
            notify.success('文件夹已选择')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'dialog.showOpenDialog', status: 'error', message })
            notify.error('打开文件夹失败')
        }
    }, [dialog, loadPath, notify, pushOperation])

    const handleRefreshSelected = useCallback(async () => {
        if (!selectedPath) return

        try {
            const stat = await loadPath(selectedPath)
            pushOperation({
                action: 'filesystem.exists/stat/readdir/readFile',
                status: 'success',
                message: '已刷新当前路径',
                details: { path: selectedPath, stat },
            })
            notify.success('路径信息已刷新')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'filesystem.exists/stat', status: 'error', message, details: { path: selectedPath } })
            notify.error('刷新失败')
        }
    }, [loadPath, notify, pushOperation, selectedPath])

    const handleCreateDemoFile = useCallback(async () => {
        try {
            const savePath = await dialog.showSaveDialog({
                title: '创建测试文件',
                defaultPath: 'mulby-showcase-demo.txt',
                filters: [
                    { name: '文本文件', extensions: ['txt'] },
                    { name: '所有文件', extensions: ['*'] },
                ],
            })

            if (!savePath) return

            const content = `Mulby Showcase 文件系统测试
创建时间: ${new Date().toLocaleString()}
这个文件用于演示 filesystem.writeFile、copy、move 和 unlink。`

            await filesystem.writeFile(savePath, content, 'utf-8')
            setDemoFilePath(savePath)
            const stat = await loadPath(savePath)
            pushOperation({
                action: 'filesystem.writeFile',
                status: 'success',
                message: '测试文件已创建',
                details: { path: savePath, stat },
            })
            notify.success('测试文件已创建')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'filesystem.writeFile', status: 'error', message })
            notify.error('创建测试文件失败')
        }
    }, [dialog, filesystem, loadPath, notify, pushOperation])

    const handleCreateDirectory = useCallback(async () => {
        const folderName = newFolderName.trim() || 'mulby-showcase-demo-folder'

        if (/[\\/]/.test(folderName)) {
            notify.error('文件夹名称不能包含路径分隔符')
            return
        }

        try {
            const targetPath = await dialog.showSaveDialog({
                title: '选择新文件夹路径',
                defaultPath: folderName,
                buttonLabel: '创建文件夹',
            })

            if (!targetPath) return

            await filesystem.mkdir(targetPath)
            const stat = await loadPath(targetPath)
            pushOperation({
                action: 'filesystem.mkdir',
                status: 'success',
                message: '文件夹已创建或已存在',
                details: { path: targetPath, stat },
            })
            notify.success('文件夹已创建或已存在')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'filesystem.mkdir', status: 'error', message })
            notify.error('创建文件夹失败')
        }
    }, [dialog, filesystem, loadPath, newFolderName, notify, pushOperation])

    const handleCopySelected = useCallback(async () => {
        if (!selectedPath || !fileInfo?.isFile) return

        try {
            const copyPath = await dialog.showSaveDialog({
                title: '复制当前文件到',
                defaultPath: `copy-${fileInfo.name}`,
                filters: [{ name: '所有文件', extensions: ['*'] }],
            })

            if (!copyPath) return

            await filesystem.copy(selectedPath, copyPath)
            const stat = await filesystem.stat(copyPath)
            pushOperation({
                action: 'filesystem.copy',
                status: 'success',
                message: '文件已复制',
                details: { from: selectedPath, to: copyPath, stat },
            })
            notify.success('文件已复制')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'filesystem.copy', status: 'error', message, details: { from: selectedPath } })
            notify.error('复制失败')
        }
    }, [dialog, fileInfo, filesystem, notify, pushOperation, selectedPath])

    const handleMoveDemoFile = useCallback(async () => {
        if (!demoFilePath) return

        try {
            const exists = await filesystem.exists(demoFilePath)
            if (!exists) {
                setDemoFilePath(null)
                notify.error('测试文件不存在，请重新创建')
                return
            }

            const movePath = await dialog.showSaveDialog({
                title: '移动或重命名测试文件到',
                defaultPath: `moved-${fileInfo?.path === demoFilePath ? fileInfo.name : 'mulby-showcase-demo.txt'}`,
                filters: [{ name: '所有文件', extensions: ['*'] }],
            })

            if (!movePath) return

            await filesystem.move(demoFilePath, movePath)
            setDemoFilePath(movePath)
            const stat = await loadPath(movePath)
            pushOperation({
                action: 'filesystem.move',
                status: 'success',
                message: '测试文件已移动或重命名',
                details: { from: demoFilePath, to: movePath, stat },
            })
            notify.success('测试文件已移动')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'filesystem.move', status: 'error', message, details: { from: demoFilePath } })
            notify.error('移动失败')
        }
    }, [demoFilePath, dialog, fileInfo, filesystem, loadPath, notify, pushOperation])

    const handleDeleteDemoFile = useCallback(async () => {
        if (!demoFilePath) return

        const result = await dialog.showMessageBox({
            type: 'warning',
            title: '永久删除测试文件',
            message: '确定要永久删除这个测试文件吗？',
            detail: demoFilePath,
            buttons: ['取消', '永久删除测试文件'],
            defaultId: 0,
            cancelId: 0,
        })

        setLastMessageResult(result)

        if (result.response !== 1) return

        try {
            await filesystem.unlink(demoFilePath)
            pushOperation({
                action: 'filesystem.unlink',
                status: 'success',
                message: '测试文件已永久删除',
                details: { path: demoFilePath },
            })

            if (selectedPath === demoFilePath) {
                setSelectedPath(null)
                setFileInfo(null)
                setFileExists(null)
                setFileContent(null)
                setDirContent([])
            }

            setDemoFilePath(null)
            notify.success('测试文件已删除')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'filesystem.unlink', status: 'error', message, details: { path: demoFilePath } })
            notify.error('删除失败')
        }
    }, [demoFilePath, dialog, filesystem, notify, pushOperation, selectedPath])

    const handleOpenInSystem = useCallback(async () => {
        if (!selectedPath) return

        try {
            const error = await shell.openPath(selectedPath)
            if (error) throw new Error(error)

            pushOperation({
                action: 'shell.openPath',
                status: 'success',
                message: '已使用系统默认应用打开',
                details: { path: selectedPath },
            })
            notify.info('已使用系统默认应用打开')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.openPath', status: 'error', message, details: { path: selectedPath } })
            notify.error('打开失败')
        }
    }, [notify, pushOperation, selectedPath, shell])

    const handleOpenContainingFolder = useCallback(async () => {
        if (!selectedPath) return

        try {
            const error = await shell.openFolder(selectedPath)
            if (error) throw new Error(error)

            pushOperation({
                action: 'shell.openFolder',
                status: 'success',
                message: '已打开所在文件夹',
                details: { path: selectedPath },
            })
            notify.info('已打开所在文件夹')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.openFolder', status: 'error', message, details: { path: selectedPath } })
            notify.error('打开文件夹失败')
        }
    }, [notify, pushOperation, selectedPath, shell])

    const handleShowInFileManager = useCallback(async () => {
        if (!selectedPath) return

        try {
            await shell.showItemInFolder(selectedPath)
            pushOperation({
                action: 'shell.showItemInFolder',
                status: 'success',
                message: '已在文件管理器中显示',
                details: { path: selectedPath },
            })
            notify.info('已在文件管理器中显示')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.showItemInFolder', status: 'error', message, details: { path: selectedPath } })
            notify.error('操作失败')
        }
    }, [notify, pushOperation, selectedPath, shell])

    const handleTrashSelected = useCallback(async () => {
        if (!selectedPath) return

        const result = await dialog.showMessageBox({
            type: 'warning',
            title: '移到回收站或废纸篓',
            message: '确定要把当前路径移到回收站或废纸篓吗？',
            detail: selectedPath,
            buttons: ['取消', '移到回收站'],
            defaultId: 0,
            cancelId: 0,
        })

        setLastMessageResult(result)

        if (result.response !== 1) return

        try {
            await shell.trashItem(selectedPath)
            pushOperation({
                action: 'shell.trashItem',
                status: 'success',
                message: '已移到回收站或废纸篓',
                details: { path: selectedPath },
            })

            if (demoFilePath === selectedPath) {
                setDemoFilePath(null)
            }

            setSelectedPath(null)
            setFileInfo(null)
            setFileExists(null)
            setFileContent(null)
            setDirContent([])
            notify.success('已移到回收站或废纸篓')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.trashItem', status: 'error', message, details: { path: selectedPath } })
            notify.error('移动失败')
        }
    }, [demoFilePath, dialog, notify, pushOperation, selectedPath, shell])

    const handleOpenExternal = useCallback(async () => {
        const url = 'https://github.com/Unicellular-SU/mulby_plugins'

        try {
            await shell.openExternal(url)
            pushOperation({
                action: 'shell.openExternal',
                status: 'success',
                message: '已在浏览器中打开外部链接',
                details: { url },
            })
            notify.info('已在浏览器中打开')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.openExternal', status: 'error', message, details: { url } })
            notify.error('打开失败')
        }
    }, [notify, pushOperation, shell])

    const handleBeep = useCallback(async () => {
        try {
            await shell.beep()
            pushOperation({
                action: 'shell.beep',
                status: 'info',
                message: '已触发系统提示音',
            })
            notify.info('已触发系统提示音')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.beep', status: 'error', message })
            notify.error('提示音调用失败')
        }
    }, [notify, pushOperation, shell])

    const handleMessageBox = useCallback(async () => {
        try {
            const result = await dialog.showMessageBox({
                type: 'question',
                title: '消息框测试',
                message: '这是一个来自插件的消息框',
                detail: '你可以选择不同按钮来测试返回值。',
                buttons: ['取消', '选项 A', '选项 B'],
                defaultId: 1,
                cancelId: 0,
            })

            setLastMessageResult(result)
            pushOperation({
                action: 'dialog.showMessageBox',
                status: 'info',
                message: `消息框返回按钮索引 ${result.response}`,
                details: result,
            })
            notify.info(`你选择了按钮 ${result.response}`)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'dialog.showMessageBox', status: 'error', message })
            notify.error('消息框调用失败')
        }
    }, [dialog, notify, pushOperation])

    const handleErrorBox = useCallback(async () => {
        try {
            const result = await dialog.showMessageBox({
                type: 'error',
                title: '错误框测试',
                message: '这是通过内部消息框展示的错误提示。',
                detail: 'showMessageBox 会使用宿主封装的插件内模态框，避免系统原生错误框被置顶插件窗口遮挡。',
                buttons: ['知道了'],
                defaultId: 0,
                cancelId: 0,
            })
            setLastMessageResult(result)
            pushOperation({
                action: 'dialog.showMessageBox(error)',
                status: 'info',
                message: '已显示内部错误提示框',
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'dialog.showMessageBox(error)', status: 'error', message })
            notify.error('错误框调用失败')
        }
    }, [dialog, notify, pushOperation])

    const handleDesktopSearch = useCallback(async () => {
        const query = searchQuery.trim()

        if (!query) {
            notify.error('请输入搜索关键词')
            return
        }

        setSearchLoading(true)
        try {
            const [files, apps] = await Promise.all([
                desktop.searchFiles(query, 20),
                desktop.searchApps(query, 10),
            ])
            setFileSearchResults(files)
            setAppSearchResults(apps)
            pushOperation({
                action: 'desktop.searchFiles/searchApps',
                status: 'success',
                message: `搜索完成：${files.length} 个文件结果，${apps.length} 个应用结果`,
                details: { query, files, apps },
            })
            notify.success('桌面搜索完成')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'desktop.searchFiles/searchApps', status: 'error', message, details: { query } })
            notify.error('桌面搜索失败')
        } finally {
            setSearchLoading(false)
        }
    }, [desktop, notify, pushOperation, searchQuery])

    const handleLoadSearchResult = useCallback(async (path: string) => {
        try {
            const stat = await loadPath(path)
            pushOperation({
                action: 'desktop.result.select',
                status: 'success',
                message: '已加载搜索结果路径',
                details: { path, stat },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'desktop.result.select', status: 'error', message, details: { path } })
            notify.error('加载搜索结果失败')
        }
    }, [loadPath, notify, pushOperation])

    const handleRevealPath = useCallback(async (path: string) => {
        try {
            await shell.showItemInFolder(path)
            pushOperation({
                action: 'shell.showItemInFolder',
                status: 'success',
                message: '已显示搜索结果路径',
                details: { path },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.showItemInFolder', status: 'error', message, details: { path } })
            notify.error('显示路径失败')
        }
    }, [notify, pushOperation, shell])

    const handleOpenSearchPath = useCallback(async (path: string) => {
        try {
            const error = await shell.openPath(path)
            if (error) throw new Error(error)

            pushOperation({
                action: 'shell.openPath',
                status: 'success',
                message: '已打开搜索结果路径',
                details: { path },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'shell.openPath', status: 'error', message, details: { path } })
            notify.error('打开路径失败')
        }
    }, [notify, pushOperation, shell])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Filesystem API',
            items: [
                { name: 'filesystem.exists(path)', description: '检查文件或目录是否存在。' },
                { name: 'filesystem.stat(path)', description: '获取文件名、大小、类型、创建时间和修改时间。' },
                { name: 'filesystem.readFile(path, encoding)', description: '读取文件内容，文本预览使用 utf-8 编码。' },
                { name: 'filesystem.writeFile(path, data, encoding)', description: '写入测试文本文件。' },
                { name: 'filesystem.readdir(path)', description: '读取目录下的文件名列表。' },
                { name: 'filesystem.mkdir(path)', description: '递归创建目录。' },
                { name: 'filesystem.copy(src, dest)', description: '复制当前选中的文件到新路径。' },
                { name: 'filesystem.move(src, dest)', description: '移动或重命名测试文件。' },
                { name: 'filesystem.unlink(path)', description: '永久删除测试文件。' },
            ],
        },
        {
            title: 'Dialog API',
            items: [
                { name: 'dialog.showOpenDialog(options)', description: '选择文件或目录。' },
                { name: 'dialog.showSaveDialog(options)', description: '选择写入、复制、移动或创建目录的目标路径。' },
                { name: 'dialog.showMessageBox(options)', description: '展示确认框并读取按钮索引。' },
                { name: 'dialog.showMessageBox({ type: "error" })', description: '用插件内模态框展示错误提示，避免系统原生错误框被置顶窗口遮挡。' },
            ],
        },
        {
            title: 'Shell API',
            items: [
                { name: 'shell.openPath(path)', description: '用系统默认应用打开文件、目录或应用路径。' },
                { name: 'shell.openFolder(path)', description: '打开文件所在目录，传目录时直接打开该目录。' },
                { name: 'shell.showItemInFolder(path)', description: '在系统文件管理器中定位文件。' },
                { name: 'shell.trashItem(path)', description: '把当前选中路径移到回收站或废纸篓。' },
                { name: 'shell.openExternal(url)', description: '使用系统默认浏览器打开安全协议链接。' },
                { name: 'shell.beep()', description: '播放系统提示音。' },
            ],
        },
        {
            title: 'Desktop API',
            items: [
                { name: 'desktop.searchFiles(query, limit)', description: '搜索系统文件。' },
                { name: 'desktop.searchApps(query, limit)', description: '搜索系统应用。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '选择并读取文件',
            code: `const [filePath] = await window.mulby.dialog.showOpenDialog({
  title: '选择文件',
  properties: ['openFile']
})

if (filePath && await window.mulby.filesystem.exists(filePath)) {
  const stat = await window.mulby.filesystem.stat(filePath)
  const text = await window.mulby.filesystem.readFile(filePath, 'utf-8')
  console.log(stat, text)
}`,
        },
        {
            title: '写入、复制、移动和删除测试文件',
            code: `const path = await window.mulby.dialog.showSaveDialog({
  title: '创建测试文件',
  defaultPath: 'mulby-showcase-demo.txt'
})

if (path) {
  await window.mulby.filesystem.writeFile(path, 'Hello Mulby', 'utf-8')

  const copyPath = await window.mulby.dialog.showSaveDialog({
    title: '复制到',
    defaultPath: 'mulby-showcase-demo-copy.txt'
  })
  if (copyPath) {
    await window.mulby.filesystem.copy(path, copyPath)
    await window.mulby.filesystem.unlink(copyPath)
  }

  const movePath = await window.mulby.dialog.showSaveDialog({
    title: '移动到',
    defaultPath: 'mulby-showcase-demo-moved.txt'
  })
  if (movePath) {
    await window.mulby.filesystem.move(path, movePath)
  }
}`,
        },
        {
            title: '系统打开与定位',
            code: `const error = await window.mulby.shell.openPath(filePath)
if (error) {
  throw new Error(error)
}

await window.mulby.shell.openFolder(filePath)
await window.mulby.shell.showItemInFolder(filePath)
await window.mulby.shell.trashItem(filePath)`,
        },
        {
            title: '桌面文件和应用搜索',
            code: `const files = await window.mulby.desktop.searchFiles('report', 20)
const apps = await window.mulby.desktop.searchApps('code', 10)

if (files[0]) {
  await window.mulby.shell.showItemInFolder(files[0].path)
}`,
        },
    ], [])

    const rawData = useMemo(() => ({
        selected: selectedPath
            ? {
                path: selectedPath,
                exists: fileExists,
                stat: fileInfo,
                contentPreview: summarizeFileContent(fileContent),
                directory: {
                    total: dirContent.length,
                    items: dirContent.slice(0, 100),
                    truncated: dirContent.length > 100,
                },
            }
            : null,
        demoFilePath,
        desktopSearch: {
            query: searchQuery,
            fileResults: fileSearchResults,
            appResults: appSearchResults,
        },
        dialog: {
            lastMessageResult,
        },
        operations: operationLog,
    }), [appSearchResults, demoFilePath, dirContent, fileContent, fileExists, fileInfo, fileSearchResults, lastMessageResult, operationLog, searchQuery, selectedPath])

    return (
        <div className="main-content">
            <PageHeader
                icon={FolderOpen}
                title="文件管理"
                description="文件系统、对话框、Shell 和桌面搜索"
                actions={<Button variant="secondary" onClick={handleRefreshSelected} disabled={!selectedPath}><RefreshCw aria-hidden="true" size={14} />刷新</Button>}
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <HardDrive aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{selectedPath ? (fileInfo?.isDirectory ? '目录' : '文件') : '未选择'}</div>
                            <div className="stat-label">当前路径</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <List aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{dirContent.length}</div>
                            <div className="stat-label">目录项</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Search aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{fileSearchResults.length + appSearchResults.length}</div>
                            <div className="stat-label">搜索结果</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Save aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{demoFilePath ? '已创建' : '未创建'}</div>
                            <div className="stat-label">测试文件</div>
                        </div>
                    </div>

                    <Card title="选择与预览" icon={FolderOpen}>
                        <div className="action-bar">
                            <Button onClick={handleSelectFile}><FileText aria-hidden="true" size={14} />打开文件</Button>
                            <Button onClick={handleSelectFolder}><FolderOpen aria-hidden="true" size={14} />打开文件夹</Button>
                            <Button variant="secondary" onClick={handleCreateDemoFile}><Save aria-hidden="true" size={14} />创建测试文件</Button>
                        </div>
                    </Card>

                    {selectedPath && (
                        <Card title="路径信息" icon={FileText}>
                            <div className="info-grid">
                                <span className="info-label">状态</span>
                                <span className="info-value">
                                    <StatusBadge status={fileExists ? 'success' : 'error'}>
                                        {fileExists ? '存在' : '不存在'}
                                    </StatusBadge>
                                </span>

                                <span className="info-label">路径</span>
                                <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                    {selectedPath}
                                </span>

                                {fileInfo && (
                                    <>
                                        <span className="info-label">类型</span>
                                        <span className="info-value">
                                            <StatusBadge status={fileInfo.isDirectory ? 'warning' : 'info'}>
                                                {fileInfo.isDirectory ? '文件夹' : '文件'}
                                            </StatusBadge>
                                        </span>

                                        <span className="info-label">大小</span>
                                        <span className="info-value">{formatFileSize(fileInfo.size)}</span>

                                        <span className="info-label">创建时间</span>
                                        <span className="info-value">{formatDate(fileInfo.createdAt)}</span>

                                        <span className="info-label">修改时间</span>
                                        <span className="info-value">{formatDate(fileInfo.modifiedAt)}</span>
                                    </>
                                )}
                            </div>

                            <div className="action-bar" style={{ marginTop: 'var(--spacing-md)' }}>
                                <Button variant="secondary" onClick={handleOpenInSystem}><ExternalLink aria-hidden="true" size={14} />系统打开</Button>
                                <Button variant="secondary" onClick={handleOpenContainingFolder}><FolderOpen aria-hidden="true" size={14} />打开所在文件夹</Button>
                                <Button variant="secondary" onClick={handleShowInFileManager}><FileSearch aria-hidden="true" size={14} />在文件管理器中显示</Button>
                                <Button variant="secondary" onClick={handleTrashSelected}><Trash2 aria-hidden="true" size={14} />移到回收站</Button>
                            </div>
                        </Card>
                    )}

                    {fileContent && (
                        <Card title="文件内容预览" icon={Eye}>
                            <CodeBlock>{truncateText(fileContent)}</CodeBlock>
                        </Card>
                    )}

                    {dirContent.length > 0 && (
                        <Card title={`目录内容 (${dirContent.length} 项)`} icon={List}>
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
                                gap: 'var(--spacing-sm)',
                            }}>
                                {dirContent.slice(0, 50).map((item, index) => (
                                    <div
                                        key={`${item}-${index}`}
                                        style={{
                                            padding: 'var(--spacing-sm)',
                                            background: 'var(--bg-tertiary)',
                                            borderRadius: 'var(--radius-sm)',
                                            fontSize: '12px',
                                            fontFamily: 'monospace',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}
                                        title={item}
                                    >
                                        {item}
                                    </div>
                                ))}
                                {dirContent.length > 50 && (
                                    <div style={{ color: 'var(--text-tertiary)' }}>
                                        还有 {dirContent.length - 50} 项未展示
                                    </div>
                                )}
                            </div>
                        </Card>
                    )}

                    <Card title="文件系统写入与整理" icon={HardDrive}>
                        <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="input-label">新文件夹名称</label>
                            <div className="input-row" style={{ alignItems: 'center' }}>
                                <input
                                    className="input"
                                    value={newFolderName}
                                    onChange={(event) => setNewFolderName(event.target.value)}
                                    placeholder="mulby-showcase-demo-folder"
                                />
                                <Button variant="secondary" onClick={handleCreateDirectory}><FolderPlus aria-hidden="true" size={14} />创建文件夹</Button>
                            </div>
                        </div>
                        <div className="action-bar">
                            <Button variant="secondary" onClick={handleCopySelected} disabled={!selectedPath || !fileInfo?.isFile}>
                                <Copy aria-hidden="true" size={14} />复制当前文件
                            </Button>
                            <Button variant="secondary" onClick={handleMoveDemoFile} disabled={!demoFilePath}>
                                <MoveRight aria-hidden="true" size={14} />移动测试文件
                            </Button>
                            <Button variant="secondary" onClick={handleDeleteDemoFile} disabled={!demoFilePath}>
                                <Trash2 aria-hidden="true" size={14} />永久删除测试文件
                            </Button>
                        </div>
                    </Card>

                    <Card title="桌面搜索" icon={Search}>
                        <div className="input-row" style={{ alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
                            <input
                                className="input"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        void handleDesktopSearch()
                                    }
                                }}
                                placeholder="搜索文件或应用，例如 report、code"
                            />
                            <Button onClick={handleDesktopSearch} loading={searchLoading}><Search aria-hidden="true" size={14} />搜索</Button>
                        </div>

                        {(fileSearchResults.length > 0 || appSearchResults.length > 0) ? (
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                {fileSearchResults.length > 0 && (
                                    <div>
                                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>文件结果</div>
                                        <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                            {fileSearchResults.slice(0, 8).map(result => (
                                                <div className="history-item" key={result.path}>
                                                    <button className="history-item-main" type="button" onClick={() => void handleLoadSearchResult(result.path)}>
                                                        <div className="history-item-title">
                                                            <StatusBadge status={result.isDirectory ? 'warning' : 'info'}>{result.isDirectory ? '目录' : '文件'}</StatusBadge>
                                                            <span>{typeof result.size === 'number' ? formatFileSize(result.size) : '未知大小'}</span>
                                                        </div>
                                                        <div className="history-item-preview">{result.name}</div>
                                                        <div className="list-row-meta" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>{result.path}</div>
                                                    </button>
                                                    <div className="history-item-actions">
                                                        <Button variant="icon" title="显示位置" onClick={() => void handleRevealPath(result.path)}><FileSearch aria-hidden="true" size={14} /></Button>
                                                        <Button variant="icon" title="打开" onClick={() => void handleOpenSearchPath(result.path)}><ExternalLink aria-hidden="true" size={14} /></Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {appSearchResults.length > 0 && (
                                    <div>
                                        <div className="input-label" style={{ marginBottom: 'var(--spacing-sm)' }}>应用结果</div>
                                        <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                            {appSearchResults.slice(0, 8).map(result => (
                                                <div className="history-item" key={`${result.name}-${result.path}`}>
                                                    <button className="history-item-main" type="button" onClick={() => void handleOpenSearchPath(result.path)}>
                                                        <div className="history-item-title">
                                                            <StatusBadge status="success">{result.kind}</StatusBadge>
                                                            {result.iconPath && <span>{result.iconPath}</span>}
                                                        </div>
                                                        <div className="history-item-preview">{result.name}</div>
                                                        <div className="list-row-meta" style={{ wordBreak: 'break-all', whiteSpace: 'normal' }}>{result.path}</div>
                                                    </button>
                                                    <div className="history-item-actions">
                                                        <Button variant="icon" title="打开" onClick={() => void handleOpenSearchPath(result.path)}><ExternalLink aria-hidden="true" size={14} /></Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <FileSearch className="empty-icon" aria-hidden="true" size={24} />
                                <span>输入关键词后查询系统文件和应用。</span>
                            </div>
                        )}
                    </Card>

                    <Card title="对话框和 Shell 辅助" icon={MessageSquare}>
                        <div className="action-bar">
                            <Button variant="secondary" onClick={handleMessageBox}><MessageSquare aria-hidden="true" size={14} />消息框</Button>
                            <Button variant="secondary" onClick={handleErrorBox}><AlertTriangle aria-hidden="true" size={14} />错误框</Button>
                            <Button variant="secondary" onClick={handleBeep}><Volume2 aria-hidden="true" size={14} />系统提示音</Button>
                            <Button variant="secondary" onClick={handleOpenExternal}><ExternalLink aria-hidden="true" size={14} />打开项目链接</Button>
                        </div>
                    </Card>

                    {operationLog.length > 0 && (
                        <Card title="最近操作" icon={Bell}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.map(item => (
                                    <div className="list-row" key={`${item.timestamp}-${item.action}`}>
                                        <StatusBadge status={item.status}>{item.status === 'success' ? '成功' : item.status === 'error' ? '失败' : '信息'}</StatusBadge>
                                        <div className="list-row-main">{item.action}</div>
                                        <div className="list-row-meta">{item.message}</div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
