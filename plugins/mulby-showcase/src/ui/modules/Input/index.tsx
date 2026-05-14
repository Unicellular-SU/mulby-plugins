import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, ClipboardList, FileText, Gamepad2, Image, Keyboard, Lightbulb, MousePointerClick, Paperclip, Pin, RotateCcw, Sparkles, Table, Type, Zap } from 'lucide-react'
import { PageHeader, Card, Button, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function InputModule() {
    const { input, dialog, system, permission, screen } = useMulby()
    const notify = useNotification()

    const [pasteText, setPasteText] = useState('')
    const [typeText, setTypeText] = useState('')
    const [keyboardKey, setKeyboardKey] = useState('enter')
    const [keyboardModifiers, setKeyboardModifiers] = useState('')
    const [mouseX, setMouseX] = useState(100)
    const [mouseY, setMouseY] = useState(100)
    const [currentMousePos, setCurrentMousePos] = useState<{
        x: number
        y: number
    } | null>(null)
    const [busyAction, setBusyAction] = useState<string | null>(null)
    const [accessibilityTrusted, setAccessibilityTrusted] = useState<boolean | null>(null)
    const [isMacOS, setIsMacOS] = useState<boolean>(false)
    const [scriptLog, setScriptLog] = useState<string[]>([])
    const [lastAction, setLastAction] = useState<{
        name: string
        success: boolean
        at: string
        message?: string
    } | null>(null)

    const restoreInputWindowsAfterInput = useCallback(async () => {
        try {
            await input.restoreWindows()
        } catch (error) {
            console.error('Failed to restore input windows:', error)
        }
    }, [input])

    const runAction = useCallback(
        async (name: string, action: () => Promise<boolean>) => {
            setBusyAction(name)
            try {
                const ok = await action()
                setLastAction({
                    name,
                    success: ok,
                    at: new Date().toLocaleTimeString(),
                    message: ok ? '输入已发送到目标应用' : '目标应用未接收输入或平台能力受限',
                })
                if (ok) {
                    notify.success('已发送输入到目标应用')
                } else {
                    notify.error('发送失败，请检查目标应用是否可接收输入')
                }
            } catch (error) {
                setLastAction({
                    name,
                    success: false,
                    at: new Date().toLocaleTimeString(),
                    message: error instanceof Error ? error.message : String(error),
                })
                notify.error('执行失败，请确认权限与环境依赖')
            } finally {
                await restoreInputWindowsAfterInput()
                setBusyAction(null)
            }
        },
        [notify, restoreInputWindowsAfterInput],
    )

    const runSimulateAction = useCallback(
        async (name: string, action: () => Promise<boolean>) => {
            setBusyAction(name)
            try {
                const ok = await action()
                setLastAction({
                    name,
                    success: ok,
                    at: new Date().toLocaleTimeString(),
                    message: ok ? '模拟操作已发送到目标应用' : '模拟操作失败或平台能力受限',
                })
                if (ok) {
                    notify.success('模拟操作已发送到目标应用')
                } else {
                    notify.error('模拟操作失败，请确认权限与环境依赖')
                }
            } catch (error) {
                setLastAction({
                    name,
                    success: false,
                    at: new Date().toLocaleTimeString(),
                    message: error instanceof Error ? error.message : String(error),
                })
                notify.error('模拟操作失败，请确认权限与环境依赖')
                console.error(error)
            } finally {
                await restoreInputWindowsAfterInput()
                setBusyAction(null)
            }
        },
        [notify, restoreInputWindowsAfterInput],
    )

    const loadAccessibilityStatus = useCallback(async () => {
        try {
            const mac = await system.isMacOS()
            setIsMacOS(Boolean(mac))
            if (mac) {
                const trusted = await permission.isAccessibilityTrusted()
                setAccessibilityTrusted(Boolean(trusted))
            } else {
                setAccessibilityTrusted(true)
            }
        } catch {
            setAccessibilityTrusted(null)
        }
    }, [system])

    useEffect(() => {
        loadAccessibilityStatus()
    }, [loadAccessibilityStatus])

    const handlePasteText = async () => {
        if (!pasteText.trim()) {
            notify.warning('请输入要粘贴的文本')
            return
        }
        await runAction('pasteText', () => input.hideMainWindowPasteText(pasteText.trim()))
    }

    const handleTypeString = async () => {
        if (!typeText.trim()) {
            notify.warning('请输入要键入的内容')
            return
        }
        await runAction('typeString', () => input.hideMainWindowTypeString(typeText.trim()))
    }

    const handlePasteFile = async () => {
        const files = await dialog.showOpenDialog({
            title: '选择要粘贴的文件',
            properties: ['openFile', 'multiSelections'],
        })
        if (!files || files.length === 0) return
        await runAction('pasteFile', () => input.hideMainWindowPasteFile(files))
    }

    const handlePasteImageFromPath = async () => {
        const files = await dialog.showOpenDialog({
            title: '选择要粘贴的图片',
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif'] }],
            properties: ['openFile'],
        })
        if (!files || files.length === 0) return
        await runAction('pasteImagePath', () => input.hideMainWindowPasteImage(files[0]))
    }

    const handlePasteImageSample = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 160
        canvas.height = 120
        const ctx = canvas.getContext('2d')
        if (!ctx) {
            notify.error('Canvas 不可用')
            return
        }
        ctx.fillStyle = '#0ea5e9'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = '#0f172a'
        ctx.font = '18px Arial'
        ctx.fillText('Mulby Input', 12, 58)
        const dataUrl = canvas.toDataURL('image/png')
        await runAction('pasteImageSample', () => input.hideMainWindowPasteImage(dataUrl))
    }

    // 模拟键盘按键
    const handleSimulateKeyboardTap = async () => {
        if (!keyboardKey.trim()) {
            notify.warning('请输入按键名称')
            return
        }
        const modifiers = keyboardModifiers.trim()
            ? keyboardModifiers
                  .split(',')
                  .map((m) => m.trim())
                  .filter(Boolean)
            : []
        await runSimulateAction('keyboardTap', () => input.simulateKeyboardTap(keyboardKey.trim(), ...modifiers))
    }

    // 获取当前鼠标位置
    const handleGetMousePosition = async () => {
        try {
            const pos = await screen.getCursorScreenPoint()
            if (pos) {
                setCurrentMousePos(pos)
                setMouseX(pos.x)
                setMouseY(pos.y)
                notify.info(`当前鼠标位置: (${pos.x}, ${pos.y})`)
            }
        } catch (error) {
            notify.error('获取鼠标位置失败')
        }
    }

    // 模拟鼠标移动
    const handleSimulateMouseMove = async () => {
        await runSimulateAction('mouseMove', () => input.simulateMouseMove(mouseX, mouseY))
    }

    // 模拟鼠标左键单击
    const handleSimulateMouseClick = async () => {
        await runSimulateAction('mouseClick', () => input.simulateMouseClick(mouseX, mouseY))
    }

    // 模拟鼠标左键双击
    const handleSimulateMouseDoubleClick = async () => {
        await runSimulateAction('mouseDoubleClick', () => input.simulateMouseDoubleClick(mouseX, mouseY))
    }

    // 模拟鼠标右键点击
    const handleSimulateMouseRightClick = async () => {
        await runSimulateAction('mouseRightClick', () => input.simulateMouseRightClick(mouseX, mouseY))
    }

    // WPS 自动化脚本：创建格式化文档
    const runWpsAutoScript = async () => {
        setBusyAction('wpsScript')
        setScriptLog([])
        const log = (msg: string) => setScriptLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`])

        try {
            const modKey = isMacOS ? 'command' : 'ctrl'

            log('开始执行 WPS 自动化脚本...')
            log('请确保 WPS 文档窗口已打开并且光标在文档中')

            // 步骤1: 输入标题（使用粘贴方式支持中文）
            log('步骤1: 输入标题')
            await input.hideMainWindowPasteText('Mulby 自动化演示文档')
            await delay(300)

            // 步骤2: 全选刚输入的标题
            log('步骤2: 全选标题文字')
            await input.simulateKeyboardTap('a', modKey)
            await delay(200)

            // 步骤3: 设置标题加粗
            log('步骤3: 设置加粗')
            await input.simulateKeyboardTap('b', modKey)
            await delay(200)

            // 步骤4: 设置居中对齐
            log('步骤4: 设置居中对齐')
            await input.simulateKeyboardTap('e', modKey)
            await delay(200)

            // 步骤5: 移动到行尾，取消选中
            log('步骤5: 移动到行尾')
            await input.simulateKeyboardTap('end')
            await delay(200)

            // 步骤6: 换行
            log('步骤6: 换行两次')
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.simulateKeyboardTap('enter')
            await delay(200)

            // 步骤7: 取消居中（恢复左对齐）
            log('步骤7: 恢复左对齐')
            await input.simulateKeyboardTap('l', modKey)
            await delay(200)

            // 步骤8: 取消加粗
            log('步骤8: 取消加粗')
            await input.simulateKeyboardTap('b', modKey)
            await delay(200)

            // 步骤9: 输入正文内容（使用粘贴方式支持中文）
            log('步骤9: 输入正文内容')
            await input.hideMainWindowPasteText('这是由 Mulby 自动生成的文档内容。')
            await delay(300)

            // 步骤10: 换行并继续输入
            log('步骤10: 换行并继续输入')
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.hideMainWindowPasteText('通过模拟按键 API，可以实现各种自动化操作。')
            await delay(300)

            // 步骤11: 换行
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.simulateKeyboardTap('enter')
            await delay(100)

            // 步骤12: 输入列表（使用粘贴方式支持中文）
            log('步骤12: 输入列表项目')
            await input.hideMainWindowPasteText('功能特点：')
            await delay(200)
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.hideMainWindowPasteText('1. 支持模拟键盘按键')
            await delay(200)
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.hideMainWindowPasteText('2. 支持模拟鼠标操作')
            await delay(200)
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.hideMainWindowPasteText('3. 跨平台兼容 macOS/Windows/Linux')
            await delay(300)

            // 步骤13: 换行并添加结束语
            log('步骤13: 添加结束语')
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.simulateKeyboardTap('enter')
            await delay(100)
            const now = new Date().toLocaleString()
            await input.hideMainWindowPasteText(`生成时间：${now}`)
            await delay(300)

            // 步骤14: 保存文档
            log('步骤14: 保存文档 (Ctrl+S)')
            await input.simulateKeyboardTap('s', modKey)
            await delay(500)

            log('脚本执行完成！')
            notify.success('WPS 自动化脚本执行完成')
        } catch (error) {
            log(`执行出错: ${error}`)
            notify.error('脚本执行失败')
            console.error(error)
        } finally {
            await restoreInputWindowsAfterInput()
            setBusyAction(null)
        }
    }

    // WPS 快速插入表格脚本
    const runWpsTableScript = async () => {
        setBusyAction('wpsTableScript')
        setScriptLog([])
        const log = (msg: string) => setScriptLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`])

        try {
            const modKey = isMacOS ? 'command' : 'ctrl'

            log('开始执行 WPS 表格插入脚本...')

            // 输入表格标题（使用粘贴方式支持中文）
            log('输入表格标题')
            await input.hideMainWindowPasteText('项目进度表')
            await delay(200)
            await input.simulateKeyboardTap('a', modKey)
            await delay(100)
            await input.simulateKeyboardTap('b', modKey)
            await delay(100)
            await input.simulateKeyboardTap('end')
            await delay(100)
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.simulateKeyboardTap('enter')
            await delay(100)
            await input.simulateKeyboardTap('b', modKey) // 取消加粗
            await delay(200)

            // 模拟输入简易表格（使用 Tab 分隔，使用粘贴方式支持中文）
            log('输入表格内容')
            const tableData = [
                ['任务名称', '负责人', '状态', '完成度'],
                ['需求分析', '张三', '已完成', '100%'],
                ['UI设计', '李四', '进行中', '60%'],
                ['前端开发', '王五', '待开始', '0%'],
                ['后端开发', '赵六', '待开始', '0%'],
            ]

            for (let i = 0; i < tableData.length; i++) {
                const row = tableData[i]
                for (let j = 0; j < row.length; j++) {
                    await input.hideMainWindowPasteText(row[j])
                    if (j < row.length - 1) {
                        await delay(100)
                        await input.simulateKeyboardTap('tab')
                    }
                    await delay(150)
                }
                await input.simulateKeyboardTap('enter')
                await delay(150)
            }

            log('保存文档')
            await input.simulateKeyboardTap('s', modKey)
            await delay(300)

            log('表格插入完成！')
            notify.success('表格插入脚本执行完成')
        } catch (error) {
            log(`执行出错: ${error}`)
            notify.error('脚本执行失败')
            console.error(error)
        } finally {
            await restoreInputWindowsAfterInput()
            setBusyAction(null)
        }
    }

    // 快速格式化选中文本
    const runQuickFormatScript = async () => {
        setBusyAction('quickFormat')
        setScriptLog([])
        const log = (msg: string) => setScriptLog((prev) => [...prev, `${new Date().toLocaleTimeString()} - ${msg}`])

        try {
            const modKey = isMacOS ? 'command' : 'ctrl'

            log('开始快速格式化选中文本...')
            log('请确保已在 WPS 中选中要格式化的文本')

            // 加粗
            log('设置加粗')
            await input.simulateKeyboardTap('b', modKey)
            await delay(200)

            // 斜体
            log('设置斜体')
            await input.simulateKeyboardTap('i', modKey)
            await delay(200)

            // 下划线
            log('设置下划线')
            await input.simulateKeyboardTap('u', modKey)
            await delay(200)

            log('格式化完成！文本已设置为：加粗 + 斜体 + 下划线')
            notify.success('快速格式化完成')
        } catch (error) {
            log(`执行出错: ${error}`)
            notify.error('格式化失败')
        } finally {
            await restoreInputWindowsAfterInput()
            setBusyAction(null)
        }
    }

    const handleRestoreWindows = async () => {
        await runAction('restoreWindows', () => input.restoreWindows())
    }

    const handleOpenAccessibilitySettings = async () => {
        const ok = await permission.openSystemSettings('accessibility')
        if (ok) {
            notify.info('已打开辅助功能设置')
        } else {
            notify.warning('当前系统不支持自动打开设置')
        }
    }

    const apiGroups: ApiReferenceGroup[] = useMemo(
        () => [
            {
                title: 'Input API',
                items: [
                    {
                        name: 'input.hideMainWindowPasteText(text)',
                        description: '将文本写入剪贴板并粘贴到目标应用。附着窗口会隐藏，独立窗口保持可见。',
                    },
                    {
                        name: 'input.hideMainWindowPasteImage(image)',
                        description: '将图片路径、Data URL 或二进制图片粘贴到目标应用。附着窗口会隐藏，独立窗口保持可见。',
                    },
                    {
                        name: 'input.hideMainWindowPasteFile(filePaths)',
                        description: '将一个或多个文件路径写入系统文件剪贴板并粘贴到目标应用。附着窗口会隐藏，独立窗口保持可见。',
                    },
                    {
                        name: 'input.hideMainWindowTypeString(text)',
                        description: '将焦点切回目标应用并模拟键入文本，不依赖剪贴板。',
                    },
                    {
                        name: 'input.restoreWindows()',
                        description: '连续输入完成后恢复被输入 API 隐藏的窗口。',
                    },
                    {
                        name: 'input.simulateKeyboardTap(key, ...modifiers)',
                        description: '将焦点切回目标应用并模拟单键或组合键。',
                    },
                    {
                        name: 'input.simulateMouseMove(x, y)',
                        description: '将焦点切回目标应用并移动鼠标到屏幕坐标。',
                    },
                    {
                        name: 'input.simulateMouseClick(x, y)',
                        description: '将焦点切回目标应用并模拟鼠标左键单击。',
                    },
                    {
                        name: 'input.simulateMouseDoubleClick(x, y)',
                        description: '将焦点切回目标应用并模拟鼠标左键双击。',
                    },
                    {
                        name: 'input.simulateMouseRightClick(x, y)',
                        description: '将焦点切回目标应用并模拟鼠标右键点击。',
                    },
                ],
            },
            {
                title: 'Related APIs',
                items: [
                    {
                        name: 'screen.getCursorScreenPoint()',
                        description: '获取当前鼠标屏幕坐标，用于鼠标模拟操作。',
                    },
                    {
                        name: 'system.isMacOS()',
                        description: '判断平台，选择 command 或 ctrl 等平台差异键。',
                    },
                    {
                        name: 'permission.isAccessibilityTrusted()',
                        description: '检查 macOS 辅助功能授权状态。',
                    },
                    {
                        name: "permission.openSystemSettings('accessibility')",
                        description: '打开辅助功能系统设置。',
                    },
                ],
            },
        ],
        [],
    )

    const apiExamples: ApiExample[] = useMemo(
        () => [
            {
                title: '粘贴和键入',
                code: `await window.mulby.input.hideMainWindowPasteText('Hello Mulby')
await window.mulby.input.hideMainWindowPasteImage('/path/to/image.png')
await window.mulby.input.hideMainWindowPasteFile(['/path/a.txt', '/path/b.txt'])
await window.mulby.input.hideMainWindowTypeString('Typing...')
await window.mulby.input.restoreWindows()`,
            },
            {
                title: '连续输入并恢复窗口',
                code: `await window.mulby.input.hideMainWindowTypeString('username')
await window.mulby.input.simulateKeyboardTap('tab')
await window.mulby.input.hideMainWindowTypeString('password')
await window.mulby.input.simulateKeyboardTap('enter')
await window.mulby.input.restoreWindows()`,
            },
            {
                title: '键盘和鼠标模拟',
                code: `await window.mulby.input.simulateKeyboardTap('s', 'ctrl', 'shift')

const pos = await window.mulby.screen.getCursorScreenPoint()
await window.mulby.input.simulateMouseMove(pos.x, pos.y)
await window.mulby.input.simulateMouseClick(pos.x, pos.y)
await window.mulby.input.restoreWindows()`,
            },
            {
                title: '自动化脚本片段',
                code: `const modKey = isMacOS ? 'command' : 'ctrl'

await window.mulby.input.hideMainWindowPasteText('我的文档标题')
await window.mulby.input.simulateKeyboardTap('a', modKey)
await window.mulby.input.simulateKeyboardTap('b', modKey)
await window.mulby.input.simulateKeyboardTap('enter')
await window.mulby.input.hideMainWindowPasteText('这是正文内容...')
await window.mulby.input.restoreWindows()`,
            },
        ],
        [],
    )

    const rawData = {
        platform: {
            isMacOS,
            accessibilityTrusted,
        },
        inputState: {
            pasteTextLength: pasteText.length,
            typeTextLength: typeText.length,
            keyboardKey,
            keyboardModifiers,
            mouse: {
                x: mouseX,
                y: mouseY,
                current: currentMousePos,
            },
            busyAction,
            lastAction,
        },
        scriptLog,
    }

    return (
        <div className="main-content">
            <PageHeader icon={Keyboard} title="输入控制" description="向外部应用发送粘贴、键入和键鼠模拟操作" />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <Card
                        title="权限检查"
                        icon={CheckCircle2}
                        actions={
                            isMacOS ? (
                                <Button variant="secondary" onClick={handleOpenAccessibilitySettings}>
                                    打开系统设置
                                </Button>
                            ) : null
                        }
                    >
                        {isMacOS ? (
                            <div style={{ display: 'grid', gap: '8px' }}>
                                <div style={{ color: 'var(--text-secondary)' }}>
                                    当前状态：
                                    {accessibilityTrusted === null ? '未知' : accessibilityTrusted ? '已授权' : '未授权'}
                                </div>
                                {!accessibilityTrusted && <div style={{ color: 'var(--warning)' }}>需要在“辅助功能”中允许 Mulby/Electron 发送按键，才能模拟输入。</div>}
                            </div>
                        ) : (
                            <div style={{ color: 'var(--text-secondary)' }}>非 macOS 平台无需辅助功能权限。</div>
                        )}
                    </Card>

                    <Card
                        title="使用教程"
                        icon={Pin}
                        actions={
                            <Button variant="secondary" onClick={handleRestoreWindows} loading={busyAction === 'restoreWindows'}>
                                <RotateCcw className="inline-icon" aria-hidden="true" size={14} />
                                恢复窗口
                            </Button>
                        }
                    >
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div>
                                1. <strong>打开目标应用</strong>
                                （例如文本编辑器、浏览器、聊天窗口）。
                            </div>
                            <div>
                                2. <strong>在目标应用中放置光标</strong>
                                ，确保它是你希望接收输入的位置。
                            </div>
                            <div>
                                3. <strong>唤起 Mulby</strong>（通过快捷键 Alt+Space）。
                            </div>
                            <div>
                                4. <strong>点击下方操作按钮</strong>，Mulby 会自动隐藏并向目标应用发送操作。
                            </div>
                            <div
                                style={{
                                    marginTop: '8px',
                                    padding: '8px',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '6px',
                                }}
                            >
                                <Lightbulb className="inline-icon" aria-hidden="true" size={16} strokeWidth={2} />
                                <strong>原理</strong>：所有模拟操作都会先隐藏 Mulby 窗口，让目标应用获得焦点，然后再执行模拟操作。
                            </div>
                        </div>
                    </Card>

                    <Card
                        title="粘贴文本"
                        icon={FileText}
                        actions={
                            <Button onClick={handlePasteText} loading={busyAction === 'pasteText'}>
                                粘贴到目标应用
                            </Button>
                        }
                    >
                        <div className="input-group">
                            <label className="input-label">文本内容</label>
                            <input className="input" placeholder="输入要粘贴的文本" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
                        </div>
                    </Card>

                    <Card
                        title="模拟键入"
                        icon={Type}
                        actions={
                            <Button onClick={handleTypeString} loading={busyAction === 'typeString'}>
                                发送键入
                            </Button>
                        }
                    >
                        <div className="input-group">
                            <label className="input-label">键入内容</label>
                            <input className="input" placeholder="输入要键入的文本" value={typeText} onChange={(e) => setTypeText(e.target.value)} />
                        </div>
                    </Card>

                    <Card
                        title="粘贴图片"
                        icon={Image}
                        actions={
                            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                                <Button variant="secondary" onClick={handlePasteImageFromPath} loading={busyAction === 'pasteImagePath'}>
                                    从文件粘贴
                                </Button>
                                <Button variant="secondary" onClick={handlePasteImageSample} loading={busyAction === 'pasteImageSample'}>
                                    发送示例图片
                                </Button>
                            </div>
                        }
                    >
                        <div style={{ color: 'var(--text-secondary)' }}>图片将写入剪贴板后模拟粘贴，可用于聊天窗口或文档编辑器。</div>
                    </Card>

                    <Card
                        title="粘贴文件"
                        icon={Paperclip}
                        actions={
                            <Button onClick={handlePasteFile} loading={busyAction === 'pasteFile'}>
                                选择文件并粘贴
                            </Button>
                        }
                    >
                        <div style={{ color: 'var(--text-secondary)' }}>选择一个或多个文件，目标应用需支持文件粘贴（如文件管理器或聊天软件）。</div>
                    </Card>

                    {/* 模拟按键部分 */}
                    <div
                        style={{
                            marginTop: '24px',
                            marginBottom: '16px',
                            fontWeight: 600,
                            fontSize: '18px',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        <Gamepad2 className="section-icon" aria-hidden="true" size={18} strokeWidth={2} />
                        <span>模拟按键与鼠标</span>
                    </div>

                    <Card title="模拟操作说明" icon={Lightbulb}>
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div>
                                模拟按键和鼠标操作会<strong>先隐藏 Mulby 窗口</strong>
                                ，让之前活跃的应用获得焦点，然后发送模拟操作。
                            </div>
                            <div>这适用于以下场景：</div>
                            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
                                <li>向编辑器发送快捷键（如 Ctrl+S 保存）</li>
                                <li>在表单中自动输入并提交（模拟 Enter）</li>
                                <li>自动化点击桌面上的某个位置</li>
                            </ul>
                        </div>
                    </Card>

                    <Card
                        title="模拟键盘按键"
                        icon={Keyboard}
                        actions={
                            <Button onClick={handleSimulateKeyboardTap} loading={busyAction === 'keyboardTap'}>
                                模拟按键
                            </Button>
                        }
                    >
                        <div style={{ display: 'grid', gap: '12px' }}>
                            <div className="input-group">
                                <label className="input-label">按键名称</label>
                                <input className="input" placeholder="如: enter, a, f5, space" value={keyboardKey} onChange={(e) => setKeyboardKey(e.target.value)} />
                                <div
                                    style={{
                                        fontSize: '12px',
                                        color: 'var(--text-tertiary)',
                                        marginTop: '4px',
                                    }}
                                >
                                    支持: a-z, 0-9, enter, tab, space, backspace, delete, escape, up/down/left/right, f1-f12 等
                                </div>
                            </div>
                            <div className="input-group">
                                <label className="input-label">修饰键（可选，逗号分隔）</label>
                                <input className="input" placeholder="如: ctrl 或 ctrl,shift 或 command" value={keyboardModifiers} onChange={(e) => setKeyboardModifiers(e.target.value)} />
                                <div
                                    style={{
                                        fontSize: '12px',
                                        color: 'var(--text-tertiary)',
                                        marginTop: '4px',
                                    }}
                                >
                                    支持: ctrl, alt, shift, command (macOS), meta, super, win
                                </div>
                            </div>
                        </div>
                    </Card>

                    <Card
                        title="模拟鼠标操作"
                        icon={MousePointerClick}
                        actions={
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 'var(--spacing-sm)',
                                    flexWrap: 'wrap',
                                }}
                            >
                                <Button variant="secondary" onClick={handleGetMousePosition}>
                                    获取鼠标位置
                                </Button>
                                <Button variant="secondary" onClick={handleSimulateMouseMove} loading={busyAction === 'mouseMove'}>
                                    移动鼠标
                                </Button>
                                <Button onClick={handleSimulateMouseClick} loading={busyAction === 'mouseClick'}>
                                    左键单击
                                </Button>
                                <Button variant="secondary" onClick={handleSimulateMouseDoubleClick} loading={busyAction === 'mouseDoubleClick'}>
                                    左键双击
                                </Button>
                                <Button variant="secondary" onClick={handleSimulateMouseRightClick} loading={busyAction === 'mouseRightClick'}>
                                    右键点击
                                </Button>
                            </div>
                        }
                    >
                        <div style={{ display: 'grid', gap: '12px' }}>
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                <div className="input-group" style={{ flex: 1 }}>
                                    <label className="input-label">X 坐标</label>
                                    <input className="input" type="number" placeholder="X" value={mouseX} onChange={(e) => setMouseX(Number(e.target.value))} />
                                </div>
                                <div className="input-group" style={{ flex: 1 }}>
                                    <label className="input-label">Y 坐标</label>
                                    <input className="input" type="number" placeholder="Y" value={mouseY} onChange={(e) => setMouseY(Number(e.target.value))} />
                                </div>
                            </div>
                            {currentMousePos && (
                                <div
                                    style={{
                                        padding: '8px 12px',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                    }}
                                >
                                    当前鼠标位置:{' '}
                                    <strong>
                                        ({currentMousePos.x}, {currentMousePos.y})
                                    </strong>
                                </div>
                            )}
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>坐标以屏幕左上角为原点，单位为像素。点击"获取鼠标位置"可以获取当前鼠标坐标。</div>
                        </div>
                    </Card>

                    <Card title="常用快捷键示例" icon={Zap}>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <Button variant="secondary" onClick={() => runSimulateAction('copy', () => input.simulateKeyboardTap('c', isMacOS ? 'command' : 'ctrl'))} loading={busyAction === 'copy'}>
                                复制 (Cmd/Ctrl+C)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('paste', () => input.simulateKeyboardTap('v', isMacOS ? 'command' : 'ctrl'))} loading={busyAction === 'paste'}>
                                粘贴 (Cmd/Ctrl+V)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('cut', () => input.simulateKeyboardTap('x', isMacOS ? 'command' : 'ctrl'))} loading={busyAction === 'cut'}>
                                剪切 (Cmd/Ctrl+X)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('save', () => input.simulateKeyboardTap('s', isMacOS ? 'command' : 'ctrl'))} loading={busyAction === 'save'}>
                                保存 (Cmd/Ctrl+S)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('undo', () => input.simulateKeyboardTap('z', isMacOS ? 'command' : 'ctrl'))} loading={busyAction === 'undo'}>
                                撤销 (Cmd/Ctrl+Z)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('selectAll', () => input.simulateKeyboardTap('a', isMacOS ? 'command' : 'ctrl'))} loading={busyAction === 'selectAll'}>
                                全选 (Cmd/Ctrl+A)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('enter', () => input.simulateKeyboardTap('enter'))} loading={busyAction === 'enter'}>
                                回车 (Enter)
                            </Button>
                            <Button variant="secondary" onClick={() => runSimulateAction('escape', () => input.simulateKeyboardTap('escape'))} loading={busyAction === 'escape'}>
                                取消 (Escape)
                            </Button>
                        </div>
                    </Card>

                    <Card title="注意事项" icon={AlertTriangle}>
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div>
                                <strong>macOS:</strong> 需要在系统偏好设置中授予辅助功能权限。
                            </div>
                            <div>
                                <strong>Windows:</strong> 某些受保护的应用可能无法接收模拟输入。
                            </div>
                            <div>
                                <strong>Linux:</strong> 依赖 xdotool 工具，Wayland 环境可能受限。
                            </div>
                            <div>
                                <strong>坐标系统:</strong> 鼠标坐标以整个屏幕左上角为原点，多显示器环境下需注意坐标计算。
                            </div>
                        </div>
                    </Card>

                    {/* WPS 自动化脚本部分 */}
                    <div
                        style={{
                            marginTop: '24px',
                            marginBottom: '16px',
                            fontWeight: 600,
                            fontSize: '18px',
                            color: 'var(--text-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        <FileText className="section-icon" aria-hidden="true" size={18} strokeWidth={2} />
                        <span>WPS 文档自动化脚本</span>
                    </div>

                    <Card title="使用说明" icon={BookOpen}>
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>操作步骤：</div>
                            <div>1. 打开 WPS 文字，新建或打开一个文档</div>
                            <div>2. 将光标放置在文档中你希望开始操作的位置</div>
                            <div>
                                3. 按{' '}
                                <kbd
                                    style={{
                                        padding: '2px 6px',
                                        background: 'var(--bg-tertiary)',
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                    }}
                                >
                                    Alt+Space
                                </kbd>{' '}
                                唤起 Mulby
                            </div>
                            <div>4. 进入"输入控制"模块，点击下方任一脚本按钮</div>
                            <div>5. Mulby 会自动隐藏，脚本将在 WPS 中执行</div>
                            <div
                                style={{
                                    marginTop: '8px',
                                    padding: '8px',
                                    background: 'var(--warning)',
                                    color: '#000',
                                    borderRadius: '6px',
                                    opacity: 0.8,
                                }}
                            >
                                <AlertTriangle className="inline-icon" aria-hidden="true" size={16} strokeWidth={2} />
                                <span>脚本执行期间请勿操作键盘鼠标，否则可能干扰自动化流程</span>
                            </div>
                        </div>
                    </Card>

                    <Card
                        title="自动创建格式化文档"
                        icon={FileText}
                        actions={
                            <Button onClick={runWpsAutoScript} loading={busyAction === 'wpsScript'}>
                                执行脚本
                            </Button>
                        }
                    >
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div>此脚本将自动执行以下操作：</div>
                            <ul
                                style={{
                                    margin: '4px 0',
                                    paddingLeft: '20px',
                                    lineHeight: 1.8,
                                }}
                            >
                                <li>
                                    输入标题并设置<strong>加粗、居中</strong>
                                </li>
                                <li>输入正文段落</li>
                                <li>创建功能列表</li>
                                <li>添加时间戳</li>
                                <li>自动保存文档</li>
                            </ul>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>预计执行时间：约 8-10 秒</div>
                        </div>
                    </Card>

                    <Card
                        title="快速插入表格"
                        icon={Table}
                        actions={
                            <Button onClick={runWpsTableScript} loading={busyAction === 'wpsTableScript'}>
                                执行脚本
                            </Button>
                        }
                    >
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div>此脚本将自动插入一个项目进度表：</div>
                            <ul
                                style={{
                                    margin: '4px 0',
                                    paddingLeft: '20px',
                                    lineHeight: 1.8,
                                }}
                            >
                                <li>输入表格标题（加粗）</li>
                                <li>使用 Tab 分隔输入表格数据</li>
                                <li>包含 5 行 4 列的示例数据</li>
                                <li>自动保存文档</li>
                            </ul>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                <Lightbulb className="inline-icon" aria-hidden="true" size={16} strokeWidth={2} />
                                <span>提示：输入后可以选中表格区域，使用 WPS 的"文本转表格"功能</span>
                            </div>
                        </div>
                    </Card>

                    <Card
                        title="快速格式化选中文本"
                        icon={Sparkles}
                        actions={
                            <Button onClick={runQuickFormatScript} loading={busyAction === 'quickFormat'}>
                                执行脚本
                            </Button>
                        }
                    >
                        <div
                            style={{
                                display: 'grid',
                                gap: '8px',
                                color: 'var(--text-secondary)',
                            }}
                        >
                            <div>
                                <strong>使用前请先在 WPS 中选中要格式化的文本</strong>
                            </div>
                            <div>此脚本将对选中文本应用：</div>
                            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
                                <li>
                                    <strong>加粗</strong> (Ctrl+B)
                                </li>
                                <li>
                                    <em>斜体</em> (Ctrl+I)
                                </li>
                                <li>
                                    <u>下划线</u> (Ctrl+U)
                                </li>
                            </ul>
                        </div>
                    </Card>

                    {/* 脚本执行日志 */}
                    {scriptLog.length > 0 && (
                        <Card
                            title="执行日志"
                            icon={ClipboardList}
                            actions={
                                <Button variant="secondary" onClick={() => setScriptLog([])}>
                                    清空日志
                                </Button>
                            }
                        >
                            <div
                                style={{
                                    maxHeight: '200px',
                                    overflowY: 'auto',
                                    padding: '8px 12px',
                                    background: 'var(--bg-tertiary)',
                                    borderRadius: '6px',
                                    fontFamily: 'monospace',
                                    fontSize: '12px',
                                    lineHeight: 1.8,
                                }}
                            >
                                {scriptLog.map((log, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            color: log.includes('执行出错') ? 'var(--error)' : log.includes('完成') ? 'var(--success)' : log.includes('请确保') ? 'var(--warning)' : 'var(--text-secondary)',
                                        }}
                                    >
                                        {log}
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
