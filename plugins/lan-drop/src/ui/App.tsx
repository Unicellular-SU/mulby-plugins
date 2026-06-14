import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FilePlus2,
  Inbox,
  Send,
  Settings as SettingsIcon,
  Smartphone,
  UploadCloud,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import type { AppState, FileMeta, RemoteDevice, Settings } from '../core/types'
import { api } from './api'
import { formatSize } from './format'
import { useFileDrop } from './hooks/useFileDrop'
import { DeviceList } from './components/DeviceList'
import { TransferList } from './components/TransferList'
import { SettingsDrawer } from './components/SettingsDrawer'
import { MobileDrawer } from './components/MobileDrawer'
import { ManualAddDialog } from './components/ManualAddDialog'

function notify(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
  try {
    window.mulby?.notification?.show(message, type)
  } catch {
    /* ignore */
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [staged, setStaged] = useState<FileMeta[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showMobile, setShowMobile] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [manualBusy, setManualBusy] = useState(false)
  const [manualError, setManualError] = useState<string | undefined>()

  // 跟随宿主主题
  useEffect(() => {
    const apply = (t: 'light' | 'dark') =>
      document.documentElement.classList.toggle('dark', t === 'dark')
    window.mulby?.theme?.getActual?.().then(apply).catch(() => {})
    const off = window.mulby?.onThemeChange?.(apply)
    return () => {
      try {
        off?.()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const s = await api.getState()
      if (s) setState(s)
    } catch {
      /* 后端可能尚未就绪，下次重试 */
    }
  }, [])

  // 「刷新」按钮：主动重新发现（向局域网广播/单播 query），而非仅重读后端状态。
  // 这样被误剔除的设备能立即重新出现，无需重启插件。
  const handleRescan = useCallback(async () => {
    try {
      await api.rescan()
    } catch {
      /* 忽略，下方仍会重读一次状态 */
    }
    await refresh()
  }, [refresh])

  // 事件驱动：长轮询订阅后端状态变更（rev 驱动）。
  // 活动时随 bump 近实时刷新，空闲时挂起在后端不再忙轮询；另加慢速兜底防卡死。
  useEffect(() => {
    let stopped = false
    let rev = -1
    const subscribe = async () => {
      while (!stopped) {
        try {
          const res = await api.waitState(rev)
          if (stopped) break
          if (res?.state) {
            setState(res.state)
            rev = res.rev
          } else {
            await sleep(800)
          }
        } catch {
          if (stopped) break
          await sleep(1000)
        }
      }
    }
    void subscribe()
    const fallback = setInterval(() => void refresh(), 10000)
    return () => {
      stopped = true
      clearInterval(fallback)
    }
  }, [refresh])

  // 接收 Mulby 触发时携带的附件（拖文件到搜索框 → 用闪传发送）
  useEffect(() => {
    const disposable = window.mulby?.onPluginInit?.((data: { attachments?: Array<{ path?: string }> }) => {
      const paths = (data?.attachments || [])
        .map((a) => a.path)
        .filter((p): p is string => !!p)
      if (paths.length > 0) void addPaths(paths)
    })
    return () => {
      try {
        disposable?.()
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addPaths = useCallback(async (paths: string[]) => {
    try {
      const res = await api.resolveFiles(paths)
      const incoming = res?.files || []
      if (incoming.length === 0) {
        notify('未解析到有效文件', 'warning')
        return
      }
      setStaged((prev) => {
        const seen = new Set(prev.map((f) => f.path))
        const merged = [...prev, ...incoming.filter((f) => !seen.has(f.path))]
        return merged
      })
    } catch {
      notify('解析文件失败', 'error')
    }
  }, [])

  const { isDragging } = useFileDrop(addPaths)

  const devices = state?.devices || []
  const self = state?.self || null
  const settings = state?.settings || null

  // 自动选中一个可用设备
  useEffect(() => {
    if (!selectedId && devices.length > 0) setSelectedId(devices[0].id)
    if (selectedId && !devices.some((d) => d.id === selectedId)) {
      setSelectedId(devices[0]?.id || null)
    }
  }, [devices, selectedId])

  const selectedDevice = useMemo(
    () => devices.find((d) => d.id === selectedId) || null,
    [devices, selectedId],
  )

  const handlePick = async () => {
    try {
      const res = await api.pickFiles()
      const files = res?.files || []
      if (files.length > 0) {
        setStaged((prev) => {
          const seen = new Set(prev.map((f) => f.path))
          return [...prev, ...files.filter((f) => !seen.has(f.path))]
        })
      }
    } catch {
      notify('选择文件失败', 'error')
    }
  }

  const handleSend = async () => {
    if (!selectedDevice) {
      notify('请先选择一个目标设备', 'warning')
      return
    }
    if (staged.length === 0) {
      notify('请先添加要发送的文件', 'warning')
      return
    }
    // 携带相对路径，发送文件夹时接收端可重建目录层级。
    const items = staged.map((f) => ({ path: f.path, relPath: f.relPath }))
    try {
      const res = await api.sendFiles(selectedDevice.id, items)
      if (res?.ok) {
        notify(`已开始发送 ${res.count ?? staged.length} 个文件到 ${selectedDevice.name}`, 'success')
        setStaged([])
        refresh()
      } else {
        notify(res?.error || '发送失败', 'error')
      }
    } catch {
      notify('发送失败', 'error')
    }
  }

  const handleToggleTrust = async (device: RemoteDevice) => {
    await api.setTrusted(device.id, !device.trusted)
    refresh()
  }

  const handleManualAdd = async (ip: string, port?: number) => {
    setManualBusy(true)
    setManualError(undefined)
    try {
      const res = await api.addManualDevice(ip, port)
      if (res?.ok && res.device) {
        setSelectedId(res.device.id)
        setShowManual(false)
        notify(`已添加设备 ${res.device.name}`, 'success')
        refresh()
      } else {
        setManualError(res?.error || '添加失败')
      }
    } catch {
      setManualError('添加失败，请检查网络')
    } finally {
      setManualBusy(false)
    }
  }

  const handlePatch = async (patch: Partial<Settings>) => {
    await api.setSettings(patch)
    refresh()
  }

  const totalStagedSize = staged.reduce((sum, f) => sum + f.size, 0)

  return (
    <div className="app">
      {isDragging && (
        <div className="drop-overlay">
          <UploadCloud size={56} />
          <p>释放以添加文件</p>
          <span>支持多文件与文件夹</span>
        </div>
      )}

      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <Send size={16} />
          </div>
          <span className="brand-name">闪传 LanDrop</span>
        </div>
        <div className="topbar-right">
          <div className={`net-pill ${self?.receiveOnline ? 'on' : 'off'}`}>
            {self?.receiveOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
            {self?.receiveOnline ? '在线' : '离线'}
          </div>
          <button
            className="btn-secondary"
            title="手机互传（扫码收发）"
            onClick={() => setShowMobile(true)}
          >
            <Smartphone size={15} /> 手机互传
          </button>
          <button className="icon-btn" title="设置" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={17} />
          </button>
        </div>
      </header>

      <div className="layout">
        <DeviceList
          self={self}
          devices={devices}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggleTrust={handleToggleTrust}
          onManualAdd={() => {
            setManualError(undefined)
            setShowManual(true)
          }}
          onRefresh={handleRescan}
        />

        <main className="workspace">
          <section className="send-tray">
            <div
              className="dropzone"
              onClick={handlePick}
              role="button"
              tabIndex={0}
            >
              <FilePlus2 size={22} />
              <div className="dropzone-text">
                <strong>拖入文件到此处</strong>
                <span>或点击选择文件 / 文件夹</span>
              </div>
            </div>

            {staged.length > 0 && (
              <div className="staged">
                <div className="staged-head">
                  <span>
                    待发送 {staged.length} 项 · {formatSize(totalStagedSize)}
                  </span>
                  <button className="text-btn" onClick={() => setStaged([])}>
                    <X size={13} /> 清空
                  </button>
                </div>
                <div className="staged-list">
                  {staged.map((f) => (
                    <div className="staged-item" key={f.path}>
                      <span className="staged-name" title={f.path}>
                        {f.name}
                      </span>
                      <span className="staged-size">{formatSize(f.size)}</span>
                      <button
                        className="icon-btn sm"
                        onClick={() => setStaged((prev) => prev.filter((x) => x.path !== f.path))}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="send-bar">
              <div className="send-target">
                {selectedDevice ? (
                  <>
                    发送至 <strong>{selectedDevice.name}</strong>
                    <span className="send-target-ip">{selectedDevice.ip}</span>
                  </>
                ) : (
                  <span className="send-target-empty">
                    <Inbox size={14} /> 请选择左侧设备
                  </span>
                )}
              </div>
              <button
                className="btn-primary send-btn"
                disabled={!selectedDevice || staged.length === 0}
                onClick={handleSend}
              >
                <Send size={15} /> 发送
              </button>
            </div>
          </section>

          <TransferList
            transfers={state?.transfers || []}
            onCancel={(id) => {
              api.cancelTransfer(id)
              refresh()
            }}
            onOpen={(t) => t.savePath && api.openPath(t.savePath)}
            onClear={() => {
              api.clearHistory()
              refresh()
            }}
          />
        </main>
      </div>

      {showSettings && settings && (
        <SettingsDrawer
          settings={settings}
          self={self}
          onPatch={handlePatch}
          onChooseDir={async () => {
            await api.chooseDownloadDir()
            refresh()
          }}
          onOpenDir={() => api.openDownloadDir()}
          onRestart={async () => {
            await api.restartServers()
            notify('已重启网络服务', 'info')
            refresh()
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showMobile && (
        <MobileDrawer snapshot={state?.mobile} onClose={() => setShowMobile(false)} />
      )}

      {showManual && (
        <ManualAddDialog
          busy={manualBusy}
          error={manualError}
          onAdd={handleManualAdd}
          onClose={() => setShowManual(false)}
        />
      )}
    </div>
  )
}
