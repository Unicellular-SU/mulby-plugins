import { useEffect, useState } from 'react'
import { Sidebar } from './components'
import { useTheme } from './hooks'
import {
  SystemInfoModule,
  ClipboardModule,
  InputModule,
  FileManagerModule,
  NetworkModule,
  ScreenModule,
  MediaModule,
  SettingsModule,
  SecurityModule,
  ImageEditor,
  WindowAPIModule,
  ChildWindowModule,
  InBrowserDemo,
  SharpModule,
  FFmpegModule,
  AttachmentsModule,
  AIModule,
  SchedulerModule
} from './modules'

console.log('[App] Module imports loaded')

type ModuleId = 'sysinfo' | 'clipboard' | 'input' | 'filemanager' | 'network' | 'screen' | 'media' | 'settings' | 'security' | 'image-editor' | 'window-api' | 'child-window' | 'inbrowser' | 'sharp' | 'ffmpeg' | 'attachments' | 'ai' | 'scheduler'
type ScreenAutoAction = 'region-capture' | null

interface ShowcaseAttachment {
  id?: string
  name?: string
  size?: number
  kind?: string
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
  capture?: unknown
}

const featureToModule: Record<string, ModuleId> = {
  main: 'sysinfo',
  sysinfo: 'sysinfo',
  clipboard: 'clipboard',
  input: 'input',
  files: 'filemanager',
  network: 'network',
  screen: 'screen',
  media: 'media',
  window: 'window-api',
  'window-api': 'window-api',
  childWindow: 'child-window',
  'child-window': 'child-window',
  inbrowser: 'inbrowser',
  settings: 'settings',
  screenshot: 'screen',
  'showcase:ui-settings': 'settings',
  'showcase:ui-detached': 'settings',
  'showcase:inbrowser': 'inbrowser',
  sharp: 'sharp',
  'showcase:sharp': 'sharp',
  ffmpeg: 'ffmpeg',
  'showcase:ffmpeg': 'ffmpeg',
  'attachments': 'attachments',
  ai: 'ai',
  scheduler: 'scheduler'
}

function handleDynamicCommand(featureCode: string, input?: string) {
  const notification = window.mulby?.notification
  const clipboard = window.mulby?.clipboard

  switch (featureCode) {
    case 'showcase:today': {
      const today = new Date().toLocaleDateString()
      void clipboard?.writeText(today)
      notification?.show(`今日日期：${today}`)
      break
    }
    case 'showcase:reverse': {
      const raw = input?.trim() || ''
      let text = raw
      if (raw.toLowerCase().startsWith('rev ')) {
        text = raw.slice(4)
      } else if (raw.toLowerCase().startsWith('reverse ')) {
        text = raw.slice(8)
      }
      if (!text) {
        notification?.show('请输入要反转的文本')
        break
      }
      const reversed = text.split('').reverse().join('')
      void clipboard?.writeText(reversed)
      notification?.show(`已复制反转结果：${reversed}`)
      break
    }
    case 'showcase:mac-only': {
      notification?.show('macOS 专用动态指令已触发')
      break
    }
    default:
      break
  }
}

// 模块映射
const moduleComponents: Record<ModuleId, React.ComponentType<any>> = {
  sysinfo: SystemInfoModule,
  clipboard: ClipboardModule,
  input: InputModule,
  filemanager: FileManagerModule,
  network: NetworkModule,
  screen: ScreenModule,
  media: MediaModule,
  settings: SettingsModule,
  security: SecurityModule,
  'image-editor': ImageEditor,
  'window-api': WindowAPIModule,
  'child-window': ChildWindowModule,
  'inbrowser': InBrowserDemo,
  'sharp': SharpModule,
  'ffmpeg': FFmpegModule,
  'attachments': AttachmentsModule,
  ai: AIModule,
  scheduler: SchedulerModule
}

// 从 URL 参数或插件初始化数据获取默认模块
function getInitialModule(): ModuleId {
  console.log('[App] getInitialModule called', window.location.search, window.location.hash)
  const hash = window.location.hash
  if (hash.includes('image-editor')) {
    return 'image-editor'
  }
  if (hash.includes('child-window')) {
    return 'child-window'
  }
  // 强制只返回 sysinfo
  return 'sysinfo'
}

export default function App() {
  console.log('[App] Rendering...')
  const [activeModule, setActiveModule] = useState<ModuleId>(getInitialModule)
  const [screenAutoAction, setScreenAutoAction] = useState<ScreenAutoAction>(null)
  const [attachmentsData, setAttachmentsData] = useState<any[]>([])
  const [screenAttachments, setScreenAttachments] = useState<ShowcaseAttachment[]>([])
  const [childWindowParams, setChildWindowParams] = useState<Record<string, string> | undefined>(undefined)

  // 初始化主题
  useTheme()

  // 监听插件初始化
  useEffect(() => {
    console.log('[App] Mount effect')
    window.mulby?.onPluginInit?.((data) => {
      console.log('[App] onPluginInit received data:', data)
      if (data.featureCode?.startsWith('showcase:')) {
        handleDynamicCommand(data.featureCode, data.input)
      }
      if (data.route && data.route.includes('image-editor')) {
        setActiveModule('image-editor')
        setScreenAutoAction(null)
      } else if (data.route && data.route.includes('child-window')) {
        setChildWindowParams(data.params)
        setActiveModule('child-window')
        setScreenAutoAction(null)
      } else if (data.featureCode === 'screenshot') {
        setActiveModule('screen')
        setScreenAttachments(data.attachments || [])
        setScreenAutoAction(data.attachments?.some((attachment) => attachment.kind === 'image' && attachment.dataUrl) ? null : 'region-capture')
      } else if (data.featureCode && data.featureCode in featureToModule) {
        setActiveModule(featureToModule[data.featureCode])
        if (featureToModule[data.featureCode] !== 'screen') {
          setScreenAttachments([])
        }
        setScreenAutoAction(null)
      }

      if (data.attachments) {
        setAttachmentsData(data.attachments)
      }
    })
  }, [])

  const ActiveModuleComponent = moduleComponents[activeModule]

  const handleModuleChange = (id: string) => {
    console.log('[App] handleModuleChange:', id)
    if (id in moduleComponents) {
      setScreenAutoAction(null)
      setActiveModule(id as ModuleId)
    }
  }

  // 如果是图片编辑器，不显示侧边栏
  if (activeModule === 'image-editor') {
    return (
      <div className="app" style={{ display: 'block' }}>
        {ActiveModuleComponent ? <ActiveModuleComponent /> : <div>Module not found</div>}
      </div>
    )
  }

  return (
    <div className="app">
      <Sidebar
        activeModule={activeModule}
        onModuleChange={handleModuleChange}
      />
      {ActiveModuleComponent ? (
        activeModule === 'screen' ? (
          <ActiveModuleComponent
            autoAction={screenAutoAction}
            attachments={screenAttachments}
            onAutoActionDone={() => setScreenAutoAction(null)}
          />
        ) : (
          activeModule === 'child-window' ? (
            <ActiveModuleComponent initParams={childWindowParams} />
          ) : activeModule === 'attachments' ? (
            <ActiveModuleComponent attachments={attachmentsData} />
          ) : (
            <ActiveModuleComponent />
          )
        )
      ) : (
        <div>Module not found</div>
      )}
    </div>
  )
}
