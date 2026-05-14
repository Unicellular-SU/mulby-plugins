
import {
    Bot,
    CalendarClock,
    Clipboard,
    FileText,
    Film,
    FolderOpen,
    Image,
    Keyboard,
    ListChecks,
    MessageSquare,
    Monitor,
    Network,
    PackageOpen,
    PanelsTopLeft,
    Puzzle,
    Settings,
    ShieldCheck,
    SlidersHorizontal,
    Terminal,
    Volume2,
    WandSparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface SidebarProps {
    activeModule: string
    onModuleChange: (module: string) => void
}

interface ModuleItem {
    id: string
    icon: LucideIcon
    label: string
}

const modules: ModuleItem[] = [
    { id: 'sysinfo', icon: Monitor, label: '系统信息' },
    { id: 'clipboard', icon: Clipboard, label: '剪贴板' },
    { id: 'input', icon: Keyboard, label: '输入控制' },
    { id: 'filemanager', icon: FolderOpen, label: '文件管理' },
    { id: 'network', icon: Network, label: '网络' },
    { id: 'screen', icon: Monitor, label: '屏幕' },
    { id: 'media', icon: Volume2, label: '媒体' },
    { id: 'window-api', label: '窗口 API', icon: PanelsTopLeft },
    { id: 'child-window', label: 'Child Window', icon: Image },
    { id: 'inbrowser', label: 'InBrowser', icon: Bot },
    { id: 'sharp', label: 'Sharp 图像', icon: Image },
    { id: 'ffmpeg', label: 'FFmpeg 音视频', icon: Film },
    { id: 'settings', icon: Settings, label: '设置' },
    { id: 'security', icon: ShieldCheck, label: '存储与安全' },
    { id: 'attachments', icon: PackageOpen, label: '附件' },
    { id: 'ai', icon: WandSparkles, label: 'AI' },
    { id: 'scheduler', icon: CalendarClock, label: '任务调度' },
    { id: 'messaging', icon: MessageSquare, label: '插件通信' },
    { id: 'host-rpc', icon: Terminal, label: 'Host RPC' },
    { id: 'plugin', icon: Puzzle, label: '插件编排' },
    { id: 'features', icon: ListChecks, label: '动态指令' },
    { id: 'log', icon: FileText, label: '日志' },
]

export function Sidebar({ activeModule, onModuleChange }: SidebarProps) {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <h1 className="sidebar-title">
                    <SlidersHorizontal className="section-icon" aria-hidden="true" size={18} strokeWidth={2} />
                    <span>Mulby</span>
                </h1>
            </div>
            <nav className="sidebar-nav">
                {modules.map((module) => {
                    const Icon = module.icon

                    return (
                        <div
                            key={module.id}
                            className={`nav-item ${activeModule === module.id ? 'active' : ''}`}
                            onClick={() => onModuleChange(module.id)}
                        >
                            <Icon className="icon" aria-hidden="true" size={16} strokeWidth={2} />
                            <span>{module.label}</span>
                        </div>
                    )
                })}
            </nav>
        </aside>
    )
}
