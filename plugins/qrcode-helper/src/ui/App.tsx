import { useEffect, useState } from 'react'
import { QRCodeGenerator } from './components/QRCodeGenerator'
import { QRCodeScanner } from './components/QRCodeScanner'
import { useMulby } from './hooks/useMulby'
import './styles.css'

interface PluginInitData {
  input: string
  featureCode?: string
  attachments?: InputAttachment[]
  // other fields...
}

type Tab = 'generate' | 'scan'

interface InputAttachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('generate')
  const [initialInput, setInitialInput] = useState('')
  const [initialAttachment, setInitialAttachment] = useState<InputAttachment | null>(null)
  const { window: windowApi } = useMulby()

  useEffect(() => {
    // 确保窗口显示
    windowApi.show()

    const handleInit = (data: PluginInitData) => {
      if (data?.featureCode === 'scan') {
        setActiveTab('scan')
        const attachment = data.attachments?.find((item) => item.kind === 'image')
        if (attachment) {
          setInitialAttachment(attachment)
        }
        return
      }
      // 如果有输入文本，自动切换到生成模式并填入
      if (data && data.input) {
        setInitialInput(data.input)
        setActiveTab('generate')
      }
    }

    // 监听插件初始化
    if (window.mulby && window.mulby.onPluginInit) {
      window.mulby.onPluginInit(handleInit)
    }
  }, [windowApi])

  return (
    <div className="app">
      <div className="tabs">
        <div
          className={`tab ${activeTab === 'generate' ? 'active' : ''}`}
          onClick={() => setActiveTab('generate')}
        >
          生成二维码
        </div>
        <div
          className={`tab ${activeTab === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveTab('scan')}
        >
          识别二维码
        </div>
      </div>

      <div className="content-area">
        {activeTab === 'generate' ? (
          <QRCodeGenerator initialValue={initialInput} />
        ) : (
          <QRCodeScanner initialAttachment={initialAttachment} />
        )}
      </div>
    </div>
  )
}
