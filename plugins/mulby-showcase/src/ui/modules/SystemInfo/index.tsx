import React, { useState, useEffect, useCallback } from 'react'
import {
    Battery,
    Activity,
    Computer,
    FolderOpen,
    Image,
    KeyRound,
    MapPin,
    Monitor,
    Package,
    Plug,
    Smartphone,
    Timer,
    Wifi,
    WifiOff,
    Wrench,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

interface SystemInfo {
    platform: string
    arch: string
    hostname: string
    username: string
    homedir: string
    tmpdir: string
    cpus: number
    totalmem: number
    freemem: number
    uptime: number
    osVersion: string
    osRelease: string
}

interface AppInfo {
    name: string
    version: string
    locale: string
    isPackaged: boolean
    userDataPath: string
}

interface AppResourceProcessUsage {
    pid: number
    type: string
    name?: string
    cpuPercent: number
    workingSetBytes: number
}

interface AppResourceDiskUsage {
    userDataPath: string
    userDataBytes: number
    fileCount: number
    directoryCount: number
    truncated: boolean
    scannedAt: number
}

interface AppResourceUsage {
    sampledAt: number
    cpuPercent: number
    memoryBytes: number
    processCount: number
    disk: AppResourceDiskUsage
    processes: AppResourceProcessUsage[]
}

interface Position {
    latitude: number
    longitude: number
    accuracy: number
    source: 'native' | 'web' | 'ip'
    provider: 'macos-corelocation' | 'windows-location-service' | 'linux-geoclue' | 'electron-web' | 'ip' | 'freegeoip.app' | 'ip-api.com' | 'ipwho.is'
    timestamp: number
    fallbackUsed: boolean
    attempts: Array<{
        provider: string
        source: 'native' | 'web' | 'ip'
        status: 'success' | 'skipped' | 'error'
        accuracy?: number
        message?: string
    }>
    altitude?: number | null
    altitudeAccuracy?: number | null
    heading?: number | null
    speed?: number | null
}

type NativeLocationTestState = {
    status: 'idle' | 'testing' | 'success' | 'failed'
    message: string
    checkedAt: number | null
}

const formatLocationAttemptSummary = (position: Position) => {
    return position.attempts
        .map((attempt) => {
            const accuracy = typeof attempt.accuracy === 'number' ? `, ${attempt.accuracy.toFixed(0)}m` : ''
            const message = attempt.message ? `: ${attempt.message}` : ''
            return `${attempt.provider}=${attempt.status}${accuracy}${message}`
        })
        .join(' / ')
}

export function SystemInfoModule() {
    console.log('[SystemInfo] Render')
    const { system, power, network, geolocation } = useMulby()
    const notify = useNotification()

    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
    const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
    const [appResourceUsage, setAppResourceUsage] = useState<AppResourceUsage | null>(null)
    const [paths, setPaths] = useState<Record<string, string>>({})
    const [envValues, setEnvValues] = useState<Record<string, string | undefined>>({})
    const [isOnline, setIsOnline] = useState<boolean | null>(null)
    const [isOnBattery, setIsOnBattery] = useState<boolean | null>(null)
    const [idleTime, setIdleTime] = useState<number | null>(null)
    const [idleState, setIdleState] = useState<'active' | 'idle' | 'locked' | 'unknown' | null>(null)
    const [systemIdleTime, setSystemIdleTime] = useState<number | null>(null)
    const [thermalState, setThermalState] = useState<string | null>(null)
    const [position, setPosition] = useState<Position | null>(null)
    const [loading, setLoading] = useState(true)

    // 新增状态
    const [nativeId, setNativeId] = useState<string | null>(null)
    const [isDev, setIsDev] = useState<boolean | null>(null)
    const [platform, setPlatform] = useState<{ isMacOS: boolean; isWindows: boolean; isLinux: boolean } | null>(null)
    const [fileIcon, setFileIcon] = useState<string | null>(null)
    const [batchFileIcons, setBatchFileIcons] = useState<Array<{ key: string; path: string; kind: 'app' | 'file'; icon: string }>>([])
    const [iconPath, setIconPath] = useState<string>('.txt')
    const [geolocationAccessStatus, setGeolocationAccessStatus] = useState<string | null>(null)
    const [canGetPosition, setCanGetPosition] = useState<boolean | null>(null)
    const [nativeLocationTest, setNativeLocationTest] = useState<NativeLocationTestState>({
        status: 'idle',
        message: '尚未测试',
        checkedAt: null
    })

    const loadData = useCallback(async () => {
        console.log('[SystemInfo] loadData start')
        setLoading(true)
        try {
            // System Info
            console.log('[SystemInfo] fetching system info...')
            const sysInfo = await system.getSystemInfo()
            console.log('[SystemInfo] got system info', sysInfo)
            if (sysInfo) setSystemInfo(sysInfo)

            // App Info
            console.log('[SystemInfo] fetching app info...')
            const app = await system.getAppInfo()
            console.log('[SystemInfo] got app info', app)
            if (app) setAppInfo(app)

            const usage = await system.getAppResourceUsage()
            console.log('[SystemInfo] got app resource usage', usage)
            setAppResourceUsage(usage)

            // System Paths (扩展支持 exe 和 logs)
            console.log('[SystemInfo] fetching paths...')
            const pathNames: ('home' | 'appData' | 'userData' | 'desktop' | 'downloads' | 'documents' | 'pictures' | 'music' | 'videos' | 'temp' | 'exe' | 'logs')[] =
                ['home', 'appData', 'userData', 'desktop', 'downloads', 'documents', 'pictures', 'music', 'videos', 'temp', 'exe', 'logs']
            const pathResults: Record<string, string> = {}
            for (const name of pathNames) {
                try {
                    const path = await system.getPath(name)
                    if (path) pathResults[name] = path
                } catch (e) {
                    console.warn(`[SystemInfo] Failed to get path: ${name}`, e)
                }
            }
            console.log('[SystemInfo] got paths', pathResults)
            setPaths(pathResults)

            const envNames = ['PATH', 'HOME', 'USERPROFILE']
            const envResults: Record<string, string | undefined> = {}
            for (const name of envNames) {
                envResults[name] = await system.getEnv(name)
            }
            console.log('[SystemInfo] got env values', envResults)
            setEnvValues(envResults)

            // Network Status
            console.log('[SystemInfo] fetching network status...')
            const online = await network.isOnline()
            console.log('[SystemInfo] got online status', online)
            setIsOnline(online ?? null)

            // Power Status
            console.log('[SystemInfo] fetching power status...')
            const battery = await power.isOnBatteryPower()
            console.log('[SystemInfo] got battery status', battery)
            setIsOnBattery(battery ?? null)

            const thermal = await power.getCurrentThermalState()
            console.log('[SystemInfo] got thermal state', thermal)
            setThermalState(thermal ?? null)

            // Idle Time
            const idle = await power.getSystemIdleTime()
            console.log('[SystemInfo] got idle time', idle)
            setIdleTime(idle ?? null)

            const state = await power.getSystemIdleState(60)
            console.log('[SystemInfo] got idle state', state)
            setIdleState(state ?? null)

            const systemIdle = await system.getIdleTime()
            console.log('[SystemInfo] got system idle time', systemIdle)
            setSystemIdleTime(systemIdle ?? null)

            // 新增 API 调用
            // getNativeId
            const deviceId = await system.getNativeId()
            console.log('[SystemInfo] got native id', deviceId)
            setNativeId(deviceId)

            // isDev
            const devMode = await system.isDev()
            console.log('[SystemInfo] isDev', devMode)
            setIsDev(devMode)

            // Platform detection
            const [mac, win, linux] = await Promise.all([
                system.isMacOS(),
                system.isWindows(),
                system.isLinux()
            ])
            console.log('[SystemInfo] platform', { mac, win, linux })
            setPlatform({ isMacOS: mac, isWindows: win, isLinux: linux })

            // getFileIcon (默认 .txt)
            const icon = await system.getFileIcon('.txt')
            console.log('[SystemInfo] got file icon')
            setFileIcon(icon)

            const icons = await system.getFileIcons(
                [
                    { key: 'text', path: '.txt', kind: 'file' },
                    { key: 'pdf', path: '.pdf', kind: 'file' },
                    { key: 'image', path: '.png', kind: 'file' },
                ],
                { size: 32, concurrency: 3 }
            )
            console.log('[SystemInfo] got batch file icons', icons)
            setBatchFileIcons(icons)

            const locationStatus = await geolocation.getAccessStatus()
            const locationAvailable = await geolocation.canGetPosition()
            console.log('[SystemInfo] got geolocation availability', { locationStatus, locationAvailable })
            setGeolocationAccessStatus(locationStatus)
            setCanGetPosition(locationAvailable)

        } catch (error) {
            console.error('[SystemInfo] Error loading data:', error)
            notify.error('加载系统信息失败')
            console.error(error)
        } finally {
            console.log('[SystemInfo] loadData finished')
            setLoading(false)
        }
    }, [system, power, network, geolocation, notify])

    useEffect(() => {
        console.log('[SystemInfo] Effect trigger loadData')
        loadData()
    }, [loadData])

    const handleGetLocation = async () => {
        console.log('[SystemInfo] handleGetLocation called')
        try {
            // 先检查权限状态
            const status = await geolocation.getAccessStatus()
            console.log('[SystemInfo] Geolocation access status:', status)
            setGeolocationAccessStatus(status)

            if (status === 'denied' || status === 'restricted') {
                notify.error('位置权限被拒绝，请在系统设置中开启')
                // 打开系统设置
                await geolocation.openSettings()
                return
            }

            if (status === 'not-determined') {
                // 请求权限
                const newStatus = await geolocation.requestAccess()
                console.log('[SystemInfo] Permission request result:', newStatus)
                setGeolocationAccessStatus(newStatus)
                if (newStatus === 'denied' || newStatus === 'restricted') {
                    notify.error('位置权限未授权')
                    return
                }
            }

            const locationAvailable = await geolocation.canGetPosition()
            setCanGetPosition(locationAvailable)
            if (!locationAvailable) {
                notify.error('当前位置流程不可用')
                return
            }

            // 获取位置
            console.log('[SystemInfo] Getting current position...')
            const pos = await geolocation.getCurrentPosition({ desiredAccuracy: 'best', allowFallback: true, timeoutMs: 10000 })
            console.log('[SystemInfo] Got position:', pos)
            if (pos) {
                setPosition(pos)
                notify.success(pos.fallbackUsed ? '位置获取成功，已使用后备定位' : '位置获取成功')
            }
        } catch (error) {
            console.error('[SystemInfo] Error getting location:', error)
            notify.error('获取位置失败: ' + (error instanceof Error ? error.message : String(error)))
        }
    }

    const handleTestNativeLocation = async () => {
        console.log('[SystemInfo] handleTestNativeLocation called')
        setNativeLocationTest({
            status: 'testing',
            message: '正在测试精确定位...',
            checkedAt: null
        })

        try {
            const status = await geolocation.getAccessStatus()
            setGeolocationAccessStatus(status)
            if (!status) {
                throw new Error('地理位置 API 不可用')
            }

            if (status === 'denied' || status === 'restricted') {
                setNativeLocationTest({
                    status: 'failed',
                    message: '定位权限被拒绝或受限，无法验证精确定位',
                    checkedAt: Date.now()
                })
                notify.error('定位权限不可用，请在系统设置中开启')
                await geolocation.openSettings()
                return
            }

            if (status === 'not-determined') {
                const newStatus = await geolocation.requestAccess()
                setGeolocationAccessStatus(newStatus)
                if (newStatus === 'denied' || newStatus === 'restricted') {
                    setNativeLocationTest({
                        status: 'failed',
                        message: '定位权限未授权，精确定位测试失败',
                        checkedAt: Date.now()
                    })
                    notify.error('位置权限未授权')
                    return
                }
            }

            const locationAvailable = await geolocation.canGetPosition()
            setCanGetPosition(locationAvailable)
            if (!locationAvailable) {
                setNativeLocationTest({
                    status: 'failed',
                    message: '当前位置流程不可用',
                    checkedAt: Date.now()
                })
                notify.error('当前位置流程不可用')
                return
            }

            const pos = await geolocation.getCurrentPosition({ desiredAccuracy: 'best', allowFallback: false, timeoutMs: 10000 })
            if (!pos) {
                throw new Error('未返回定位结果')
            }
            setPosition(pos)

            const accuracy = Number(pos.accuracy)
            const source = pos.source ?? (Number.isFinite(accuracy) && accuracy <= 100 ? 'native' : 'ip')
            if (source === 'native' || source === 'web') {
                setNativeLocationTest({
                    status: 'success',
                    message: `精确定位可用（provider=${pos.provider}，source=${source}，精度约 ${Number.isFinite(accuracy) ? accuracy.toFixed(0) : '未知'} 米）`,
                    checkedAt: Date.now()
                })
                notify.success('精确定位测试成功')
                return
            }

            const accuracyText = Number.isFinite(accuracy) ? `${accuracy.toFixed(0)} 米` : '未知'
            setNativeLocationTest({
                status: 'failed',
                message: `精确定位不可用（source=${source}，provider=${pos.provider}，当前精度 ${accuracyText}）`,
                checkedAt: Date.now()
            })
            notify.error('精确定位测试失败')
        } catch (error) {
            console.error('[SystemInfo] Error testing native geolocation:', error)
            setNativeLocationTest({
                status: 'failed',
                message: error instanceof Error ? error.message : String(error),
                checkedAt: Date.now()
            })
            notify.error('原生定位测试失败')
        }
    }

    const nativeLocationStatusBadge: 'success' | 'warning' | 'error' | 'info' =
        nativeLocationTest.status === 'success'
            ? 'success'
            : nativeLocationTest.status === 'failed'
                ? 'error'
                : nativeLocationTest.status === 'testing'
                    ? 'warning'
                    : 'info'

    const handleGetFileIcon = async () => {
        try {
            const icon = await system.getFileIcon(iconPath)
            setFileIcon(icon)
            notify.success('图标获取成功')
        } catch (error) {
            notify.error('获取图标失败')
            console.error(error)
        }
    }

    const formatBytes = (bytes: number) => {
        const gb = bytes / 1024 / 1024 / 1024
        return `${gb.toFixed(2)} GB`
    }

    const formatUptime = (seconds: number) => {
        const days = Math.floor(seconds / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)
        const mins = Math.floor((seconds % 3600) / 60)
        return `${days}天 ${hours}小时 ${mins}分钟`
    }

    const apiGroups: ApiReferenceGroup[] = [
        {
            title: 'System API',
            items: [
                { name: 'system.getSystemInfo()', description: '获取操作系统平台、架构、主机名、CPU、内存和运行时间。' },
                { name: 'system.getAppInfo()', description: '获取 Mulby 应用名称、版本、语言、打包状态和用户数据目录。' },
                { name: 'system.getAppResourceUsage()', description: '获取 Mulby 应用自身 CPU、内存、用户数据目录磁盘占用和进程快照。' },
                { name: 'system.getPath(name)', description: '获取桌面、下载、文档、用户数据、可执行文件和日志等系统路径。' },
                { name: 'system.getEnv(name)', description: '读取指定环境变量，返回字符串或 undefined。' },
                { name: 'system.getIdleTime()', description: '获取系统空闲时间，等价于系统模块入口的空闲时间查询。' },
                { name: 'system.getFileIcon(path)', description: '获取单个文件、扩展名或文件夹的系统图标 Data URL。' },
                { name: 'system.getFileIcons(requests, options)', description: '批量获取文件或应用图标，适合列表批量渲染。' },
                { name: 'system.getNativeId()', description: '获取当前设备的 32 位唯一标识。' },
                { name: 'system.isDev() / isMacOS() / isWindows() / isLinux()', description: '判断运行环境和当前操作系统平台。' },
            ],
        },
        {
            title: 'Power / Network / Geolocation',
            items: [
                { name: 'power.getSystemIdleTime()', description: '获取系统空闲秒数。' },
                { name: 'power.getSystemIdleState(idleThreshold)', description: '按阈值获取 active、idle、locked 或 unknown 状态。' },
                { name: 'power.isOnBatteryPower()', description: '检查当前是否使用电池供电。' },
                { name: 'power.getCurrentThermalState()', description: '获取当前热状态，macOS 返回更细状态，其他平台通常为 unknown。' },
                { name: 'network.isOnline()', description: '检查当前网络是否在线。' },
                { name: 'geolocation.getAccessStatus()', description: '获取定位权限状态。' },
                { name: 'geolocation.requestAccess()', description: '请求定位权限，macOS 会尝试触发系统权限流程。' },
                { name: 'geolocation.canGetPosition()', description: '检查定位流程是否可以继续。' },
                { name: 'geolocation.getCurrentPosition(options)', description: '按系统定位、Electron Web 定位、IP 后备的顺序获取位置，并返回每次尝试的诊断信息。' },
            ],
        },
    ]

    const apiExamples: ApiExample[] = [
        {
            title: '加载系统与应用信息',
            code: `const systemInfo = await window.mulby.system.getSystemInfo()
const appInfo = await window.mulby.system.getAppInfo()
const usage = await window.mulby.system.getAppResourceUsage()

console.log(systemInfo.platform, systemInfo.arch)
console.log(appInfo.version, usage.cpuPercent)`,
        },
        {
            title: '读取路径、环境变量和系统图标',
            code: `const desktop = await window.mulby.system.getPath('desktop')
const pathEnv = await window.mulby.system.getEnv('PATH')
const txtIcon = await window.mulby.system.getFileIcon('.txt')
const icons = await window.mulby.system.getFileIcons(
  [
    { key: 'text', path: '.txt', kind: 'file' },
    { key: 'folder', path: 'folder', kind: 'file' }
  ],
  { size: 32, concurrency: 3 }
)`,
        },
        {
            title: '权限检查后获取定位',
            code: `const status = await window.mulby.geolocation.getAccessStatus()

if (status === 'not-determined') {
  await window.mulby.geolocation.requestAccess()
}

if (await window.mulby.geolocation.canGetPosition()) {
  const position = await window.mulby.geolocation.getCurrentPosition({
    desiredAccuracy: 'best',
    allowFallback: true,
    timeoutMs: 10000
  })
  console.log(position.latitude, position.longitude, position.provider, position.fallbackUsed)
}`,
        },
    ]

    const rawData = {
        systemInfo,
        appInfo,
        appResourceUsage,
        paths,
        envValues,
        network: { isOnline },
        power: { isOnBattery, idleTime, idleState, systemIdleTime, thermalState },
        nativeId,
        isDev,
        platform,
        fileIcon: fileIcon ? '[data-url omitted]' : null,
        batchFileIcons: batchFileIcons.map(item => ({ ...item, icon: '[data-url omitted]' })),
        geolocation: {
            accessStatus: geolocationAccessStatus,
            canGetPosition,
            position,
            nativeLocationTest,
        },
    }

    if (loading) {
        return (
            <div className="main-content">
                <PageHeader icon={Monitor} title="系统信息" description="查看系统、应用和环境信息" />
                <div className="page-with-api-panel">
                    <div className="page-content">
                        <div className="loading">
                            <span className="spinner" />
                            <span>加载中...</span>
                        </div>
                    </div>
                    <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} defaultCollapsed />
                </div>
            </div>
        )
    }

    return (
        <div className="main-content">
            <PageHeader
                icon={Monitor}
                title="系统信息"
                description="查看系统、应用和环境信息"
                actions={<Button onClick={loadData}>刷新</Button>}
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    {/* Status Cards */}
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon">
                                {isOnline ? <Wifi aria-hidden="true" size={24} /> : <WifiOff aria-hidden="true" size={24} />}
                            </div>
                            <div className="stat-value">{isOnline ? '在线' : '离线'}</div>
                            <div className="stat-label">网络状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                {isOnBattery ? <Battery aria-hidden="true" size={24} /> : <Plug aria-hidden="true" size={24} />}
                            </div>
                            <div className="stat-value">{isOnBattery ? '电池' : '电源'}</div>
                            <div className="stat-label">供电状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><Timer aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{idleState ?? '-'}</div>
                            <div className="stat-label">空闲状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                {isDev ? <Wrench aria-hidden="true" size={24} /> : <Package aria-hidden="true" size={24} />}
                            </div>
                            <div className="stat-value">{isDev ? '开发' : '生产'}</div>
                            <div className="stat-label">运行模式</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        {/* System Info Card */}
                        <Card title="操作系统" icon={Computer}>
                            {systemInfo && (
                                <div className="info-grid">
                                    <span className="info-label">平台</span>
                                    <span className="info-value">{systemInfo.platform}</span>

                                    <span className="info-label">架构</span>
                                    <span className="info-value">{systemInfo.arch}</span>

                                    <span className="info-label">版本</span>
                                    <span className="info-value">{systemInfo.osVersion}</span>

                                    <span className="info-label">主机名</span>
                                    <span className="info-value">{systemInfo.hostname}</span>

                                    <span className="info-label">用户</span>
                                    <span className="info-value">{systemInfo.username}</span>

                                    <span className="info-label">CPU核心</span>
                                    <span className="info-value">{systemInfo.cpus} 核</span>

                                    <span className="info-label">总内存</span>
                                    <span className="info-value">{formatBytes(systemInfo.totalmem)}</span>

                                    <span className="info-label">可用内存</span>
                                    <span className="info-value">{formatBytes(systemInfo.freemem)}</span>

                                    <span className="info-label">运行时间</span>
                                    <span className="info-value">{formatUptime(systemInfo.uptime)}</span>
                                </div>
                            )}
                        </Card>

                        {/* App Info Card */}
                        <Card title="应用信息" icon={Smartphone}>
                            {appInfo && (
                                <div className="info-grid">
                                    <span className="info-label">名称</span>
                                    <span className="info-value">{appInfo.name}</span>

                                    <span className="info-label">版本</span>
                                    <span className="info-value">{appInfo.version}</span>

                                    <span className="info-label">语言</span>
                                    <span className="info-value">{appInfo.locale}</span>

                                    <span className="info-label">打包</span>
                                    <span className="info-value">
                                        <StatusBadge status={appInfo.isPackaged ? 'success' : 'info'}>
                                            {appInfo.isPackaged ? '已打包' : '开发模式'}
                                        </StatusBadge>
                                    </span>

                                    <span className="info-label">数据目录</span>
                                    <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                        {appInfo.userDataPath}
                                    </span>
                                </div>
                            )}
                        </Card>
                    </div>

                    <Card title="应用资源占用" icon={Activity}>
                        {appResourceUsage && (
                            <div className="info-grid">
                                <span className="info-label">采样时间</span>
                                <span className="info-value">{new Date(appResourceUsage.sampledAt).toLocaleString()}</span>

                                <span className="info-label">CPU</span>
                                <span className="info-value">{appResourceUsage.cpuPercent.toFixed(2)}%</span>

                                <span className="info-label">内存</span>
                                <span className="info-value">{formatBytes(appResourceUsage.memoryBytes)}</span>

                                <span className="info-label">进程数</span>
                                <span className="info-value">{appResourceUsage.processCount}</span>

                                <span className="info-label">用户数据目录</span>
                                <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                    {appResourceUsage.disk.userDataPath}
                                </span>

                                <span className="info-label">磁盘占用</span>
                                <span className="info-value">
                                    {formatBytes(appResourceUsage.disk.userDataBytes)} / {appResourceUsage.disk.fileCount} 文件
                                </span>
                            </div>
                        )}
                    </Card>

                    {/* 新增: 设备标识与平台检测 */}
                    <Card title="设备标识 & 平台检测" icon={KeyRound}>
                        <div className="info-grid">
                            <span className="info-label">设备 ID</span>
                            <span className="info-value" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                                {nativeId || '-'}
                            </span>

                            <span className="info-label">开发模式</span>
                            <span className="info-value">
                                <StatusBadge status={isDev ? 'warning' : 'success'}>
                                    {isDev ? '是 (isDev: true)' : '否 (isDev: false)'}
                                </StatusBadge>
                            </span>

                            <span className="info-label">系统空闲时间</span>
                            <span className="info-value">{systemIdleTime !== null ? `${systemIdleTime}s` : '-'}</span>

                            <span className="info-label">Power 空闲时间</span>
                            <span className="info-value">{idleTime !== null ? `${idleTime}s` : '-'}</span>

                            <span className="info-label">Power 空闲状态</span>
                            <span className="info-value">{idleState ?? '-'}</span>

                            <span className="info-label">热状态</span>
                            <span className="info-value">{thermalState ?? '-'}</span>

                            <span className="info-label">平台检测</span>
                            <span className="info-value">
                                {platform && (
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                        <StatusBadge status={platform.isMacOS ? 'success' : 'info'}>
                                            macOS: {platform.isMacOS ? '是' : '否'}
                                        </StatusBadge>
                                        <StatusBadge status={platform.isWindows ? 'success' : 'info'}>
                                            Windows: {platform.isWindows ? '是' : '否'}
                                        </StatusBadge>
                                        <StatusBadge status={platform.isLinux ? 'success' : 'info'}>
                                            Linux: {platform.isLinux ? '是' : '否'}
                                        </StatusBadge>
                                    </div>
                                )}
                            </span>
                        </div>
                    </Card>

                    {/* 新增: 文件图标 */}
                    <Card title="文件图标 API" icon={Image}>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '16px' }}>
                            <input
                                type="text"
                                value={iconPath}
                                onChange={(e) => setIconPath(e.target.value)}
                                placeholder="输入路径或扩展名 (如 .txt, folder)"
                                style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '6px',
                                    background: 'var(--bg-secondary)',
                                    color: 'var(--text-primary)',
                                    fontSize: '13px'
                                }}
                            />
                            <Button onClick={handleGetFileIcon}>获取图标</Button>
                        </div>
                        <div className="info-grid">
                            <span className="info-label">图标预览</span>
                            <span className="info-value">
                                {fileIcon ? (
                                    <img
                                        src={fileIcon}
                                        alt="File icon"
                                        style={{ width: '32px', height: '32px' }}
                                    />
                                ) : '-'}
                            </span>
                            <span className="info-label">批量图标</span>
                            <span className="info-value">
                                <span style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                    {batchFileIcons.map(item => (
                                        <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <img src={item.icon} alt={`${item.key} icon`} style={{ width: '24px', height: '24px' }} />
                                            <span>{item.key}</span>
                                        </span>
                                    ))}
                                </span>
                            </span>
                            <span className="info-label">提示</span>
                            <span className="info-value" style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                                支持文件路径、扩展名（如 .txt、.pdf）或 "folder"
                            </span>
                        </div>
                    </Card>

                    {/* Paths Card */}
                    <Card title="系统路径与环境变量" icon={FolderOpen}>
                        <div className="info-grid">
                            {Object.entries(paths).map(([name, path]) => (
                                <React.Fragment key={name}>
                                    <span className="info-label">{name}</span>
                                    <span className="info-value" style={{ fontSize: '11px' }}>{path}</span>
                                </React.Fragment>
                            ))}
                            {Object.entries(envValues).map(([name, value]) => (
                                <React.Fragment key={name}>
                                    <span className="info-label">env.{name}</span>
                                    <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-all' }}>
                                        {value || '-'}
                                    </span>
                                </React.Fragment>
                            ))}
                        </div>
                    </Card>

                    {/* Geolocation Card */}
                    <Card
                        title="地理位置"
                        icon={MapPin}
                        actions={
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <Button variant="secondary" onClick={handleGetLocation}>获取位置</Button>
                                <Button onClick={handleTestNativeLocation} loading={nativeLocationTest.status === 'testing'}>
                                    测试精确定位
                                </Button>
                            </div>
                        }
                    >
                        <div className="info-grid">
                            <span className="info-label">精确定位测试</span>
                            <span className="info-value">
                                <StatusBadge status={nativeLocationStatusBadge}>
                                    {nativeLocationTest.status === 'success' && '成功'}
                                    {nativeLocationTest.status === 'failed' && '失败'}
                                    {nativeLocationTest.status === 'testing' && '测试中'}
                                    {nativeLocationTest.status === 'idle' && '未测试'}
                                </StatusBadge>
                            </span>

                            <span className="info-label">权限状态</span>
                            <span className="info-value">{geolocationAccessStatus ?? '-'}</span>

                            <span className="info-label">可获取位置</span>
                            <span className="info-value">
                                <StatusBadge status={canGetPosition ? 'success' : 'info'}>
                                    {canGetPosition === null ? '未知' : (canGetPosition ? '是' : '否')}
                                </StatusBadge>
                            </span>

                            <span className="info-label">测试结果</span>
                            <span className="info-value">{nativeLocationTest.message}</span>

                            <span className="info-label">测试时间</span>
                            <span className="info-value">
                                {nativeLocationTest.checkedAt ? new Date(nativeLocationTest.checkedAt).toLocaleString() : '-'}
                            </span>

                            <span className="info-label">纬度</span>
                            <span className="info-value">{position ? position.latitude.toFixed(6) : '-'}</span>

                            <span className="info-label">经度</span>
                            <span className="info-value">{position ? position.longitude.toFixed(6) : '-'}</span>

                            <span className="info-label">精度</span>
                            <span className="info-value">{position ? `${position.accuracy.toFixed(0)} 米` : '-'}</span>

                            <span className="info-label">来源</span>
                            <span className="info-value">{position?.source ?? '-'}</span>

                            <span className="info-label">Provider</span>
                            <span className="info-value">{position?.provider ?? '-'}</span>

                            <span className="info-label">使用后备</span>
                            <span className="info-value">
                                {position ? (
                                    <StatusBadge status={position.fallbackUsed ? 'warning' : 'success'}>
                                        {position.fallbackUsed ? '是' : '否'}
                                    </StatusBadge>
                                ) : '-'}
                            </span>

                            <span className="info-label">尝试链路</span>
                            <span className="info-value" style={{ fontSize: '11px', wordBreak: 'break-word' }}>
                                {position ? formatLocationAttemptSummary(position) : '-'}
                            </span>

                            <span className="info-label">时间</span>
                            <span className="info-value">{position ? new Date(position.timestamp).toLocaleString() : '-'}</span>
                        </div>
                    </Card>
                </div>
                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
